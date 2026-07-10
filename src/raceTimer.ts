import * as THREE from "three";

export class RaceProgress {
  private waypoints: THREE.Vector3[];
  private nextIndex: number;
  private lapStartTime = performance.now();

  lapCount = 0;
  lastLapTime: number | null = null;
  bestLapTime: number | null = null;
  finished = false;

  constructor(waypoints: THREE.Vector3[], spawnIndex: number) {
    this.waypoints = waypoints;
    this.nextIndex = (spawnIndex + 1) % waypoints.length;
  }

  update(position: THREE.Vector3) {
    if (this.finished) return;

    const target = this.waypoints[this.nextIndex];
    const distance = target.distanceTo(position);

    if (distance < 8) {
      this.nextIndex = (this.nextIndex + 1) % this.waypoints.length;

      if (this.nextIndex === 0) {
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
    return this.lapCount * this.waypoints.length + this.nextIndex;
  }
}

export function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}
