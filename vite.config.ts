import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
    host: true, // expõe o dev server pra outros aparelhos na mesma rede (não só localhost)
  },
});
