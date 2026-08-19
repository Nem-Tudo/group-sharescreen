# GoLive / ShareScreen

Compartilhamento de tela em salas usando WebRTC P2P mesh. O Next.js serve a interface e um processo Fastify separado cuida do signaling por HTTP/WebSocket.

## Desenvolvimento somente local

```bash
npm install
npm run dev:local
```

Abra `http://localhost:8080`. O gateway encaminha o site para o Next.js em `localhost:3000`, inclusive o WebSocket de HMR do Next 16. `/ws` e as APIs HTTP sob `/signaling/*` seguem para o signaling em `localhost:4000`.

A porta padrão é `8080`. Se ela já estiver ocupada, defina uma única variável para o gateway e para os demais processos:

```bash
GATEWAY_PORT=8081 npm run dev:local
```

No PowerShell:

```powershell
$env:GATEWAY_PORT = "8081"
npm run dev:local
```

O arquivo `.env.example` registra `GATEWAY_PORT=8081` como exemplo opcional. Sem a variável, o comportamento continua usando `8080`.

## Teste público com Cloudflare Tunnel

Instale o [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) e confirme que ele está no `PATH`:

```bash
cloudflared --version
npm run dev:public
```

O comando sobe Next.js, signaling, gateway e um Cloudflare Quick Tunnel. Compartilhe o endereço HTTPS `https://...trycloudflare.com` mostrado no terminal. O navegador usa automaticamente o mesmo host para o signaling em `wss://...trycloudflare.com/ws`.

`dev:public` lê a mesma `GATEWAY_PORT` e aponta o Quick Tunnel automaticamente para ela:

```bash
GATEWAY_PORT=8081 npm run dev:public
```

```powershell
$env:GATEWAY_PORT = "8081"
npm run dev:public
```

Quick Tunnels não exigem port forwarding nem uma conta Cloudflare, mas recebem um endereço aleatório novo a cada execução. Eles são adequados para desenvolvimento/teste, não substituem o deploy de produção. O HTTPS fornecido pelo tunnel é necessário porque captura de tela para clientes remotos exige um contexto seguro.

Se `cloudflared` não estiver instalado, `dev:public` encerra os outros processos e mostra uma mensagem com o link de instalação.

## URLs do signaling

Sem configuração, o navegador deriva as URLs do `window.location`:

- página em `http://localhost:8080` → `ws://localhost:8080/ws`;
- página em `https://host.example` → `wss://host.example/ws`;
- APIs de salas/admin usam a mesma origem HTTP(S), sob `/signaling/*`, para não colidir com as páginas `/rooms` e `/admin` do Next.js.

`NEXT_PUBLIC_SIGNALING_URL` continua disponível para instalações em que signaling e frontend usam hosts diferentes. Quando definida, ela tem precedência sobre a derivação automática.

## Áudio do compartilhamento

A configuração da sala oferece três modos:

- **Somente esta janela (recomendado):** solicita `windowAudio: "window"` e `systemAudio: "exclude"` em Chrome/Edge modernos no Windows. Essa é uma preferência enviada ao navegador, não uma confirmação verificável de isolamento por processo.
- **Todo o áudio do computador:** solicita explicitamente áudio de sistema (`windowAudio: "system"`, `systemAudio: "include"`). A fonte realmente oferecida continua sob controle do navegador e do usuário.
- **Sem áudio:** chama `getDisplayMedia` com `audio: false`.

`windowAudio` é apenas uma preferência e propriedades desconhecidas são ignoradas silenciosamente pelos navegadores. Por privacidade, o modo recomendado usa uma allow-list conservadora de Chrome/Edge no Windows com suporte conhecido. Em outros ambientes ele captura somente vídeo e avisa que o isolamento está indisponível. Depois da escolha, o app inspeciona `displaySurface` e a existência da faixa de áudio; se não puder confirmar janela/aba no modo isolado, remove e encerra qualquer faixa de áudio inesperada.

O usuário sempre escolhe a fonte e confirma o áudio no seletor oficial do navegador. O site não seleciona janelas nem contorna permissões.

Durante uma transmissão, a área expansível **Diagnóstico da captura** aparece junto ao status da captura e separa o modo solicitado do resultado observado pelo navegador. Em desenvolvimento, o painel **Diagnóstico WebRTC (dev)** fica na barra lateral da sala e mostra estado de peers, tracks e ICE sem expor SDP completo nem credenciais TURN.

## Salas privadas

Ao criar uma sala privada, defina uma senha de 4 a 128 caracteres. A senha é processada somente no servidor com `scrypt` e nunca é armazenada em texto puro. Após a autenticação, o navegador recebe um token temporário limitado àquela sala; ele é mantido em `sessionStorage`, expira após 30 minutos e é enviado no payload de autorização do signaling, não na URL.

Tentativas de senha são limitadas por endereço e sala. Salas públicas continuam funcionando sem senha ou token de acesso.

## Volume do espectador

Quando uma transmissão remota contém áudio, o controle compacto no cabeçalho permite ajustar o volume local entre 0% e 300% e mutar sem perder o nível anterior. O valor é persistido no navegador e 100% corresponde ao ganho original (`GainNode` igual a 1).

Cada stream remoto usa seu próprio pipeline Web Audio. O vídeo permanece silenciado enquanto esse pipeline reproduz o áudio, evitando duplicação; nenhuma preferência de volume é enviada ao signaling ou aos outros participantes.

## ICE, STUN e TURN

O Cloudflare Tunnel cobre somente site, APIs e signaling. A mídia continua P2P entre os participantes; o tunnel **não substitui TURN**. Peers atrás de NATs incompatíveis podem não estabelecer mídia mesmo que a página e o WebSocket funcionem.

As configurações existentes permanecem disponíveis:

```text
NEXT_PUBLIC_TURN_URLS
NEXT_PUBLIC_TURN_USERNAME
NEXT_PUBLIC_TURN_CREDENTIAL
```

## Produção atual

- Principal: https://golive.nemtudo.me
- Alternativo: https://antijanja.nemtudo.me
- Repositório da API: https://github.com/Nem-Tudo/group-sharescreen-api
- URL da API: https://goliveapi.nemtudo.me
- Grafana público: https://stats.nemtudo.me/public-dashboards/9be4846ec8774ff5888baa7d33862ccc
- Tutorial: https://x.com/NemTudo_/status/2089763840959414477
