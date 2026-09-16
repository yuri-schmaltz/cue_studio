#!/usr/bin/env bash
# Maestro — launcher local standalone
#
# Sobe o backend FastAPI/Uvicorn direto, usando o venv já criado em app/env/.
#
# Reuses a matching Maestro version. Restarts only a process verified as
# launch.py in this checkout; an unrelated port holder is never terminated.
# The effective port is recorded for the Vite development proxy.
#
# Uso:
#   ./start.sh                  # porta padrão 7860, log em .launcher.log
#   ./start.sh --port 7865      # porta custom
#   ./start.sh --compile        # passa --compile para launch.py (kernel fusion)
#   ./start.sh --share          # liga 0.0.0.0 (LAN) em vez de 127.0.0.1
#   ./start.sh --no-build       # pula verificação de UI build
#   ./start.sh --no-open        # não abre o navegador automaticamente
#   ./start.sh --force          # ignora detecção de stale build; sempre reinicia

set -euo pipefail

# Resolve diretório do script (funciona com symlinks)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_DIR="$SCRIPT_DIR/app"
PIDFILE="$APP_DIR/.launcher.pid"
LOGFILE="$APP_DIR/.launcher.log"
VERSION_FILE="$SCRIPT_DIR/VERSION"

# Defaults
PORT="7860"
COMPILE_FLAG=""
BIND_HOST="127.0.0.1"
SKIP_BUILD=0
FORCE_RESTART=0
AUTO_OPEN=1   # open the browser on the default handler unless --no-open

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|-p)
      if [[ $# -lt 2 || ! "$2" =~ ^[0-9]{1,5}$ ]]; then
        echo "[start] ERRO: --port requer um número entre 1 e 65535" >&2
        exit 2
      fi
      PORT=$((10#$2))
      if (( PORT < 1 || PORT > 65535 )); then
        echo "[start] ERRO: porta deve estar entre 1 e 65535" >&2
        exit 2
      fi
      shift 2 ;;
    --compile)     COMPILE_FLAG="--compile"; shift ;;
    --share)       BIND_HOST="0.0.0.0"; shift ;;
    --no-build)    SKIP_BUILD=1; shift ;;
    --force)       FORCE_RESTART=1; shift ;;
    --no-open)     AUTO_OPEN=0; shift ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      echo "  --force             ignora stale build; sempre reinicia" >&2
      echo "  --no-open           não abre o navegador automaticamente" >&2
      exit 0 ;;
    *)
      echo "Argumento desconhecido: $1" >&2
      exit 2 ;;
  esac
done

# Declared Maestro version (from VERSION file). If missing, fall back to
# "0.0.0+unknown" so the comparison still works (any running build that
# reports a real version will look "newer" than unknown and force restart).
EXPECTED_VERSION="0.0.0+unknown"
if [[ -f "$VERSION_FILE" ]]; then
  EXPECTED_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
  [[ -z "$EXPECTED_VERSION" ]] && EXPECTED_VERSION="0.0.0+unknown"
fi

echo "[start] Maestro launcher (standalone) — porta $PORT ($BIND_HOST); versão esperada: $EXPECTED_VERSION"

# --- 1. Detect venv ---
VENV=""
for candidate in env-sol env-rtx50 env; do
  if [[ -x "$APP_DIR/$candidate/bin/python" ]]; then
    VENV="$candidate"
    break
  fi
done

if [[ -z "$VENV" ]]; then
  echo "[start] ERRO: nenhum venv encontrado em app/env{,-sol,-rtx50}/" >&2
  echo "             Crie o ambiente Python conforme README.md:" >&2
  exit 1
fi
PY="$APP_DIR/$VENV/bin/python"
echo "[start] Usando venv: $VENV ($PY)"

# --- 2. Sanity: GPU detectável ---
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || true)
  GPU_DRIVER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || true)
  echo "[start] GPU: ${GPU_NAME:-desconhecida} (driver ${GPU_DRIVER:-?})"
else
  echo "[start] AVISO: nvidia-smi não encontrado — verifique o driver NVIDIA antes de gerar mídia"
fi

# --- 3. Sanity: UI buildada ---
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  if [[ ! -f "$SCRIPT_DIR/ui/dist/index.html" ]]; then
    echo "[start] UI não buildada — correndo npm install + npm run build..."
    if [[ ! -d "$SCRIPT_DIR/ui/node_modules" ]]; then
      (cd "$SCRIPT_DIR/ui" && npm install) || {
        echo "[start] ERRO: npm install falhou" >&2
        exit 3
      }
    fi
    (cd "$SCRIPT_DIR/ui" && npm run build) || {
      echo "[start] ERRO: UI build falhou" >&2
      exit 3
    }
  else
    echo "[start] UI dist já existe — ok"
  fi
fi

# --- 3.5. fix_llama_symlinks (idempotente, < 50ms) ---
#
# O bundle de llama.cpp em app/ckpts/llm/bin/ vem sem os SONAME
# symlinks (libllama-common.so.0 etc.) que o ld.so procura. Sem eles
# o llama-server child process morre com "code 127" e o Director
# perde o caminho de LLM (Gemma 4) — sintoma silencioso, hard to
# spot. O script fix_llama_symlinks.sh cria os symlinks faltantes
# e é seguro rodar todo startup (cria só o que falta).
if [[ -x "$APP_DIR/scripts/fix_llama_symlinks.sh" ]]; then
  "$APP_DIR/scripts/fix_llama_symlinks.sh" || echo "[start] AVISO: fix_llama_symlinks falhou (não fatal — backend sobe sem LLM advisor)" >&2
fi

# Update just the development proxy setting, retaining unrelated local entries.
write_backend_port() {
  "$PY" - "$SCRIPT_DIR/ui/.env.local" "$1" <<'PYENV'
import os, re, sys, tempfile
from pathlib import Path
path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
text = path.read_text() if path.exists() else ""
lines = [line for line in text.splitlines() if not re.match(r"^\s*(?:export\s+)?MAESTRO_BACKEND_PORT\s*=", line)]
lines.append("MAESTRO_BACKEND_PORT=" + sys.argv[2])
fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".maestro-env-")
try:
    with os.fdopen(fd, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    if path.exists():
        os.chmod(temporary, path.stat().st_mode & 0o777)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PYENV
}

is_managed_process() {
  "$PY" - "$1" "$APP_DIR" <<'PYPROC'
import os, sys
from pathlib import Path
try:
    pid = int(sys.argv[1])
    app = Path(sys.argv[2]).resolve()
    cwd = Path(os.readlink(f"/proc/{pid}/cwd")).resolve()
    args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
    scripts = [Path(os.fsdecode(arg)) for arg in args[1:] if arg and not arg.startswith(b"-")]
    valid = cwd == app and any((cwd / script).resolve() == app / "launch.py" for script in scripts)
except (OSError, ValueError):
    valid = False
sys.exit(0 if valid else 1)
PYPROC
}

# --- 4. Reuse a matching server, or restart our verified process ---
probe_url="http://127.0.0.1:${PORT}/"
version_url="http://127.0.0.1:${PORT}/health/version"

probe_running_version() {
  # Returns the version string reported by /health/version, or empty
  # string if unreachable / not Maestro / not JSON. Uses python3 (not
  # python) to be predictable across distros — some systems have only
  # python3 on PATH; some have a python shim without the json module.
  local body
  body=$(curl --noproxy '*' --fail -sS --max-time 2 "$version_url" 2>/dev/null || true)
  if [[ -z "$body" ]]; then
    return 0
  fi
  python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("version", "") if d.get("name") == "maestro" else "")' <<<"$body" 2>/dev/null || true
}

probe_index_alive() {
  # Lightweight index probe — returns 0 if a Maestro (any version) is up.
  curl --noproxy '*' --fail -sS -o /dev/null --max-time 1 "$probe_url" 2>/dev/null
}

if [[ "$FORCE_RESTART" -eq 0 ]] && probe_index_alive; then
  RUNNING_VERSION="$(probe_running_version || true)"
  if [[ -n "$RUNNING_VERSION" && "$RUNNING_VERSION" == "$EXPECTED_VERSION" ]]; then
    # The running backend might have been started outside this launcher
    # (e.g. manually or by a previous shell). If the pidfile exists but its
    # PID is dead, overwrite it with a fresh marker so stop.sh finds a
    # consistent target. Use 0 as a sentinel — the real PID lives in the
    # process table; the pidfile just signals "an instance is alive on $PORT".
    if [[ -f "$PIDFILE" ]]; then
      OLD_PID=$(cat "$PIDFILE" 2>/dev/null || true)
      if ! [[ "$OLD_PID" =~ ^[0-9]+$ ]] || ! kill -0 "$OLD_PID" 2>/dev/null; then
        echo "0" > "$PIDFILE"
      fi
    fi
    write_backend_port "$PORT"
    echo "[start] (skipped) — Maestro v${RUNNING_VERSION} já está rodando na porta ${PORT}"
    exit 0
  fi
fi

if [[ -f "$PIDFILE" ]]; then
  OLD_PID=$(cat "$PIDFILE" 2>/dev/null || true)
  if [[ "$OLD_PID" =~ ^[0-9]+$ ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    if ! is_managed_process "$OLD_PID"; then
      echo "[start] ERRO: pidfile aponta para processo não gerenciado; preservado." >&2
      exit 6
    fi
    echo "[start] Reiniciando processo gerenciado $OLD_PID"
    kill "$OLD_PID" 2>/dev/null || true
    for ((attempt=0; attempt<50; attempt++)); do
      if ! is_managed_process "$OLD_PID"; then break; fi
      sleep 0.1
    done
    if is_managed_process "$OLD_PID"; then kill -9 "$OLD_PID" 2>/dev/null || true; fi
  fi
  rm -f "$PIDFILE"
fi

# A foreign listener may not speak HTTP. Test the bind, not just GET /.
if ! "$PY" - "$BIND_HOST" "$PORT" <<'PYPORT'
import socket, sys
try:
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind((sys.argv[1], int(sys.argv[2])))
except OSError:
    sys.exit(1)
PYPORT
then
  echo "[start] ERRO: porta ${PORT} ocupada; processo preservado. Escolha --port livre." >&2
  exit 6
fi

# --- 6. Sobe o backend ---
cd "$APP_DIR"
echo "[start] Lançando backend → log: $LOGFILE"
SERVER_NAME="$BIND_HOST" SERVER_PORT="$PORT" \
  nohup "$PY" -u launch.py $COMPILE_FLAG >"$LOGFILE" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$PIDFILE"

echo "[start] Backend PID: $BACKEND_PID"

# --- 7. Espera o bind aparecer ---
URL="http://127.0.0.1:${PORT}/"
echo -n "[start] Aguardando bind em ${BIND_HOST}:${PORT} "
WAITED=0
MAX_WAIT=120
# Detect the backend's fallback before probing its effective URL.
ACTUAL_PORT="$PORT"
while (( WAITED < MAX_WAIT )); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo ""
    echo "[start] ERRO: backend morreu logo após o start. Últimas linhas do log:" >&2
    tail -40 "$LOGFILE" >&2
    rm -f "$PIDFILE"
    exit 4
  fi
  detected=$(sed -nE 's/.*Port [0-9]+ was busy — using ([0-9]+) instead.*/\1/p' "$LOGFILE" | tail -1)
  if [[ "$detected" =~ ^[0-9]{1,5}$ ]] && (( 10#$detected >= 1 && 10#$detected <= 65535 )); then
    ACTUAL_PORT=$((10#$detected))
    URL="http://127.0.0.1:${ACTUAL_PORT}/"
  fi
  if curl --noproxy '*' --fail -sS -o /dev/null --max-time 1 "$URL" 2>/dev/null; then
    echo " OK (após ${WAITED}s)"
    break
  fi
  echo -n "."
  sleep 1
  WAITED=$(( WAITED + 1 ))
done

if (( WAITED >= MAX_WAIT )); then
  echo ""
  echo "[start] ERRO: backend não respondeu em ${MAX_WAIT}s. Tail do log:" >&2
  tail -40 "$LOGFILE" >&2
  echo "[start] PID $BACKEND_PID ainda vivo — matando" >&2
  kill "$BACKEND_PID" 2>/dev/null || true
  rm -f "$PIDFILE"
  exit 5
fi

write_backend_port "$ACTUAL_PORT"

# --- 8. Resumo ---
echo ""
echo "============================================================"
echo "  Maestro está rodando! (v${EXPECTED_VERSION})"
echo ""
echo "  UI (React):  $URL"
echo "  API docs:    ${URL}docs"
echo "  Health:      ${URL}health/version"
echo ""
echo "  PID:   $BACKEND_PID  (pidfile: $PIDFILE)"
echo "  Log:   $LOGFILE"
echo ""
echo "  Pare com:  ./stop.sh"
echo "  Acompanhe: tail -f $LOGFILE"
echo "============================================================"

# --- 9. Auto-open the browser (opt-out via --no-open) ---
#
# Launches the system default browser pointed at the local UI. We only
# do this when:
#   - AUTO_OPEN is still 1 (user didn't pass --no-open)
#   - the bind host is loopback (127.0.0.1 / localhost) — opening a
#     remote URL when --share binds 0.0.0.0 would surprise the operator
#     by pointing their browser at the LAN IP they may not want to use.
#   - we have a TTY-ish session OR the platform's `open` command is
#     available — under `nohup` from a cron job we shouldn't try.
#
# Failure is non-fatal: if no opener is found, just print a hint.
if (( AUTO_OPEN == 1 )) && [[ "$BIND_HOST" == "127.0.0.1" || "$BIND_HOST" == "localhost" ]]; then
  if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] || [[ "$(uname -s)" == "Darwin" ]]; then
    case "$(uname -s)" in
      Darwin)  open "$URL" >/dev/null 2>&1 || echo "[start] Não consegui abrir o navegador; acesse $URL manualmente." ;;
      Linux)   command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 \
                || command -v gio      >/dev/null 2>&1 && gio open "$URL" >/dev/null 2>&1 \
                || echo "[start] AVISO: instale xdg-utils (xdg-open) para auto-abrir o navegador, ou acesse $URL." ;;
      MINGW*|MSYS*|CYGWIN*) cmd.exe /c start "" "$URL" >/dev/null 2>&1 \
                || echo "[start] Não consegui abrir o navegador; acesse $URL manualmente." ;;
      *)       echo "[start] OS não reconhecido; acesse $URL manualmente." ;;
    esac
  else
    echo "[start] Sem sessão gráfica detectada; acesse $URL manualmente."
  fi
fi
