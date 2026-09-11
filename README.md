# Top Gear Test

Jogo de corrida arcade em 3D inspirado no Top Gear do SNES, feito com TypeScript, Vite e Three.js.
Tem modo solo contra bots e modo online com sala privada, servidor autoritativo em Colyseus.

## O que tem

- pista gerada por código, com elevação, túnel, meio-fio em zebra, acostamento e faixas alternadas de chão
- cenário em sprite 2D (palmeiras, pinheiros, cactos, arbustos) e placas de seta avisando curva
- 4 circuitos, cada um com traçado e paleta próprios: **Vale Esmeralda**, **Costa Palmares**, **Distrito Meia-Noite** e **Dunas de Ocre**
- dois temas visuais: **Retrô** (resolução interna baixa, pixel grandão, luz chapada) e **Moderno** (resolução cheia, com sombra)
- 6 cores de carro pra escolher
- **modo solo**: corrida de 3 voltas contra 9 bots
- **modo online**: sala privada com código pra compartilhar, de 5 a 10 carros (jogadores e/ou bots), com o host controlando quem entra, quem sai e quando larga
- física do carro idêntica no solo e no online (o mesmo código roda nos dois lados — ver [Código compartilhado](#código-compartilhado))
- turbo com 3 cargas por corrida, funcionando igual no solo e no online
- HUD estilo retrô SNES: velocímetro com tacômetro, minimapa, tempo de volta, melhor volta, leaderboard ao vivo, badge de posição, marcha, cargas de turbo e medidor de combustível
- controles mobile por toque (acelerador/freio e joystick de direção)
- contagem regressiva de largada, banner de volta e tela de vitória
- menus com identidade própria: logo, paleta tirada da arte, som de clique e navegação pra trás em todas as telas

## Como rodar localmente

### Só o modo solo

```bash
npm install
npm run dev
```

Abre em `http://localhost:5174`.

### Com o modo online também

O multiplayer precisa do servidor Colyseus rodando junto. Em dois terminais:

```bash
npm install && npm run dev
```

```bash
cd server && npm install --legacy-peer-deps && npm run dev
```

O servidor sobe em `http://localhost:2567`. Sem nenhuma configuração extra, o client procura o
servidor no mesmo host em que a página foi servida, na porta 2567 — então funciona tanto em
`localhost` quanto acessando pelo IP da rede local (`http://192.168.x.x:5174`) pra testar com o
celular ou com outra pessoa na mesma WiFi.

> O `--legacy-peer-deps` no servidor não é opcional: o grafo de dependências do Colyseus 0.16 não
> passa no `npm ci` nem no `npm install` estrito.

## Build de produção

```bash
npm run build          # client (a Vercel roda esse)
cd server && npm run build && npm start   # servidor
```

## Deploy

- **Client**: Vercel, buildando com `npm run build`. Domínio: `topgearweb.com.br`.
  As URLs do card de compartilhamento no `index.html` são **absolutas** e apontam pra esse domínio —
  os robôs que montam a prévia (WhatsApp, Discord) não resolvem caminho relativo. Se o domínio
  mudar, elas precisam mudar junto.
- **Servidor**: Fly.io (app `topgear-web-mvp`, região `gru`/São Paulo), pelo `server/Dockerfile`.
  A máquina fica com `auto_stop_machines = false` de propósito — hibernação por inatividade
  derruba conexão WebSocket no meio da corrida.
- Em produção os dois ficam em domínios diferentes, então o client precisa da env var
  `VITE_SERVER_URL` apontando pro servidor (ver `.env.example`).

## Controles

### Desktop

| Tecla | Ação |
| --- | --- |
| W | acelerar |
| S | frear / ré |
| A | virar pra esquerda |
| D | virar pra direita |
| Espaço ou Shift | turbo (3 cargas por corrida) |

Nas telas de menu, **Esc** faz o mesmo que o botão "Voltar".

### Mobile

Os controles de toque aparecem sozinhos em telas sensíveis ao toque: botões de acelerar, frear e
turbo (`N`) de um lado, joystick de direção do outro.

## Estrutura

```
src/                     client
  main.ts                monta a cena, o fluxo de telas e os loops de jogo (solo e online)
  track.ts               malha 3D da pista, elevação, paleta e cenário instanciado
  car.ts                 modelo do carro, controle do jogador e IA dos bots
  ui.ts                  HUD e todas as telas (DOM puro, sem framework)
  retro.ts               tema visual (retrô/moderno) e direção de arte
  sprites.ts             sprites 2D de beira de pista (vegetação e placas de curva)
  collision.ts           colisão entre carros tipo bumper car
  raceTimer.ts           progresso/voltas no solo e cronômetro de volta no online
  network.ts             conexão com o servidor Colyseus

server/src/              servidor autoritativo
  index.ts               HTTP + WebSocket
  rooms/RaceRoom.ts      simulação a 30Hz, lobby, bots, contagem de voltas
  rooms/CarState.ts      estado sincronizado de cada carro
  rooms/RaceState.ts     estado da sala (fase, host, mapa, vencedor)
  shared/                código compartilhado com o client (ver abaixo)
```

### Código compartilhado

`server/src/shared/` tem o que o client e o servidor **precisam** calcular igual, importado pelos
dois lados pelo alias `@shared` (configurado no `vite.config.ts` e no `tsconfig.json`):

- `physics.ts` — constantes e o passo de física do carro
- `trackGeometry.ts` — forma e traçado de cada pista, linha de largada e vagas da grid
- `rules.ts` — voltas totais, limiares de waypoint, mínimo/máximo de carros

Mora dentro de `server/` porque o servidor é a autoridade no multiplayer, e porque assim o
`COPY src ./src` do Dockerfile já leva tudo junto, sem mexer no deploy.

Se essas coisas divergirem entre os dois lados, os sintomas são silenciosos e chatos de achar (bot
dirigindo por cima da grama, carro que não obedece direito, volta que não conta) — por isso existe
um lugar só.

## Imagens e som

```
assets/     originais em alta (NAO vao pro deploy)
public/     versões otimizadas, servidas como estão
```

Tudo que está em `public/` é copiado pro deploy do jeito que está, então lá só entra o que
realmente é servido. Os originais (1254x1254 e 1774x887, ~700 KB cada) ficam em `assets/` como
fonte pra regerar quando precisar.

| Arquivo | Uso |
| --- | --- |
| `public/icon-32.png` | favicon da aba |
| `public/icon-180.png` | ícone de atalho no iOS/Android |
| `public/logo.png` | logo das telas de menu (900px de largura) |
| `public/og-image.png` | card de compartilhamento, 1200x630 |
| `public/sound.mp3` | clique dos botões de menu |

As imagens servidas usam **paleta indexada de 128 cores**, o que é quase de graça em pixel art e
derruba muito o peso: as quatro somam ~58 KB contra os 1,4 MB dos dois originais. Pra um jogo cujo
bundle inteiro tem ~700 KB, servir o original dobraria o download da primeira visita.

O som toca só nos **botões de menu** — durante a corrida o jogo é mudo. Ver `src/audio.ts`.

## Tema visual

Na tela inicial dá pra escolher entre **Retrô** e **Moderno**. A escolha fica salva no
`localStorage` e recarrega a página — o antialias é decidido lá na criação do renderer, então não
dá pra trocar de verdade sem remontar tudo. Como a troca só aparece na primeira tela, recarregar
não custa nada.

| | Retrô | Moderno |
| --- | --- | --- |
| Resolução | interna baixa, esticada com pixel quadrado | nativa, com antialias |
| Luz | chapada, sem sombra dinâmica | sombra e luz suave |
| Céu | 16 bandas visíveis | degradê liso |
| Nuvens | não | sim |

O que **não** entra nessa conta é a direção de arte — faixas no chão, vegetação em sprite, placas
de curva, acostamento e a paleta dos mapas valem nos dois temas. Isso não é "coisa de retrô", é o
que faz o jogo parecer um arcade de corrida; o tema mexe só em fidelidade gráfica. Os dois grupos
de ajuste ficam separados em `src/retro.ts` (`VISUAL` e `ART`), com cada item ligando/desligando
sozinho pra dar pra achar o ponto certo mexendo num de cada vez.

## Modo online, por dentro

O servidor é autoritativo: o client só manda intenção (`throttle`, `brake`, `steer`) e desenha o
que voltar. Quem decide posição, velocidade, volta, ranking e vencedor é sempre o servidor.

Fluxo de uma sala: `waiting` (lobby) → `countdown` → `racing` → `finished`. Do `finished` o host
pode reiniciar, e a sala volta pro `waiting` com os mesmos carros, reaproveitando a cena 3D.

## Limitações conhecidas

- No online ainda não tem colisão entre carros nem recuperação de pista — dá pra cortar caminho
  pela grama. No solo os dois existem.
- O combustível gasta de verdade, mas o tanque vazio **não tem penalidade nenhuma** ainda: hoje é
  só tensão. Se um dia passar a penalizar, ele precisa virar estado do servidor (ver PROJETO.md).
- Os bots não usam turbo.
- Reiniciar no modo solo recarrega a página (mais simples do que resetar todo o estado na mão).
- Os carros são primitivas geométricas, não assets modelados.
