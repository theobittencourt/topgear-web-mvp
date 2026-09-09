import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Física, geometria da pista e regras da corrida moram num lugar só, importado pelos DOIS
      // lados. Ficam dentro de `server/` porque o servidor é a autoridade no multiplayer (e porque
      // assim o `COPY src ./src` do Dockerfile já leva tudo, sem mexer no deploy).
      "@shared": fileURLToPath(new URL("./server/src/shared", import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    host: true, // expõe o dev server pra outros aparelhos na mesma rede (não só localhost)
  },
});
