# Inventário — cue_studio

> Gerado pelo **Scout** em 2026-10-02
> Projeto: **cue_studio** v2.5.2

## 1. Visão geral

**Cue Studio** é uma plataforma local de criação assistida por IA — geração de vídeo, imagem e áudio guiada por um Director (LLM), com Editor integrado. Fork do Maestro/WanGP da Blizaine, distribuído sob licença WanGP Non-Commercial Evaluation 1.1.

A solução combina:

- Backend **Python 3.10–3.11** com FastAPI (`app/launch.py`).
- Stack pesada de modelos (Wan, LTX, Hunyuan, Qwen, FLUX, Hidream, Z-Image, MiniMax, Kandinsky, Krea, Ideogram, LongCat, TTS) instalada sob demanda via `app/setup.py` + `app/env/`.
- UI **React + TypeScript + Vite** (`ui/`) com Gradio clássico legado servido em `/classic`.
- CLI companion em Click (`app/cli.py`, exporado como `cue` / `cue-studio`).
- Persistência híbrida: SQLite (`app/services/app_state_db.py`) + JSON legado.

## 2. Estrutura de pastas (alto nível)

- `app/` — Backend Python (FastAPI + WanGP). Entry: `launch.py`, núcleo `wgp.py`, CLI `cli.py`, setup `setup.py` + `setup_config.json`, Dockerfile.
  - `app/routers/` — FastAPI routers (mcp, productions, video_editor, wizard).
  - `app/services/` — ~62 serviços de domínio (director, llm_router, mcp_dispatcher, telemetry, app_state_db, etc.).
    - `app/services/director/` — Pipeline do AI Director.
    - `app/services/llm_guides/` — Guias YAML do LLM.
    - `app/services/style_bible/` — Style Bibles.
    - `app/services/grammars/` — Gramáticas JSON-schema p/ LLM.
  - `app/models/` — 16 famílias de modelos (Wan, LTX, Qwen, FLUX, Hidream, MiniMax, Kandinsky, Krea, LongCat, TTS, Z-Image, Ideogram, HunyuanVideo).
  - `app/profiles/` — Perfis de execução por modelo.
  - `app/preprocessing/` — depth_anything_v2, dwpose, matanyone, midas, raft, sam3, video_depth_anything.
  - `app/postprocessing/` — flashvsr, mmaudio, rife.
  - `app/plugins/` — 8 plug-ins wan2gp-* (about, configuration, downloads, guides, models-manager, motion-designer, plugin-manager, sample, video-mask-creator).
  - `app/recipes/`, `app/docs/`, `app/defaults/`, `app/finetunes/`, `app/icons/`, `app/shared/`.
- `cli/` — Console-script shim (sys.path + app.cli).
- `ui/` — Frontend React + Vite + Tailwind 4.
  - `ui/src/components/` — Shell, Stages, DirectorDashboard, Editor, LoraBrowser, MainContent, NSFW, Recipes, SettingsDrawer, Sidebar, StorageDashboard, StyleBibles, shared.
  - `ui/src/editor/` — Editor de timeline + inspeção.
  - `ui/src/stores/` — Zustand stores.
  - `ui/src/api/` — Cliente HTTP.
  - `ui/src/types/` — Tipos compartilhados.
  - `ui/src/lib/` — Lazy components, helpers.
  - `ui/tests/` — Testes do frontend (1 spec).
- `tests/` — Suíte pytest (62 arquivos).
- `scripts/` — prune_demo_local_skills.py, verify_clean_repo.py.
- `docs/` — Documentação externa (PNGs, MDs).
- `conftest.py` (raiz) — Fixtures compartilhadas pytest.
- `pyproject.toml` — Configuração do pacote + entry-points (`cue-studio`, `cue`) + pytest config.
- `README.md`, `HANDOFF.md`, `CHANGELOG.md`, `VERSION` (2.5.2).

## 3. Tecnologias e linguagens

### 3.1 Contagem de arquivos por extensão

| Extensão | Contagem | Linguagem |
|----------|---------:|-----------|
| `.py` | 1.427 | Python |
| `.tsx` | 126 | TypeScript (JSX) |
| `.md` | 98 | Markdown |
| `.ts` | 46 | TypeScript |
| `.yaml` | 29 | YAML |
| `.txt` | 11 | Texto |
| `.sh` | 10 | Shell |
| `.yml` | 7 | YAML |
| `.mjs` | 5 | JavaScript (ESM) |
| `.js` | 4 | JavaScript |
| `.html` | 3 | HTML |
| `.css` | 3 | CSS |
| `.toml` | 1 | TOML |

### 3.2 Linguagens principais

| # | Linguagem | Uso |
|---|-----------|-----|
| 1 | **Python** | Backend, geração de mídia, serviços de domínio, CLI, scripts |
| 2 | **TypeScript** | UI (componentes, stores, tipos, cliente HTTP) |
| 3 | **Markdown** | Docs, README, CHANGELOG, HANDOFF |

### 3.3 Frameworks e bibliotecas principais

**Backend Python** (pyproject.toml + app/requirements.txt):

| Biblioteca | Versão | Função |
|------------|-------:|--------|
| FastAPI | (gerenciado em app/requirements.txt) | Servidor HTTP/REST |
| mmgp | 3.7.12 | Offload GPU / quantização / safetensors |
| diffusers | 0.36.0 | Modelos de difusão |
| transformers | 4.57.1 | Família HuggingFace |
| tokenizers | 0.22.1 | Tokenização HF |
| accelerate | 1.12.0 | Otimizações de hardware |
| moviepy / av / ffmpeg-python | — | Processamento de vídeo |
| faster-whisper / openai-whisper | 1.2.1 / 20250625 | Transcrição |
| librosa / mutagen / pyloudnorm | — | Áudio |
| opencv-python-headless | — | Visão computacional |
| speechbrain | 1.0.3 | Áudio ML |
| audio-separator | 0.36.1 | Separação de stems |
| torch | cu126 / cu128 / cu130 / rocm65 | Treinamento/inferência |
| Click | (transitivo) | CLI |
| pytest | (out, dev) | Testes |

**UI JavaScript/TypeScript** (ui/package.json):

| Dependência | Versão | Função |
|-------------|-------:|--------|
| React | 19.2.0 | UI framework |
| React DOM | 19.2.0 | Renderização |
| Zustand | 5.0.11 | Estado global |
| Lucide React | 0.575.0 | Ícones |
| DOMPurify | 3.2.4 | Sanitização HTML |
| Vite | 7.3.1 | Build / dev server |
| Tailwind CSS | 4.2.1 | Estilização |
| TypeScript | ~5.9.3 | Tipagem |
| ESLint | 9.39.1 | Lint |

### 3.4 Gerenciadores de pacotes

- **Python:** `pip` (com fallback opcional para `uv` e `conda` — configurável em `setup_config.json`).
- **UI:** `npm` (`package-lock.json` presente).

## 4. Pontos de entrada

### 4.1 Aplicação

| Caminho | Tipo | Descrição |
|---------|------|-----------|
| `app/launch.py` | Servidor (FastAPI) | Wrapper HTTP sobre WanGP; serve a UI em `/` e o Gradio em `/classic`. |
| `app/wgp.py` | Núcleo | Orquestrador de modelos (importado por `launch.py` e plugins). |
| `app/cli.py` | CLI | Sub-comandos `cue-studio status / gallery / style-bible`. |
| `cli/__init__.py` | Console-script shim | Adiciona o repo ao sys.path e delega a `app.cli.main`. |
| `ui/src/main.tsx` | UI entry | Bootstrap React + Zustand. |
| `app/setup.py` | Bootstrap | Cria venv, instala dependências, baixa modelos sob demanda. |

### 4.2 Configuração

| Caminho | Função |
|---------|--------|
| `pyproject.toml` | Metadata do pacote, entry-points (`cue-studio`, `cue`), pytest config. |
| `app/setup_config.json` | Categóricas UI-driven para setup (Python, Torch CUDA, ROCm, Triton). |
| `app/Dockerfile` | Imagem base CUDA 12.8 + Python + sistema. |
| `ui/package.json` / `ui/package-lock.json` | Dependências frontend. |
| `ui/tsconfig.json` / `ui/vite.config.ts` | Configuração TypeScript / build. |
| `ui/eslint.config.js` | Lint frontend. |
| `conftest.py` (raiz) | Fixtures pytest compartilhadas. |

### 4.3 CI/CD

| Caminho | Função |
|---------|--------|
| `.github/workflows/ci.yml` | Lint/sintaxe + boundary guard (`scripts/verify_clean_repo.py`) + testes leves. |
| `.github/workflows/h3-turbo-upstream.yml` | Verificação periódica de upstream MiniMax-H3 Turbo. |
| `.github/ISSUE_TEMPLATE/` | Templates de issue. |
| `scripts/verify_clean_repo.py` | Garante que prose "mature/explicit" ou guias locais não vazem para o repo. |

### 4.4 Scripts relevantes

- `scripts/prune_demo_local_skills.py` — Limpeza de skills de demonstração.
- `scripts/verify_clean_repo.py` — Guard de boundary.
- `install.sh` / `start.sh` / `stop.sh` — Lifecycle do servidor.

## 5. Schema de banco de dados (visão superficial)

Persistência **híbrida**:

- **SQLite (novo):** `app/services/app_state_db.py` — store unificada com WAL, contendo tabelas `migrations`, `kv`, `workspaces`, `director_queue`, `history`, registros de migração.
- **JSON legado (mantido):** `wgp_config.json` (sistema), `web_push.json`, `setup.json` por workspace, `_director_queue.json`, recipes, model presets.
- **`app/services/director/schema.py`** — Schema do Director (estrutura Python, não DDL).

Não há `.sql`/`DDL` puros; tudo é gerenciado via ORM leve interno do `app_state_db.py`. A análise completa será feita pelo `reversa-data-master`.

## 6. Cobertura de testes

| Tipo | Framework | Contagem |
|------|-----------|---------:|
| Backend | pytest | 62 arquivos em `tests/` |
| Frontend | (nenhum runner detectado) | 1 spec: `ui/src/stores/directorQueueSlice.test.ts` |

Categorias de teste do backend:

- API: `test_api_security.py`, `test_productions_router.py`, `test_video_editor_router.py`, `test_wizard_router.py`, `test_outputs_jobs_endpoints.py`, `test_mcp_router.py`.
- Director: `test_director_pipeline_e2e.py`, `test_director_*` (~10 arquivos), `test_director_cinema_endpoint.py`, `test_director_video_strategy_override.py`.
- LLM: `test_llm_router.py`, `test_llm_gemma_eos_fix.py`, `test_call_llm_json_grammar.py`, `test_ollama_provider.py`.
- Media: `test_video_editor.py`, `test_ffmpeg_runtime.py`, `test_video_output_codec_hw.py`.
- Workspace/Project: `test_projects_root.py`, `test_project_setup.py`, `test_workspace_setup_service.py`.
- Lazy module: `test_lazy_module.py`, `test_smoke_imports.py`, `test_standalone_launch.py`.

Marcadores pytest (declarados em `pyproject.toml`):

- `browser`: requer Playwright + backend (opt-in).
- `smoke`: spawna processo fresco por módulo (opt-in).

## 7. Módulos identificados (alto nível)

| Módulo | Caminho | Função |
|--------|---------|--------|
| launch | `app/launch.py` | Servidor FastAPI que monta UI + Gradio + API REST |
| wgp | `app/wgp.py` | Núcleo de geração (WanGP) |
| cli | `app/cli.py` + `cli/` | CLI companion (status, gallery, style-bible) |
| setup | `app/setup.py` + `app/setup_config.json` | Bootstrap de venv + modelos |
| director | `app/services/director*` | AI Director (LLM orquestrador) |
| director_pipeline | `app/services/director_pipeline.py` | Pipeline de execução do Director |
| routers | `app/routers/` | FastAPI routers (mcp, productions, video_editor, wizard) |
| services | `app/services/` | 62 serviços de domínio (lifecycle, telemetry, MCP, LLM, etc.) |
| app_state_db | `app/services/app_state_db.py` | Store SQLite unificada |
| models | `app/models/*` | Adaptadores por família (16 famílias) |
| profiles | `app/profiles/*` | Perfis de execução por modelo |
| preprocessing | `app/preprocessing/*` | Pré-processadores de imagem/vídeo |
| postprocessing | `app/postprocessing/*` | Pós-processadores (RIFE, FlashVSR, MMAudio) |
| plugins | `app/plugins/*` | Plug-ins dinâmicos wan2gp (8 plugins) |
| shared | `app/shared/*` | Utilitários, kernels, engines LLM |
| ui-shell | `ui/src/components/Shell/*` | Shell, header, sidebar |
| ui-stages | `ui/src/components/Stages/*` | Stages do Director |
| ui-director | `ui/src/components/DirectorDashboard/*` | Dashboard e sub-componentes |
| ui-editor | `ui/src/editor/*` | Editor de timeline |
| ui-stores | `ui/src/stores/*` | Zustand stores |
| ui-api | `ui/src/api/*` | Cliente HTTP |

## 8. Estatísticas gerais

- Total de arquivos de código (`.py` + `.ts` + `.tsx` + `.js` + `.mjs` + `.css` + `.html`): **1.612**.
- Total de arquivos `.json` (configs, manifests): **344**.
- Pastas top-level do projeto: `app/`, `cli/`, `ui/`, `tests/`, `scripts/`, `docs/`, `.github/`, `.agents/`, `.claude/`.
- Frameworks principais: **FastAPI**, **React 19**, **Zustand**, **Vite**, **Tailwind 4**, **pytest**.

---

## Próximo passo

O Scout terminou. O mapa de módulos acima será a entrada do menu "Arqueólogo" na Fase 2 (Escavação). O Reversa agora vai perguntar o nível de documentação desejado.
