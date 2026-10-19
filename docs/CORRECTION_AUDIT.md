# Auditoria das correções — 19/10/2026

Escopo: os oito itens registrados em `_reversa_forward/correcoes-2026-10-19/ESTADO.md` após a análise do projeto. Esta tabela registra evidências e lacunas; não declara o objetivo concluído.

| Item | Evidência atual | Situação |
| --- | --- | --- |
| 1. Offline, auditoria e integração | Regressões CLI, requests e Web Push; suíte comum aprovada; configuração Reversa corrigida com autorização | Implementado e testado localmente |
| 2. F2 com modelos reais | Quatro falas PT-BR e música instrumental reais, com recibos/hashes; primeiras imagens reais produzidas | Inferência de imagem/vídeo/SFX e master ainda em homologação |
| 3. Aceite F2 | Verificador mede frames, fps, amostras, drift, loudness e true peak; revisão artística vinculada ao hash | Verificadores testados; filme integral e revisão ainda pendentes |
| 4. F3 | Kill de processo após commit e reabertura em dois processos; cancelamento concorrente; retake idempotente; publicação CPU/FFmpeg atômica; referência removida bloqueia despacho | Comportamentos cobertos por testes reais de processo/FFmpeg; retomada interna de sampler GPU não demonstrada |
| 5. Modularização | Rotas de preferências extraídas com testes HTTP/persistência; apresentação do Director extraída com Vitest | Extrações coesas implementadas; arquivos centrais continuam grandes |
| 6. Reprodutibilidade | Parser/auditor corrigidos e testados; leitura de requirements real preserva URLs, extras e marcadores; auditoria do ambiente local registra diferenças | Auditoria executada; cinco instalações E0–E4 com resolução e hashes não homologadas |
| 7. Documentação | README corrigido; HANDOFF/TODO/gauntlet identificam histórico e apontam estado atual | Atualizado; manter evidências de F2 conforme a execução |
| 8. Gates finais | Python, smoke, Vitest, contratos, lint, build e Chromium executados; guard aprovado após retirada autorizada de `.claude/` do índice | Reexecutar Python após as últimas correções do worker; CI remoto não executado |

## Problemas encontrados na execução real

- O primeiro prompt de imagem continha contexto JSON que o parser interpretou como macros. A tentativa não produziu mídia, mas o worker a marcava `completed`: corrigido. Um pedido inválido no backend atualizado respondeu `failed` com `Task validation failed for 1/1 tasks`.
- Pedidos de imagem precisam de `image_mode=1`, `video_length=1` e modo `image`; sem isso, o runtime pode salvar um vídeo de um frame. O runner agora define esses parâmetros e rejeita formatos inesperados.
- As primeiras imagens sem referência visual apresentaram cubo duplicado e lâmpadas acesas antes da ação prevista. A tentativa foi preservada e rejeitada na inspeção; uma segunda tentativa visual usa o Flux 2 Klein instalado, descrições explícitas em inglês e âncoras de personagem/ambiente. Falas e música são reutilizadas pelos recibos íntegros, sem nova inferência desses jobs.
- O worker de SFX não deve converter uma referência ausente em geração apenas por texto, nem declarar sucesso sem seu próprio arquivo. Esses casos e a preservação de arquivos de outros produtores ganharam regressões.

## Auditoria do ambiente local

O relatório não versionado `app/outputs/validacao-f2-2026-10-19/environment-audit.json` compara as 81 declarações do requirements com metadados do ambiente em `app/env`. Encontrou 24 declarações aplicáveis sem pacote instalado, oito divergências de versão (incluindo a declaração duplicada de `vector-quantize-pytorch`) e uma divergência/ausência de origem de wheel por URL. Nove nomes de pacote não possuem pin; 76 nomes não possuem hash de artefato no arquivo-fonte.

Isso não é falha automática de todas as funções do produto: parte das dependências serve a modelos/ferramentas opcionais. Também não é prova de ambiente reproduzível. Não foram alteradas dependências do ambiente em uso para forçar coincidência com o requirements durante a geração. Metadados instalados não comprovam hashes dos wheels, nem equivalem a resolver e instalar os cinco perfis.
