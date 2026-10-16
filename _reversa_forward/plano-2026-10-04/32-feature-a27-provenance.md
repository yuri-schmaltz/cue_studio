# Feature A27 — ProvenanceManifest: versionamento integral da produção

**Origem:** especificação CineLocal v1.0, eixo 4 (seções 7, 11, 13 e 24 do documento original), atualizado após varredura do código em 2026-10-15.
**Ciclo:** 4 (complementar a A01–A24 e A25).
**Prioridade:** P1 (fundação para A28 — métricas por modelo/perfil — e A30 — auditoria offline).
**Dependência:** nenhuma forte. Convivência com `editor_projects.py:1777` (sidecar) e `checkpoint_compatibility.py:359` (receipt).

## 1. Contexto

A especificação CineLocal exige que cada `Take` tenha um **manifesto de proveniência completo e verificável** que registre: referências exatas (com SHA-256), modelo e quantização (com SHA-256), adapter e versão, profile de hardware, seed, parâmetros numéricos, LoRAs (com SHA-256), runtime Python/PyTorch/CUDA, hashes de sidecars e artefatos resultantes. O manifesto deve permitir rastreabilidade total (não reprodutibilidade bit a bit, que depende de hardware e kernels) e auditoria.

**Estado atual verificado em 2026-10-15** (commit `main`, Cue Studio v2.5.2):

- `app/services/editor_projects.py:1777` define `sidecar` (`.meta.json`) por artefato de export do Editor, com `generation_mode`, `tool`, `params` (incluindo `model_type`, `edit_sub_mode`, `editor_project_id`, `editor_workspace`) e `created_at`.
- `app/services/checkpoint_compatibility.py:359` retorna receipt serializável com validação de arquitetura do checkpoint.
- `app/services/director_model_compat.py:187` menciona `director_audio_input_mode == "reference_manifest"`.
- `app/shared/api.py:270` tem `submit_manifest` que envia lista de settings.
- `app/wgp.py:1521` registra `queue_manifest` (lista de jobs da fila com parâmetros).
- `app/models/TTS/minimax_music3/pipeline.py:169` consulta "Maestro's known wheel architecture manifest before Music3 opts into FA2".
- `app/launch.py:162` carrega `MINIMAX_H3_TURBO_MANIFEST`.

**O que falta** (lacuna concreta):

1. **Não existe `ProvenanceManifest` unificado por Take** que agregue modelo, LoRAs, refs, parâmetros, runtime e artefatos em um único arquivo validável.
2. **SHA-256 não é calculado** nem verificado para artefatos de saída nem para pesos de modelo/LoRA referenciados.
3. **Não há validação na importação**: ao abrir um Take de outra máquina, o sistema não detecta pesos faltantes, modelos adulterados ou sidecars desatualizados.
4. **Não há export/import de bundle** portátil (manifesto + sidecars + artefatos).

## 2. Requisitos

### 2.1 Comportamento esperado

- Cada Take bem-sucedido passa a ter um **`ProvenanceManifest` versionado** em `<output>.provenance.json`, ao lado do sidecar existente `<output>.meta.json`.
- O manifesto é gerado **automaticamente** quando o Take passa de `running` para `succeeded` (em `app/services/job_lifecycle.py`).
- O manifesto calcula **SHA-256 real** sobre os bytes de cada artefato e cada peso referenciado (modelo, LoRA, referência visual, áudio de entrada).
- Ao abrir um Take (Load Settings / Studio / Director), o sistema verifica o manifesto e classifica o status em:
  - **`verified`** (todos os hashes batem, todos os assets presentes).
  - **`needs_review`** (algum asset mudou de hash mas existe; pesos incompatíveis).
  - **`incomplete`** (algum asset não está presente; falta baixar ou relinkar).
  - **`corrupt`** (algum sidecar/manifesto está corrompido ou adulterado).
- Há uma **política de validação** configurável por produção (em `app/services/director/schema.py` ou settings):
  - `strict`: bloqueia Take `incomplete` / `corrupt`; só permite `verified` e `needs_review` com aprovação manual.
  - `warn`: mostra warning, mas permite usar o Take.
  - `off`: pula validação (default em projetos legados).
- Existe uma ação **Exportar bundle** que cria `.tar.gz` com `<take>.mp4` + `<take>.meta.json` + `<take>.provenance.json` + (opcional) refs externas, para mover entre máquinas.
- Existe uma ação **Importar bundle** que valida hashes, oferece baixar assets faltantes (com aceite de licença) e cria symlink/hardlink ou cópia local.
- O **Storage Manager** (`v1.4`) consulta o manifesto antes de deletar um modelo ou LoRA, e lista Takes afetados.
- **Backward compatibility**: Takes antigos sem `.provenance.json` continuam funcionando; o primeiro save gera manifesto retroativo a partir do sidecar e do `queue_manifest` em `wgp.py`.

### 2.2 Fora de escopo

- Reprocessar manifestos já emitidos (apenas emitir para novos Takes + ação manual de retrofill).
- Garantir reprodutibilidade bit a bit entre máquinas (continua impossível; manifesto registra intenção, não garante resultado).
- Substituir `editor_projects.py:1777` `sidecar`; o manifesto **convive** lado a lado.
- Implementar busca online de pesos faltantes (apenas sugerir URLs registradas no catálogo).

## 3. Contrato

### 3.1 Schema

```python
# app/services/shared/provenance.py
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field, ConfigDict

PROVENANCE_SCHEMA_VERSION = "1.0"

class AssetRef(BaseModel):
    """Referência a qualquer arquivo envolvido no Take."""
    model_config = ConfigDict(extra="forbid")
    asset_id: str              # ex.: "asset_032", "model_h3_pruned_20b"
    role: Literal[
        "checkpoint", "lora", "vae", "text_encoder",
        "first_frame", "last_frame", "reference_image",
        "reference_audio", "soundtrack", "sidecar_meta", "output",
    ]
    sha256: str                # hex de 64 chars
    size_bytes: int            # >= 0
    relative_path: str         # caminho relativo ao project_dir
    source_url: Optional[str] = None      # onde baixar (se faltar)
    license_id: Optional[str] = None       # ex.: "wgp_nc_1.1", "apache-2.0"

class LoRARef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lora_id: str
    sha256: str
    strength: float = Field(ge=0.0, le=2.0)
    trigger_phrase: Optional[str] = None

class ModelRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str
    sha256: str
    quantization: Literal["fp8", "fp16", "bf16", "int8", "int4", "gguf_q4", "gguf_q2", "nvfp4_awq", "quanto_int8"]
    precision: Literal["full", "pruned", "distilled"]

class HardwareProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gpu_name: str
    gpu_vram_mb: int
    driver_version: Optional[str] = None
    cuda_version: Optional[str] = None
    system_ram_mb: int
    os: Literal["windows", "linux", "macos", "other"]

class RuntimeRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    python: str                # ex.: "3.11.14"
    pytorch: str               # ex.: "2.10.0"
    cuda: Optional[str] = None
    attention_backend: Optional[str] = None
    mmgp_version: Optional[str] = None
    cue_studio_revision: str   # git SHA do checkout

class ProvenanceManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = PROVENANCE_SCHEMA_VERSION
    take_id: str
    project_id: str
    generation_timestamp: str  # ISO-8601 UTC
    adapter_id: str            # ex.: "h3_omni_pruned", "ltx25_distilled"
    adapter_revision: str      # git SHA do Cue Studio quando foi gerado
    model: ModelRef
    loras: list[LoRARef] = Field(default_factory=list)
    references: list[AssetRef] = Field(default_factory=list)
    audio_inputs: list[AssetRef] = Field(default_factory=list)
    parameters: dict           # steps, guidance, sampler, scheduler, seed, etc.
    seed: int
    profile: HardwareProfile
    runtime: RuntimeRef
    artifacts: list[AssetRef]  # outputs com sha256
    sidecars: dict[str, str]   # nome → sha256 (.meta.json, .shot_ir.json etc.)
    redaction_policy: Literal["none", "strip_personal", "hash_paths"]
```

### 3.2 Validação (modos)

```python
# app/services/shared/provenance.py
class ValidationStatus(str, Enum):
    VERIFIED = "verified"
    NEEDS_REVIEW = "needs_review"
    INCOMPLETE = "incomplete"
    CORRUPT = "corrupt"

class ValidationPolicy(str, Enum):
    STRICT = "strict"
    WARN = "warn"
    OFF = "off"

def validate_manifest(
    manifest: ProvenanceManifest,
    project_dir: Path,
) -> tuple[ValidationStatus, list[str]]:
    """Compara manifest contra disco; retorna status e lista de issues."""
```

### 3.3 Endpoints REST

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/takes/{id}/provenance` | Lê o manifesto (legado gera retroativo) |
| `POST` | `/api/v1/takes/{id}/provenance/revalidate` | Força revalidação |
| `GET` | `/api/v1/takes/{id}/provenance/bundle?include_refs=true` | Download `.tar.gz` |
| `POST` | `/api/v1/takes/{id}/provenance/bundle` | Upload de bundle para importar |

### 3.4 Storage Manager integration

Antes de deletar modelo/LoRA, o Storage Manager chama `find_takes_using(asset_sha256)` e exibe:

```
Modelo "MiniMax-H3-Pruned-20B" (sha256:abc...) é usado por:
- 12 Takes (3 Productions, 2 Workspaces)
Tem certeza que deseja prosseguir?
[Cancelar] [Exportar manifestos antes] [Deletar mesmo assim]
```

## 4. Plano

1. **Criar `app/services/shared/provenance.py`** com:
   - Os modelos Pydantic acima.
   - Função `compute_sha256(path: Path) -> str`.
   - Função `validate_manifest(manifest, project_dir) -> (status, issues)`.
   - Função `emit_provenance(take_id, project_dir, adapter_id, model_ref, loras, refs, audio, params, profile, runtime, artifacts, sidecars) -> ProvenanceManifest` que calcula SHA-256 e escreve `<output>.provenance.json`.
   - Função `retrofill_manifest(take_dir, project_dir) -> ProvenanceManifest` para Takes antigos.
2. **Estender `app/services/job_lifecycle.py`** para chamar `emit_provenance` quando o Take transita para `succeeded`. Reusar os mesmos hooks que geram o sidecar atual em `editor_projects.py`.
3. **Estender `app/services/editor_projects.py:1777`** para que, ao exportar um timeline, o manifesto seja gerado para cada Take referenciado e listado em `params.linked_takes`.
4. **Estender `app/services/storage/manager.py`** (verificar caminho exato) para consultar manifestos antes de deletar pesos.
5. **Estender `app/routers/productions.py`** (ou criar `app/routers/provenance.py` se preferir) com as 4 rotas acima.
6. **UI**: criar `ui/src/components/ProvenancePanel/` — card lateral no Take com tabela (Modelo / Quantização / LoRAs / Seed / Runtime) e badge de status. Botão "Exportar bundle" e "Importar bundle".
7. **Política de validação**: ler/parsear de `app/settings/projects_provenance.json` (ou campo novo em `app/services/workspace_setup.py`); default por produção.
8. **Testes**:
   - `tests/test_provenance.py` — schema, compute_sha256, validate, retrofill.
   - `tests/test_provenance_bundle.py` — round-trip `.tar.gz`, validação cruzada.
   - `tests/test_storage_manager_integration.py` — delete bloqueado quando asset é referenciado.
9. **Documentação**: `docs/PROVENANCE.md` (após liberação de `allowedPaths` em `docs/**`).
10. **Backward compatibility**: detector de ausência de `.provenance.json`; gera retroativo sob demanda ao abrir o Take.
11. **Release notes**: entrada dedicada na próxima minor (v2.6 ou v3.0).

## 5. Testes de aceitação

- `pytest tests/test_provenance.py tests/test_provenance_bundle.py -q` passa.
- Gerar um Take novo: o arquivo `<output>.provenance.json` é criado com SHA-256 correto (verificável com `sha256sum` no terminal).
- Adulterar 1 byte do artefato: `validate_manifest` retorna `CORRUPT`.
- Mover o arquivo de pesos do modelo para outro diretório: `validate_manifest` retorna `INCOMPLETE` com lista clara de assets faltantes e URLs.
- Importar um bundle `.tar.gz`: o sistema cria sidecar + manifest + output no destino, valida hashes, marca `verified` se OK.
- Abrir um projeto v2.5.2 sem manifestos: a UI mostra badge "manifesto ausente" nos Takes e oferece "Gerar retroativo".
- Storage Manager: tentar deletar modelo usado por 12 Takes → modal lista os 12 Takes + oferece exportar manifestos antes.
- Política `strict`: Take `incomplete` bloqueado com mensagem clara.

## 6. Critérios de pronto

- `docs/PROVENANCE.md` publicado.
- Schema versionado e validável em CI.
- UI do ProvenancePanel utilizável em 1280 px e 390 px.
- Bundle `.tar.gz` com manifesto + sidecar + artefato round-trip em 3 tamanhos diferentes (pequeno / médio / 6 GB).
- Storage Manager integration coberta por teste.
- Backward compatibility demonstrada com projeto v2.5.2 aberto e salvo em v2.6+.
- Release notes redigidas.

## 7. Riscos

- **Risco:** SHA-256 sobre pesos de modelo grandes (10–20 GB) é lento. **Mitigação:** calcular em background ao baixar o peso (não no momento da geração); cachear hash por `path + mtime + size`.
- **Risco:** manifestos grandes inflam o filesystem. **Mitigação:** separar `ProvenanceManifest` (sempre presente, leve) de `ProvenanceBundle` (`.tar.gz` sob demanda).
- **Risco:** privacidade (manifesto contém paths absolutos, seeds, exato runtime). **Mitigação:** campo `redaction_policy` + sanitização no export; oferecer `strip_personal` por padrão em exports públicos.
- **Risco:** Storage Manager pode bloquear deleções legítimas (caches antigos). **Mitigação:** flag "permitir purge de assets não usados em Takes approved"; detecta por query reversa.
- **Risco:** a verificação de hash em todo Load Settings custa tempo perceptível. **Mitigação:** verificar apenas o hash do output; hashes de pesos são cacheados; modo `off` para projetos grandes.
- **Risco:** dependência da liberação de `allowedPaths` trava o merge. **Mitigação:** scaffold isolado em `contracts/` e `protótipos/` valida a estratégia antes da aplicação real; convive com paths já liberados.

## 8. Anexo — vocabulário controlado de adapter_id

```
adapter_id valores conhecidos (v2.5.2):
- h3_omni_pruned
- h3_omni_full
- h3_first_last_pruned
- h3_first_last_full
- ltx25_distilled
- ltx25_dev
- ltx23_distilled
- ltx_video
- wan_2_2_ti2v_5b
- wan_2_1_1_3b
- scail2_14b_fast
- scail2_14b
- flux_2_klein_9b
- krea_2_raw
- krea_2_turbo
- qwen_image_edit
- hidream
- z_image_controlnet
- kandinsky5
- ideogram4
- longcat
- minimax_music3
- ace_step_15_xl_sft
- qwen3_tts
- kugelaudio
- mmaudio
```

Esse vocabulário é informativo; `ProvenanceManifest.adapter_id` aceita string livre (validada por catálogo opcional).