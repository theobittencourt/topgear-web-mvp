import { Schema, MapSchema, type } from "@colyseus/schema";
import { CarState } from "./CarState";

export class RaceState extends Schema {
  @type({ map: CarState }) cars = new MapSchema<CarState>();
  @type("string") mapId: string = "estadio";
  /** "waiting" (lobby) -> "countdown" (sincronizado pra todo mundo) -> "racing" -> "finished" */
  @type("string") phase: "waiting" | "countdown" | "racing" | "finished" = "waiting";
  @type("string") hostSessionId: string = "";
  @type("number") countdown: number = 0;
  /** sessionId (ou id de bot) do carro que bateu TOTAL_LAPS primeiro — vazio até a corrida acabar. */
  @type("string") winnerId: string = "";
}
