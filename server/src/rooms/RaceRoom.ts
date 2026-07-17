import { Room, Client } from "colyseus";
import { RaceState } from "./RaceState";
import { CarState } from "./CarState";
import { buildTrackPath, TrackPath } from "../trackPath";

interface RoomOptions {
  name?: string;
  color?: number;
  mapId?: string;
}

interface InputMessage {
  throttle: number;
  brake: number;
  steer: number;
}

interface KickMessage {
  id: string;
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

// PRECISA bater com as constantes de src/car.ts (CarController) no client, senão a predição do
// client diverge do que o servidor calcula.
const MAX_SPEED = 38;
const MAX_REVERSE_SPEED = -12;
const ACCELERATION = 18;
const BRAKE_DECELERATION = 26;
const FRICTION = 6;
const TURN_SPEED = 2.2;

const MIN_RACERS = 5;
const MAX_RACERS = 10;
const COUNTDOWN_SECONDS = 4;
// PRECISA bater com TOTAL_LAPS em src/main.ts
const TOTAL_LAPS = 3;
// mesmo limiar de "chegou perto o bastante do waypoint" usado em src/raceTimer.ts (RaceProgress)
const WAYPOINT_RADIUS = 14;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class RaceRoom extends Room<RaceState> {
  maxClients = MAX_RACERS;

  private trackPath!: TrackPath;
  private botAI = new Map<string, BotAI>();
  private carProgress = new Map<string, CarProgress>();
  private botCounter = 0;

  onCreate(options: RoomOptions) {
    const state = new RaceState();
    state.mapId = options?.mapId ?? "estadio";
    this.setState(state);
    this.trackPath = buildTrackPath(state.mapId);

    this.onMessage("input", (client, message: InputMessage) => {
      if (this.state.phase !== "racing") return;
      const car = this.state.cars.get(client.sessionId);
      if (!car || car.isBot) return;
      car.throttle = clamp(message.throttle, 0, 1);
      car.brake = clamp(message.brake, 0, 1);
      car.steer = clamp(message.steer, -1, 1);
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
      if (!id || id === client.sessionId) return;
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
    car.name = (options?.name ?? "JOGADOR").slice(0, 10);
    car.color = options?.color ?? 0xe8e8e8;
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
    car.x = spawn.x;
    car.z = spawn.z;
    car.heading = this.trackPath.startHeading;
    car.speed = 0;
    car.lapCount = 0;
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
      this.applyPhysics(car, dt);
      if (ai && car.speed > ai.topSpeed) car.speed = ai.topSpeed;
      this.updateProgress(id, car);
    });
  }

  private applyPhysics(car: CarState, dt: number) {
    if (car.throttle > 0) {
      car.speed += ACCELERATION * car.throttle * dt;
    } else if (car.brake > 0) {
      car.speed -= BRAKE_DECELERATION * dt;
    } else {
      const decel = FRICTION * dt;
      if (car.speed > 0) car.speed = Math.max(0, car.speed - decel);
      else if (car.speed < 0) car.speed = Math.min(0, car.speed + decel);
    }

    car.speed = clamp(car.speed, MAX_REVERSE_SPEED, MAX_SPEED);

    if (Math.abs(car.speed) > 0.1) {
      const speedFactor = car.speed / MAX_SPEED;
      const direction = car.speed >= 0 ? 1 : -1;
      car.heading -= car.steer * TURN_SPEED * dt * direction * Math.min(1, Math.abs(speedFactor) + 0.3);
    }

    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
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
    if (progress.nextIndex !== this.trackPath.startIndex) return;

    car.lapCount++;
    if (car.lapCount >= TOTAL_LAPS) {
      this.state.winnerId = id;
      this.state.phase = "finished";
    }
  }

  /** IA simplificada: persegue os waypoints da pista, com uma ré rápida quando fica travado. */
  private driveBot(car: CarState, ai: BotAI, dt: number) {
    const waypoints = this.trackPath.waypoints;
    const target = waypoints[ai.targetIndex];
    const dx = target.x - car.x;
    const dz = target.z - car.z;
    if (Math.hypot(dx, dz) < 8) {
      ai.targetIndex = (ai.targetIndex + 1) % waypoints.length;
    }

    const desiredHeading = Math.atan2(dx, dz);
    const angleDiff = normalizeAngle(desiredHeading - car.heading);
    const steer = clamp(-angleDiff * 2, -1, 1);
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
