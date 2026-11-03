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
| `lib/sendAdaptation.ts` | `LinkAdapter` (um por conexão), `MachineGovernor` (um por máquina), `chooseSharp` (quem vai em AV1) e `PictureWatch` (em qual modo). Puro, testado |
| `lib/videoCodecPreferences.ts` | Qual codec e qual `contentHint`, com a tabela medida |
| `lib/receiveCodecs.ts` | Quem assiste em máquina fraca ou celular tira o AV1 da resposta |
| `lib/mediaStats.ts` | **Uma** passada de `getStats()` para tudo |
| `lib/h264Send.ts` | Experiment `sq-h264-send`: sem AV1, sem deploy |
| `lib/classicSend.ts` | Experiment `sq-new-send`: quem está nele usa o envio novo; quem não está, o de antes |
| `lib/screenCodec.ts` | Experiment `screen-codec`: perfil padrão e primeiro codec de quem está fora de `sq-new-send` |
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
  Em AV1, `text` nunca desce e `balanced` só desce abaixo de 320 kbps: o que falta ali é página
  densa demais para qualquer altura, e descer só tira nitidez (código rolando a 800 kbps: 12,9 fps
  a 33,6 dB em 1024 linhas, 17 fps a 29,5 em 720), e vídeo tem o modo câmera (400 kbps: 11,5 fps a
  34,9 dB em 1024 linhas, igual ao VP9). Só por volta de 300 kbps os pixels têm de sair, porque 4
  fps não é imagem em nenhuma nitidez: vídeo vai a 21 fps e 32 dB em 576 linhas.
- **`MachineGovernor`**: os encoders não dão conta, e a CPU é uma só, então vale
  para todas as conexões. Cada perfil guarda o que promete: `text` os pixels,
  `motion` os quadros. Aqui o bitrate cai junto com a altura, porque bits também são
  CPU. Pula os degraus que não mudariam nada e volta depois de 20 s de calma,
  dobrando se recair. O primeiro degrau de `balanced` e de `motion` é largar o AV1, que
  libera mais CPU que qualquer outro e não tira um pixel; `text` larga quadros antes. O
  sistema dizendo `serious` por 10 s (`PressureObserver`) também dispara esse degrau, mesmo
  sem quadro perdido: é quem está jogando na mesma máquina. `critical` por 12 s, com encoder
  de software, desce mais sem quadro perdido, mas só até 720p30 (`text`: 15 fps sem AV1): ali a
  maior parte da CPU já voltou, e dali para baixo só com quadro perdido de verdade.

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

**AV1 enquanto a máquina aguenta, H264 no modo câmera quando não.** É malha: um encode
por espectador e um decode por tile, então o custo nas duas pontas pesa tanto quanto a
imagem, e nenhum codec ganha nos dois. Tela real de 1920×1024 a 30 fps, encoders de
software, nada adaptando, comparando com o quadro de referência exato. Vídeo em fps e
PSNR, uma página branca de texto pequeno que rola de vez em quando em PSNR, e os núcleos
de quem envia e de um tile de quem assiste:

| | vídeo, livre | 3 Mbps | 1,5 Mbps | 800 kbps | página, 3 Mbps | 1,5 Mbps | envia | assiste |
|---|---|---|---|---|---|---|---|---|
| AV1 tela | 30 / 44,4 | 30 / 41,0 | 30 / 37,9 | 19 / 35,6 | 43,7 | 42,1 | 1,65 | ,36 |
| AV1 câmera | 30 / 45,8 | 30 / 43,2 | 30 / 39,6 | 30 / 36,3 | 31,4 | 25,6 | 1,32 | ,38 |
| VP9 tela | 21 / 45,0 | 21 / 42,7 | 18 / 38,8 | 17 / 35,1 | 34,8 | 26,5 | 1,44 | ,28 |
| VP9 câmera | 30 / 44,2 | 30 / 41,3 | 30 / 36,7 | 21 / 34,6 | 26,8 | 24,6 | 1,52 | ,41 |
| VP8 tela | 30 / 44,2 | 30 / 39,7 | 10 / 35,6 | 5 / 34,9 | 32,0 | 29,4 | ,69 | ,29 |
| H264 câmera | 30 / 42,5 | 30 / 35,2 | 14 / 32,9 | 8 / 33,0 | 28,4 | 27,3 | ,59 | ,07 |

- **AV1 em modo tela** é o único que mantém texto pequeno nítido em link curto, e com uma
  fração dos bits: aquela página sai a 430 kbps. Em modo câmera ele gasta tudo o que recebe
  numa página parada, estoura o link e fica pior que o H264.
- **AV1 em modo câmera** é a melhor imagem de vídeo em qualquer bitrate. Em página é o
  contrário: código rolando a 1,5 Mbps vai a 9 fps e 28,9 dB, contra 26 fps e 33,7 dB em modo
  tela.
- **VP9 em modo tela** era o padrão da maioria. Depois de uma pausa manda 2 fps durante uma
  rolagem. Era a "imagem travada em conexão boa", e nenhum contador de travada vê isso,
  porque o intervalo médio entre quadros também sobe. O PSNR dele é alto justamente porque
  manda poucos quadros.
- **H264 em modo câmera** é o mais barato nas duas pontas: seis espectadores em quatro
  núcleos vão a 28 fps, onde o VP9 vai a 6. Com bits sobrando fica perto. Faltando, não.
- **OpenH264 em modo tela** pesa na rolagem e desaba em conteúdo ruidoso (1,8 fps).
- **H264 de hardware** dá o mesmo nos dois modos, e pode cair para OpenH264 no meio da
  transmissão, onde o modo câmera é o que dá conta.
- **VP8** fica para quem não tem H264, e VP9 para quem também não tem VP8.

**Quem vai em AV1** é decidido conexão por conexão, com a transmissão no ar
(`chooseSharp`): cabe enquanto o custo estimado somado fica dentro de uma parte dos núcleos
lógicos (`text` 50%, `balanced` 30%, `motion` 20%). 1080p30 custa ~1,5 núcleo. Em `balanced`
com o link curto a parte sobe para 60%, porque é onde a imagem se perde em H264: vídeo a 3 Mbps
é 43 dB em AV1 e 36 em H264, a 4,5 Mbps cerca de 45 e 40. O VP9 de antes gastava o mesmo por
espectador, sem limite nenhum, e o `MachineGovernor` tira de uma máquina que não aguenta.

| Núcleos lógicos | 4 | 6 | 8 | 12 | 16 |
|---|---|---|---|---|---|
| `balanced`, link curto (até ~5,9 Mbps, ~7,3 para quem já está) | 1 | 2 | 3 | 4 | 6 |
| `balanced`, bits de sobra | 0 | 1 | 1 | 2 | 3 |

Link muito curto para aquele tile (1,4× o que o H264 precisa para 30 fps: 4 Mbps em 1080p, 1,1 em
576p) vem primeiro, porque é onde mais faz diferença, depois quem já está nele, depois o maior
tile. `motion` só usa nesse link muito curto, e devolve em 2,1× (6 Mbps em 1080p). Quem sai espera
15 s para poder voltar, para um espectador que entra e sai não fazer os outros trocarem de codec.

Quem já está em AV1 não devolve enquanto outro espectador estiver com o link curto. No mesmo upload
as estimativas se dividem de forma desigual (9 Mbps para três: 8, 3 e 1,4), e a estimativa grande é
sorte, não banda sobrando: devolver ali era trocar de codec a cada minuto, sem ganho nenhum.

**A troca não renegocia nada.** H264 continua primeiro na oferta, como padrão seguro, e o
codec vai em `encodings[0].codec` assim que a resposta chega, antes do primeiro quadro. Custa
um quadro-chave: no Chrome e no Electron 38 a troca é aceita em 2–30 ms e o maior intervalo
visto foi 167 ms. O modo do encoder é uma propriedade do track, então **cada conexão de tela
tem a sua cópia da captura** (`track.clone()`), e um `applyConstraints` ou um swap de captura
vale para todas elas. Quem assiste em celular ou em até 4 núcleos, sem decode eficiente de AV1,
tira o AV1 da resposta (`declineCostlyCodecs`), e essa conexão fica em H264. Envia assim só o
Chromium de computador; Firefox, Safari e celular enviam H264 como antes, e a captura por GPU
do app não muda.

**O modo vai pelo que está na tela** (`PictureWatch`, em `balanced` e `text`). Nada numa amostra
diz o que é: vídeo em link curto parece página densa. Então, com a captura entregando pelo menos
12 fps por 10 s, ele **tenta** o modo câmera e compara com o que o modo tela vinha fazendo. Fica se
sair com bem mais quadros (1,25×); ou com tantos quanto (0,9×) e QP pelo menos 10 menor; ou com
tantos quanto, QP no máximo 10 maior e quadros pelo menos 10% mais baratos de codificar. Quadros
e QP, tela contra câmera, com um espectador:

| | tela | câmera | |
|---|---|---|---|
| Vídeo a 3 Mbps | 30 a 132 | 30 a 107 | fica |
| Vídeo a 800 kbps | 20 a 205 | 30 a 193 | fica |
| Vídeo a 500 kbps | 11 a 208 | 19 a 205 | fica |
| Ruído a 3 Mbps | 10 a 207 | 24 a 195 | fica |
| Código a 3 Mbps | 30 a 177 | 30 a 178 | volta |
| Código a 1,5 Mbps | 25 a 202 | 9 a 208 | volta |
| Texto miúdo, sem limite | 24 a 197 | 25 a 190 | volta: 31,6 dB contra 29,9 |
| Uma janela a 3 Mbps | 30 a 49 | 30 a 48 | volta |

A tentativa custa 8 s e dois quadros-chave, sem congelar, e sem tentar de novo por 5 min. Perder mais
da metade dos quadros encerra antes, em 2 s, então página densa paga cerca de 5 s. Captura abaixo
de 12 fps volta na hora, sem espera. Página densa em modo câmera vem em surtos (3, 3, 18, 15, 3 fps),
então uma amostra boa não zera a contagem de quadros perdidos: precisa de duas seguidas.

**Num upload dividido, o QP não compara sozinho.** Ele acompanha os bits, cerca de 40 por dobra, e os
bits vão e vêm entre os espectadores: 3,7 Mbps antes da tentativa e 2,7 durante são 18 de QP que não
dizem nada sobre o modo. Então o que a tentativa perdeu é descontado. O que ela ganhou não é, porque
o modo tela deixa um link curto meio usado, e usá-lo é parte do que o modo câmera faz. Com os mesmos
bits a imagem empata entre vários espectadores, e o que muda é a máquina: vídeo para três leva 2,9
núcleos onde o modo tela leva 3,7, e com mais quadros. Por isso imagem empatada em quadros mais
baratos também fica. Com um espectador isso não acontece: vídeo custa quase o mesmo nos dois modos, e
código custa metade a mais. Se a tentativa foi mal com menos de 70% dos bits, não é veredito, e ele
olha de novo em 30 s. O mesmo vale para o link caindo depois de provado.

Todas as conexões carregam a mesma captura, então **uma tenta de cada vez, e o que ela descobre vale
para as outras**. Espectadores no mesmo upload tentando juntos atrapalham uns aos outros: três
quadros-chave de uma vez, a estimativa cai, e os três saem piores no modo câmera.
Quem herda ainda volta se perder quadros no próprio link. `motion` fica sempre em modo câmera.

Os perfis dizem o que abrir mão primeiro quando algo falta, e quanto da máquina o AV1 pode usar.

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

Numa transmissão com H264 na placa de vídeo, o encoder não pode só ser desligado e religado. O da
AMD, religado depois de 10 s, manda quadro-chave atrás de quadro-chave que o decodificador de
hardware do espectador nunca aceita: a imagem não volta. Pausas de ~5 s não mostram isso. Então
uma conexão parada também sai da placa (`sentOffCard`, VP8 e desligado, sem enviar nada) e, na
volta, nasce um encoder novo. Em 10 e 32 s de pausa a imagem volta em 1 s ou menos. Quem não
escolhe codec (câmera, arquivo) continua com o encoder ligado no tier de quem não olha quando ele
está na placa, como era antes de existir pausa.

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
padrão ("alto") é 6 Mbps (fora de `sq-new-send`, 4 Mbps e folga de ×1,5, como antes) porque quem está em H264 precisa: um vídeo em 1080p vai de 39,3 dB
a 4 Mbps para 42,6 a 6, com 7% a mais de CPU, e a estimativa de banda segura o que o link
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
além do que o encoder fez, e `experiments` diz se a sessão estava em `sq-new-send` e em
`sq-h264-send`. Uma conexão que nunca subiu traz `iceLocal`, `iceRemote`,
`icePairs` e `iceResponses`: sem candidatos próprios é STUN bloqueado, sem candidatos
do outro lado é a sinalização que perdeu, e os dois sem nenhuma resposta às checagens
são NATs que não se deixam passar, o que só relay resolve. Sessões boas são amostradas
em 20%, então qualquer média precisa do peso (ruim 1, boa 5), e uma análise por par
precisa do peso dos dois lados. Freezes de tela contam pausas estáticas (um link
perfeito dá 70% "travado" num encoder de software), então olhe fps e quedas, não só
freezes.

## O que se mediu

Uma máquina (Ryzen 5 3500 de 6 núcleos, Radeon RX 560, Chrome 156), captura real de uma aba
em 1920×1024 e 30 fps, PSNR contra o quadro de referência exato, medido depois do
aquecimento. "Antes" é o VP9 em modo tela, o padrão de produção de então. Quando o fps é
muito baixo o PSNR de "antes" engana: são poucos quadros, cada um com muitos bits. A
variação de uma rodada para outra é de 1 a 1,5 dB.

Um espectador, encoder de software. As linhas são 1024 nos dois lados, salvo onde a tabela
diz. Os valores de antes com * são de uma rodada anterior à atualização do Chrome, e nela o VP9
rendeu mais fps do que depois: 19,8 contra 16,8 no vídeo a 1,5 Mbps, 36,1 contra 24,4 no vídeo a 60
fps (a segunda medida se repetiu, 25,1). A causa não foi separada; o AV1 não mudou entre as rodadas.

| Cenário | fps | PSNR (dB) | Núcleos de quem envia | Núcleos de quem assiste |
|---|---|---|---|---|
| Vídeo, sem limite | 20,6 → 29,7 | 44,1 → 45,8 | 1,40 → 1,28 | 0,26 → 0,36 |
| Vídeo, 3 Mbps | 18,1 → 29,9 | 42,6 → 43,4 | 1,24 → 1,51 | 0,24 → 0,32 |
| Vídeo, 1,5 Mbps | 16,8 → 29,8 | 37,9 → 40,0 | 0,98 → 1,32 | 0,19 → 0,27 |
| Vídeo, 800 kbps | 16,7 → 29,2 | 35,3 → 36,5 | 0,87 → 1,09 | 0,17 → 0,24 |
| Vídeo, 500 kbps | 15,5 → 17,6 | 34,8 → 35,2 | 0,72 → 0,70 | 0,15 → 0,15 |
| Vídeo, 300 kbps* | 6,1 → 19,2 | 34,7 → 32,0 (576 linhas) | 0,38 → 0,42 | 0,07 → 0,09 |
| Vídeo, 200 kbps* | 4,1 → 9,5 | 34,6 → 31,8 (576 linhas) | 0,29 → 0,27 | 0,05 → 0,05 |
| Vídeo a 60 fps | 24,4 → 59,8 | 42,9 → 43,2 | 1,52 → 1,91 | 0,27 → 0,59 |
| Rolagem, sem limite | 20,9 → 29,6 | 36,2 → 38,1 | 0,86 → 1,28 | 0,20 → 0,31 |
| Rolagem, 3 Mbps | 17,2 → 29,9 | 34,3 → 35,9 | 0,72 → 1,05 | 0,17 → 0,26 |
| Rolagem, 1,5 Mbps | 17,5 → 24,1 | 31,8 → 34,1 | 0,68 → 0,83 | 0,15 → 0,19 |
| Rolagem, 800 kbps | 13,5 → 12,6 | 29,5 → 32,9 | 0,54 → 0,46 | 0,12 → 0,11 |
| Rolagem de página clara, sem limite* | 20,0 → 22,7 | 29,3 → 31,1 | 1,19 → 1,31 | 0,22 → 0,31 |
| Rolagem de página clara, 3 Mbps | 17,1 → 10,2 | 28,0 → 30,1 | 1,06 → 0,63 | 0,20 → 0,16 |
| Rolagem de página clara, 1,5 Mbps* | 10,2 → 6,1 | 26,8 → 29,8 | 0,70 → 0,40 | 0,13 → 0,10 |
| Página clara com mudanças, 3 Mbps | 2,2 → 10,5 | 35,7 → 44,5 | 0,15 → 0,23 | 0,04 → 0,08 |
| Janela, 3 Mbps | 18,9 → 29,8 | 46,5 → 46,4 | 0,58 → 0,62 | 0,17 → 0,21 |
| Rajadas com pausas* | 2,0 → 12,1 | 43,3 → 49,2 | 0,11 → 0,18 | 0,04 → 0,07 |
| Ruído, 3 Mbps | 19,1 → 24,4 | 24,1 → 23,5 | 1,41 → 1,76 | 0,24 → 0,31 |

As três piores linhas são a página clara rolando sem parar, com fps abaixo do VP9 e mais
nitidez, e o ruído, com SSIM de 0,71 para 0,67. Abaixo de 400 kbps, a imagem desce para 576
linhas em troca de 3× o fps.

Vários espectadores no mesmo upload ou sem limite, medindo todos e tirando a média, com o
pior entre parênteses. É onde a nitidez por quadro mais cai, porque o VP9 fazia 15 fps e o AV1
faz 30 com os mesmos bits:

| Cenário | fps | PSNR (dB) | Núcleos de quem envia |
|---|---|---|---|
| 2 espectadores, 6 Mbps | 21,3 → 29,8 | 42,3 (41,1) → 42,7 (41,9) | 2,67 → 2,66 |
| 3 espectadores, 9 Mbps | 14,8 → 29,8 | 44,5 (43,7) → 40,9 (40,2) | 3,33 → 2,76 |
| 3 espectadores, 4,5 Mbps | 21,9 → 29,7 | 39,2 (37,4) → 38,6 (37,7) | 3,53 → 2,99 |
| 3 espectadores, um deles lento | 16,3 → 27,3 (22,5 no lento) | 42,8 (36,7) → 41,3 (34,5) | 3,37 → 2,71 |
| 3 espectadores, sem limite | 16,4 → 29,7 | 45,3 (45,3) → 44,7 (43,1) | 3,74 → 3,07 |
| 3 espectadores, rolagem, sem limite | 22,2 → 29,8 | 36,8 (36,5) → 37,5 (36,9) | 2,75 → 2,81 |
| 3 espectadores, rolagem, 9 Mbps | 22,3 → 27,4 | 34,5 (31,4) → 35,4 (33,9) | 2,72 → 2,97 |
| 3 espectadores, 4 núcleos, 9 Mbps | 10,0 → 18,8 | 45,9 (44,4) → 42,2 (39,7) | 2,49 → 2,11 |
| 3 espectadores, 2 núcleos | 5,9 → 22,4 | 48,3 (48,0) → 43,5 (43,1) | 1,72 → 1,77 |
| 3 espectadores, rolagem a 60 fps | 27,1 → 47,8 | 34,0 (33,9) → 35,5 (35,1) | 3,38 → 2,99 |

Com 6 espectadores numa página só a placa da máquina de teste morreu 3 vezes em 7 rodadas de
`v6-c12-film` (Code 31, reiniciar). Desligar a decodificação por hardware não evitou. A causa
exata não se sabe, e essa cena não se roda mais. Os números de uma rodada anterior, com uma
versão anterior do veredito e medindo só um espectador: vídeo sem limite de 7,5 para 28,0 fps,
de 46,9 para 42,9 dB, de 4,32 para 3,39 núcleos, todos em H264 depois de a máquina apertar.

Quem escolhia "Vídeo/jogo" e tinha 3 Mbps saía de H264 preso em 124 linhas (27,5 dB) para AV1
em 1024 linhas (43,1 dB) nos mesmos 30 fps, a 1,49 núcleo em vez de 0,08.

Com o encoder da AMD (`impl` confirma AMDh264Encoder no H264, libaom no AV1), o AV1 continua
em software, e é isso que paga a nitidez: vídeo sem limite de 44,5 para 45,8 dB custa 1,29
núcleo contra 0,08 do H264 da placa, que faria 29,8 fps a 44,3 dB. A 3 Mbps, o H264 da placa
cairia para 36 dB em 576 linhas, então o custo se paga em link curto: vídeo de 19,9 para 29,8
fps, 43,2 para 43,1 dB; rolagem de 19,7 para 29,5 fps, 34,2 para 36,0 dB. Três espectadores
sem limite: de 14,5 para 29,7 fps, de 3,45 para 1,38 núcleo, 46,2 para 44,7 dB. NVIDIA, Intel,
Safari, Android e encoders de AV1 por hardware não foram testados.

**O encoder da placa vai pelos bits com que nasce.** Quem nasce com tudo o que o link tem (troca
de codec, volta à resolução cheia) passa a maior parte do tempo em 13–16 fps e QP 19, com 6
Mbps de uma estimativa de 12 e sem falta de CPU: o controle de taxa dele e o descarte de quadros
do WebRTC se sustentam nesse estado. Baixar os bits depois não resolve; tem de ser no próprio
`setParameters` que recria o encoder (`ENCODER_START_KBPS`, 1,5 Mbps por 1,5 s). Medido do
momento em que o encoder assentou até o fim da cena:

| H264 da AMD | Sem isso | Com isso |
|---|---|---|
| Troca de AV1 para H264 (1–3 espectadores) | 16–21 fps, 57–87% do tempo abaixo de 20 | 27–29 fps, 3–15% |
| Volta à resolução cheia | 16 fps, 68% | 30 fps, 0% |
| CPU apertada, todos saem do AV1 | não medido | 30 fps, QP 26 |

Quando esse estado aparece mesmo assim, é sem falta de bits, e cortar resolução não o tira dele:
`LinkAdapter` não corta com QP baixo e folga no link (`linkHasRoom`). Sem essa regra, 3 de 6
conexões desciam a 576 linhas com 12 Mbps de estimativa e continuavam em 13–20 fps.

**No máximo 4 sessões na placa por transmissão** (`CARD_STREAMS_MAX`). Com AV1 + 4 H264, 5
espectadores ficam em 27–30 fps. As conexões seguintes vão em VP8 de software. O motivo é o
driver, não o fps: 6 conexões com 5 sessões derrubaram o da RX 560 (Code 31, só volta reiniciando)
em uma de três rodadas, e a mesma placa caiu 3 vezes em 7 numa cena de 6 vídeos na mesma página,
sem encoder de hardware. Quanto cada placa aguenta não se sabe; 4 nunca derrubou esta. Por isso,
6 conexões com o limite não foram medidas. Com 4 H264 e 1 VP8, em 2 de 3 rodadas a captura de
todas caiu para 19 fps depois de uns 38 s, quando o VP8 acusou falta de CPU, com os espectadores
decodificando na mesma máquina; na outra, 30 fps. Cada conexão a mais em VP8 custa quase um
núcleo. Como referência, o VP9 antigo fazia 6–7 fps com 6 espectadores.

Numa queda brusca do link, de 10 Mbps para 900 kbps, o vídeo trava mais que no VP9: 2,3 a 3,9 s
somados em duas rodadas, contra 1,5 s. Na rolagem é o contrário: 2,8 a 4,8 s contra 10,6 s. Na
volta do link, o VP9 está de volta em até 6 s, porque usa só metade da banda e tem sondagem. O
AV1 usa quase toda a banda, sonda menos e sobe devagar: no vídeo, os 30 fps voltam em 10 s e os
6 Mbps em 22 a 30 s; na rolagem, os 30 fps voltam em 6 s.

O upload dobra quando o link deixa: de ~2,7 para ~6 Mbps por espectador. É daí que vem a
nitidez em vídeo, e é a estimativa de banda quem segura em links menores. Em produção, 38% do
tempo de envio estava entre 2 e 4 Mbps e 21% entre 1 e 2 Mbps, mas antes deste envio a
estimativa acompanha o que se envia, então isso não prova um upload curto. Quem responde é
`linkCapShare`, depois do deploy.

## Comparar e reverter

O envio novo só vale para quem está no experiment `sq-new-send` (0%). Quem não está transmite
como antes: preferência por perfil, o codec pelo perfil e por `screen-codec` (`lib/screenCodec.ts`,
que por isso continua sendo lido e **não pode ser arquivado**), sem adaptadores, pausa nem cópia da
captura por conexão. Sair ou entrar não precisa de deploy, e vale ao vivo. Só o que é da conexão
em si fica como começou: quem entra com a transmissão no ar ganha o codec por conexão na próxima.

Medido contra o código real de antes (`50b42ee`, `screen-codec=auto`), na mesma sessão (fps / dB):

| Cena | Código de antes | Fora de `sq-new-send` |
|---|---|---|
| Vídeo, sem limite | 20,6 / 44,1 | 21,5 / 43,9 |
| Vídeo, 3 Mbps | 17,7 / 42,1 | 16,1 / 43,2 |
| Vídeo, 1,5 Mbps | 17,2 / 39,0 | 17,5 / 39,1 |
| Rolagem, 3 Mbps | 16,7 / 33,6 | 17,3 / 34,4 |
| Perfil texto, vídeo, 3 Mbps | 16,3 / 42,2 | 19,4 / 41,8 |
| Perfil texto, rolagem, 3 Mbps | 19,2 / 34,3 | 16,6 / 34,2 |
| Vídeo/jogo, 3 Mbps (124 linhas) | 29,9 / 27,5 | 29,7 / 27,5 |
| 3 espectadores, 9 Mbps | 15,5 / 43,2 | 13,2 / 44,9 |
| Máquina com AMD, sem limite | 20,7 / 44,2 | 22,1 / 44,1 |
| Máquina com AMD, 3 Mbps | 17,2 / 42,8 | 17,9 / 41,3 |

As diferenças estão dentro do ruído de uma rodada. O ramo de `auto` que põe H264 de hardware primeiro
não apareceu nesta máquina: aqui os dois lados foram de VP9, e ele só tem teste unitário.

O experiment não devolve o que o mesmo trabalho tirou ou trocou para todos: `congestionControl`
(o corte de bitrate por conexão), `memoryGuard`, `relayLink` e `topologyPlanner` (a cascata, sem
nenhuma sessão em 14 dias), `recv-codec`, `congestion-recover`, os `sq-*` a 5%, o TURN próprio só
por TCP (antes, metade por UDP), o pedido de qualidade de quem assiste (`lib/qualityNegotiation`, que
só é lido pelo envio novo no que diz respeito a parar o encoder), a captura por GPU reescrita
(`nativeVideoSink`) e a telemetria nova. Quem não está nele usa o envio de antes sem esses sistemas.

O experiment `sq-h264-send` (0%) só vale dentro de `sq-new-send`: tira o AV1 de quem transmite, ao
vivo, e tudo vai em H264 no modo câmera. É o primeiro a usar se o AV1 der problema, porque o resto
do envio novo continua.

Os dois servem para comparar em `connection_quality_reports`, onde o grupo aparece em
`experiments` como `sq-new-send=on` e `sq-h264-send=on`. Com `sq-new-send` em 50%, os dois envios
rodam lado a lado com o tráfego real, que é a comparação que o laboratório não faz. Compare fps
e altura: a taxa de sessões "ruins" não é comparável entre os dois grupos, porque tela parada e
espectador pausado contam de outro jeito. O evento
`send_moving_picture` conta as conexões em que o modo câmera do AV1 ficou, testado ou herdado.

## Verificar

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
