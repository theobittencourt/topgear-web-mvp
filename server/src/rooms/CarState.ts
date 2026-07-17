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

  // input atual do jogador (o servidor simula a física, o client só manda intenção)
  throttle: number = 0;
  brake: number = 0;
  steer: number = 0;
}
