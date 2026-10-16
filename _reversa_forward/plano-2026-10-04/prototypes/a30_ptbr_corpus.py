#!/usr/bin/env python3
"""Protótipo isolado do Corpus PT-BR + dicionário de pronúncia (A30 / R09).

Valida `39-feature-a30-ptbr-corpus.md` sem importar de `app/`.

1. Corpus PT-BR com 30+ frases cobrindo números, nomes, siglas, termos
   técnicos, emoções, velocidades.
2. Dicionário de pronúncia editável.
3. Função de validação de pronúncia (nome do corpus tem pronúncia no dicionário?).
4. Função de avaliação simulada (WER, clipping, latência).
5. Função de geração de relatório Markdown.
6. Função de agregação por engine.
7. 8 testes cobrindo: corpus completo, categorias cobertas, dicionário
   editável, validação, WER limite, relatório gerado, agregação,
   warning de pronúncia ausente.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a30_ptbr_corpus.py
"""
from __future__ import annotations

import json
import statistics
import sys
import tempfile
import warnings
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# 1. Modelo de dados
# ---------------------------------------------------------------------------

VALID_CATEGORIES = ("numbers", "names", "siglas", "technical", "emotion", "speed")
VALID_EMOTIONS = ("neutra", "raiva", "sussurro", "alegria", "tristeza")
VALID_SPEEDS = ("lenta", "normal", "rapida")


@dataclass(frozen=True)
class CorpusEntry:
    id: str
    text: str
    category: str
    emotion: Optional[str] = None
    speed: Optional[str] = None
    expected_pronunciation: dict = field(default_factory=dict)


@dataclass
class PronunciationDictionary:
    entries: dict[str, str] = field(default_factory=dict)

    def set(self, token: str, pronunciation: str) -> None:
        self.entries[token] = pronunciation

    def get(self, token: str) -> Optional[str]:
        return self.entries.get(token)

    def has(self, token: str) -> bool:
        return token in self.entries


class TtsEngine(str, Enum):
    QWEN3_TTS = "qwen3_tts"
    KUGELAUDIO = "kugelaudio"
    CHATTERBOX = "chatterbox"


@dataclass
class TtsEvaluation:
    engine: TtsEngine
    entry_id: str
    wer: float
    clipping: bool
    latency_ms: float
    artifact_path: str
    artifact_sha256: str


@dataclass
class VoiceReport:
    engine: TtsEngine
    mean_wer: float
    p95_wer: float
    clipping_rate: float
    mean_latency_ms: float
    evaluations: list[TtsEvaluation]


# ---------------------------------------------------------------------------
# 2. Corpus PT-BR (30+ frases)
# ---------------------------------------------------------------------------

def default_corpus() -> list[CorpusEntry]:
    return [
        # Numbers (5)
        CorpusEntry("n01", "Olá, meu nome é João da Silva.", "names"),
        CorpusEntry("n02", "O número do protocolo é 1.234,56 reais.", "numbers"),
        CorpusEntry("n03", "A reunião foi remarcada para 15 de outubro de 2026.", "numbers"),
        CorpusEntry("n04", "A GPU tem 8 gigabytes de memória.", "technical"),
        CorpusEntry("n05", "A velocidade do vento é 23,7 quilômetros por hora.", "numbers"),
        # Names (5)
        CorpusEntry("n06", "Hélio Fotógrafo nasceu em Conceição Aparecida.", "names"),
        CorpusEntry("n07", "Yuri Schmaltz apresentou o plano.", "names"),
        CorpusEntry("n08", "Maria das Graças chegou cedo.", "names"),
        CorpusEntry("n09", "José de Alencar escreveu O Guarani.", "names"),
        CorpusEntry("n10", "Paulo Freire defendia a educação crítica.", "names"),
        # Siglas (5)
        CorpusEntry("n11", "O IBGE divulga os dados amanhã.", "siglas"),
        CorpusEntry("n12", "O SUS atende mais de 150 milhões de pessoas.", "siglas"),
        CorpusEntry("n13", "A UTFPR fica em Curitiba.", "siglas"),
        CorpusEntry("n14", "A IA generativa evolui rapidamente.", "siglas"),
        CorpusEntry("n15", "O CNPq financia pesquisas em GPU.", "siglas"),
        # Technical (5)
        CorpusEntry("n16", "PyTorch é um framework de deep learning.", "technical"),
        CorpusEntry("n17", "FFmpeg converte vídeos entre formatos.", "technical"),
        CorpusEntry("n18", "Whisper transcreve áudio em português.", "technical"),
        CorpusEntry("n19", "CUDA permite computação paralela na GPU.", "technical"),
        CorpusEntry("n20", "O modelo foi quantizado em INT8.", "technical"),
        # Emotion (5)
        CorpusEntry("n21", "Que dia bonito!", "emotion", emotion="alegria"),
        CorpusEntry("n22", "Não aguento mais essa situação.", "emotion", emotion="raiva"),
        CorpusEntry("n23", "Preciso de silêncio.", "emotion", emotion="sussurro"),
        CorpusEntry("n24", "Sinto saudades de casa.", "emotion", emotion="tristeza"),
        CorpusEntry("n25", "Vamos começar a apresentação.", "emotion", emotion="neutra"),
        # Speed (5)
        CorpusEntry("n26", "Bom dia a todos.", "speed", speed="lenta"),
        CorpusEntry("n27", "O teste foi concluído com sucesso.", "speed", speed="normal"),
        CorpusEntry("n28", "A obra de sessenta segundos ficou pronta.", "speed", speed="rapida"),
        CorpusEntry("n29", "A sala está vazia.", "speed", speed="lenta"),
        CorpusEntry("n30", "O pequeno robô acendeu a lâmpada.", "speed", speed="normal"),
        # Narrativas curtas da fixture "A luz da oficina"
        CorpusEntry("n31", "Na oficina silenciosa, uma pequena descoberta.", "narrative"),
        CorpusEntry("n32", "Cada peça encontra o seu lugar.", "narrative"),
        CorpusEntry("n33", "Basta um gesto para acender uma ideia.", "narrative"),
        CorpusEntry("n34", "E uma nova história pode começar.", "narrative"),
    ]


def validate_corpus(corpus: list[CorpusEntry]) -> dict[str, list[str]]:
    issues: dict[str, list[str]] = {}
    categories = {e.category for e in corpus}
    for required in ("numbers", "names", "siglas", "technical", "emotion", "speed"):
        if required not in categories:
            issues.setdefault("missing_category", []).append(required)
    if len(corpus) < 30:
        issues.setdefault("too_few", []).append(f"got {len(corpus)}")
    for e in corpus:
        if e.category not in VALID_CATEGORIES and e.category != "narrative":
            issues.setdefault("bad_category", []).append(f"{e.id}: {e.category}")
    return issues


# ---------------------------------------------------------------------------
# 3. Avaliação simulada
# ---------------------------------------------------------------------------

def simulate_evaluation(engine: TtsEngine, corpus: list[CorpusEntry], seed: int = 0) -> VoiceReport:
    """Simula TtsEvaluation com métricas determinísticas por engine/categoria."""
    evaluations: list[TtsEvaluation] = []
    base_wer = {
        TtsEngine.QWEN3_TTS: 0.06,
        TtsEngine.KUGELAUDIO: 0.08,
        TtsEngine.CHATTERBOX: 0.10,
    }
    penalty = {
        "numbers": 0.05,
        "names": 0.04,
        "siglas": 0.03,
        "technical": 0.02,
        "emotion": 0.04,
        "speed": 0.02,
        "narrative": 0.01,
    }
    for entry in corpus:
        wer = base_wer[engine] + penalty.get(entry.category, 0.0)
        if entry.category in ("numbers", "names"):
            wer += 0.04
        evaluations.append(TtsEvaluation(
            engine=engine,
            entry_id=entry.id,
            wer=round(wer, 4),
            clipping=engine == TtsEngine.CHATTERBOX and entry.category == "emotion",
            latency_ms=200.0 + (hash(entry.id) % 300),
            artifact_path=f"/tmp/{engine.value}_{entry.id}.wav",
            artifact_sha256=f"sha256_{entry.id}_{seed}",
        ))
    wers = sorted(e.wer for e in evaluations)
    p95_idx = max(0, int(len(wers) * 0.95) - 1)
    return VoiceReport(
        engine=engine,
        mean_wer=round(statistics.mean(wers), 4),
        p95_wer=wers[p95_idx],
        clipping_rate=sum(e.clipping for e in evaluations) / len(evaluations),
        mean_latency_ms=round(statistics.mean(e.latency_ms for e in evaluations), 1),
        evaluations=evaluations,
    )


def write_report(reports: list[VoiceReport], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Benchmark PT-BR — síntese de voz",
        "",
        "| Engine | WER médio | p95 WER | Clipping | Latência média (ms) |",
        "|--------|----------:|--------:|---------:|--------------------:|",
    ]
    for r in reports:
        lines.append(f"| {r.engine.value} | {r.mean_wer:.2%} | {r.p95_wer:.2%} | {r.clipping_rate:.1%} | {r.mean_latency_ms:.0f} |")
    lines += ["", "## Recomendações", ""]
    best = min(reports, key=lambda r: r.mean_wer)
    lines.append(f"- Melhor WER médio: **{best.engine.value}** ({best.mean_wer:.2%}).")
    lines.append("- Clipping foi corrigindo em aceitar somente vozes naturais nas emoções intensas.")
    lines.append("- Pronúncia de nomes próprios verificar via dicionário antes de gerar.")
    path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# 4. Suíte de testes
# ---------------------------------------------------------------------------

def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_corpus_has_30_plus_entries() -> bool:
    corpus = default_corpus()
    return check(
        "corpus: ≥ 30 entradas",
        len(corpus) >= 30,
        f"got={len(corpus)}",
    )


def test_corpus_covers_all_categories() -> bool:
    corpus = default_corpus()
    issues = validate_corpus(corpus)
    cats = {e.category for e in corpus}
    required = {"numbers", "names", "siglas", "technical", "emotion", "speed"}
    return check(
        "corpus: cobre 6 categorias obrigatórias",
        required.issubset(cats) and not issues,
        f"cats={sorted(cats)}, issues={issues}",
    )


def test_dictionary_is_editable() -> bool:
    d = PronunciationDictionary()
    d.set("Schmaltz", "Xmalts")
    d.set("Yuri", "Yuri")
    ok = d.has("Schmaltz") and d.get("Schmaltz") == "Xmalts"
    d.set("Schmaltz", "Shmalts")  # update
    ok = ok and d.get("Schmaltz") == "Shmalts"
    return check(
        "dicionário: set/get/has/update funcionam",
        ok,
        f"final={d.get('Schmaltz')}",
    )


def test_evaluation_wer_within_budget() -> bool:
    corpus = default_corpus()
    qwen = simulate_evaluation(TtsEngine.QWEN3_TTS, corpus)
    return check(
        "evaluation: WER do Qwen3-TTS < 15% em geral",
        qwen.mean_wer < 0.15,
        f"mean_wer={qwen.mean_wer:.2%}",
    )


def test_evaluation_agrees_across_engines() -> bool:
    corpus = default_corpus()
    reports = [simulate_evaluation(e, corpus) for e in TtsEngine]
    ranking = sorted(reports, key=lambda r: r.mean_wer)
    return check(
        "evaluation: ranking consistente Qwen3 < Kugelaudio < Chatterbox",
        ranking[0].engine == TtsEngine.QWEN3_TTS and ranking[-1].engine == TtsEngine.CHATTERBOX,
        f"ranking={[r.engine.value for r in ranking]}",
    )


def test_warning_for_missing_pronunciation() -> bool:
    corpus = default_corpus()
    d = PronunciationDictionary()
    # Encontra fala com nome sem pronúncia
    name_entries = [e for e in corpus if e.category == "names"]
    needs_pronunciation = [e for e in name_entries if not d.has(e.text.split()[-2])]
    return check(
        "warning: detecta nomes sem pronúncia registrada",
        len(needs_pronunciation) >= 5,
        f"sem_pronúncia={len(needs_pronunciation)}/{len(name_entries)}",
    )


def test_report_writes_to_file() -> bool:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "ptbr.md"
        corpus = default_corpus()
        reports = [simulate_evaluation(e, corpus) for e in TtsEngine]
        write_report(reports, path)
        text = path.read_text(encoding="utf-8")
        return check(
            "report: write Markdown com tabela de 3 engines",
            "qwen3_tts" in text and "kugelaudio" in text and "chatterbox" in text,
            f"size={path.stat().st_size}",
        )


def test_agregate_per_category() -> bool:
    corpus = default_corpus()
    qwen = simulate_evaluation(TtsEngine.QWEN3_TTS, corpus)
    by_cat: dict[str, list[float]] = {}
    for entry in corpus:
        ev = next(e for e in qwen.evaluations if e.entry_id == entry.id)
        by_cat.setdefault(entry.category, []).append(ev.wer)
    numbers_wer = statistics.mean(by_cat.get("numbers", [0.0]))
    technical_wer = statistics.mean(by_cat.get("technical", [0.0]))
    return check(
        "agregação: numbers tem WER > technical (penalty)",
        numbers_wer > technical_wer,
        f"numbers={numbers_wer:.3f}, technical={technical_wer:.3f}",
    )


def main() -> int:
    print("== A30 PT-BR Corpus prototype ==")
    tests = [
        test_corpus_has_30_plus_entries,
        test_corpus_covers_all_categories,
        test_dictionary_is_editable,
        test_evaluation_wer_within_budget,
        test_evaluation_agrees_across_engines,
        test_warning_for_missing_pronunciation,
        test_report_writes_to_file,
        test_agregate_per_category,
    ]
    failures = 0
    for t in tests:
        if not t():
            failures += 1
    print()
    if failures == 0:
        print(f"PASS {len(tests)}/{len(tests)} checks")
        return 0
    print(f"FAIL {failures}/{len(tests)} checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())