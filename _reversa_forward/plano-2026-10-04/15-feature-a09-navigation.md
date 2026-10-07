# Feature A09 — Navegação com projeto persistente e URL

**Origem:** [plano A09](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 1 — fundação UX.
**Prioridade:** P1.
**Dependência:** A07, A08.

## 1. Contexto

A Sidebar lista 8 seções, mas o **projeto ativo** não aparece persistentemente. URL não reflete seção/projeto; deep-link não preserva contexto sem disparar geração.

🟢 Observação direta da inspeção.

## 2. Requisitos

### 2.1 Comportamento esperado

- URL reflete projeto e seção: `/projects/:projectId/:section?`.
- Botão "Voltar" do navegador volta para a última URL navegada (não gera).
- Reabrir URL existente: mostra o projeto/seção **sem disparar** geração.
- O cabeçalho do app mostra o projeto ativo e uma ação principal por contexto.
- Filtros/paginação que afetam listagem devem ser refletidos na URL (`?page=2&filter=...`).

### 2.2 Fora de escopo

- Migração completa para um router novo (React Router ou similar). Usar o que existe (`react-router` se já estiver, senão introduzir com cuidado).

## 3. Contrato

```ts
// ui/src/navigation/types.ts
export type AppRoute =
  | { kind: 'dashboard' }
  | { kind: 'projects' }
  | { kind: 'project'; projectId: string; section: Section }
  | { kind: 'media' }
  | { kind: 'queue' }
  | { kind: 'editor'; projectId: string }
  | { kind: 'configurations' };

export type Section = 'briefing' | 'scenes' | 'studio' | 'media' | 'review';
```

URL mapping:

| Kind | URL |
|---|---|
| `dashboard` | `/` |
| `projects` | `/projects` |
| `project` | `/projects/:projectId/:section` |
| `media` | `/media` |
| `queue` | `/queue` |
| `editor` | `/projects/:projectId/editor` |
| `configurations` | `/configurations` |

## 4. Plano

1. Auditar `react-router` (ou similar) já em uso: `grep -rn "react-router\\|useNavigate\\|BrowserRouter" ui/`.
2. Se não houver, introduzir `react-router-dom` v6+ com `createBrowserRouter`.
3. Criar `AppRoute` parsing/serialization; rotas declarativas; cada rota corresponde a uma seção.
4. Adicionar `useActiveProject()` que retorna o projeto do path.
5. Atualizar `Sidebar` para refletir a rota; cabeçalho mostra projeto ativo e ação contextual.
6. Substituir navegações imperativas (`setSection(...)`) por `navigate(...)`.
7. Em `MediaGallery` e `Director`, substituir filtros locais por `useSearchParams`.

## 5. Testes de aceitação

- Playwright E2E:
  - abrir `/projects/abc/studio` em nova aba mantém o projeto sem disparar geração;
  - voltar navega para `/projects/abc/briefing` se era a última URL.
- Unit: `parseRoute`/`serializeRoute` para todas as variações acima.

## 6. Critérios de pronto

- Nenhuma navegação `setSection` no store principal (ou somente transições legítimas já em revisão).
- Deep-link `/projects/abc/briefing` funciona após refresh.
- Cabeçalho mostra projeto ativo em todas as rotas.

## 7. Riscos

- Histórico do navegador acumula ruído. **Mitigação:** `replace` em navegações programáticas de polling.
- Sidebar precisa de refactor. **Mitigação:** manter compatibilidade com a Sidebar atual na primeira iteração.