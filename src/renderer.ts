/**
 * O renderer e o canvas do jogo.
 *
 * São ÚNICOS pra toda a sessão, de propósito: um `WebGLRenderer` é um contexto WebGL, e criar um
 * por corrida (ou um por jogador, na tela dividida) é caro e arrisca estourar o limite de contextos
 * do navegador. A tela dividida desenha a MESMA cena duas vezes neste mesmo canvas, trocando
 * `viewport`/`scissor` entre os dois passes — ver `race/viewports.ts`.
 *
 * O que muda por corrida é a CENA (`race/scene.ts`), não o renderer.
 */

import * as THREE from "three";
import { VISUAL, wantsAntialias, applyResolution } from "./retro";
import type { RenderSize } from "./retro";

const app = document.getElementById("app")!;

export const renderer = new THREE.WebGLRenderer({ antialias: wantsAntialias });
renderer.shadowMap.enabled = !VISUAL.flatLighting;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

let size: RenderSize = { width: 1, height: 1 };
const listeners = new Set<(size: RenderSize) => void>();

// resolução interna baixa + esticada com pixel quadrado no tema retrô (cuida do resize também)
applyResolution(renderer, (next) => {
  size = next;
  for (const listener of listeners) listener(size);
});

/** Tamanho atual do buffer, nas unidades que `setViewport`/`setScissor` usam. */
export function renderSize(): RenderSize {
  return size;
}

/** Avisa quando a janela muda de tamanho. Devolve a função que cancela a inscrição. */
export function onRenderResize(listener: (size: RenderSize) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Devolve o renderer ao estado de tela cheia.
 *
 * Chamado quando uma corrida em tela dividida termina: `scissorTest` e `viewport` são estado
 * GLOBAL do renderer, então sem isso a corrida seguinte (ou a tela de menu) continuaria desenhando
 * só na metade da tela.
 */
export function resetViewport() {
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size.width, size.height);
  renderer.setScissor(0, 0, size.width, size.height);
}
