# Análise do estado atual — 29/10/2026

> Correção em 30/10/2026: a seção de homologação abaixo reproduziu um relato antigo incompleto. O [handoff v11](../docs/HANDOFF_V11.md) documenta que o master v10 **já havia sido reprovado por revisão humana**, com cinco erros críticos. Não há aprovação artística pendente daquele master histórico. O estado comprovado das correções e da nova produção está em [CURRENT_STATE](../docs/CURRENT_STATE.md). Os resultados restantes deste documento descrevem a análise inicial, anterior às alterações locais.

## Base examinada

- Repositório: https://github.com/yuri-schmaltz/cue_studio
- Checkout: `/home/yurix/Documentos/cue_studio`.
- Branch `main`, commit `d2bac33`, de 26/10/2026.
- Versão declarada: 2.5.2 em `VERSION` e `pyproject.toml`.
- Clone inicialmente limpo; nenhum código de aplicação foi alterado nesta análise.

## Avaliação

O projeto é um estúdio criativo local em estágio beta, com implementação extensa e testes significativos. A interface está compilável e seus gates automatizados passaram nesta análise. Isso não certifica instalação completa, execução dos modelos ou qualidade artística do fluxo de produção.

### Estrutura e funcionalidades

- UI: React 19, TypeScript, Vite 7, Tailwind 4 e Zustand. A aplicação expõe Projects, Queue, Director, Studio, Editor, Medias e Configurations. Dashboard foi removido.
- Backend: Python/FastAPI com execução e gestão de modelos herdadas de Maestro/WanGP. `app/launch.py` concentra API e integração; `app/wgp.py` concentra grande parte do runtime de geração.
- Director: planejamento por skills, schemas de planos/shots, renderizadores por modelo, validação de prompts, continuidade, retomada, revisão e geração por etapas.
- Studio: geração e transformação de vídeo, imagem e áudio, seleção de modelos, LoRAs e controles de geração.
- Editor: timeline com camadas, projetos, exportação e integração de retorno ao Studio.
- Estado: SQLite, serviços de produção, arquivos de configuração e persistência no cliente. Existem testes de isolamento, concorrência e retomada.
- Integrações: LLM local e provedores externos, CivitAI, MCP, notificações e política offline.

## Verificações executadas

| Verificação | Resultado atual |
| --- | --- |
| Clone e estado Git inicial | `main` em sincronia com `origin/main`; sem alterações |
| `verify_clean_repo.py` | Aprovado; 2.802 arquivos rastreados auditados |
| Sintaxe Bash de start/stop/install | Aprovada |
| `git diff --check` antes do relatório | Aprovado |
| UI `npm ci` com Node 22.23.4 | Aprovado |
| UI `npm run build` | Aprovado, incluindo `tsc -b`; avisos de chunks grandes |
| UI `npm run lint` | Aprovado |
| UI `npm test` | 208 testes aprovados em 30 arquivos |
| UI `npm run test:store` | Aprovado |
| UI `npm run test:control` | Aprovado |
| Python padrão `python -m pytest -q` em ambiente leve | Falhou antes da coleta em `conftest.py:460` |
| Python focado, sem o conftest raiz | 188 testes aprovados; 1 aviso de depreciação |

O sistema tinha Node 18.19.1. A instalação inicial com ele deixou de instalar uma dependência nativa opcional do Tailwind; executar o build com Node 22 sem reinstalar não resolveu. Repetir `npm ci` já sob Node 22 corrigiu o problema sem alterar o lockfile. Os comandos UI foram executados via `npx --yes --package=node@22 -c '...'`.

O ambiente Python foi criado em `/tmp/cue-analysis-venv`, com dependências leves, sem instalar a pilha completa de modelos. Suas versões não reproduzem integralmente o CI. A seleção focada foi executada com `PYTHONPATH=.:app:tests` e `--confcutdir=tests`: preserva o isolamento de `tests/conftest.py`, mas evita o shim defeituoso do conftest raiz. Portanto, os 188 aprovados não equivalem à aprovação da suíte padrão.

Arquivos da seleção Python: `test_app_state_db.py`, `test_production_store.py`, `test_production_resume.py`, `test_lockfile.py`, `test_api_security.py`, `test_dependency_graph.py`, `test_workspaces_router.py`, `test_shot_ir.py`, `test_offline_strict.py`, `test_provenance.py`, `test_mcp_access.py`, `test_workspace_setup_service.py` e `test_wizard_types.py`.

Logs temporários desta análise: `/tmp/cue-ui-build.log`, `/tmp/cue-ui-lint.log`, `/tmp/cue-ui-tests.log`, `/tmp/cue-pytest.log` e `/tmp/cue-python-focused.log`.

## Problemas e riscos encontrados

1. **O fallback de testes sem PyTorch está quebrado.** `_ShimCallable` restringe atributos com `__slots__`. Sem PyTorch, o shim devolve esse objeto para `torch.cuda`; a atribuição `_cuda._maestro_shimmed = True` em `conftest.py:460` lança `AttributeError`. A suíte nem começa a coletar. O CI instala PyTorch, então essa reprodução não demonstra falha do CI completo.
2. **Router de capacidades montado duas vezes.** `app/launch.py:10516` e `:10567` incluem o mesmo router de `app/routers/capabilities.py`. Isso duplica registros e pode gerar avisos/ambiguidade na documentação OpenAPI. O contrato em `tests/test_route_contract.py` usa um conjunto de pares método/caminho, que elimina duplicatas e não detecta esse problema. Não foi observada divergência de respostas nesta análise.
3. **Concentração de responsabilidades.** `app/launch.py`: 29.893 linhas; `app/wgp.py`: 15.348; `ui/src/stores/useStore.ts`: 12.526. Já existem routers e slices extraídos, mas a modularização ainda é parcial. Alterações pequenas podem exigir compreensão de grandes superfícies e efeitos cruzados.
4. **Bundles acima do orçamento.** O build emitiu aviso para chunks maiores que 220 kB: Studio aproximadamente 292 kB e editor 531 kB minificados. É um ponto de desempenho a medir, especialmente no carregamento inicial e em dispositivos móveis.
5. **Instalação reproduzível ainda não demonstrada.** Há `ui/package-lock.json`, pins Python e ferramentas de auditoria, mas `app/requirements.txt` também contém dependências sem versão e wheels externos; o CI usa versões diferentes de algumas dependências do runtime. A documentação reconhece que os perfis E0–E4 ainda não têm homologação completa de resolução/hashes.
6. **Documentação mistura camadas históricas.** `HANDOFF.md`, `docs/TODO_RETOMADA.md` e `docs/CURRENT_STATE.md` acumulam estados de versões anteriores. O topo do CURRENT_STATE destaca v6, mas seções posteriores já discutem v10. Usar apenas o cabeçalho ou números antigos de testes produz uma leitura incorreta do estado atual.

## Homologação de geração

Segundo a seção mais recente pertinente de `docs/CURRENT_STATE.md`, o master v10 passou nas portas técnicas: 60 s, 24 fps, áudio estéreo a 48 kHz, −16,14 LUFS e −1,80 dBTP. A revisão criativa humana nas seis dimensões continua pendente para o hash `9911589e77b614644e3da8188d02d5a10410c39dd1fc384a352c55457ce6b97b`.

Esses são resultados históricos documentados, não medições repetidas nesta análise. Os vídeos/recibos locais citados não acompanham o clone. Não houve render, download de pesos, exportação, teste de navegador ou inicialização do backend nesta rodada. Qualidade visual, voz PT-BR, edição sonora e o defeito de robô flutuando continuam exigindo revisão humana; a própria documentação registra limitações do detector de contato com o chão.

## Ordem sugerida de continuidade

1. Corrigir o fallback de PyTorch e acrescentar verificação do ambiente leve; depois executar a suíte completa com as dependências do CI em ambiente limpo.
2. Eliminar a inclusão duplicada do router e testar unicidade de método/caminho, além de presença das rotas.
3. Validar instalação e boot completos, com smoke HTTP e navegador, antes de homologar geração/exportação reais.
4. Concluir a revisão artística do master atual, com recibos e hash corretos.
5. Prosseguir com extrações incrementais de routers/slices protegidas por contratos, reduzir chunks e consolidar um resumo atual da documentação.
