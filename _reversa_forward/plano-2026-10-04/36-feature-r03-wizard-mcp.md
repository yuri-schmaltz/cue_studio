# Feature R03 — Wizard tipado e MCP mutation_class

**Origem:** Plano Executivo §7 Eixo 5 + Dossiê R03 (Wizard concluído ≠ mídia gerada; MCP read-mostly que escreve).
**Ciclo:** 4.
**Prioridade:** P1.
**Dependência:** nenhuma forte.

## 1. Contexto

Dossiê seção 12: `WizardSupervisor._validate_step_output()` valida chaves JSON, não semântica nem execução de mídia. Dossiê seção 13: `wizard_run_step` e `editor_export` documentados como "read-mostly" mas têm efeito de escrita — devem ser classificados pelo efeito, não pelo rótulo.

## 2. Requisitos

### 2.1 Wizard tipado

Cada etapa declara `step_kind ∈ {creative, mechanical, review}`:

- `creative`: produção assistida por LLM, saída é proposta validável.
- `mechanical`: execução determinística (parse, download, install); saída é artefato verificável.
- `review`: validação por humano/UI; saída é decisão.

Executores por tipo:

- `creative_executor`: chama LLM, valida schema, persiste proposta, **não marca concluído**.
- `mechanical_executor`: chama serviço, valida artefato (probe, hash), marca concluído se válido.
- `review_executor`: aguarda input externo, persiste decisão, marca concluído.

Concluir uma etapa **só é válido** quando o efeito exigido está demonstrado.

### 2.2 MCP mutation_class

Cada ferramenta MCP declara `mutation_class ∈ {read, write_art, write_meta, write_storage, install}`:

- `read`: sem efeitos colaterais (listar modelos/produções/projetos).
- `write_art`: mutação editorial (editar plano, aprovar tomada).
- `write_meta`: mutação de metadados (renomear projeto, mover produção).
- `write_storage`: alteração de pesos/arquivos.
- `install`: instalar/desinstalar.

`wizard_run_step` deve ser `write_meta` (alteração de workflow). `editor_export` deve ser `write_art` (export gera arquivo).

## 3. Modelo de dados

```python
class WizardStepKind(str, Enum):
    CREATIVE = "creative"
    MECHANICAL = "mechanical"
    REVIEW = "review"

class WizardStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step_id: str
    workflow_id: str
    kind: WizardStepKind
    expected_effect: str  # "json_only" | "artifact_at_path" | "human_decision"
    effect_target: Optional[str] = None  # ex.: path do artefato esperado
    schema: dict  # JSON schema da saída

class McpMutationClass(str, Enum):
    READ = "read"
    WRITE_ART = "write_art"
    WRITE_META = "write_meta"
    WRITE_STORAGE = "write_storage"
    INSTALL = "install"

class McpTool(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    mutation_class: McpMutationClass
    requires_capability: str
```

## 4. Endpoints REST

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/wizard/workflows/{id}/steps` | Lista steps com `kind` |
| `POST` | `/api/v1/wizard/workflows/{id}/steps/{step_id}/run` | Despacha executor pelo kind |
| `GET` | `/api/v1/mcp/tools` | Lista tools com `mutation_class` |

## 5. Critérios de aceite

- Step `creative` concluída só quando proposta validada; JSON cru não conta como concluído.
- Step `mechanical` concluída só com validação de artefato (probe/hash presente).
- Step `review` concluída só após decisão humana.
- `wizard_run_step` listado como `write_meta`; `editor_export` como `write_art`.
- 7 testes verdes no protótipo.