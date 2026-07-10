import * as THREE from "three";

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
    // sincronia com a altura da pista poderia nunca "alcançar" o waypoint. O limiar também
    // precisa ser maior que a metade da largura da pista, senão um carro andando perto da borda
    // (não no centro) pode nunca ficar perto o suficiente do waypoint do centro, travando a volta.
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 14) {
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

export function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}
