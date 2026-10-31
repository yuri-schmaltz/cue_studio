# Validação da obra de referência

F0 usa mídia determinística; F1 usa mídia congelada e geração controlada; F2 exige inferência real e revisão humana; F3 cobre falhas e recuperação. Resultados técnicos não equivalem a aprovação artística. O histórico detalhado está [preservado](history/REFERENCE_FILM_VALIDATION_legacy.md); o master v10 histórico foi **reprovado** conforme [handoff v11](HANDOFF_V11.md).

## Produção real

O runner `tests/test_cue_reference_film_f2_real_models.py` envia pedidos a `POST /api/v1/generate`, acompanha `/api/v1/status/{id}` e aceita somente arquivos de jobs concluídos, contidos no diretório de saída. Cada recibo guarda pedido, job, artefato e SHA-256. Falha não gera mídia substituta. Timeout preserva o job; inspecione a fila antes de retomar. Não reinicie o backend com geração ativa.

Use backend/modelos instalados, workspace exclusivo e configuração separada dos arquivos pessoais. Backend e runner precisam compartilhar o filesystem. Exemplo estrutural, com IDs e diretórios a preencher a partir de pedidos reais do Studio:

```json
{
  "base_url": "http://127.0.0.1:7870",
  "server_output_dir": "/caminho/outputs",
  "validation_dir": "/caminho/outputs/film-v2",
  "job_timeout": 7200,
  "image_supports_references": true,
  "character_anchor_seed": 99,
  "speech": {"model_type": "ID_REAL", "workspace": "validacao"},
  "music": {"model_type": "ID_REAL", "workspace": "validacao"},
  "image": {"model_type": "ID_REAL", "workspace": "validacao", "guidance_scale": 1, "NAG_scale": 1.5},
  "video": {"model_type": "ID_REAL", "workspace": "validacao"},
  "sfx": {"model_type": "ID_REAL", "workspace": "validacao"}
}
```

Acrescente os parâmetros reais do modelo: resolução, passos, duração e referências necessárias. Imagem precisa suportar `image_refs` com `video_prompt_type=KI`; o runner define `image_mode=1`. Para Flux2, o negativo depende de NAG > 1 e guidance <= 1, verificadas pelo runner. Vídeo precisa produzir pelo menos 120 quadros por plano: o edit conforma a 1280×720/24 fps e não repete quadros para ocultar geração incompleta. Fala deve caber nos cues sem cortar palavras. Modelos são liberados entre lotes para caber na VRAM.

```bash
CUE_RUN_REAL_MODELS=1 CUE_F2_CONFIG=/caminho/f2.json \
  app/env/bin/python -m pytest tests/test_cue_reference_film_f2_real_models.py \
  -m real_models -k generate_and_measure_real_jobs -q -s
```

Configure `CUE_F2_TOKEN` se a API exigir autenticação. O token não é persistido. Não oculte CUDA no backend ou nesse runner. `CUDA_VISIBLE_DEVICES=''` é usado somente nas suítes CPU.

## Receita, provas e retomada

A receita canônica está em `tests/fixtures/cue_reference_film_v1/`: personagem, ambiente, prompts por plano, fala, efeitos e expectativas. A configuração F2 pode apontar `visual_recipe` para um JSON candidato; ele precisa cobrir exatamente os 12 planos. O runner conserva seus bytes em `visual-recipe.json`, recusa alteração em retomadas no mesmo diretório e registra o SHA-256 no relatório. O probe conserva `recipe-used.json` com a mesma regra. Uma seed correta na âncora não garante identidade nos planos ou vídeos. Antes de novo lote completo, use probes:

```bash
app/env/bin/python scripts/probe_reference_recipe.py \
  --config /caminho/f2.json --recipe /caminho/recipe.json \
  --output /caminho/probes-v2 --source-receipts /caminho/probes-v1/receipts \
  --stages character,location,S06-image,S06-video
```

O probe reutiliza apenas recibo concluído com **pedido exatamente igual**, artefato dentro da raiz e SHA-256 válido. Não sobrescreve recibos existentes. Parâmetros alterados exigem diretório novo. Receita candidata não vira canônica antes de sua verificação. Preserve relatórios reprovados e diferencie aprovação de instalação, métricas do filme e revisão artística.

## Condicionamento por quadro final

Uma entrada de plano em `visual_prompts.json` pode declarar `end_image`, um prompt de edição para produzir o estado final a partir do **still inicial daquele plano**. O runner gera `Sxx-end-image` via inferência com `image_refs=[still_inicial]`, mede cubo/lentes/separação aplicáveis e envia o vídeo com `image_prompt_type=SE`, `image_start` e `image_end`. Sem `end_image`, o comportamento continua somente com quadro inicial. Para pausas que terminam no mesmo estado, `end_image_source: "start"` usa o próprio still real também como quadro final, sem criar outro job de imagem. Ações que mudam o estado, como acender a lâmpada ou inserir o cubo, precisam de um final próprio. As duas opções são mutuamente exclusivas.

No probe, use `--stages S09-image,S09-end-image` para gerar e inspecionar os quadros antes de pedir `--stages S09-video`. A retomada de vídeo confere também os pedidos dos stills e âncoras contra a receita atual, além dos SHA-256. Um arquivo íntegro pertencente a outra receita é recusado antes de liberar o modelo ou submeter vídeo. Gere em diretório novo quando mudar prompts/condicionamento.

Nesta instalação, o backend remove oito quadros finais do LTX condicionado por imagem final. A configuração de máquina admite `video.end_frame_padding: 8`: o builder pede esses quadros **adicionais ao modelo**, preservando uma janela única quando cabível, e remove esse campo auxiliar antes de enviar a API. A margem depende do modelo/runtime. O teste exige tempo nativo suficiente para o slot: 121 quadros a 25 fps somam 4,84 s e não cobrem cinco segundos a 24 fps, mesmo tendo mais de 120 quadros. Duração insuficiente vira falha no `shot-evidence.json`, sem completar com repetição.

Pedidos HTTP novos sem `settings_version` recebem a versão atual antes da preparação. Versões explícitas são preservadas, e arquivos de fila antigos continuam na migração legada. Isso evita descartar o tamanho de janela de um pedido atual e criar janelas extras. Para reproduzir a configuração desta rodada, `video.settings_version` é 2.58.

Esse recurso precisa de prova real para a receita escolhida: aceitar um parâmetro na API não comprova que o modelo manteve a composição. Os gates e a revisão humana continuam obrigatórios.

## Portas atuais

- Âncora: exatamente três lentes ciano. Imagens frontais e vídeos dos planos `identity_view=face` também exigem três; detalhes de mão (`hands`) não enquadram rosto. O usuário autorizou perfil natural em S06 (`profile`): stills frontais mantêm a contagem exata, enquanto o vídeo registra lentes visíveis, rejeita lentes extras e exige revisão da cabeça e identidade durante toda a caminhada. Ausência de lentes visíveis não comprova presença da cabeça; a evidência fica `review-required`.
- Cubo: contagem nos stills, continuidade nos vídeos, nenhuma duplicação. S10 não pode conter cubo; visibilidade exigida/evidência segue o runner por plano.
- Escala: estabilidade dentro dos planos mensuráveis e régua cabeça/cubo. Consistência entre S04/S07 exige que **todos sejam mensuráveis**, sem transformar ausência de medição em aprovação. S06 registra a régua como evidência: a rotação para perfil muda a projeção da largura das lentes em relação ao cubo, exigindo revisão da escala física durante a caminhada.
- Separação: cubo e bulbo não podem sobrepor. Detector de luz usa forma/HSV para excluir madeira. Bulbo apagado pode ser não mensurável: o relatório declara isso. S11/S12 e vídeos S09/S11/S12 exigem um par mensurável.
- Chão: distância entre robô e sombra é evidência; aparência e contato físico ainda exigem revisão humana.
- Som: fala completa dentro do cue, ambiente com loop contínuo, música cobrindo todo o filme, balanço e margem sobre narração. Cinco efeitos vêm de inferência real após aprovação dos planos.
- Master: duração/quadros/resolução/codec, áudio PCM dos stems, loudness/true peak e vínculo SHA-256 são verificados pelos serviços de referência.

`shot-evidence.json` é gravado antes de efeitos/master e conserva todas as falhas. `sound-evidence.json` conserva medições sonoras. `technical-report.json` descreve somente o master efetivamente validado. Não afrouxe limites para promover uma receita reprovada.

## Revisão humana

Só construa e sirva revisão depois de master e relatório técnico válidos e vinculados:

```bash
app/env/bin/python scripts/build_reference_review.py /caminho/film-v2
app/env/bin/python scripts/serve_reference_review.py /caminho/film-v2 --check
app/env/bin/python scripts/serve_reference_review.py /caminho/film-v2 --port 8765
```

O servidor verifica os arquivos e suporta HTTP Range, necessário para reprodução de áudio/vídeo. A página pede notas 0–4 em identidade, continuidade, movimento, aparência, voz PT-BR e montagem sonora, além de erros críticos, fala completa e título correto. O revisor exporta `creative-review.json`; guarde-o na pasta do master.

O gate final exige revisor/data reais, SHA-256 correspondente, notas 3–4 em todas as dimensões, nenhum erro crítico e confirmação de fala/título. O agente não preenche aprovação pelo usuário.

```bash
CUE_RUN_REAL_MODELS=1 CUE_F2_CONFIG=/caminho/f2.json \
  app/env/bin/python -m pytest tests/test_cue_reference_film_f2_real_models.py \
  -m real_models -k full_acceptance_requires_creative_review -q
```

Estado desta execução: [CURRENT_STATE.md](CURRENT_STATE.md). Jobs, diretórios e próximos passos: [checkpoint](../_reversa_forward/correcoes-2026-10-30/ESTADO.md).
