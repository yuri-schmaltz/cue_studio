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
