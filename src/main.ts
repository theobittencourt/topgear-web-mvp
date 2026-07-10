import * as THREE from "three";
import { createTrack, ROAD_WIDTH, findNearestWaypoint } from "./track";
import { createCarMesh, CarController, AICarController } from "./car";
import { resolveCarCollisions } from "./collision";
import { RaceProgress, formatTime } from "./raceTimer";
import {
  createSpeedHud,
  createLapHud,
  createLeaderboardHud,
  createLapBanner,
  createCountdownOverlay,
  createVictoryOverlay,
  createNameEntryScreen,
  createMinimap,
  createPositionBadge,
} from "./ui";

const TOTAL_LAPS = 3;

const app = document.getElementById("app")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 100, 380);

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

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
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

const { startPosition, waypoints } = createTrack(scene);

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

interface Racer {
  label: string;
  color: number;
  isPlayer: boolean;
  controller: CarController;
  progress: RaceProgress;
}

const startIdx = closestWaypointIndex(startPosition);
const startHeading = headingTowards(startPosition, waypoints[(startIdx + 1) % waypoints.length]);
// vetor lateral (perpendicular ao sentido da pista) pra alinhar os carros lado a lado na largada
const lateral = new THREE.Vector3(Math.cos(startHeading), 0, -Math.sin(startHeading));
const gridOffsets = [-6, -2, 2, 6];

function gridPosition(offset: number): THREE.Vector3 {
  return startPosition.clone().add(lateral.clone().multiplyScalar(offset));
}

const carMesh = createCarMesh();
carMesh.position.copy(gridPosition(gridOffsets[0]));
carMesh.rotation.y = startHeading;
scene.add(carMesh);

const car = new CarController(carMesh, waypoints);
car.heading = startHeading;

const aiColors = [0x2266ee, 0xeedd22, 0x22aa66];
const aiNames = ["Bot Azul", "Bot Amarelo", "Bot Verde"];
const aiCruiseThrottles = [0.88, 0.94, 1.0];
const aiCars: AICarController[] = aiColors.map((color, i) => {
  const mesh = createCarMesh();
  (mesh.children[0] as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color });
  mesh.position.copy(gridPosition(gridOffsets[i + 1]));
  mesh.rotation.y = startHeading;
  scene.add(mesh);

  const ai = new AICarController(mesh, waypoints, (startIdx + 1) % waypoints.length, aiCruiseThrottles[i]);
  ai.heading = startHeading;
  return ai;
});

const racers: Racer[] = [
  {
    label: "JOGADOR",
    color: 0xe8e8e8,
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

const keys = { w: false, a: false, s: false, d: false };
window.addEventListener("keydown", (e) => setKey(e.key, true));
window.addEventListener("keyup", (e) => setKey(e.key, false));

function setKey(key: string, value: boolean) {
  const k = key.toLowerCase();
  if (k === "w" || k === "a" || k === "s" || k === "d") keys[k] = value;
}

const speedHud = createSpeedHud(car.maxSpeed * 6);
const lapHud = createLapHud();
const leaderboardHud = createLeaderboardHud();
const minimap = createMinimap(waypoints);
const positionBadge = createPositionBadge();
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

createNameEntryScreen((name) => {
  playerRacer.label = name;
  countdownOverlay.start(() => {
    raceStarted = true;
    racers.forEach((r) => r.progress.resetLapClock());
  });
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (raceStarted && !raceOver) {
    let steer = 0;
    if (keys.a) steer += 1;
    if (keys.d) steer -= 1;

    car.update(dt, {
      throttle: keys.w ? 1 : 0,
      brake: keys.s ? 1 : 0,
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
