import { Room, Client } from "colyseus";
import { RaceState } from "./RaceState";
import { CarState } from "./CarState";
import { buildTrackPath } from "../shared/trackGeometry";
import type { TrackPath } from "../shared/trackGeometry";
import { stepCar, normalizeAngle, MAX_SPEED } from "../shared/physics";
import {
  TOTAL_LAPS,
  WAYPOINT_RADIUS,
  BOT_WAYPOINT_RADIUS,
  MIN_RACERS,
  MAX_RACERS,
  COUNTDOWN_SECONDS,
} from "../shared/rules";

interface RoomOptions {
  name?: unknown;
  color?: unknown;
  mapId?: unknown;
}

// tudo aqui vem da rede, ou seja, de fora — nada é confiável antes de passar por clampFinite/
// sanitizeName, então os campos são `unknown` de propósito
interface InputMessage {
  throttle?: unknown;
  brake?: unknown;
  steer?: unknown;
}

interface KickMessage {
  id?: unknown;
}

interface BotAI {
  targetIndex: number;
  stuckTimer: number;
  reverseTimer: number;
  lastReverseSteer: number;
  topSpeed: number;
}

interface CarProgress {
  nextIndex: number;
}

/**
 * Clamp pra valores que vieram da REDE. `Math.max`/`Math.min` propagam NaN em vez de barrar, então
 * o clamp normal deixava passar `steer = NaN` (de um pacote malformado ou de um client adulterado)
 * -> `heading` NaN -> `x`/`z` NaN, e aquele carro sumia da pista pelo resto da corrida, sem volta.
 */
function clampFinite(value: unknown, min: number, max: number, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Nome também vem do client: tira caracteres de controle, corta em 10 e garante que sobra algo. */
function sanitizeName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  // filtra caractere de controle por codigo em vez de regex com escape, pra nao ter byte
  // literal esquisito no fonte
  const clean = Array.from(text)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 10);
  return clean || "JOGADOR";
}

export class RaceRoom extends Room<RaceState> {
  maxClients = MAX_RACERS;

  private trackPath!: TrackPath;
  private botAI = new Map<string, BotAI>();
  private carProgress = new Map<string, CarProgress>();
  private botCounter = 0;

  onCreate(options: RoomOptions) {
    // o padrão do Colyseus manda atualização de state só 20x/s (a cada 50ms) — sincroniza com a
    // taxa da própria simulação (30Hz) pra reduzir o "degrau" que a gente precisa disfarçar
    // suavizando no client (menos degrau = menos suavização = resposta mais rápida ao input)
    this.patchRate = 1000 / 30;

    const state = new RaceState();
    // mapId vira índice de MAP_SHAPES lá no buildTrackPath — só aceita os ids que existem mesmo
    state.mapId = typeof options?.mapId === "string" ? options.mapId : "estadio";
    this.setState(state);
    this.trackPath = buildTrackPath(state.mapId);

    this.onMessage("input", (client, message: InputMessage) => {
      if (this.state.phase !== "racing") return;
      const car = this.state.cars.get(client.sessionId);
      if (!car || car.isBot) return;
      car.throttle = clampFinite(message?.throttle, 0, 1);
      car.brake = clampFinite(message?.brake, 0, 1);
      car.steer = clampFinite(message?.steer, -1, 1);
    });

    this.onMessage("addBot", (client) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "waiting") return;
      if (this.state.cars.size >= MAX_RACERS) return;
      this.addBot();
    });

    this.onMessage("kick", (client, message: KickMessage) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "waiting") return;
      const id = message?.id;
      if (typeof id !== "string" || !id || id === client.sessionId) return;
      const car = this.state.cars.get(id);
      if (!car) return;

      if (car.isBot) {
        this.state.cars.delete(id);
        this.botAI.delete(id);
        this.carProgress.delete(id);
        return;
      }

      const target = this.clients.find((c) => c.sessionId === id);
      target?.leave();
    });

    this.onMessage("start", (client) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "waiting") return;
      if (this.state.cars.size < MIN_RACERS) return;
      this.state.phase = "countdown";
      this.state.countdown = COUNTDOWN_SECONDS;
    });

    this.onMessage("restart", (client) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== "finished") return;
      this.restartRace();
    });

    // simula a física de todo mundo a 30Hz — o servidor é a autoridade, o client só manda input
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / 30);
  }

  onJoin(client: Client, options: RoomOptions) {
    if (this.state.phase !== "waiting") {
      throw new Error("A corrida já começou nesta sala.");
    }

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    const car = new CarState();
    car.name = sanitizeName(options?.name);
    car.color = Math.floor(clampFinite(options?.color, 0, 0xffffff, 0xe8e8e8));
    this.spawnCar(client.sessionId, car, this.state.cars.size);
    this.state.cars.set(client.sessionId, car);
    console.log(`${car.name} entrou na sala ${this.roomId}`);
  }

  onLeave(client: Client) {
    this.state.cars.delete(client.sessionId);
    this.carProgress.delete(client.sessionId);
    if (client.sessionId === this.state.hostSessionId) {
      const next = this.clients.find((c) => c.sessionId !== client.sessionId);
      this.state.hostSessionId = next?.sessionId ?? "";
    }
  }

  private addBot() {
    const id = `bot-${this.botCounter++}`;
    const car = new CarState();
    car.name = `BOT ${this.botCounter}`;
    car.color = Math.floor(Math.random() * 0xffffff);
    car.isBot = true;
    this.spawnCar(id, car, this.state.cars.size);
    this.state.cars.set(id, car);
    this.botAI.set(id, {
      targetIndex: this.trackPath.startIndex,
      stuckTimer: 0,
      reverseTimer: 0,
      lastReverseSteer: 0,
      topSpeed: MAX_SPEED * (0.75 + Math.random() * 0.15),
    });
  }

  /** Posiciona um carro na grid de largada e zera seu progresso de volta — usado no join, ao
   * adicionar bot, e ao reiniciar a corrida (reaproveitando a mesma sala). */
  private spawnCar(id: string, car: CarState, slot: number) {
    const spawn = this.trackPath.gridPosition(slot);
    car.gridSlot = slot;
    car.x = spawn.x;
    car.z = spawn.z;
    car.heading = this.trackPath.startHeading;
    car.speed = 0;
    car.lapCount = 0;
    car.progress = 0;
    car.throttle = 0;
    car.brake = 0;
    car.steer = 0;
    this.carProgress.set(id, {
      nextIndex: (this.trackPath.startIndex + 1) % this.trackPath.waypoints.length,
    });
  }

  /** Volta pra fase "waiting" na MESMA sala, com os mesmos carros, prontos pra correr de novo. */
  private restartRace() {
    this.state.phase = "waiting";
    this.state.winnerId = "";

    let slot = 0;
    this.state.cars.forEach((car, id) => {
      this.spawnCar(id, car, slot);
      slot++;
      const ai = this.botAI.get(id);
      if (ai) {
        ai.targetIndex = this.trackPath.startIndex;
        ai.stuckTimer = 0;
        ai.reverseTimer = 0;
      }
    });
  }

  private update(dt: number) {
    if (this.state.phase === "countdown") {
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      if (this.state.countdown <= 0) {
        this.state.phase = "racing";
      }
      return;
    }
    if (this.state.phase !== "racing") return;

    this.state.cars.forEach((car, id) => {
      const ai = car.isBot ? this.botAI.get(id) : undefined;
      if (ai) this.driveBot(car, ai, dt);
      // MESMA função de física que o client roda no modo solo (shared/physics.ts) — o CarState já
      // tem x/z/heading/speed e throttle/brake/steer com os nomes que ela espera
      stepCar(car, car, dt);
      if (ai && car.speed > ai.topSpeed) car.speed = ai.topSpeed;
      this.updateProgress(id, car);
    });
  }

  /**
   * Autoridade única de quantas voltas cada carro já deu — o client antigamente calculava isso
   * sozinho a partir da posição sincronizada, e cada client podia decidir o vencedor num frame
   * ligeiramente diferente (ainda mais depois de suavizar a posição no render). Agora só o
   * servidor decide, e todo mundo lê o mesmo `car.lapCount`/`state.winnerId`.
   */
  private updateProgress(id: string, car: CarState) {
    if (this.state.winnerId) return;
    const progress = this.carProgress.get(id);
    if (!progress) return;

    const waypoints = this.trackPath.waypoints;
    const target = waypoints[progress.nextIndex];
    const dx = target.x - car.x;
    const dz = target.z - car.z;
    if (Math.hypot(dx, dz) >= WAYPOINT_RADIUS) return;

    progress.nextIndex = (progress.nextIndex + 1) % waypoints.length;

    if (progress.nextIndex === this.trackPath.startIndex) {
      car.lapCount++;
      if (car.lapCount >= TOTAL_LAPS) {
        this.state.winnerId = id;
        this.state.phase = "finished";
      }
    }

    car.progress =
      car.lapCount * waypoints.length +
      ((progress.nextIndex - this.trackPath.startIndex + waypoints.length) % waypoints.length);
  }

  /** IA simplificada: persegue os waypoints da pista, com uma ré rápida quando fica travado. */
  private driveBot(car: CarState, ai: BotAI, dt: number) {
    const waypoints = this.trackPath.waypoints;
    const target = waypoints[ai.targetIndex];
    const dx = target.x - car.x;
    const dz = target.z - car.z;
    if (Math.hypot(dx, dz) < BOT_WAYPOINT_RADIUS) {
      ai.targetIndex = (ai.targetIndex + 1) % waypoints.length;
    }

    const desiredHeading = Math.atan2(dx, dz);
    const angleDiff = normalizeAngle(desiredHeading - car.heading);
    const steer = Math.max(-1, Math.min(1, -angleDiff * 2));
    const sharpTurn = Math.abs(angleDiff) > 0.5;

    if (ai.reverseTimer > 0) {
      ai.reverseTimer -= dt;
      car.throttle = 0;
      car.brake = 1;
      car.steer = ai.lastReverseSteer;
      return;
    }

    car.throttle = sharpTurn ? 0.65 : 1;
    car.brake = 0;
    car.steer = steer;

    if (Math.abs(car.speed) < 2) {
      ai.stuckTimer += dt;
      if (ai.stuckTimer > 0.8) {
        ai.reverseTimer = 1 + Math.random() * 0.5;
        ai.lastReverseSteer = steer >= 0 ? -1 : 1;
        ai.stuckTimer = 0;
      }
    } else {
      ai.stuckTimer = 0;
    }
  }
}
