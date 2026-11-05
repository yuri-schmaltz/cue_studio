# Revisão de licenças da distribuição desktop — 05/11/2026

O aplicativo mantém a **WanGP Non-Commercial Evaluation License 1.1**,
conforme `LICENSE` e `app/LICENSE.txt`. A migração para Tauri não altera
esses termos. Ambos os avisos são preservados nos recursos do pacote.

## Escopo conferido

- Metadados e arquivos de licença das 307 distribuições Python do runtime
  E3 instalado: inventário em `desktop-python-licenses.json`.
- Metadados Rust obtidos de `cargo metadata` e dependências JavaScript de
  produção obtidas do package-lock: `desktop-native-licenses.json`. O conjunto
  é conservador e pode conter itens removidos pelo target/tree shaking.
- Fontes vendorizadas: o staging preserva LICENSE, COPYING e NOTICE das
  subpastas; não inclui checkpoints ou ambientes Python preexistentes.
- O AppImage usa a coleta de copyright do linuxdeploy habilitada. Essa
  coleta consulta dpkg para bibliotecas do sistema e pode levar minutos.
- O framework GStreamer e os plugins presentes no build são incluídos para
  reprodução de mídia. Seus avisos de copyright acompanham o pacote; libav e
  plugins adicionais podem ter termos LGPL/GPL diferentes dos do host Rust.
- Os wheels instalados no primeiro uso mantêm seus próprios arquivos de
  licença no ambiente privado. O rebuild Decord preserva os arquivos
  originais, inclusive licença, alterando apenas metadados de empacotamento.

## Pontos encontrados

- `mmgp` inclui GPL versão 3. Há também componentes LGPL/GPL no ecossistema
  de mídia e bibliotecas nativas. O inventário não estabelece compatibilidade
  entre esses termos e a licença não comercial do aplicativo.
- Quatorze distribuições não declaram uma licença no campo de metadados.
  A leitura dos arquivos inclusos identifica MIT em addict, fla-core,
  flash-linear-attention, pyannote-core/database/pipeline/metrics e
  pytorch-metric-learning; Apache 2.0 em ffmpeg-python e segment-anything;
  GPLv3 em mmgp. espeakng-loader, primePy e sentencepiece não apresentam
  arquivos de licença no inventário do wheel e permanecem sem classificação
  por essa evidência.
- Checkpoints não são distribuídos no instalador. Suas condições de uso
  devem acompanhar cada download; os termos do aplicativo não concedem
  permissões sobre os modelos.

Esta revisão registra evidências e questões para distribuição. Não é uma
declaração de liberação jurídica para publicação comercial. O aplicativo
permanece sujeito aos termos não comerciais existentes.
