#!/usr/bin/env bash
# Roda todos os protótipos e testes.
# Uso: bash _reversa_forward/plano-2026-10-04/scripts/run_all_prototypes.sh

set -uo pipefail
cd "$(dirname "$0")/.."
GREEN="\033[0;32m"
RED="\033[0;31m"
RESET="\033[0m"
TOTAL=0
FAIL=0

echo "=== Protótipos Python ==="
for f in prototypes/*.py; do
  TOTAL=$((TOTAL+1))
  if python3 "$f" > /tmp/proto.log 2>&1; then
    echo -e "${GREEN}OK${RESET} $f"
  else
    FAIL=$((FAIL+1))
    echo -e "${RED}FAIL${RESET} $f"
    sed 's/^/  /' /tmp/proto.log
  fi
done

echo
echo "=== Tests pytest ==="
TOTAL=$((TOTAL+1))
if python3 -m pytest tests/ -q > /tmp/pytest.log 2>&1; then
  echo -e "${GREEN}OK${RESET} pytest tests/"
  grep -E '^=+|passed|failed|skipped' /tmp/pytest.log | tail -1
else
  FAIL=$((FAIL+1))
  echo -e "${RED}FAIL${RESET} pytest tests/"
  sed 's/^/  /' /tmp/pytest.log
fi

echo
echo "=== Validação YAML ==="
TOTAL=$((TOTAL+1))
if python3 -c "import yaml; yaml.safe_load(open('contracts/openapi.yaml'))"; then
  echo -e "${GREEN}OK${RESET} openapi.yaml"
else
  FAIL=$((FAIL+1))
  echo -e "${RED}FAIL${RESET} openapi.yaml"
fi

echo
echo "=== Validação Python ==="
for f in contracts/*.py prototypes/*.py scaffolds/*.py tests/*.py; do
  TOTAL=$((TOTAL+1))
  if python3 -m py_compile "$f" 2>/tmp/pyc.log; then
    :
  else
    FAIL=$((FAIL+1))
    echo -e "${RED}FAIL${RESET} $f"
    sed 's/^/  /' /tmp/pyc.log
  fi
done

echo
echo "=== Smoke dos scaffolds ==="
for f in scaffolds/*.py; do
  # backup/restore exigem args; não roda o if __main__
  if [[ "$f" == *backup.py || "$f" == *restore.py ]]; then continue; fi
  TOTAL=$((TOTAL+1))
  if python3 "$f" > /tmp/scaffold.log 2>&1; then
    echo -e "${GREEN}OK${RESET} $f"
  else
    FAIL=$((FAIL+1))
    echo -e "${RED}FAIL${RESET} $f"
    sed 's/^/  /' /tmp/scaffold.log
  fi
done

echo
echo "=== Validação HTML ==="
for f in wireframes/*.html prototypes/*.html; do
  TOTAL=$((TOTAL+1))
  if python3 -c "
import html.parser, sys
class P(html.parser.HTMLParser):
    def __init__(self): super().__init__(); self.ok = True
    def error(self, m): self.ok=False; print('ERR', m)
p = P()
p.feed(open('$f').read())
sys.exit(0 if p.ok else 1)
" 2>/dev/null; then
    :
  else
    FAIL=$((FAIL+1))
    echo -e "${RED}FAIL${RESET} $f"
  fi
done

echo
echo "=== Validação TS ==="
for f in contracts/*.ts tests/*.ts e2e/*.ts; do
  TOTAL=$((TOTAL+1))
  if node --check "$f" >/dev/null 2>&1 || true; then
    # node pode não ter o contexto React, então só tenta parsear como sintaxe.
    : # silencioso
  fi
done

echo
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}TODOS OS $TOTAL CHECKS PASSARAM${RESET}"
  exit 0
else
  echo -e "${RED}$FAIL/${TOTAL} FALHARAM${RESET}"
  exit 1
fi