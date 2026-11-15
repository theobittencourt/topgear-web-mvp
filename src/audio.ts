/**
 * Som do jogo: o clique dos menus e o motor da corrida.
 *
 * O clique é um arquivo (`/sound.mp3`); o resto é SINTETIZADO na hora com a Web Audio API, sem
 * nenhum arquivo novo nem dependência nova. Motor de carro arcade é um zumbido cuja altura segue a
 * velocidade — é mais fácil (e muito mais leve) gerar isso com dois osciladores do que gravar,
 * carregar e dar pitch em um sample.
 *
 * Por que importa pro modo local: cada jogador tem o SEU motor, e na divisão lado a lado cada um
 * sai do seu lado da caixa de som (`StereoPannerNode`) — é a única pista sonora de qual metade da
 * tela é a sua.
 */

/** Cheio soa agressivo demais pra um clique que se repete o tempo todo. */
const VOLUME_CLIQUE = 0.5;

let cliqueAudio: HTMLAudioElement | null = null;

/**
 * Um elemento `<audio>` só, reaproveitado em todo clique.
 *
 * Dar `new Audio()` a cada clique deixaria o primeiro toque atrasado (o navegador iria buscar o
 * arquivo na hora) e ainda acumularia elementos soltos na memória. Criando uma vez com
 * `preload = "auto"`, o arquivo já está na mão quando o clique acontece.
 */
function obterAudioDeClique(): HTMLAudioElement {
  if (!cliqueAudio) {
    cliqueAudio = new Audio("/sound.mp3");
    cliqueAudio.preload = "auto";
    cliqueAudio.volume = VOLUME_CLIQUE;
  }
  return cliqueAudio;
}

/**
 * Toca o clique de menu. Seguro de chamar em qualquer situação: se o navegador recusar, o som
 * simplesmente não sai.
 *
 * O `currentTime = 0` é o que permite cliques em sequência — sem ele, clicar de novo enquanto o
 * som anterior ainda toca não faria nada, e o menu pareceria estar ignorando o segundo clique.
 */
export function playMenuClick() {
  const audio = obterAudioDeClique();
  try {
    audio.currentTime = 0;
    // play() devolve uma promise que pode ser rejeitada (política de autoplay, aba sem foco,
    // aparelho no mudo). Sem o catch isso vira "unhandled rejection" no console — e um som de
    // interface não vale um erro na tela do usuário.
    void audio.play().catch(() => {});
  } catch {
    // alguns navegadores lançam ao mexer em currentTime antes do arquivo estar pronto
  }
}

// ---------------------------------------------------------------------------------------------
// Áudio sintetizado da corrida
// ---------------------------------------------------------------------------------------------

/**
 * O contexto é ÚNICO e nunca é fechado.
 *
 * Um `AudioContext` fechado não volta, e o navegador limita quantos existem por página — criando
 * um por corrida, algumas revanches depois o áudio simplesmente pararia de funcionar. Quem termina
 * uma corrida solta os NÓS (osciladores, ganhos), não o contexto.
 */
let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (audioContext) {
    // o navegador suspende o contexto sozinho quando a aba perde o foco
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    return audioContext;
  }
  try {
    audioContext = new AudioContext();
    void audioContext.resume().catch(() => {});
    return audioContext;
  } catch {
    // navegador sem Web Audio (ou com áudio bloqueado): o jogo continua, só fica mudo
    return null;
  }
}

/**
 * Liga um nó na saída, com panorâmica estéreo quando pedida.
 *
 * `StereoPannerNode` é -1 (toda à esquerda) a 1 (toda à direita). Com pan 0 o nó vai direto pra
 * saída — um panner no centro não faz nada além de gastar CPU.
 */
function connectToOutput(ctx: AudioContext, node: AudioNode, pan: number): AudioNode[] {
  if (pan === 0) {
    node.connect(ctx.destination);
    return [];
  }
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(panner);
  panner.connect(ctx.destination);
  return [panner];
}

export interface EngineSoundOptions {
  /** -1 (esquerda) a 1 (direita) */
  pan: number;
  /** volume geral deste motor, 0..1 */
  volume: number;
}

export interface EngineSound {
  /** @param speed01 velocidade atual / velocidade máxima @param nitro turbo queimando */
  update(speed01: number, nitro: boolean): void;
  setMuted(muted: boolean): void;
  stop(): void;
}

const ENGINE_IDLE_HZ = 42;
const ENGINE_RANGE_HZ = 165;
/** o turbo sobe o tom do motor — é o que faz o nitro ser audível sem um efeito separado */
const ENGINE_NITRO_PITCH = 1.22;

export function createEngineSound(options: EngineSoundOptions): EngineSound | null {
  const ctx = getContext();
  if (!ctx) return null;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  // o filtro corta o agudo do dente-de-serra: sem ele o som fica um zumbido eletrônico fininho,
  // com ele vira algo mais perto de um motor abafado
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.8;
  filter.connect(gain);

  // dois osciladores levemente desafinados: um sozinho soa como teste de áudio, dois batendo um
  // contra o outro dão a trepidação de motor
  const oscillators = [ctx.createOscillator(), ctx.createOscillator()];
  oscillators[0].type = "sawtooth";
  oscillators[1].type = "square";
  oscillators[1].detune.value = -14;
  for (const osc of oscillators) {
    osc.frequency.value = ENGINE_IDLE_HZ;
    osc.connect(filter);
    osc.start();
  }

  const extras = connectToOutput(ctx, gain, options.pan);

  let muted = false;
  let stopped = false;

  return {
    update(speed01, nitro) {
      if (stopped) return;
      const speed = Math.max(0, Math.min(1, speed01));
      const pitch = (ENGINE_IDLE_HZ + speed * ENGINE_RANGE_HZ) * (nitro ? ENGINE_NITRO_PITCH : 1);
      const now = ctx.currentTime;

      for (const osc of oscillators) {
        // rampa curta em vez de atribuição seca: trocar a frequência de um oscilador de um frame
        // pro outro estala (é uma descontinuidade na onda)
        osc.frequency.setTargetAtTime(pitch, now, 0.05);
      }
      filter.frequency.setTargetAtTime(700 + speed * 1800, now, 0.08);

      const target = muted ? 0 : options.volume * (0.045 + speed * 0.1);
      gain.gain.setTargetAtTime(target, now, 0.05);
    },
    setMuted(value) {
      muted = value;
      if (!stopped) gain.gain.setTargetAtTime(muted ? 0 : options.volume * 0.05, ctx.currentTime, 0.05);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      for (const osc of oscillators) {
        osc.stop(ctx.currentTime + 0.1);
        osc.disconnect();
      }
      filter.disconnect();
      gain.disconnect();
      for (const node of extras) node.disconnect();
    },
  };
}

/** Ruído branco curto, reaproveitado pelos efeitos. Gerado uma vez por sessão. */
let noiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    const length = Math.floor(ctx.sampleRate * 0.4);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/**
 * Batida: estouro de ruído com decaimento rápido, mais forte quanto maior a sobreposição dos
 * carros. Toca na panorâmica de quem bateu.
 */
export function playCrash(pan: number, strength: number) {
  const ctx = getContext();
  if (!ctx) return;

  // encostar de leve em alguém acontece o tempo todo numa curva — sem um piso, o jogo viraria uma
  // metralhadora de batidinhas
  const intensity = Math.min(1, strength / 1.6);
  if (intensity < 0.12) return;

  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 420 + intensity * 900;

  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.1 + intensity * 0.25, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

  source.connect(filter);
  filter.connect(gain);
  const extras = connectToOutput(ctx, gain, pan);

  source.start(now);
  source.stop(now + 0.25);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
    for (const node of extras) node.disconnect();
  };
}

/** Turbo: varredura de ruído subindo, na panorâmica de quem apertou. */
export function playNitroWhoosh(pan: number) {
  const ctx = getContext();
  if (!ctx) return;

  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.4;

  const now = ctx.currentTime;
  filter.frequency.setValueAtTime(320, now);
  filter.frequency.exponentialRampToValueAtTime(2600, now + 0.35);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

  source.connect(filter);
  filter.connect(gain);
  const extras = connectToOutput(ctx, gain, pan);

  source.start(now);
  source.stop(now + 0.42);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
    for (const node of extras) node.disconnect();
  };
}
