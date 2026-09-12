# Qualidade por espectador e cascata

Como a transmissão decide o que enviar para cada pessoa, e quando (raramente)
pede ajuda a participantes para retransmitir.

## O princípio

Numa sala de 30 pessoas a grade dá ~320×216 px por tile. Mandar 1080p para
esse tile joga fora ~95% dos pixels codificados — na CPU **e** no upload de
quem transmite. A regra central é:

> Cada espectador recebe a qualidade que a tela dele realmente usa,
> respeitando um piso de 576p.

Medido contra o comportamento anterior ("todo mundo recebe o preset"): **~3,7×
menos upload e ~4,7× menos encode** para o mesmo resultado visível. O encode
cai mais que a banda porque custo de encoder acompanha pixels/segundo — e era
exatamente esse o muro que impedia uma sala grande em malha.

**O piso de 576p custa caro e é intencional.** A regra acima, levada ao pé da
letra, mandaria uma miniatura para um tile de 320×216 — o tile só precisa
disso. Mas abaixo de 576p uma tela compartilhada deixa de ser legível, e
stream ilegível não é stream barato, é stream desperdiçado. Então o degrau
mais baixo da escada é 1024×576 e, quando não há mais para onde descer, o que
se abre mão é de quadros (576p15), nunca de pixels. A conta: um tile de grade
custa ~2× a banda e ~2,6× o encode que custava com os degraus baixos que a
escada tinha antes — foi isso que derrubou os números de 6×/7,8× para
3,7×/4,7×, e que move para uma máquina mais forte o ponto em que uma sala
grande precisa de cascata ou de rebaixamento global.

Consequência prática: **um desktop de ~12 núcleos serve 30 pessoas em malha
direta, sem cascata nenhuma**, mesmo com jogo a 60fps. A cascata é rota de
exceção.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `lib/videoQuality.ts` | Tiers, custo (kbps e Mpx/s), tamanho renderizado → tier |
| `lib/qualityNegotiation.ts` | Espectador informa o tamanho do tile ao transmissor |
| `lib/peerQualityController.ts` | Aplica tier + controle de congestionamento por peer |
| `lib/mediaStats.ts` | **Uma** passada de `getStats()` para tudo; orçamento de encode |
| `lib/topologyPlanner.ts` | Decide malha direta vs cascata (função pura, testada) |
| `lib/useMeshTopology.ts` | Mede capacidade, troca com peers, roda o planejador |
| `lib/relayLink.ts` | Executa a retransmissão (desligado por padrão) |

Nada disso exigiu mudança no backend: o servidor repassa o `data` de um
`signal` de forma opaca, então os tipos novos (`quality`, `capacity`,
`relay-assign`) trafegam sem alteração na API.

## Decisões que valem saber

**Framerate não é decidido por tamanho de tile.** Diminuir a janela não pode
significar "quero 15fps". Tamanho escolhe resolução; framerate cai só sob
pressão (congestionamento ou penalidade de profundidade na árvore).

**Não existe 576p60, de propósito.** Todas as outras resoluções da escada têm
degrau de 60fps. O piso não tem, porque é onde *todo* tile pequeno cai, e o
desempate por resolução prefere o framerate maior — um degrau de 60fps ali não
atenderia o espectador ocasional que quer movimento suave numa janela
pequena, entregaria 60fps às 29 miniaturas de uma grade de uma vez. Quem
escolhe 576p com 60fps recebe 576p30: a resolução que pediu, no framerate que
o piso oferece.

**Estado de congestionamento sobrevive a mudanças de qualidade.** Antes, todo
ajuste de qualidade reiniciava o monitor de cada peer — e como ele também
rodava a cada mudança no número de pessoas, um espectador em link ruim voltava
ao bitrate cheio sempre que alguém entrava ou saía, e nunca convergia. Agora
`setTier()` mexe só no alvo e preserva a razão aprendida.

**Um timer de stats, não 29.** Antes era um `setInterval` + `getStats()` por
peer. Agora é uma passada compartilhada, com janela deslizante acima de 12
senders para o custo por tick não crescer com a sala.

**`contentHint` virou escolha do usuário.** Estava fixo em `"detail"` para
toda tela, o que combinado com `maintain-resolution` manda o encoder sacrificar
quadros para preservar nitidez — certo para código, errado para jogo a 60fps.
Agora há o seletor "Texto / código" vs "Vídeo / jogo", que muda `contentHint`,
`degradationPreference` e a ordem de codecs de uma vez.

**Custo do conteúdo é medido, não presumido — mas só para planejar.** O mesmo
"1080p60" custa ~1/8 para um IDE estático e ~1,2× para um jogo, e o
planejador usa o bitrate real observado.

Esse multiplicador **nunca** pode virar o teto do encoder, e já foi: como ele
é derivado do bitrate que o encoder produziu, realimentá-lo como limite do
próprio encoder fechava um laço de mão única. Qualquer trecho parado (ler uma
página, vídeo pausado) puxava a medição para baixo, o teto acompanhava, e o
teto então tornava impossível a medição voltar a subir. Uma transmissão que
ficasse 20s parada seguia presa perto de 1/10 do bitrate do tier pelo resto da
sessão — resolução, fps e bitrate desabando juntos sem nada no ambiente ter
piorado. Medição é observação; teto é controle. Não podem ser o mesmo número.

**O que vai para o encoder é teto, não média.** `baseKbps` de cada tier é o
custo *médio* daquele tier — o número que o planejador orça. O sender recebe
`encoderCeilingKbps()`, que é a média com folga (×1,5) limitada pelo dial de
bitrate. Teto na média corta exatamente os momentos que precisam de mais bits
(um scroll, um corte de cena), e no modo "Texto / código"
(`maintain-resolution`) esse corte sai como quadro derrubado: a transmissão
parece travada, não borrada.

**Os três dials são independentes.** Resolução limita pixels, fps limita
quadros, bitrate limita bits. O dial de bitrate mapeava para um *tier*, o que
o tornava o dial mestre por acidente: "médio" prendia todo mundo em 720p
independente da resolução escolhida, e qualquer coisa abaixo de "ultra"
prendia em 30fps independente do fps escolhido — quem pedia 1080p60 no padrão
recebia 1080p30 sem nenhum aviso. "ultra" e "máximo" eram o mesmo tier, isto
é, a mesma opção vendida duas vezes. Hoje o teto de tier vem de resolução+fps
(`ceilingTierFor`) e `capTier()` limita as duas dimensões separadamente.

## Cascata

Ligada por padrão, mas só entra em jogo em salas com mais de 10 pessoas
(`CASCADE_ROOM_SIZE_THRESHOLD` em `lib/useMeshTopology.ts`) — abaixo disso o
planejador nunca considera ninguém elegível a relay, e uma sala que não cabe
em malha direta é rebaixada uniformemente em vez de cascateada. O broadcast
de capacidade (`useMeshCapacity`) também é pulado inteiro abaixo do limite:
não há motivo pra gerar esse tráfego de sinalização se ele nunca vai ser lido.
Desligue tudo incondicionalmente, independente do tamanho da sala, com
`NEXT_PUBLIC_RELAY_ENABLED=false`.

O motivo de existir esse limite: **navegador não faz passthrough de RTP**. As
WebRTC Encoded Transforms existem, mas repasse entre PeerConnections não é
coberto pela spec (casamento de codec, reescrita de SSRC/timestamp e
propagação de PLI ficam indefinidos). Então cada salto é decode + encode
completos: ~120–220ms e uma geração de perda de qualidade, gastando CPU e
upload de um participante — só vale a pena quando a alternativa (rebaixar a
sala inteira) é pior.

Churn ainda merece atenção em campo: quando um relay fecha a aba, a subárvore
fica sem stream até ser re-parentada. `RelayLink` detecta a fonte parada em
~12s e avisa os filhos, mas o broadcaster só reatribui esses filhos na
próxima passagem do planejador (até `REPLAN_COOLDOWN_MS` = 6s depois). Os 12s
são intencionais: um valor menor, como 1,5s, fazia pausas normais de
compartilhamento de tela estática parecerem uma fonte morta e podia derrubar
a cascata inteira. O trade-off é que uma fonte realmente travada pode
permanecer congelada por alguns segundos antes de ser detectada. Numa sala
grande e ativa isso deve ser raro e curto; se aparecer como um problema real,
`NEXT_PUBLIC_RELAY_ENABLED=false` desliga o mecanismo por completo.

Profundidade é limitada a 3 — além disso o planejador **rebaixa qualidade em
vez de aprofundar**.

## Verificar

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Para medir codec/`contentHint` no conteúdo e na máquina reais, abra
`analise/codec-diagnostico.html` no Chrome e compartilhe a tela mais pesada
que tiver. Se `VP9/detail` aparecer em vermelho e `VP9/motion` em verde, o
`contentHint` estava sabotando o 60fps. A coluna Mbps é o custo real do
conteúdo.

## Calibrar

`lib/mediaStats.ts` semeia o orçamento de encode a partir de
`hardwareConcurrency` (~100 Mpx/s por núcleo) e corrige para baixo quando o
encoder reporta limitação de CPU. É a única realimentação confiável — contagem
de núcleos não diz nada sobre qualidade do núcleo, folga térmica ou encoder de
hardware. Se as medidas de campo mostrarem que o palpite inicial erra muito,
`seedEncodeBudget()` é o botão a girar.

Margens do planejador em `lib/topologyPlanner.ts`: `UPLOAD_HEADROOM` (0,85) e
`ENCODE_HEADROOM` (0,85). Nunca planeje contra 100% do medido — estimativa de
banda passa do ponto, e encoder no teto exato derruba quadros. Mas margem
larga aqui não é sobra: é qualidade tirada da sala inteira, e é a *segunda*
linha de defesa. O estimador de banda do próprio WebRTC reage a
congestionamento real em um ou dois segundos, muito antes de um plano que só
é reavaliado a cada seis.

O teto de upload também não é mais só a estimativa do ICE: ela é um limite
inferior com aquecimento (só aprende que o link carrega mais quando o link
carrega mais), então `estimatedUplinkKbps()` toma o maior entre ela e o que já
está comprovadamente saindo. Sem isso, o rebaixamento inicial era o que
mantinha a estimativa baixa, que mantinha o rebaixamento.
