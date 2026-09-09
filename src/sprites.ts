import * as THREE from "three";

/**
 * Sprites 2D de beira de pista — vegetação e placas de curva.
 *
 * No Top Gear a beira da pista é toda feita de sprite chapado que sempre encara a câmera, não de
 * geometria 3D. Além de ser o visual certo, é bem mais barato: cada tipo vira um `InstancedMesh`
 * de planos com uma textura só.
 *
 * As texturas são desenhadas em canvas com retângulos, de propósito — sai um pixel art chunky que
 * combina com a resolução interna baixa, e não depende de nenhum asset externo.
 */

export type PlantKind = "palmeira" | "arbusto" | "cacto" | "pinheiro";

/** Pixels grandes: cada "pixel lógico" do desenho vira um bloco desse tamanho no canvas. */
const PX = 4;

function canvasFor(wPx: number, hPx: number) {
  const canvas = document.createElement("canvas");
  canvas.width = wPx * PX;
  canvas.height = hPx * PX;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x * PX, y * PX, w * PX, h * PX);
}

function toTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  // vizinho-mais-próximo pra manter o pixel quadrado quando o sprite chega perto
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Desenha uma planta. O `hexBase` deixa cada mapa tingir a folhagem com a própria paleta sem
 * precisar de uma textura por cor.
 */
export function createPlantTexture(kind: PlantKind): THREE.Texture {
  if (kind === "palmeira") {
    const { canvas, ctx } = canvasFor(24, 32);
    const tronco = "#8a6b3f";
    const troncoEscuro = "#6b4f2a";
    const folha = "#2f9c3d";
    const folhaEscura = "#1f7a2c";

    // tronco levemente inclinado, tipo coqueiro
    for (let i = 0; i < 20; i++) {
      const x = 11 + Math.floor(i / 7);
      px(ctx, x, 31 - i, 2, 1, i % 4 === 0 ? troncoEscuro : tronco);
    }
    // folhas: quatro pencas caindo a partir do topo
    px(ctx, 9, 8, 6, 2, folha);
    px(ctx, 3, 6, 7, 2, folha);
    px(ctx, 1, 8, 4, 2, folhaEscura);
    px(ctx, 14, 6, 7, 2, folha);
    px(ctx, 19, 8, 4, 2, folhaEscura);
    px(ctx, 5, 10, 5, 2, folhaEscura);
    px(ctx, 14, 10, 5, 2, folhaEscura);
    px(ctx, 10, 4, 4, 4, folha);
    // cocos
    px(ctx, 10, 9, 1, 1, troncoEscuro);
    px(ctx, 13, 9, 1, 1, troncoEscuro);
    return toTexture(canvas);
  }

  if (kind === "cacto") {
    const { canvas, ctx } = canvasFor(20, 28);
    const corpo = "#3d8c47";
    const corpoEscuro = "#2a6b33";
    const espinho = "#1d4d24";

    px(ctx, 8, 6, 4, 22, corpo);
    px(ctx, 11, 6, 1, 22, corpoEscuro);
    // braço esquerdo
    px(ctx, 4, 14, 4, 3, corpo);
    px(ctx, 4, 9, 3, 6, corpo);
    px(ctx, 6, 9, 1, 6, corpoEscuro);
    // braço direito
    px(ctx, 12, 18, 4, 3, corpo);
    px(ctx, 13, 12, 3, 7, corpo);
    px(ctx, 15, 12, 1, 7, corpoEscuro);
    // topos arredondados
    px(ctx, 9, 5, 2, 1, corpo);
    px(ctx, 5, 8, 2, 1, corpo);
    px(ctx, 14, 11, 2, 1, corpo);
    // espinhos
    for (let y = 8; y < 27; y += 4) px(ctx, 7, y, 1, 1, espinho);
    return toTexture(canvas);
  }

  if (kind === "pinheiro") {
    const { canvas, ctx } = canvasFor(20, 30);
    const tronco = "#5a3f26";
    const copa = "#1f7a34";
    const copaEscura = "#155c26";

    px(ctx, 9, 24, 2, 6, tronco);
    // três andares de copa, cada um mais largo pra baixo
    px(ctx, 8, 4, 4, 4, copa);
    px(ctx, 6, 8, 8, 4, copa);
    px(ctx, 6, 11, 8, 1, copaEscura);
    px(ctx, 4, 12, 12, 5, copa);
    px(ctx, 4, 16, 12, 1, copaEscura);
    px(ctx, 2, 17, 16, 6, copa);
    px(ctx, 2, 22, 16, 2, copaEscura);
    return toTexture(canvas);
  }

  // arbusto
  const { canvas, ctx } = canvasFor(20, 16);
  const mato = "#35a03f";
  const matoEscuro = "#237a2c";
  px(ctx, 3, 6, 14, 8, mato);
  px(ctx, 5, 4, 10, 3, mato);
  px(ctx, 8, 2, 5, 3, mato);
  px(ctx, 3, 12, 14, 3, matoEscuro);
  px(ctx, 1, 9, 3, 5, matoEscuro);
  px(ctx, 16, 9, 3, 5, matoEscuro);
  return toTexture(canvas);
}

/**
 * Placa de seta avisando curva — aquelas de fundo azul com chevrons vermelhos, plantadas no lado
 * de fora de cada curva. É um dos detalhes mais reconhecíveis do jogo.
 *
 * `paraEsquerda` espelha os chevrons pro lado certo da curva.
 */
export function createChevronTexture(paraEsquerda: boolean): THREE.Texture {
  const { canvas, ctx } = canvasFor(24, 20);

  px(ctx, 0, 0, 24, 14, "#f2f2f2");
  px(ctx, 1, 1, 22, 12, "#1f4fb8");

  // três chevrons apontando pro lado da curva
  for (let c = 0; c < 3; c++) {
    const base = 3 + c * 6;
    for (let i = 0; i < 5; i++) {
      const largura = 2;
      const x = paraEsquerda ? base + i : base + (4 - i);
      const y = 3 + Math.abs(i - 2) * 2;
      px(ctx, x, y, largura, 8 - Math.abs(i - 2) * 4, "#e02020");
    }
  }

  // poste
  px(ctx, 11, 14, 2, 6, "#6b6b6b");
  return toTexture(canvas);
}

export interface BillboardInstance {
  x: number;
  /** y do CHÃO onde o sprite se apoia — a altura é somada a partir daqui */
  groundY: number;
  z: number;
  /** altura do sprite em unidades de mundo (a largura sai da proporção da textura) */
  height: number;
}

export interface BillboardGroup {
  /** Regira todos os sprites pra encarar a câmera. Chame uma vez por frame. */
  update(cameraYaw: number): void;
}

const billboardMatrix = new THREE.Matrix4();
const billboardPosition = new THREE.Vector3();
const billboardQuaternion = new THREE.Quaternion();
const billboardScale = new THREE.Vector3();
const BILLBOARD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Cria um `InstancedMesh` de planos que sempre encaram a câmera.
 *
 * Sprite de verdade (`THREE.Sprite`) seria um draw call por planta — com centenas delas isso
 * desfaz todo o ganho do instancing. Como a câmera do jogo só gira em torno do Y, dá pra chegar no
 * mesmo resultado recompondo as matrizes com o mesmo ângulo a cada frame: umas centenas de
 * `compose` por frame não custam praticamente nada.
 */
export function addBillboards(
  scene: THREE.Scene,
  texture: THREE.Texture,
  instances: BillboardInstance[]
): BillboardGroup | null {
  if (instances.length === 0) return null;

  const image = texture.image as HTMLCanvasElement;
  const aspect = image.width / image.height;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    // corta o fundo transparente em vez de misturar: sem isso os sprites se recortam uns aos
    // outros conforme a ordem de desenho, o que fica bem feio numa fileira de árvores
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    // MeshBasic = sem luz nenhuma, que é como sprite de console se comporta (já vem "pintado")
    fog: true,
  });

  // plano de 1x1 com o pivô na BASE, pra planta se apoiar no chão em vez de flutuar pelo centro
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0, 0.5, 0);

  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  mesh.frustumCulled = false; // o bounding box não acompanha a regiração por frame
  scene.add(mesh);

  function update(cameraYaw: number) {
    billboardQuaternion.setFromAxisAngle(BILLBOARD_UP, cameraYaw);
    for (let i = 0; i < instances.length; i++) {
      const it = instances[i];
      billboardPosition.set(it.x, it.groundY, it.z);
      billboardScale.set(it.height * aspect, it.height, 1);
      billboardMatrix.compose(billboardPosition, billboardQuaternion, billboardScale);
      mesh.setMatrixAt(i, billboardMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(0);
  return { update };
}
