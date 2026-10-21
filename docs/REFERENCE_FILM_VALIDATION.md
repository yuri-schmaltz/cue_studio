# Validação da obra de referência

F0 é mídia determinística; F1 usa mídia congelada e geração controlada; F2
exige inferência real e revisão do resultado; F3 exercita falhas e recuperação.
Um teste técnico aprovado não equivale a aprovação artística.

## Gate F2

O teste antigo foi substituído porque gerava tons na etapa de voz e permitia
fallbacks sintéticos para música e vídeo. Os antigos resultados “F2 2/2” não
comprovam geração integral por IA.

O novo teste envia pedidos ao Studio real (`POST /api/v1/generate`) e acompanha
cada job em `/api/v1/status/{id}`. Aceita somente arquivos declarados pelo job
concluído, contidos em seu diretório de saída. Registra ID, parâmetros, estado,
caminho e SHA-256 em `receipts/`. Erro, cancelamento, arquivo ausente ou timeout
não viram sucesso sintético. Timeout conserva o recibo e não cancela o job;
inspecione a fila antes de disparar uma nova execução.

1. Inicie o backend local com os modelos e referências de voz instalados.
2. Crie um workspace exclusivo para validação. Selecione no Studio pedidos
   funcionais para fala PT-BR, música instrumental, imagem com referências visuais, vídeo condicionado
   por imagem e efeitos sonoros. Confirme que o modelo de voz suporta o idioma
   e as referências escolhidas; o nome de um checkpoint não comprova suporte.
3. Crie um JSON fora de arquivos de configuração pessoais com este formato:

```json
{
  "base_url": "http://127.0.0.1:7860",
  "server_output_dir": "/caminho/absoluto/do/workspace",
  "validation_dir": "/caminho/absoluto/dos/artefatos-de-validacao",
  "job_timeout": 3600,
  "image_supports_references": true,
  "character_anchor_seed": 99,
  "speech": {"model_type": "modelo-de-voz-instalado", "workspace": "validacao-f2"},
  "music": {"model_type": "modelo-musical-instalado", "prompt": "[Instrumental]", "workspace": "validacao-f2"},
  "image": {"model_type": "modelo-de-imagem-instalado", "workspace": "validacao-f2"},
  "video": {"model_type": "modelo-de-video-instalado", "workspace": "validacao-f2"},
  "sfx": {"model_type": "modelo-de-efeitos-instalado", "workspace": "validacao-f2"}
}
```

Os IDs acima são placeholders, não modelos fictícios utilizáveis. Acrescente
os parâmetros reais exportados do Studio (passos, resolução, duração nativa,
referência de voz etc.). O teste substitui prompts de fala/imagem/vídeo pelo
briefing canônico. O modelo de imagem deve suportar `image_refs` com `video_prompt_type=KI`;
as âncoras de personagem e ambiente são geradas e usadas em todos os planos pertinentes.
A geração de imagem define `image_mode=1` e um único frame para exigir um arquivo de imagem. O backend e o teste precisam compartilhar o filesystem:
`server_output_dir` é onde o backend realmente grava os arquivos desse workspace.
A geração de vídeo deve fornecer pelo menos 120 frames por plano; a montagem
conforma os clips para slots de 120 frames a 24 fps, sem repetir frames para
esconder uma geração incompleta.

```bash
CUE_RUN_REAL_MODELS=1 CUE_F2_CONFIG=/caminho/f2.json \
  app/env/bin/python -m pytest tests/test_cue_reference_film_f2_real_models.py \
  -m real_models -k generate_and_measure -v
```

Se a API exigir autenticação, configure `CUE_F2_TOKEN` no ambiente. O token
não é gravado nos recibos. A ausência de configuração quando a geração real
é solicitada causa falha; a suíte comum indica esses testes como ignorados.

### Identidade do personagem é medida, não presumida

O design pede **três** lentes ciano no rosto do robô ("exactly three circular
cyan camera lenses arranged as a triangle"). A revisão humana do master v3
reprovou o filme porque o robô *sempre* tinha quatro lentes — e a causa não era
o prompt: o `flux2_klein_9b` (4 steps, guidance 1) **ignora a contagem
explícita** e produz 4 lentes em losango de forma determinística na maior
parte das seeds (7, 8, 42, 101, 555, 777, 1234, 31415). Como as 12 imagens de
plano recebem `image_refs: [anchor-character, anchor-location]`, todas herdavam
a identidade errada.

Por isso a contagem virou métrica: `app/services/reference_identity.py`
segmenta ciano em HSV, mantém blobs circulares e conta por frame. O gate usa:

- **gate duro no âncora de personagem** — se a âncora não tiver exatamente 3
  lentes ciano, o gate falha antes de renderizar os 12 planos, com a lista de
  seeds já medidas como corretas (99 → 555 → 42 → 8 → 1234);
- **gate duro no S03** (close-up de luz neutra) — imagem e vídeo;
- **evidência nos demais planos** — registrado em `technical-report.json`
  (`lens_evidence`), sem reprovar o gate.

`character_anchor_seed` no `f2-config.json` fixa a seed da âncora: **99**
(ciano puro, geometria triangular: dois em cima, um abaixo). O prompt
canônico **não** precisa ser reescrito; a seed é o que garante a contagem.

### O S10 provou que a seed não era a causa

O close-up âmbar do S10 (plano 10) mostrava **4 lentes ciano reais** em
losango — não era artefato do detector nem falha da âncora: o HSV medido foi
H 88–90, S 135–155, V 238–241 (ciano saturado, 4 blobs reais). Duas
investigações fecharam a causa:

- **A seed não resolve.** O prompt original do S10 com a seed 99 (a mesma da
  âncora) produz **as mesmas 4 lentes**. O defeito acompanha a *redação*,
  não o sorteio.
- **A formulação do prompt resolve.** A âncora e o S03 acertam porque dizem
  "two lenses on top and one centered below" / "two above and one centered
  below" com a geometria canônica; o S10 dizia apenas "two above and one
  below" sob luz âmbar. Reescrever o S10 como

  > "…Exactly three cyan camera lenses arranged as a triangle: two lenses on
  > top and one centered below, identical to the character reference. No
  > mouth. Same head geometry as the character reference."

  produz **3 lentes em triângulo canônico** (duas em cima, uma abaixo),
  de forma **determinística** (3 execuções com seed 42 → resultado
  byte-a-byte idêntico).

A alternativa `negative_prompt` + `NAG_scale: 1.5` / `NAG_tau: 3.5` /
`NAG_alpha: 0.5` no bloco `image` também foi provada (3 lentes), mas ela
muda os params de **todas** as 12 imagens e obriga a re-renderizar o filme
inteiro; por isso a reescrita do prompt do S10 foi preferida. Note que no
`flux_main.py` o `negative_prompt` só age quando `guide_scale <= 1` **e**
`nag_scale > 1` — com `guidance_scale: 1` do `flux2_klein_9b`, sem o NAG o
`negative_prompt` é ignorado.

Por isso o gate tem **três** portas duras: âncora de personagem, S03
(luz neutra) e **S10** (luz âmbar), que era justamente onde o defeito
passava.

Para auditar qualquer artefato:

```bash
app/env/bin/python scripts/count_lenses.py app/outputs/<arquivo>.mp4
```

### As portas do v7 e o que elas medem

O master v6 passou no gate técnico e foi reprovado na revisão humana. As
portas que faltavam foram adicionadas, e cada uma mede o defeito que a
revisão apontou:

- **contagem de cubos por still** (`reference_cube.check_cube_count`) — o
  still de cada plano é medido contra o número de cubos que o roteiro pede
  (1, e 0 no S10, cujo close-up exclui o cubo). O v6 reprovava aqui: o S06
  media 2 cubos.
- **continuidade do cubo por clip** (`reference_cube.check_cube_continuity`) —
  a fração de quadros com um segundo cubo não pode passar de 25 %. O S06 do
  v6 media 97,5 % de quadros com dois cubos.
- **estabilidade de escala dentro do plano** (`reference_robot.check_scale_stability`)
  — a largura da cabeça medida pelo vão das três lentes não pode variar mais
  que 1,8× entre o percentil 10 e o 90 dos quadros medidos.
- **régua cabeça/cubo** (`reference_continuity.check_relative_scale`) — a
  largura da cabeça dividida pela largura do cubo, medida só onde o robô
  segura o cubo, tem de cair na banda `[1,0 ; 3,5]` e variar menos que
  1,35× dentro do plano.
- **consistência de escala ao longo do filme**
  (`reference_continuity.check_scale_consistency`) — a mesma régua, comparada
  entre os planos, não pode variar mais que 1,25×. É esta porta que mede
  *"robô de tamanhos diferentes ao longo do vídeo"*: o v6 reprovado abre
  1,70× (0,91 em S07 contra 1,55 em S04).

A régua de escala antes media a cabeça por **união** de blobs de lente com
uma distância absoluta de 40 px. Em close-up essa distância é pequena
demais e a união cobria só 2 das 3 lentes, de modo que a régua media
coisas diferentes em planos diferentes. Agora a cabeça é o vão das três
lentes, e o grupo de lentes é o mais apertado entre as combinações de
três. Sem essa correção a porta de consistência mediria ruído.

### O terceiro erro crítico não virou porta, e a medição mostra por quê

A revisão humana do master v6 apontou três erros críticos. Dois viraram
portas automáticas — a cena com dois cubos e o robô de tamanhos
diferentes ao longo do vídeo. O terceiro, *"robô flutuando"*, continua
sem porta. A regra deste projeto é que uma porta mede um defeito: sem
uma medida que separe o v6 do v7, não há porta.

`app/services/reference_ground.py` é a tentativa de construir essa
medida. Ela mede a altura em que o robô está acima da **própria sombra**,
em larguras de cabeça.

**Por que a sombra.** O corpo do robô é cinza-claro e compartilha a
faixa de valor com a parede e com o chão de madeira: a regra de
segmentação mais simples (`s < 70 e v > 150`) não encontra corpo em
nenhum dos quadros do S04 do v7. O detalhe azul-escuro do robô é
esparso demais para marcar. A sombra projetada no chão é o único
marcador do plano do piso sob o robô, e é a única coisa no quadro que
distingue "o robô está a 2 cabeças de altura do chão" de "o robô está
colado no chão".

**Por que normalizar pela cabeça.** O robô é desenhado em escalas muito
diferentes entre planos — um close-up mostra uma cabeça maior, e é
suposto que mostre. A normalização pela largura da cabeça deixa o
número comparável entre planos: o que muda é a altura acima do chão,
não o tamanho na tela.

**O que a medida mostra no corpus.** No S07, o único plano em que as
duas versões produzem medição quadro a quadro, o robô do v6 está mais
alto em **23 dos 23 quadros** (4,51 contra 2,03 larguras de cabeça). A
direção é exatamente a que a revisão humana apontou.

Ressalva de honestidade, porque o número sozinho induz a erro: o S07 do
**v6 está gravado como `measurable: false`** — a cobertura dele é 0,20,
abaixo do piso de 0,30, então o artefato o marca como não mensurável
como plano. A tabela acima traz 4,51 como valor **indicativo**, medido
nos 24 quadros em que o v6 tem detecção e pareado com os 23 quadros em
que o v7 também tem. O v7, com cobertura 0,68, é o único plano
mensurável dos dois filmes. A assimetria de cobertura é a própria
evidência de que os renders são irregulares — e é por isso que a
métrica é evidência, não porta.

**Por que isso não é uma porta.** Em 11 dos 12 planos de cada filme o
render não projeta sombra sob o robô, e onde projeta a cobertura é
baixa (20 % no v6, 68 % no v7). Uma porta que só existe em 1 de 12
planos não pode decidir a aceitação de um filme; e um limiar escolhido
sem corpus rotulado rejeitaria um filme correto, que é exatamente o
erro que este projeto já cometeu uma vez — cada detector que já mudou
foi recalibrado contra um corpus com rótulo do revisor.

A métrica é portanto gravada como **evidência** (`ground_evidence` em
`shot-evidence.json` e `technical-report.json`), para que a revisão
humana tenha um número por plano em vez de uma impressão, e a revisão
artística humana continua sendo a porta para esse defeito.

**Uma armadilha que a calibração pegou.** A faixa escura logo abaixo da
cabeça está a 0,15–0,35 largura de cabeça em *todos* os planos
mensuráveis dos dois filmes: é a sombra do queixo da cabeça, não a
sombra no chão. Sem o piso `MIN_STAND_IN_HEAD_WIDTHS = 1,0` a métrica lia
o queixo como chão e devolvia 0,15 onde o valor certo era 2,03 — e a
comparação entre o v6 e o v7 invertia o sinal.

### O prompt negativo de imagem só existe com NAG ligado

No `app/models/flux/flux_main.py` o `negative_prompt` é codificado apenas
quando `nag_scale > 1` **e** `guide_scale <= 1`. Com `guidance_scale: 1` e
sem `NAG_scale`, o `negative_prompt` é aceito pelo backend e **descartado
em silêncio**: é o que produziu o segundo cubo e a quarta lente do master
v6. O bloco `image` do `f2-config.json` precisa trazer `NAG_scale 1.5`,
`NAG_tau 3.5` e `NAG_alpha 0.5`, e o teste do F2 verifica as duas condições
antes de renderizar — um prompt negativo sem elas é uma promessa vazia.

O prompt negativo faz parte da **receita do filme**, não da máquina que o
renderiza, então ele mora com os prompts, em
`tests/fixtures/cue_reference_film_v1/visual_prompts.json` (chave
`negative`, com `image` e `video`), e o teste o anexa aos parâmetros.

### Nada de cubo na âncora de ambiente

A âncora de ambiente é passada como `image_ref` para todos os planos. Se o
seu prompt mencionar o cubo, **todo plano herda o cubo nas mesmas
coordenadas de tela** — foi assim que o v6 pôs um cubo vermelho em S01,
S02, S06 e S11. O prompt de `location` descreve a mesa como
*"a bare, completely empty tabletop"* e a âncora de ambiente é medida
(0 blobs) antes de o filme continuar.


### Memória entre lotes e repetição de job falho

Duas proteções no teste do F2, ambas nacidas de uma falha real do v7:

- **Devolver a VRAM entre os lotes.** O Studio mantém o modelo de um job
  residente entre jobs de propósito, para que uma repetição do mesmo
  modelo não recarregue o checkpoint. O modelo de vídeo **não cabe** na GPU
  ao lado do modelo de imagem: com o Flux2 ainda residente, o primeiro
  clip morre com `CUDA out of memory` (o job pedia 368 MiB e havia 115 MiB
  livres). O teste chama `POST /api/v1/system/release-model` antes do lote
  de vídeo e antes do lote de efeitos — é o mecanismo previsto pelo
  backend para devolver a memória, e o Studio recarrega o modelo de forma
  transparente no job seguinte.
- **Repetir um job que falhou.** Um job falhado não deixa artefato, então o
  recibo dele não protege nenhuma evidência: o teste remove o recibo com
  `status: failed` ou `cancelled` antes de tentar de novo. Um recibo de job
  **concluído** nunca é tocado, e o artefato que ele aponta também não.

Um segundo fato da mesma falha: o servidor de LLM do LM Studio **volta
sozinho** quando outro aplicativo (o Strata, que faz transcrição) pede o
modelo de novo. Enquanto ele estiver na GPU, o primeiro job de imagem já
falha. A VRAM precisa estar livre durante a geração.
### Armadilhas conhecidas

- **Balance do mix vs. voz PT-BR.** O `ace_step` entrega um leito ~12 dB acima
  do TTS; mix por loudness global enterra a narração. `app/services/reference_mix.py`
  fixa âncoras absolutas por papel (speech/music/ambient/effect) e mede a
  margem de narração sobre o leito. Sem isso a nota `pt_br_voice` é 0.
- **`loudnorm` recusa o modo linear e destrói o mix.** Quando o ganho
  estático necessário para atingir a loudness alvo estouraria o teto de
  true peak — ou quando o **LRA medido ultrapassa o LRA alvo** — o `loudnorm`
  recusa o modo `linear=true` e cai no **modo dinâmico**. Efeitos medidos:
  (a) a cadeia inteira passa a rodar a **192 kHz**, e um `atrim=end_sample=N`
  passa a contar amostras de 192 kHz — um programa de 60 s sai com 15 s
  (720 000 amostras em vez de 2 880 000); (b) a re-equalização dinâmica
  re-levanta os trechos silenciosos e **perde 5,9–6,1 dB** de separação
  voz/leito (medido: 10,30 dB → 7,10 dB), o que reprova a margem de narração
  de 3 dB. O módulo usa agora um **ganho estático medido** + limitador de
  picos, nunca `loudnorm`, e corrige o ganho a partir da medição do mix
  renderizado.
- **O `measure()` mede em `loudnorm`, o `ebur128` mede de outro modo.**
  `measure()` usa `loudnorm=print_format=json` (que aplica o filtro
  dinamicamente ao medir) e é a referência do gate; `ebur128=peak=true` é
  o medidor independente. As duas leituras coincidem no `I`, mas o
  `input_tp` do `loudnorm` difere do `Peak` do `ebur128` em ~0,03 dB.
  Para auditar por fora, prefira `ebur128`; para o gate, `measure()`.
- **`DEFAULT_NEGATIVE_PROMPT` do LTX-2 é hostil ao estilo 3D.** Ele contém
  "3D CGI look, cartoonish rendering, unrealistic materials" e é usado por
  padrão. Enviar um `negative_prompt` explícito **substitui** esse default
  (verificado em `ltx2.py`: o texto enviado é usado no lugar do default). O
  gate envia `negative_prompt` explícito no bloco `video` do `f2-config.json`,
  com "fourth lens", "extra lens", "duplicate cube", "floating robot",
  "changing robot size" e "distorted lamp holder".
- **`input_video_strength`.** Valor clampado em [0,1], default 1.0, e forçado
  a 1.0 quando o campo não é visível. Enviar `1.0` explicitamente evita que
  uma versão futura do backend altere o condicionamento.
- **Vídeo não herda a âncora.** O vídeo usa `image_start` + `image_prompt_type:
  'S'`; `image_refs` só é lido quando "I" ∈ `video_prompt_type` (verificado em
  `wgp.py`). Condicionar o vídeo na âncora exige `image_refs` com "I" no tipo
  de prompt de vídeo ou `frames_positions`/`original_input_ref_images`.
- **O detector de lentes tem limites.** Ele perde blobs em escala pequena
  (plano médio: 2 de 3 detectados) e falha sob luz âmbar (S10/S04: as lentes
  perdem saturação e o brilho da lâmpada vira falso positivo). Por isso o
  gate duro só vale no âncora e em close-up de luz neutra.
- **Seed fixo + poucos passos propagam drift.** Seed fixa com 4 steps
  reproduz o mesmo artefato no mesmo ambiente, mas um backend re-renderizado
  pode divergir — nesse caso o gate reprova, o que é o comportamento
  desejado.
- **`video_guide` dos SFX embute caminho absoluto.** Mudar o diretório de
  validação invalida todos os recibos, inclusive os de áudio.
- **Janelas de vídeo.** `app/models/_settings.json` define
  `sliding_window_size: 129` global. Com `video_length` maior que isso, o
  gerador salva um arquivo por janela e o cliente estrito recusa
  ("expected one generated artifact"). Use `video_length: 129` — uma janela,
  acima dos 120 frames exigidos pelo gate.
- **VRAM ocupada por outro processo.** O filme consome **7,1 GB** de VRAM
  no pico (medido no job de vídeo do LTX-2). Um servidor local de LLM do
  LM Studio com **8,65 GB** faz o **primeiro job de imagem** falhar com
  `CUDA out of memory` (restavam 966 MiB para uma alocação de 1,16 GiB).
  Verifique `nvidia-smi` antes de disparar jobs e encerre o LLM: o filme
  não cabe na GPU com ele ligado.
- **Ambiente incompleto.** `torchdiffeq` é importado por
  `app/postprocessing/mmaudio/model/flow_matching.py` e consta em
  `app/requirements.txt`; ambientes criados antes dessa dependência precisam
  de `VIRTUAL_ENV=app/env uv pip install torchdiffeq==0.2.5`.
- **Reuso de recibos.** O cliente guarda o `job_id` no recibo e reaproveita
  artefatos concluídos quando os parâmetros são idênticos. Mudar parâmetros
  exige um diretório de validação novo. Recibos com `status: failed` precisam
  ser removidos manualmente antes de reexecutar.
- **Diretório de trabalho.** `wgp.get_model_def()` lê `models/_settings.json`
  por caminho relativo e exige CWD = `app/`.

A geração conserva os arquivos reais e produz stems PCM estéreo a 48 kHz,
com 2.880.000 amostras/canal. Fala maior que sua janela é rejeitada antes de
qualquer corte. Os cues usam offsets em amostras; o master deve ter 1.440
frames, 24 fps, drift A/V de no máximo um frame, −16 LUFS ± 1 LU e true peak
≤ −1 dBTP. O master é validado antes de substituir o destino final.

## Revisão artística

Assista ao master produzido, ouça todas as falas e revise suas terminações.
Crie `creative-review.json` dentro de `validation_dir`, com o SHA-256 do master
real e as notas efetivamente atribuídas:

```json
{
  "master_sha256": "SHA256_DO_MASTER_REVISADO",
  "reviewer": "Nome do avaliador",
  "reviewed_at": "Data e hora da revisão",
  "scores": {
    "identity": 3,
    "continuity": 3,
    "motion": 3,
    "appearance": 3,
    "pt_br_voice": 3,
    "sound_editing": 3
  },
  "critical_errors": [],
  "speech_correct_and_untruncated": true,
  "title_correct": true
}
```

Esse exemplo é um formato, não uma revisão realizada. Cada dimensão deve
receber nota ≥ 3 em escala de 0 a 4. Registre qualquer erro crítico em vez de
preencher uma lista vazia por conveniência. Uma nova versão do master invalida
a revisão anterior pelo hash.

O candidato corrente é o master **v6**
(`app/outputs/validacao-f2-2026-10-20-v6/master.mp4`, SHA-256
`d892bd0890e8ebd8aa24d15f973265a9c8579ac3b20b4bfa4ffd4ded1da71214`), com a
página de revisão em `review.html` na mesma pasta. Ele passa nos 8 checks
objetivos do `validate_master()` (−16,13 LUFS, −2,31 dBTP, 1440 frames,
drift ≤ 1 frame) e tem 3 lentes no S10; falta apenas o julgamento humano.

```bash
CUE_RUN_REAL_MODELS=1 CUE_F2_CONFIG=/caminho/f2.json \
  app/env/bin/python -m pytest tests/test_cue_reference_film_f2_real_models.py \
  -m real_models -k full_acceptance -v
```

## Recuperação F3

Os testes comuns cobrem encerramento abrupto de processo após commit SQLite,
reabertura em dois processos independentes, cancelamento antes de conclusão
tardia, replay de retake após reabrir o banco, publicação validada/atômica e
referência removida antes do despacho. Usam CPU/FFmpeg e não comprovam retomada
interna de difusão nem qualidade artística após falha de GPU.

```bash
app/env/bin/python -m pytest -q \
  tests/test_recovery_process.py tests/test_cue_reference_film_f3_recovery.py \
  tests/test_media_publication.py tests/test_director_input_recovery.py
```
