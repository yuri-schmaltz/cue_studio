## Atualização de duração, 06/11

[Correção e medição real](docs/DURATION_BUDGET_2026-11-06.md): planejamento breve e piso de geração corrigidos. Pedido 3s: vídeo 2,76s, contêiner 2,89s, margem ±0,25s. Pacotes atualizados disponíveis; sessão instalada preservada por haver produção ativa.

# Estado validado — 06/11/2026

[Validação vigente](docs/RELEASE_READINESS_2026-11-06.md). App 2.5.2 instalado e aberto; motor atualizado. Python 1.440 + 37 subtestes, UI 351 e Rust 8 aprovados. Produção e exportação reais concluídas. Pendência: orçamento de duração do planejamento.

---

## Registro histórico de 04/11

# Handoff — 04/11/2026

Estado comprovado: [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md). O objetivo ativo continua sendo atacar todos os pontos de atenção, sem reduzir o escopo às correções já entregues.

- Base: `main`, `56c1fbb` (+ este ciclo), versão 2.5.2. Tudo neste ciclo está commitado e enviado ao remoto.
- Processo, jobs e comandos: [_reversa_forward/correcoes-2026-10-30/ESTADO.md](_reversa_forward/correcoes-2026-10-30/ESTADO.md).
- Pendências: [docs/TODO_RETOMADA.md](docs/TODO_RETOMADA.md).
- Auditoria de UI e status por frente: [docs/UI_AUDIT_2026-11-03.md](docs/UI_AUDIT_2026-11-03.md).
- YuE (modelo de música): [docs/HANDOFF_YUE_MUSIC.md](docs/HANDOFF_YUE_MUSIC.md) — integração feita, geração de ponta a ponta ainda pendente.
- Falhas do Director: [docs/HANDOFF_DIRECTOR_FALHAS.md](docs/HANDOFF_DIRECTOR_FALHAS.md) — diagnóstico pronto (erro real perdido, `oom_info` vazio e retry por clip quebrado); as correções ainda não foram implementadas.
- Instalação/lock candidato: [docs/INSTALLATION_VERIFICATION.md](docs/INSTALLATION_VERIFICATION.md).
- Produção autorizada: `app/outputs/validation-2026-10-30/`. Preservar recibos concluídos, conferir o job vivo antes de submeter novamente e não reiniciar o backend enquanto houver geração ativa.

O documento anterior está em [docs/history/HANDOFF_legacy.md](docs/history/HANDOFF_legacy.md). Seus PIDs, portas e resultados são históricos.

## O que este ciclo entregou

**Pre-flight do Director (`g3`).** O problema que o motivou: uma faixa de 4:15 foi analisada e o plano parecia uma linha na interface — mas o Director a transformava em uma dúzia de renders. Sem nenhuma estimativa de custo, tempo ou memória, o usuário só descobria o tamanho da conta depois que a GPU já estava trabalhando (ou já tinha quebrado).

- `POST /api/v1/director/preflight` (`app/services/director/http_preflight.py`) monta um relatório: contagem de clipes, duração total, quadros totais, tempo de render estimado, risco de OOM e avisos concretos.
- A estimativa sai do **histórico local de tempos da própria máquina** (`app/services/generation_eta.py`), que é indexado por hardware. A chave de família original fixava também as imagens de entrada/saída e os guias de áudio, o que fazia um videoclip nunca casar com as amostras de um render comum; o novo `estimate_model_scoped` (modelo + resolução) recupera a taxa local, e `observed_window_frames` expõe a maior passagem já renderizada naquela máquina — um teto de memória comprovado.
- A checagem de VRAM usa a mesma política de memória do H3 e o mesmo `build_director_video_execution_profile` que o pipeline usa; o erro "não há perfil de uma passada" do H3 é capturado e reportado como erro, não engolido.
- A aritmética de duração de clipe foi extraída para `app/services/director/clip_schedule.py` e o `director_pipeline.py` passou a delegar. Isso é o que impede o preflight de descrever um render diferente do que vai rodar — a mesma classe de bug que encurtou um videoclip 4:15 na proporção 16/25.
- UI: `DirectorPreflightCard` encaixado imediatamente acima dos controles de ação em `DirectorPlanColumn.tsx`, com `directorPreflightSlice` no store e `fetchDirectorPreflight` no cliente. Sem histórico, o cartão diz "Not available yet" em vez de inventar um número.

**Base já entregue antes deste ciclo:** `g1-idioma` e `g2-editor-handoff` (`56c1fbb`), capa 16:9 (`2aced73`), plano de ação da auditoria de UI (`91dd3c5`).

## Como validar este ciclo

```bash
# Backend (venv em app/env, a partir da raiz do repositório)
./app/env/bin/python -m pytest tests -q

# UI (Node 22; o Node do sistema é 18 e o Vite exige 20.19+)
cd ui
npx --yes --package=node@22 -c 'node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json'
npx --yes --package=node@22 -c 'node ./node_modules/vitest/vitest.mjs run'
npx --yes --package=node@22 -c 'node ./node_modules/eslint/bin/eslint.js src'
npx --yes --package=node@22 -c 'node ./node_modules/vite/bin/vite.js build'
```

Resultado da última rodada: **1.414 testes Python aprovados** (12 ignorados, 63 desmarcados) e **341 testes Vitest, 340 aprovados** — a única falha é `ui/src/components/Shell/QueuePage.test.tsx:151`, pré-existente e não relacionada. Lint em 74 erros, todos pré-existentes; nenhum arquivo novo adiciona erro. Build de produção aprovado.

## O que continua aberto

1. **Fronteiras restantes do gauntlet** — `g4-undo-director` (histórico de edição do briefing), `g5-a11y` (271 `<label>` sem `htmlFor`, 509 `<button>` sem `aria-label`), `g6-modularizacao`, `g7-ci-browser` (os testes de navegador existem mas `pyproject.toml` os desmarca com `-m 'not browser'`), `g8-docs`.
2. **Modularização** — o bootstrap/configuração/registro do runtime WanGP ainda vive dentro de `app/launch.py`. O critério continua sendo *fronteira coesa*, não contagem de linhas: `docs/TODO_RETOMADA.md` registra isso explicitamente.
3. **Produção real** — o lote `film-v1` está reprovado em 14 verificações; nenhum master novo foi aprovado, e a revisão artística humana continua obrigatória e vinculada ao SHA-256.
4. **Benchmarks** — os hardwares E1/E2/E4 seguem não verificados; os locks atuais compartilham CUDA 13.

## Armadilhas conhecidas

- `pkill` está bloqueado neste ambiente — use `kill <PID>`.
- `sqlite3` de `app/env` tem JSON1 habilitado, o que permite consultar `profile_json` do histórico de ETA; a implementação, porém, filtra em Python para não depender disso.
- `import wgp` leva ~14 s e carrega o runtime inteiro: nunca importe em rota que precise responder rápido sem necessidade. O preflight resolve o modelo por dependência injetada, e o import pesado fica no `launch.py`.
- A aritmética de duração de clipe **não pode voltar a ser duplicada**. O `clip_schedule.py` é a fonte única; o pipeline e o preflight consomem o mesmo módulo.
- A política de escrita do Reversa (`.reversa/reversa-config.json`) **não pode ser editada** por agente.
