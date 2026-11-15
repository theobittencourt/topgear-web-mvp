/**
 * Uma "visão" por jogador local: câmera + pedaço da tela + container pro HUD.
 *
 * Tela cheia (1 jogador) e tela dividida (2 jogadores) são o MESMO código com `views.length`
 * diferente — é aqui que mora toda a diferença entre o solo e o local.
 *
 * Como o split é feito: UM renderer e UMA cena, desenhados duas vezes por frame com
 * `setScissorTest(true)` + `setViewport`/`setScissor`. Nada de dois canvases (dois contextos WebGL,
 * duas cópias de tudo na GPU) nem de duas cenas (duas pistas em memória, bots simulados em
 * dobro). O `scissor` é o que faz o segundo passe não limpar o que o primeiro já desenhou.
 *
 * Bônus do jeito que o tema retrô é feito: ele encolhe o BUFFER do renderer (ver
 * `retro.applyResolution`), e viewport/scissor trabalham nas unidades desse buffer — então cada
 * metade já sai pixelada na mesma proporção, sem render target nenhum por jogador.
 */

import * as THREE from "three";
import { ART } from "../retro";
import { renderer, renderSize, onRenderResize, resetViewport } from "../renderer";
import type { RenderSize } from "../retro";

export type SplitLayout = "horizontal" | "vertical";

export interface PlayerView {
  camera: THREE.PerspectiveCamera;
  /** container pro HUD desta metade (`position: absolute` dentro dele) */
  overlay: HTMLDivElement;
  /** retângulo no buffer do renderer — origem em BAIXO à esquerda, como o WebGL quer */
  rect: { x: number; y: number; width: number; height: number };
}

export interface ViewportSet {
  views: PlayerView[];
  /** Desenha a cena uma vez por jogador. `beforeEach` roda antes de cada passe (billboards). */
  render(scene: THREE.Scene, beforeEach?: (view: PlayerView, index: number) => void): void;
  dispose(): void;
}

const DIVIDER_PX = 3;

/** Ângulo em que os sprites precisam ser girados pra encarar ESTA câmera. */
const forward = new THREE.Vector3();
export function cameraYaw(camera: THREE.Camera): number {
  camera.getWorldDirection(forward);
  // usa a direção pra onde a câmera olha, invertida — ou seja, alinha os sprites com a TELA, não
  // com o ponto da câmera. É o que evita que uma planta na beirada do campo de visão fique torta.
  return Math.atan2(-forward.x, -forward.z);
}

/** Geometria de cada metade, em fração da tela (0..1), com y medido de BAIXO pra cima. */
function fractions(count: number, layout: SplitLayout) {
  if (count <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (layout === "vertical") {
    return [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ];
  }
  // horizontal (cima/baixo), o padrão: o jogador 1 fica em CIMA, que no WebGL é y = 0.5
  return [
    { x: 0, y: 0.5, w: 1, h: 0.5 },
    { x: 0, y: 0, w: 1, h: 0.5 },
  ];
}

/** Mesma geometria, mas em CSS (y de cima pra baixo), pros containers de HUD. */
function cssBox(index: number, count: number, layout: SplitLayout) {
  if (count <= 1) return { left: "0", top: "0", width: "100%", height: "100%" };
  if (layout === "vertical") {
    return { left: index === 0 ? "0" : "50%", top: "0", width: "50%", height: "100%" };
  }
  return { left: "0", top: index === 0 ? "0" : "50%", width: "100%", height: "50%" };
}

export function createViews(count: number, layout: SplitLayout = "horizontal"): ViewportSet {
  const views: PlayerView[] = [];

  for (let i = 0; i < count; i++) {
    const camera = new THREE.PerspectiveCamera(ART.camera.fov, 1, 0.1, 700);

    const overlay = document.createElement("div");
    const box = cssBox(i, count, layout);
    overlay.style.cssText = `
      position: fixed; left: ${box.left}; top: ${box.top};
      width: ${box.width}; height: ${box.height};
      z-index: 10; pointer-events: none; overflow: hidden;
    `;
    document.body.appendChild(overlay);

    views.push({ camera, overlay, rect: { x: 0, y: 0, width: 1, height: 1 } });
  }

  // linha divisória entre as metades — um elemento só, por cima do canvas. Desenhar na cena daria
  // o mesmo resultado com muito mais trabalho (e ficaria sujeita ao fog).
  let divider: HTMLDivElement | null = null;
  if (count > 1) {
    divider = document.createElement("div");
    divider.style.cssText =
      layout === "vertical"
        ? `position: fixed; left: 50%; top: 0; width: ${DIVIDER_PX}px; height: 100%;
           transform: translateX(-${DIVIDER_PX / 2}px); background: #000;
           border-left: 1px solid #fff; border-right: 1px solid #fff;
           z-index: 11; pointer-events: none;`
        : `position: fixed; left: 0; top: 50%; width: 100%; height: ${DIVIDER_PX}px;
           transform: translateY(-${DIVIDER_PX / 2}px); background: #000;
           border-top: 1px solid #fff; border-bottom: 1px solid #fff;
           z-index: 11; pointer-events: none;`;
    document.body.appendChild(divider);
  }

  function layoutViews(size: RenderSize) {
    const parts = fractions(count, layout);
    const fullAspect = size.width / size.height;
    // tan da metade do campo de visão HORIZONTAL que a tela cheia teria com este tema
    const horizontalTan = Math.tan(THREE.MathUtils.degToRad(ART.camera.fov) / 2) * fullAspect;

    views.forEach((view, i) => {
      const part = parts[i];
      view.rect.x = Math.round(part.x * size.width);
      view.rect.y = Math.round(part.y * size.height);
      view.rect.width = Math.round(part.w * size.width);
      view.rect.height = Math.round(part.h * size.height);

      const aspect = view.rect.width / Math.max(1, view.rect.height);
      view.camera.aspect = aspect;

      // O fov do three.js é VERTICAL. Mantendo-o fixo, a metade de cima/baixo passaria a mostrar o
      // DOBRO de mundo na horizontal (a pista encolhe e parece grande-angular). Então:
      //  - split cima/baixo: segura o enquadramento HORIZONTAL e corta na vertical (o fov cai);
      //  - split lado a lado: segura o VERTICAL (o fov calculado daria mais de 110°, inutilizável);
      //  - tela cheia: as duas contas dão o mesmo número, então nada muda em relação ao solo.
      const fromHorizontal = THREE.MathUtils.radToDeg(2 * Math.atan(horizontalTan / aspect));
      view.camera.fov = Math.min(ART.camera.fov, fromHorizontal);
      view.camera.updateProjectionMatrix();
    });
  }

  layoutViews(renderSize());
  const unsubscribe = onRenderResize(layoutViews);

  const split = count > 1;
  // No split a cena é desenhada 2× por frame, e CADA render() reconstrói o shadow map inteiro.
  // Atualizar a sombra em frames alternados corta esse custo pela metade e é imperceptível: o sol
  // não se move, só os carros — ver a medição em PROJETO.md.
  const shadows = renderer.shadowMap.enabled;
  if (split && shadows) renderer.shadowMap.autoUpdate = false;
  let frame = 0;

  return {
    views,

    render(scene, beforeEach) {
      if (split && shadows) {
        renderer.shadowMap.needsUpdate = frame % 2 === 0;
        frame++;
      }

      renderer.setScissorTest(split);
      views.forEach((view, i) => {
        const { x, y, width, height } = view.rect;
        renderer.setViewport(x, y, width, height);
        if (split) renderer.setScissor(x, y, width, height);
        beforeEach?.(view, i);
        renderer.render(scene, view.camera);
      });
      renderer.setScissorTest(false);
    },

    dispose() {
      unsubscribe();
      for (const view of views) view.overlay.remove();
      divider?.remove();
      if (shadows) renderer.shadowMap.autoUpdate = true;
      resetViewport();
    },
  };
}
