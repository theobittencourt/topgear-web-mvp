/**
 * Corrida offline: 1 ou 2 jogadores no mesmo computador, contra bots.
 *
 * É UM código só pros dois modos. O que o solo e o local têm de diferente está todo na MONTAGEM da
 * sessão (quantos jogadores locais, quais inputs, qual divisão de tela, qual regra de fim) e não
 * espalhado em `if (modo === "local")`:
 *
 *   solo  → players.length === 1, tela cheia, acaba no primeiro a completar as voltas
 *   local → players.length === 2, tela dividida, acaba quando os dois humanos terminam
 *
 * O multiplayer online NÃO passa por aqui: lá o servidor é a autoridade e o client só desenha o
 * que chega (ver `startMultiplayerGame` no main).
 */

import * as THREE from "three";
import { createCarMesh, CarController } from "../car";
import { resolveCarCollisions } from "../collision";
import { RaceProgress, formatTime } from "../raceTimer";
import { findNearestWaypoint, ROAD_WIDTH } from "../track";
import type { TrackConfig } from "../track";
import { ART } from "../retro";
import { renderer } from "../renderer";
import { createRaceScene } from "./scene";
import { createViews, cameraYaw } from "./viewports";
import type { PlayerView, SplitLayout } from "./viewports";
import {
  HumanInput,
  BotInput,
  PAUSE_KEYS,
  setKeyboardCapture,
  takeKeyPulse,
  clearKeyPulses,
} from "../input";
import type { InputSource, Keymap } from "../input";
import { createPlayerHud, createCountdownOverlay, createPauseOverlay } from "../ui";
import type { PlayerHud, RacerDisplay, MinimapDot } from "../ui";
import { createEngineSound, playCrash, playNitroWhoosh } from "../audio";
import type { EngineSound } from "../audio";
import {
  MAX_SPEED,
  NITRO_CHARGES,
  NITRO_DURATION,
  FUEL_DRAIN_PER_SECOND,
  FUEL_DRAIN_NITRO_MULTIPLIER,
  gearForSpeed,
} from "@shared/physics";
import { TOTAL_LAPS } from "@shared/rules";

export interface LocalPlayerSetup {
  label: string;
  color: number;
  keymap: Keymap;
  /** etiqueta mostrada na metade da tela dele ("P1"/"P2"); sem isso, nenhuma etiqueta aparece */
  tag?: string;
  /** lê também os controles de toque (jogador único no celular) */
  mobile?: boolean;
  /** índice do controle de videogame deste jogador */
  gamepadIndex?: number;
}

export interface RaceStanding {
  label: string;
  color: number;
  place: number;
  lapCount: number;
  totalTimeMs: number | null;
  bestLapMs: number | null;
  tag?: string;
}

export interface OfflineRaceOptions {
  config: TrackConfig;
  players: LocalPlayerSetup[];
  /** quantos bots entram na grid junto */
  botCount: number;
  layout?: SplitLayout;
  /**
   * `firstFinisher` — acaba quando QUALQUER UM completa as voltas (é como o solo sempre foi).
   * `allHumans` — acaba quando todos os humanos terminam (ou no timeout), que é o que faz sentido
   * com dois jogadores: o segundo não perde a corrida porque o primeiro chegou.
   */
  endRule: "firstFinisher" | "allHumans";
  /** com `allHumans`: tempo máximo, em segundos, esperando os retardatários depois do 1º humano */
  finishTimeoutSeconds?: number;
  /** quem chamou decide a tela de fim (overlay de vitória no solo, classificação no local) */
  onRaceEnd(standings: RaceStanding[]): void;
}

export interface RaceSession {
  dispose(): void;
}

const BOT_COLORS = [
  0x2266ee, 0xeedd22, 0x22aa66, 0x9b30d9, 0xff8c1a, 0xff4fa3, 0x22c2c2, 0x8a5a2b, 0x9aa0a6,
];
const BOT_NAMES = [
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
const BOT_CRUISE_THROTTLES = [0.88, 0.94, 1.0, 0.8, 0.86, 0.9, 0.96, 0.83, 0.78];

/** máximo de bots que a lista de cores/nomes suporta */
export const MAX_BOTS = BOT_COLORS.length;

/** se o carro sair da pista, ele volta pro último ponto onde estava nela (perde o "atalho") */
const OFF_TRACK_DISTANCE = ROAD_WIDTH / 2 + 4;
const OFF_TRACK_GRACE = 0.5;

/** HUD de tela dividida encolhe junto com a metade (ver `createPlayerHud`) */
const SPLIT_HUD_SCALE = 0.7;

interface HumanState {
  index: number;
  view: PlayerView;
  hud: PlayerHud;
  engine: EngineSound | null;
  nitroCharges: number;
  nitroTimer: number;
  fuel: number;
  lastLapCount: number;
  offTrackPosition: THREE.Vector3;
  offTrackHeading: number;
  offTrackTimer: number;
  finished: boolean;
}

interface Racer {
  label: string;
  color: number;
  tag?: string;
  controller: CarController;
  input: InputSource;
  progress: RaceProgress;
  /** null = bot */
  human: HumanState | null;
}

export function startOfflineRace(opts: OfflineRaceOptions): RaceSession {
  const { config, players, botCount, endRule } = opts;
  const split = players.length > 1;
  const layout: SplitLayout = opts.layout ?? "horizontal";

  const raceScene = createRaceScene(config);
  const { scene, waypoints, startIdx, startHeading, gridPosition, updateBillboards } = raceScene;
  const viewports = createViews(players.length, layout);

  const racers: Racer[] = [];

  // ---- jogadores humanos: largam em vagas vizinhas (0 e 1 são a mesma fileira, lado a lado) ----
  players.forEach((setup, index) => {
    const mesh = createCarMesh(setup.color);
    mesh.position.copy(gridPosition(index));
    mesh.rotation.y = startHeading;
    scene.add(mesh);

    const controller = new CarController(mesh);
    controller.heading = startHeading;

    const view = viewports.views[index];
    const hud = createPlayerHud(view.overlay, {
      maxSpeedKmh: MAX_SPEED * 6,
      waypoints,
      tag: split ? setup.tag : undefined,
      tagColor: setup.color,
      scale: split ? SPLIT_HUD_SCALE : 1,
      mobile: setup.mobile,
    });

    // Áudio: um motor por jogador. No split lado a lado cada um sai do seu lado da caixa (é a
    // única pista sonora de qual metade é a sua); no cima/baixo pan não significaria nada, então
    // os dois ficam no centro com volume menor — dois motores no talo juntos saturam.
    const pan = split && layout === "vertical" ? (index === 0 ? -0.65 : 0.65) : 0;
    const engine = createEngineSound({ pan, volume: split ? 0.5 : 0.85 });

    racers.push({
      label: setup.label,
      color: setup.color,
      tag: setup.tag,
      controller,
      input: new HumanInput(setup.keymap, {
        mobile: setup.mobile,
        gamepadIndex: setup.gamepadIndex,
      }),
      progress: new RaceProgress(waypoints, startIdx, startIdx),
      human: {
        index,
        view,
        hud,
        engine,
        nitroCharges: NITRO_CHARGES,
        nitroTimer: 0,
        fuel: 1,
        lastLapCount: 0,
        offTrackPosition: mesh.position.clone(),
        offTrackHeading: startHeading,
        offTrackTimer: 0,
        finished: false,
      },
    });
  });

  // ---- bots ----
  const bots = Math.max(0, Math.min(botCount, MAX_BOTS));
  for (let i = 0; i < bots; i++) {
    const mesh = createCarMesh();
    (mesh.children[0] as THREE.Mesh).material = new THREE.MeshStandardMaterial({
      color: BOT_COLORS[i],
    });
    mesh.position.copy(gridPosition(players.length + i));
    mesh.rotation.y = startHeading;
    scene.add(mesh);

    const controller = new CarController(mesh);
    controller.heading = startHeading;

    racers.push({
      label: BOT_NAMES[i],
      color: BOT_COLORS[i],
      controller,
      input: new BotInput(
        controller,
        waypoints,
        (startIdx + 1) % waypoints.length,
        BOT_CRUISE_THROTTLES[i]
      ),
      progress: new RaceProgress(waypoints, startIdx, startIdx),
      human: null,
    });
  }

  const allCars = racers.map((r) => r.controller);
  const humans = racers.filter((r) => r.human !== null);

  const countdownOverlay = createCountdownOverlay();
  const pauseOverlay = createPauseOverlay();

  let raceStarted = false;
  let raceOver = false;
  let paused = false;
  let finishedCount = 0;
  let firstHumanFinishAt: number | null = null;

  setKeyboardCapture(true);
  countdownOverlay.start(() => {
    raceStarted = true;
    racers.forEach((r) => r.progress.resetLapClock());
  });

  // ---- medição de performance, só com ?stats=1 na URL (ver PROJETO.md) ----
  const showStats = new URLSearchParams(window.location.search).has("stats");
  let statsFrames = 0;
  let statsElapsed = 0;
  let statsCpuMs = 0;
  // o three.js zera o `info` a cada `render()`. Na tela dividida são DOIS por frame, então sem
  // desligar o reset automático a conta mostraria só o segundo passe — metade da verdade.
  if (showStats) renderer.info.autoReset = false;

  function togglePause() {
    if (raceOver) return;
    paused = !paused;
    if (paused) pauseOverlay.show();
    else pauseOverlay.hide();
    // sem isto, o Esc/P que pausou (ou qualquer turbo apertado durante a pausa) dispararia no
    // frame em que a corrida volta
    clearKeyPulses();
    for (const racer of humans) racer.human!.engine?.setMuted(paused);
  }

  function endRace() {
    if (raceOver) return;
    raceOver = true;
    for (const racer of humans) racer.human!.engine?.setMuted(true);
    opts.onRaceEnd(standings());
  }

  /** Classificação: quem terminou pela ordem de chegada, o resto pelo progresso na pista. */
  function standings(): RaceStanding[] {
    const finished = racers
      .filter((r) => r.progress.finishPlace !== null)
      .sort((a, b) => a.progress.finishPlace! - b.progress.finishPlace!);
    const rest = racers
      .filter((r) => r.progress.finishPlace === null)
      .sort((a, b) => b.progress.score() - a.progress.score());

    return [...finished, ...rest].map((racer, i) => ({
      label: racer.label,
      color: racer.color,
      place: i + 1,
      lapCount: racer.progress.lapCount,
      totalTimeMs: racer.progress.totalTime,
      bestLapMs: racer.progress.bestLapTime,
      tag: racer.tag,
    }));
  }

  function finishRacer(racer: Racer) {
    racer.progress.finish(++finishedCount);

    const human = racer.human;
    if (human) {
      human.finished = true;
      // só na tela dividida: com um jogador só, a tela de fim de corrida entra em cima na mesma
      // hora e o painel ficaria meio escondido atrás dela
      if (split) human.hud.showFinish(racer.progress.finishPlace!);
      human.engine?.setMuted(true);
      if (firstHumanFinishAt === null) firstHumanFinishAt = performance.now();

      // O carro de quem chegou passa pra IA em vez de parar no meio da pista: vira obstáculo
      // ruim pro outro jogador, e a metade da tela dele continua mostrando corrida em movimento.
      // É o mesmo `BotInput` dos bots — o carro não sabe quem está dirigindo.
      const nearest = findNearestWaypoint(
        racer.controller.mesh.position.x,
        racer.controller.mesh.position.z,
        waypoints
      );
      racer.input = new BotInput(racer.controller, waypoints, nearest.index + 1, 0.8);
    }
  }

  function step(dt: number) {
    for (const racer of racers) {
      const controls = racer.input.getControls(dt);
      const human = racer.human;

      let nitroActive = false;
      if (human) {
        if (controls.nitro && human.nitroTimer <= 0 && human.nitroCharges > 0) {
          human.nitroCharges--;
          human.nitroTimer = NITRO_DURATION;
          playNitroWhoosh(panOf(human));
        }
        if (human.nitroTimer > 0) human.nitroTimer = Math.max(0, human.nitroTimer - dt);
        nitroActive = human.nitroTimer > 0;

        // o tanque só gasta com o pé no acelerador, e o turbo bebe bem mais
        if (controls.throttle > 0) {
          const consumo =
            FUEL_DRAIN_PER_SECOND * (nitroActive ? FUEL_DRAIN_NITRO_MULTIPLIER : 1);
          human.fuel = Math.max(0, human.fuel - consumo * dt);
        }
      }

      racer.controller.update(dt, {
        throttle: controls.throttle,
        brake: controls.brake,
        steer: controls.steer,
        nitro: nitroActive,
      });
    }

    const hits = resolveCarCollisions(allCars);
    for (const hit of hits) {
      // batida toca pra QUEM bateu: só interessa quando um dos dois carros é de jogador humano
      for (const index of [hit.a, hit.b]) {
        const human = racers[index].human;
        if (human) playCrash(panOf(human), hit.overlap);
      }
    }

    for (const racer of humans) recoverOffTrack(racer, dt);

    for (const racer of racers) {
      const before = racer.progress.lapCount;
      racer.progress.update(racer.controller.mesh.position);

      const human = racer.human;
      if (human && racer.progress.lapCount > before && racer.progress.lapCount < TOTAL_LAPS) {
        human.hud.banner(`VOLTA ${racer.progress.lapCount + 1} DE ${TOTAL_LAPS}`);
      }

      if (!racer.progress.finished && racer.progress.lapCount >= TOTAL_LAPS) {
        finishRacer(racer);
      }
    }

    if (endRule === "firstFinisher") {
      if (finishedCount > 0) endRace();
      return;
    }

    // `allHumans`: o timeout evita que um jogador que desistiu (ou travou) prenda o outro na tela
    // de corrida pra sempre.
    const pending = humans.filter((r) => !r.human!.finished);
    if (pending.length === 0) {
      endRace();
    } else if (
      firstHumanFinishAt !== null &&
      opts.finishTimeoutSeconds !== undefined &&
      performance.now() - firstHumanFinishAt > opts.finishTimeoutSeconds * 1000
    ) {
      endRace();
    }
  }

  function panOf(human: HumanState): number {
    if (!split || layout !== "vertical") return 0;
    return human.index === 0 ? -0.6 : 0.6;
  }

  function recoverOffTrack(racer: Racer, dt: number) {
    const human = racer.human!;
    if (human.finished) return;

    const mesh = racer.controller.mesh;
    const nearest = findNearestWaypoint(mesh.position.x, mesh.position.z, waypoints);

    if (nearest.distance <= OFF_TRACK_DISTANCE) {
      human.offTrackPosition.copy(mesh.position);
      // usa a direção da PISTA nesse ponto (não a direção que o carro estava de fato apontando) —
      // senão, se o carro já estivesse de leve apontado pra fora quando saiu, a recuperação o
      // devolvia na mesma direção errada e ele saía de novo imediatamente, em loop.
      const nextWp = waypoints[(nearest.index + 1) % waypoints.length];
      human.offTrackHeading = Math.atan2(nextWp.x - mesh.position.x, nextWp.z - mesh.position.z);
      human.offTrackTimer = 0;
      return;
    }

    human.offTrackTimer += dt;
    if (human.offTrackTimer > OFF_TRACK_GRACE) {
      mesh.position.copy(human.offTrackPosition);
      racer.controller.heading = human.offTrackHeading;
      mesh.rotation.y = human.offTrackHeading;
      racer.controller.speed = 0;
      racer.controller.bumpVelocity.set(0, 0);
      human.offTrackTimer = 0;
      human.hud.banner("FORA DA PISTA!");
    }
  }

  /** Linhas do leaderboard/minimapa — iguais pra todo mundo, menos o destaque de "sou eu". */
  function displayRows(self: Racer): RacerDisplay[] {
    return racers.map((racer) => ({
      label: racer.label,
      color: racer.color,
      isPlayer: racer === self,
      lapCount: racer.progress.lapCount,
      score: racer.progress.score(),
    }));
  }

  function minimapDots(self: Racer): MinimapDot[] {
    return racers.map((racer, i) => ({
      id: String(i),
      x: racer.controller.mesh.position.x,
      z: racer.controller.mesh.position.z,
      color: racer.color,
      isPlayer: racer === self,
    }));
  }

  const ranking: Racer[] = [];
  function updateHuds() {
    ranking.length = 0;
    for (const racer of racers) ranking.push(racer);
    ranking.sort((a, b) => b.progress.score() - a.progress.score());

    for (const racer of humans) {
      const human = racer.human!;
      const controller = racer.controller;
      human.hud.update({
        speedKmh: Math.abs(controller.speed) * 6,
        lapTimeText: raceStarted
          ? formatTime(racer.progress.currentLapElapsed())
          : "0'00\"00",
        gear: gearForSpeed(controller.speed),
        nitroCharges: human.nitroCharges,
        nitroActive: human.nitroTimer > 0,
        fuel: human.fuel,
        lapCount: racer.progress.lapCount,
        totalLaps: TOTAL_LAPS,
        lastLapMs: racer.progress.lastLapTime,
        bestLapMs: racer.progress.bestLapTime,
        position: ranking.indexOf(racer) + 1,
        racers: displayRows(racer),
        dots: minimapDots(racer),
      });

      human.engine?.update(Math.abs(controller.speed) / MAX_SPEED, human.nitroTimer > 0);
    }
  }

  const behind = new THREE.Vector3();
  function updateCameras(dt: number) {
    for (const racer of humans) {
      const human = racer.human!;
      const mesh = racer.controller.mesh;
      // segue a direção do CARRO (e não a do input), então a câmera de cada metade é totalmente
      // independente — inclusive pra quem já terminou e virou espectador do próprio carro
      behind.set(
        Math.sin(racer.controller.heading) * -ART.camera.distance,
        ART.camera.height,
        Math.cos(racer.controller.heading) * -ART.camera.distance
      );
      behind.add(mesh.position);

      const camera = human.view.camera;
      camera.position.lerp(behind, 1 - Math.pow(0.001, dt));
      camera.lookAt(mesh.position.x, mesh.position.y + ART.camera.lookAtHeight, mesh.position.z);
    }
  }

  const clock = new THREE.Clock();
  let rafId = 0;

  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const cpuStart = showStats ? performance.now() : 0;
    if (showStats) renderer.info.reset();

    if (takeKeyPulse(PAUSE_KEYS)) togglePause();

    if (raceStarted && !raceOver && !paused) step(dt);

    updateHuds();
    if (!paused) updateCameras(dt);

    viewports.render(scene, (view) => updateBillboards(cameraYaw(view.camera)));

    if (showStats) {
      statsFrames++;
      statsElapsed += dt;
      statsCpuMs += performance.now() - cpuStart;
      if (statsElapsed >= 2) {
        const info = renderer.info.render;
        console.log(
          `[stats] ${(statsFrames / statsElapsed).toFixed(1)} fps · ` +
            `${(statsCpuMs / statsFrames).toFixed(2)} ms de CPU por frame · ` +
            `${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k triângulos · ` +
            `${players.length} jogador(es) · ${bots} bots`
        );
        statsFrames = 0;
        statsElapsed = 0;
        statsCpuMs = 0;
      }
    }
  }

  frame();

  return {
    dispose() {
      cancelAnimationFrame(rafId);
      setKeyboardCapture(false);
      for (const racer of humans) {
        racer.human!.hud.destroy();
        racer.human!.engine?.stop();
      }
      countdownOverlay.destroy();
      pauseOverlay.destroy();
      viewports.dispose();
      raceScene.dispose();
      if (showStats) renderer.info.autoReset = true;
    },
  };
}
