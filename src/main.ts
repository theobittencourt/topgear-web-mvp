import * as THREE from "three";
import { elevationAt, TRACK_PRESETS } from "./track";
import type { TrackConfig } from "./track";
import {
  MAX_SPEED,
  FUEL_DRAIN_PER_SECOND,
  FUEL_DRAIN_NITRO_MULTIPLIER,
  gearForSpeed,
} from "@shared/physics";
import { TOTAL_LAPS, MIN_RACERS, MAX_RACERS } from "@shared/rules";
import { createCarMesh } from "./car";
import { LapClock, formatTime } from "./raceTimer";
import { createLobby, joinLobby, getStateCallbacks } from "./network";
import type { Room } from "colyseus.js";
// efeito colateral: cria o renderer e pendura o canvas no #app antes de qualquer corrida
import "./renderer";
import { ART } from "./retro";
import { createRaceScene } from "./race/scene";
import { createViews, cameraYaw } from "./race/viewports";
import { startOfflineRace, MAX_BOTS } from "./race/offlineRace";
import type { RaceSession, RaceStanding } from "./race/offlineRace";
import {
  HumanInput,
  KEYMAPS,
  mobileControls,
  setKeyboardCapture,
  clearKeyboard,
} from "./input";
import {
  createPlayerHud,
  createCountdownOverlay,
  createVictoryOverlay,
  createNameEntryScreen,
  createMapSelectScreen,
  createCarSelectScreen,
  createModeSelectScreen,
  createLocalSetupScreen,
  createResultsScreen,
  createOnlineChoiceScreen,
  createCodeEntryScreen,
  createLobbyScreen,
  createLoadingScreen,
  createMobileControls,
} from "./ui";
import type { MenuScreen, RacerDisplay, MinimapDot, StandingRow } from "./ui";

const isMobileDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

document.body.style.setProperty("user-select", "none");
document.body.style.setProperty("-webkit-user-select", "none");
document.body.style.setProperty("-moz-user-select", "none");
document.body.style.setProperty("-ms-user-select", "none");

// Os controles de toque alimentam o MESMO estado que o `HumanInput` lê (ver `input.ts`), então pro
// laço de jogo não existe diferença entre dedo e tecla.
if (isMobileDevice) {
  createMobileControls((state) => {
    mobileControls.throttle = state.throttle;
    mobileControls.brake = state.brake;
    mobileControls.steer = state.steer;
    if (state.nitro) mobileControls.nitroPulse = true;
  });
}

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
 *
 * Usa as MESMAS peças do modo offline (cena, viewport, HUD, input de teclado) — o que é só dele é
 * de onde vem a posição dos carros.
 */
function startMultiplayerGame(config: TrackConfig, room: Room) {
  const { scene, waypoints, startHeading, gridPosition, updateBillboards } =
    createRaceScene(config);

  // uma "visão" só: o online é sempre tela cheia (um jogador local por navegador)
  const viewports = createViews(1);
  const view = viewports.views[0];

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

  const input = new HumanInput(KEYMAPS.solo, { mobile: isMobileDevice, gamepadIndex: 0 });

  // último input já enviado, pra não repetir pacote idêntico a cada frame (ver o send lá embaixo)
  const sentInput = { throttle: -1, brake: -1, steer: -1 };
  function invalidateSentInput() {
    sentInput.throttle = -1;
    sentInput.brake = -1;
    sentInput.steer = -1;
  }

  const hud = createPlayerHud(view.overlay, {
    maxSpeedKmh: MAX_SPEED * 6,
    waypoints,
    mobile: isMobileDevice,
  });

  // combustível é local até no multiplayer: hoje ele não tem efeito nenhum na física, então não
  // vale o custo de sincronizar. Se um dia acabar o tanque penalizar o carro, isso PRECISA virar
  // estado do servidor, senão cada client castiga o seu num momento diferente.
  let fuel = 1;
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

    // o `preventDefault` das setas/espaço só vale durante a corrida: no lobby o teclado ainda
    // precisa navegar e acionar os botões normalmente
    setKeyboardCapture(phase === "countdown" || phase === "racing");

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
  const behind = new THREE.Vector3();

  function render() {
    viewports.render(scene, (v) => updateBillboards(cameraYaw(v.camera)));
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    // o servidor é a autoridade — o client só copia a posição/direção de cada carro
    // (o state ainda pode não ter chegado no primeiro frame após o join, então checamos antes de iterar)
    if (!room.state?.cars) {
      render();
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
      const controls = input.getControls();

      // o turbo é decidido pelo SERVIDOR (mexe na velocidade, que é autoritativa) — o client só
      // avisa que o jogador apertou, e lê de volta quantas cargas sobraram
      if (controls.nitro) room.send("nitro");

      // só manda quando o input MUDA. Antes saía um pacote por frame (60/s por jogador, ~600/s numa
      // sala cheia) repetindo o mesmo valor à toa — o WebSocket é confiável e ordenado, então o
      // servidor simplesmente segue com o último valor recebido até chegar um diferente.
      if (
        controls.throttle !== sentInput.throttle ||
        controls.brake !== sentInput.brake ||
        controls.steer !== sentInput.steer
      ) {
        sentInput.throttle = controls.throttle;
        sentInput.brake = controls.brake;
        sentInput.steer = controls.steer;
        room.send("input", {
          throttle: controls.throttle,
          brake: controls.brake,
          steer: controls.steer,
        });
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
          hud.banner(`VOLTA ${carState.lapCount + 1} DE ${TOTAL_LAPS}`);
        }
      }
      entry.lapCount = carState.lapCount;
      entry.score = carState.progress;
    });

    if (localCar) {
      const localState = room.state.cars.get(room.sessionId);
      const localSpeed = localState ? localState.speed : 0;
      const nitroAtivo = localState ? localState.nitroActive === true : false;

      if (racing && Math.abs(localSpeed) > 0.1) {
        const consumo = FUEL_DRAIN_PER_SECOND * (nitroAtivo ? FUEL_DRAIN_NITRO_MULTIPLIER : 1);
        fuel = Math.max(0, fuel - consumo * dt);
      }

      const carList = [...cars.values()];
      const sorted = [...carList].sort((a, b) => b.score - a.score);
      const racerRows: RacerDisplay[] = carList.map((r) => ({
        label: r.label,
        color: r.color,
        isPlayer: r.isPlayer,
        lapCount: r.lapCount,
        score: r.score,
      }));
      const dots: MinimapDot[] = [...cars.entries()].map(([id, r]) => ({
        id,
        x: r.mesh.position.x,
        z: r.mesh.position.z,
        color: r.color,
        isPlayer: r.isPlayer,
      }));

      hud.update({
        speedKmh: Math.abs(localSpeed) * 6,
        lapTimeText: racing ? formatTime(localCar.lapClock.currentElapsed()) : "0'00\"00",
        gear: gearForSpeed(localSpeed),
        nitroCharges: localState ? localState.nitroCharges : 0,
        nitroActive: nitroAtivo,
        fuel,
        lapCount: localCar.lapCount,
        totalLaps: TOTAL_LAPS,
        lastLapMs: localCar.lapClock.lastLapTime,
        bestLapMs: localCar.lapClock.bestLapTime,
        position: sorted.indexOf(localCar) + 1,
        racers: racerRows,
        dots,
      });

      behind.set(
        Math.sin(localCar.mesh.rotation.y) * -ART.camera.distance,
        ART.camera.height,
        Math.cos(localCar.mesh.rotation.y) * -ART.camera.distance
      );
      behind.add(localCar.mesh.position);
      view.camera.position.lerp(behind, 1 - Math.pow(0.001, dt));
      view.camera.lookAt(
        localCar.mesh.position.x,
        localCar.mesh.position.y + ART.camera.lookAtHeight,
        localCar.mesh.position.z
      );
    }

    render();
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

function trackById(id: string): TrackConfig {
  return TRACK_PRESETS.find((p) => p.id === id) ?? TRACK_PRESETS[0];
}

function carById(id: string) {
  return CAR_OPTIONS.find((c) => c.id === id) ?? CAR_OPTIONS[0];
}

/**
 * Mostra a tela de loading, pinta um frame e só então roda o trabalho pesado.
 *
 * O `setTimeout` (não rAF) garante que a tela realmente apareceu antes de travar a thread
 * principal montando a pista — rAF sozinho pode nunca disparar se a aba perder o foco bem nesse
 * instante.
 */
function comLoading(acao: () => void, texto = "Carregando...") {
  loadingScreen.setText(texto);
  loadingScreen.show();
  window.setTimeout(() => {
    acao();
    loadingScreen.hide();
  }, 50);
}

/**
 * Solo: mapa -> carro -> nome -> jogo.
 *
 * Cada tela recebe como voltar pra anterior. Voltar DESTRÓI a tela atual em vez de só escondê-la —
 * seguir em frente sempre cria uma tela nova, então guardar as antigas empilharia telas mortas a
 * cada ida e volta.
 */
function startSoloFlow(telaAnterior: MenuScreen) {
  const mapa = createMapSelectScreen(
    mapOptions,
    (mapId) => {
      const config = trackById(mapId);

      const carro = createCarSelectScreen(
        CAR_OPTIONS,
        (carId) => {
          const carOption = carById(carId);

          const nome = createNameEntryScreen(
            (name) => {
              comLoading(() => startSolo(config, carOption.color, name));
            },
            () => {
              nome.destroy();
              carro.show();
            }
          );
        },
        () => {
          carro.destroy();
          mapa.show();
        }
      );
    },
    () => {
      mapa.destroy();
      telaAnterior.show();
    }
  );
}

/**
 * Solo = um jogador local em tela cheia.
 *
 * A regra de fim é a mesma de sempre: a corrida acaba quando QUALQUER UM (inclusive um bot)
 * completa as voltas, e aparece o overlay de vitória com o botão de reiniciar.
 */
function startSolo(config: TrackConfig, carColor: number, playerName: string) {
  startOfflineRace({
    config,
    players: [
      {
        label: playerName,
        color: carColor,
        keymap: KEYMAPS.solo,
        mobile: isMobileDevice,
        // sozinho na tela, o jogador fica com o primeiro controle conectado (e o teclado continua
        // valendo ao mesmo tempo)
        gamepadIndex: 0,
      },
    ],
    botCount: MAX_BOTS,
    endRule: "firstFinisher",
    onRaceEnd(standings) {
      const winner = standings[0];
      const overlay = createVictoryOverlay(() => window.location.reload());
      overlay.show(winner.label, winner.color);
    },
  });
}

/**
 * Local: uma tela de setup e a corrida em tela dividida.
 *
 * Diferente do solo e do online, aqui a corrida tem fim de verdade: "Revanche" e "Menu" descartam
 * a sessão (`dispose`) e montam outra, sem recarregar a página.
 */
function startLocalFlow(telaAnterior: MenuScreen) {
  const setup = createLocalSetupScreen(
    CAR_OPTIONS,
    mapOptions,
    MAX_RACERS - 2,
    (escolha) => {
      comLoading(() => startLocalRace(escolha));
    },
    () => {
      setup.destroy();
      telaAnterior.show();
    }
  );

  function startLocalRace(escolha: {
    p1CarId: string;
    p2CarId: string;
    mapId: string;
    bots: number;
    layout: "horizontal" | "vertical";
  }) {
    const config = trackById(escolha.mapId);
    const p1 = carById(escolha.p1CarId);
    const p2 = carById(escolha.p2CarId);

    let session: RaceSession | null = null;

    function finalizar(standings: RaceStanding[]) {
      const rows: StandingRow[] = standings.map((s) => ({
        label: s.label,
        color: s.color,
        place: s.place,
        lapCount: s.lapCount,
        totalTimeMs: s.totalTimeMs,
        bestLapMs: s.bestLapMs,
        tag: s.tag,
      }));

      const resultados = createResultsScreen(
        rows,
        () => {
          resultados.destroy();
          session?.dispose();
          session = null;
          comLoading(() => startLocalRace(escolha));
        },
        () => {
          resultados.destroy();
          session?.dispose();
          session = null;
          clearKeyboard();
          setup.show();
        }
      );
    }

    session = startOfflineRace({
      config,
      players: [
        { label: "Jogador 1", color: p1.color, keymap: KEYMAPS.p1, tag: "P1", gamepadIndex: 0 },
        { label: "Jogador 2", color: p2.color, keymap: KEYMAPS.p2, tag: "P2", gamepadIndex: 1 },
      ],
      botCount: escolha.bots,
      layout: escolha.layout,
      endRule: "allHumans",
      // depois do primeiro humano chegar, o outro tem 2 minutos — tempo de sobra pra fechar uma
      // volta, e um teto pra quem simplesmente parou de jogar não prender o outro na tela
      finishTimeoutSeconds: 120,
      onRaceEnd: finalizar,
    });
  }
}

/**
 * Multiplayer: carro -> nome -> criar sala (aí sim escolhe o mapa) OU entrar com código (o mapa
 * já vem do host, então nem pergunta).
 */
function startMultiplayerFlow(telaAnterior: MenuScreen) {
  const carro = createCarSelectScreen(
    CAR_OPTIONS,
    (carId) => {
      const carOption = carById(carId);

      const nome = createNameEntryScreen(
        (name) => {
          const escolha = createOnlineChoiceScreen(
            () => {
              const mapa = createMapSelectScreen(
                mapOptions,
                (mapId) => {
                  const config = trackById(mapId);
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
                      // sem isto o jogador ficava numa tela preta: a seleção de mapa já tinha se
                      // escondido sozinha ao ser clicada, e não sobrava nada na tela
                      mapa.show();
                    });
                },
                () => {
                  mapa.destroy();
                  escolha.show();
                }
              );
            },
            () => {
              const codigo = createCodeEntryScreen(
                (code) => {
                  loadingScreen.setText("Entrando na sala...");
                  loadingScreen.show();
                  joinLobby(code, name, carOption.color)
                    .then((room) => {
                      // quem entra por código não escolhe o mapa — usa o que o host já definiu
                      const actualConfig = trackById((room.state as any).mapId);
                      startMultiplayerGame(actualConfig, room);
                      loadingScreen.hide();
                    })
                    .catch((err) => {
                      console.error("Falha ao entrar na sala:", err);
                      loadingScreen.hide();
                      alert("Não foi possível entrar na sala. Confira o código com quem criou.");
                      // devolve a tela do código pra dar pra corrigir e tentar de novo
                      codigo.show();
                    });
                },
                () => {
                  codigo.destroy();
                  escolha.show();
                }
              );
            },
            () => {
              escolha.destroy();
              nome.show();
            }
          );
        },
        () => {
          nome.destroy();
          carro.show();
        }
      );
    },
    () => {
      carro.destroy();
      telaAnterior.show();
    }
  );
}

const modeScreen = createModeSelectScreen((mode) => {
  if (mode === "solo") startSoloFlow(modeScreen);
  else if (mode === "local") startLocalFlow(modeScreen);
  else startMultiplayerFlow(modeScreen);
});
