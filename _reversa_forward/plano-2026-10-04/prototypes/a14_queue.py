#!/usr/bin/env python3
"""Protótipo isolado da fila (A14).

Demonstra a tabela única `QUEUE_ACTIONS` da feature A14, garantindo que
cada estado interno da fila mapeie para um conjunto coerente de ações
disponíveis e que o cancelamento só aparece em estados apropriados.

Rodar:
  python3 _reversa_forward/plano-2026-10-04/prototypes/a14_queue.py
"""
from __future__ import annotations

import sys
from typing import Literal


QueueState = Literal[
    "queued", "preparing", "running",
    "awaiting_review", "done", "failed", "cancelled",
]
Action = Literal["cancel", "review", "reopen", "download"]

QUEUE_LABELS: dict[QueueState, str] = {
    "queued": "Aguardando",
    "preparing": "Preparando/download",
    "running": "Gerando",
    "awaiting_review": "Aguardando revisão",
    "done": "Concluído",
    "failed": "Falhou",
    "cancelled": "Cancelado",
}

QUEUE_ACTIONS: dict[QueueState, tuple[Action, ...]] = {
    "queued": ("cancel",),
    "preparing": ("cancel",),
    "running": ("cancel",),
    "awaiting_review": ("review",),
    "done": ("review", "download"),
    "failed": ("reopen",),
    "cancelled": ("reopen",),
}


def available_actions(state: QueueState) -> tuple[Action, ...]:
    return QUEUE_ACTIONS[state]


def label(state: QueueState) -> str:
    return QUEUE_LABELS[state]


def test_running_allows_cancel_only() -> None:
    assert available_actions("running") == ("cancel",), available_actions("running")
    print("OK running_allows_cancel_only")


def test_done_offers_review_and_download() -> None:
    assert set(available_actions("done")) == {"review", "download"}
    print("OK done_offers_review_and_download")


def test_failed_offers_reopen() -> None:
    assert available_actions("failed") == ("reopen",)
    print("OK failed_offers_reopen")


def test_awaiting_review_offers_review_only() -> None:
    assert available_actions("awaiting_review") == ("review",)
    print("OK awaiting_review_offers_review_only")


def test_labels_unique() -> None:
    labels = list(QUEUE_LABELS.values())
    assert len(labels) == len(set(labels)), labels
    print("OK labels_unique")


def test_states_covered() -> None:
    """Cada estado declarado deve ter label e actions."""
    for state in ("queued", "preparing", "running", "awaiting_review",
                  "done", "failed", "cancelled"):
        assert state in QUEUE_LABELS, state
        assert state in QUEUE_ACTIONS, state
    print("OK states_covered")


def main() -> int:
    tests = [
        test_running_allows_cancel_only,
        test_done_offers_review_and_download,
        test_failed_offers_reopen,
        test_awaiting_review_offers_review_only,
        test_labels_unique,
        test_states_covered,
    ]
    failures = 0
    for t in tests:
        try:
            t()
        except AssertionError as e:
            failures += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR {t.__name__}: {e}")
    print(f"\n{len(tests)} tests run; failures={failures}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())