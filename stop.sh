#!/usr/bin/env bash
# Para o backend Maestro iniciado por start.sh
#
# Uso:
#   ./stop.sh            # SIGTERM gracioso, fallback SIGKILL após 5s
#   ./stop.sh --force    # SIGKILL direto
#   ./stop.sh --clean    # também remove pidfile + log vazio

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_DIR="$SCRIPT_DIR/app"
PIDFILE="$APP_DIR/.launcher.pid"

FORCE=0
CLEAN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --clean) CLEAN=1; shift ;;
    -h|--help)
      sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$PIDFILE" ]]; then
  echo "[stop] Sem pidfile — nada para parar"
  if [[ "$CLEAN" -eq 1 ]]; then
    rm -f "$APP_DIR/.launcher.log"
  fi
  exit 0
fi

# Detect python binary
PY=""
for candidate in env-sol env-rtx50 env; do
  if [[ -x "$APP_DIR/$candidate/bin/python" ]]; then
    PY="$APP_DIR/$candidate/bin/python"
    break
  fi
done
if [[ -z "$PY" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PY="python3"
  elif command -v python >/dev/null 2>&1; then
    PY="python"
  fi
fi

is_managed_process() {
  if [[ -n "$PY" ]]; then
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
  else
    return 0
  fi
}

PID=$(cat "$PIDFILE")
if [[ ! "$PID" =~ ^[0-9]+$ ]] || ! kill -0 "$PID" 2>/dev/null; then
  echo "[stop] PID $PID já não está vivo — limpando pidfile stale"
  rm -f "$PIDFILE"
  exit 0
fi

if ! is_managed_process "$PID"; then
  echo "[stop] ERRO: pidfile aponta para processo não gerenciado; preservado." >&2
  exit 6
fi

echo "[stop] Matando backend PID $PID..."
if [[ "$FORCE" -eq 1 ]]; then
  kill -9 "$PID" 2>/dev/null || true
else
  kill "$PID" 2>/dev/null || true
  for i in 1 2 3 4 5; do
    if ! is_managed_process "$PID"; then
      break
    fi
    sleep 1
  done
  if is_managed_process "$PID"; then
    echo "[stop] SIGTERM não foi suficiente — SIGKILL"
    kill -9 "$PID" 2>/dev/null || true
  fi
fi

rm -f "$PIDFILE"
[[ "$CLEAN" -eq 1 ]] && rm -f "$APP_DIR/.launcher.log"

echo "[stop] OK — Maestro parado"
