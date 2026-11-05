# Cue Studio Desktop/Rust — objetivo ativo, 04/11/2026

## Escopo autorizado e critérios de conclusão

Usuário: “quero transformar o cue studio em uma aplicação desktop baseada em rust”. Escolheu explicitamente **Desktop em Rust/Tauri, mantendo Python/PyTorch como motor de IA gerenciado pelo aplicativo**. Não substituir o objetivo por um protótipo de WebView. Alvo inicial: Linux deste ambiente; não declarar Windows/macOS homologados sem execução correspondente.

Para concluir: janela desktop real em Rust; motor Python gerenciado (início, prontidão, falha, retry e saída); transporte privado com mídia/Range funcionando; interface inteira compilável e fluxos Director/Studio/Editor/Queue/Settings preservados; dados e modelos persistentes fora do pacote; distribuição instalável com configuração/instalação do runtime gerenciada; validação real da abertura, navegação e encerramento; documentação e gates. Não marcar completo com base em testes unitários ou somente `cargo check`.

## Estado inicial

Base main/8fa2a98. Sem mudanças de código no início; só relatório de reanálise não rastreado em `_reversa_sdd/estado-atual-2026-11-04.md`. Config Reversa permite app/**,ui/**,tests/**,scripts/**,docs/** e diretórios próprios; não alterar config nem pyproject.toml. Sem subagentes. Toolchain moderno está em `/home/yurix/.cargo/bin` (Rust1.99.1); `/usr/bin/rustc` é1.75. GTK3.24.41, WebKit2GTK4.1 2.52.6 disponíveis.

## Implementado nesta etapa

- Tauri2 em ui/src-tauri, Cargo.lock, capabilities locais, splash/diagnóstico próprio e comandos de desenvolvimento/build/teste.
- Supervisor Rust inicia apenas um worker próprio, com sessão UUID, token privado, porta efêmera e prova PID/instance pelo HTTP. Log local, deadline de boot, retry e encerramento do grupo de processos no Unix. Confirmação antes de fechar janela com motor ativo. Proteção adicional contra morte do pai no Linux/Unix em implementação/teste.
- app/desktop_worker.py: inicialização isolada, diretórios OS/app data, cookie HttpOnly/SameSiteStrict após bootstrap privado, rejeição de Origin externo, token do supervisor e logs sem URL com segredo. Mantém API/mídia no mesmo origin; nenhuma permissão IPC nativa é concedida à UI HTTP.
- launch.py aceita CUE_UI_DIST mantendo o caminho web existente como default. Não reiniciar/encerrar o backend preexistente7860/PID130818 nem outros modelos do usuário.
- Correções dos71diagnósticos TypeScript: variáveis Studio, defaults de props, valores unknown usados como condições JSX, contratos dos slices, construtor recipes, inicializadores duplicados, fixtures/tipos Node. Sem desabilitar strict/typecheck/budget. Manter os testes anteriores do aplicativo.
- Staging em ui/scripts/prepare-desktop-runtime.mjs copia código e assets, sem pesos, virtualenvs ou dados do usuário. **Instalação Python gerenciada e pacote final ainda pendentes**; o seletor de runtime existente é transição, não conclusão do objetivo.

## Evidência já concluída

- `/tmp/cue-desktop-prepare.log`: `tsc -b`, Vite e orçamento passaram;35chunksJS, maior192276/220000bytes. Fonte/UI atual preparada em ui/src-tauri/{runtime,web}, ignorados.
- `/tmp/cue-desktop-worker-tests.log`:5pytest aprovados; autenticação, cookie, Origin, status, Range.
- `/tmp/cue-desktop-rust-tests.log`:3testes Rust aprovados (handshake real com worker HTTP de fixture, identidade incorreta e saída antecipada), mais doctests vazios.
- `/tmp/cue-desktop-rust-native.log`:cargo check nativo GTK/WebKit concluído. Não prova janela aberta.
- `/tmp/cue-desktop-native-build.log`:build do binário real em andamento; conferir sessão/processo atual. Primeira chamada compilava com frontend ainda em staging; após frontend preparado refazer incrementalmente para garantir assets atuais.

## Ferramentas e verificação nativa

`tauri-driver`2.1.0 instalado em ~/.cargo/bin. WebKitWebDriver2.52.6 baixado e extraído sem instalar pacote de sistema em app/.cache/desktop-tools/unpacked/usr/bin/WebKitWebDriver. Display existente: :0. Xvfb não instalado. Fonte oficial do fluxo: https://v2.tauri.app/develop/tests/webdriver/example/selenium/ . Usar WebDriver para verificar o executável real, não uma simulação do renderer.

## Atualização de verificação — 04/11/2026

- `app/runtime_bootstrap.py` cria o venv privado em `app-data/runtime/env`, valida o manifesto e o hash de `requirements.txt`; a tela inicial do Tauri expõe a instalação assíncrona e o seletor de runtime.
- A fila agora calcula a contagem incluindo jobs ativos, entradas do Director e itens persistidos ainda visíveis; o default do modelo musical está alinhado ao identificador canônico `ace_step_v1_5_xl_sft_lm_4b`.
- A suíte de store foi atualizada para o contrato de persistência v12. ESLint termina com 0 erros e 0 warnings, e os tipos de polling/restauração foram estreitados sem `any` em produção.
- `python3 app/runtime_bootstrap.py --app-dir app --runtime-dir /tmp/cue-runtime-check --check` passou; `cargo fmt`, `cargo test --no-default-features` (3 testes) e `cargo check` nativo passaram.
- `python3 scripts/desktop-smoke.py` passou com janela real: Studio visível, `401` sem autenticação, `403` com Origin externo e `workerStoppedAfterExit: true`.
- `npm run desktop:prepare` passou com 35 chunks e orçamento de 220 kB. O build release Tauri gerou o `.deb` em `ui/src-tauri/target/release/bundle/deb/Cue Studio_2.5.2_amd64.deb` (13 MB). O linuxdeploy do AppImage foi tentado novamente após corrigir o ícone PNG e ficou preso na coleta do plugin GTK; os processos pertencentes ao build foram encerrados após o timeout. O AppImage não foi homologado neste ambiente; o `.deb` continua sendo o artefato Linux validado.
- O `.deb` foi extraído em diretório temporário sem checkout/runtime de desenvolvimento; o binário release abriu a tela de primeiro uso e mostrou `Install AI runtime` (`CUE_DESKTOP_EXPECT_SETUP=1`). A listagem do pacote não contém pesos (`.safetensors`, `.pth`, `.pt`, `.gguf`, `.bin`) nem `env/`.
- O smoke limpo do `.deb` abriu a tela de primeiro uso sem checkout, `app/env` ou runtime injetado (`setupScreenVisible: true`). A suíte UI completa passou com 52 arquivos e 343 testes; pytest do worker passou com 5 testes; Rust passou com 3 testes. `docs/desktop.md` documenta desenvolvimento, instalação e gates. O smoke não toca o backend web pré-existente nem carrega modelos.

## Próximos passos

1. Validar o `.deb` em uma máquina Linux limpa, sem checkout ou `app/env`, incluindo a instalação do runtime e a primeira inicialização.
2. Acrescentar integração de configurações/projetos existentes, single instance, política de navegação externa e job objects equivalentes no Windows antes de declarar suporte multiplataforma.
3. Resolver a execução do AppImage neste ambiente ou restringir explicitamente o release Linux ao `.deb`; não afirmar AppImage homologado.
4. Regenerar os locks de dependências com um resolvedor disponível (a verificação atual detecta drift de hash em `app/requirements.txt`; não foi mascarado regravando hashes manualmente), além de revisar licenças e CI.
