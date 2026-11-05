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

## Próximos passos

1. Conferir build nativo e testes após proteção de morte do pai. Compilar com PATH moderno e `--features tauri/custom-protocol`. Reexecutar staging após fonte Python alterada e garantir assets atuais.
2. Acrescentar teste de render Studio (desktop/mobile) para a falha activeTab; executar Vitest/contratos relevantes. Falhas anteriores QueuePage(6items), store(defaultmusic),74lint e locks desatualizados foram diagnosticadas antes; não mascarar nem afirmar que já estão resolvidas.
3. WebDriver com binário real: escolher runtime via env CUE_DESKTOP_RUNTIME_ROOT=raiz e CUE_DESKTOP_PYTHON=app/env/bin/python, dados temporários via CUE_DESKTOP_DATA_DIR, CUE_OFFLINE_STRICT=1. Submeter sessão browserName=wry, tauri:options.application=binário. Conferir UI do backend, autenticação, navegação Studio e saída sem worker órfão. Não carregar modelos nem gerar mídia só para testar a janela.
4. Completar instalação/runtime Python gerenciados, integração de configurações/projetos existentes, single instance, navegação externa, empacotamento e instalação Linux. Validar em ambiente sem checkout/venv de desenvolvimento antes de declarar desktop distribuível.
5. Revisar segurança/ciclo de vida, recursos copiados, licenças, CI e docs; atualizar requisitos com provas reais. Objetivo permanece ativo.
