# Dependências — cue_studio

> Gerado pelo Scout em 2026-10-02
> Projeto: cue_studio v2.5.2

## 1. Stack Python (backend)

Gerenciado em [`pyproject.toml`](/home/yuri/Documentos/cue_studio/pyproject.toml) e [`app/requirements.txt`](/home/yuri/Documentos/cue_studio/app/requirements.txt). A stack pesada (torch, diffusers, transformers, mmgp etc.) NÃO é declarada como dependência runtime em pyproject.toml — ela é gerenciada por `app/setup.py` + `app/env/` no primeiro boot, com perfis CUDA/ROCm configuráveis.

### 1.1 Pacote instalado (pyproject.toml)

| Campo | Valor |
|-------|-------|
| name | `cue-studio` |
| version | `2.5.2` |
| description | Cue Studio — local creative AI studio, director, and video editor. |
| requires-python | `>=3.10` |
| license | WanGP Non-Commercial Evaluation License 1.1 |
| Console scripts | `cue-studio = cli:main`, `cue = cli:main` |
| Pacotes estáticos | `cli` |
| Optional dep | `yaml = ["PyYAML>=6.0"]` (Style Bible YAML serialization) |

### 1.2 Dependências runtime (pyproject.toml)

Nenhuma listada em `[project.dependencies]` por design (a CLI usa apenas Click + filesystem). O FastAPI e a stack pesada entram via `app/setup.py`.

### 1.3 Dependências runtime (app/requirements.txt) — pinadas

#### Core AI stack

| Pacote | Versão | Função |
|--------|-------:|--------|
| mmgp | 3.7.12 | Offload GPU / quantização / safetensors (pinado — pin explica por quê: LTX-2.5 INT8 ConvRot + LoRAs exigem esta versão) |
| diffusers | 0.36.0 | Modelos de difusão |
| transformers | 4.57.1 | Família HuggingFace (4.57.x adiciona `transformers.models.qwen3_vl`, exigido por HiDream O1) |
| tokenizers | 0.22.1 | transformers 4.57.1 requer 0.22.0–0.23.0 |
| accelerate | 1.12.0 | Otimizações de hardware |
| tqdm | 4.67.3 | Progresso |
| imageio | 2.37.2 | IO de vídeo |
| imageio-ffmpeg | 0.6.0 | FFmpeg wrapper |
| einops | 0.8.2 | Tensor ops |
| sentencepiece | 0.2.1 | Tokenização |
| open_clip_torch | 3.2.0 | CLIP |
| numpy | 2.1.2 | Tensores |
| num2words | 0.5.14 | Conversão número→texto |

#### Vídeo & mídia

| Pacote | Versão | Função |
|--------|-------:|--------|
| moviepy | 1.0.3 | Edição de vídeo |
| av | 16.1.0 | Codec (PyAV) |
| ffmpeg-python | (não pinado) | FFmpeg bindings |
| pygame | 2.6.1 | Áudio |
| sounddevice | 0.5.5 | Captura/playback |
| soundfile | 0.13.1 | Áudio IO |
| mutagen | 1.47.0 | Metadata áudio |
| pyloudnorm | 0.2.0 | Loudness |
| librosa | 0.11.0 | Áudio análise |
| faster-whisper | 1.2.1 | Transcrição (CTranslate2) |
| openai-whisper | 20250625 | Transcrição (Whisper original — alinhamento Scenema) |
| speechbrain | 1.0.3 | Áudio ML |
| audio-separator | 0.36.1 | Separação de stems |

### 1.4 Pytest (test deps)

| Pacote | Versão | Função |
|--------|-------:|--------|
| pytest | (out/dev) | Testes |
| starlette | 0.46.1 | ASGI (transitivo do FastAPI) |
| numpy | 2.2.6 | (CI override) |
| opencv-python-headless | 4.12.0.88 | Visão |
| Pillow | 11.3.0 | Imagens |
| requests | 2.32.4 | HTTP |
| cryptography | 49.0.0 | Criptografia |
| ffmpeg-python | 0.2.0 | FFmpeg |
| imageio | 2.37.2 | IO vídeo |
| av | 16.1.0 | Codec |
| decord | 0.6.0 | Decoder de vídeo |
| iopath | 0.1.10 | IO paths |
| onnxruntime | 1.22.0 | ONNX |
| pycocotools | 2.0.11 | COCO |
| rembg | 2.0.65 | Background removal |
| scipy | 1.15.3 | SciPy |
| timm | 1.0.24 | Torch Image Models |
| ftfy | 6.3.1 | Fix Unicode |

## 2. Stack JavaScript/TypeScript (UI)

Gerenciado em [`ui/package.json`](/home/yuri/Documentos/cue_studio/ui/package.json).

### 2.1 Dependências runtime

| Dependência | Versão | Função |
|-------------|-------:|--------|
| react | 19.2.0 | UI framework |
| react-dom | 19.2.0 | Renderização |
| zustand | 5.0.11 | Estado global |
| lucide-react | 0.575.0 | Ícones |
| dompurify | 3.2.4 | Sanitização HTML |

### 2.2 Dependências de desenvolvimento

| Dependência | Versão | Função |
|-------------|-------:|--------|
| @eslint/js | 9.39.1 | ESLint core |
| @tailwindcss/vite | 4.2.1 | Tailwind Vite plugin |
| @types/dompurify | 3.0.5 | Tipos |
| @types/node | 24.10.1 | Tipos Node |
| @types/react | 19.2.7 | Tipos React |
| @types/react-dom | 19.2.3 | Tipos React DOM |
| @vitejs/plugin-react | 5.1.1 | Vite React plugin |
| eslint | 9.39.1 | Lint |
| eslint-plugin-react-hooks | 7.0.1 | Regras de hooks |
| eslint-plugin-react-refresh | 0.4.24 | Regras HMR |
| globals | 16.5.0 | Globais JS |
| tailwindcss | 4.2.1 | Framework CSS |
| typescript | ~5.9.3 | TS compiler |
| typescript-eslint | 8.48.0 | Lint TS |
| vite | 7.3.1 | Bundler |

## 3. Gerenciadores de pacotes

- **Python:** `pip` primário; `uv` e `conda` como alternativas configuráveis em `app/setup_config.json` (campo `ENV_TEMPLATES` em `app/setup.py`).
- **UI:** `npm` (lockfile `package-lock.json` versionado).

## 4. Configuração de runtime

- `app/setup_config.json` lista categóricas para Python (3.10.9 / 3.11.14), Torch (cu126 2.6.0, cu128 2.7.1, cu130 2.10.0, rocm65), Triton (<3.3, <3.4) e aceleração opcional (flash-attention). Cada entrada inclui o comando de pip correspondente.
- `app/Dockerfile` usa `nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04` com `ARG CUDA_ARCHITECTURES="8.0;8.6"` por padrão.

## 5. Notação de pinning

A maioria das deps Python em `app/requirements.txt` é pinada com `==` (versões testadas contra o release Maestro). O arquivo traz comentários explícitos instruindo a testar um-a-um antes de qualquer upgrade — várias combinações têm quebras conhecidas (tokenizers/accelerate, torch/torchcodec/xformers ABI). `numpy` é a única exceção notável dentro do bloco core (versão testada como 2.1.2; CI usa 2.2.6).
