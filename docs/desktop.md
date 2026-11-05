# Cue Studio Desktop — Linux x86_64

Rust/Tauri gerencia a janela e um único worker Python/PyTorch privado.
O worker atende apenas em loopback, com token do supervisor e cookie de
sessão HttpOnly. A interface HTTP não recebe permissões IPC nativas.

## Instalação e primeiro uso

O build gera `.deb` e `.AppImage` em `ui/src-tauri/target/release/bundle/`.
No Debian/Ubuntu, instale o `.deb` com `sudo apt install ./arquivo.deb`.
As dependências incluem Python 3, venv, compilador C/C++, Git, FFmpeg, GTK e WebKit.
O AppImage também precisa de Python 3/venv, Git e das bibliotecas de áudio/FFmpeg
do sistema; ele não contém um ambiente Python pré-instalado.

```bash
chmod +x "Cue Studio_2.5.2_amd64.AppImage"
"./Cue Studio_2.5.2_amd64.AppImage"
```

O lançador usa FUSE 2. Em ambientes sem FUSE, execute com
`APPIMAGE_EXTRACT_AND_RUN=1`. O host remove os caminhos Python injetados pelo
AppRun para que o motor, o instalador e utilitários externos usem suas próprias
bibliotecas. A homologação desta entrega cobre Ubuntu 24.04 x86_64.

O AppImage inclui o framework multimídia GStreamer (`bundleMediaFramework`),
necessário para reproduzir os resultados na galeria. O `.deb` instala os
plugins de reprodução e libav como dependências. Esse empacotamento segue a
[orientação oficial do Tauri para áudio/vídeo](https://v2.tauri.app/distribute/appimage/#multimedia-support-via-gstreamer).

Clique **Install AI runtime** no primeiro uso. O instalador:

1. Cria ferramentas privadas com `uv==0.13.6` e obtém Python 3.11.
2. Seleciona E3/CUDA 13 quando detecta NVIDIA com driver >=580; nos demais
   casos usa E0/CPU para interface e ferramentas de mídia. Geração IA deste
   aplicativo exige a GPU suportada.
3. Verifica o SHA-256 do lock e instala todas as dependências com
   `--require-hashes`, incluindo o rebuild determinístico de Decord.
4. Executa checagem de dependências e imports reais. Só então grava
   `runtime-ready.json` e inicia o motor.

Tudo fica em `$XDG_DATA_HOME/studio.cue.desktop` (normalmente
`~/.local/share/studio.cue.desktop`): `runtime/env`, uma cópia privada do código
em `runtime/app`, configurações, projetos, modelos e logs. Os recursos de
`/usr/lib` ou do AppImage permanecem somente leitura. Uma instalação interrompida
pode ser repetida; ambientes incompletos não são marcados como prontos.
O instalador não baixa checkpoints nem inicia inferência.

O diagnóstico da instalação fica em `desktop-install.log`; o do motor em
`desktop-worker.log`. **Choose existing runtime** aceita uma instalação
existente com `app/desktop_worker.py` e `app/env/bin/python`.

## Workspace e comportamento nativo

**Import existing workspace** está na tela inicial e no menu nativo. Se o
motor estiver ativo, o aplicativo confirma a interrupção das gerações antes
de reiniciá-lo. A importação copia configurações, salva backup datado e
converte caminhos relativos em absolutos. Projetos, mídia e modelos são
reutilizados nos locais originais. Ela não move pesos nem importa a base
SQLite/fila de um processo em execução. Um recibo `workspace-import-*.json`
registra a origem e os caminhos importados.

Uma segunda abertura foca a janela existente. Links HTTP/HTTPS externos abrem
no navegador do sistema, inclusive popups; endereços locais não pertencentes
ao worker e esquemas como `file:` são recusados. Fechar a janela encerra seu
worker, sem encerrar outros servidores locais.

## Desenvolvimento e gates

Use Node 22.12+ e a toolchain de `ui/rust-toolchain.toml`:

No ambiente de build Ubuntu, instale também `patchelf`,
`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`,
`librsvg2-dev`, `gstreamer1.0-tools`, `gstreamer1.0-plugins-base`,
`gstreamer1.0-plugins-good` e `gstreamer1.0-libav`. O plugin de empacotamento
multimídia requer `patchelf` no PATH; a versão interna do linuxdeploy não
substitui esse pré-requisito. O workflow contém a instalação completa.

```bash
cd ui
npm ci
npm run desktop:dev
```

```bash
cd ui
npm run lint
npm test
npm run test:store
npm run test:control
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
npm run desktop:build
```

O AppImage pode levar vários minutos na coleta de copyright das bibliotecas
GTK: o linuxdeploy consulta dpkg para cada dependência. Não desative essa
coleta para acelerar o build. O staging preserva licenças e exclui pesos,
ambientes, dados e configurações pessoais.

`scripts/desktop-smoke.py` usa janela real via tauri-driver/WebKitWebDriver.
Por padrão usa runtime de desenvolvimento. Para testar um pacote sem injetá-lo,
defina `CUE_DESKTOP_BINARY` e `CUE_DESKTOP_MANAGED_DATA`. Com
`CUE_DESKTOP_INSTALL=1`, o teste clica no instalador e aguarda a instalação real.
`CUE_DESKTOP_EXPECT_SETUP=1` verifica apenas a tela inicial;
`CUE_DESKTOP_TEST_SINGLE_INSTANCE=1` verifica segunda abertura;
`CUE_DESKTOP_TEST_NAVIGATION=1` verifica links usando um navegador de teste.
`CUE_DESKTOP_EXPECT_PROJECT` verifica que um projeto importado aparece na tela;
`CUE_DESKTOP_GENERATION_JSON` habilita uma inferência real com a requisição
desse arquivo. `CUE_DESKTOP_MEDIA_FILENAME` verifica a decodificação de um vídeo
servido pelo motor; uma geração real também verifica seu resultado produzido.
Os testes usam dados isolados e verificam 401/403. Ao final,
removem a sessão WebDriver e encerram seu grupo de processos, verificando que
o worker para quando o host termina. Esse teste de queda do host complementa
os testes Rust de encerramento e coleta do processo pelo supervisor.

O workflow `.github/workflows/desktop.yml` prepara Ubuntu 24.04, executa gates,
gera os pacotes, instala o `.deb`, testa o runtime CPU e a abertura do AppImage,
e guarda os artefatos. A execução remota depende de push; testes locais não
equivalem a um resultado do GitHub Actions.

Para regenerar locks: `python scripts/build_decord_wheel.py`, depois
`app/env/bin/python scripts/refresh_runtime_locks.py --uv CAMINHO_DO_UV`.
Execute `python scripts/verify_runtime_locks.py` e revalide os ambientes.
O script registra a evidência anterior como histórica até a nova instalação.
Veja também `desktop-license-review.md` e `desktop-python-licenses.json`.
