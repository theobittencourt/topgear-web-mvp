/**
 * Som do jogo: o clique dos menus e o áudio da corrida.
 *
 * O clique é um arquivo (`/sound.mp3`); o resto é SINTETIZADO na hora com a Web Audio API, sem
 * nenhum arquivo novo nem dependência nova — é mais leve do que gravar, carregar e dar pitch num
 * sample, e o motor precisa variar de altura o tempo todo de qualquer jeito.
 *
 * Tudo aqui respeita o liga/desliga de som (`isSoundEnabled`), que fica na tela inicial.
 *
 * Por que importa pro modo local: cada jogador tem o SEU motor, e na divisão lado a lado cada um
 * sai do seu lado da caixa de som (`StereoPannerNode`) — é a única pista sonora de qual metade da
 * tela é a sua.
 */

const SOUND_STORAGE_KEY = "topGearTest.som";

function readStoredSound(): boolean {
  try {
    // o padrão é LIGADO: quem desligou de propósito é que fica guardado
    return localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
  } catch {
    // navegador com storage bloqueado (aba anônima, política de cookies)
    return true;
  }
}

let soundEnabled = readStoredSound();

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

/**
 * Liga/desliga TODO o som do jogo (menu, motor e efeitos).
 *
 * Vale na hora, inclusive no meio de uma corrida: o motor consulta isto a cada frame em vez de
 * guardar uma cópia.
 */
export function setSoundEnabled(on: boolean) {
  soundEnabled = on;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // sem storage a escolha só não persiste; o jogo continua funcionando
  }
}

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
  if (!soundEnabled) return;
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

/**
 * Alturas do motor, em Hz.
 *
 * O que separa "motor" de "sirene": a altura NÃO acompanha a velocidade direto. Ela acompanha a
 * rotação DENTRO DA MARCHA — sobe enquanto o carro acelera naquela marcha e CAI de volta quando
 * troca. Era isso que faltava na primeira versão, que varria 42→207 Hz numa linha reta e soava
 * como uma sirene subindo pra sempre.
 *
 * As marchas são as mesmas do painel (`gearForSpeed`), então o som troca exatamente quando o
 * número muda na tela.
 */
const ENGINE_GEARS = 6;
const ENGINE_MIN_HZ = 58;
const ENGINE_MAX_HZ = 186;
/** o turbo sobe um pouco o tom, sem virar outro instrumento */
const ENGINE_NITRO_PITCH = 1.12;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function createEngineSound(options: EngineSoundOptions): EngineSound | null {
  const ctx = getContext();
  if (!ctx) return null;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  // Passa-baixa fechado: um dente-de-serra cru é agudo e elétrico demais. Cortando o agudo sobra
  // o corpo grave, que é o que o ouvido lê como motor. A frequência de corte abre com a rotação —
  // é o "ronco abrindo" na hora de acelerar.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 340;
  filter.Q.value = 1.1;
  filter.connect(gain);

  // Dois dentes-de-serra a uma OITAVA de distância, não dois quase na mesma nota. A primeira
  // versão usava um `square` desafinado em 14 cents contra um `sawtooth`: isso não dá corpo, dá
  // batimento — aquele "uou-uou-uou" de teste de áudio.
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const sub = ctx.createOscillator();
  sub.type = "sawtooth";
  sub.detune.value = -1200; // uma oitava abaixo

  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;
  sub.connect(subGain);
  subGain.connect(filter);
  osc.connect(filter);

  // Trepidação: um LFO lento mexendo de leve na afinação dos dois. Motor de verdade não segura
  // uma nota perfeita, e sem isso o som fica "sintetizador" na hora.
  const wobble = ctx.createOscillator();
  wobble.type = "sine";
  wobble.frequency.value = 6.5;
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = 7; // em cents
  wobble.connect(wobbleDepth);
  wobbleDepth.connect(osc.detune);
  wobbleDepth.connect(sub.detune);

  // Um fiapo de ruído filtrado por cima: é o "ar" da admissão. Sozinho não é nada, mas tira o
  // resto da cara de oscilador puro.
  const air = ctx.createBufferSource();
  air.buffer = getNoiseBuffer(ctx);
  air.loop = true;
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = "bandpass";
  airFilter.frequency.value = 480;
  airFilter.Q.value = 0.9;
  const airGain = ctx.createGain();
  airGain.gain.value = 0;
  air.connect(airFilter);
  airFilter.connect(airGain);
  airGain.connect(gain);

  osc.frequency.value = ENGINE_MIN_HZ;
  sub.frequency.value = ENGINE_MIN_HZ;
  osc.start();
  sub.start();
  wobble.start();
  air.start();

  const extras = connectToOutput(ctx, gain, options.pan);

  let muted = false;
  let stopped = false;

  return {
    update(speed01, nitro) {
      if (stopped) return;
      const speed = clamp01(speed01);

      // rotação dentro da marcha atual: 0 = acabou de trocar, 1 = esticando no talo
      const porMarcha = Math.min(speed * ENGINE_GEARS, ENGINE_GEARS - 0.0001);
      const rpm = porMarcha - Math.floor(porMarcha);

      const pitch = (ENGINE_MIN_HZ + rpm * (ENGINE_MAX_HZ - ENGINE_MIN_HZ)) * (nitro ? ENGINE_NITRO_PITCH : 1);
      const now = ctx.currentTime;

      // rampa curta em vez de atribuição seca: trocar a frequência de um oscilador de um frame
      // pro outro estala (é uma descontinuidade na onda). Ela também é o que faz a troca de
      // marcha soar como uma troca, e não como um corte.
      osc.frequency.setTargetAtTime(pitch, now, 0.04);
      sub.frequency.setTargetAtTime(pitch, now, 0.04);
      filter.frequency.setTargetAtTime(320 + rpm * 900 + speed * 700, now, 0.06);
      airFilter.frequency.setTargetAtTime(380 + speed * 900, now, 0.08);

      const silenciado = muted || !isSoundEnabled();
      // o volume sobe com a velocidade (o carro ao longe é mais baixo que o carro voando), e um
      // tiquinho com a rotação, que é o que dá o "esforço" no fim de cada marcha
      gain.gain.setTargetAtTime(
        silenciado ? 0 : options.volume * (0.022 + speed * 0.05 + rpm * 0.016),
        now,
        0.06
      );
      airGain.gain.setTargetAtTime(silenciado ? 0 : options.volume * (0.012 + speed * 0.03), now, 0.08);
    },
    setMuted(value) {
      muted = value;
      if (stopped || !muted) return;
      // silenciar precisa valer na hora: depois da bandeirada o `update` para de ser chamado, e
      // sem isto o motor ficaria roncando por cima da tela de classificação
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      airGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.02);
      for (const node of [osc, sub, wobble, air]) {
        node.stop(now + 0.1);
        node.disconnect();
      }
      wobbleDepth.disconnect();
      subGain.disconnect();
      airFilter.disconnect();
      airGain.disconnect();
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
  if (!soundEnabled) return;
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
  if (!soundEnabled) return;
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
