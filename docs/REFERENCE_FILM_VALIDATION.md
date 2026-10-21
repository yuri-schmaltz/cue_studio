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
- **VRAM ocupada por outro processo.** Um servidor local de LLM (LM Studio)
  pode tomar ~9,5 GB dos 12 GB da GPU e causar OOM no TTS. Verifique
  `nvidia-smi` antes de disparar jobs.
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
