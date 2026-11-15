/**
 * De onde vêm os comandos de um carro.
 *
 * A física (`CarController.update`) recebe só `{ throttle, brake, steer, nitro }` e NÃO sabe quem
 * mandou: teclado, controle de videogame ou a IA dos bots. É isso que permite o mesmo laço de jogo
 * rodar o solo (1 jogador + bots) e o local em tela dividida (2 jogadores + bots) sem um
 * `if (modo === ...)` espalhado pelo código.
 *
 * Por que `KeyboardEvent.code` e não `key`: `code` é a POSIÇÃO física da tecla, igual em qualquer
 * layout. Com `key`, o W de um teclado AZERTY/Dvorak não cai onde o jogador espera, e teclas com
 * acento/dead key (comuns no ABNT2) chegam com valores estranhos. `code` resolve os dois casos.
 */

import { normalizeAngle } from "@shared/physics";
import { BOT_WAYPOINT_RADIUS } from "@shared/rules";
import type { CarController } from "./car";

/**
 * Comandos de um carro num frame.
 *
 * ATENÇÃO ao `nitro`: aqui ele é um PULSO ("acabou de pedir turbo"), não um estado ("turbo
 * queimando"). Quem transforma pulso em carga/duração é a corrida; o que chega na física
 * (`DriveInput.nitro`) já é o estado. Misturar os dois faz segurar a tecla queimar as três cargas
 * de uma vez — foi exatamente o bug que o `nitroKeyHeld` do código antigo existia pra evitar.
 */
export interface DriveControls {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1 (positivo vira pra direita, mesma convenção da física) */
  steer: number;
  /** pulso: true só no frame em que o turbo foi pedido */
  nitro: boolean;
}

export interface InputSource {
  /** Lê os comandos deste frame. `dt` existe pros inputs com estado próprio (a IA dos bots). */
  getControls(dt: number): DriveControls;
  dispose?(): void;
}

export interface Keymap {
  throttle: string[];
  brake: string[];
  left: string[];
  right: string[];
  nitro: string[];
}

/**
 * Mapeamentos de teclado, num objeto só pra dar pra remapear depois (e pra qualquer tela de ajuda
 * mostrar as teclas sem duplicar a lista).
 *
 * `solo` é o mapa do jogador único: aceita WASD **e** as setas, porque sozinho na tela não tem
 * ninguém pra disputar as setas com ele.
 */
export const KEYMAPS: Record<"solo" | "p1" | "p2", Keymap> = {
  solo: {
    throttle: ["KeyW", "ArrowUp"],
    brake: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    nitro: ["Space", "ShiftLeft", "ShiftRight", "Enter", "Numpad0"],
  },
  p1: {
    throttle: ["KeyW"],
    brake: ["KeyS"],
    left: ["KeyA"],
    right: ["KeyD"],
    nitro: ["ShiftLeft", "Space"],
  },
  p2: {
    throttle: ["ArrowUp"],
    brake: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    nitro: ["ShiftRight", "Enter", "Numpad0"],
  },
};

/** Pausa é compartilhada entre os jogadores — qualquer um dos dois pausa pros dois. */
export const PAUSE_KEYS = ["Escape", "KeyP"];

/**
 * Teclas que a página consome durante a corrida.
 *
 * Sem `preventDefault`, as setas e o espaço rolam a página (e o espaço ainda "clica" no último
 * botão que teve foco). Só vale durante a corrida — ver `setKeyboardCapture`: fora dela o espaço
 * precisa continuar digitando espaço na tela de nome.
 */
const PREVENT_DEFAULT = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "Enter",
]);

const pressed = new Set<string>();
/** teclas que DESCERAM e ainda não foram consumidas — é daqui que sai o pulso do turbo */
const pulses = new Set<string>();
let capturing = false;
let installed = false;

/**
 * Um par de listeners pra toda a aplicação, instalados na primeira vez que alguém pergunta algo
 * sobre o teclado. Dois jogadores no mesmo teclado não precisam (nem podem) ter listeners
 * separados: o evento é da janela, quem separa os dois é o mapa de teclas de cada um.
 */
function install() {
  if (installed) return;
  installed = true;

  window.addEventListener(
    "keydown",
    (e) => {
      if (capturing && PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      // `e.repeat` (e o `pressed.has`) filtram o auto-repeat do sistema: ele manda keydown sem
      // parar enquanto a tecla está apertada, e cada um desses viraria um pulso de turbo.
      if (!e.repeat && !pressed.has(e.code)) pulses.add(e.code);
      pressed.add(e.code);
    },
    { passive: false }
  );

  window.addEventListener("keyup", (e) => {
    pressed.delete(e.code);
  });

  // Trocar de aba/janela com o pé no acelerador NÃO manda keyup — a tecla ficava "presa" e o carro
  // seguia acelerando sozinho ao voltar. Perder o foco limpa tudo.
  window.addEventListener("blur", clearKeyboard);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearKeyboard();
  });
}

export function clearKeyboard() {
  pressed.clear();
  pulses.clear();
}

/** Descarta pulsos não consumidos (ex.: ao pausar, pra não disparar turbo ao voltar). */
export function clearKeyPulses() {
  pulses.clear();
}

/** Liga/desliga o `preventDefault` das teclas de jogo. Ligue ao largar, desligue ao sair. */
export function setKeyboardCapture(on: boolean) {
  install();
  capturing = on;
  if (!on) clearKeyboard();
}

function anyDown(codes: string[]): boolean {
  for (const code of codes) if (pressed.has(code)) return true;
  return false;
}

/** Consome o pulso de qualquer uma das teclas pedidas. */
export function takeKeyPulse(codes: string[]): boolean {
  install();
  let hit = false;
  for (const code of codes) if (pulses.delete(code)) hit = true;
  return hit;
}

/**
 * Estado dos controles de toque (celular). Mora aqui, e não no `main`, pra que o input de um
 * jogador seja sempre "teclado + toque + controle", sem o laço de jogo saber de qual deles veio.
 */
export const mobileControls = {
  throttle: false,
  brake: false,
  steer: 0,
  /** pulso, igual ao do teclado */
  nitroPulse: false,
};

function takeMobileNitro(): boolean {
  if (!mobileControls.nitroPulse) return false;
  mobileControls.nitroPulse = false;
  return true;
}

interface PadReading {
  throttle: number;
  brake: number;
  steer: number;
  nitro: boolean;
}

/** botão de turbo apertado no frame anterior, por controle — pra transformar em pulso */
const padNitroHeld = new Map<number, boolean>();

const AXIS_DEADZONE = 0.18;
/** o gatilho só começa a valer depois de um tiquinho de curso, pra não disparar sozinho */
const TRIGGER_DEADZONE = 0.08;

/**
 * Lista os controles conectados, na ordem em que o navegador os entrega (o 0 é o do jogador 1).
 *
 * Serve pra TELA mostrar o que está vendo. Importante saber: o Chrome só revela um controle depois
 * que alguém APERTA UM BOTÃO nele — até lá ele não aparece aqui nem no jogo, mesmo plugado. É a
 * proteção do navegador contra identificar a máquina sem o usuário pedir.
 */
export function connectedGamepads(): string[] {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const nomes: string[] = [];
  for (const pad of pads) {
    if (pad && pad.connected) nomes.push(pad.id);
  }
  return nomes;
}

/**
 * Lê um controle pelo índice (controle 1 = 0, controle 2 = 1).
 *
 * Devolve `null` quando aquele controle não está conectado — é isso que faz o teclado continuar
 * valendo sozinho, sem "modo controle" pra entrar ou sair.
 *
 * Mapeamento no padrão "standard" do navegador (Xbox, DualShock/DualSense e a maioria dos genéricos
 * caem nele): RT ou A aceleram, LT ou B freiam, analógico esquerdo ou direcional esterçam, e
 * X/Y/RB dão turbo. Num controle que o navegador NÃO reconhece como "standard" a numeração dos
 * botões é imprevisível, então aí só o analógico e os dois primeiros botões são usados — melhor um
 * controle meio mapeado do que um que acelera sozinho.
 */
function readGamepad(index: number): PadReading | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads[index];
  if (!pad || !pad.connected) {
    padNitroHeld.delete(index);
    return null;
  }

  const standard = pad.mapping === "standard";
  const button = (i: number) => pad.buttons[i]?.pressed === true;
  /** valor ANALÓGICO do gatilho: acelerar na metade do curso acelera pela metade */
  const trigger = (i: number) => {
    const value = pad.buttons[i]?.value ?? 0;
    return value > TRIGGER_DEADZONE ? Math.min(1, value) : 0;
  };

  const axis = pad.axes[0] ?? 0;
  let steer = Math.abs(axis) > AXIS_DEADZONE ? Math.max(-1, Math.min(1, axis)) : 0;
  if (steer === 0 && standard) {
    if (button(14)) steer = -1; // direcional esquerda
    if (button(15)) steer = 1; // direcional direita
  }

  const nitroDown = standard && (button(2) || button(3) || button(5));
  const nitro = nitroDown && !padNitroHeld.get(index);
  padNitroHeld.set(index, nitroDown);

  return {
    throttle: Math.max(button(0) ? 1 : 0, standard ? trigger(7) : 0),
    brake: Math.max(button(1) ? 1 : 0, standard ? trigger(6) : 0),
    steer,
    nitro,
  };
}

export interface HumanInputOptions {
  /** também lê os controles de toque (só faz sentido pro jogador único no celular) */
  mobile?: boolean;
  /** índice do controle de videogame deste jogador; sem controle conectado, cai no teclado */
  gamepadIndex?: number;
}

/**
 * Jogador humano: teclado, mais (opcionalmente) toque e controle.
 *
 * As fontes se SOMAM em vez de uma anular a outra: quem tem controle conectado e mesmo assim
 * aperta o teclado continua andando, e não existe um "modo controle" pra entrar ou sair.
 */
export class HumanInput implements InputSource {
  readonly keymap: Keymap;
  private readonly options: HumanInputOptions;

  constructor(keymap: Keymap, options: HumanInputOptions = {}) {
    this.keymap = keymap;
    this.options = options;
    install();
  }

  getControls(): DriveControls {
    let steer = 0;
    if (anyDown(this.keymap.left)) steer -= 1;
    if (anyDown(this.keymap.right)) steer += 1;

    let throttle = anyDown(this.keymap.throttle) ? 1 : 0;
    let brake = anyDown(this.keymap.brake) ? 1 : 0;
    let nitro = takeKeyPulse(this.keymap.nitro);

    if (this.options.mobile) {
      if (mobileControls.throttle) throttle = 1;
      if (mobileControls.brake) brake = 1;
      if (mobileControls.steer !== 0) steer = mobileControls.steer;
      if (takeMobileNitro()) nitro = true;
    }

    if (this.options.gamepadIndex !== undefined) {
      const pad = readGamepad(this.options.gamepadIndex);
      if (pad) {
        throttle = Math.max(throttle, pad.throttle);
        brake = Math.max(brake, pad.brake);
        if (pad.steer !== 0) steer = pad.steer;
        if (pad.nitro) nitro = true;
      }
    }

    return { throttle, brake, steer, nitro };
  }
}

/** O mínimo que a IA precisa saber de um waypoint (sem depender do three.js aqui). */
interface Waypoint2 {
  x: number;
  z: number;
}

/**
 * Bot: a MESMA IA que rodava dentro do `AICarController`, agora como fonte de input.
 *
 * Virou input porque o bot não é um tipo diferente de carro — é um carro com outro motorista. Com
 * isso a colisão, a contagem de voltas e o fim de corrida tratam bot e humano exatamente igual, e
 * dá pra passar um carro de humano pra bot no meio da corrida (é o que acontece quando um jogador
 * cruza a chegada: o carro dele segue andando sozinho em vez de virar um muro na pista).
 */
export class BotInput implements InputSource {
  private readonly car: CarController;
  private readonly waypoints: Waypoint2[];
  private targetIndex: number;
  readonly cruiseThrottle: number;

  private stuckTimer = 0;
  private reverseTimer = 0;
  private lastReverseSteer = 0;

  constructor(
    car: CarController,
    waypoints: Waypoint2[],
    startIndex: number,
    cruiseThrottle = 0.85
  ) {
    this.car = car;
    this.waypoints = waypoints;
    this.targetIndex = startIndex % waypoints.length;
    this.cruiseThrottle = cruiseThrottle;
  }

  getControls(dt: number): DriveControls {
    const car = this.car;
    const target = this.waypoints[this.targetIndex];
    const dx = target.x - car.mesh.position.x;
    const dz = target.z - car.mesh.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < BOT_WAYPOINT_RADIUS) {
      this.targetIndex = (this.targetIndex + 1) % this.waypoints.length;
    }

    const desiredHeading = Math.atan2(dx, dz);
    const angleDiff = normalizeAngle(desiredHeading - car.heading);
    const steer = Math.max(-1, Math.min(1, -angleDiff * 2));
    const sharpTurn = Math.abs(angleDiff) > 0.5;

    // travado (bateu em alguém e não sai do lugar): engata a ré por um instante. Enquanto está de
    // ré o bot NÃO tem teto de velocidade — é o mesmo comportamento do código antigo, onde o
    // `return` pulava a linha do teto.
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      car.speedCap = null;
      return { throttle: 0, brake: 1, steer: this.lastReverseSteer, nitro: false };
    }

    const throttle = sharpTurn ? this.cruiseThrottle * 0.65 : this.cruiseThrottle;
    // cada bot tem uma velocidade de cruzeiro própria (é o que dá um pelotão em vez de um trem):
    // o teto entra na física como limite daquele carro, não como um ajuste depois do passo.
    car.speedCap = car.maxSpeed * throttle;

    if (Math.abs(car.speed) < 2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.8) {
        this.reverseTimer = 1 + Math.random() * 0.5;
        this.lastReverseSteer = steer >= 0 ? -1 : 1;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }

    return { throttle, brake: 0, steer, nitro: false };
  }
}

/**
 * Por que NÃO existe um `NetworkInput` aqui.
 *
 * No multiplayer o servidor é a autoridade: ele roda a física de todos os carros e o client só
 * desenha a posição que chega pronta. Ou seja, no client não existe um passo de física pra
 * alimentar com o input dos outros jogadores — o que existe é o inverso, o input LOCAL saindo pela
 * rede (ver `startMultiplayerGame`, que usa o `HumanInput` daqui como qualquer outro modo).
 *
 * Quem consome input de rede é o servidor, em `server/src/rooms/RaceRoom.ts`.
 */
