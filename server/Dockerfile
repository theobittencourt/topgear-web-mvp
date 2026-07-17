# build: instala tudo (inclusive devDependencies, pro tsc) e compila
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci é estrito demais pro grafo de dependências do Colyseus (ver server/nixpacks.toml pro
# mesmo problema na Railway) — usa install --legacy-peer-deps igual em todo lugar
RUN npm install --legacy-peer-deps
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# runtime: só o necessário pra rodar, sem devDependencies nem código-fonte TS
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
