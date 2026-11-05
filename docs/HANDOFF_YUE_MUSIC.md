# Handoff — YuE (modelo generativo de música) no Cue Studio

Escopo deste documento: **a integração do modelo de música YuE no Cue Studio**
e as melhorias planejadas em torno dela. Não substitui o
[HANDOFF.md](../HANDOFF.md) do ciclo geral do projeto.

- Base: `main`, `857dd5d` ("Faz o YuE rodar de ponta a ponta"). Os arquivos de
  catálogo, UI, guias e testes deste trabalho entraram em `56c1fbb` e `395eb3d`
  (outra sessão commiteu a árvore de trabalho inteira); o commit `857dd5d`
  fecha o que faltava para o modelo realmente carregar e gerar.
- Documento do modelo: [docs/YUE_MUSIC_MODEL.md](YUE_MUSIC_MODEL.md).
- Hardware da validação: RTX 3060 12 GB, 913 GB livres em disco.

## O problema que motivou

O código do YuE estava no repositório (`app/models/TTS/yue/`, pipeline de dois
estágios copiado do projeto m-a-p/YuE) e o handler estava registrado em
`app/wgp.py`, mas **nada funcionava**:

1. `from shared.llama_3_2.llama_patched import LlamaForCausalLM` — módulo
   inexistente no repositório (o `llama_patched.py` estava dentro de
   `app/models/TTS/yue/`). O pipeline não importava.
2. Sem `app/defaults/yue*.json` o modelo não entrava no catálogo, logo não
   aparecia na UI nem podia ser baixado.
3. A lista de download do handler trazia apenas `config.json` — os 18 GB de
   pesos nunca eram baixados.
4. O Stage 1 é fragmentado em três shards; o carregador esperava um arquivo só.
5. O codec xcodec precisava da pasta `utils` (não baixada) e de duas
   dependências ausentes do ambiente (`argbind`, `tensorboard`), além da
   distribuição `audiotools`, que não existe no PyPI.
6. O codec e os vocoders ficavam na CPU enquanto as entradas iam para a GPU.

## O que este ciclo entregou

**Catálogo e download.**
- `app/defaults/yue.json` e `app/defaults/yue_icl.json`: duas variantes
  (planejador CoT e ICL), com URLs de Stage 1 (índice dos shards) e Stage 2.
- `app/models/TTS/yue_handler.py`: lista real de arquivos por estágio, pasta
  `utils` do codec, resolução dos três shards por pasta e do Stage 2 pelo grupo
  `URLs2` (com guarda de tamanho para não pegar arquivo homônimo de outro
  modelo).
- `app/models/TTS/yue/pipeline.py`: import corrigido, Stage 1 aceitando lista de
  shards, codec e vocoders movidos para o dispositivo.
- `app/models/TTS/yue/audiotools_compat.py`: substituto mínimo e permissivo
  para `audiotools` (só o registro de listas do `dac/__init__.py` é usado em
  tempo de import; `Encoder`/`Decoder`, que são os módulos instanciados, são
  `nn.Module` comuns).
- `app/requirements.txt`: `tensorboard==2.21.0` e `argbind==0.3.9`.

**Produto.**
- `app/services/llm_guides/music/song_writer_yue.md` e
  `song_writer_yue_instrumental.md`: o YuE pede **letra no prompt e tags de
  estilo no alt_prompt**, não a caption do MiniMax-Music3.
- `app/launch.py`: `/api/v1/llm/write-song` e
  `/api/v1/director/generate-music` escolhem o guia do YuE automaticamente.
- `app/capabilities_matrix.json` + `app/services/capability_matrix.py`:
  `yue` e `yue_icl` como `mode: music`.
- UI: prefixo `yue` no grupo Music (`useStore.ts`), badge e nome em
  `ProjectSetupForm.tsx`, entrada no seletor do Director
  (`DirectorSongSetup.tsx`).
- `tests/test_yue_music_model.py` (18 testes) e
  `docs/YUE_MUSIC_MODEL.md`; `THIRD_PARTY_NOTICES.md` com a atribuição
  Apache-2.0 do YuE/xcodec.

## Decisões que precisam ser conhecidas

**YuE2 (upstream) foi descartado de propósito.** O Wan2GP já evoluiu para
**YuE2** (`models/TTS/yue2/`), que pesa 2,9 GB (bf16) / 1,5 GB (int8) e
exporta partitura ABC/MIDI. O port foi feito e depois revertido porque o motor
`lmgp` do upstream depende do **mmgp 4.5.0** (`cuda_graphs`, `runtime`,
`transfer`, `allocator`), e o Cue Studio fixa `mmgp==3.7.12` — o PyPI só vai
até 3.8.2. Trocar o gerenciador de memória global ameaçaria Wan, Flux e LTX2
sem chance de testar esses pesos aqui. **YuE2 continua sendo o caminho
correto** quando o mmgp puder subir; o material portado (66 arquivos, 944 KB)
está guardado em
[_reversa_forward/yue2-port-2026-11-04/](../_reversa_forward/yue2-port-2026-11-04/README.md),
com o procedimento de retomada.

**O YuE v1 é pesado por natureza.** O planejador de 7B não cabe nos 12 GB da
RTX 3060: ele roda com streaming de pesos via MMGP. Com o perfil conservador
(`LowRAM_LowVRAM`, o padrão do app para áudio) e o orçamento genérico de VRAM
(100 MB do "transformer" residentes) o Stage 1 leva **mais de 20 minutos** para um
segmento: o LLM precisa retransferir 12 GB de pesos a cada token gerado. Isso
é característica do YuE v1, não bug da integração — mas o app passou a dar
dois levers para não pagar esse preço:

| Chave no def | Efeito | Onde é honrada |
|---|---|---|
| `"memory_profile": 2` | escolhe `HighRAM_LowVRAM` (cópia em RAM reservada + transferências assíncronas) em vez do perfil de áudio padrão (4.5) | `wgp.compute_profile` |
| `"vram_budgets": {"transformer": "50%", "transformer2": "20%"}` | mantém ~6 GB do planner e ~2,5 GB do renderer residentes na VRAM, em vez de 100 MB | `wgp.init_pipe` |

A escolha explícita do usuário (o slider "VRAM (MB) for Preloaded Models" e o
perfil no painel) sempre vence as declarações do def — os levers do catálogo
só entram quando o usuário não escolheu nada.

## Estado da validação

Comprovado nesta máquina:

- `wgp` registra `yue` e `yue_icl` como modelos visíveis (`displayed_model_types`).
- Download completo pelo fluxo do app: 12,4 GB (3 shards) + 3,9 GB (Stage 2) +
  1,8 GB (xcodec) + tokenizer.
- Carregamento do pipeline: Stage 1, Stage 2, codec e os dois vocoders entram
  em RAM reservada e registram hooks de offload; o Stage 1 começa a gerar.
- `pytest tests/test_yue_music_model.py` → 18 aprovados;
  `tests/test_capability_matrix.py` → 28 aprovados (contagens atualizadas).
- `tsc -b` da UI não acusa erro novo (os erros restantes são pré-existentes de
  outra sessão).

**Ainda não comprovado:** o WAV final. A geração completa não terminou dentro
da janela desta conversa — o processo foi encerrado junto com o shell
interrompido, não por erro do modelo. O script de validação ficou em
`/tmp/yue_generate.py` e o log em `/tmp/yue_generate2.log`.

## Como validar (reprodução)

```bash
# 1. Baixar os pesos pelo fluxo do app (18 GB)
cd app && env/bin/python ../_reversa_forward/yue2-port-2026-11-04/yue_download.py

# 2. Gerar uma faixa de teste
cd app && env/bin/python ../_reversa_forward/yue2-port-2026-11-04/yue_generate.py
#   -> /tmp/yue_validation.wav
```

O script de geração replica o preparo de memória do app
(`offload.profile` com `profile_no=HighRAM_HighVRAM`), **sem o qual** o
embedding do Llama fica na CPU e a entrada na GPU causa
`Expected all tensors to be on the same device`.

## Melhorias planejadas

Prioridade alta:

1. **Fechar a validação de ponta a ponta** — rodar `/tmp/yue_generate.py` até
   o fim, confirmar o WAV (44,1 kHz estéreo) e anexar o recibo em
   `app/outputs/validation-2026-11-04/`. Sem isso a integração está "provada por
   partes".
2. **Escolher o perfil de memória do YuE no app.** ~~Hoje o app usa o perfil de
   áudio padrão (conservador) e o Stage 1 fica lentíssimo.~~ **Feito:**
   `wgp.compute_profile` agora aceita `model_type` e honra a chave
   `memory_profile` declarada no def do modelo; `yue.json` e `yue_icl.json`
   declaram `"memory_profile": 2` (`HighRAM_LowVRAM`, que mantém uma cópia do
   planner em RAM reservada e carrega na VRAM só o que cabe). A escolha
   explícita do usuário na UI continua prevalecendo sobre a declaração.
   Coberto por `tests/test_yue_music_model.py`.
3. **Expor o `yue_run_n_segments` e `yue_segment_duration` na UI.** Hoje são
   constantes do `model_def`; com a letra em seções, controlar quantos
   segmentos são gerados é o ajuste mais útil para o tempo e o tamanho da
   faixa.
4. **Duração real no slider.** O YuE não tem `duration_seconds` nativo — o
   tempo vem do número de segmentos × 6 s. O slider de duração atual mente
   para este modelo.

Prioridade média:

5. **Substituir o YuE v1 pelo YuE2** quando o mmgp puder subir para 4.5.0 —
   pesos 6× menores, partitura ABC/MIDI, condicionamento por áudio e motor
   `lmgp`. Requer: vendorizar `shared/llm_engines/lmgp/` (66 arquivos já
   baixados em `/tmp/up/mirror`), `shared/lora_mapper.py`,
   `models/help_shared.py` e as pastas `shared/kernels/*` que faltam; trocar o
   `mmgp` do ambiente; e revalidar as famílias que dependem do offload.
6. **Guia de estilo por tags mais rico** — o modelo responde bem a tags de
   instrumento/vocal; vale um gerador de tags no mesmo formato do
   `song_writer_yue.md`.
7. **Registro de `yue_icl` na UI de áudio** com upload de referência (hoje só
   aparece no catálogo; o Director não tem upload de áudio).

Riscos conhecidos:

- `app/models/TTS/yue/pipeline.py` e o `llama_patched.py` são código de
  terceiros (Apache-2.0) mantidos quase como vieram; mudanças ali precisam
  preservar os cabeçalhos.
- O `audiotools_compat.py` cobre o que o DAC importa, não a API completa: se
  o codec passar a chamar `audiotools` em tempo de execução, o substituto
  precisa virar dependência real.
- O Stage 2 é baixado pelo nome genérico `model.safetensors` na raiz de
  `ckpts/`; a guarda de tamanho no handler cobre a colisão, mas um dia vale
  um nome próprio.
