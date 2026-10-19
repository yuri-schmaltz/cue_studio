# Validação da obra de referência

F0 é mídia determinística; F1 usa mídia congelada e geração controlada; F2
exige inferência real e revisão do resultado; F3 exercita falhas e recuperação.
Um teste técnico aprovado não equivale a aprovação artística.

## Gate F2

O teste antigo foi substituído porque gerava tons na etapa de voz e permitia
fallbacks sintéticos para música e vídeo. Os antigos resultados “F2 2/2” não
comprovam geração integral por IA.

O novo teste envia pedidos ao Studio real (`POST /api/v1/generate`) e acompanha
cada job em `/api/v1/status/{id}`. Aceita somente arquivos declarados pelo job
concluído, contidos em seu diretório de saída. Registra ID, parâmetros, estado,
caminho e SHA-256 em `receipts/`. Erro, cancelamento, arquivo ausente ou timeout
não viram sucesso sintético. Timeout conserva o recibo e não cancela o job;
inspecione a fila antes de disparar uma nova execução.

1. Inicie o backend local com os modelos e referências de voz instalados.
2. Crie um workspace exclusivo para validação. Selecione no Studio pedidos
   funcionais para fala PT-BR, música instrumental, imagem com referências visuais, vídeo condicionado
   por imagem e efeitos sonoros. Confirme que o modelo de voz suporta o idioma
   e as referências escolhidas; o nome de um checkpoint não comprova suporte.
3. Crie um JSON fora de arquivos de configuração pessoais com este formato:

```json
{
  "base_url": "http://127.0.0.1:7860",
  "server_output_dir": "/caminho/absoluto/do/workspace",
  "validation_dir": "/caminho/absoluto/dos/artefatos-de-validacao",
  "job_timeout": 3600,
  "image_supports_references": true,
  "speech": {"model_type": "modelo-de-voz-instalado", "workspace": "validacao-f2"},
  "music": {"model_type": "modelo-musical-instalado", "prompt": "[Instrumental]", "workspace": "validacao-f2"},
  "image": {"model_type": "modelo-de-imagem-instalado", "workspace": "validacao-f2"},
  "video": {"model_type": "modelo-de-video-instalado", "workspace": "validacao-f2"},
  "sfx": {"model_type": "modelo-de-efeitos-instalado", "workspace": "validacao-f2"}
}
```

Os IDs acima são placeholders, não modelos fictícios utilizáveis. Acrescente
os parâmetros reais exportados do Studio (passos, resolução, duração nativa,
referência de voz etc.). O teste substitui prompts de fala/imagem/vídeo pelo
briefing canônico. O modelo de imagem deve suportar `image_refs` com `video_prompt_type=KI`;
as âncoras de personagem e ambiente são geradas e usadas em todos os planos pertinentes.
A geração de imagem define `image_mode=1` e um único frame para exigir um arquivo de imagem. O backend e o teste precisam compartilhar o filesystem:
`server_output_dir` é onde o backend realmente grava os arquivos desse workspace.
A geração de vídeo deve fornecer pelo menos 120 frames por plano; a montagem
conforma os clips para slots de 120 frames a 24 fps, sem repetir frames para
esconder uma geração incompleta.

```bash
CUE_RUN_REAL_MODELS=1 CUE_F2_CONFIG=/caminho/f2.json \
  app/env/bin/python -m pytest tests/test_cue_reference_film_f2_real_models.py \
  -m real_models -k generate_and_measure -v
```

Se a API exigir autenticação, configure `CUE_F2_TOKEN` no ambiente. O token
não é gravado nos recibos. A ausência de configuração quando a geração real
é solicitada causa falha; a suíte comum indica esses testes como ignorados.

A geração conserva os arquivos reais e produz stems PCM estéreo a 48 kHz,
com 2.880.000 amostras/canal. Fala maior que sua janela é rejeitada antes de
qualquer corte. Os cues usam offsets em amostras; o master deve ter 1.440
frames, 24 fps, drift A/V de no máximo um frame, −16 LUFS ± 1 LU e true peak
≤ −1 dBTP. O master é validado antes de substituir o destino final.

## Revisão artística

Assista ao master produzido, ouça todas as falas e revise suas terminações.
Crie `creative-review.json` dentro de `validation_dir`, com o SHA-256 do master
real e as notas efetivamente atribuídas:

```json
{
  "master_sha256": "SHA256_DO_MASTER_REVISADO",
  "reviewer": "Nome do avaliador",
  "reviewed_at": "Data e hora da revisão",
  "scores": {
    "identity": 3,
    "continuity": 3,
    "motion": 3,
    "appearance": 3,
    "pt_br_voice": 3,
    "sound_editing": 3
  },
  "critical_errors": [],
  "speech_correct_and_untruncated": true,
  "title_correct": true
}
```

Esse exemplo é um formato, não uma revisão realizada. Cada dimensão deve
receber nota ≥ 3 em escala de 0 a 4. Registre qualquer erro crítico em vez de
preencher uma lista vazia por conveniência. Uma nova versão do master invalida
a revisão anterior pelo hash.

```bash
CUE_RUN_REAL_MODELS=1 CUE_F2_CONFIG=/caminho/f2.json \
  app/env/bin/python -m pytest tests/test_cue_reference_film_f2_real_models.py \
  -m real_models -k full_acceptance -v
```

## Recuperação F3

Os testes comuns cobrem encerramento abrupto de processo após commit SQLite,
reabertura em dois processos independentes, cancelamento antes de conclusão
tardia, replay de retake após reabrir o banco, publicação validada/atômica e
referência removida antes do despacho. Usam CPU/FFmpeg e não comprovam retomada
interna de difusão nem qualidade artística após falha de GPU.

```bash
app/env/bin/python -m pytest -q \
  tests/test_recovery_process.py tests/test_cue_reference_film_f3_recovery.py \
  tests/test_media_publication.py tests/test_director_input_recovery.py
```
