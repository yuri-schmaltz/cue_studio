# Handoff — v11 do filme de referência F2

**Data:** 22/10/2026
**Repositório:** `/home/yuri/Documentos/cine_local/cue_studio`
**Branch:** `main` — HEAD `eea818e` ("fixes"), working tree limpo.
**Motivo do handoff:** o master **v10** foi reprovado na revisão criativa humana
com 5 erros críticos. O trabalho do v11 está **diagnóstico + parcialmente
implementado**. A implementação que falta está descrita abaixo, com o estado
exato de cada item.

---

## 1. Onde o projeto está

O **master v10** está reprovado em
`app/outputs/validacao-f2-2026-10-22-v10/creative-review.json`:

```json
"scores": { "identity": 2, "continuity": 2, "motion": 4,
            "appearance": 3, "pt_br_voice": 0, "sound_editing": 0 },
"critical_errors": [
  "1) vídeo sem áudio;",
  "2) variação de tamanho do robô entre as cenas;",
  "3) variação do formato da lâmpada;",
  "4) robô sem cabeça (do segundo 30 a 34);",
  "5) lâmpada e cubo sobrepostos em algumas cenas"
],
"master_sha256": "9911589e77b614644e3da8188d02d5a10410c39dd1fc384a352c55457ce6b97b"
```

O gate que reprova é `validate_creative_review()` em
`app/services/reference_acceptance.py`: exige score 3–4 em todas as dimensões
artísticas, `critical_errors == []`, `speech_correct_and_untruncated == true` e
`title_correct == true`.

**Servidores: nenhum está rodando no momento** (Studio 7860 e revisão 8901
responderam `000`). O servidor temporário da 8902 do diagnóstico anterior
também foi encerrado.

---

## 2. O que já foi feito (committed em `eea818e`)

### Erro 1 — vídeo sem áudio → **CORRIGIDO**

Causa-raiz provada: o MP4 do v10 tem `mdat` antes de `moov` (sem faststart) **e**
o servidor de revisão só anunciava `Accept-Ranges: bytes` na resposta **206**;
as respostas **200** e **HEAD** passavam por `super().send_head()` sem o
cabeçalho. O Chrome, ao sondar o arquivo com HEAD, conclui que o media não é
seekable e descarta a faixa de áudio silenciosamente.

Correções aplicadas:

- `scripts/serve_reference_review.py` — `Handler.end_headers()` injeta
  `Accept-Ranges: bytes` em **toda** resposta cujo corpo é um arquivo regular
  (200 e HEAD inclusos), via `_accept_ranges_pending`. A 206 continua servindo
  `Content-Range` como antes.
- `tests/test_serve_reference_review.py` — novo teste
  `test_a_plain_request_advertises_that_the_file_is_rangeable` exige o
  cabeçalho em 200 **e** em HEAD (helpers `_fetch_full` e `_fetch_head`).
- `tests/test_cue_reference_film_f2_real_models.py` — o master passa a ser
  montado com `-movflags +faststart`, para que o índice venha antes das
 ictures.

**Validação:** `app/env/bin/python -m pytest tests/test_serve_reference_review.py -q`
→ **11 passed**.

### Diagnóstico dos erros 2–5 (medição, sem mudança de código)

| Erro | Causa-raiz comprovada | Correção ainda **não** implementada |
|---|---|---|
| 2 — tamanho do robô | A régua de escala usa o **cluster ciano** das lentes. As lentes só são ciano em S03/S04/S10, logo `scale_consistency` = `not-measurable` e o gate passa calado. | Régua utilizável + `not-measurable` virar **falha** |
| 3 — formato da lâmpada | Lentes âmbar confundem-se com o bulbo âmbar; o bulbo nunca teve forma medida. | Prompt com bulbo único de forma fixa + gate de forma/contato |
| 4 — robô sem cabeça (S07, 30–34 s) | S07 tem **0 lentes ciano** em todos os 120 frames (as lentes saíram âmbar). | Prompt com lentes ciano explícitas + gate de contagem ciano = 3 e cabeça presente |
| 5 — cubo e lâmpada sobrepostos | Sobreposição de bbox entre blob vermelho do cubo e blob quente do bulbo. | Gate de separação geométrica cubo↔lâmpada + prompt de distância |

### Evidência medida do v10 (`app/outputs/validacao-f2-2026-10-22-v10/shot-evidence.json`)

- `lens_evidence`: só `anchor-character`, `S03-image`, `S04-image`, `S10-image`
  mostram 3 ciano. **S05–S12 e S01/S02 mostram 0 ciano.**
- `scale_evidence`: `detections=0`, `measurable=False` em S01, S05–S09, S11, S12.
  Só S02, S03, S04 e S10 têm cabeça detectada.
- `relative_evidence`: mensurável só em S02 (2.2692), S03 (3.9048), S04 (2.4603).
- `scale_consistency`: `{'verdict': 'not-measurable', 'shots': {'S04': 2.4603}}`
  — **um único shot medido não é suficiente para detectar variação de tamanho**,
  e por isso o erro 2 passou.
- `failures: []` — o filme passou todas as portas automáticas e foi reprovado só
  na revisão humana.

### Observação importante discovered nesta sessão

O `S07.mp4` do v10 é **byte-idêntico** ao do v9
(`sha256 163e9b83…`): o v10 reutilizou clipes do v9. A revisão que aprovou o v9
**não notou** o defeito das lentes âmbar em S07 — o defeito é anterior. Isso
confirma que o gate de lentes ciano por plano é necessário (não basta medir
apenas S03/S10).

### Artefatos temporários (limpar no fim)

- `/tmp/v11cal/sep.py` — calibração do detector de separação cubo↔lâmpada.
  Detalhe importante: o detector de blob "quente" pega também a **madeira do
  pedestal** (aspecto ~8.6 em S07, ~6.4 em S03). O bulbo real precisa ser
  isolado por forma/posição antes de medir a separação.
- `/tmp/v11cal/prompts1.txt`, `/tmp/v11cal/shots_prompts.txt`, `/tmp/v11cal/shots_v10.txt`
  — dumps dos prompts do v10.
- `/tmp/v11work/frames/*.png` — frames extraídos para inspeção visual.

---

## 3. O que falta fazer (ordem sugerida)

### 3.1 Prompts do v11 — `tests/fixtures/cue_reference_film_v1/visual_prompts.json`

Chaves: `style`, `negative{image,video}`, `character`, `location`, `shots`, `cube`.

- **`character`** — hoje: *"…exactly three circular cyan camera lenses arranged as
  a triangle…"*. Reforçar com **"the lenses are cyan, never amber, yellow or
  orange"** e enumerar a cor explicitamente.
- **`negative.image` / `negative.video`** — hoje já contêm *"fourth lens, extra
  lens, four camera lenses, two lenses, one lens"*. **Faltam** as negativas de
  cor: `amber lenses, yellow lenses, orange lenses, warm glowing eyes, glowing
  amber eyes`.
- **`location`** — hoje: *"a single unlit amber glass light bulb… dark glass with
  no glowing filament"*. Fixar a **forma** do bulbo (única forma, sem variantes:
  sem cúpula, sem disco, sem tubo) e o **contato** com o pedestal.
- **`shots.S07`** — é o plano do erro 4. Exigir cabeça visível com as três
  lentes ciano. As demais frases de `location`/`character` reaparecem aqui e
  precisam do mesmo reforço.
- **`shots.S09`, `S11`, `S12`** — planos da lâmpada (erros 3 e 5): exigir o bulbo
  único de forma fixa, **separado** do cubo, e o cubo sentado **dentro** da
  cavidade.

> **Atenção:** o harness F2 valida `receipt["request"] != params` ⇒
> `ValueError("Receipt parameters changed; use a new validation directory")`.
> Como os prompts mudam, o v11 **precisa** de uma pasta nova:
> `app/outputs/validacao-f2-2026-10-22-v11/`.

### 3.2 Gate de lentes ciano por plano (erro 4)

Base: `app/services/reference_identity.py` (`count_lenses`, `_disks`, `analyse`,
`check_anchor_lenses`).

Hoje o harness só exige 3 lentes **duras** em `S03-image` e `S10-image`
(`tests/test_cue_reference_film_f2_real_models.py`, ~linhas 262-275).
Criar um gate **por plano**: todo still de plano com robô (`S02`–`S08`, `S10`,
`S11`) precisa de **3 lentes ciano**. Para os vídeos, a exigência deve ser por
cobertura mínima, e os planos sob luz âmbar (`S09`–`S12`) precisam de um
tratamento explícito — ou o detector passa a contar o halo da lâmpada.

Referência de limiares: `HUE 80–105`, `SAT_MIN=VAL_MIN=90`, `MIN_DISK_AREA=150`,
`MIN_FILL=0.45`, `MIN_ASPECT=0.65`, `MAX_ASPECT=1.55`, `RELATIVE_AREA=0.12`,
`EXPECTED_LENSES=3`, seeds do anchor `CHARACTER_ANCHOR_SEEDS=(99,555,42,8,1234)`.

### 3.3 Régua de escala utilizável + gate que falha quando cego (erro 2)

Hoje:
- `app/services/reference_robot.py` mede a cabeça como o **span das três
  lentes ciano** (`head_cluster`). Se as lentes não são ciano, a régua é cega.
- `app/services/reference_continuity.py` → `check_relative_scale` e
  `check_scale_consistency` devolvem `verdict='not-measurable'` **sem falhar**
  quando a régua não mede.

Duas frentes:
1. **Tornar a régua independente de cor** (ou garantir uma âncora ciano durável
   em todos os planos com robô). A régua secundária já existe e funciona:
   **cabeça ÷ cubo** (`head_to_cube_ratio`, `MIN_HEAD_TO_CUBE=1.0`,
   `MAX_HEAD_TO_CUBE=3.5`, `MIN_CUBE_WIDTH=20`, `MIN_HEAD_WIDTH=12`,
   `MIN_FRAMES=4`, `MAX_SPREAD=1.35`, `MAX_CROSS_SHOT_RATIO=1.25`) — mas ela
   também depende da cabeça ciano.
2. **Fazer `not-measurable` virar falha** nos shots obrigatórios. O conjunto
   mínimo já existe no harness: `ROBOT_SCALE_FILM_SHOTS = {'S04','S06','S07'}`
   (shots em que o robô segura o cubo e a cabeça é mensurável ao mesmo tempo).
   Com o v10, `check_scale_consistency` recebeu **um** shot medível — por isso
   o erro 2 passou calado. O gate novo deve exigir **≥2 shots** medidos **e**
   falhar quando um shot obrigatório não mede.

### 3.4 Gate de separação cubo↔lâmpada (erro 5)

Base: `app/services/reference_cube.py` (`cube_blobs`, `check_cube_count`,
`check_cube_continuity`). O cubo vermelho é bem detectado
(`HUE_RANGES=((0,6),(174,179))`, `SAT≥120`, `VAL≥70`, `MIN_AREA=150`,
`MIN_FILL=0.50`, aspecto `0.60–2.00`, `MEDIAN_VAL_MIN=100`, `MEDIAN_SAT_MIN=150`,
`MAX_HUE_DISTANCE=5`, `MAX_CUBE_WIDTH_FRACTION=0.40`,
`MAX_CUBE_AREA_FRACTION=0.25`, `BORDER_MARGIN=2`).

Falta o **outro lado da régua**: um detector de bulbo âmbar que **não** pegue a
madeira do pedestal, e a medição de que as duas caixas **não se sobrepõem**.
Calibração em `/tmp/v11cal/sep.py` — gaps mínimos medidos no v10 (amostras a
cada 20 frames, sem overlap detectado): S07=9 px, S02=3 px, S06=16 px, S04=31 px,
S01=32 px, S08=86 px, S11=186 px, S12=192 px, S09=240 px; S03 e S10 sem pares.
Os gaps pequenos (3–16 px) são o ponto de risco — um bulbo generator um pouco
maior já encosta no cubo.

### 3.5 Gate de forma da lâmpada (erro 3)

Prompt com bulbo único de forma fixa + negativa de variantes. Opcionalmente,
gate de consistência de forma do bulbo entre planos (o que mede hoje não mede
nada: o bulbo nunca teve forma medida).

### 3.6 Render do v11

1. Criar `app/outputs/validacao-f2-2026-10-22-v11/` (obrigatório).
2. Copiar `app/outputs/validacao-f2-2026-10-22-v10/f2-config.json` para a pasta
   nova e **mudar `validation_dir`**. Demais parâmetros idênticos:
   imagem `flux2_klein_9b` 1280x720, `num_inference_steps=4`, `guidance_scale=1`,
   `NAG_scale=1.5`, `NAG_tau=3.5`, `NAG_alpha=0.5`, `seed=42`;
   vídeo `ltx2_22B_distilled_1_1`, `num_inference_steps=8`, `video_length=129`,
   `input_video_strength=1.0`; fala `qwen3_tts_base`; música
   `ace_step_v1_5_turbo_lm_4b`; SFX `mmaudio_v2`; `character_anchor_seed=99`;
   `job_timeout=5400`.
3. Subir o Studio em `127.0.0.1:7860`.
4. Rodar:
   `CUE_RUN_REAL_MODELS=1 CUE_F2_CONFIG=<config v11> app/env/bin/python -m pytest -m real_models`
5. Reconstruir `review.html` (`scripts/build_reference_review.py` — o
   `preflight` de `scripts/serve_reference_review.py` reconstrói sozinho se o
   hash não bater) e servir na 8901.
6. **Remover da pasta servida** os arquivos que confundem o revisor:
   `known-good.mp4` (87 KB, clipe de 5 s) e `master-audio.m4a`.

### 3.7 Documentação e commit

- `docs/CURRENT_STATE.md` — registrar o estado do v11.
- `docs/REFERENCE_FILM_VALIDATION.md` — registrar as novas portas de medição.
- `docs/HANDOFF_V11.md` (este arquivo) — atualizar ou remover ao concluir.
- Commitar com o trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

### 3.8 Nova revisão humana

Instrução explícita ao revisor: **usar a página `review.html`** (não abrir
`master.mp4` direto nem navegar a pasta), confirmar que o **áudio** está
presente e dizer qual navegador/player usou.

---

## 4. Ambiente e comandos úteis

| Item | Valor |
|---|---|
| Python do projeto | `app/env/bin/python` (3.12.3, numpy 2.1.2, opencv, pytest 9.1.1) |
| ffmpeg / ffprobe | 6.1.1 |
| GPU | RTX 3060, 12 GB |
| Studio | `http://127.0.0.1:7860` (precisa subir antes do render) |
| Revisão | `http://127.0.0.1:8901/review.html` |
| Revisão v10 | `app/outputs/validacao-f2-2026-10-22-v10/` (reprovada) |
| Pastas de validação | `app/outputs/validacao-f2-2026-10-19{,-v3}`, `-2026-10-20-v{4,5,6}`, `-2026-10-21-v{7,8,9}`, `-2026-10-22-v10` |

```bash
cd /home/yuri/Documentos/cine_local/cue_studio
app/env/bin/python -m pytest tests/test_serve_reference_review.py -q     # serving
app/env/bin/python -m pytest tests/test_reference_acceptance.py -q
app/env/bin/python -m pytest tests/test_reference_mix.py -q
app/env/bin/python scripts/serve_reference_review.py <validation_dir> --port 8901
```

**Negativo só é honrado pelo Flux2** com `NAG_scale > 1` **e** `guidance_scale <= 1`
(ambos já assertados no harness).

---

## 5. Armadilhas conhecidas

- A ferramenta **`write` não existe** — use `create` (arquivo novo, exige
  `file_text`) ou `edit` (arquivo existente).
- **`read`/`read_bash` não existem** — use `view` (com `view_range`) e `bash`.
- `view` em `.jpg` devolve base64 gigante — converter para `.png` via
  OpenCV/PIL para inspeção visual. `cv2.imread` exige caminho absoluto.
- Saídas grandes (>~9 KB) são despejadas em `/tmp/…-copilot-tool-output-*.txt` e
  **depois não existem mais** — redirecionar para arquivo persistente.
- A tabela `todos` do banco de sessão tem FK em `todo_deps` — apagar `todo_deps`
  **antes** de `todos`.
- `ImageMagick`/`convert` não está instalado (usar PIL/OpenCV).
- Comandos bash com `cd` composto são negados; `for`/`$` funcionam;
  `sed -n 'A,Bp'`, `awk 'NR>=A && NR<=B'`, `python3 -c` funcionam.

---

## 6. Estado da lista de tarefas da sessão

| id | Tarefa | Status |
|---|---|---|
| `v11-serving` | Accept-Ranges em 200/HEAD + faststart | **done** (commit `eea818e`) |
| `v11-lenses` | Gate de lentes ciano por plano | pending |
| `v11-scale` | Régua de escala color-independente + falha quando cega | pending |
| `v11-lamp` | Gate de forma e separação da lâmpada | pending |
| `v11-prompts` | Prompts do v11 (ciano, bulbo, distância) | pending |
| `v11-render` | Render do v11 | pending |
| `v11-docs` | Documentação e commit | pending |
