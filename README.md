# Top Gear Test

Jogo de corrida em 3D construído com TypeScript, Vite e Three.js.

## O que tem

- pista e carros em 3D com `three`
- direção e aceleração por teclado para desktop
- controles mobile por toque (botões de acelerar/frear e joystick de direção)
- HUD estilo retrô com velocímetro, minimapa, volta e classificação
- contagem regressiva e overlay de vitória

## Como rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:5173` no navegador.

## Build de produção

```bash
npm run build
```

## Controles

### Desktop
- W: acelerar
- S: frear
- A: virar para esquerda
- D: virar para direita

### Mobile
- Use os controles de toque que aparecem automaticamente em telas sensíveis ao toque

## Notas

- O projeto já tem suporte básico de mobile via touch
- A Vercel usa `npm run build` para compilar o app
