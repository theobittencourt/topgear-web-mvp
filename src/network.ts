import { Client, Room, getStateCallbacks } from "colyseus.js";

// em produção (client na Vercel, servidor na Railway) os dois ficam em domínios diferentes, então
// a URL do servidor vem de uma env var setada no build da Vercel (VITE_SERVER_URL=wss://...).
// Sem essa env var (dev local ou acesso pela rede WiFi), cai no fallback: mesmo host que serviu a
// página, na porta 2567, com ws/wss escolhido a partir do protocolo da própria página — assim
// funciona tanto em localhost quanto acessando por http://192.168.x.x:5174.
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ||
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:2567`;

export interface CarNetState {
  name: string;
  color: number;
  isBot: boolean;
  x: number;
  z: number;
  heading: number;
  speed: number;
  lapCount: number;
}

/** Cria uma sala nova e já entra nela como host — o código pra compartilhar é `room.roomId`. */
export async function createLobby(name: string, color: number, mapId: string): Promise<Room> {
  const client = new Client(SERVER_URL);
  return client.create("race", { name, color, mapId });
}

/** Entra numa sala existente a partir do código que o host compartilhou. */
export async function joinLobby(code: string, name: string, color: number): Promise<Room> {
  const client = new Client(SERVER_URL);
  return client.joinById(code, { name, color });
}

export { getStateCallbacks };
