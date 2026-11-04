# Handoff — Falhas do Director (erro real, `oom_info` e retry por clip)

Escopo deste documento: **o diagnóstico das falhas do Director** observadas na
aba Story (Clip 2 em "Failed", banner "Generation failed", botão "Try again"
que devolve HTTP 400) e **as melhorias planejadas** para corrigir os três
defeitos correlatos. Não substitui o [HANDOFF.md](../HANDOFF.md) do ciclo
geral do projeto.

- Base: `main`, `8267f4d` ("Escreve o handoff do YuE e guarda o material do
  YuE2").
- Estado: **diagnóstico completo, nenhuma alteração de código aplicada**. Este
  ciclo entregou a investigação, a reprodução em runtime e o plano; a
  implementação está toda por fazer.
- Hardware da reprodução: RTX 3060 12 GB, `/home/yurix/Vídeos` como
  `projects_root_path`.

## O problema que motivou

Um print do Cue Studio (Diretor → Story, workspace `more`, 12 clips) mostra o
Clip 2 em "Failed" com o banner "Generation failed / backend message:
generation failed" e um botão "Try again" por clip. Clicar no botão devolve
HTTP 400 "Pipeline not found" e o banner de recuperação de OOM nunca aparece,
mesmo sendo um estouro de VRAM.

São três defeitos independentes que se somam:

1. a causa real da falha (OOM de VRAM) é **descartada** pelo backend e
   substituída pela string genérica "Generation failed";
2. por consequência, `oom_info` **nunca é populado** nesse caminho — o
   `OomRecoveryBanner` do app não tem o que mostrar;
3. o "Try again" por clip aponta para um endpoint de pipeline que **não
   encontra o pipeline** (e, mesmo se encontrasse, não serviria ao fluxo v2).

## Evidência de runtime

Todas as afirmações abaixo foram reproduzidas contra o backend vivo
(`127.0.0.1:7860`) e contra o log do launcher (`app/.launcher.log`).

**A causa real existe no log e não chega na API:**

```
app/.launcher.log:7088
torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 290.00 MiB.
GPU 0 has a total capacity of 11.68 GiB of which 290.44 MiB is free.
```

```
GET /api/v1/status/425a6b7d
{"status":"failed","message":"Generation failed","error":"Generation failed",
 "oom_info":null}
```

**O botão "Try again" falha por lookup, não por lógica:**

```
POST /api/v1/director/pipelines/603de619/clips/1/rerun-image
HTTP 400  {"error":"Pipeline 603de619 not found"}

GET /api/v1/director/pipelines
{"pipelines":[]}
```

**Reprodução direta em Python** (`app/env/bin/python`, com `app/` no
`sys.path`):

```
load_pipeline_state('/home/yurix/Vídeos',        '603de619') -> None
load_pipeline_state('/home/yurix/Vídeos/more',    '603de619') -> None
list_pipeline_states('/home/yurix/Vídeos')        -> []
list_pipeline_states('/home/yurix/Vídeos/more')    -> [id 603de619]
```

O arquivo existe em disco e está a três níveis da raiz de projetos:

```
/home/yurix/Vídeos/more/.director/603de619/_director_pipeline_603de619.json
```

O conteúdo dele confirma que o fluxo é **register-only** (v2): `clips: []`,
`image_model: ''`, `status: "completed"`. As imagens são geradas **no
cliente**, não pelo pipeline do servidor.

## Causa raiz

### A — a mensagem real é trocada por "Generation failed"

Cadeia completa, do texto original até a resposta da API:

1. `app/wgp.py`, no `except` de `generate_video` — `s = str(e)` guarda o texto
   cru, que contém "CUDA out of memory".
2. no mesmo bloco — `keyword_list` classifica a falha como VRAM ou RAM a
   partir de `s`.
3. ainda no mesmo bloco — os ramos VRAM e RAM constroem `new_error` como
   **texto amigável que descarta `s`**. Só o ramo genérico (`else:` com
   `gr.Error(...)`) preserva o original, e mesmo assim embutido num
   `gr.Error`.
4. `send_cmd("error", new_error)` manda a mensagem amigável pelo stream.
5. `app/launch.py:26224-26228` — o consumidor do stream faz
   `update_job(job, message=f"Error: {data}")`: grava **apenas `message`**, nunca
   `job["error"]`, e **não** chama `detect_oom`.
6. `app/launch.py:26727-26729` — `failure_reason` cai no literal
   `"Generation failed"`.
7. `app/launch.py:27338-27346` — `finish_job(... error=None if success else
   (job.get("error") or failure_reason))`: como `job["error"]` é `None`, o
   erro publicado é literalmente "Generation failed".
8. `app/services/director_pipeline.py:4700` — `err = j.get("error") or
   "Generation failed"` propaga a mesma perda para o Director.

O `oom_info` só é anexado no `except Exception` externo
(`app/launch.py:27350-27365`), **inalcançável** neste caminho. E mesmo se fosse
alcançado, `app/services/oom_detect.py:27-33` casa as assinaturas
`"out of memory"`, `"cuda out of memory"`, `"outofmemoryerror"`,
`"cublas_status_alloc"`, `"cudnn_status_alloc"` — nenhuma aparece nas
mensagens amigáveis de VRAM/RAM do `wgp`.

**Consumidores que dependem disso:** `/api/v1/status/{id}` expõe `error` e
`oom_info` (`app/launch.py:28250`, `28412`); o frontend lê `job.error ||
job.message`; `ui/src/components/OomRecoveryBanner.tsx:48-59` só mostra o
banner quando `oom_info` está presente; `ui/src/stores/directorError.ts:157-176`
tem um caso específico de OOM que só é ativado quando o texto bruto traz a
assinatura de CUDA.

### B — o lookup do estado do pipeline é raso demais

`app/services/director_pipeline.py:4903-4905` grava o estado **dois níveis**
abaixo do workspace:

```python
nested_dir = os.path.join(out_dir, f".director/{pid}")
os.makedirs(nested_dir, exist_ok=True)
out_dir = nested_dir
```

O comentário no código afirma que "_load_pipeline_state_locked searches the
workspace recursively" — **a afirmação é falsa**. As quatro funções de lookup
procuram só um nível:

| função | linha | busca |
|---|---|---|
| `_load_pipeline_state_locked` | 1806 | `out_dir/<file>` e `out_dir/<sub>/<file>` |
| `_update_clip_tag_locked` | 1854 | idem |
| `_find_pipeline_file` | 1874 | idem |
| `_find_pipeline_state_file` | 5321 | idem |

`list_pipeline_states` (1414) desce um nível a mais, mas **não chega no
`.director/<pid>/`** quando a base é a raiz de projetos: partindo de
`/home/yurix/Vídeos`, ele varre `…/more` e `…/more/.director`, mas o arquivo
está em `…/more/.director/603de619/`. Daí a assimetria observada: a listagem
encontra o pipeline quando a base é o workspace, e não encontra quando a base é
a raiz — e é a raiz que os endpoints usam (`base = _projects_root()`).

Efeito colateral: além do `rerun-image`, ficam quebrados
`GET /api/v1/director/pipelines/{pid}` (404), o thumbnail (404) e a listagem
vazia — todos pela mesma causa.

### C — o retry por clip usa o endpoint errado

- O fluxo v2 gera as imagens **no cliente**:
  `ui/src/stores/directorPlanningSlice.ts:1176` (`directorGenerateStartImages`)
  faz `api.submitGeneration` + polling de `api.fetchJobStatus`, e em caso de
  falha grava `directorImageGenProgress` com `status: 'error'`,
  `error_message`, `failed_clip_index` e `failed_phase: 'image_gen'`
  (linhas 1331-1346).
- O botão "Try again" do card é
  `ui/src/components/Sidebar/DirectorBriefingColumn.tsx:2964-2973`
  (`DIRECTOR_LABELS.retryScene`), que chama `regenerateClip` (2887) →
  `rerunClipImage(pipelineId, clipIndex, plan?.image_prompt)` →
  `ui/src/stores/useStore.ts:2817` → `ui/src/api/client.ts:1353` → endpoint
  **server-side** de pipeline.
- Esse endpoint devolve 400 por causa de B, e mesmo corrigido B ele continua
  inaplicável: o estado salvo é register-only, com `clips: []` e
  `image_model: ''` — `rerun_clip_image`
  (`app/services/director_pipeline.py:2156-2165`) indexa `state["clips"]` e
  levantaria "Clip index 1 out of range".
- O erro é engolido: `console.error('Per-clip regenerate failed:', e)`
  (linha 2895) — sem mensagem para o usuário.

## Melhorias planejadas

### 1. Preservar o erro real e popular `oom_info` (backend)

- `app/wgp.py`, no `except` de `generate_video` — incluir o texto cru (`s`,
  truncado) nas mensagens VRAM/RAM, ou enviar um segundo campo com a causa
  original, para que `detect_oom` reconheça a assinatura "CUDA out of
  memory".
- `app/launch.py:26224-26228` — no ramo `cmd == "error"`, gravar a mensagem em
  `job["error"]` (não só em `message`) e acionar `detect_oom` com o mesmo
  padrão já usado em `27357-27362` e `23775-23780`.
- `app/launch.py:27338-27346` — o `finish_job` já prefere `job.get("error")`;
  com o passo acima, o erro publicado deixa de ser o literal genérico. A
  mensagem final deve carregar o texto útil, não "Generation failed".
- `app/services/director_pipeline.py:4700` — propagar `j.get("error")` real
  (hoje já lê o campo, mas o valor já chega vazio do passo anterior).
- `app/services/oom_detect.py:27-33` — considerar as mensagens amigáveis do
  `wgp` ("insufficient VRAM", "unsufficient RAM") como assinaturas, para que o
  diagnóstico não dependa só do texto cru.

### 2. Achatar o lookup do estado (backend)

Unificar as quatro funções de lookup em um resolvedor único que procure o
arquivo em todas as profundidades em que ele pode estar, a partir da base que
os endpoints usam:

- `out_dir/<file>`
- `out_dir/<sub>/<file>`
- `out_dir/.director/<pid>/<file>`
- `out_dir/<sub>/.director/<pid>/<file>`

Aplicar em `_load_pipeline_state_locked` (1806), `_update_clip_tag_locked`
(1854), `_find_pipeline_file` (1874), `_find_pipeline_state_file` (5321) e
`list_pipeline_states` (1414). **Uma única fonte de verdade** para a
localização do arquivo evita a assimetria que produziu o bug: hoje cada
função varre um conjunto ligeiramente diferente de diretórios.

### 3. Fazer o retry por clip usar o caminho client-side (frontend)

- Adicionar em `ui/src/stores/directorPlanningSlice.ts` uma ação do tipo
  `directorRegenerateClipImage(clipIndex)` que reusa o caminho já existente de
  `directorGenerateStartImages` (submit + polling) para **um** clip, e
  atualize `directorClipImages` via `directorSetClipImage`
  (`ui/src/stores/useStore.ts:4980`) e limpe o estado de falha em
  `directorImageGenProgress`.
- Apontar `ImagePromptsReview.regenerateClip`
  (`ui/src/components/Sidebar/DirectorBriefingColumn.tsx:2887-2898`) para essa
  ação, em vez do endpoint de pipeline.
- Substituir o `console.error` engolido (linha 2895) por uma mensagem no
  banner, para que a falha do retry apareça para o usuário (o
  `DirectorErrorBanner` do card já recebe `clipError` em 2924-2928).
- Limpar o estado `failed` corretamente: `ui/src/director/sceneStatus.ts:31-52`
  deriva `'failed'` de `progress.status === 'error'` com
  `failed_clip_index === index` — o retry precisa zerar esse marcador, senão o
  card continua marcado como falho.

### 4. Testes de regressão

- **pytest** — `tests/test_director_pipeline_state_lookup.py`: grava o estado
  em `<tmp>/<workspace>/.director/<pid>/` e exige que
  `load_pipeline_state`, `_find_pipeline_file`, `_find_pipeline_state_file` e
  `list_pipeline_states` encontrem o pipeline a partir da **raiz de projetos**
  (a base que os endpoints usam).
- **pytest** — cobertura do caminho `cmd == "error"`: o texto do worker
  precisa chegar em `job["error"]` e `oom_info` precisa ser preenchido quando o
  texto contém a assinatura de CUDA.
- **vitest** — `ui/src/stores/directorPlanningSlice.test.ts` (o harness já
  existe e injeta `api` como mock): o retry de um clip chama o caminho
  client-side, atualiza `directorClipImages` e limpa `failed_clip_index`.

### 5. Validação

```bash
# Backend (venv em app/env, a partir da raiz do repositório)
./app/env/bin/python -m pytest tests -q

# UI (Node 22; o Node do sistema é 18 e o Vite exige 20.19+)
cd ui
npx --yes --package=node@22 -c 'node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json'
npx --yes --package=node@22 -c 'node ./node_modules/vitest/vitest.mjs run'
npx --yes --package=node@22 -c 'node ./node_modules/eslint/bin/eslint.js src'
npx --yes --package=node@22 -c 'node ./node_modules/vite/bin/vite.js build'
```

Referência da última rodada completa do projeto: **1.414 testes Python
aprovados** e **341 testes Vitest, 340 aprovados** — a única falha é
`ui/src/components/Shell/QueuePage.test.tsx:151`, pré-existente e não
relacionada. Lint com 74 erros, todos pré-existentes.

## Definição de pronto

1. Um job que falha por OOM devolve `error` com o texto de VRAM/CUDA e
   `oom_info` preenchido em `/api/v1/status/{id}`.
2. `GET /api/v1/director/pipelines` lista o pipeline `603de619` e
   `GET /api/v1/director/pipelines/603de619` devolve 200.
3. "Try again" num clip falho regenera **aquele** clip, sem erro 400, sem
   perder a mensagem de falha quando a nova tentativa também falha.
4. Testes novos cobrindo os três pontos, e as suítes completas sem regressão.

## Armadilhas conhecidas

- **Não reiniciar o backend enquanto houver geração ativa** e conferir o job
  vivo antes de submeter de novo.
- `pkill` está bloqueado neste ambiente — use `kill <PID>`.
- `import wgp` leva ~14 s: nunca importar em rota que precise responder rápido
  sem necessidade.
- **A árvore de trabalho tem mudanças de outra sessão** (`app/wgp.py` e
  `_reversa_forward/yue2-port-2026-11-04/yue_generate.py` — trabalho do YuE).
  Não sobrescrever nem incluir no commit destas correções. Notar que
  `app/wgp.py` é justamente um dos arquivos do item 1 — as duas alterações
  precisam conviver.
- O endpoint `rerun-image` roda a geração em `asyncio.to_thread`
  (`app/launch.py:10206-10240`) de propósito: rodar direto na rota async
  bloqueia heartbeat/poll e derruba o webview do Pinokio.
- `update_job` só aplica mudanças com o job em `running`
  (`app/services/job_lifecycle.py:283-291`) e `finish_job` é quem publica o
  estado terminal — gravar `error` no `message` não basta.
- `detect_oom` casa o texto **e** o nome da classe da exceção
  (`app/services/oom_detect.py:65-69`); a assinatura precisa sobreviver à
  conversão da mensagem.
- A política de escrita do Reversa (`.reversa/reversa-config.json`) **não pode
  ser editada** por agente.

## Referências

- Estado geral do projeto: [docs/CURRENT_STATE.md](CURRENT_STATE.md).
- Pendências do ciclo: [docs/TODO_RETOMADA.md](TODO_RETOMADA.md).
- Handoff do ciclo: [HANDOFF.md](../HANDOFF.md).
