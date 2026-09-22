#!/usr/bin/env bash
# Cue Studio — instalador one-shot (clone → venv → deps → start.sh)
#
# Orquestra o bootstrap completo de uma máquina limpa até o backend
# estar respondendo HTTP 200 em /health/version. Foi desenhado para
# coexistir com `app/setup.py` (que continua sendo o caminho oficial
# interativo); este wrapper é a alternativa **não-interativa** —
# ideal para CI, Dockerfiles, máquinas novas, ou setups reproduzíveis.
#
# Pipeline:
#   1. Detecta se já estamos dentro de um checkout Cue Studio (procura
#      VERSION + start.sh na cwd ou no diretório-pai mais próximo).
#   2. Se não houver checkout, faz `git clone` da URL fornecida (ou
#      padrão: https://github.com/yuri-schmaltz/cue_studio.git).
#   3. Verifica pré-requisitos do sistema: git, curl, python3 (3.10+),
#      e nvidia-smi (aviso se ausente).
#   4. Cria o venv via `uv` (preferido) ou `python3 -m venv` (fallback)
#      em `app/env/`. Idempotente — não recria se já existir e válido.
#   5. Detecta a versão de CUDA instalada (via nvidia-smi) e instala o
#      Torch correspondente: cu126 (CUDA 12.6), cu128 (12.8), cu130
#      (13.0). Se nenhuma CUDA detectada, instala CPU-only.
#   6. Instala o resto de `app/requirements.txt` em um único `pip install`
#      com `--upgrade-strategy only-if-needed` para não quebrar pinos.
#   7. (Opcional) baixa llama-server se o LLM advisor estiver habilitado
#      e o binário ainda não estiver em `app/ckpts/llm/bin/`.
#   8. Chama `./start.sh --no-open` (ou `./start.sh` se --launch).
#   9. Aguarda o probe HTTP em /health/version e imprime resumo final.
#
# Uso:
#   ./install.sh                            # modo auto: cwd ou clone
#   ./install.sh --repo URL                 # clona de uma URL custom
#   ./install.sh --target DIR               # instala em DIR (default: cwd)
#   ./install.sh --python-ver 3.11          # força versão Python (default: 3.11)
#   ./install.sh --venv-name env            # nome do venv (default: env)
#   ./install.sh --cuda cu128               # força versão CUDA (auto|disable|cu121|cu124|cu126|cu128|cu130)
#   ./install.sh --port 7861                # porta do backend (default: 7860)
#   ./install.sh --no-deps                  # pula pip install (assume deps ok)
#   ./install.sh --no-llama                 # pula download do llama-server
#   ./install.sh --launch                   # após instalar, sobe start.sh
#   ./install.sh --dry-run                  # apenas printa comandos, não executa
#   ./install.sh -h|--help                  # mostra este help
#
# Variáveis de ambiente honradas:
#   CUE_STUDIO_REPO       — URL default do clone
#   CUE_STUDIO_PYTHON     — versão Python preferida (ex: 3.11)
#   CUE_STUDIO_CUDA       — versão CUDA preferida (auto|cpu|cu126|cu128|cu130)
#   CUE_STUDIO_SKIP_DEPS  — se "1", pula pip install
#   CUE_STUDIO_SKIP_LLAMA — se "1", pula download llama-server
#   CUE_STUDIO_DRY_RUN    — se "1", modo dry-run
#
# Exit codes:
#   0  — sucesso (instalação completa, ou backend já estava rodando)
#   1  — pré-requisito faltando (git/python3/curl)
#   2  — argumento inválido
#   3  — clone falhou
#   4  — venv não pôde ser criado
#   5  — pip install falhou
#   6  — backend não respondeu no probe
#   7  — llama-server falhou (não fatal se --no-llama)

set -euo pipefail

# -----------------------------------------------------------------------------
# Defaults (override via CLI flags or env vars)
# -----------------------------------------------------------------------------
REPO="${CUE_STUDIO_REPO:-https://github.com/yuri-schmaltz/cue_studio.git}"
TARGET_DIR=""
PYTHON_VER="${CUE_STUDIO_PYTHON:-3.11}"
PORT="${CUE_STUDIO_PORT:-7860}"
VENV_NAME="${CUE_STUDIO_VENV_NAME:-env}"
CUDA_HINT="${CUE_STUDIO_CUDA:-auto}"      # auto|disable|cu126|cu128|cu130
SKIP_DEPS="${CUE_STUDIO_SKIP_DEPS:-0}"
SKIP_LLAMA="${CUE_STUDIO_SKIP_LLAMA:-0}"
DRY_RUN="${CUE_STUDIO_DRY_RUN:-0}"
LAUNCH_AFTER=0
FORCE_CLONE=0
ALLOW_INTERACTIVE=0

# -----------------------------------------------------------------------------
# Pretty output
# -----------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_BLUE=$'\033[34m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
else
  C_RESET="" C_BOLD="" C_BLUE="" C_GREEN="" C_YELLOW="" C_RED=""
fi

info()  { printf "%s[install]%s %s\n" "$C_BLUE"   "$C_RESET" "$*"; }
ok()    { printf "%s[install]%s %s %s\n" "$C_GREEN" "$C_RESET" "$C_BOLD" "$*"; }
warn()  { printf "%s[install]%s %s %s\n" "$C_YELLOW" "$C_RESET" "$*"; }
err()   { printf "%s[install]%s %s %s\n" "$C_RED"   "$C_RESET" "$*" >&2; }
step()  { printf "\n%s[install]==>%s %s%s%s\n" "$C_BOLD$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }

run() {
  # run CMD... — exec or print depending on DRY_RUN
  if [[ "$DRY_RUN" == "1" ]]; then
    printf "%s[install][DRY]%s %s\n" "$C_YELLOW" "$C_RESET" "$*"
  else
    "$@"
  fi
}

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------
usage() {
  sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; /^set -euo/d; /^$/d'
  cat <<'USAGE_EOF'
Variáveis de ambiente: CUE_STUDIO_REPO, CUE_STUDIO_PYTHON, CUE_STUDIO_CUDA,
CUE_STUDIO_SKIP_DEPS, CUE_STUDIO_SKIP_LLAMA, CUE_STUDIO_DRY_RUN.

Exit codes: 0 ok, 1 deps sistema, 2 args, 3 clone, 4 venv, 5 pip,
6 backend probe, 7 llama-server.
USAGE_EOF
}

# -----------------------------------------------------------------------------
# Argument parsing
# -----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)         REPO="$2"; shift 2 ;;
    --target)       TARGET_DIR="$2"; shift 2 ;;
    --python-ver)   PYTHON_VER="$2"; shift 2 ;;
    --venv-name)    VENV_NAME="$2"; shift 2 ;;
    --cuda)         CUDA_HINT="$2"; shift 2 ;;
    --port|-p)      PORT="$2"; shift 2 ;;
    --no-deps)      SKIP_DEPS=1; shift ;;
    --no-llama)     SKIP_LLAMA=1; shift ;;
    --launch)       LAUNCH_AFTER=1; shift ;;
    --force-clone)  FORCE_CLONE=1; shift ;;
    --allow-interactive) ALLOW_INTERACTIVE=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)
      err "Argumento desconhecido: $1"
      usage
      exit 2
      ;;
  esac
done

# -----------------------------------------------------------------------------
# 1. Detectar checkout existente
# -----------------------------------------------------------------------------
step "Detectando checkout existente"

detect_checkout() {
  local dir="$1"
  # Walk up to 3 levels looking for VERSION + start.sh
  for ((i=0; i<4; i++)); do
    if [[ -f "$dir/VERSION" && -f "$dir/start.sh" && -f "$dir/app/launch.py" ]]; then
      printf "%s\n" "$(cd "$dir" && pwd)"
      return 0
    fi
    [[ "$dir" == "/" ]] && break
    dir="$(dirname "$dir")"
  done
  return 1
}

if [[ -z "$TARGET_DIR" ]]; then
  if checkout="$(detect_checkout "$(pwd)")"; then
    TARGET_DIR="$checkout"
    info "Checkout existente detectado em $TARGET_DIR"
  else
    if [[ "$FORCE_CLONE" -eq 1 ]]; then
      err "Nenhum checkout existente e --force-clone foi passado; abortando."
      exit 3
    fi
    # Default: clonar em ./cue_studio
    TARGET_DIR="$(pwd)/cue_studio"
    info "Nenhum checkout existente — será clonado em $TARGET_DIR"
  fi
fi

# Resolve to absolute path
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || echo "$TARGET_DIR")"

# -----------------------------------------------------------------------------
# 2. Pré-requisitos do sistema
# -----------------------------------------------------------------------------
step "Verificando pré-requisitos"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Comando '$1' não encontrado. Instale-o antes de continuar."
    return 1
  fi
}

missing=0
for c in git curl python3; do
  if ! need_cmd "$c"; then missing=1; fi
done

if (( missing )); then
  err "Pré-requisitos faltando. Em Debian/Ubuntu:"
  err "  sudo apt-get install -y git curl python3 python3-venv"
  exit 1
fi

# Python version check (3.10+)
PY_VERSION="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
PY_MAJOR="$(python3 -c 'import sys; print(sys.version_info[0])')"
PY_MINOR="$(python3 -c 'import sys; print(sys.version_info[1])')"
if (( PY_MAJOR < 3 || (PY_MAJOR == 3 && PY_MINOR < 10) )); then
  err "Python 3.10+ necessário; encontrado $PY_VERSION."
  exit 1
fi
info "Python do sistema: $PY_VERSION"

# nvidia-smi — warning, not error
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || true)
  GPU_DRIVER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || true)
  # Driver 595+ removed the legacy cuda_version / cuda_runtime_version query
  # fields. Try both, then fall back to nvcc, then to "?" (driver alone
  # tells us we're on a recent enough CUDA stack to default to cu128).
  CUDA_VERSION=$(nvidia-smi --query-gpu=cuda_version --format=csv,noheader 2>/dev/null | head -1 || true)
  if [[ -z "$CUDA_VERSION" || "$CUDA_VERSION" == *"not a valid field"* ]]; then
    CUDA_VERSION=$(nvidia-smi --query-gpu=cuda_runtime_version --format=csv,noheader 2>/dev/null | head -1 || true)
  fi
  if [[ -z "$CUDA_VERSION" || "$CUDA_VERSION" == *"not a valid field"* ]]; then
    if command -v nvcc >/dev/null 2>&1; then
      CUDA_VERSION=$(nvcc --version 2>/dev/null | grep -oE 'release [0-9]+\.[0-9]+' | awk '{print $2}')
    fi
  fi
  info "GPU: ${GPU_NAME:-desconhecida} (driver ${GPU_DRIVER:-?}, CUDA ${CUDA_VERSION:-?})"
else
  warn "nvidia-smi não encontrado — prosseguindo sem GPU (CPU-only)."
  CUDA_HINT="disable"
fi

# uv preferred; fallback to venv
HAS_UV=0
if command -v uv >/dev/null 2>&1; then
  HAS_UV=1
  info "uv $(uv --version 2>/dev/null || echo '?') disponível — será usado para criar o venv"
else
  warn "uv não encontrado — usando 'python3 -m venv' (mais lento)."
fi

# -----------------------------------------------------------------------------
# 3. Clone if needed
# -----------------------------------------------------------------------------
if [[ ! -d "$TARGET_DIR/.git" ]]; then
  step "Clonando $REPO → $TARGET_DIR"
  parent="$(dirname "$TARGET_DIR")"
  base="$(basename "$TARGET_DIR")"
  run mkdir -p "$parent"
  run git clone "$REPO" "$TARGET_DIR"
  if [[ ! -f "$TARGET_DIR/VERSION" ]]; then
    err "Clone em $TARGET_DIR não parece um checkout Cue Studio (VERSION ausente)."
    exit 3
  fi
fi

cd "$TARGET_DIR"
VERSION="$(tr -d '[:space:]' < VERSION 2>/dev/null || echo '0.0.0+unknown')"
ok "Checkout Cue Studio v${VERSION} pronto em $TARGET_DIR"

# -----------------------------------------------------------------------------
# 4. Create venv (idempotent)
# -----------------------------------------------------------------------------
VENV_DIR="app/$VENV_NAME"
PY_BIN="$VENV_DIR/bin/python"

step "Configurando venv em $VENV_DIR"

if [[ -x "$PY_BIN" ]]; then
  info "Venv já existe — verificando sanidade..."
  VENV_PY_VER="$("$PY_BIN" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  if [[ "$VENV_PY_VER" != "$PYTHON_VER" ]]; then
    warn "Venv usa Python $VENV_PY_VER (pediu $PYTHON_VER). Recriando..."
    run rm -rf "$VENV_DIR"
  fi
fi

if [[ ! -x "$PY_BIN" ]]; then
  if [[ "$HAS_UV" == "1" ]]; then
    info "Criando venv com uv (Python $PYTHON_VER)..."
    run uv venv --python "$PYTHON_VER" "$VENV_DIR"
  else
    info "Criando venv com python3 -m venv..."
    # Try requested version first, fallback to default python3
    if command -v "python${PYTHON_VER}" >/dev/null 2>&1; then
      run "python${PYTHON_VER}" -m venv "$VENV_DIR"
    else
      warn "python${PYTHON_VER} não disponível; usando python3 ($PY_VERSION)"
      run python3 -m venv "$VENV_DIR"
    fi
  fi
  PY_BIN="$VENV_DIR/bin/python"
fi

if [[ ! -x "$PY_BIN" ]]; then
  err "Falha ao criar/recuperar venv em $VENV_DIR"
  exit 4
fi

ok "Venv ativo: $("$PY_BIN" -c 'import sys; print(sys.executable)')"

# -----------------------------------------------------------------------------
# 5. Resolve CUDA version → Torch index
# -----------------------------------------------------------------------------
resolve_cuda() {
  if [[ "$CUDA_HINT" == "auto" ]]; then
    if command -v nvidia-smi >/dev/null 2>&1; then
      # nvidia-smi exposes the runtime CUDA version, not the driver-supported
      # maximum — that's exactly what we need (the PyTorch CUDA wheels target
      # the runtime). Driver 595+ removed both fields; fall back to nvcc.
      # Driver major version is also a useful proxy: 545+ → CUDA 12.x,
      # 470-535 → CUDA 11.x, 450-470 → CUDA 11.0.
      local cv drv
      cv="$(nvidia-smi --query-gpu=cuda_version --format=csv,noheader 2>/dev/null | head -1 || true)"
      if [[ -z "$cv" || "$cv" == *"not a valid field"* ]]; then
        cv="$(nvidia-smi --query-gpu=cuda_runtime_version --format=csv,noheader 2>/dev/null | head -1 || true)"
      fi
      if [[ -z "$cv" || "$cv" == *"not a valid field"* ]]; then
        if command -v nvcc >/dev/null 2>&1; then
          cv="$(nvcc --version 2>/dev/null | grep -oE 'release [0-9]+\.[0-9]+' | awk '{print $2}')"
        fi
      fi
      # If still empty, infer from driver major version (best-effort).
      if [[ -z "$cv" ]]; then
        drv="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || true)"
        case "${drv%%.*}" in
          5[5-9]|6*) cv="12.8" ;;   # driver 550+ → CUDA 12.x runtime
          5[3-4])     cv="12.2" ;;
          5[1-2])     cv="11.8" ;;
          4[7-9])     cv="11.4" ;;
          *)          cv="12.8" ;;
        esac
        info "CUDA runtime não legível via nvidia-smi/nvcc — inferido do driver ${drv}: CUDA ${cv}"
      fi
      case "$cv" in
        13.*)  echo "cu130" ;;
        12.8*|12.9*) echo "cu128" ;;
        12.6*|12.7*) echo "cu126" ;;
        12.4*|12.5*) echo "cu124" ;;
        12.0*|12.1*|12.2*|12.3*) echo "cu121" ;;   # PyTorch 2.4 supports cu121
        11.8*) echo "cu118" ;;
        *)     echo "cu128" ;;   # safe default
      esac
    else
      echo "disable"
    fi
  elif [[ "$CUDA_HINT" == "disable" || "$CUDA_HINT" == "cpu" ]]; then
    echo "disable"
  else
    echo "$CUDA_HINT"
  fi
}

TORCH_CUDA="$(resolve_cuda)"

case "$TORCH_CUDA" in
  cu121)
    TORCH_INDEX="https://download.pytorch.org/whl/cu121"
    TORCH_PKG="torch==2.4.0+cu121 torchvision==0.19.0+cu121 torchaudio==2.4.0+cu121"
    ;;
  cu124)
    TORCH_INDEX="https://download.pytorch.org/whl/cu124"
    TORCH_PKG="torch==2.4.0+cu124 torchvision==0.19.0+cu124 torchaudio==2.4.0+cu124"
    ;;
  cu126)
    TORCH_INDEX="https://download.pytorch.org/whl/cu126"
    TORCH_PKG="torch==2.6.0+cu126 torchvision==0.21.0+cu126 torchaudio==2.6.0+cu126"
    ;;
  cu128)
    TORCH_INDEX="https://download.pytorch.org/whl/cu128"
    TORCH_PKG="torch==2.7.1+cu128 torchvision==0.22.1+cu128 torchaudio==2.7.1+cu128"
    ;;
  cu130)
    TORCH_INDEX="https://download.pytorch.org/whl/cu130"
    TORCH_PKG="torch==2.10.0+cu130 torchvision torchaudio"
    ;;
  disable)
    TORCH_INDEX="https://download.pytorch.org/whl/cpu"
    TORCH_PKG="torch torchvision torchaudio"
    ;;
  *)
    err "CUDA inválida: $TORCH_CUDA (esperado: auto|disable|cu126|cu128|cu130)"
    exit 2
    ;;
esac

info "Torch será instalado com índice: $TORCH_CUDA ($TORCH_INDEX)"

# -----------------------------------------------------------------------------
# 6. Install dependencies
# -----------------------------------------------------------------------------
if [[ "$SKIP_DEPS" == "1" ]]; then
  warn "Pulando pip install (--no-deps)."
else
  step "Instalando dependências (pode levar 5-15 min na primeira vez)"

  # Upgrade pip first (uv venvs ship with pip disabled by default — we re-enable)
  run "$PY_BIN" -m ensurepip --upgrade 2>/dev/null || true
  run "$PY_BIN" -m pip install --upgrade pip wheel setuptools

  # Torch first (large, separate index)
  info "Instalando PyTorch ($TORCH_CUDA)..."
  run "$PY_BIN" -m pip install --upgrade-strategy only-if-needed \
    --extra-index-url "$TORCH_INDEX" \
    $TORCH_PKG

  # requirements.txt — skip torch lines that we already installed
  if [[ -f "app/requirements.txt" ]]; then
    info "Instalando requirements.txt (pulando torch/vision/audio já instalados)..."
    run "$PY_BIN" -m pip install --upgrade-strategy only-if-needed \
      -r app/requirements.txt
  else
    warn "app/requirements.txt não encontrado; pulando."
  fi

  # Sanity check
  if ! run "$PY_BIN" -c 'import torch; print("torch=", torch.__version__, "cuda=", torch.cuda.is_available())'; then
    err "Importação de torch falhou após pip install."
    exit 5
  fi
fi

ok "Dependências Python prontas."

# -----------------------------------------------------------------------------
# 7. (Optional) llama-server
# -----------------------------------------------------------------------------
if [[ "$SKIP_LLAMA" == "1" ]]; then
  warn "Pulando verificação do llama-server (--no-llama)."
else
  step "Verificando llama-server"
  LLAMA_BIN="app/ckpts/llm/bin/llama-server"
  if [[ -x "$LLAMA_BIN" ]]; then
    info "llama-server já presente em $LLAMA_BIN — pulando."
  else
    warn "llama-server ausente em $LLAMA_BIN."
    warn "O backend baixa automaticamente (~600 MB) no primeiro uso do LLM advisor."
    warn "Para pré-baixar agora: rode start.sh uma vez — o download é transparente."
  fi
fi

# -----------------------------------------------------------------------------
# 8. UI build (start.sh handles this too, but pre-warm avoids surprise)
# -----------------------------------------------------------------------------
step "Garantindo UI buildada"
if [[ ! -d "ui/node_modules" ]]; then
  info "ui/node_modules ausente — npm install..."
  if command -v npm >/dev/null 2>&1; then
    run npm --prefix ui install
  else
    warn "npm não encontrado; pulando UI bootstrap. start.sh vai reclamar."
  fi
fi
if [[ ! -f "ui/dist/index.html" ]] && command -v npm >/dev/null 2>&1; then
  info "ui/dist/index.html ausente — npm run build..."
  run npm --prefix ui run build
fi

# -----------------------------------------------------------------------------
# 9. Launch
# -----------------------------------------------------------------------------
if [[ "$LAUNCH_AFTER" == "1" ]]; then
  step "Subindo backend via ./start.sh --port $PORT"
  if [[ ! -x "./start.sh" ]]; then
    err "./start.sh não é executável."
    exit 6
  fi
  run ./start.sh --no-open --port "$PORT"
  # Probe (start.sh will pick the port; if it falls back to another, the
  # probe just retries both — but in practice it only changes on collision).
  info "Aguardando /health/version em http://127.0.0.1:$PORT/ ..."
  for i in 1 2 3 4 5 6 7 8 9 10 15 20 25 30 40 50 60; do
    sleep 1
    if curl --noproxy '*' --fail -sS --max-time 1 "http://127.0.0.1:$PORT/health/version" 2>/dev/null; then
      echo ""
      ok "Backend respondendo em http://127.0.0.1:$PORT/"
      ok "  API docs:   http://127.0.0.1:$PORT/docs"
      ok "  Health:     http://127.0.0.1:$PORT/health/version"
      ok "Versão instalada: v${VERSION}"
      exit 0
    fi
  done
  err "Backend não respondeu em ${PORT} após 60s. Verifique app/.launcher.log."
  exit 6
fi

# -----------------------------------------------------------------------------
# 10. Final summary (no launch)
# -----------------------------------------------------------------------------
cat <<EOF

${C_BOLD}${C_GREEN}Cue Studio v${VERSION} instalado em:${C_RESET} ${TARGET_DIR}

Próximos passos:
  cd $TARGET_DIR
  ./start.sh                     # porta 7860 (ou --port 7861)
  open http://127.0.0.1:7860/

Para desinstalar o venv:
  rm -rf $TARGET_DIR/app/$VENV_NAME $TARGET_DIR/app/.launcher.pid $TARGET_DIR/app/.launcher.log

Reinstalar deps do zero:
  $TARGET_DIR/install.sh --no-deps=false
EOF

exit 0
