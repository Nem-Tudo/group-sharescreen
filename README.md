Transmita tela da forma mais fácil POSSÍVEL

Link engraçado:
https://antijanja.nemtudo.me

Link principal:
https://golive.nemtudo.me

Se você gosta de estatísticas assim como eu, tem o Grafana público:
https://stats.nemtudo.me/public-dashboards/9be4846ec8774ff5888baa7d33862ccc

## Deploy local com Docker Compose

O projeto sobe dois processos (Next.js na porta 3000 e o servidor de
sinalização Fastify na porta 4000) atrás de um proxy Caddy que termina TLS
em 443, usando DNS-01 challenge (Cloudflare) para emitir o certificado.

### Pré-requisitos

- Docker e Docker Compose
- Dois domínios/subdomínios apontando (registro A) para a máquina onde vai
  rodar — um para a web, outro para a sinalização (ex.: `golive.seudominio.com`
  e `ws.seudominio.com`)
- Um token de API do Cloudflare com escopo `Zone:DNS:Edit` restrito à zona
  desses domínios (em dash.cloudflare.com/profile/api-tokens — **não** use a
  Global API Key)

### Passo a passo

1. Copie o arquivo de exemplo e preencha as variáveis:
   ```
   cp .env.example .env
   ```
   No mínimo, defina `DOMAIN_WEB`, `DOMAIN_WS`, `CLOUDFLARE_API_TOKEN` e
   `NEXT_PUBLIC_SIGNALING_URL=wss://<DOMAIN_WS>/ws`. As demais (TURN, admin,
   métricas, Umami) são opcionais — veja os comentários no próprio arquivo.

2. Suba os containers:
   ```
   docker compose up -d --build
   ```
   Na primeira subida o Caddy resolve o challenge de DNS e emite os
   certificados automaticamente — pode levar alguns segundos.

3. Acompanhe os logs se precisar depurar:
   ```
   docker compose logs -f
   ```

4. Acesse `https://<DOMAIN_WEB>`. A sinalização fica em
   `https://<DOMAIN_WS>` (usada internamente pelo client, não precisa abrir
   no navegador).

### Atualizando depois de mudar código ou variáveis `NEXT_PUBLIC_*`

Variáveis `NEXT_PUBLIC_*` são embutidas no bundle em build time, então só
`docker compose up -d` não é suficiente — é preciso rebuildar:
```
docker compose up -d --build
```

### Parar

```
docker compose down
```
O histórico de chat das salas (`server/data/rooms`) e os certificados TLS
(volumes `caddy_data`/`caddy_config`) persistem entre reinicializações.
