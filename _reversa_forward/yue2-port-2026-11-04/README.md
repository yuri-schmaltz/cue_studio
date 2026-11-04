# Material do port do YuE2 (upstream Wan2GP) — 04/11/2026

Este diretório guarda o material do port do **YuE2** (o modelo de música
atual do Wan2GP) que foi preparado e **não integrado**, com o motivo
documentado.

## Por que não foi integrado

O motor de inferência do YuE2 (`shared/llm_engines/lmgp/`, 34 arquivos) depende
do **mmgp 4.5.0**: `cuda_graphs`, `runtime`, `transfer`, `pinned`, `allocator`.
O Cue Studio fixa `mmgp==3.7.12` (pip) e o PyPI só publica até 3.8.2 — o
upstream distribui o 4.5.0 dentro do próprio repositório. Subir o gerenciador
de memória global do app sem poder testar os pesos de Wan, Flux e LTX2 seria
um risco desproporcional ao ganho de um modelo de música.

O material abaixo é o ponto de partida quando essa decisão for tomada.

## Conteúdo

| Caminho | O que é |
|---|---|
| `upstream/models/TTS/yue2/` | Implementação do YuE2 (14 arquivos `.py` + configs + licenças) |
| `upstream/shared/llm_engines/lmgp/` | Motor de inferência (LLM/Qwen3, KV cache, CUDA graphs) |
| `upstream/shared/kernels/` | Kernels de Triton que o motor usa (`fla_*`, `qwen_gdn`, `qwen_rope_cache`, `dispatch`, `triton_compilation_log`) |
| `upstream/shared/llm_engines/snapshot_cache.py` | Cache de snapshots do motor |
| `upstream/shared/lora_mapper.py`, `upstream/models/help_shared.py` | Dependências do handler do YuE2 |
| `upstream-tree.json` | Árvore completa do upstream, para continuar o closure de imports |
| `yue_download.py` | Script de download dos pesos do **YuE v1** pelo fluxo do app (usado na validação) |
| `yue_generate.py` | Script de geração de uma faixa de teste (YuE v1), com `offload.profile` |

## Como retomar

1. Subir o `mmgp` para 4.5.0 (vendorizar `mmgp/` do upstream na raiz do app,
   como o upstream faz) e revalidar as famílias de vídeo.
2. Copiar `upstream/models/TTS/yue2/` para `app/models/TTS/yue2/` e
   `upstream/shared/llm_engines/lmgp/` para `app/shared/llm_engines/lmgp/`.
3. Rodar o closure de imports contra o repo (o `upstream-tree.json` permite
   refazer a varredura) e adaptar `shared.llm_engines.lmgp` para o motor
   `nanovllm` que já existe no app.
4. Registrar o handler em `app/wgp.py`, criar `app/defaults/yue2.json`
   (o upstream já traz `defaults/yue2.json` e `defaults/yue2_hum.json`) e
   repetir o caminho de UI/capabilities/guia que o YuE v1 já percorreu.

Detalhe completo em [docs/HANDOFF_YUE_MUSIC.md](../../docs/HANDOFF_YUE_MUSIC.md).
