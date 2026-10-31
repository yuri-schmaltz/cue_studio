# Instalação verificada e limites — 30/10/2026

## UI

Use Node admitido em `ui/package.json`: série 22 a partir de 22.12, série 24, ou >=26. Node 18 não atende às dependências atuais. O CI usa Node 22.

```bash
cd ui
npm ci
npm run build
npm run lint
npm test
npm run test:store
npm run test:control
```

Build verifica tipos, emite assets e reprova chunks JavaScript maiores que 220.000 bytes. Não remover o gate para acomodar regressões.

## Runtime desta máquina

Python 3.11.18, Linux x86_64, RTX 3060 12 GB, driver 595.99.02, PyTorch 2.10.0+cu130. `app/env` foi criado nesta rodada com `uv 0.13.6`, sem alterar ambiente pessoal preexistente.

O [lock E3 verificado nesta plataforma](../app/locks/E3.cuda130-py311.txt) contém dependências transitivas fixadas, índices e hashes. As [constraints](../app/locks/E3.cuda130-py311.constraints.txt) registram versões da instalação inicial e o rebuild explícito de empacotamento do decord. Não representam CPU, Windows ou CUDA 12.

Primeiro gere o wheel local: `python scripts/build_decord_wheel.py`.

Geração: `uv pip compile app/requirements.txt --constraint app/locks/E3.cuda130-py311.constraints.txt --python app/env/bin/python --extra-index-url https://download.pytorch.org/whl/cu130 --index-strategy unsafe-best-match --find-links app/.cache/runtime-wheels --emit-index-url --generate-hashes --output-file app/locks/E3.cuda130-py311.txt`.

Depois execute `python scripts/normalize_lock_hashes.py app/locks/E3.cuda130-py311.txt`: o índice nightly anuncia MD5 e SHA-256 juntos; o normalizador remove somente MD5 e recusa qualquer requisito que fique sem SHA-256.

`unsafe-best-match` encontra pins exatos quando o índice PyTorch oferece outro pin de pacote auxiliar. O lock fecha o resultado por versões e hashes; não usar a política para atualizações abertas.

Instalação independente executada:

```bash
python scripts/build_decord_wheel.py
uv venv --python 3.11 app/.cache/validation-2026-10-30/locked-env
uv pip sync --python app/.cache/validation-2026-10-30/locked-env/bin/python --require-hashes --index-strategy unsafe-best-match --find-links app/.cache/runtime-wheels app/locks/E3.cuda130-py311.txt
```

Resultado: 300 pacotes instalados; imports reais de PyTorch/CUDA, decord, FastAPI, Transformers e OpenCV aprovados. Fontes e hashes: [source-manifest.json](../app/locks/source-manifest.json).

### Empacotamento corrigido do decord

O wheel público `decord==0.6.0` é distribuído como Python 3 genérico, mas declara internamente a tag CPython 3.6. Ele usa `libdecord.so` via ctypes e não contém extensão CPython. O script `scripts/build_decord_wheel.py` verifica o SHA-256 original e gera `decord==0.6.0+cue1`, corrigindo apenas a versão de distribuição, a tag WHEEL e o RECORD. A versão local identifica a mudança, sem editar metadados de um pacote instalado às escondidas.

O rebuild é determinístico (ZIP sem compressão, timestamps/ordem fixos). O lock exige seu SHA-256. Seus **37 arquivos de runtime são idênticos** aos originais; import, decodificação real de 8 frames/64x64 RGB e `uv pip check` passaram no segundo ambiente, com 300 pacotes compatíveis. Bibliotecas, código e licença do upstream são preservados.

Não versionar o wheel ou diretórios de ambiente: o script os reconstrói sob `app/.cache/`. Passe `--find-links` pela CLI, como acima; uv não aceita esse caminho relativo emitido dentro do próprio lockfile.

### Perfis E0–E4 desta revisão

| Perfil | Lock | Runtime | Evidência nesta máquina |
|---|---|---|---|
| E0 | `app/locks/E0.cpu-only.txt` | PyTorch CPU, 282 pacotes | instalação estrita, compatibilidade, boot e export software |
| E1 / 4 GB | `app/locks/E1.4gb-3050.txt` | CUDA 13, 300 pacotes | instalação estrita, compatibilidade e imports |
| E2 / 6–8 GB | `app/locks/E2.6-8gb.txt` | CUDA 13, 300 pacotes | instalação estrita, compatibilidade e imports |
| E3 / 10–12 GB | `app/locks/E3.cuda130-py311.txt` | CUDA 13, 300 pacotes | instalação, imports e geração real; aprovação do filme pendente |
| E4 / 16–24 GB | `app/locks/E4.16-24gb.txt` | CUDA 13, 300 pacotes | instalação estrita, compatibilidade e imports |

Os cinco ambientes são separados. Instalação usa os mesmos comandos `uv venv` / `uv pip sync --require-hashes --find-links ...`, substituindo ambiente e lock. Execute `uv pip check --python CAMINHO/bin/python` após o sync.

Os perfis GPU compartilham **a mesma ABI atual** (torch 2.10.0+cu130). VRAM define orçamento de modelos/offload, não uma versão distinta do PyTorch. A proposta histórica A26c associava E1/E2/E3/E4 a CUDA 11.8/12.1/12.4/12.8; esses alvos históricos **não são homologados** pelos locks atuais. Não instalar os locks desta revisão em drivers incompatíveis com CUDA 13. Os benchmarks nas GPUs de 4, 6–8 e 16–24 GB continuam pendentes; somente RTX 3060 12 GB foi usada aqui.

E0 deriva de `app/requirements.txt` em `app/locks/requirements.E0.in`: remove índice/distribuição ONNX GPU, usa `rembg[cpu]` e fixa torch/vision/audio CPU. Não contém distribuições NVIDIA. O preflight HTTP informa corretamente que geração requer CUDA. Exportação usa explicitamente `encoder=software`; mídia determinística desse teste verifica instalação/editor e não faz parte da obra F2. O primeiro export revelou 23 quadros em vez de 24; a correção tem renders de regressão a 24/30/60 fps.

[installation-evidence.json](../app/locks/installation-evidence.json) registra contagens/versões verificadas e o hash do export CPU correto. Cada perfil possui `E{i}.source-manifest.json`, compatível com `SourceManifest` de `app/services/lockfile.py`. O índice global vincula também hashes das constraints e inputs. `python scripts/verify_runtime_locks.py` verifica os cinco locks, pins, hashes e origem sem instalar; o CI executa esse gate.

## Validação

```bash
CUDA_VISIBLE_DEVICES='' app/env/bin/python -m pytest -q
CUDA_VISIBLE_DEVICES='' app/env/bin/python -m pytest tests/test_smoke_imports.py -m smoke -q
```

Ocultar CUDA se aplica apenas à suíte CPU. Não fazê-lo no backend/gate F2. Navegador exige Playwright/Chromium e URLs explícitas; obra real usa `CUE_RUN_REAL_MODELS=1` e `CUE_F2_CONFIG`, conforme [procedimento](REFERENCE_FILM_VALIDATION.md).
