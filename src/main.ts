import * as THREE from "three";
import { createTrack } from "./track";
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

const car = new CarController(carMesh);
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
    label: "Você",
    color: 0xd4342c,
    isPlayer: true,
    controller: car,
    progress: new RaceProgress(waypoints, startIdx),
  },
  ...aiCars.map((ai, i) => ({
    label: aiNames[i],
    color: aiColors[i],
    isPlayer: false,
    controller: ai as CarController,
    progress: new RaceProgress(waypoints, startIdx),
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

const speedHud = createSpeedHud();
const lapHud = createLapHud();
const leaderboardHud = createLeaderboardHud();
const lapBanner = createLapBanner();
const countdownOverlay = createCountdownOverlay();
const victoryOverlay = createVictoryOverlay(() => window.location.reload());

const playerRacer = racers[0];
let raceOver = false;
let raceStarted = false;

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

    car.update(dt, {
      throttle: keys.w ? 1 : 0,
      brake: keys.s ? 1 : 0,
      steer,
    });

    for (const ai of aiCars) {
      ai.updateAI(dt);
    }

    resolveCarCollisions(allCars);

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

  speedHud.update(Math.abs(car.speed) * 6);
  lapHud.update(
    playerRacer.progress.lapCount,
    TOTAL_LAPS,
    playerRacer.progress.currentLapElapsed(),
    playerRacer.progress.lastLapTime,
    playerRacer.progress.bestLapTime,
    formatTime
  );
  leaderboardHud.update(
    racers.map((r) => ({
      label: r.label,
      color: r.color,
      isPlayer: r.isPlayer,
      lapCount: r.progress.lapCount,
      score: r.progress.score(),
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
