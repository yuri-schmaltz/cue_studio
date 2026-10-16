# Feature A34 — CapabilityMatrix por modelo/runtime/modo

**Origem:** Plano Executivo §7 Eixo 6 + Dossiê R04.
**Ciclo:** 4.
**Prioridade:** P1.
**Dependência:** nenhuma forte. Reaproveita `provenance.py` (A27).

## 1. Contexto

Dossiê seção 17 R04: matriz de capacidades reais por modelo/runtime/modo. Já existe parcialmente em `app/services/director_model_compat.py:187` (`director_audio_input_mode == "reference_manifest"`). Falta explicitar como API e testes.

## 2. Requisitos

### 2.1 Comportamento esperado

- Matriz `(model_id, runtime, mode) → set[Capability]` consultável.
- Capabilities: `text_to_video`, `image_to_video`, `first_last_frame`, `extend`, `audio_input`, `audio_generate`, `multi_window`, `lora_support`, `quantization`, `controlnet`, `upscale`, `outpaint`, `inpaint`, `ref2v`, `fl2va`.
- Endpoints REST:
  - `GET /api/v1/capabilities/models`
  - `GET /api/v1/capabilities/models/{id}/runtimes`
  - `GET /api/v1/capabilities/check?model=X&runtime=Y&cap=Z`
- UI: badge de capacidade por modelo no seletor; advertência se capability pedida não está disponível.
- Testes: matriz declarada vs runtime real; capability ausente dispara erro.
- Persistir matriz em `<app>/capabilities_matrix.json` versionado.

### 2.2 Fora de escopo

- Reescrever adapters dos modelos.
- Adicionar capacidades novas (reusar lista de A34).
- Inferência dinâmica (capabilities devem vir do manifesto do modelo).

## 3. Modelo de dados

```python
class Capability(str, Enum):
    TEXT_TO_VIDEO = "text_to_video"
    IMAGE_TO_VIDEO = "image_to_video"
    FIRST_LAST_FRAME = "first_last_frame"
    EXTEND = "extend"
    AUDIO_INPUT = "audio_input"
    AUDIO_GENERATE = "audio_generate"
    MULTI_WINDOW = "multi_window"
    LORA_SUPPORT = "lora_support"
    QUANTIZATION = "quantization"
    UPSCALE = "upscale"
    OUTPAINT = "outpaint"
    INPAINT = "inpaint"
    REF2V = "ref2v"
    FL2VA = "fl2va"

class Runtime(str, Enum):
    WAN_GP = "wan_gp"
    DIFFUSERS = "diffusers"
    COMFY = "comfy"

@dataclass(frozen=True)
class CapabilityEntry:
    model_id: str
    runtime: Runtime
    mode: str  # "t2v" | "i2v" | "extend" | "audio" | ...
    capabilities: frozenset[Capability]

class CapabilityMatrix:
    entries: list[CapabilityEntry]
    def for_model(self, model_id: str) -> list[CapabilityEntry]: ...
    def check(self, model_id: str, runtime: Runtime, mode: str, capability: Capability) -> bool: ...
```

## 4. Catálogo inicial (v2.5.2)

| Model | Runtime | Mode | Capabilities |
|---|---|---|---|
| minimax_h3_omni_pruned | wan_gp | t2v, audio | text_to_video, audio_generate, multi_window, lora_support, fl2va |
| minimax_h3_first_last | wan_gp | fl2v | first_last_frame, multi_window, lora_support |
| ltx25_distilled | wan_gp | t2v, i2v | text_to_video, image_to_video, multi_window, lora_support, outpaint |
| ltx25_dev | wan_gp | t2v, i2v | text_to_video, image_to_video, multi_window, lora_support |
| wan_2_2_5b | wan_gp | t2v | text_to_video, image_to_video, lora_support |
| wan_2_1_1_3b | wan_gp | t2v | text_to_video, image_to_video |
| scail2_14b_fast | wan_gp | animate | fl2va, lora_support |
| flux_2_klein_9b | diffusers | t2i | text_to_image, lora_support, upscale |
| qwen_image_edit | diffusers | edit | inpaint, outpaint |
| qwen3_tts | comfy | speech | audio_generate |
| kugelaudio | comfy | speech | audio_generate |
| ace_step_15_xl_sft | comfy | music | audio_generate |
| minimax_music3 | comfy | music | audio_generate |
| mmaudio | comfy | sfx | audio_generate |

## 5. Endpoints REST

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/capabilities/models` | Lista todos os modelos com capabilities |
| `GET` | `/api/v1/capabilities/models/{id}/runtimes` | Lista runtimes e modos |
| `GET` | `/api/v1/capabilities/check?model=X&runtime=Y&mode=Z&cap=W` | Boolean |

## 6. Critérios de aceite

- `pytest tests/test_capability_matrix.py -q` passa.
- 7 testes verdes no protótipo.
- UI mostra badge de capability por modelo.