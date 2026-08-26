# GoLive

Transmita sua tela para várias pessoas ao mesmo tempo, sem cadastro.

## Quick Start

```bash
git clone https://github.com/Nem-Tudo/group-sharescreen.git
cd group-sharescreen
npm install
```

Configure as variáveis de ambiente:

```bash
cp .env.example .env.local
# Edite .env.local com suas credenciais
```

Inicie o servidor de sinalização (API) separadamente:

→ https://github.com/Nem-Tudo/group-sharescreen-api

Rode o frontend:

```bash
npm run dev
```

Acesse http://localhost:3000

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `NEXT_PUBLIC_SIGNALING_URL` | Sim | URL do WebSocket da API (ex: `wss://api.example.com/ws`) |
| `GIPHY_API_KEY` | Não | Chave da API GIPHY para busca de GIFs |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | Não | ID do site no Umami (analytics) |
| `NEXT_PUBLIC_TURN_URLS` | Não | Servidores TURN para conexões P2P |
| `NEXT_PUBLIC_TURN_USERNAME` | Não | Usuário TURN |
| `NEXT_PUBLIC_TURN_CREDENTIAL` | Não | Credencial TURN |

## Deploy com Docker

```bash
docker build \
  --build-arg NEXT_PUBLIC_SIGNALING_URL=wss://api.seudominio.com/ws \
  -t golive .
```

```bash
docker run -p 3000:3000 golive
```

Ou use o docker-compose na raiz do projeto:

```bash
docker-compose up -d
```

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Desktop:** Electron 38
- **Comunicação:** WebRTC (mesh/cascade), WebSocket (signaling)
- **API:** [group-sharescreen-api](https://github.com/Nem-Tudo/group-sharescreen-api)

## Estrutura

```
├── app/              # Páginas Next.js (WatchRoom, salas, admin)
├── components/       # Componentes React (VideoTile, Chat, etc)
├── lib/              # Lógica de domínio (WebRTC, signaling, hooks)
├── electron/         # Shell desktop (Electron)
└── docs/             # Documentação interna
```

## Links

- **Produção:** https://golive.nemtudo.me
- **API:** https://github.com/Nem-Tudo/group-sharescreen-api
- **Estatísticas:** https://stats.nemtudo.me/public-dashboards/9be4846ec8774ff5888baa7d33862ccc
- **Tutorial:** https://x.com/NemTudo_/status/2089763840959414477

## Licença

MIT
