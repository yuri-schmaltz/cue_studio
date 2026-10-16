# Feature A30 — Corpus PT-BR + dicionário de pronúncia

**Origem:** Plano Executivo §7 Eixo 8 + Dossiê R09 + fixture "A luz da oficina".
**Ciclo:** 4.
**Prioridade:** P2.
**Dependência:** nenhuma forte.

## 1. Contexto

Dossiê seção 34: PT-BR precisa de corpus de avaliação com nomes próprios, datas, valores, siglas, termos técnicos, frases curtas/longas, pausas, emoção, multi-sessão. Engines reconhecem pt-br (chatterbox, qwen3-tts, kokoro, kugelaudio) mas sem corpus.

## 2. Requisitos

### 2.1 Comportamento esperado

- Corpus 30+ frases em `tests/audio/ptbr/corpus.json` cobrindo:
  - Números: "1.234,56", "R$ 1.234,56", "15 de outubro de 2026", "23,7 km/h".
  - Nomes próprios brasileiros e estrangeiros: "Hélio Fotógrafo", "Conceição Aparecida", "Yuri Schmaltz".
  - Siglas: "IBGE", "SUS", "UTFPR", "IA".
  - Termos técnicos: "GPU", "CUDA", "FFmpeg", "PyTorch", "Whisper".
  - Emoções: neutra, raiva, sussurro, alegria, tristeza.
  - Velocidades: lenta, normal, rápida.
- Métricas automatizadas: WER via whisper, clipping, latência.
- Métricas manuais: 5 avaliadores brasileiros (1–5 por dimensão).
- Roda corpus contra cada engine (Qwen3-TTS, Kugelaudio, Chatterbox).
- Relatório `docs/benchmarks/pt_br_voices_2026-XX.md` com tabela e áudios de amostra.
- Dicionário de pronúncia editável em `app/data/pronunciation/pt_br.json`.
- Director avisa quando fala tem nome sem pronúncia definida.

### 2.2 Fora de escopo

- Treinar modelo de TTS novo.
- Publicar dataset de pronúncia fonética (IPA) — usar grafia mapeada.
- Validar sotaques regionais extremos (manter escopo Nordeste/Sul/Sudeste).

## 3. Modelo de dados

```python
class CorpusEntry(BaseModel):
    id: str
    text: str
    category: Literal["numbers", "names", "siglas", "technical", "emotion", "speed"]
    emotion: Optional[str] = None  # "neutra", "raiva", "sussurro", "alegria", "tristeza"
    speed: Optional[str] = None    # "lenta", "normal", "rapida"
    expected_pronunciation: Optional[dict[str, str]] = None  # token → pronúncia

class TtsEngine(str, Enum):
    QWEN3_TTS = "qwen3_tts"
    KUGELAUDIO = "kugelaudio"
    CHATTERBOX = "chatterbox"

class TtsEvaluation(BaseModel):
    engine: TtsEngine
    entry_id: str
    wer: float
    clipping: bool
    latency_ms: float
    artifact_path: str
    artifact_sha256: str
    manual_scores: Optional[dict[str, int]] = None  # naturalidade, nome, número, emoção
```

## 4. Endpoints REST

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/audio/voices/corpus` | Lista corpus PT-BR |
| `POST` | `/api/v1/audio/voices/evaluate` | Roda corpus contra engines |
| `GET` | `/api/v1/audio/voices/pronunciations` | Lista dicionário |

## 5. Critérios de aceite

- Corpus tem ≥ 30 frases cobrindo todas as categorias.
- WER < 8% em frases gerais; < 15% em números/nomes.
- Dicionário editável pelo usuário via UI.
- 7 testes verdes no protótipo.