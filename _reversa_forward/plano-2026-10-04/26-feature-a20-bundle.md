# Feature A20 — Reduzir bundle e requests por tela

**Origem:** [plano A20](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 4 — performance e release.
**Prioridade:** P2.
**Dependência:** A17.

## 1. Contexto

Build baseline (auditoria): entry JS **879,22 kB / 243,25 kB gzip**; CSS **150,75 kB / 23,23 kB gzip**. Vite alertou que `useEditorStore.ts` é importado estática e dinamicamente — não é movido para outro chunk por esse import dinâmico.

## 2. Requisitos

### 2.1 Comportamento esperado

- Entry gzip ≤ 200 kB (meta inicial de −20%).
- Lazy loading real do editor; entry não puxa o store do editor.
- Overlays e notificações em chunks próprios.
- Budget por chunk em `vite.config.ts` ou ferramenta equivalente.

### 2.2 Fora de escopo

- Migrar para outro bundler.
- Code splitting por rota além do já existente.

## 3. Contrato

```ts
// vite.config.ts (trecho)
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          editor: [/src\/stores\/useEditorStore/, /src\/components\/Editor/],
          notifications: [/src\/components\/Notifications/, /src\/components\/Banners/],
        },
      },
    },
    chunkSizeWarningLimit: 220, // KB
  },
});
```

## 4. Plano

1. Analisar grafo de imports com `vite build --mode analyze` (rollup-plugin-visualizer).
2. Identificar módulos fora do escopo da entry.
3. Configurar `manualChunks` para editor e notificações.
4. Tornar `useEditorStore` realmente dinâmico (lazy).
5. Medir antes/depois com `npm run build`.

## 5. Testes de aceitação

- Bundle gzip reduzido ≥ 20%.
- Sem regressão funcional (E2E).

## 6. Critérios de pronto

- CI falha se entry gzip > 220 kB.

## 7. Riscos

- Chunk splitting quebra imports estáticos. **Mitigação:** grep + smoke.