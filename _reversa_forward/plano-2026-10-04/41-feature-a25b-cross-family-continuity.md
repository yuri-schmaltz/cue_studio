# Feature A25b — Continuidade estruturada entre famílias (R10)

**Origem:** expansão de A25 (Shot IR + continuity check). Mapeamento do achado **R10** do Dossiê de Retomada v2.0 (16/10/2026): *"criar adapter genérico de continuity para Wan/LTX/Hunyuan, análogo ao `Picture N` labels do H3, agnóstico de modelo"*.
**Ciclo:** 4 (mesmo ciclo de A25/A26/A27/A28/A29/A30/A31/A34/R03).
**Prioridade:** P2 (expansão incremental; agenda de release v2.6.x ou v3.0).
**Dependências:** A25 (Shot IR canônico já está disponível em `prototypes/a25_shot_ir.py`).

## 1. Contexto

A25 introduziu um **Shot IR canônico** (`ShotIR`, `CharacterInShot`, `Environment`, etc.) e um **continuity check** agnóstico de modelo (`check_sequence`). Isso resolveu lacunas internas do H3 e abriu caminho para o resto.

O que **A25b** ataca:

- O H3 tem um caminho próprio de continuidade:
  - `app/services/h3_story_ledger.py` v24 mantém `subject_continuity`, `setting_continuity`, `visual_continuity`.
  - `_infer_h3_blocking_contract(...)` monta o payload H3-Omni com `Picture N` labels (referência explícita a imagem gerada).
  - H3-Omni aceita `audio_input` e bindings exatos `Subject/Speaker` (v2.0.0).
- **Wan, LTX, LTX25 e Hunyuan NÃO têm** nada equivalente:
  - LTX-family usa `multi_window` com `extend_previous` para encadear shots.
  - Wan-family prefere `first_last_frame` (fl2v) e `image_to_video` com referência visual.
  - Hunyuan-hyvideo ainda não tem helper específico, mas o usuário escolhe `i2v` com ref.
- Hoje, **planejamento do Director** assume "qualquer modelo pode dar continuidade", mas a continuidade real é resolvida por adapter específico de cada modelo que **não existe** para Wan/LTX/Hunyuan.
- O usuário acaba descobrindo o problema **quando o vídeo sai errado** (inversão de figurino, ação não terminada).

A25b **fecha o R10** oferecendo:

1. **Interface abstrata** `ContinuityAdapter` com 3 métodos puros: `extract_state`, `infer_blocking_contract`, `apply_continuity`.
2. **Adapter por família** implementado como estratégia isolada; cada um com sua própria regra de como o estado do Shot anterior vira input para o próximo Shot.
3. **Registry** que seleciona adapter por `model_id` e `runtime`.
4. **Política de fallback** quando o adapter nativo não cobre o modelo: cai para `INDEPENDENT` (corte frio) ou usa o Shot IR canônico como conditioning para o prompt.

## 2. Requisitos

### 2.1 Interface `ContinuityAdapter`

```python
class ContinuityAdapter(ABC):
    family: ModelFamily

    @abstractmethod
    def extract_state(
        self, previous_output: PreviousShotOutput, sidecar_dir: Path
    ) -> ShotIR:
        """Extrai do output do Shot anterior um Shot IR canônico."""

    @abstractmethod
    def infer_blocking_contract(
        self, shot_ir: ShotIR, bible_refs: StoryBibleRefs | None = None
    ) -> BlockingContract:
        """Infere o contrato de bloqueio: o que precisa estar idêntico no próximo Shot."""

    @abstractmethod
    def apply_continuity(
        self,
        next_shot_ir: ShotIR,
        contract: BlockingContract,
        previous_state: ShotIR,
    ) -> ContinuationStrategy:
        """Materializa a estratégia de continuidade + payload concreto para o renderer."""
```

`ContinuationStrategy` carrega:

- `mode`: `first_last_frame` | `extend_previous` | `picture_n_reference` | `independent` | `subject_binding`.
- `payload`: dicionário específico por família (refs, last_frame_path, picture_n_index, etc.).
- `confidence`: 0.0–1.0 (0 = sem info; 1 = totalmente determinado).

### 2.2 Adapters mínimos viáveis (MVP)

| Família | `extract_state` lê | `infer_blocking_contract` retorna | `apply_continuity` produz |
|---|---|---|---|
| **H3 (wan)** | `h3_story_ledger` sidecar + último frame PNG | `subject_continuity` + `Picture N` se H3-Omni | `{mode: "picture_n_reference", payload: {picture_n: N, subject_id: ...}, confidence: 0.9}` |
| **H3 Omni** | idem + bindings de áudio | idem + `speaker_id` | `{mode: "subject_binding", payload: {subject_ref, speaker_ref}, confidence: 0.95}` |
| **LTX / LTX25** | último frame + state_info da janela multi-window | `subject_continuity` simplificado + `extend_targets` | `{mode: "extend_previous", payload: {extend_frames: 24, target_window: ...}, confidence: 0.85}` |
| **Wan** | primeiro/último frame + ref image | nenhuma continuidade automática além do ref | `{mode: "first_last_frame", payload: {ref_image_path, last_frame_path}, confidence: 0.8}` |
| **Hunyuan** | primeiro/último frame | nenhuma automática | `{mode: "first_last_frame", payload: {ref_image_path}, confidence: 0.7}` |
| **Fallback / desconhecida** | nada | `subject_continuity` mínimo (apenas subject_id) | `{mode: "independent", payload: {}, confidence: 0.0}` |

### 2.3 Política de fallback (regra explícita)

Quando `apply_continuity` não consegue produzir uma referência confiável:

1. Se existe `shot_ir.previous_shot_id` e o Shot IR tem `state_inherited_from` → usa `independent` com aviso: "Família X não tem continuity adapter nativo; usando corte frio (Shot IR pode ainda aparecer como conditioning se o usuário ativar `use_shot_ir` na estratégia). Confidence 0.0."
2. Se Shot IR explicitamente vazio → `independent`, confidence 0.0, sem aviso (corte intencional).
3. Em qualquer caso, **registra telemetria** para análise posterior: `continuity.fallback`.

### 2.4 Integração com A25 e A34

- `ContinuityRegistry` consulta primeiro o `CapabilityMatrix` (A34) para saber o `mode` preferido (`t2v` / `fl2v` / `i2v` / `extend`).
- Em paralelo, consulta a `ContinuityStrategy` do A25 (`independent | continuous | extend_previous` em `director/schema.py:288`) — se for `independent`, **não invoca** adapter.
- Para `continuous`, usa o adapter nativo quando disponível.
- Para `extend_previous`, prioriza `extend_previous` mesmo no adapter de outras famílias (com fallback para `first_last_frame`).

### 2.5 Fora de escopo

- Implementar IBL/Omni novo; só **consumir** o que o H3 já oferece (`_infer_h3_blocking_contract`, `Picture N` labels).
- Substituir `app/services/h3_sequence_continuity.py`; apenas trabalhar **em paralelo**.
- Inventar modelo novo. Só cobrir as 5 famílias já instaladas no Cue Studio v2.5.2.
- Cachear SHA-256 do adapter por modelo (responsabilidade da `ProvenanceManifest` do A27).

## 3. Contrato

### 3.1 Enum `ModelFamily`

```python
class ModelFamily(str, Enum):
    H3 = "h3"
    H3_OMNI = "h3_omni"
    LTX = "ltx"
    LTX25 = "ltx25"
    WAN = "wan"
    HUNYUAN = "hunyuan"
    UNKNOWN = "unknown"
```

### 3.2 Dataclass `BlockingContract`

```python
@dataclass(frozen=True)
class BlockingContract:
    subject_ids: tuple[str, ...]                # personagens que precisam parecer idênticos
    setting_id: Optional[str]                  # locação
    object_state_match: tuple[tuple[str, str], ...]  # [(object_id, expected_state)]
    gaze_targets: tuple[tuple[str, str], ...]  # [(character_id, target_id_or_dir)]
    wardrobe_versions: tuple[tuple[str, str], ...]  # [(character_id, wardrobe_vN)]
    requires_previous_frame: bool               # True se última imagem do Shot N for entrada
    requires_first_frame: bool                 # True se primeira imagem do Shot N for entrada
    notes: tuple[str, ...]
```

### 3.3 Dataclass `ContinuationStrategy`

```python
@dataclass(frozen=True)
class ContinuationStrategy:
    mode: Literal["first_last_frame", "extend_previous", "picture_n_reference", "subject_binding", "independent"]
    payload: dict
    confidence: float  # [0.0, 1.0]
    adapter_family: ModelFamily
    notes: tuple[str, ...] = ()
```

### 3.4 Função `resolve_continuity(...)`

```python
def resolve_continuity(
    *,
    registry: ContinuityRegistry,
    capability_matrix: CapabilityMatrix,
    previous_output: PreviousShotOutput | None,
    next_shot_ir: ShotIR,
    director_strategy: Literal["independent", "continuous", "extend_previous"],
    bible_refs: StoryBibleRefs | None = None,
    sidecar_dir: Path,
) -> ContinuationStrategy:
    """Resolve a estratégia final usada pelo renderer.
    Orquestra: A34 CapabilityMatrix + A25b adapter + A25 schema."""
```

### 3.5 Endpoints REST (referência, não obrigação neste escopo)

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/director/continuity/resolve` | Resolve estratégia para um `(model_id, shot_ir)`; útil para debug |
| `GET` | `/api/v1/director/continuity/adapters` | Lista adapters disponíveis |

## 4. Plano

1. **Protótipo** `prototypes/a25b_cross_family_continuity.py`:
   - Modelos de dados: `ModelFamily`, `ContinuationStrategy`, `BlockingContract`, `PreviousShotOutput`, `StoryBibleRefs`.
   - Interface `ContinuityAdapter` (ABC + `Protocol` opcional).
   - 5 adapters: `H3Adapter`, `H3OmniAdapter`, `LTXAdapter`, `WanAdapter`, `HunyuanAdapter`.
   - 1 fallback: `IndependentFallbackAdapter`.
   - `ContinuityRegistry` com `register`, `resolve`, `fallback_policy`.
   - Função `resolve_continuity(...)`.
   - 8 testes: extração H3, extração LTX, inferência de contrato, apply H3-Omni, apply LTX extend_previous, fallback para modelo desconhecido, telemetria de fallback, integração com A25 check_sequence.
2. **Wire no smoke** `prototypes/integration_smoke.py`: passo 12 novo para A25b exercitando adapters H3, LTX, Wan e fallback unknown em uma única produção fictícia.
3. **Atualizar** `prototypes/README.md` (novo arquivo se não existir) com entrada A25b.
4. **Atualizar** `_reversa_forward/plano-2026-10-04/README.md`:
   - Adicionar linha na tabela de features (próximo ID: 41).
   - Adicionar A25b ao resumo do ciclo 4.
5. **Atualizar** `_reversa_forward/plano-2026-10-04/HANDOFF.md`:
   - Adicionar A25b à linha "Spec complementar (ciclo 4)".
   - Adicionar entrada em "Material pronto" (spec + protótipo + teste de integração).
6. **Atualizar** `PLANO_EXECUTIVO_CUE_STUDIO.md` (no diretório CineLocal): nenhuma mudança obrigatória; o Apêndice B lista A25b como ⏳ "expansão futura" e esta entrega move o status.

### 4.1 Decisão sobre criação real vs scaffold

A integração real em `app/services/director/` exige liberar `allowedPaths` no `.reversa/reversa-config.json`. O protótipo e a spec **validam a estratégia** dentro da política atual.

## 5. Testes de aceitação

- `python3 _reversa_forward/plano-2026-10-04/prototypes/a25b_cross_family_continuity.py` roda **8/8** checks OK.
- `python3 _reversa_forward/plano-2026-10-04/prototypes/integration_smoke.py` agora roda **12/12** (com passo 12 novo para A25b).
- `bash _reversa_forward/plano-2026-10-04/scripts/run_all_prototypes.sh` permanece em **≥ 60/66** (acréscimo do A25b + smoke).
- A25b integra com A25 `check_sequence` recebendo os ShotIRs canônicos extraídos pelos adapters.
- A25b integra com A34 `CapabilityMatrix`: modelos com capability `FIRST_LAST_FRAME` recebem adapter Wan; com `AUDIO_GENERATE` recebem H3 Omni quando aplicável.
- Política `allowLegacyEdits: false` continua intacta: nenhum arquivo em `app/`, `ui/`, `tests/`, `scripts/`, `docs/` é tocado.

## 6. Critérios de pronto

- Spec publicada em `_reversa_forward/plano-2026-10-04/41-feature-a25b-cross-family-continuity.md`.
- Protótipo cobre 5 famílias + fallback; 8 testes OK.
- Smoke de integração cobre passo 12 novo.
- `README.md` e `HANDOFF.md` da pasta operacional atualizados.
- `PLANO_EXECUTIVO_CUE_STUDIO.md` Apêndice B: status de A25b muda para ✅ com referência ao protótipo.
- Aplicação real (em `app/services/director/cross_family_continuity.py`) **não é criada** neste escopo — exige liberação explícita de `allowedPaths`.

## 7. Riscos

- **Risco:** adapter por família vira duplicação de `_infer_h3_blocking_contract` em outro lugar. **Mitigação:** H3 adapter **importa** (`from`) de protótipo equivalente em `app/` (após liberação); fallback explicitamente LogWarn se找不到.
- **Risco:** confidence artificialmente alta esconde regressões. **Mitigação:** campo `confidence` é apenas informativo; render final **sempre** mostra a estratégia + adapter + notes ao usuário.
- **Risco:** Picture N label tem semântica específica do H3-Omni. **Mitigação:** apenas `H3OmniAdapter` retorna `picture_n_reference`; demais nunca emitem esse modo.
- **Risco:** Shot IR canônico perderia informação específica da família. **Mitigação:** adapter pode escrever um campo livre `family_extensions: dict` no `ContinuationStrategy.payload` que o renderer consome como preferir (capability-aware).
- **Risco:** orquestrador vira `god object`. **Mitigação:** `resolve_continuity` é função pura; entradas explícitas; testes cobrem (matriz + director_strategy + adapter) como composição.

## 8. Anexo — vocabulário de continuidade entre famílias

| Família | Mecanismo nativo | Limitação conhecida |
|---|---|---|
| H3 (não-Omni) | `Picture N` reference | Precisa de N imagens geradas previamente |
| H3 Omni | `Picture N` + `Subject/Speaker` bindings | Vincula áudio também |
| LTX / LTX25 | `multi_window` + `extend_previous` | Janela limitada (~24 frames por chamada); encadeamento linear |
| Wan 2.x | `first_last_frame` + ref image | Continuidade visual apenas no início/fim |
| Hunyuan-hyvideo | `i2v` + ref image | Sem multi-window nativo |

Tabela canônica após A25b: cada adapter acima vira classe isolada; Director escolhe automaticamente.

---

**Esta spec substitui a nota "⏳ futura" do `PLANO_EXECUTIVO_CUE_STUDIO.md` seção 5 (R10) e seção 7 (A25b — R10).**
