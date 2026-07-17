import { createServer } from "http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RaceRoom } from "./rooms/RaceRoom";

const port = Number(process.env.PORT || 2567);
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Top Gear Test — servidor de corrida online");
});

const server = new Server({
  transport: new WebSocketTransport({
    server: createServer(app),
  }),
});

server.define("race", RaceRoom);

server.listen(port);
console.log(`Servidor Colyseus rodando na porta ${port}`);
