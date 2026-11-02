# Qualidade da transmissão

Como a transmissão decide o que enviar para cada pessoa, e o que ela faz quando
falta alguma coisa.

## O princípio

É malha P2P: **um encode por espectador**, na máquina de quem transmite. Por isso
a pergunta que decide quase tudo é quanto custa um encode, e não o que ele
consegue fazer num dia bom.

1. Cada espectador recebe a qualidade que a tela dele usa, com piso de 576p.
   Numa sala de 30 pessoas o tile da grade tem ~320×216 px, e mandar 1080p para
   ele joga fora ~95% dos pixels, na CPU **e** no upload.
2. Quem não está olhando não custa nada: o encoder dele para (`active=false`).
3. Reduzir é a última opção, só com prova de que a imagem está sofrendo, e tudo
   que for tirado volta sozinho.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `lib/videoQuality.ts` | Tiers, tamanho renderizado → tier, teto de bitrate |
| `lib/qualityNegotiation.ts` | Espectador diz o tamanho do tile e se está olhando. Pedir mais é imediato, pedir menos espera |
| `lib/streamUse.ts` | Quem precisa dos quadros de um tile fora da tela (clipe, gravação, PiP, fundo da câmera) segura o stream |
| `lib/peerQualityController.ts` | Junta tier, link e máquina e aplica no sender |
| `lib/sendAdaptation.ts` | `LinkAdapter` (um por conexão) e `MachineGovernor` (um por máquina). Puro, testado |
| `lib/videoCodecPreferences.ts` | Qual codec e qual `contentHint`, com a tabela medida |
| `lib/mediaStats.ts` | **Uma** passada de `getStats()` para tudo |
| `lib/classicSend.ts` | Experiment `sq-classic-send`: a volta atrás, sem deploy |
| `lib/nativeVideoSink.ts` + `.worker.ts` | Captura por GPU do app: o lockstep, fora da thread principal |

O servidor repassa o `data` de um `signal` de forma opaca, então `quality` (e o
campo `idle`) trafegam sem mudança na API.

## O quality scaler do WebRTC está fora, de propósito

Sob `maintain-framerate` ou `balanced`, o WebRTC corta a resolução quando o QP
fica alto (H264: acima de 37) e só devolve abaixo de 24. A estimativa de banda
começa em ~300 kbps, então quase todo H264 era cortado nos primeiros segundos, e
na resolução menor o QP fica logo acima do limite, por mais bits que sobrem. No
laboratório, sem limite de rede nenhum, 1080p ia para 270p, subia para 540p e
ficava ali com 4 Mbps sobrando, rotulado `bandwidth`. Uma queda do link ou um
tile escondido cortava mais. Em produção era 25% do tempo de envio.

Por isso todo sender roda em `maintain-resolution`, que deixa o scaler de fora, e
`lib/sendAdaptation.ts` faz esse trabalho com duas diferenças: age com prova de
que a imagem sofre (quadros perdidos contra o que a captura entregou) e devolve
sozinho o que tirou.

- **`LinkAdapter`**: faltam bits para *este* espectador. Desce um degrau de
  altura depois de sustentado (`motion` e `balanced` 4 s, `text` 8 s: mais que uma
  rajada de rolagem), nunca nos primeiros 8 s de conexão, e nunca abaixo do piso do
  perfil (`text` 720p, `balanced` 576p, `motion` 360p). Sobe depois de 15 s sem
  falta, quando o link melhorou, o QP sobra ou a tela está parada, e de uma vez só
  (em 8 s) se o link dobrou. Subir e faltar de novo dobra a espera, até 5 min. O
  bitrate **não** é reduzido: o estimador só descobre que o link voltou se puder
  usá-lo. Se a estimativa desabou (menos da metade do que o próximo degrau precisa),
  desce de uma vez até onde ela alcança, porque cada degrau seriam mais 4 s a 1 ou 2 fps.
- **`MachineGovernor`**: os encoders não dão conta, e a CPU é uma só, então vale
  para todas as conexões. Cada perfil guarda o que promete: `text` os pixels,
  `motion` os quadros. Aqui o bitrate cai junto com a altura, porque bits também são
  CPU. Pula os degraus que não mudariam nada e volta depois de 20 s de calma,
  dobrando se recair.

A diferença entre os dois é `encoderBusy`: cada quadro leva mais de 60% do tempo que
o fps permite (150% no hardware, onde o número é a viagem pela GPU, fila incluída),
**e** o encoder passa ao menos 30% do tempo em quadros. Sem a segunda parte, 20 ms por
quadro a 1 fps, que é um link que desabou, passava por máquina sem CPU: o link não
reagia, e a máquina segurava todo mundo por causa de um espectador.

A máquina olha a **média** das conexões, e não uma por uma, porque os encoders não
dividem a CPU por igual. Três espectadores em dois núcleos ficam em 29, 30 e 22 fps, e
cortar todo mundo por causa do terceiro dava 30 fps a 37,7 dB onde 27 fps a 42,7 dB era
a imagem melhor. Quem está atrás com o encoder folgado fica fora da conta: é o link dele.

## Codec

**H264 em modo câmera para tudo.** É malha: um encode por espectador e um decode por
tile, então o que decide é o custo nas duas pontas. Tela real de 1920×1024 a 30 fps,
encoders de software, comparando com o quadro de referência exato. Fps com 6
espectadores em 4 núcleos (vídeo / rolagem), núcleos por espectador (idem), PSNR a 4
Mbps (vídeo / rolagem / janela arrastada) e o custo de um tile para quem assiste:

| | 6 espectadores, 4 núcleos | núcleos | PSNR | quem assiste |
|---|---|---|---|---|
| H264 câmera | 28,3 / 28,8 | ,53 / ,37 | 39,5 / 35,6 / 42,8 | ,06 |
| VP8 tela | 14,9 / 16,0 em ~620p | ,61 / ,48 | 42,6 / 34,9 / 45,4 | ,25 |
| H264 tela | 19,2 / 12,9 | ,54 / ,94 | 41,4 / 33,4 / 39,5 | ,05 |
| VP9 tela | 6,0 / 11,6 | 1,34 / ,79 | 44,2 / 36,3 / 46,3 | ,27 |

- **VP9 em modo tela** era o padrão da maioria. Fica em 18–21 fps seja qual for o
  bitrate, e depois de uma pausa manda 2 fps durante uma rolagem. Era a "imagem
  travada em conexão boa", e nenhum contador de travada vê isso, porque o intervalo
  médio entre quadros também sobe. O PSNR dele é alto justamente porque manda poucos
  quadros.
- **OpenH264 em modo tela** pesa na rolagem e desaba em conteúdo ruidoso (1,8 fps).
- **OpenH264 em modo câmera** é o mais barato nas duas pontas e, quando a tela para,
  continua refinando: 48 dB contra 41 do VP8.
- **VP8** só fica à frente em vídeo com pouca banda (35,2 dB contra 30,7 a 1,5 Mbps),
  e atrás em texto (25,3 contra 29,1). Fica como segunda opção, para quem não tem H264.
- **H264 de hardware** dá o mesmo nos dois modos, e pode cair para OpenH264 no meio da
  transmissão, onde o modo câmera é o que dá conta. Em produção: 26,6 fps a 783 linhas,
  contra 21,4 a 601 do OpenH264.

Os perfis deixaram de escolher codec e modo do encoder: agora dizem o que abrir mão
primeiro quando algo falta.

**Com H264, a captura tem um mínimo de quadros** (`stillScreenFloor`, 5 fps ou mais
nos dials altos). Tela parada entrega ~1 quadro por segundo, o WebRTC repassa essa
taxa ao encoder, e o encoder da AMD recusa uma meta de ~4 Mbit por quadro (`Couldn't
set mean bitrate`, 0x80070057): a conexão cai para software na primeira vez que a
tela para com a estimativa em 4 Mbps, e fica lá. No laboratório, caía em todas as
rodadas com pausas, e não caiu em nenhuma com o mínimo. Repetir um quadro de tela
parada quase não custa nada. `getDisplayMedia` não aceita `min`, então entra com
`applyConstraints` depois de capturar, **sempre com largura e altura junto**: sem elas
a captura cai para 800×426.

**A imagem sai sempre com lados pares** (`scaleForHeight`). Encoder H264 de hardware
recusa lado ímpar (`Hardware encoder initialization failed`) e a conexão cai para
software sem avisar. A escala arredondada em 1,88 fazia 1021×574 de uma tela 1080p,
então todo tile pequeno em máquina com GPU pagava um encode de software. O tamanho
de verdade vem do `media-source` do `getStats`, porque o de `track.getSettings()`
pode não bater com os quadros numa captura de janela ou de aba.

## Quem não está olhando

Um tile fora da tela por 8 s manda `quality` com `idle: true`, e aquele encoder
para (`encodings[0].active = false`). Na volta o pedido sai na hora, com reenvio
(o socket descarta o que não consegue enviar enquanto reconecta). Um alt-tab
rápido não custa nada. Quem transmite com código antigo lê só o tier, que é o
menor que existe, e continua funcionando como antes.

O áudio não é afetado: é outro sender.

Quem precisa dos quadros de um tile fora da tela usa `retainStream`: o buffer de
clipes (o atalho global funciona com a janela minimizada), a gravação do tile, a
gravação da chamada, o `DockedPip` e o fundo de câmera com transmissão. Ao criar
um consumidor novo de stream remoto que não seja o próprio tile, **segure o
stream**, ou ele congela depois de 8 s fora da tela.

Nos relatórios, trechos pausados não contam como fps zero nem como travada
(`pausedShare`).

## Captura por GPU (app desktop)

O helper nativo já entrega H264 pronto. Para o WebRTC, cada conexão tem um track
substituto de 16×16, e um transform troca cada quadro codificado dele pelo do helper,
um por um. Um quadro perdido em qualquer ponto da corrente são 300 ms de nada e um
recomeço no próximo IDR.

Em produção isso era 16,6% do tempo parado e 26 travadas por minuto, com o fps
parecendo perfeito. A causa é o limitador de quadros do WebRTC: ele joga fora o quadro
que chega antes do intervalo de `maxFramerate`, olhando a hora de chegada e não o
timestamp, e os quadros chegam em rajada sempre que a página está ocupada ou o pipe do
helper é lido em blocos. O que foi feito:

- `MIN_WRITE_GAP_MS` espaça as escritas no substituto, e `NATIVE_SENDER_MAX_FPS` tira
  o limitador da frente. Isso já vale para quem está com o app antigo.
- A corrente roda num worker (`lib/nativeVideoSink.ts` + `.worker.ts`), fora da thread
  principal. O arquivo servido é `public/workers/native-video-sink.js`, gerado por
  `npm run workers:build`. Um teste falha se ele estiver velho. Ao mudar o que ele faz,
  aumente `SINK_WORKER_VERSION`.
- Um app novo entrega os quadros direto ao worker por uma `MessagePort`, sem passar pela
  página. Precisa de release do desktop; o app antigo ainda vê o atraso da página como
  uma travada curta, mas sem recomeçar a corrente.
- O timestamp é a hora real da captura, que é de onde vem o RTP pelo qual quem assiste
  ritma a exibição.

No laboratório, com helper falso (WebCodecs num Worker) e o módulo real. **Nunca rode o
helper de verdade num teste: ele captura a tela de quem está na máquina.** Com a página
ocupada 100 ms por segundo, de 50 travadas por minuto a 18,9 fps para 0 a 30 fps. Com
300 ms a cada 2,5 s, de 42 para 21 pelo caminho antigo, e 0 pela porta nova, no Chromium e
no Electron 38.

## Decisões que valem saber

**Framerate não é decidido por tamanho de tile.** Diminuir a janela não pode
significar "quero 15fps". Tamanho escolhe resolução; framerate cai só sob pressão.

**Não existe 576p60, de propósito.** O piso é onde *todo* tile pequeno cai, e o
desempate por resolução prefere o framerate maior: um degrau de 60fps ali
entregaria 60fps às 29 miniaturas de uma grade de uma vez.

**4K e 120 fps são degraus de verdade.** O dial de 240 fps é enviado a 120, o
degrau mais rápido. O espectador pede no fps máximo da escada (`MAX_TIER_FPS`) e o
dial de fps de quem transmite é que limita.

**O que vai para o encoder é teto, não média.** O sender recebe
`encoderCeilingKbps()`, a média do tier com folga (×2) limitada pelo dial. O dial
padrão ("alto") é 6 Mbps porque o H264 precisa: um vídeo em 1080p vai de 39,3 dB a 4
Mbps para 42,6 a 6, com 7% a mais de CPU, e a estimativa de banda segura o que o link
não carrega. Teto na média corta exatamente os momentos que precisam de mais bits, e em
`maintain-resolution` esse corte sai como quadro derrubado. O preço está numa queda
brusca do link, de 10 Mbps para 900 kbps: a 6 Mbps a estimativa desaba até ~200 kbps,
onde a 4 Mbps fica em ~800, e isso custa de 1 a 2 s a mais abaixo de 10 fps. Uma queda
para 3 Mbps não desaba em nenhum dos dois.

**Os três dials são independentes.** Resolução limita pixels, fps limita quadros,
bitrate limita bits. `capTier()` limita as duas dimensões separadamente.

**Sem cascata.** Havia retransmissão por outros participantes e um planejador de
topologia. Em 14 dias e quase 2 milhões de relatórios, nenhuma sessão passou por
ela, então saiu. Navegador não faz passthrough de RTP: cada salto seria decode +
encode completos, gastando a CPU e o upload de um participante.

**Sem repetir o que o WebRTC já faz.** Uma camada antiga cortava o bitrate por
conta própria sobre o controle de congestionamento dele. Ela respondia a uma
razão que caía em sessões de 2,7% do tempo, e a amostra de `recv-codec`,
`stream-perf` e `own-turn` foi lida antes de sair: nenhum ganho em fps nos dois
primeiros, e do terceiro ficou o TURN próprio por TCP (2134 kbps a 21,2 fps contra
1537 a 20,4 por UDP, sem mais perda).

## Diagnóstico ("fica ruim só com certas pessoas")

Tudo acima *age* sobre a qualidade. Para responder se o problema é a máquina de
quem transmite, a rota do par ou o TURN, há uma camada que só observa:

| Arquivo | Responsabilidade |
|---|---|
| `lib/connectionDiagnostics.ts` | Lê um `getStats()` inteiro: rota, encoder/decoder hardware×software, fps, perda, quadros descartados, travadas → causas prováveis. Puro, testado |
| `lib/connectionRegistry.ts` | Registro global dos PCs de vídeo para a UI e a telemetria lerem sem props |
| `lib/connectionDiagLink.ts` | Sinais `diag-request`/`diag`: quem transmite manda a sua metade para o espectador com o painel aberto |
| `components/ConnectionStatsOverlay.tsx` | "Estatísticas da conexão" no tile remoto |
| `components/ViewerConnectionList.tsx` | "Por espectador" nas medições de quem transmite |
| `lib/connectionTelemetry.ts` + `connectionTelemetrySummary.ts` | Um resumo por conexão ao fim da sessão → `POST /telemetry/connection-quality`. Todas as sessões ruins + `NEXT_PUBLIC_QUALITY_TELEMETRY_SAMPLE` das boas |
| `app/admin/ConnectionQualityPanel.tsx` | Aba "Qualidade" do admin |

Na API: `connectionQualityReport.ts` (validação, testada),
`connectionQualityModels.ts` (coleção `connection_quality_reports`, TTL de 14
dias), `connectionQualityStore.ts` e `connectionQualityRoutes.ts`.

Os relatórios de envio trazem `linkCapShare`, `machineCapShare` e `pausedShare`
além do que o encoder fez. Uma conexão que nunca subiu traz `iceLocal`, `iceRemote`,
`icePairs` e `iceResponses`: sem candidatos próprios é STUN bloqueado, sem candidatos
do outro lado é a sinalização que perdeu, e os dois sem nenhuma resposta às checagens
são NATs que não se deixam passar, o que só relay resolve. Sessões boas são amostradas
em 20%, então qualquer média precisa do peso (ruim 1, boa 5), e uma análise por par
precisa do peso dos dois lados. Freezes de tela contam pausas estáticas (um link
perfeito dá 70% "travado" num encoder de software), então olhe fps e quedas, não só
freezes.

## O que se mediu

Uma máquina (Ryzen 5 3500, AMD, Chrome), captura real de uma aba em 1920×1024 e 30 fps,
PSNR contra o quadro de referência exato. "Antes" é o padrão de produção de então, VP9 em
modo tela. Quando o fps é muito baixo o PSNR de "antes" engana: são poucos quadros, cada
um com muitos bits.

| Cenário | fps | Linhas | PSNR (dB) | Núcleos de quem envia | Núcleos de quem assiste |
|---|---|---|---|---|---|
| Vídeo, sem limite | 20,2 → 29,8 | 1024 | 44,4 → 42,4 | 1,32 → 0,58 | 0,25 → 0,07 |
| Rolagem, sem limite | 18,7 → 29,8 | 1024 | 36,4 → 37,4 | 0,76 → 0,42 | 0,18 → 0,06 |
| Rajadas com pausas | 1,9 → 11,1 | 1024 | 43,5 → 48,6 | 0,13 → 0,13 | 0,04 → 0,03 |
| Ruído | 16,5 → 25,3 | 1024 → 773 | 22,2 → 20,6 | 1,36 → 0,38 | 0,23 → 0,06 |
| Vídeo, link de 3 Mbps | 19,4 → 28,7 | 1024 → 786 | 42,8 → 35,6 | 1,20 → 0,38 | 0,24 → 0,06 |
| Vídeo, link de 1,5 Mbps | 19,4 → 29,1 | 1024 → 589 | 39,3 → 32,6 | 1,05 → 0,26 | 0,21 → 0,06 |
| Rolagem, link de 1,5 Mbps | 20,3 → 29,2 | 1024 | 31,5 → 29,6 | 0,72 → 0,31 | 0,16 → 0,06 |
| Vídeo, link de 800 kbps | 16,8 → 20,8 | 1024 → 576 | 35,0 → 29,6 | 0,84 → 0,23 | 0,17 → 0,04 |
| 3 espectadores, sem limite | 15,1 → 29,7 | 1024 | 45,5 → 42,5 | 3,42 → 1,83 | 0,58 → 0,11 |
| 3 espectadores, 2 núcleos | 5,3 → 26,8 | 1024 | 48,4 → 42,8 | 1,69 → 1,49 | 0,33 → 0,11 |
| 6 espectadores, 4 núcleos | 5,4 → 25,8 | 1024 | 48,6 → 42,9 | 3,24 → 2,97 | 0,56 → 0,16 |
| 6 espectadores, 2 núcleos | 2,9 → 20,0 | 1024 → 850 | 48,6 → 38,6 | 1,90 → 1,64 | 0,35 → 0,13 |
| 3 espectadores, 1 núcleo | 2,7 → 21,2 | 1024 → 826 | 48,8 → 38,1 | 0,89 → 0,81 | 0,18 → 0,08 |
| Rolagem a 60 fps, 3 espectadores | 26,2 → 59,2 | 1024 | 34,7 → 36,0 | 3,41 → 2,28 | 0,73 → 0,17 |

Quem escolhia "Vídeo/jogo" saía de H264 preso em 214 linhas (23,4 dB) para 1024 linhas
(42,7 dB) nos mesmos 30 fps, a 0,58 núcleo em vez de 0,12.

Com o encoder da AMD, sem limite: vídeo de 19,1 para 29,9 fps, de 1,32 para 0,09 núcleo.
O cenário em que o fps caiu é esse encoder em link curto: a 1,5 Mbps, de 19 para 12–14 fps,
em 576 linhas. O controle de taxa dele estoura a meta em cerca de 2×, o WebRTC
joga quadros fora para compensar, e o modo de tela não resolve (16,9 fps). Hardware é 17%
do tempo de envio em produção, e quase todo em links largos, então pesa pouco. NVIDIA,
Intel, Safari e Android não foram testados.

Numa queda brusca do link, de 10 Mbps para 900 kbps, o envio novo fica pior por uns
segundos: ~8 s abaixo de 10 fps, onde o VP9 ficava 2 s, porque enviava menos e a estimativa
não desabava. Depois roda a 25–30 fps em 576 linhas, e volta sozinho a 1024 linhas uns 20 s
depois de o link voltar. Com o encoder da AMD são 17–20 s abaixo de 10 fps, pelo motivo
acima. Quedas menores não têm isso: para 3 Mbps, nenhum segundo abaixo de 10 fps; para 1,5
Mbps, 2 s.

O upload dobra quando o link deixa: de ~2,7 para ~6 Mbps por espectador. É daí que vem a
nitidez em vídeo, e é a estimativa de banda quem segura em links menores.

## Comparar e reverter

O experiment `sq-classic-send` (0%) devolve o envio de antes: preferência por
perfil, VP9 fora do `motion`, sem adaptadores nem pausa. Serve para
reverter sem deploy e para comparar em `connection_quality_reports`, onde o grupo
aparece em `experiments` como `sq-classic-send=on`. Com ele em 50% logo depois do deploy,
os dois envios rodam lado a lado com o tráfego real, que é a comparação que o laboratório
não faz. Compare fps e altura: a taxa de sessões "ruins" não é comparável entre os dois,
porque tela parada e espectador pausado contam de outro jeito.

## Verificar

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
