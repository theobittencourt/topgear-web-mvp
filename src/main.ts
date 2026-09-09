import * as THREE from "three";
import { createTrack, elevationAt, ROAD_WIDTH, findNearestWaypoint, TRACK_PRESETS } from "./track";
import type { TrackConfig } from "./track";
import {
  MAX_SPEED,
  NITRO_CHARGES,
  NITRO_DURATION,
  FUEL_DRAIN_PER_SECOND,
  FUEL_DRAIN_NITRO_MULTIPLIER,
  gearForSpeed,
} from "@shared/physics";
import { VISUAL, ART, wantsAntialias, applyResolution, createSkyTexture } from "./retro";
import { TOTAL_LAPS, MIN_RACERS, MAX_RACERS } from "@shared/rules";
import { createCarMesh, CarController, AICarController } from "./car";
import { resolveCarCollisions } from "./collision";
import { RaceProgress, LapClock, formatTime } from "./raceTimer";
import { createLobby, joinLobby, getStateCallbacks } from "./network";
import type { Room } from "colyseus.js";
import {
  createSpeedHud,
  createDashHud,
  createLapHud,
  createLeaderboardHud,
  createLapBanner,
  createCountdownOverlay,
  createVictoryOverlay,
  createNameEntryScreen,
  createMapSelectScreen,
  createCarSelectScreen,
  createModeSelectScreen,
  createOnlineChoiceScreen,
  createCodeEntryScreen,
  createLobbyScreen,
  createLoadingScreen,
  createMinimap,
  createMobileControls,
  createPositionBadge,
} from "./ui";

const app = document.getElementById("app")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  ART.camera.fov,
  window.innerWidth / window.innerHeight,
  0.1,
  700
);

const renderer = new THREE.WebGLRenderer({ antialias: wantsAntialias });
renderer.shadowMap.enabled = !VISUAL.flatLighting;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// resolução interna baixa + esticada com pixel quadrado (cuida do resize também)
applyResolution(renderer, camera);

document.body.style.setProperty("user-select", "none");
document.body.style.setProperty("-webkit-user-select", "none");
document.body.style.setProperty("-moz-user-select", "none");
document.body.style.setProperty("-ms-user-select", "none");

// input compartilhado entre o modo solo e o multiplayer (captura de teclado + controles mobile)
const keys = { w: false, a: false, s: false, d: false };
const mobileInput = { throttle: false, brake: false, steer: 0 };
/**
 * Nitro é um PULSO, não um estado: cada toque na tecla/botão consome no máximo uma carga, e
 * segurar não gasta o resto. Quem consome zera de volta.
 */
const nitroRequest = { pending: false };
const isMobileDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

if (isMobileDevice) {
  createMobileControls((state) => {
    mobileInput.throttle = state.throttle;
    mobileInput.brake = state.brake;
    mobileInput.steer = state.steer;
    if (state.nitro) nitroRequest.pending = true;
  });
}

window.addEventListener("keydown", (e) => setKey(e.key, true));
window.addEventListener("keyup", (e) => setKey(e.key, false));

// bloqueio extra de zoom no mobile — o touch-action: none do CSS já ajuda, mas alguns navegadores
// (principalmente Safari/iOS) ainda deixam passar zoom de pinça e double-tap por fora dele
document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false }
);
document.addEventListener("gesturestart", (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener(
  "touchend",
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false }
);

let nitroKeyHeld = false;

function setKey(key: string, value: boolean) {
  const k = key.toLowerCase();
  if (k === "w" || k === "a" || k === "s" || k === "d") keys[k] = value;

  if (key === " " || k === "shift") {
    // Só dispara na DESCIDA da tecla. Sem esse controle, o auto-repeat do teclado manda keydown
    // sem parar enquanto a tecla está apertada — e como cada carga dura pouco, segurar o espaço
    // queimava as três em sequência sem o jogador perceber.
    if (value && !nitroKeyHeld) nitroRequest.pending = true;
    nitroKeyHeld = value;
  }
}

/** Consome o pedido de turbo pendente, se houver. */
function takeNitroRequest(): boolean {
  if (!nitroRequest.pending) return false;
  nitroRequest.pending = false;
  return true;
}

const cameraForward = new THREE.Vector3();

/**
 * Ângulo em que os sprites precisam ser girados pra encarar a câmera.
 *
 * Usa a direção pra onde a câmera olha, invertida — ou seja, alinha os sprites com a TELA, não com
 * o ponto da câmera. É o que evita que uma planta na beirada do campo de visão apareça torta.
 */
function cameraYaw(): number {
  camera.getWorldDirection(cameraForward);
  return Math.atan2(-cameraForward.x, -cameraForward.z);
}

interface Racer {
  label: string;
  color: number;
  isPlayer: boolean;
  controller: CarController;
  progress: RaceProgress;
}

/**
 * Monta a cena/pista compartilhada entre o modo solo e o multiplayer: luzes, fog, a pista em si
 * e a função de posicionamento em grid na largada. Retorna só o que os dois modos precisam.
 */
function initTrackScene(config: TrackConfig) {
  // Luz chapada: o SNES não tinha luz dinâmica nenhuma, então o ambiente vai quase no talo e o
  // "sol" fica só com o suficiente pra dar alguma leitura de volume. À noite o ambiente ainda sobe
  // um pouco pra pista não virar um breu entre um poste e outro (ver NIGHT_LAMP_LIGHT_EVERY).
  const ambientDay = VISUAL.flatLighting ? 0.9 : 0.6;
  const ambientNight = VISUAL.flatLighting ? 0.35 : 0.22;
  const sunDay = VISUAL.flatLighting ? 0.35 : 0.9;
  const sunNight = VISUAL.flatLighting ? 0.05 : 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, config.night ? ambientNight : ambientDay));
  const sun = new THREE.DirectionalLight(0xffffff, config.night ? sunNight : sunDay);
  sun.position.set(60, 100, 40);
  sun.castShadow = !VISUAL.flatLighting;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 300;
  scene.add(sun);

  // O fog fecha na cor do HORIZONTE do mapa, e os morros lá longe são pintados com essa mesma
  // cor — os dois viram uma faixa sólida só, com uma linha nítida contra o céu. É assim que o
  // horizonte do Top Gear se parece; fechar o fog na cor do céu dissolveria essa linha.
  // o céu é sempre um degradê; o que muda entre os temas é a QUANTIDADE de degraus dele —
  // poucos degraus viram bandas visíveis, muitos viram um degradê liso (ver VISUAL.skyBands)
  scene.background = createSkyTexture(config.skyColor, lightenColor(config.skyColor, 0.28));
  scene.fog = new THREE.Fog(config.horizonColor, config.night ? 60 : 110, config.night ? 220 : 400);

  // waypoints, índice/direção de largada e vagas da grid saem todos de `@shared/trackGeometry`,
  // via createTrack — é a MESMA fonte que o servidor usa no multiplayer
  const { waypoints, startIndex, startHeading, gridPosition, updateBillboards } = createTrack(
    scene,
    config
  );

  return { waypoints, startIdx: startIndex, startHeading, gridPosition, updateBillboards };
}

/** Modo solo: física 100% local, contra bots. */
function startGame(config: TrackConfig, carColor: number, playerName: string) {
  const { waypoints, startIdx, startHeading, gridPosition, updateBillboards } =
    initTrackScene(config);

  const carMesh = createCarMesh(carColor);
  carMesh.position.copy(gridPosition(0));
  carMesh.rotation.y = startHeading;
  scene.add(carMesh);

  const car = new CarController(carMesh, waypoints);
  car.heading = startHeading;

  const aiColors = [
    0x2266ee, 0xeedd22, 0x22aa66, 0x9b30d9, 0xff8c1a, 0xff4fa3, 0x22c2c2, 0x8a5a2b, 0x9aa0a6,
  ];
  const aiNames = [
    "Bot Azul",
    "Bot Amarelo",
    "Bot Verde",
    "Bot Roxo",
    "Bot Laranja",
    "Bot Rosa",
    "Bot Ciano",
    "Bot Marrom",
    "Bot Cinza",
  ];
  const aiCruiseThrottles = [0.88, 0.94, 1.0, 0.8, 0.86, 0.9, 0.96, 0.83, 0.78];
  const aiCars: AICarController[] = aiColors.map((color, i) => {
    const mesh = createCarMesh();
    (mesh.children[0] as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color });
    mesh.position.copy(gridPosition(i + 1));
    mesh.rotation.y = startHeading;
    scene.add(mesh);

    const ai = new AICarController(mesh, waypoints, (startIdx + 1) % waypoints.length, aiCruiseThrottles[i]);
    ai.heading = startHeading;
    return ai;
  });

  const racers: Racer[] = [
    {
      label: playerName,
      color: carColor,
      isPlayer: true,
      controller: car,
      progress: new RaceProgress(waypoints, startIdx, startIdx),
    },
    ...aiCars.map((ai, i) => ({
      label: aiNames[i],
      color: aiColors[i],
      isPlayer: false,
      controller: ai as CarController,
      progress: new RaceProgress(waypoints, startIdx, startIdx),
    })),
  ];

  const allCars: CarController[] = racers.map((r) => r.controller);

  const speedHud = createSpeedHud(car.maxSpeed * 6);
  const dashHud = createDashHud(isMobileDevice);
  const lapHud = createLapHud();
  const leaderboardHud = createLeaderboardHud(isMobileDevice);
  const minimap = createMinimap(waypoints);
  const positionBadge = createPositionBadge(isMobileDevice);
  const lapBanner = createLapBanner();
  const countdownOverlay = createCountdownOverlay();
  const victoryOverlay = createVictoryOverlay(() => window.location.reload());

  const playerRacer = racers[0];
  let raceOver = false;
  let raceStarted = false;

  // turbo e combustível do jogador. No solo tudo é local; no multiplayer o turbo é do servidor
  // (ver startMultiplayerGame), porque ele mexe na velocidade e a velocidade é autoritativa.
  let nitroCharges = NITRO_CHARGES;
  let nitroTimer = 0;
  let fuel = 1;

  // se o carro sair da pista, ele volta pro último ponto onde estava na pista (perde o "atalho")
  const OFF_TRACK_DISTANCE = ROAD_WIDTH / 2 + 4;
  const OFF_TRACK_GRACE = 0.5;
  let lastOnTrackPosition = carMesh.position.clone();
  let lastOnTrackHeading = car.heading;
  let offTrackTimer = 0;

  countdownOverlay.start(() => {
    raceStarted = true;
    racers.forEach((r) => r.progress.resetLapClock());
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (raceStarted && !raceOver) {
      // A/D estavam TROCADOS: a fisica faz `heading -= steer`, ou seja steer POSITIVO gira pro
      // lado da direita — entao o A (esquerda) mandando +1 virava pra direita. O controle mobile
      // ja seguia a convencao certa (arrastar pra direita = steer positivo), so o teclado nao.
      let steer = 0;
      if (keys.a) steer -= 1;
      if (keys.d) steer += 1;
      if (mobileInput.steer !== 0) steer = mobileInput.steer;

      if (takeNitroRequest() && nitroTimer <= 0 && nitroCharges > 0) {
        nitroCharges--;
        nitroTimer = NITRO_DURATION;
      }
      if (nitroTimer > 0) nitroTimer = Math.max(0, nitroTimer - dt);
      const nitroAtivo = nitroTimer > 0;

      const throttle = keys.w || mobileInput.throttle ? 1 : 0;
      car.update(dt, {
        throttle,
        brake: keys.s || mobileInput.brake ? 1 : 0,
        steer,
        nitro: nitroAtivo,
      });

      // o tanque só gasta com o pé no acelerador, e o turbo bebe bem mais
      const consumo = FUEL_DRAIN_PER_SECOND * (nitroAtivo ? FUEL_DRAIN_NITRO_MULTIPLIER : 1);
      if (throttle > 0) fuel = Math.max(0, fuel - consumo * dt);

      for (const ai of aiCars) {
        ai.updateAI(dt);
      }

      resolveCarCollisions(allCars);

      const nearest = findNearestWaypoint(carMesh.position.x, carMesh.position.z, waypoints);
      if (nearest.distance <= OFF_TRACK_DISTANCE) {
        lastOnTrackPosition.copy(carMesh.position);
        // usa a direção da PISTA nesse ponto (não a direção que o carro estava de fato apontando) —
        // senão, se o carro já estivesse de leve apontado pra fora quando saiu, a recuperação o
        // devolvia de volta na mesma direção errada e ele saía de novo imediatamente, em loop.
        const nextWp = waypoints[(nearest.index + 1) % waypoints.length];
        lastOnTrackHeading = Math.atan2(nextWp.x - carMesh.position.x, nextWp.z - carMesh.position.z);
        offTrackTimer = 0;
      } else {
        offTrackTimer += dt;
        if (offTrackTimer > OFF_TRACK_GRACE) {
          carMesh.position.copy(lastOnTrackPosition);
          car.heading = lastOnTrackHeading;
          carMesh.rotation.y = lastOnTrackHeading;
          car.speed = 0;
          car.bumpVelocity.set(0, 0);
          offTrackTimer = 0;
          lapBanner.show("FORA DA PISTA!");
        }
      }

      const playerLapBefore = playerRacer.progress.lapCount;
      for (const racer of racers) {
        racer.progress.update(racer.controller.mesh.position);
      }
      if (playerRacer.progress.lapCount > playerLapBefore && playerRacer.progress.lapCount < TOTAL_LAPS) {
        lapBanner.show(`VOLTA ${playerRacer.progress.lapCount + 1} DE ${TOTAL_LAPS}`);
      }

      const winner = racers.find((r) => r.progress.lapCount >= TOTAL_LAPS);
      if (winner) {
        raceOver = true;
        racers.forEach((r) => (r.progress.finished = true));
        victoryOverlay.show(winner.label, winner.color);
      }
    }

    speedHud.update(
      Math.abs(car.speed) * 6,
      raceStarted ? formatTime(playerRacer.progress.currentLapElapsed()) : "0'00\"00"
    );
    dashHud.update(gearForSpeed(car.speed), nitroCharges, nitroTimer > 0, fuel);
    lapHud.update(
      playerRacer.progress.lapCount,
      TOTAL_LAPS,
      playerRacer.progress.lastLapTime,
      playerRacer.progress.bestLapTime,
      formatTime
    );
    const sortedRacers = [...racers].sort((a, b) => b.progress.score() - a.progress.score());
    leaderboardHud.update(
      racers.map((r) => ({
        label: r.label,
        color: r.color,
        isPlayer: r.isPlayer,
        lapCount: r.progress.lapCount,
        score: r.progress.score(),
      }))
    );
    positionBadge.update(sortedRacers.indexOf(playerRacer) + 1);
    minimap.update(
      racers.map((r, i) => ({
        id: String(i),
        x: r.controller.mesh.position.x,
        z: r.controller.mesh.position.z,
        color: r.color,
        isPlayer: r.isPlayer,
      }))
    );

    const behind = new THREE.Vector3(
      Math.sin(car.heading) * -ART.camera.distance,
      ART.camera.height,
      Math.cos(car.heading) * -ART.camera.distance
    );
    const desiredCameraPos = carMesh.position.clone().add(behind);
    camera.position.lerp(desiredCameraPos, 1 - Math.pow(0.001, dt));
    camera.lookAt(
      carMesh.position.x,
      carMesh.position.y + ART.camera.lookAtHeight,
      carMesh.position.z
    );

    updateBillboards(cameraYaw());
    renderer.render(scene, camera);
  }

  animate();
}

/** Clareia uma cor misturando com branco — usado só pra base do degradê do céu. */
function lightenColor(color: number, amount: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), amount).getHex();
}

/** Interpola ângulos pelo caminho mais curto (evita o "giro errado" ao cruzar o limite -PI/PI). */
function lerpAngle(from: number, to: number, t: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

/**
 * Modo multiplayer: o SERVIDOR simula a física de todo mundo (autoritativo). O client só manda
 * input e desenha o que o servidor manda de volta — sem colisão nem recuperação de pista locais
 * ainda (o servidor não implementa isso por enquanto, é o próximo passo natural).
 *
 * Chamada UMA VEZ só, logo após criar/entrar na sala — a partir daí ela mesma controla a troca
 * entre sala de espera / contagem / corrida / vitória conforme `room.state.phase` muda, inclusive
 * quando o host reinicia e a sala volta pra "waiting" (reaproveitando a mesma cena 3D, sem
 * reconstruir a pista do zero a cada corrida).
 */
function startMultiplayerGame(config: TrackConfig, room: Room) {
  const { waypoints, startHeading, gridPosition, updateBillboards } = initTrackScene(config);

  const $ = getStateCallbacks(room);

  interface RemoteCar {
    mesh: THREE.Group;
    /** só o tempo de volta é local — quando a volta VIRA é decisão do servidor */
    lapClock: LapClock;
    /** espelhos dos campos autoritativos do servidor (CarState.lapCount / CarState.progress) */
    lapCount: number;
    score: number;
    label: string;
    color: number;
    isPlayer: boolean;
  }

  const cars = new Map<string, RemoteCar>();
  let localCar: RemoteCar | null = null;

  // último input já enviado, pra não repetir pacote idêntico a cada frame (ver o send lá embaixo)
  const sentInput = { throttle: -1, brake: -1, steer: -1 };
  function invalidateSentInput() {
    sentInput.throttle = -1;
    sentInput.brake = -1;
    sentInput.steer = -1;
  }

  const speedHud = createSpeedHud(MAX_SPEED * 6);
  const dashHud = createDashHud(isMobileDevice);
  const lapHud = createLapHud();

  // combustível é local até no multiplayer: hoje ele não tem efeito nenhum na física, então não
  // vale o custo de sincronizar. Se um dia acabar o tanque penalizar o carro, isso PRECISA virar
  // estado do servidor, senão cada client castiga o seu num momento diferente.
  let fuel = 1;
  const leaderboardHud = createLeaderboardHud(isMobileDevice);
  const minimap = createMinimap(waypoints);
  const positionBadge = createPositionBadge(isMobileDevice);
  const lapBanner = createLapBanner();
  const countdownOverlay = createCountdownOverlay();
  const victoryOverlay = createVictoryOverlay(() => window.location.reload());

  // a fase é sincronizada pelo servidor (room.state.phase) — os overlays aqui só reagem a ela
  let countdownShown = false;
  let wasRacing = false;
  let previousPhase: string | null = null;

  function isHost() {
    return room.sessionId === (room.state as any)?.hostSessionId;
  }

  function refreshLobby() {
    if (!(room.state as any)?.cars) return;
    const players = [...(room.state as any).cars.entries()].map(([id, c]: [string, any]) => ({
      id,
      name: c.name,
      color: c.color,
      isBot: c.isBot,
    }));
    lobbyScreen.update({
      code: room.roomId,
      players,
      isHost: isHost(),
      localId: room.sessionId,
      minRacers: MIN_RACERS,
      maxRacers: MAX_RACERS,
      onAddBot: () => room.send("addBot"),
      onStart: () => room.send("start"),
      onKick: (id: string) => room.send("kick", { id }),
    });
  }

  /** Troca a UI (lobby / countdown / vitória) sempre que `room.state.phase` muda de verdade. */
  function syncPhaseUI() {
    const state = room.state as any;
    if (!state) return;
    const phase = state.phase;

    if (phase === "waiting") {
      if (previousPhase !== "waiting") {
        // corrida nova na mesma sala — zera o que é local (o resto vem do servidor de novo)
        cars.forEach((r) => {
          r.lapClock.reset();
          r.lapCount = 0;
          r.score = 0;
        });
        victoryOverlay.hide();
      }
      lobbyScreen.show();
      refreshLobby();
    } else {
      lobbyScreen.hide();
    }

    if (phase === "finished" && previousPhase !== "finished") {
      const winner = cars.get(state.winnerId);
      if (winner) {
        victoryOverlay.show(winner.label, winner.color, {
          buttonLabel: isHost() ? "Reiniciar" : "Aguardando o Host...",
          disabled: !isHost(),
          onRestart: () => room.send("restart"),
        });
      }
    }

    previousPhase = phase;
  }

  room.onStateChange(syncPhaseUI);
  room.onLeave(() => {
    // única forma disso acontecer hoje é o host te remover da sala (não tem botão de "sair")
    alert("Você foi removido da sala.");
    window.location.reload();
  });

  $(room.state).cars.onAdd((carState: any, sessionId: string) => {
    const isPlayer = sessionId === room.sessionId;
    const mesh = createCarMesh(carState.color);
    // a vaga na grid é decidida pelo servidor. Antes o client chutava (0 pra si mesmo, cars.size+1
    // pros outros), o que dava vagas trocadas em relação ao servidor pra quem entrava depois.
    mesh.position.copy(gridPosition(carState.gridSlot));
    mesh.rotation.y = startHeading;
    scene.add(mesh);

    const entry: RemoteCar = {
      mesh,
      lapClock: new LapClock(),
      lapCount: 0,
      score: 0,
      label: carState.name,
      color: carState.color,
      isPlayer,
    };
    cars.set(sessionId, entry);
    if (isPlayer) {
      localCar = entry;
    }
    refreshLobby();
  });

  $(room.state).cars.onRemove((_carState: any, sessionId: string) => {
    const entry = cars.get(sessionId);
    if (entry) {
      scene.remove(entry.mesh);
      cars.delete(sessionId);
    }
    refreshLobby();
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    // o servidor é a autoridade — o client só copia a posição/direção de cada carro
    // (o state ainda pode não ter chegado no primeiro frame após o join, então checamos antes de iterar)
    if (!room.state?.cars) {
      renderer.render(scene, camera);
      return;
    }

    const phase = room.state.phase;
    if (phase === "countdown") {
      if (!countdownShown) {
        countdownShown = true;
        countdownOverlay.start(() => {});
      }
    } else {
      countdownShown = false;
    }
    const racing = phase === "racing";
    if (racing && !wasRacing) {
      cars.forEach((r) => r.lapClock.reset());
      fuel = 1;
      // o servidor zera throttle/brake/steer no spawn, então o cache de "já mandei isso" tem que
      // ser invalidado junto — senão um input que não mudou desde a corrida anterior nunca sairia
      invalidateSentInput();
    }
    wasRacing = racing;

    if (racing && localCar) {
      // A/D estavam TROCADOS: a fisica faz `heading -= steer`, ou seja steer POSITIVO gira pro
      // lado da direita — entao o A (esquerda) mandando +1 virava pra direita. O controle mobile
      // ja seguia a convencao certa (arrastar pra direita = steer positivo), so o teclado nao.
      let steer = 0;
      if (keys.a) steer -= 1;
      if (keys.d) steer += 1;
      if (mobileInput.steer !== 0) steer = mobileInput.steer;

      // o turbo é decidido pelo SERVIDOR (mexe na velocidade, que é autoritativa) — o client só
      // avisa que o jogador apertou, e lê de volta quantas cargas sobraram
      if (takeNitroRequest()) room.send("nitro");

      const throttle = keys.w || mobileInput.throttle ? 1 : 0;
      const brake = keys.s || mobileInput.brake ? 1 : 0;

      // só manda quando o input MUDA. Antes saía um pacote por frame (60/s por jogador, ~600/s numa
      // sala cheia) repetindo o mesmo valor à toa — o WebSocket é confiável e ordenado, então o
      // servidor simplesmente segue com o último valor recebido até chegar um diferente.
      if (throttle !== sentInput.throttle || brake !== sentInput.brake || steer !== sentInput.steer) {
        sentInput.throttle = throttle;
        sentInput.brake = brake;
        sentInput.steer = steer;
        room.send("input", { throttle, brake, steer });
      }
    }
    // o servidor manda posição a 30Hz (patchRate ajustado, ver RaceRoom.onCreate) mas a gente
    // renderiza a 60fps — copiar a posição direto faz o carro (e a câmera, que mira nele) "degrau"
    // a cada pacote novo. Suaviza em direção ao valor mais recente em vez de saltar pra ele —
    // rápido o bastante pra não sentir como atraso, devagar o bastante pra não tremer.
    const posT = Math.min(1, dt * 22);
    room.state.cars.forEach((carState: any, sessionId: string) => {
      const entry = cars.get(sessionId);
      if (!entry) return;
      entry.mesh.position.x = THREE.MathUtils.lerp(entry.mesh.position.x, carState.x, posT);
      entry.mesh.position.z = THREE.MathUtils.lerp(entry.mesh.position.z, carState.z, posT);
      entry.mesh.position.y = elevationAt(entry.mesh.position.x, entry.mesh.position.z);
      entry.mesh.rotation.y = lerpAngle(entry.mesh.rotation.y, carState.heading, posT);

      // volta e ranking chegam PRONTOS do servidor — o client não reconta nada, só espelha
      if (carState.lapCount > entry.lapCount) {
        entry.lapClock.completeLap();
        if (entry.isPlayer && carState.lapCount < TOTAL_LAPS) {
          lapBanner.show(`VOLTA ${carState.lapCount + 1} DE ${TOTAL_LAPS}`);
        }
      }
      entry.lapCount = carState.lapCount;
      entry.score = carState.progress;
    });

    if (localCar) {
      const localState = room.state.cars.get(room.sessionId);
      const localSpeed = localState ? localState.speed : 0;
      speedHud.update(
        Math.abs(localSpeed) * 6,
        racing ? formatTime(localCar.lapClock.currentElapsed()) : "0'00\"00"
      );

      const nitroAtivo = localState ? localState.nitroActive === true : false;
      if (racing && Math.abs(localSpeed) > 0.1) {
        const consumo = FUEL_DRAIN_PER_SECOND * (nitroAtivo ? FUEL_DRAIN_NITRO_MULTIPLIER : 1);
        fuel = Math.max(0, fuel - consumo * dt);
      }
      dashHud.update(
        gearForSpeed(localSpeed),
        localState ? localState.nitroCharges : 0,
        nitroAtivo,
        fuel
      );
      lapHud.update(
        localCar.lapCount,
        TOTAL_LAPS,
        localCar.lapClock.lastLapTime,
        localCar.lapClock.bestLapTime,
        formatTime
      );
      const carList = [...cars.values()];
      const sorted = [...carList].sort((a, b) => b.score - a.score);
      leaderboardHud.update(
        carList.map((r) => ({
          label: r.label,
          color: r.color,
          isPlayer: r.isPlayer,
          lapCount: r.lapCount,
          score: r.score,
        }))
      );
      positionBadge.update(sorted.indexOf(localCar) + 1);
      minimap.update(
        [...cars.entries()].map(([id, r]) => ({
          id,
          x: r.mesh.position.x,
          z: r.mesh.position.z,
          color: r.color,
          isPlayer: r.isPlayer,
        }))
      );

      const behind = new THREE.Vector3(
        Math.sin(localCar.mesh.rotation.y) * -ART.camera.distance,
        ART.camera.height,
        Math.cos(localCar.mesh.rotation.y) * -ART.camera.distance
      );
      const desiredCameraPos = localCar.mesh.position.clone().add(behind);
      camera.position.lerp(desiredCameraPos, 1 - Math.pow(0.001, dt));
      camera.lookAt(
        localCar.mesh.position.x,
        localCar.mesh.position.y + ART.camera.lookAtHeight,
        localCar.mesh.position.z
      );
    }

    updateBillboards(cameraYaw());
    renderer.render(scene, camera);
  }

  syncPhaseUI(); // aplica o estado atual já de cara (a sala pode já ter chegado com state populado)
  animate();
}

const CAR_OPTIONS = [
  { id: "branco", name: "Branco", color: 0xe8e8e8 },
  { id: "vermelho", name: "Vermelho", color: 0xd4342c },
  { id: "azul", name: "Azul", color: 0x2266ee },
  { id: "amarelo", name: "Amarelo", color: 0xeedd22 },
  { id: "verde", name: "Verde", color: 0x22aa66 },
  { id: "preto", name: "Preto", color: 0x1a1a1a },
];

const loadingScreen = createLoadingScreen();
const lobbyScreen = createLobbyScreen();

const mapOptions = TRACK_PRESETS.map((p) => ({ id: p.id, name: p.name }));

/** Solo: mapa -> carro -> nome -> jogo (mesma ordem de sempre). */
function startSoloFlow() {
  createMapSelectScreen(mapOptions, (mapId) => {
    const config = TRACK_PRESETS.find((p) => p.id === mapId) ?? TRACK_PRESETS[0];
    createCarSelectScreen(CAR_OPTIONS, (carId) => {
      const carOption = CAR_OPTIONS.find((c) => c.id === carId) ?? CAR_OPTIONS[0];
      createNameEntryScreen((name) => {
        loadingScreen.show();
        // setTimeout (não rAF) pra garantir que a tela de loading realmente pintou antes de
        // travar a thread principal com o trabalho síncrono pesado de montar a pista — rAF sozinho
        // pode nunca disparar se a aba perder foco bem nesse instante
        window.setTimeout(() => {
          startGame(config, carOption.color, name);
          loadingScreen.hide();
        }, 50);
      });
    });
  });
}

/**
 * Multiplayer: carro -> nome -> criar sala (aí sim escolhe o mapa) OU entrar com código (o mapa
 * já vem do host, então nem pergunta).
 */
function startMultiplayerFlow() {
  createCarSelectScreen(CAR_OPTIONS, (carId) => {
    const carOption = CAR_OPTIONS.find((c) => c.id === carId) ?? CAR_OPTIONS[0];
    createNameEntryScreen((name) => {
      createOnlineChoiceScreen(
        () => {
          createMapSelectScreen(mapOptions, (mapId) => {
            const config = TRACK_PRESETS.find((p) => p.id === mapId) ?? TRACK_PRESETS[0];
            loadingScreen.setText("Criando sala...");
            loadingScreen.show();
            createLobby(name, carOption.color, config.id)
              .then((room) => {
                startMultiplayerGame(config, room);
                loadingScreen.hide();
              })
              .catch((err) => {
                console.error("Falha ao criar sala:", err);
                loadingScreen.hide();
                alert("Não foi possível criar a sala. Verifique se o servidor está rodando.");
              });
          });
        },
        () => {
          createCodeEntryScreen((code) => {
            loadingScreen.setText("Entrando na sala...");
            loadingScreen.show();
            joinLobby(code, name, carOption.color)
              .then((room) => {
                // quem entra por código não escolhe o mapa — usa o que o host já definiu
                const actualConfig =
                  TRACK_PRESETS.find((p) => p.id === (room.state as any).mapId) ?? TRACK_PRESETS[0];
                startMultiplayerGame(actualConfig, room);
                loadingScreen.hide();
              })
              .catch((err) => {
                console.error("Falha ao entrar na sala:", err);
                loadingScreen.hide();
                alert("Não foi possível entrar na sala. Confira o código com quem criou.");
              });
          });
        }
      );
    });
  });
}

createModeSelectScreen((mode) => {
  if (mode === "solo") startSoloFlow();
  else startMultiplayerFlow();
});
