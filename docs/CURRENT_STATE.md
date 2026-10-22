# Estado verificado — 19/10/2026

Base: versão 2.5.2, branch main, commit inicial `6ec54ab`.
As alterações desta rodada estão no working tree; não houve commit ou push.

## Correções implementadas

- CLI `--offline-strict status` executa corretamente; bloqueio HTTP conserva
  o log e Web Push dispõe da função de auditoria antes ausente. URLs/IPs são
  analisados sem aceitar um hostname iniciado por `127.` como loopback.
- Seis rotas de preferências do Studio foram extraídas de `launch.py`, com
  teste HTTP de validação, persistência, reabertura e preservação de campos.
- Apresentação de atividade e etapas do Director foi extraída de `useStore.ts`
  para um módulo puro. A modularização é incremental; os arquivos centrais
  ainda têm responsabilidades que devem ser extraídas em futuras mudanças.
- Efeito de metadados do MediaInspector usa dependências completas. O chip
  do projeto passou a ocupar sua própria linha no cabeçalho, evitando
  sobrepor abas de navegação.
- Junção de vídeos codifica em temporário, valida o vídeo e só então publica
  o destino. Falha, codificação inválida, cancelamento ou encerramento do
  encoder preservam o arquivo anterior; clips de entrada ausentes não são
  silenciosamente omitidos.
- Entradas explícitas do Director são verificadas antes da retomada e no
  worker. Referência removida produz erro antes de carregar/despachar o modelo.
- F3 usa processo real encerrado após commit SQLite, reabertura independente,
  cancelamento concorrente e retake idempotente com codificação CPU real.
- O parser de requirements preserva extras, marcadores e hashes SHA-256 em
  linhas continuadas; a auditoria verifica faixas de versões, nomes normalizados
  e hashes observados. Declarações inválidas ou não suportadas falham explicitamente.
  URLs de wheels e alterações nos arquivos de origem também são verificadas.
  Isso não resolve dependências nem certifica instalações dos perfis E0–E4.
  Veja a [auditoria por requisito](CORRECTION_AUDIT.md).
- Workers falham quando tarefas são rejeitadas ou não produzem mídia.
  SFX rejeita referência explícita ausente/inválida e registra somente seu arquivo.
- F2 não gera mais tons nem troca falha de modelo por mídia determinística:
  usa jobs reais do Studio e exige revisão artística vinculada ao hash.
  Veja [o procedimento](REFERENCE_FILM_VALIDATION.md).
- Routers de capacidades e proveniência voltaram a ser montados no backend
  real. Teste de contrato exige suas rotas. Bundles de proveniência preservam
  caminhos relativos, verificam hashes e rejeitam travessia de diretórios.
  Proveniência de checkpoint desconhecido ou de dados legados é marcada
  `needs_review`; não recebe aprovação fictícia.
- A suíte agora redireciona também `wgp_config.json`, além de SQLite/cache.
  A raiz local foi restaurada para `app/outputs` por escolha explícita do usuário.
  A configuração anterior está em `app/.cache/correcoes-2026-10-19/` (não versionada).
- CI inclui Vitest e dependências HTTP/CLI explícitas. A configuração Reversa
  foi corrigida com autorização do usuário. Os 245 arquivos `.claude/` foram
  retirados apenas do índice Git com autorização explícita; permanecem em disco
  e a pasta foi adicionada ao ignore.

## Evidências

- Python padrão: **972 passed, 6 skipped, 62 deselected**, 33 subtests.
  O hash de `app/wgp_config.json` foi comparado antes/depois: preservado.
- Lockfile: **28 passed**; regressões de extras, continuações, faixas,
  marcadores de plataforma e hashes ausentes/divergentes.
- Regressões focadas de configuração, jobs, offline, proveniência e publicação:
  **32 passed**.
- Smoke de importação em processos novos: **1 passed, 35 subtests**.
- TypeScript + Vite build: aprovado; permanecem avisos de tamanho de chunks.
- ESLint: zero erros e zero avisos de regras (Babel ainda informa arquivo grande).
- Vitest: **183 passed**, 27 arquivos; contratos store/control aprovados.
- Guard de repositório: **clean, 2.742 arquivos rastreados auditados**, após a
  retirada autorizada de `.claude/` do índice.
- Backend real em instância de validação isolada: `/health/version`,
  `/api/v1/capabilities/models`, `/api/v1/system/network-policy` e preferências
  respondem 200; proveniência de take ausente responde 404, com a rota montada.
- Chromium: **3 passed**; 35 combinações de sete seções e cinco larguras,
  navegação por teclado, revisão do Director, persistência do Editor e CRUD
  de projetos, com mutações interceptadas. Capturas em `/tmp/cue-validation-browser/`.

Os testes F2 de GPU são dois dos seis ignorados na suíte comum. Os outros
quatro casos dependem de Playwright opt-in e de ausência de PyYAML. Isso não
constitui aprovação de geração completa nem de revisão artística.

## Gate F2 — revisão humana OCORREU e reprovou o master v3

> **Estado verificado — 20/10/2026.** A revisão artisticahumana do master v3
> **já foi realizada e reprovou** o filme. O que segue abaixo é histórico
> datado de 19/10; leia primeiro esta nota.

O master real de 60 s em `app/outputs/validacao-f2-2026-10-19-v3/` passou em
todos os critérios objetivos de `validate_master()`, mas a **revisão humana
(2026-10-20T01:35:57Z) reprovou** com 6 erros críticos:

| # | Erro crítico | Notas |
|---|---|---|
| 1 | Foram mencionadas 3 lentes, mas o robô **sempre tem 4** | identidade |
| 2 | O tamanho do robô varia entre cenas | continuidade |
| 3 | O robô aparece flutuando várias vezes | motion |
| 4 | Voz PT-BR inaudível | `pt_br_voice` = 0 |
| 5 | Suporte da lâmpada aparece distorcido em algumas cenas | appearance |
| 6 | Algumas cenas aparecem dois cubos | continuity |

Notas por dimensão: identity 3, continuity 2, motion 2, appearance 3,
pt_br_voice 0, sound_editing 2. O `creative-review.json` do v3 é **imutável**:
registra a reprovação e não pode ser editado nem removido.

### Correções implementadas após a reprovação

- **Áudio (erro 4).** `app/services/reference_mix.py` (novo) implementa a
  política de mix por âncoras absolutas por papel (speech/music/ambient/
  effect) e mede a margem de narração sobre o leito. Sem isso o TTS é
  enterrado pelo `ace_step` (~12 dB acima) e a nota de voz é 0. Validado por
  `tests/test_reference_mix.py` (8 testes).
- **Identidade (erro 1).** Causa-raiz provada: o `flux2_klein_9b` **ignora a
  contagem explícita** do prompt canônico e produz 4 lentes ciano em losango
  de forma determinística na maioria das seeds (7, 8, 42, 101, 555, 777,
  1234, 31415). Como as 12 imagens de plano recebem `image_refs:
  [anchor-character, anchor-location]`, todas herdavam a identidade errada.
  A **seed 99** do âncora, mantendo o prompt canônico, produz 3 lentes ciano
  puro em geometria triangular — provado empiricamente contra o backend real.
- **Gate por métrica (novo).** `app/services/reference_identity.py` (novo)
  conta as lentes ciano por frame. O gate F2 agora **reprova alto** se a
  âncora de personagem não tiver exatamente 3 lentes (antes de renderizar os
  12 planos) e se o close-up neutro S03 não tiver 3 lentes; os demais planos
  são registrados como evidência em `technical-report.json`
  (`lens_evidence`). `scripts/count_lenses.py` é o CLI sobre a mesma métrica.
- **Vídeo (erros 2, 3, 5, 6).** O bloco `video` do `f2-config.json` passa a
  enviar `negative_prompt` explícito (substitui o `DEFAULT_NEGATIVE_PROMPT`
  do LTX-2, hostil ao estilo 3D) com "fourth lens", "floating robot",
  "changing robot size", "duplicate cube", "distorted lamp holder", e
  `input_video_strength: 1.0`.
- **Diretório novo (v5, e depois v6).** Qualquer mudança de params invalida os
  recibos estritos (`receipt["request"] != params` ⇒ `ValueError`). A validação
  do v5 rodou em `app/outputs/validacao-f2-2026-10-20-v5/`; a do v6 (só o
  prompt do S10 mudou) rodou em
  `app/outputs/validacao-f2-2026-10-20-v6/`, reaproveitando os recibos
  válidos do v5.
- **S10 — 4 lentes ciano reais (erro 1, continuação).** O v5 ainda mostrava **4 lentes
  ciano reais** no close-up âmbar do S10 (losango, centroides
  (708,106)/(778,325)/(573,327)/(662,413); HSV medido H 88–90, S 135–155,
  V 238–241). **A seed não é a causa**: com a seed 99 e o prompt original do
  S10 o defeito persiste (4 lentes). A causa é a **redação do prompt do S10**
  (luz âmbar + close-up), não o sorteio. Duas correções foram provadas
  empiricamente contra o backend real, ambas determinísticas com seed 42:
  1. `negative_prompt` + `NAG_scale: 1.5` / `NAG_tau: 3.5` / `NAG_alpha: 0.5`
     no bloco `image` (o `flux_main.py` só aplica o `negative_prompt` quando
     `guide_scale <= 1` **e** `nag_scale > 1`); e
  2. **reformulação do prompt do S10** para "…Exactly three cyan camera
     lenses arranged as a triangle: two lenses on top and one centered below,
     identical to the character reference. No mouth. Same head geometry as the
     character reference."
  A opção 2 foi adotada: corrige **apenas** o S10, sem invalidar os params
  das outras 11 imagens nem do bloco `image` (que regeraria as 12). Medida:
  3 lentes em triângulo canônico (duas em cima, uma abaixo), repetida 3× com
  resultado byte-a-byte idêntico (seed 42).
- **Gate duro no S10 (novo).** O close-up âmbar do S10 mantém as lentes
  saturadas, então a contagem é mensurável: o gate F2 agora reprova se a
  imagem do S10 não tiver exatamente 3 lentes, além dos gates já existentes
  no âncora de personagem e no S03.

### Estado da correção visual

| Artefato | v3 (seed 42) | v5 (seed 99 + negative prompt) | v6 (S10 reformulado) |
|---|---|---|---|
| âncora de personagem | 4 lentes (losango) | **3 lentes ciano puro** | 3 lentes ciano puro |
| S03-imagem | 3 | 3 (100 %) | 3 (100 %) |
| S03-vídeo | 0 % dos frames com 3 | **120/120 frames (100 %)** | 120/120 frames (100 %) |
| S02-vídeo | 4 lentes em 39/125 frames | 3 lentes em 100/120 frames (83,3 %) | 3 lentes em 100/120 frames (83,3 %) |
| S10-imagem | 4 lentes (losango) | **4 lentes (losango)** | **3 lentes (triângulo)** |
| S10-vídeo | 4 lentes em 24/120 frames | 4 lentes em 24/120 frames | **nenhum frame com 4 lentes** |

### Estado do gate v6 — master gerado e medido, revisão humana pendente

> **Nota sobre a mixagem (20/10/2026).** O `loudnorm` do FFmpeg, quando o
> ganho linear violaria o teto de true peak **ou** quando o LRA medido excede
> o LRA alvo, recusa o modo `linear=true` e entra em **modo dinâmico**. Duas
> consequências medidas: (a) a cadeia inteira passa a correr a **192 kHz**, e um
> `atrim=end_sample=2880000` passa a contar amostras de 192 kHz — o programa
> de 60 s saía com 15 s (720 000 amostras); (b) a re-equalização dinâmica
> re-levanta os trechos silenciosos e **perde 5,9 a 6,1 dB** de separação
> voz/leito, reprovando a margem de narração de 3 dB. A correção substitui o
> `loudnorm` por **um ganho estático medido** (calculado a partir da soma e
> corrigido por até 4 iterações, cada uma medida no mix renderizado) mais um
> **limitador de picos** no bus de mix. O módulo passa a cumprir o que o
> próprio docstring já prometia ("one static gain").

O gate F2 v6 **passou**. `app/outputs/validacao-f2-2026-10-20-v6/` contém o
master real de 60 s e o `technical-report.json` com todos os checks verdes:

| Critério | Esperado | Medido |
|---|---|---|
| Frames / FPS | 1440 / 24 | 1440 / 24 |
| Sample rate / canais | 48 000 Hz / 2 | 48 000 Hz / 2 |
| Drift A/V | ≤ 1 frame | ≤ 1 frame |
| Loudness | −16 LUFS ± 1 | **−16,13 LUFS** |
| True peak | ≤ −1 dBTP | **−2,31 dBTP** |

SHA-256 do master v6: `d892bd0890e8ebd8aa24d15f973265a9c8579ac3b20b4bfa4ffd4ded1da71214`.
(Superado pelo v5 `a7daf71afc84a19eb452415128727b6ad153bfd25d6de5701e0bfd5577a72ce0`,
que ainda tinha 4 lentes no S10.)

O v6 só mudou o prompt do S10; todos os demais planos, as 4 falas, a música e
os efeitos foram **reaproveitados** dos recibos do v5 (o cliente só reusa um
recibo quando os params e o SHA-256 do artefato casam). Só foram regerados o
S10-imagem, o S10-vídeo e os 5 SFX — estes últimos porque embutem o caminho
absoluto do `video_guide` (o clip vive dentro do `validation_dir`), que muda
de diretório.

A evidência de lentes confirma a correção de identidade: a âncora de
personagem tem **3 lentes**, o close-up neutro S03 tem **3 lentes em
120/120 frames** do vídeo e o close-up âmbar do S10 tem **3 lentes** na
imagem e **nenhum frame com 4 lentes** no vídeo (no v5 eram 24 frames com
4). Os demais planos ficam registrados apenas como evidência, porque a luz
âmbar e a escala pequena fazem o detector perder blobs (mesmo limite
conhecido do detector).

### Duas causas-raiz de áudio encontradas no caminho (corrigidas em código)

1. **`loudnorm` derrubava o programa de 60 s para 15 s.** O filtro recusa o
   modo linear quando o ganho estático estouraria o teto de true peak, ou
   quando o LRA medido (15,00 LU) ultrapassa o LRA alvo (11 LU). Nesse modo
   de recusa ele devolve a cadeia inteira a **192 kHz**, e o
   `atrim=end_sample=2880000` passou a contar amostras de 192 kHz — o mix
   saía com 720 000 amostras em vez de 2 880 000, e o gate reprovava.
2. **O modo dinâmico do `loudnorm` enterrava a narração.** A mesma
   recusa entra no modo dinâmico, que re-equaliza os trechos silenciosos:
   a separação voz/leito despencava de 10,30 dB para 7,10 dB e a margem
   exigida de 3 dB reprovava no V02 (2,13 dB medidos).

A correção, em `app/services/reference_mix.py`, substitui o `loudnorm` por
**um ganho estático medido a partir da soma + limitador de picos no bus de
mix**, com o ganho corrigido em até 4 iterações sempre a partir da medição
do mix renderizado. Isso é o que o docstring do módulo já prometia ("one
static gain") e o que o `loudnorm` dinamicamente não entregava. Com isso a
margem de narração medida no mix final ficou em V01 4,50 dB / V02 3,36 dB /
V03 8,06 dB / V04 4,41 dB, todas acima do mínimo de 3 dB (o V02 era o caso
crítico, com 2,13 dB).

Dois testes de regressão foram adicionados em `tests/test_reference_mix.py`:
um prova que a contagem de amostras continua correta e outro prova que a
margem entre duas janelas do mix é preservada (falha de 10,30 → 7,10 dB com
a implementação antiga). A suíte `tests/test_reference_mix.py` +
`tests/test_reference_identity.py` passa com **15 testes**.

### O que ainda falta

Somente a **nova revisão artística humana** do master v6. A revisão do v3 não
se aplica: `validate_creative_review()` exige `master_sha256` do master
revisado e `critical_errors == []`. Um novo master invalida a revisão
anterior pelo hash. A página de revisão está em
`app/outputs/validacao-f2-2026-10-20-v6/review.html` (o hash exibido na
página é o do v6).

O gate `-k full_acceptance` reprova por ausência de
`creative-review.json`, e **é esse o comportamento esperado**: o
`validate_master()` do master v6 passa, e o que falta é o julgamento
humano, que o código não pode inferir.

## Gate F2 v7 — duas causas-raiz provadas, detectores recalibrados

O master v6 passou no gate técnico (8/8) e foi **reprovado na revisão
artística humana** com três erros críticos: *"cena com dois cubos"*,
*"robô de tamanhos diferentes ao longo do vídeo"* e *"robô flutuando"*.
A revisão está em `app/outputs/validacao-f2-2026-10-20-v6/creative-review.json`
(hash `d892bd08…`, identidade 2, demais dimensões 4).

### Duas causas-raiz independentes, ambas provadas por medição

**1. O `negative_prompt` de imagem nunca foi aplicado.** No
`app/models/flux/flux_main.py:288-293` o prompt negativo só é codificado
quando `nag_scale > 1` **e** `guide_scale <= 1`. O bloco `image` do
`f2-config.json` do v6 tinha `guidance_scale: 1` e **nenhum** `NAG_scale`:
o `NAG` ficava `None` e o `negative_prompt` era descartado em silêncio.
Consequência medida: um segundo cubo e uma quarta lente. O v7 acrescenta
`NAG_scale 1.5` / `NAG_tau 3.5` / `NAG_alpha 0.5` ao bloco `image`, e o
teste do F2 passa a **exigir** `NAG_scale > 1` e `guidance_scale <= 1`,
porque um `negative_prompt` sem essas duas condições é uma promessa vazia.

**2. O cubo estava gravado na âncora de ambiente.** O prompt de `location` do
v6 terminava com *"Exactly one small matte red cube rests on this table"*.
Como `location` é passada como `image_refs` para todos os planos, **todo
plano do v6 herdava um cubo vermelho nas mesmas coordenadas de tela**
(943,453): S01 (111×102 px), S02 (112×103), S06 (114×102 **mais** um segundo
de 81×75 na mão do robô) e S11 (111×102). O prompt de `location` do v7 é
livre de cubo (*"a bare, completely empty tabletop"*) e a âncora de ambiente
agora mede **0 blobs**.

Descartado por A/B: passar a âncora do cubo como terceiro `image_ref` **não**
é a causa — com o prompt negativo forte, `{char, loc}` e `{char, loc, cube}`
dão exatamente 1 cubo em S02 e S11. Por isso o teste passa só
`[character?, location]` como referências.

### Detectores recalibrados contra um corpus rotulado

O corpus é o conjunto de 12 stills + 3 âncoras do v7 **e** os 12 stills +
2 âncoras + 12 clips do v6 (26 stills rotulados + 12 clipes).

**`app/services/reference_cube.py` (reescrito).** O limite absoluto
`MAX_CUBE_WIDTH = 150` havia sido calibrado só no v6, onde os cubos reais
mediam 91–134 px; o v7 desenha o cubo de 46 px (plano geral) a 177 px
(close-up da mão, S08) e 388 px (`anch-cube`), então o limite absoluto
rejeitava cubos reais. Os limites passaram a ser **relativos ao quadro**
(`MAX_CUBE_WIDTH_FRACTION = 0.40`, `MAX_CUBE_AREA_FRACTION = 0.25`), o que
ainda rejeita uma parede vermelha ocupando a imagem. A pureza de matiz é
**segura na virada do círculo** (OpenCV põe vermelho em 0/179): o teste é
`median(min(hue, 180 - hue)) <= 5°`, e todo cubo real mede 1–4°. Piso de
valor 100 e de saturação 150 (cubos reais: valor 107–222, saturação
164–241; madeira em âmbar: valor 75–90). Resultado: **0 erros** nos 12
stills do v7, e o v6 S06 ainda mede **2 cubos** — a regressão continua
reprovando o master rejeitado.

**`app/services/reference_identity.py`.** `MIN_FILL` de 0,55 → 0,45: as
lentes do v7 preenchem 0,486–0,543 do próprio bounding box (o desenho do
v7 tem aro escuro na lente, o v6 não), e nenhum plano de nenhum dos dois
filmes mostra uma quarta lente a 0,45. Com isso o S10 do v7 passa a contar
3 lentes (antes: 0).

### A régua de escala tinha um bug: media cabeças diferentes

`app/services/reference_robot.py` media a cabeça **unindo blobs** de lente
com uma distância **absoluta** de 40 px. Em close-up essa distância é
pequena demais e a união cobria **só 2 das 3 lentes**: o S10 do v7 media
277 px de cabeça quando o vão real das três lentes é 462 px. A régua media
coisas diferentes em planos diferentes — justamente onde ela precisa ser
comparável. A medição passa a ser o **vão das três lentes** (as lentes são
triangulares, então o vão descreve a cabeça em qualquer plano), e o grupo
escolhido é o mais apertado entre as combinações de três.

Efeito medido nas mesmos pares de planos:

| Medição | S04 | S07 | Dispersão |
|---|---|---|---|
| Cabeça (união com gap absoluto, v6) | 1,48 | 2,13 | **44 %** |
| Cabeça (vão das 3 lentes, v6) | 1,53 | 1,05 | 46 % |
| Cabeça (vão das 3 lentes, v7) | 2,30 | 2,13 | **8 %** |

### Gate novo: o robô mantém um tamanho ao longo do filme

`app/services/reference_continuity.py` ganhou
`check_scale_consistency()`. Como a cabeça e o cubo são rígidos e a régua
só é válida onde o robô segura o cubo, a razão tem de ser a mesma em
todos esses planos: um robô que cresce ou encolhe ao longo do filme move
esse número. O limite `MAX_CROSS_SHOT_RATIO = 1.25` fica entre os dois
filmes medidos — o v6 reprovado abre **1,70** (0,91 em S07 contra 1,55 em
S04) e o v7 corrigido mantém **1,08** (2,30 / 2,13 / 2,16). A mensagem de
falha reproduz a reclamação da revisão humana.

### Portas do gate F2 (v7)

| Medida | Onde | Tipo |
|---|---|---|
| Contagem de lentes na âncora de personagem | antes de renderizar os planos | dura |
| Contagem de lentes no S03 e no S10 | imagem | dura |
| Contagem de cubos por still | 12 imagens | dura |
| Continuidade do cubo por clip | 12 vídeos | dura |
| Estabilidade de escala dentro do plano | S02, S04, S06, S07, S11 | dura |
| Régua cabeça/cubo | S04–S08 | dura |
| **Consistência de escala ao longo do filme** | S04, S06, S07 | **dura (nova)** |

A banda da régua passou de `[0,75 ; 1,45]` para `[1,0 ; 3,5]`: o valor
anterior foi calibrado contra uma medição que media a cabeça errada.

### Ordem de execução: medir depois de gerar

O teste do F2 agora **renderiza tudo antes de medir**. A medição é o que
decide a aceitação e a renderização é a parte cara; medir durante a
geração jogaria fora os planos nunca alcançados porque um anterior
falhou. Além disso todas as portas são avaliadas antes de qualquer uma ser
reportada (uma execução conta a história inteira do filme), as falhas são
somadas e só então o som — que também precisa da GPU — é gerado se o
filme passou nas medições. A evidência é gravada em
`shot-evidence.json` antes da falha, para que um filme recusado possa ser
medido e recalibrado sem renderizar de novo.

### Requisito de VRAM

O filme consome **7,1 GB** de VRAM no pico (medido no job de vídeo). Um
servidor local de LLM do LM Studio com **8,65 GB** faz o primeiro job de
imagem falhar com `CUDA out of memory` (restavam 966 MiB para uma
alocação de 1,16 GiB). O LLM precisa estar **encerrado** durante a
geração.


### Estado do gate v7 — master gerado e medido, revisão humana pendente

O master v7 foi gerado com inferência real e passou em todas as portas
automáticas. `app/outputs/validacao-f2-2026-10-21-v7/` contém o master de
60 s, os 12 clipes, os 12 stills, o `technical-report.json`, o
`shot-evidence.json` e a página `review.html`.

| Critério | Esperado | Medido |
|---|---|---|
| Frames / FPS | 1440 / 24 | 1440 / 24 |
| Sample rate / canais | 48 000 Hz / 2 | 48 000 Hz / 2 |
| Drift A/V | ≤ 1 frame | ≤ 1 frame |
| Loudness | −16 LUFS ± 1 | **−16,17 LUFS** |
| True peak | ≤ −1 dBTP | **−2,24 dBTP** |

SHA-256 do master v7: `6abca524466f8230a906046b2adacf6b3526fb78684ceab9275082e0fbbf8219`.

Evidência das portas novas (medida no v7 contra o v6 reprovado):

| Medida | v7 | v6 (reprovado) |
|---|---|---|
| Segundo cubo por clip | **0 de 12 clipes** (1 cubo em 100 % dos quadros de 11 deles; no S10, que o roteiro exclui, 1 quadro de 120) | S06: 2 cubos em 97,5 % dos quadros |
| Cabeça por plano (vão das 3 lentes) | S04 141 px, S07 105 px, S03 477 px, S10 462 px | idem, com 2 lentes medidas |
| Deriva dentro do plano | S04 1,09, S07 1,56, S03 1,15 (limite 1,8) | S04 1,19, S10 1,97 |
| Régua cabeça/cubo | S04 2,33, S07 2,31 (banda 1,0–3,5) | S02 0,97, S04 1,55, S07 0,90 |
| **Escala ao longo do filme** | **1,005** (S04 2,33 contra S07 2,31) — aprovado | **1,71** — reprovado |

O que só a medição diria: no S04 o detetor de cabeça media 81 px em 28 dos
120 quadros. Não era o robô encolhendo: era um **highlight de 6 px** ao lado
das lentes que o detector agrupava com duas delas, porque o grupo mais
apertado wins. Com a exigência de que as três lentes tenham tamanho
comparável (as de uma cabeça são do mesmo tamanho físico), o S04 mede 141 px
em todos os quadros. A mesma correção não mexe no v6: ele continua
reprovando a porta de escala ao longo do filme (1,71).

### O caminho da revisão humana foi verificado de ponta a ponta

Antes de pedir a revisão, o caminho inteiro foi exercitado num diretório
temporário, com uma revisão **sintética** — o diretório real do v7 nunca
recebeu revisão fictícia, e o gate continua reportando "unverified" até
que a pessoa revise de verdade.

O que foi verificado:

- **a página abre e o filme toca**: `review.html` servida por HTTP carrega
  `master.mp4` com `readyState 4`, duração 60 s, 1280×720, sem erro, e os
  quatro `V0*-raw.wav` das falas respondem 200;
- **o sha da página é o do master**: o `masterHash` embutido no HTML é
  `6abca524466f8230a906046b2adacf6b3526fb78684ceab9275082e0fbbf8219`, o
  mesmo do arquivo;
- **o botão produz um arquivo que o gate aceita**: o JSON gerado pela
  página (mesmo formato, mesmo sha, as seis dimensões com nota) é aceito
  por `validate_creative_review()` sem alteração;
- **o gate reprova sem revisão**: `test_f2_full_acceptance_requires_creative_review`
  falha com a mensagem "Full F2 remains unverified until the actual master
  is reviewed";
- **o gate reprova uma revisão malformada**: hash de outro master, erro
  crítico preenchido, dimensão sem nota, nota abaixo de 3, fala não
  conferida, título não conferido e revisor ausente — sete casos, sete
  recusas, cada uma com a sua mensagem;
- **a página é testada contra a porta**: `tests/test_build_reference_review.py`
  compara as chaves que o script da página escreve com as chaves que a
  porta lê (lidas do código da própria porta), exige as seis dimensões
  exatas, confere que todo elemento lido pelo script existe, e prova
  que a revisão que a página produz é aceita pela porta enquanto a
  página intocada é recusada. Três mutações deliberadas do builder —
  renomear `#title`, trocar `appearance` por `aparencia`, fixar o hash —
  foram cada uma pegadas pelo teste correspondente;
- **o gate confere o vínculo da página**: se `review.html` for de outro
  master, a falha diz para reconstruir a página, em vez de o revisor
  descobrir no fim que a revisão dele não valia.

Ou seja: a revisão humana é o **único** passo que falta, e ele já tem
uma página funcionando e um gate que aceita exatamente o que a página
produz.

### O que ainda falta

**A revisão artística humana do master v7.** O gate `-k full_acceptance`
reprova por ausência de `creative-review.json`, e **é o comportamento
esperado**: `validate_creative_review()` exige o `master_sha256` do master
revisado, `critical_errors == []` e as seis dimensões com nota 3 ou 4. A
revisão do v6 não vale para o v7: o hash é outro.

A página de revisão está em
`app/outputs/validacao-f2-2026-10-21-v7/review.html` (com o hash do v7
exibido na página). Depois de assistida, a revisão vira
`creative-review.json` no mesmo diretório e o gate completo passa a
verificá-la.

## Gate F2 v8 — a revisão do v7 reprovou o filme por três defeitos de cena

A revisão criativa do master v7 **ocorreu e reprovou**. O revisor foi
`yuri`, em `2026-10-21T21:25:47.407Z`, sobre o master
`6abca524466f8230a906046b2adacf6b3526fb78684ceab9275082e0fbbf8219`. As
notas foram identidade 3, continuidade 3, movimento 2, aparência 4,
`pt_br_voice` 0 e `sound_editing` 0, com os erros críticos:

- *"no momento que o robô vai colocar o cubo vermelho na mesa sai uma
  lampião junto"* — uma lâmpada acesa ao lado do cubo no S08;
- *"em algumas cenas o pedestal da lampada não aparece"*;
- *"em algumas cenas a mesa não aparece"*;
- *"não avaliei as vozes e montagem sonora pois o video não tinha audio"*.

As duas últimas dimensões estão com 0 **por causa de um bug meu de
serviço, não do filme**: a página de revisão era servida por
`SimpleHTTPRequestHandler`, que responde `200` com o arquivo inteiro e
ignora o cabeçalho `Range`. O Chrome então descarta a faixa de áudio em
silêncio e a trilha não toca. Corrigido em `9011f84`: o servidor passa a
responder `206 Partial Content` com `Accept-Ranges: bytes` e
`Content-Range` correto (`416` com `bytes */<size>` para faixa
insatisfazível), coberto por 10 testes em
`tests/test_serve_reference_review.py`. As duas dimensões ficam **sem
avaliação** até a nova revisão, não reprovadas por som ruim.

### A causa-raiz dos três defeitos era o prompt, não o modelo

A âncora de ambiente (`location`) já descrevia a cena certa: mesa à
direita com tampo vazio, pedestal separado no meio com o encaixe
quadrado e **uma única lâmpada âmbar apagada** em cima, "no other lamps",
nada na mesa, nada no chão. O defeito é que os prompts **por plano**
diziam o *estado* sem dizer o *que está no quadro*:

| Plano | O que o prompt dizia | O que o modelo pintou |
|---|---|---|
| S08 | mão + cubo + encaixe | mão + cubo + **lâmpada acesa** |
| S01 | "a lâmpada do pedestal está OFF" | mesa e robô, **sem pedestal** |
| S10 | "cabeça iluminada pela lâmpada acesa" | robô e mesa, **sem pedestal** |

E nenhum prompt negativo proibia uma lâmpada extra, uma mesa extra ou um
pedestal extra — só o cubo duplicado e a quarta lente.

### O que mudou no v8

Em `tests/fixtures/cue_reference_film_v1/visual_prompts.json`:

- `location` passa a dizer que **a mesa e o pedestal são as únicas peças
  de mobília** e que a lâmpada do pedestal é a **única luminária** da cena;
- `negative.image` e `negative.video` passam a proibir `extra lamp`,
  `second lamp`, `oil lamp`, `kerosene lamp`, `table lamp`, `desk lamp`,
  `floor lamp`, `hanging lamp`, `chandelier`, `lantern`, `oil lantern`,
  `paper lantern`, `extra table`, `second table`, `extra pedestal` e
  `second pedestal` — **sem** proibir `lamp` ou `light bulb` isolados, que
  apagariam a lâmpada legítima de S09, S11 e S12;
- S01, S02, S04, S06, S07, S11 e S12 **declaram** a mesa à direita e o
  pedestal no meio do quadro, com o encaixe e a lâmpada;
- S03, S05, S08 e S10 declaram o conteúdo do quadro e **proíbem**
  lâmpada, lanterna e objeto aceso;
- S08 passa a dizer que o quadro contém **só** a mão direita, o cubo, a
  base do pedestal e o encaixe, e que a lâmpada está **fora do quadro**;
- S09 mantém a lâmpada única no quadro, começando apagada.

`tests/test_cue_reference_film_visual_prompts.py` (7 testes) guarda a
receita contra a regressão dos três defeitos: a cena declara as duas
peças de mobília, o prompt negativo proíbe a lâmpada extra sem proibir a
légima, os planos abertos declaram mesa e pedestal, os fechados proíbem
qualquer lâmpada, o S08 fecha o quadro e o S09 mantém a lâmpada.

### O que **não** foi feito: uma porta de "lâmpada acesa"

Uma porta automática de lâmpada acesa foi investigada e **descartada**.
A contagem de pixels âmbar saturados é dominada pela madeira quente
(S10: 139 643 px, S03: 76 690, S01: 13 678) e o contraste local dos
manchões é ≈1,00 em todos os planos — o sinal não separa a lâmpada
ligada do fundo de madeira. O único sinal com alguma promising
separação (âmbar saturado localmente mais claro que a vizinhança) dá
10 516 px no S08, 6 931 no S09 e 6 285 no S12 — e o S09 e o S12 são
**legitimamente** acesos. Sem uma tabela de estado esperado por plano,
qualquer limiar absoluto reprovaria o filme certo. **Porta não confiável é
pior do que porta nenhuma**: a correção foi na receita, e a medição fica
como evidência por plano, não como gate.

## Gate F2 v8 — o render passou a geração, mas reprovou 4 portas de medição

O v8 **renderizou inteiro** (fala V01–V04, música, 12 stills, 12 clipes,
~70 min) e a fase de medição escreveu
`app/outputs/validacao-f2-2026-10-21-v8/shot-evidence.json` com **4
falhas**:

| Porta | Esperado | Medido no v8 |
|---|---|---|
| `S11-image` (contagem de cubos) | 1 | `{0: 1}` — nenhum cubo aceito |
| `S04-video` (presença do cubo) | ≥ 50 % dos frames | 48,3 % (`{0: 62, 1: 58}`) |
| `S04-video` (escala relativa) | spread ≤ 1,35 | 1,3979 — robô muda de tamanho contra o cubo |
| `S11-video` (presença do cubo) | ≥ 50 % dos frames | 38,3 % (`{0: 74, 1: 46}`) |

A evidência do v7 era limpa (`{1: 120}` em todos os frames de vídeo, 1
cubo nos dois stills) ⇒ **regressão introduzida pelas mudanças de prompt
do v8**, não deriva do modelo.

### Duas causas-raiz, provadas por medição

**1. Contradição de conteúdo no próprio prompt.** O v8 passou a declarar
mesa e pedestal em S01, S02, S04, S06, S07, S11 e S12, mas copiou
"bare, completely empty top" para a mesa e "its empty square cube-sized
socket" para o pedestal — **justamente onde o cubo está**: em cima da
mesa (S01, S02, S04) e assentado no encaixe (S11, S12). O modelo
resolve a contradição como lhe convém: em S11 o cubo saiu achatado
(blob `area 972, w 50, h 23, aspect 2,17`) — reprovado só por
`MAX_ASPECT = 2,00`; em S04 o cubo desapareceu.

**2. Enquadramento largo forçado.** O parágrafo de mobília do v8 ("a mesa
no alto à direita **e** o pedestal no meio do quadro") obrigava a câmera
a recuar e subir. O rastreamento do blob em S04 mostra f0 (2470 px) →
f30 (3022) → f40 (2104) → f50 (2163) → f55 (2675) → **nenhum blob de
f60 a f119**, e a contagem estrita de pixels vermelhos cai de 2852 px
(f55) para 50/10/2/6/9/0 px (f58–f119): o cubo está **genuinamente
ausente** depois de f55, não é limiar.

### A correção foi na receita, não no limiar

`MAX_ASPECT` **continua 2,00**. Subir para ~2,20 seria frágil: a "faixa
vermelha de mesa" do v6 media 2,23 e a margem de 0,03 não é defensável.
Em `tests/fixtures/cue_reference_film_v1/visual_prompts.json`:

- S01/S02: a mesa passa a ter "its bare wooden top holding only the
  single small matte red cube";
- S03: a mesa ao fundo passa a ser "blurred wooden tabletop" (o cubo
  está visível nela);
- S11/S12: o pedestal passa a ter "with the single small matte red cube
  seated in its square cube-sized socket in the base… switched on and
  glowing warm amber";
- S04 (imagem): o pedestal vai **para o fundo à esquerda, menor no
  quadro**, e entra "The camera holds this medium distance and does not
  pull back; the robot and the cube fill the frame";
- S04 (movimento): sem a frase de mobília, com "never leaves the
  frame" e "fully visible in the centre of the frame";
- S11 (imagem): "The camera is low, level with the pedestal socket, so
  the seated cube is seen from the side and reads as a solid cube and not
  as a flat shape";
- S11 (movimento): "The cube stays seated in the pedestal socket" e
  "the seated cube stays fully visible in the frame for the whole shot".

`tests/test_cue_reference_film_visual_prompts.py` passou de 7 para **10
testes**: o novo `test_no_prompt_contradicts_itself_about_the_cube`
exige que nenhum plano declare mesa/encaixe vazio onde o cubo está,
`test_s04_keeps_the_robot_and_the_cube_inside_the_frame` fixa o
enquadramento médio e a ausência de recuo, e
`test_s11_sees_the_seated_cube_from_the_side` fixa a câmera rasante ao
encaixe e a permanência do cubo no quadro.

### Validação por render-alvo (probe S04/S11)

Antes de refazer o filme inteiro, os **quatro** artefatos problemáticos
foram regerados isoladamente (imagem e vídeo de S04 e de S11, reaproveitando
as âncoras do v8) e medidos com os mesmos detectores do gate. **Todos os
gates passaram**:

| Métrica | v8 | probe v9 | Porta |
|---|---|---|---|
| STILL S04 | 2539 px, 57×49, aspect 1,17 | 2565 px, 57×48, aspect 1,19 | aspect ≤ 2,00 ✓ |
| STILL S11 | 972 px, 50×23, **aspect 2,17 (reprovado)** | 1842 px, 61×34, aspect 1,79 | aspect ≤ 2,00 ✓ |
| VIDEO S04 presença | **48,3 % (reprovado)** | 87,5 % | ≥ 50 % ✓ |
| VIDEO S04 spread | **1,3979 (reprovado)** | 1,1146 | ≤ 1,35 ✓ |
| VIDEO S04 head drift | — | 1,5141 | ≤ 1,80 ✓ |
| VIDEO S11 presença | **38,3 % (reprovado)** | 100 % | ≥ 50 % ✓ |
| S04 ratio head/cubo | — | 2,4603 | [1,0, 3,5] ✓ |

O probe prova que a **receita** corrige os quatro defeitos. O v9 é o
render completo com a mesma receita, para confirmar que a correção
sobrevive aos 12 planos e ao encadeamento de âncoras.

### O v9 renderizou e passou em todas as portas

O render completo do **v9** (`app/outputs/validacao-f2-2026-10-21-v9/`,
~78 min) terminou com **`shot-evidence.json` sem nenhuma falha** — as
4 portas que reprovaram o v8 passaram:

| Porta | v8 | v9 |
|---|---|---|
| `S11-image` (contagem de cubos) | `{0: 1}` — reprovado | `{1: 1}` — ok |
| `S04-video` (presença do cubo) | 48,3 % — reprovado | **87,5 %** (`{0: 15, 1: 105}`) |
| `S04-video` (spread da escala) | 1,3979 — reprovado | **1,1146** (limite 1,35) |
| `S11-video` (presença do cubo) | 38,3 % — reprovado | **100 %** (`{1: 120}`) |

Os 12 stills têm exatamente 1 cubo cada (S10 tem 0, como esperado) e o
`technical-report.json` do master `b1a38c1d…` passa em todas as portas
técnicas (60,0 s, 24 fps, 48 kHz estéreo, −16,16 LUFS, −1,83 dBTP).

O teste do harness que reprova é apenas
`test_f2_full_acceptance_requires_creative_review`, que exige o
`creative-review.json` — o **passo humano**, não uma falha de geração.

### O som do v9 tinha dois defeitos que nenhuma porta media

O v9 passou em todas as portas de **imagem**, mas o som carregava dois
defeitos que nenhuma porta media. Ambos foram medidos sobre os artefatos
reais do v9 e ambos viraram porta automática:

**Causa A — o leito repetia o silêncio do gerador.** O take do MMAudio
abre com **0,108549 s** de silêncio quase digital (envelope: −78,0,
−77,1, −48,1, −37,4 dBFS antes de subir para o nível de regime, −15,89
dBFS). O `-stream_loop -1` repetia o arquivo inteiro, então o silêncio
era repetido a cada ciclo: **12 grupos de buraco** no leito de 60 s, o
mais longo de **250 ms**. A porta `check_bed_continuity` reprova um
leito que cai 18 dB abaixo da própria mediana por 100 ms ou mais, e
reprova o v9 tanto no stem colocado quanto no nivelado (mediana
−30,40 dBFS, limiar −48,40 dBFS).

**Causa B — a música morria antes do fim.** O LM do ACE-Step escreve
cerca de **86 %** dos tokens pedidos e depois repete `codes[-1]`: a
cauda congela. A fração acompanha a duração pedida (60 s → morte em
51,2 s; 70 s → 60,6 s; 75 s → 65,3 s). A porta `check_music_coverage`
reprova quando a mediana dos últimos 3 s cai mais de 12 dB abaixo da
mediana do corpo; no v9 a queda é de **36,7 dB**, no stem colocado e no
nivelado.

Uma leitura anterior sugeria um degrau de "+8 dB" na música. A medição
do envelope de 50 ms **não** mostra degrau: o que existe é a rampa de
nível do take do MMAudio repetida a cada ciclo do leito. O degrau é do
loop, não da música — hipótese descartada por medição.

**As correções.** O leito passa por `build_seamless_loop`, que **mede** a
região sustentada do take (mediana do último quarto como referência;
faixa que nunca cai mais de 6 dB abaixo dela) e monta o ciclo com
*crossfade* de potência igual. A emenda do arquivo coincide exatamente
(descontinuidade medida 0,000061 contra p99,9 = 0,0125 do resto do
sinal) e o leito repetido sob 60 s não abre buraco. A música passa a ser
pedida com **75 s** e aparada pela **cabeça** para 60 s — o corte pela
cauda foi testado e reprova (39,7 dB), o que confirma que a cabeça é o
corte certo. A música de 75 s aparada dá queda de **−1,1 dB** (cauda mais
alta = saudável).

As duas portas rodam sobre os **stems colocados, antes do mix**; as
falhas são coletadas, gravadas em `sound-evidence.json`, e o teste aborta
antes de mixar, para que um som reprovado não produza um master.

### O v10 corrigiu os dois defeitos de som e passou em todas as portas

O render do **v10** (`app/outputs/validacao-f2-2026-10-22-v10/`) aplicou
as duas correções de áudio. O `shot-evidence.json` está **sem nenhuma
falha** e o `sound-evidence.json` também:

| Porta | v9 | v10 |
|---|---|---|
| `bed_continuity` (buracos no leito) | 12 grupos, pior 250 ms — reprovado | **0 buracos** (mediana −29,17 dBFS, limiar −47,17 dBFS) |
| `music_coverage` (queda na cauda) | 36,7 dB — reprovado | **−1,06 dB** (cauda mais alta = saudável) |

O master `9911589e…` passa em todas as portas técnicas: 60,0 s, 24 fps,
48 kHz estéreo, −16,14 LUFS, −1,80 dBTP, drift A/V dentro de um frame.

O custo do v10 foi de ~7 min de GPU, e não ~78 min como o v9: os **30
recibos** cujo pedido é byte a byte idêntico ao do v9 (12 imagens, 12
vídeos, 4 falas, 2 âncoras) foram copiados, e só a **música** (pedido
alterado para 75 s) e os **5 SFX** (o `video_guide` embute o diretório de
validação) foram regerados. A verificação de reaproveitamento foi feita
**antes** do render, reconstruindo os params que o harness pediria e
comparando com cada recibo — é o que garante que o cliente estrito não
rejeite o lote com "Receipt parameters changed".

### O que ainda falta

A página de revisão do **v10** foi reconstruída
(`scripts/build_reference_review.py`) e está sendo servida em
`http://127.0.0.1:8901/review.html` com suporte a `Range` (verificado:
`206` com `Content-Range` correto, faixa de áudio AAC estéreo 48 kHz de
60 s, vídeo tocando no navegador). Falta **apenas** a revisão criativa
humana, com as **seis** dimensões — `pt_br_voice` e `sound_editing`
nunca foram avaliadas de verdade, porque o som só apareceu depois do bug
de HTTP Range. O `creative-review.json` tem de ser emitido contra o
hash `9911589e77b614644e3da8188d02d5a10410c39dd1fc384a352c55457ce6b97b`;
os arquivos antigos não valem (o hash do master mudou).


## O terceiro erro crítico do v6 — o robô flutuando — e por que ele não virou porta

O v6 foi reprovado na revisão humana por três erros críticos: cena com
dois cubos, robô de tamanhos diferentes ao longo do vídeo e robô
flutuando. Os dois primeiros viraram portas automáticas. O terceiro
continua sem porta, e esta seção é o registro do que foi tentado, do
que a medição mostra e do que a medição **não** consegue mostrar.

### O que é mensurável aqui, e o que não é

`app/services/reference_ground.py` mede a altura em que o robô está
acima da própria sombra, expressa em larguras de cabeça. A escolha do
marcador é forçada, e foi verificada quadro a quadro:

- o corpo cinza-claro **não é segmentável** — compartilha a faixa de
  valor com a parede e com o chão de madeira. A regra mais simples
  (`s < 70 e v > 150`) não acha corpo algum em nenhum dos 120 quadros
  do S04 do v7, e quando acha algo, é a borda da mesa;
- o detalhe azul-escuro do robô é esparso demais para servir de marca;
- a **sombra que o robô projeta no chão** é o único marcador do plano
  do piso sob ele.

A distância da cabeça até a sombra é normalizada pela largura da
cabeça porque o robô é desenhado em escalas muito diferentes entre
planos, e o defeito é a *altura acima do chão*, não o tamanho na tela.
Um robô no chão projeta a sombra nos pés; um robô flutuando a projeta
mais abaixo.

### O que a medição mostra

| Plano | v6 (reprovado, robô flutuando) | v7 (corrigido) |
|---|---|---|
| S07 | **4,51** larguras de cabeça acima da sombra | **2,03** |
| Demais 11 planos | não mensurável (sem sombra no quadro) | não mensurável |

No S07, o único plano em que as duas versões produzem medição quadro a
quadro, **o robô do v6 está mais alto em 23 dos 23 quadros** em que
ambos são mensuráveis. A direção é a que a revisão humana apontou.

Ressalva, porque o número sozinho induz a erro: o S07 do **v6 está
gravado como `measurable: false`** — a cobertura dele é 0,20, abaixo do
piso de 0,30, e o artefato o marca como não mensurável como plano. O
4,51 é valor **indicativo**, medido nos 24 quadros em que o v6 tem
detecção e pareado com os 23 em que o v7 também tem. O v7, com
cobertura 0,68, é o único plano realmente mensurável dos dois filmes.

### O que a medição não consegue mostrar

**O plano não tem sombra em 11 dos 12 planos de cada filme.** Onde não
há sombra não há nada no quadro que diga onde o chão está sob o robô, e
a resposta honesta é "não mensurável", não um número inventado a partir
da parede atrás. E onde a sombra aparece, a cobertura é baixa: no v6
o S07 é medido em 20 % dos quadros e no v7 em 68 %.

Por isso a métrica é **evidência, nunca porta**: um gate que só
dispara em 1 dos 12 planos não pode carregar a aceitação de um filme,
e um gate disparado por um número sem corpus rotulado rejeitaria um
filme correto. A medição fica gravada em `shot-evidence.json` e em
`technical-report.json` (chave `ground_evidence`) para que a revisão
humana tenha um número por plano em vez de uma impressão.

O piso de sanidade `MIN_STAND_IN_HEAD_WIDTHS = 1.0` existe por causa de
uma armadilha medida: a faixa escura logo abaixo da cabeça está a
0,15–0,35 largura de cabeça em **todos** os planos mensuráveis dos dois
filmes — é a sombra do próprio queixo da cabeça, não a sombra no chão.
Sem o piso, a métrica lia o queixo como chão e devolvia 0,15 em vez de
2,03.

**Conclusão honesta: o defeito de "robô flutuando" é mensurável onde o
render projeta a sombra, e não é mensurável no resto. A revisão
artística humana continua sendo a porta para ele.**

## Gate F2 (histórico) — geração real concluída, revisão humana pendente

Um master real de 60 s foi gerado com inferência de IA efetiva e medido em
`app/outputs/validacao-f2-2026-10-19-v3/` (não versionado). Todos os
critérios objetivos de `validate_master()` passam:

| Critério | Esperado | Medido |
|---|---|---|
| Frames | 1440 | 1440 |
| FPS | 24 | 24 |
| Sample rate | 48 000 Hz | 48 000 Hz |
| Canais | 2 (estéreo) | 2 |
| Duração de áudio | 2 880 000 amostras | 2 880 000 |
| Drift A/V | ≤ 1 frame | ≤ 1 frame |
| Loudness | −16 LUFS ± 1 | −16,42 LUFS |
| True peak | ≤ −1 dBTP | −1,96 dBTP |

SHA-256 do master: `34400a097b0705b72d29c5baae561ec4160de41b09ef558326195527358928ca`.
Composição real: 4 falas PT-BR (`qwen3_tts_base` com `voice-reference.wav`),
1 faixa musical (`ace_step_v1_5_turbo_lm_4b`), 2 âncoras visuais, 12 imagens
(`flux2_klein_9b`), 12 vídeos (`ltx2_22B_distilled_1_1`) e 5 efeitos
(`mmaudio_v2`). Os 36 recibos em `receipts/` registram ID, parâmetros,
estado, caminho e SHA-256.

O que ainda falta é apenas a **revisão artística humana**: um
`creative-review.json` emitido por quem assistiu ao master e ouviu as falas.
Sem ele, `pytest -m real_models -k full_acceptance` falha por ausência do
arquivo — o `validate_master()` do master passa. A página de revisão está em
`app/outputs/validacao-f2-2026-10-19-v3/review.html`.

### Causas-raiz corrigidas durante a geração real

Cinco defeitos impediram a geração; todos corrigidos em código, não no
cliente de validação:

1. **Duas janelas de vídeo.** `app/models/_settings.json` define
   `sliding_window_size: 129` global. Com `video_length=241`, o gerador
   produzia duas janelas e salvava um `.mp4` por janela; o cliente estrito
   recusa múltiplos artefatos. Corrigido com `video_length: 129` (janela
   única, acima dos 120 frames exigidos pelo gate).
2. **`torchdiffeq` ausente no ambiente.** Declarado em `app/requirements.txt`,
   mas não instalado em `app/env`; o job de SFX falhava com
   `ModuleNotFoundError` em `flow_matching.py`.
3. **`torchaudio.save` exigia FFmpeg 8.** `remux_with_audio()` roteava pelo
   backend torchcodec, que requer `libavutil.so.60`; o sistema tem FFmpeg 6.1.
   Substituído por `_write_pcm_wav()` em PyAV, dependência dura do próprio
   módulo (`app/postprocessing/mmaudio/data/av_utils.py`).
4. **Ordem dos filtros de áudio.** `_place_audio()` aplicava `adelay` e
   `atrim` antes do resample; como o MMAudio entrega 44.100 Hz mono, o corte
   de 60 s acontecia na taxa nativa e o offset do cue errava 8,8 %. Corrigido
   movendo `aresample=48000` para o início da cadeia.
5. **Overshoot de true peak no AAC.** O `mix.wav` estava correto, mas a
   codificação AAC empurrava o pico para −0,76 dBTP. Corrigido com headroom
   no mix (`TP=-2,5`) e `alimiter` no encode do master.

As correções 4 e 5 estão em `tests/test_cue_reference_film_f2_real_models.py`;
a 3 em `app/postprocessing/mmaudio/data/av_utils.py`. A 1 e a 2 são de
configuração e de ambiente, respectivamente.

**Risco operacional:** o LM Studio recarrega sozinho na VRAM e pode ocupar
~9,5 GB dos 12 GB da RTX 3060, causando OOM no TTS. Verificar `nvidia-smi`
antes de disparar novos jobs de GPU.

## Homologação real ainda em andamento

O usuário forneceu uma referência vocal PT-BR. Foram geradas as quatro falas reais com o modelo de voz instalado;
as durações são 4,30 s, 2,86 s, 2,70 s e 3,10 s, dentro das respectivas janelas. O checkpoint usado foi registrado
com SHA-256. A música real terminou. A primeira tentativa visual foi rejeitada por erros de continuidade;
uma segunda usa o Flux 2 Klein com âncoras de personagem/ambiente. O polling conserva o
mesmo job durante timeout transitório de carregamento de modelo. Recibos e artefatos locais ficam em
`app/outputs/validacao-f2-2026-10-19/` (não versionados).

A aprovação F2 **não** está mais pendente apenas no passo humano: a revisão
artística do master v3 **ocorreu e reprovou** (ver a seção de estado no topo
deste arquivo). O que falta agora é a **nova** revisão artística do master
produzido com a âncora corrigida e o S10 reformulado (v6), porque o hash do
master mudou e o `creative-review.json` do v3 é imutável. Não reutilizar os antigos “F2 2/2”
como prova. Também
não declarar instalação reproduzível dos cinco perfis E0–E4: a resolução e os
hashes desses ambientes continuam sem homologação. Atualizações do histórico
em HANDOFF/TODO não substituem a evidência por execução.
