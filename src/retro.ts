import * as THREE from "three";

/**
 * Tema visual do jogo.
 *
 * São dois: `retro` (resolução interna baixa com pixel grandão, luz chapada, céu em bandas) e
 * `moderno` (resolução nativa com antialias, sombra e luz suave). A direção de arte em si —
 * faixas no chão, vegetação em sprite, placas de curva, paleta dos mapas — vale nos DOIS: ela não
 * é "coisa de retrô", é o que dá a cara de jogo de corrida arcade. Ver `ART` mais abaixo.
 *
 * A escolha fica salva no `localStorage`, então dura entre sessões.
 */

export type VisualTheme = "retro" | "moderno";

export interface VisualSettings {
  /**
   * Altura ALVO da resolução interna de render; 0 = renderiza na resolução nativa.
   *
   * É só um alvo porque o fator de escala é arredondado pra inteiro (ver `applyResolution`).
   * Referência: 224 = SNES de verdade (bem chunky) · 300 = retrô sem virar mosaico · 0 = desligado.
   */
  internalHeight: number;
  /** Luz chapada e sem sombra dinâmica, como um console 16-bit. */
  flatLighting: boolean;
  /** Quantos degraus tem o degradê do céu. Poucos = banding proposital; muitos = degradê liso. */
  skyBands: number;
  /** Nuvens 3D no céu. O Top Gear não tem nenhuma — o céu dele é chapado e limpo. */
  clouds: boolean;
}

const RETRO_SETTINGS: VisualSettings = {
  // 300 em vez dos 224 do SNES: numa janela comum, 224 dá um bloco de 4 a 5 pixels de lado, o que
  // fica mais pra mosaico do que pra pixel art. 300 mantém o serrilhado sem comer o desenho.
  internalHeight: 300,
  flatLighting: true,
  skyBands: 16,
  clouds: false,
};

const MODERN_SETTINGS: VisualSettings = {
  internalHeight: 0,
  flatLighting: false,
  skyBands: 128,
  clouds: true,
};

const THEME_STORAGE_KEY = "topGearTest.visualTheme";

function readStoredTheme(): VisualTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "moderno" ? "moderno" : "retro";
  } catch {
    // navegador com storage bloqueado (aba anônima, política de cookies) — cai no padrão
    return "retro";
  }
}

let activeTheme: VisualTheme = readStoredTheme();

export function getTheme(): VisualTheme {
  return activeTheme;
}

/**
 * Salva o tema escolhido. NÃO aplica na hora: o antialias é decidido lá na criação do renderer, e
 * a pista já teria sido montada com as luzes e o céu do tema anterior. Quem chama recarrega a
 * página — como a troca fica na primeira tela, recarregar não custa nada pro jogador.
 */
export function setTheme(theme: VisualTheme) {
  activeTheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // sem storage o tema só não persiste; o jogo continua funcionando
  }
}

/** Ajustes do tema ativo. Lidos na montagem da cena, não por frame. */
export const VISUAL: VisualSettings =
  activeTheme === "moderno" ? MODERN_SETTINGS : RETRO_SETTINGS;

/** No tema retrô o antialias não faz sentido: ele suaviza justamente o que a gente quer duro. */
export const wantsAntialias = VISUAL.internalHeight <= 0;

/**
 * Direção de arte — vale nos dois temas, porque não é sobre fidelidade gráfica e sim sobre o jogo
 * parecer um arcade de corrida. Cada item liga/desliga sozinho, pra dar pra achar o ponto certo
 * mexendo num de cada vez.
 */
export const ART = {
  /**
   * Faixas alternadas de chão passando pelo carro. É a assinatura do gênero (Top Gear, OutRun):
   * o que dá sensação de velocidade não é o carro andar, é o chão piscando.
   */
  groundStripes: true,
  /** Largura de cada faixa, em passos do contorno da pista. Menor = pisca mais rápido. */
  groundStripeWidth: 2,

  /**
   * Calçada de concreto entre o meio-fio e a grama. Fica bonita num circuito urbano, mas empurra
   * as faixas pra 12 unidades longe do asfalto — e na referência a sequência é pista, zebra e
   * grama, sem nada no meio.
   */
  concreteSidewalk: false,

  /** Placas de seta avisando curva, plantadas do lado de fora das curvas. */
  curveSigns: true,

  /**
   * Câmera baixa e aberta, colada no chão. Igual nos dois temas de propósito: trocar de tema muda
   * como o jogo PARECE, não como ele joga.
   */
  camera: {
    height: 2.6,
    distance: 7.5,
    fov: 76,
    /** altura do ponto pra onde a câmera olha, relativa ao carro */
    lookAtHeight: 0.9,
  },
};

/**
 * Configura o tamanho do buffer de render e cuida do resize.
 *
 * No tema retrô a cena é desenhada num buffer pequeno e esticada por cima com
 * vizinho-mais-próximo. O truque é o terceiro parâmetro do `setSize` (`updateStyle = false`), que
 * encolhe o buffer de render sem encolher o canvas na tela.
 *
 * O detalhe que faz MUITA diferença: o fator de escala é arredondado pra INTEIRO. Escalando por um
 * fator quebrado (tipo 4,02x), uns pixels do jogo viram blocos de 4 na tela e outros de 5 — e essa
 * irregularidade é o que faz upscale pixelado parecer sujo, bem mais do que o tamanho do bloco em
 * si. Com fator inteiro todo bloco fica igual e o resultado fica limpo.
 */
export function applyResolution(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    camera.aspect = w / h;
    camera.fov = ART.camera.fov;
    camera.updateProjectionMatrix();

    const el = renderer.domElement;
    if (VISUAL.internalHeight > 0) {
      const factor = Math.max(1, Math.round(h / VISUAL.internalHeight));
      renderer.setPixelRatio(1);
      renderer.setSize(Math.round(w / factor), Math.round(h / factor), false);
      el.style.width = "100%";
      el.style.height = "100%";
      el.style.imageRendering = "pixelated";
    } else {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      el.style.imageRendering = "auto";
    }
  }

  resize();
  window.addEventListener("resize", resize);
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * Céu em degradê vertical, desenhado num canvas de 1 pixel de largura por `VISUAL.skyBands` de
 * altura. No tema retrô são poucas linhas com filtro de vizinho-mais-próximo, então cada linha
 * vira uma faixa sólida — o banding é proposital, é assim que gradiente de console 16-bit se
 * parece. No tema moderno são muitas linhas com filtro linear, e o degradê sai liso.
 */
export function createSkyTexture(topColor: number, horizonColor: number): THREE.Texture {
  const bands = Math.max(2, VISUAL.skyBands);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = bands;

  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, bands);
  gradient.addColorStop(0, cssColor(topColor));
  gradient.addColorStop(1, cssColor(horizonColor));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, bands);

  const texture = new THREE.CanvasTexture(canvas);
  const filter = bands <= 32 ? THREE.NearestFilter : THREE.LinearFilter;
  texture.magFilter = filter;
  texture.minFilter = filter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
