# Feature A26c — Lockfile reproduzível por perfil (E0–E4)

**Origem:** expansão da frente A26 (dependências explícitas) proposta no `PLANO_EXECUTIVO_CUE_STUDIO.md` Apêndice D — "dependências versionadas (`pip-compile` + lockfile por ambiente) para garantir reprodutibilidade de builds".
**Ciclo:** 4 (mesmo ciclo de A25–A31/A34/R03); melhoria operacional de produto, não contratual.
**Prioridade:** P2 (qualidade de release / reprodutibilidade; baixo risco).
**Dependências:** nenhuma forte. Convive com `app/requirements.txt` (pinned) e `pyproject.toml` (runtime declarado). Convive com A29 (perfis E0–E4) — cada perfil vira um "lockfile target".

## 1. Contexto

Hoje o Cue Studio v2.5.2 declara dependências de duas formas:

- **`app/requirements.txt`** (126 linhas) — pins exatos com nota explícita: "If you need to upgrade, do it one package at a time and re-test Studio + Director end-to-end before committing. Do NOT loosen pins without testing."
- **`pyproject.toml`** — declara `cue-studio` e `cue` como scripts console, e mantém `requires-python = ">=3.10"` (sem pins de runtime).

Esse arranjo **funciona para o autor original** mas tem três lacunas verificadas por leitura do snapshot:

1. **Hashes ausentes.** Apenas versão está pinada; nada impede que `pip install` resolva para uma versão diferente de wheel quando o índice muda (problema conhecido na nota do `requirements.txt`: "HuggingFace tokenizers/accelerate, torch/torchcodec/xformers ABI").
2. **Sem perfil por hardware.** O mesmo arquivo `requirements.txt` serve máquina com 4 GB (E1) e máquina com 24 GB (E4). Mas o `a29_economy_profile.py` mostra que cada perfil E0–E4 tem VRAM/CUDA/family diferentes; nem todas as wheels são úteis para E0 (CPU-only) ou E1 (RTX 3050).
3. **Sem detecção de drift.** Quando o usuário roda `pip install -r app/requirements.txt` 30 dias depois e o índice do HuggingFace ou do ort-cuda mudou, ele recebe wheels potencialmente diferentes das testadas — sem aviso.

A26c ataca as três lacunas, **dentro da política atual `allowLegacyEdits: false`**: produz especificações e protótipos, sem alterar `app/requirements.txt` ou `pyproject.toml`.

A26c também fecha um risco transversal listado em `PLANO_EXECUTIVO_CUE_STUDIO.md` seção 10.2: "Cue Studio reescreve módulo estendido" e "Política Reversa muda" — porque torna a relação entre versão declarada e runtime observável por CI.

## 2. Requisitos

### 2.1 Lockfile canônico por perfil

Gerar **5 lockfiles** a partir de `app/requirements.txt`, um por perfil E0–E4:

| Arquivo | Perfil | VRAM | Plataforma-alvo |
|---|---|---:|---|
| `locks/E0.cpu-only.txt` | E0 | n/a | linux x86_64, sem CUDA |
| `locks/E1.4gb-3050.txt` | E1 | 4 GB | linux x86_64, CUDA 11.8 |
| `locks/E2.6-8gb.txt` | E2 | 6–8 GB | linux x86_64, CUDA 12.1 |
| `locks/E3.10-12gb.txt` | E3 | 10–12 GB | linux x86_64, CUDA 12.4 |
| `locks/E4.16-24gb.txt` | E4 | 16–24 GB | linux x86_64, CUDA 12.8 |

Formato: **`requirements.txt` com `--hash=sha256:...` por pacote**, mais marcadores de plataforma e ABI (PEP 600 / `--prefer-binary`). Compatível com `pip install --require-hashes -r locks/E2.6-8gb.txt` (modo estrito).

### 2.2 Manifest de origem (`locks/source-manifest.json`)

Cada lockfile acompanha um manifest que registra:

- `commit_sha` do Cue Studio quando o lockfile foi gerado.
- `pip_version` e `python_version` que produziu.
- `resolved_at` (ISO 8601).
- Lista de packages que foram **excluídos** do `requirements.txt` por serem CPU-only conflicting com o perfil (ex.: `xformers`, `bitsandbytes` em E0; `triton` em E1).
- Lista de packages **adicionados** só para o perfil (ex.: `--extra-index-url` ort-cuda-13-nightly desativado em E0).
- Hash do `app/requirements.txt` original (sha256 do arquivo).
- Hash do `pyproject.toml` original.

Garante auditabilidade: saber **exatamente** qual combinação de arquivos-fontes produziu cada lockfile.

### 2.3 Detecção de drift

Função pura: `compute_drift(observed_resolved: Requirements, expected_lock: Lock, source_manifest: Manifest) -> DriftReport`.

`DriftReport` indica:

- `missing`: pacotes no lock que `pip` não conseguiu resolver naquele ambiente.
- `version_drift`: pacote com versão diferente da esperada (major, minor ou patch).
- `hash_drift`: pacote instalado com sha256 diferente do lock.
- `extra`: pacotes instalados que não estão no lock (não bloqueante, registrado).
- `source_manifest_stale`: lock gerado a partir de `app/requirements.txt` mas o arquivo mudou.

### 2.4 Integração com A29

Cada perfil E0–E4 ganha:

- `locks/E{i}.<descrição>.txt`
- `locks/E{i}.source-manifest.json`
- Entrada no relatório A29 (`docs/benchmarks/economy_{profile}_YYYY-MM.md`) com o caminho do lockfile e o hash de origem.

A26c é **parte do que A29 precisa rodar offline** (sem ambiguidade de wheel); sem A26c, "obra de referência em GPU 6–8 GB" medida no E2 pode não ser reprodutível por outro usuário.

### 2.5 Política de upgrade

Tool **`a26c_upgrade_proposal(lock, new_requirements) -> UpgradeReport`** que:

- Recebe `app/requirements.txt` novo e lock atual.
- Classifica cada mudança em: `safe_minor` (ex.: bug-fix 1.2.3 → 1.2.4), `risky_minor` (1.2 → 1.3), `major` (1.x → 2.x), `dropped` (removido), `added` (novo).
- Bloqueia o CI se houver `major` ou `risky_minor` sem justificativa explícita no manifest.
- Não instala nada; só planeja.

### 2.6 Fora de escopo

- Reescrever `app/setup.py` (691 linhas). A26c só **consome** o que está pinado lá.
- Trocar `pip` por `uv` ou `poetry`. Tool roda em stdlib.
- Bloquear merges — apenas produzir relatórios e diff que o usuário decide aplicar.
- Publicar wheels próprios. Continua consumindo o índice público / ort-cuda-13-nightly.

## 3. Contrato

### 3.1 Dataclasses canônicas

```python
@dataclass(frozen=True)
class Requirement:
    name: str
    version_spec: str              # "==3.7.12" | ">=1.0,<2.0" | etc
    hashes: tuple[str, ...]        # sha256
    markers: tuple[str, ...]       # PEP 508 markers
    extras: tuple[str, ...]        # ["cuda12", "rocm"]
    index_url: Optional[str]       # ort-cuda-13-nightly etc

@dataclass(frozen=True)
class Lock:
    profile: str                   # "E2"
    platform: str                  # "linux-x86_64-cuda12.1"
    python_version: str            # "3.11"
    generated_at: str              # ISO 8601
    requirements: tuple[Requirement, ...]
    extra_indexes: tuple[str, ...]
    excludes_from_source: tuple[str, ...]
    adds_for_profile: tuple[str, ...]

@dataclass(frozen=True)
class SourceManifest:
    profile: str
    lock_sha256: str
    requirements_txt_sha256: str   # sha256 do app/requirements.txt original
    pyproject_sha256: str
    commit_sha: str
    pip_version: str
    python_version: str
    resolved_at: str
    notes: tuple[str, ...]

@dataclass(frozen=True)
class DriftReport:
    missing: tuple[str, ...]                       # pacote sumiu
    version_drift: tuple[tuple[str, str, str], ...]  # (pkg, expected, observed)
    hash_drift: tuple[tuple[str, str, str], ...]     # (pkg, expected_sha, observed_sha)
    extras: tuple[str, ...]                          # instalados sem lock
    source_manifest_stale: bool                     # requirements_txt mudou
    ok: bool

@dataclass(frozen=True)
class UpgradeProposal:
    safe_minor: tuple[str, ...]      # versions a aceitar com confiança
    risky_minor: tuple[str, ...]
    major: tuple[str, ...]
    dropped: tuple[str, ...]
    added: tuple[str, ...]
    block_merge: bool
    summary: str
```

### 3.2 Função principal

```python
def generate_lock(
    *,
    profile: str,
    source_requirements: Path,
    source_pyproject: Path,
    profile_additions: dict[str, tuple[str, ...]],
    profile_excludes: tuple[str, ...],
    extra_indexes: tuple[str, ...],
    out_dir: Path,
    pip_version: str,
    python_version: str,
    commit_sha: str,
) -> tuple[Lock, SourceManifest]:
    """Sintetiza um lock canônico a partir de sources oficiais.
    Determinístico (sort por nome) e validável.
    """
```

### 3.3 Função de validação

```python
def validate_lock(
    lock: Lock, manifest: SourceManifest,
    observed_requirements: tuple[Requirement, ...],
    observed_requirements_txt_sha: str,
) -> DriftReport:
    """Compara lock canônico com o que o ambiente resolveu.
    ok=True somente se missing=() ∧ version_drift=() ∧
    hash_drift=() ∧ source_manifest_stale=False.
    """
```

### 3.4 Função de upgrade

```python
def upgrade_proposal(
    *,
    current_lock: Lock,
    new_requirements_txt: str,
    new_pyproject_sha: str,
    previous_requirements_txt: str,
) -> UpgradeProposal:
    """Classifica mudanças do requirements.txt / pyproject.
    Bloqueia merge se houver major sem justificativa.
    """
```

## 4. Plano

1. **Protótipo** `prototypes/a26c_lockfile_reproducible.py`:
   - Modelo de dados (Requirement, Lock, SourceManifest, DriftReport, UpgradeProposal).
   - Parser determinístico de `requirements.txt` (estende estilo `pip-compile`).
   - Função `parse_requirements_txt(text) -> tuple[Requirement, ...]`.
   - Função `sha256_file(path) -> str`.
   - `generate_lock(...)` com adições e exclusões do perfil.
   - `validate_lock(...)` retornando `DriftReport`.
   - `upgrade_proposal(...)` com classificação segura/risco/major.
   - 8 testes: parse de requirements com comment/pin/hash, geração de lock determinística, drift completo em 4 campos, hash drift isolado, missing package, source manifest stale, upgrade safe_minor, upgrade com major que bloqueia.
2. **Smoke** `prototypes/integration_smoke.py`: passo 13 novo exercitando A26c em fluxo simplificado (parse → lock → drift → upgrade) contra um `requirements.txt` miniatura inline.
3. **Atualizar** `_reversa_forward/plano-2026-10-04/README.md` (seção "Ciclo 4" + bullet no mapeamento rápido).
4. **Atualizar** `_reversa_forward/plano-2026-10-04/HANDOFF.md` (nova linha em "Material pronto" + nova seção datada "Lockfile reproduzível A26c (2026-10-16)").
5. **Atualizar** `PLANO_EXECUTIVO_CUE_STUDIO.md` (Apêndice B adicionar A26c como ✅, Apêndice D novo heading "Direções entregues", smoke para 13/13).
6. **Política `allowLegacyEdits: false` mantida**: nenhum arquivo em `app/`, `ui/`, `tests/`, `scripts/`, `docs/` é tocado.

### 4.1 Decisão sobre geração real dos lockfiles

A geração real (rodar `pip-compile` em 5 perfis E0–E4) exige rede, GPU opcional e tempo (15–45 min por perfil). **Não está no escopo deste A26c.** A spec e o protótipo definem o formato canônico; usuário roda o gerador localmente quando quiser materializar.

## 5. Testes de aceitação

- `python3 _reversa_forward/plano-2026-10-04/prototypes/a26c_lockfile_reproducible.py` roda **8/8** checks OK.
- `python3 _reversa_forward/plano-2026-10-04/prototypes/integration_smoke.py` agora roda **13/13** (passo 13 novo para A26c).
- `bash _reversa_forward/plano-2026-10-04/scripts/run_all_prototypes.sh` permanece em **≥ 68/75** (acréscimo do A26b + A26c + smoke).
- Política `allowLegacyEdits: false` continua intacta: nenhum arquivo em `app/`, `ui/`, `tests/`, `scripts/`, `docs/` é tocado.

## 6. Critérios de pronto

- Spec publicada em `_reversa_forward/plano-2026-10-04/42-feature-a26c-lockfile-reproducible-builds.md`.
- Protótipo cobre 8 cenários; **8/8** OK.
- Smoke integrado estendido para 13/13.
- `README.md`, `HANDOFF.md` e `PLANO_EXECUTIVO_CUE_STUDIO.md` atualizados.
- Geração real dos lockfiles por perfil **não está** no escopo desta entrega.

## 7. Riscos

- **Risco:** hash drift dispara falso positivo quando wheel `manylinux2014` é substituido por `manylinux_2_28` sem mudar versão. **Mitigação:** registro do wheel filename esperado no lock; comparação por (name, version, sha256) **e** filename.
- **Risco:** usuário roda `pip-compile` e gera lockfile que diverge do gerado por nosso protótipo. **Mitigação:** spec descreve o **formato canônico**, não o gerador; aceitamos qualquer lock que respeite Requirement[] + Manifest[]. O gerador oficial fica como decisão separada.
- **Risco:** extra index (`ort-cuda-13-nightly`) muda nome. **Mitigação:** `extra_indexes` é dado explícito do perfil; ProfileConfig é o ponto único de mudança.
- **Risco:** drift legítimo após upgrade (1.2 → 1.3 com teste) é reportado como blocker. **Mitigação:** `UpgradeProposal.block_merge` aceita justificativa em manifest.notes quando classificada como `risky_minor` com teste verde.
- **Risco:** o protótipo vira "outro gerador" e duplica `pip-compile`. **Mitigação:** escopo do protótipo é **validação** de lockfiles já gerados externamente, não geração completa de resolução de dependências (que requer network e solver do pip).

## 8. Anexo — Exemplo de lockfile E2 (formato)

```text
# Profile: E2 (6–8 GB VRAM)
# Platform: linux-x86_64-cuda12.1
# Python: 3.11
# Generated at: 2026-10-16T12:34:56Z
# Source requirements.txt sha256: 4b9...e1
# Source pyproject.toml sha256: c1d...7a
# Lock sha256: 2f3...a8
# Commit: bf50b33
# Generator: a26c.prototypes/a26c_lockfile_reproducible.py (mock)
#
# Adicionar ao instalar:
--extra-index-url https://download.pytorch.org/whl/cu121
--extra-index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/ort-cuda-13-nightly/pypi/simple/

mmgp==3.7.12 \
    --hash=sha256:ab12... \
    --hash=sha256:34ef... \
    ; python_version >= "3.10" and sys_platform == "linux"

diffusers==0.36.0 \
    --hash=sha256:9c8d... \
    ; python_version >= "3.10"

# ...outros pacotes a partir de app/requirements.txt...
```

Por aderência ao formato `pip-compile`, cada pacote aparece com versão pinada, hashes e markers PEP 508. Linhas extras (`# Profile:`, `# Platform:`, etc.) são só metadados legíveis por humanos; `pip install --require-hashes` ignora-as.

---

**Esta spec expande A26 (dependências explícitas) e contribui para fechar o risco transversal "Cue Studio reescreve módulo estendido" listado em `PLANO_EXECUTIVO_CUE_STUDIO.md` seção 10.2.**
