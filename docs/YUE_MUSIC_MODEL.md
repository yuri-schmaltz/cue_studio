# YuE — modelo generativo de música

O **YuE** (m-a-p / HKUST) entra no Cue Studio como modelo de música de dois
estágios: um planejador de 7B parameters escreve a música segmento a segmento a
partir da letra, e um modelo de 1B renderiza as faixas vocal e instrumental com
o codec neural xcodec.

A implementação já existia no repositório (`app/models/TTS/yue/`) mas nunca foi
integrada de ponta a ponta: não havia definição de catálogo, o import do
`LlamaForCausalLM` apontava para um módulo inexistente (`shared.llama_3_2`) e a
lista de download do handler trazia apenas `config.json` — ou seja, os pesos
nunca eram baixados e o pipeline não importava. Este documento descreve o que
foi feito e como usar.

## Variantes

| Model type  | Estágio 1 (planejador)                | Condicionamento por áudio |
|-------------|---------------------------------------|---------------------------|
| `yue`       | `m-a-p/YuE-s1-7B-anneal-en-cot`        | não                        |
| `yue_icl`   | `m-a-p/YuE-s1-7B-anneal-en-icl`        | sim (até 30 s de referência) |

O estágio 2 (`m-a-p/YuE-s2-1B-general`) e o codec (`m-a-p/xcodec_mini_infer`)
são compartilhados pelas duas variantes.

## Como o modelo é exposto

- **Catálogo**: `app/defaults/yue.json` e `app/defaults/yue_icl.json`
  (descobertos automaticamente por `wgp.load_model_definitions()`).
- **Handler**: `app/models/TTS/yue_handler.py`, já registrado em
  `family_handlers` dentro de `app/wgp.py`.
- **Capacidades**: `yue` e `yue_icl` declarados como `mode: music` com
  `audio_generate` + `music_gen` em `app/capabilities_matrix.json` e no
  catálogo padrão de `app/services/capability_matrix.py`.
- **UI**: entram no grupo *Music* (prefixo `yue` em
  `ui/src/stores/useStore.ts`), aparecem com nome e badge próprios em
  `ProjectSetupForm.tsx` e estão no seletor de música do Director
  (`DirectorSongSetup.tsx`).

## Prompt: letra no prompt, tags no alt_prompt

O YuE não recebe uma "caption" como o MiniMax-Music3. O estágio 1 recebe:

```
[Genre] pop, dreamy, warm vocal, female, nostalgic
[Verse]
Morning light filters through the pines
...
```

Ou seja:

- `prompt` = **letra** com seções (`[Verse]`, `[Chorus]`, `[Bridge]`, `[Outro]`);
- `alt_prompt` = **lista de tags** separadas por vírgula (gênero, andamento,
  instrumentos, humor, timbre vocal).

Os guias de escrita de músicas (`app/services/llm_guides/music/song_writer_yue.md`
e `song_writer_yue_instrumental.md`) seguem esse formato e são selecionados
automaticamente em `/api/v1/llm/write-song` e
`/api/v1/director/generate-music` quando o modelo escolhido é YuE.

Para faixa instrumental, a letra precisa ser exatamente `[Instrumental]` e a
primeira tag do estilo deve ser `instrumental`.

## Download

O download acontece pelo fluxo padrão do app (Model Downloads / primeira
geração). São necessários cerca de **18 GB**:

| Arquivo                                                    | Tamanho |
|------------------------------------------------------------|---------|
| `YuE-s1-7B-anneal-en-cot/model-0000{1,2,3}-of-00003.safetensors` | ~12,4 GB |
| `YuE-s2-1B-general/model.safetensors`                      | ~3,9 GB  |
| `xcodec_mini_infer` (encoder final, vocoders, pastas auxiliares) | ~2 GB   |

O estágio 1 é fragmentado: o handler resolve os shards da pasta
`ckpts/YuE-s1-7B-anneal-en-cot/` e o loader do MMGP mescla os três arquivos.
O estágio 2 vem pelo grupo `URLs2` do catálogo e o codec pela definição de
download do handler.

## Hardware

- O planejador de 7B roda em bf16 (~12,4 GB). Em GPUs com 12 GB ou menos ele
  fica **parcialmente na memória do sistema** (offload do MMGP): a primeira
  geração é bem mais lenta que as seguintes.
- Cards de 16 GB+ ou mais rodam o Stage 1 inteiro em VRAM.
- O `flash_attn` é opcional: sem ele, o modelo usa SDPA.

### Tempo de geração

O Stage 1 emite **dois tokens por quadro** (um por codebook) a 50 fps: um
segmento de 6 s custa ~600 tokens. Cada token retransfere a parte do planner
que não cabe na VRAM, então o custo é proporcional ao que sobra de VRAM para
o modelo. Medido na RTX 3060 (12 GB):

| Orçamento de VRAM do planner | Tempo por token | Segmento de 6 s |
|---|---|---|
| 100 MB (padrão genérico do app) | > 8 s | > 80 min |
| 50% da VRAM | ~1,9 s | ~19 min |
| 70% da VRAM (padrão do YuE) | ~1,3 s | ~13 min |

Por isso os defs do YuE declaram `memory_profile` e `vram_budgets`: o
padrão genérico do app foi feito para difusão de vídeo, onde o VRAM é para
os latentes, e deixa o LLM do YuE retransferindo 12 GB a cada token.

## Limitações conhecidas

- O YuE escreve **um segmento por vez**; letras muito longas ou com muitas
  seções aumentam o tempo de geração proporcionalmente.
- O estilo é textual e por tags — não há controle de BPM, clave ou
  time signature (ao contrário do MiniMax-Music3).
- Não há exportação de partitura (ABC/MIDI) nesta versão.
- A variante `yue_icl` exige um áudio de referência e não participa do fluxo
  do Director (que não tem upload de áudio).

## Licença

Pesos e código do YuE/xcodec sob **Apache-2.0** (repositórios `m-a-p/YuE-*` e
`m-a-p/xcodec_mini_infer`). O Cue Studio mantém as atribuições em
`THIRD_PARTY_NOTICES.md`.