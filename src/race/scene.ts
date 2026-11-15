/**
 * A cena 3D de uma corrida: luz, céu, fog, pista e a grid de largada.
 *
 * É uma cena NOVA por corrida (e não uma global reaproveitada) porque o modo local volta pro menu
 * de verdade, sem recarregar a página — então precisa existir um ponto onde tudo que a corrida
 * criou na GPU é devolvido. Ver `dispose()` no fim.
 *
 * Isto é compartilhado pelos três modos (solo, local e online): os três correm na mesma pista, com
 * a mesma grid, montada a partir da MESMA geometria que o servidor usa (`@shared/trackGeometry`).
 */

import * as THREE from "three";
import { createTrack } from "../track";
import type { TrackConfig } from "../track";
import { VISUAL, createSkyTexture } from "../retro";

export interface RaceScene {
  scene: THREE.Scene;
  waypoints: THREE.Vector3[];
  startIdx: number;
  startHeading: number;
  /** vaga na grid de largada (0, 1, 2...) — mesma fórmula que o servidor usa no multiplayer */
  gridPosition(slot: number): THREE.Vector3;
  /** regira os sprites pra encarar a câmera; precisa ser chamado uma vez POR PASSE de render */
  updateBillboards(cameraYaw: number): void;
  dispose(): void;
}

/** Clareia uma cor misturando com branco — usado só pra base do degradê do céu. */
function lightenColor(color: number, amount: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), amount).getHex();
}

export function createRaceScene(config: TrackConfig): RaceScene {
  const scene = new THREE.Scene();

  // Luz chapada: o SNES não tinha luz dinâmica nenhuma, então o ambiente vai quase no talo e o
  // "sol" fica só com o suficiente pra dar alguma leitura de volume. À noite o ambiente ainda sobe
  // um pouco pra pista não virar um breu entre um poste e outro (ver NIGHT_LAMP_LIGHT_EVERY).
  const ambientDay = VISUAL.flatLighting ? 0.9 : 0.6;
  const ambientNight = VISUAL.flatLighting ? 0.35 : 0.22;
  const sunDay = VISUAL.flatLighting ? 0.35 : 0.9;
  const sunNight = VISUAL.flatLighting ? 0.05 : 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, config.night ? ambientNight : ambientDay));
  const sun = new THREE.DirectionalLight(0xffffff, config.night ? sunNight : sunDay);
  sun.position.set(60, 100, 40);
  sun.castShadow = !VISUAL.flatLighting;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 300;
  scene.add(sun);

  // O fog fecha na cor do HORIZONTE do mapa, e os morros lá longe são pintados com essa mesma
  // cor — os dois viram uma faixa sólida só, com uma linha nítida contra o céu. É assim que o
  // horizonte do Top Gear se parece; fechar o fog na cor do céu dissolveria essa linha.
  // o céu é sempre um degradê; o que muda entre os temas é a QUANTIDADE de degraus dele —
  // poucos degraus viram bandas visíveis, muitos viram um degradê liso (ver VISUAL.skyBands)
  scene.background = createSkyTexture(config.skyColor, lightenColor(config.skyColor, 0.28));
  scene.fog = new THREE.Fog(config.horizonColor, config.night ? 60 : 110, config.night ? 220 : 400);

  // waypoints, índice/direção de largada e vagas da grid saem todos de `@shared/trackGeometry`,
  // via createTrack — é a MESMA fonte que o servidor usa no multiplayer
  const { waypoints, startIndex, startHeading, gridPosition, updateBillboards } = createTrack(
    scene,
    config
  );

  return {
    scene,
    waypoints,
    startIdx: startIndex,
    startHeading,
    gridPosition,
    updateBillboards,

    /**
     * Devolve tudo que esta cena pôs na GPU.
     *
     * Geometria, material e textura NÃO são coletados pelo garbage collector: eles vivem no
     * contexto WebGL até alguém chamar `dispose()`. Sem isso, cada "revanche" deixaria uma pista
     * inteira (milhares de instâncias de árvore, morro e meio-fio) alocada na placa de vídeo.
     */
    dispose() {
      const materials = new Set<THREE.Material>();
      const geometries = new Set<THREE.BufferGeometry>();

      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => materials.add(m));
        else if (material) materials.add(material);
      });

      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) {
        // as texturas (plantas, placas de curva) são geradas em canvas na hora, então também são
        // nossas pra liberar
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }

      if (scene.background instanceof THREE.Texture) scene.background.dispose();
      scene.clear();
    },
  };
}
