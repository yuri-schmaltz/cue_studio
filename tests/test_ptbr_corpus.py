"""Testes de integração do Corpus PT-BR (A30 / R09)."""

from __future__ import annotations

import statistics
import tempfile
from pathlib import Path

from app.services.ptbr_corpus import (
    TtsEngine,
    PronunciationDictionary,
    CorpusEntry,
    default_corpus,
    validate_corpus,
    simulate_evaluation,
    write_report,
    check_pronunciation,
    aggregate_by_engine,
    VALID_CATEGORIES,
)


def test_corpus_has_30_plus():
    corpus = default_corpus()
    assert len(corpus) >= 30


def test_corpus_covers_categories():
    corpus = default_corpus()
    issues = validate_corpus(corpus)
    assert not issues
    cats = {e.category for e in corpus}
    assert {"numbers", "names", "siglas", "technical", "emotion", "speed"}.issubset(cats)


def test_dictionary_editable():
    d = PronunciationDictionary()
    d.set("Schmaltz", "Xmalts")
    assert d.has("Schmaltz")
    assert d.get("Schmaltz") == "Xmalts"
    d.set("Schmaltz", "Shmalts")
    assert d.get("Schmaltz") == "Shmalts"


def test_evaluation_wer_within_budget():
    corpus = default_corpus()
    qwen = simulate_evaluation(TtsEngine.QWEN3_TTS, corpus)
    assert qwen.mean_wer < 0.15


def test_evaluation_ranking():
    corpus = default_corpus()
    reports = [simulate_evaluation(e, corpus) for e in TtsEngine]
    ranking = sorted(reports, key=lambda r: r.mean_wer)
    assert ranking[0].engine == TtsEngine.QWEN3_TTS
    assert ranking[-1].engine == TtsEngine.CHATTERBOX


def test_warning_missing_pronunciation():
    corpus = default_corpus()
    d = PronunciationDictionary()
    name_entries = [e for e in corpus if e.category == "names"]
    needs = [e for e in name_entries if check_pronunciation(e, d)]
    assert len(needs) >= 5


def test_report_writes_file():
    corpus = default_corpus()
    reports = [simulate_evaluation(e, corpus) for e in TtsEngine]
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "ptbr.md"
        write_report(reports, path)
        assert path.exists()
        content = path.read_text()
        assert "qwen3_tts" in content
        assert "kugelaudio" in content
        assert "chatterbox" in content


def test_aggregate_by_engine():
    corpus = default_corpus()
    reports = [simulate_evaluation(e, corpus) for e in TtsEngine]
    agg = aggregate_by_engine(reports)
    assert len(agg) == 3
    assert "qwen3_tts" in agg
    assert agg["qwen3_tts"]["mean_wer"] < agg["chatterbox"]["mean_wer"]


def test_numbers_wer_higher_than_technical():
    corpus = default_corpus()
    qwen = simulate_evaluation(TtsEngine.QWEN3_TTS, corpus)
    by_cat: dict[str, list[float]] = {}
    for entry in corpus:
        ev = next(e for e in qwen.evaluations if e.entry_id == entry.id)
        by_cat.setdefault(entry.category, []).append(ev.wer)
    numbers_wer = statistics.mean(by_cat.get("numbers", [0.0]))
    technical_wer = statistics.mean(by_cat.get("technical", [0.0]))
    assert numbers_wer > technical_wer


def test_corpus_entries_have_valid_categories():
    corpus = default_corpus()
    for e in corpus:
        assert e.category in VALID_CATEGORIES, f"{e.id}: {e.category}"


def test_emotion_entries_have_emotion():
    corpus = default_corpus()
    for e in corpus:
        if e.category == "emotion":
            assert e.emotion is not None


def test_speed_entries_have_speed():
    corpus = default_corpus()
    for e in corpus:
        if e.category == "speed":
            assert e.speed is not None


def test_narrative_entries_from_fixture():
    corpus = default_corpus()
    narrative = [e for e in corpus if e.category == "narrative"]
    assert len(narrative) == 4
    assert narrative[0].text == "Na oficina silenciosa, uma pequena descoberta."
