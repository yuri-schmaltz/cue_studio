# Feature A04 — Lint sem erros

**Origem:** [diagnóstico D04](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md#d04--gate-de-lint-está-quebrado) e [plano A04](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 0 — falhas verificadas, pequeno escopo.
**Prioridade:** P0.

## 1. Contexto

`npm run lint` termina com **12 erros e 6 avisos**. A CI (`.github/workflows/ci.yml`) executa lint, então o gate já está quebrado na origem.

Erros e avisos citados pelo diagnóstico (lista **não-canonada**; verificar com `npm run lint` no momento da execução):

| Arquivo | Categoria | Regra provável |
|---|---|---|
| `ui/src/components/MediaGallery.tsx` | `set-state-in-effect` | `@eslint-react-hooks-extra/no-set-state-in-effect` (React 19) ou `react-hooks/exhaustive-deps` |
| `ui/src/components/Sidebar/DirectorChat.tsx` | variável não usada | `@typescript-eslint/no-unused-vars` |
| `ui/src/components/DirectorPanel.tsx` | export incompatível com Fast Refresh | `react-refresh/only-export-components` |
| `ui/src/components/DirectorReferencePanels.tsx` | idem | idem |
| `ui/src/components/DirectorStatusPanel.tsx` | idem | idem |
| `ui/src/components/Skeleton.tsx` | escape desnecessário | `@typescript-eslint/no-useless-escape` ou similar |
| `ui/src/components/lazyComponents.ts` | `any` em lazy loading | `@typescript-eslint/no-explicit-any` |

🟢 Achado confirmado por execução de `npm run lint` no commit 27cadae.

## 2. Requisitos

### 2.1 Comportamento esperado

- `npm run lint` retorna **0** erros.
- Os 6 avisos são resolvidos ou recebem supressões **locais** (com comentário justificando) por linha.
- Build (`npm run build`) continua passando.
- Contratos dos testes (`npm run test:control`, `npm run test:store`) continuam passando.
- Nenhuma regra é desabilitada globalmente.

### 2.2 Fora de escopo

- Adoção de uma config ESLint nova.
- Migração para outra ferramenta (ex.: Biome).
- Refatorações amplas que mudem contrato de componente.

## 3. Contrato

Esta feature não muda contrato HTTP nem tipos. Mudanças são puramente em `ui/src/**`.

Para cada arquivo afetado, documentar:

- caminho;
- linha(s);
- regra;
- justificativa da correção (link para issue/PR quando aplicável).

## 4. Plano de mudança (categoria por categoria)

### 4.1 `set-state-in-effect`

Causa típica em React 19: estado sendo atribuído em `useEffect` em vez de durante render ou via `useSyncExternalStore`. Correção padrão: extrair o cálculo ou usar `useReducer`/`useState` initializer.

### 4.2 Variável não usada

Remover a variável. Se for parâmetro de função exportada, renomear para `_var` ou usar `// eslint-disable-next-line @typescript-eslint/no-unused-vars` com comentário justificando.

### 4.3 Export incompatível com Fast Refresh

A regra exige que arquivos que exportam componente exportem **apenas** componentes. Mover constantes, tipos ou helpers para um arquivo `*.const.ts` ou `*.types.ts` adjacente.

### 4.4 Escape desnecessário

Remover o `\\` extra quando o caractere seguinte não tem significado especial.

### 4.5 `any` em lazy loading

Substituir por tipo concreto. Para `lazy(() => import(...))`, criar um wrapper tipado em `ui/src/components/lazyComponents.ts`:

```ts
import { lazy, ComponentType } from 'react';

export const lazyComponent = <P extends object>(
  importer: () => Promise<{ default: ComponentType<P> }>,
) => lazy(() => importer());
```

## 5. Testes de aceitação

- `cd ui && npm run lint` → exit code 0.
- `cd ui && npm run test:control` → exit code 0.
- `cd ui && npm run test:store` → exit code 0.
- `cd ui && npm run build` → exit code 0.

## 6. Critérios de pronto

- Lint sem erros.
- Avisos justificados in-line quando não puderem ser eliminados (preferir eliminar).
- CI verde (re-rodar workflow localmente com `act` ou observando o output na próxima execução automática).
- `CHANGELOG.md`: entrada "Unreleased" mencionando correção do gate.

## 7. Riscos e mitigações

- **Risco:** corrigir `set-state-in-effect` introduz re-render loop. **Mitigação:** rodar testes de controle/store; verificar comportamento do Director (que tem ciclo de vida assíncrono).
- **Risco:** mover constantes para arquivos adjacentes quebra import barrel. **Mitigação:** atualizar import no arquivo de barrel (`ui/src/components/index.ts`, se existir).
- **Risco:** suprimir `no-explicit-any` mascara erro real no lazy loading. **Mitigação:** usar wrapper tipado, não suprimir.

## 9. Pré-condições

- Nenhuma. Pode entrar em paralelo com A03 e A05.

## 10. Pós-condições

- CI verde até o próximo gate (provavelmente A01/A02).
- A03 pode ser implementada sem que o lint acuse arquivos do escopo `a11y/`.