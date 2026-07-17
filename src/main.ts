import * as THREE from "three";
import { createTrack, elevationAt, ROAD_WIDTH, findNearestWaypoint, TRACK_PRESETS } from "./track";
import type { TrackConfig } from "./track";
import { createCarMesh, CarController, AICarController } from "./car";
import { resolveCarCollisions } from "./collision";
import { RaceProgress, formatTime } from "./raceTimer";
import { createLobby, joinLobby, getStateCallbacks } from "./network";
import type { Room } from "colyseus.js";
import {
  createSpeedHud,
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

const TOTAL_LAPS = 3;

const app = document.getElementById("app")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  700
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

document.body.style.setProperty("user-select", "none");
document.body.style.setProperty("-webkit-user-select", "none");
document.body.style.setProperty("-moz-user-select", "none");
document.body.style.setProperty("-ms-user-select", "none");

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// input compartilhado entre o modo solo e o multiplayer (captura de teclado + controles mobile)
const keys = { w: false, a: false, s: false, d: false };
const mobileInput = { throttle: false, brake: false, steer: 0 };
const isMobileDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

if (isMobileDevice) {
  createMobileControls((state) => {
    mobileInput.throttle = state.throttle;
    mobileInput.brake = state.brake;
    mobileInput.steer = state.steer;
  });
}

window.addEventListener("keydown", (e) => setKey(e.key, true));
window.addEventListener("keyup", (e) => setKey(e.key, false));

function setKey(key: string, value: boolean) {
  const k = key.toLowerCase();
  if (k === "w" || k === "a" || k === "s" || k === "d") keys[k] = value;
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
  scene.add(new THREE.AmbientLight(0xffffff, config.night ? 0.15 : 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, config.night ? 0.08 : 0.9);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 300;
  scene.add(sun);

  scene.background = new THREE.Color(config.night ? 0x0a0e1f : 0x87ceeb);
  scene.fog = new THREE.Fog(config.night ? 0x0a0e1f : 0x87ceeb, config.night ? 60 : 100, config.night ? 220 : 380);

  const { startPosition, waypoints } = createTrack(scene, config);

  function closestWaypointIndex(position: THREE.Vector3): number {
    let best = 0;
    let bestDist = Infinity;
    waypoints.forEach((p, i) => {
      const d = p.distanceTo(position);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  function headingTowards(from: THREE.Vector3, to: THREE.Vector3): number {
    return Math.atan2(to.x - from.x, to.z - from.z);
  }

  const startIdx = closestWaypointIndex(startPosition);
  const startHeading = headingTowards(startPosition, waypoints[(startIdx + 1) % waypoints.length]);
  // vetor lateral (perpendicular ao sentido da pista) pra alinhar os carros lado a lado na largada
  const lateral = new THREE.Vector3(Math.cos(startHeading), 0, -Math.sin(startHeading));
  const forward = new THREE.Vector3(Math.sin(startHeading), 0, Math.cos(startHeading));

  // grid em duas colunas x várias fileiras (não cabem 10 carros lado a lado numa pista só)
  const GRID_COLS = [-6, 6];
  const GRID_ROW_SPACING = 7;

  function gridPosition(slot: number): THREE.Vector3 {
    const col = GRID_COLS[slot % GRID_COLS.length];
    const row = Math.floor(slot / GRID_COLS.length);
    return startPosition
      .clone()
      .add(lateral.clone().multiplyScalar(col))
      .add(forward.clone().multiplyScalar(-row * GRID_ROW_SPACING));
  }

  return { waypoints, startIdx, startHeading, gridPosition };
}

/** Modo solo: física 100% local, contra bots. */
function startGame(config: TrackConfig, carColor: number, playerName: string) {
  const { waypoints, startIdx, startHeading, gridPosition } = initTrackScene(config);

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
      let steer = 0;
      if (keys.a) steer += 1;
      if (keys.d) steer -= 1;
      if (mobileInput.steer !== 0) steer = mobileInput.steer;

      car.update(dt, {
        throttle: keys.w || mobileInput.throttle ? 1 : 0,
        brake: keys.s || mobileInput.brake ? 1 : 0,
        steer,
      });

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
      Math.sin(car.heading) * -10,
      4.5,
      Math.cos(car.heading) * -10
    );
    const desiredCameraPos = carMesh.position.clone().add(behind);
    camera.position.lerp(desiredCameraPos, 1 - Math.pow(0.001, dt));
    camera.lookAt(
      carMesh.position.x,
      carMesh.position.y + 1,
      carMesh.position.z
    );

    renderer.render(scene, camera);
  }

  animate();
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
  const { waypoints, startIdx, startHeading, gridPosition } = initTrackScene(config);

  const $ = getStateCallbacks(room);

  interface RemoteCar {
    mesh: THREE.Group;
    progress: RaceProgress;
    label: string;
    color: number;
    isPlayer: boolean;
  }

  const cars = new Map<string, RemoteCar>();
  let localCar: RemoteCar | null = null;

  const speedHud = createSpeedHud(38 * 6); // 38 = MAX_SPEED do servidor, ver server/src/rooms/RaceRoom.ts
  const lapHud = createLapHud();
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
      minRacers: 5,
      maxRacers: 10,
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
        // corrida nova na mesma sala — zera o progresso local de todo mundo
        cars.forEach((r) => {
          r.progress = new RaceProgress(waypoints, startIdx, startIdx);
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
    mesh.position.copy(isPlayer ? gridPosition(0) : gridPosition(cars.size + 1));
    mesh.rotation.y = startHeading;
    scene.add(mesh);

    const entry: RemoteCar = {
      mesh,
      progress: new RaceProgress(waypoints, startIdx, startIdx),
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
      cars.forEach((r) => r.progress.resetLapClock());
    }
    wasRacing = racing;

    if (racing && localCar) {
      let steer = 0;
      if (keys.a) steer += 1;
      if (keys.d) steer -= 1;
      if (mobileInput.steer !== 0) steer = mobileInput.steer;

      room.send("input", {
        throttle: keys.w || mobileInput.throttle ? 1 : 0,
        brake: keys.s || mobileInput.brake ? 1 : 0,
        steer,
      });
    }

    const localLapBefore = localCar?.progress.lapCount ?? 0;
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
      if (racing) {
        entry.progress.update(entry.mesh.position);
      }
    });
    if (
      localCar &&
      localCar.progress.lapCount > localLapBefore &&
      localCar.progress.lapCount < TOTAL_LAPS
    ) {
      lapBanner.show(`VOLTA ${localCar.progress.lapCount + 1} DE ${TOTAL_LAPS}`);
    }

    if (localCar) {
      const localState = room.state.cars.get(room.sessionId);
      speedHud.update(
        localState ? Math.abs(localState.speed) * 6 : 0,
        racing ? formatTime(localCar.progress.currentLapElapsed()) : "0'00\"00"
      );
      lapHud.update(
        localCar.progress.lapCount,
        TOTAL_LAPS,
        localCar.progress.lastLapTime,
        localCar.progress.bestLapTime,
        formatTime
      );
      const carList = [...cars.values()];
      const sorted = [...carList].sort((a, b) => b.progress.score() - a.progress.score());
      leaderboardHud.update(
        carList.map((r) => ({
          label: r.label,
          color: r.color,
          isPlayer: r.isPlayer,
          lapCount: r.progress.lapCount,
          score: r.progress.score(),
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
        Math.sin(localCar.mesh.rotation.y) * -10,
        4.5,
        Math.cos(localCar.mesh.rotation.y) * -10
      );
      const desiredCameraPos = localCar.mesh.position.clone().add(behind);
      camera.position.lerp(desiredCameraPos, 1 - Math.pow(0.001, dt));
      camera.lookAt(localCar.mesh.position.x, localCar.mesh.position.y + 1, localCar.mesh.position.z);
    }

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
