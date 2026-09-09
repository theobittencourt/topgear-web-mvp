import * as THREE from "three";
import { WAYPOINT_RADIUS } from "@shared/rules";

export class RaceProgress {
  private waypoints: THREE.Vector3[];
  private nextIndex: number;
  /** índice do waypoint mais próximo da linha de chegada visual — é aqui que a volta conta como completa. */
  private finishIndex: number;
  private lapStartTime = performance.now();

  lapCount = 0;
  lastLapTime: number | null = null;
  bestLapTime: number | null = null;
  finished = false;

  constructor(waypoints: THREE.Vector3[], spawnIndex: number, finishIndex: number) {
    this.waypoints = waypoints;
    this.nextIndex = (spawnIndex + 1) % waypoints.length;
    this.finishIndex = finishIndex;
  }

  update(position: THREE.Vector3) {
    if (this.finished) return;

    const target = this.waypoints[this.nextIndex];
    // distância só no plano (x,z) — ignora a elevação (y), senão um carro levemente fora de
    // sincronia com a altura da pista poderia nunca "alcançar" o waypoint. O porquê do valor do
    // limiar está documentado junto com a constante, em @shared/rules.
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < WAYPOINT_RADIUS) {
      this.nextIndex = (this.nextIndex + 1) % this.waypoints.length;

      if (this.nextIndex === this.finishIndex) {
        const now = performance.now();
        const lapTime = now - this.lapStartTime;
        this.lapStartTime = now;
        this.lapCount++;
        this.lastLapTime = lapTime;
        if (this.bestLapTime === null || lapTime < this.bestLapTime) {
          this.bestLapTime = lapTime;
        }
      }
    }
  }

  resetLapClock() {
    this.lapStartTime = performance.now();
  }

  currentLapElapsed(): number {
    return performance.now() - this.lapStartTime;
  }

  /** Score monotonicamente crescente conforme o carro avança na corrida — usado pra ranking. */
  score(): number {
    const progress = (this.nextIndex - this.finishIndex + this.waypoints.length) % this.waypoints.length;
    return this.lapCount * this.waypoints.length + progress;
  }
}

/**
 * Cronômetro de volta puro, SEM lógica de progresso. Usado no multiplayer, onde quem decide que
 * uma volta terminou é o servidor (`car.lapCount`) — o client só marca o tempo quando aquele
 * contador muda. Antes o client rodava um `RaceProgress` inteiro por cima da posição já suavizada
 * pelo lerp de render, ou seja, duas contagens de volta independentes que podiam discordar na tela.
 */
export class LapClock {
  private lapStartTime = performance.now();

  lastLapTime: number | null = null;
  bestLapTime: number | null = null;

  reset() {
    this.lapStartTime = performance.now();
    this.lastLapTime = null;
    this.bestLapTime = null;
  }

  /** Chame quando o servidor incrementar a volta desse carro. */
  completeLap() {
    const now = performance.now();
    const lapTime = now - this.lapStartTime;
    this.lapStartTime = now;
    this.lastLapTime = lapTime;
    if (this.bestLapTime === null || lapTime < this.bestLapTime) {
      this.bestLapTime = lapTime;
    }
  }

  currentElapsed(): number {
    return performance.now() - this.lapStartTime;
  }
}

/** Formato clássico de jogo de corrida SNES: MM'SS"CC (minutos, segundos, centésimos). */
export function formatTime(ms: number): string {
  const totalCentis = Math.floor(ms / 10);
  const minutes = Math.floor(totalCentis / 6000);
  const seconds = Math.floor((totalCentis % 6000) / 100);
  const centis = totalCentis % 100;
  return `${minutes}'${String(seconds).padStart(2, "0")}"${String(centis).padStart(2, "0")}`;
}
