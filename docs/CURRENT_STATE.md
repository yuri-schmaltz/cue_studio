# Estado verificado — 19/10/2026

Base: versão 2.5.2, branch main, commit inicial `6ec54ab`.
As alterações desta rodada estão no working tree; não houve commit ou push.

## Correções implementadas

- CLI `--offline-strict status` executa corretamente; bloqueio HTTP conserva
  o log e Web Push dispõe da função de auditoria antes ausente. URLs/IPs são
  analisados sem aceitar um hostname iniciado por `127.` como loopback.
- Seis rotas de preferências do Studio foram extraídas de `launch.py`, com
  teste HTTP de validação, persistência, reabertura e preservação de campos.
- Apresentação de atividade e etapas do Director foi extraída de `useStore.ts`
  para um módulo puro. A modularização é incremental; os arquivos centrais
  ainda têm responsabilidades que devem ser extraídas em futuras mudanças.
- Efeito de metadados do MediaInspector usa dependências completas. O chip
  do projeto passou a ocupar sua própria linha no cabeçalho, evitando
  sobrepor abas de navegação.
- Junção de vídeos codifica em temporário, valida o vídeo e só então publica
  o destino. Falha, codificação inválida, cancelamento ou encerramento do
  encoder preservam o arquivo anterior; clips de entrada ausentes não são
  silenciosamente omitidos.
- Entradas explícitas do Director são verificadas antes da retomada e no
  worker. Referência removida produz erro antes de carregar/despachar o modelo.
- F3 usa processo real encerrado após commit SQLite, reabertura independente,
  cancelamento concorrente e retake idempotente com codificação CPU real.
- O parser de requirements preserva extras, marcadores e hashes SHA-256 em
  linhas continuadas; a auditoria verifica faixas de versões, nomes normalizados
  e hashes observados. Declarações inválidas ou não suportadas falham explicitamente.
  URLs de wheels e alterações nos arquivos de origem também são verificadas.
  Isso não resolve dependências nem certifica instalações dos perfis E0–E4.
  Veja a [auditoria por requisito](CORRECTION_AUDIT.md).
- Workers falham quando tarefas são rejeitadas ou não produzem mídia.
  SFX rejeita referência explícita ausente/inválida e registra somente seu arquivo.
- F2 não gera mais tons nem troca falha de modelo por mídia determinística:
  usa jobs reais do Studio e exige revisão artística vinculada ao hash.
  Veja [o procedimento](REFERENCE_FILM_VALIDATION.md).
- Routers de capacidades e proveniência voltaram a ser montados no backend
  real. Teste de contrato exige suas rotas. Bundles de proveniência preservam
  caminhos relativos, verificam hashes e rejeitam travessia de diretórios.
  Proveniência de checkpoint desconhecido ou de dados legados é marcada
  `needs_review`; não recebe aprovação fictícia.
- A suíte agora redireciona também `wgp_config.json`, além de SQLite/cache.
  A raiz local foi restaurada para `app/outputs` por escolha explícita do usuário.
  A configuração anterior está em `app/.cache/correcoes-2026-10-19/` (não versionada).
- CI inclui Vitest e dependências HTTP/CLI explícitas. A configuração Reversa
  foi corrigida com autorização do usuário. Os 245 arquivos `.claude/` foram
  retirados apenas do índice Git com autorização explícita; permanecem em disco
  e a pasta foi adicionada ao ignore.

## Evidências

- Python padrão: **972 passed, 6 skipped, 62 deselected**, 33 subtests.
  O hash de `app/wgp_config.json` foi comparado antes/depois: preservado.
- Lockfile: **28 passed**; regressões de extras, continuações, faixas,
  marcadores de plataforma e hashes ausentes/divergentes.
- Regressões focadas de configuração, jobs, offline, proveniência e publicação:
  **32 passed**.
- Smoke de importação em processos novos: **1 passed, 35 subtests**.
- TypeScript + Vite build: aprovado; permanecem avisos de tamanho de chunks.
- ESLint: zero erros e zero avisos de regras (Babel ainda informa arquivo grande).
- Vitest: **183 passed**, 27 arquivos; contratos store/control aprovados.
- Guard de repositório: **clean, 2.742 arquivos rastreados auditados**, após a
  retirada autorizada de `.claude/` do índice.
- Backend real em instância de validação isolada: `/health/version`,
  `/api/v1/capabilities/models`, `/api/v1/system/network-policy` e preferências
  respondem 200; proveniência de take ausente responde 404, com a rota montada.
- Chromium: **3 passed**; 35 combinações de sete seções e cinco larguras,
  navegação por teclado, revisão do Director, persistência do Editor e CRUD
  de projetos, com mutações interceptadas. Capturas em `/tmp/cue-validation-browser/`.

Os testes F2 de GPU são dois dos seis ignorados na suíte comum. Os outros
quatro casos dependem de Playwright opt-in e de ausência de PyYAML. Isso não
constitui aprovação de geração completa nem de revisão artística.

## Homologação real ainda em andamento

O usuário forneceu uma referência vocal PT-BR. Foram geradas as quatro falas reais com o modelo de voz instalado;
as durações são 4,30 s, 2,86 s, 2,70 s e 3,10 s, dentro das respectivas janelas. O checkpoint usado foi registrado
com SHA-256. A música real terminou. A primeira tentativa visual foi rejeitada por erros de continuidade;
uma segunda usa o Flux 2 Klein com âncoras de personagem/ambiente. O polling conserva o
mesmo job durante timeout transitório de carregamento de modelo. Recibos e artefatos locais ficam em
`app/outputs/validacao-f2-2026-10-19/` (não versionados).

A aprovação F2 completa permanece pendente: é necessário produzir e medir o
master real de 60 s e revisar as seis dimensões artísticas, falas e título.
Não reutilizar os antigos “F2 2/2” como prova. Também não declarar instalação
reproduzível dos cinco perfis E0–E4: a resolução e os hashes desses ambientes
continuam sem homologação. Atualizações do histórico em HANDOFF/TODO não
substituem a evidência por execução.
