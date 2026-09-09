import { Schema, type } from "@colyseus/schema";

export class CarState extends Schema {
  @type("string") name: string = "JOGADOR";
  @type("number") color: number = 0xe8e8e8;
  @type("boolean") isBot: boolean = false;

  @type("number") x: number = 0;
  @type("number") z: number = 0;
  @type("number") heading: number = 0;
  @type("number") speed: number = 0;

  @type("number") lapCount: number = 0;
  /** cargas de turbo que sobraram */
  @type("number") nitroCharges: number = 0;
  /** se o turbo está queimando agora — o client usa só pra acender o indicador */
  @type("boolean") nitroActive: boolean = false;
  /**
   * Score de ranking, monotônico ao longo da corrida: `voltas * nWaypoints + waypoints já passados`.
   * Sincronizado porque o CLIENT não deve recontar progresso por conta própria — ele fazia isso em
   * cima da posição já suavizada pelo lerp de render, então o leaderboard/HUD de cada jogador podia
   * discordar do que o servidor tinha de fato contado.
   */
  @type("number") progress: number = 0;
  /** Vaga na grid de largada, decidida pelo servidor — o client só posiciona o mesh onde mandaram. */
  @type("number") gridSlot: number = 0;

  // input atual do jogador (o servidor simula a física, o client só manda intenção)
  throttle: number = 0;
  brake: number = 0;
  steer: number = 0;
  /** segundos restantes da carga de turbo em uso; só no servidor, não sincroniza */
  nitroTimer: number = 0;
}
