"""VAPID key rotation for the Web Push subsystem.

Why rotation matters
--------------------
``web_push.json`` stores the VAPID private key that signs every push
notification sent to subscribed browsers. If that file leaks — through
a backup, a sync folder, or any other side channel — an attacker can
silently impersonate Cue Studio and send fake push notifications to
every subscribed device until each device manually unsubscribes.

The blast radius shrinks dramatically if the key is rotated regularly:
the previous key becomes useless and every existing subscription has to
re-register with the new public key. Cue Studio rotates on first run of
each calendar year by default; users (or operators) can force a rotation
on demand via the API endpoint wired below.

Rotation semantics
------------------
A rotation does NOT destroy the old key immediately — every subscribed
browser needs the *previous* public key to keep receiving notifications
during the cut-over window (default: 30 days). After the overlap window
elapses the old key is purged and any subscription still using it is
rejected by the Web Push standard's VAPID signature check.

The ``overlap_seconds`` knob lets the operator tune the cut-over window:
* short overlap (1 day) for paranoid deployments
* long overlap (90 days) for environments where users open the app
  infrequently and might miss the new-key registration prompt
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


log = logging.getLogger("cue_studio.web_push_rotation")


DEFAULT_ROTATION_INTERVAL = 365 * 24 * 60 * 60  # one calendar year
DEFAULT_OVERLAP_SECONDS = 30 * 24 * 60 * 60  # 30 days for browser re-subscribe


@dataclass
class VapidKeyMaterial:
    """Single VAPID keypair with the timestamp it became active."""

    private_pem: str
    public_b64url: str
    created_at: float
    label: str = "primary"

    def to_dict(self) -> dict[str, Any]:
        return {
            "private_pem": self.private_pem,
            "public_b64url": self.public_b64url,
            "created_at": self.created_at,
            "label": self.label,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "VapidKeyMaterial":
        return cls(
            private_pem=str(raw["private_pem"]),
            public_b64url=str(raw["public_b64url"]),
            created_at=float(raw.get("created_at", 0.0)),
            label=str(raw.get("label", "primary")),
        )


@dataclass
class WebPushRotationState:
    """Snapshot of the VAPID rotation state on disk."""

    active: VapidKeyMaterial
    previous: VapidKeyMaterial | None = None
    overlap_until: float | None = None  # when ``previous`` becomes invalid
    history: list[VapidKeyMaterial] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": 2,
            "active": self.active.to_dict(),
            "previous": self.previous.to_dict() if self.previous else None,
            "overlap_until": self.overlap_until,
            "history": [k.to_dict() for k in self.history],
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "WebPushRotationState":
        active = VapidKeyMaterial.from_dict(raw["active"])
        previous = VapidKeyMaterial.from_dict(raw["previous"]) if raw.get("previous") else None
        history = [VapidKeyMaterial.from_dict(k) for k in raw.get("history", [])]
        return cls(
            active=active,
            previous=previous,
            overlap_until=raw.get("overlap_until"),
            history=history,
        )


class WebPushKeyRotation:
    """Manages the VAPID key lifecycle on disk.

    The state file (``web_push.json``) gets a new schema ``version=2``
    which carries the active key plus the overlap key plus a small
    history of rotated-out keys. The previous schema (version=1) had
    only the active key; existing installs are migrated transparently.
    """

    def __init__(
        self,
        state_path: Path | str,
        *,
        rotation_interval_seconds: float = DEFAULT_ROTATION_INTERVAL,
        overlap_seconds: float = DEFAULT_OVERLAP_SECONDS,
        clock: Any | None = None,
    ) -> None:
        self._state_path = Path(state_path)
        self._interval = rotation_interval_seconds
        self._overlap = overlap_seconds
        self._clock = clock or time.time

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load_or_initialise(self, key_factory) -> WebPushRotationState:
        """Load the current rotation state, creating one if absent.

        ``key_factory`` is a no-arg callable that returns
        ``(private_pem, public_b64url)``. This indirection lets callers
        inject the real ``_new_vapid_pair`` from ``services/web_push.py``
        without creating an import cycle.
        """

        freshly_created = not self._state_path.exists()
        state = self._read_existing(key_factory)
        mutated = freshly_created

        if self._needs_rotation(state):
            state = self._rotate(state, key_factory)
            mutated = True

        # Purge an expired previous key once the overlap window elapsed.
        if state.previous and state.overlap_until and self._clock() > state.overlap_until:
            state.previous = None
            state.overlap_until = None
            mutated = True

        if mutated:
            self._persist(state)

        return state

    def _read_existing(self, key_factory) -> WebPushRotationState:
        if not self._state_path.exists():
            return self._fresh(key_factory)
        try:
            raw = json.loads(self._state_path.read_text(encoding="utf-8"))
            return self._migrate(raw, key_factory)
        except (OSError, ValueError, KeyError) as exc:
            log.warning("[web-push] could not read state file (%s); regenerating", exc)
            return self._fresh(key_factory)

    def force_rotate(self, key_factory) -> WebPushRotationState:
        """Operator-initiated rotation, regardless of the timer.

        The existing active key becomes the new ``previous`` (with a
        fresh overlap window) so subscribed browsers have time to
        re-register against the new public key.
        """

        state = self.load_or_initialise(key_factory)
        return self._rotate(state, key_factory, keep_previous=True)

    def revoke_previous(self) -> WebPushRotationState:
        """Drop the overlap key immediately.

        Useful when the operator knows a previous key has been
        compromised and wants to stop accepting signatures from it right
        away.
        """

        state = self.load_or_initialise(lambda: ("", ""))
        state.previous = None
        state.overlap_until = None
        self._persist(state)
        return state

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _needs_rotation(self, state: WebPushRotationState) -> bool:
        return (self._clock() - state.active.created_at) > self._interval

    def _rotate(self, state: WebPushRotationState, key_factory, *, keep_previous: bool = True) -> WebPushRotationState:
        private_pem, public_b64url = key_factory()
        new_active = VapidKeyMaterial(
            private_pem=private_pem,
            public_b64url=public_b64url,
            created_at=self._clock(),
            label=f"rotated-{int(self._clock())}",
        )

        history = list(state.history)
        if state.active is not None:
            history.append(state.active)
            # Cap the history at five entries so the file does not grow
            # without bound; older keys are not useful for re-signing.
            history = history[-5:]

        return WebPushRotationState(
            active=new_active,
            previous=state.active if keep_previous else None,
            overlap_until=(self._clock() + self._overlap) if keep_previous else None,
            history=history,
        )

    def _fresh(self, key_factory) -> WebPushRotationState:
        private_pem, public_b64url = key_factory()
        return WebPushRotationState(
            active=VapidKeyMaterial(
                private_pem=private_pem,
                public_b64url=public_b64url,
                created_at=self._clock(),
                label="initial",
            ),
            previous=None,
            overlap_until=None,
            history=[],
        )

    def _migrate(self, raw: dict[str, Any], key_factory) -> WebPushRotationState:
        version = raw.get("version", 1)
        if version >= 2:
            return WebPushRotationState.from_dict(raw)

        # version=1: single-key schema. Lift it into the rotation
        # container without re-keying — that defeats the purpose of
        # rotation by immediately invalidating existing subscriptions.
        legacy_private = str(raw.get("vapid_private_key") or "")
        legacy_public = str(raw.get("vapid_public_key") or "")
        if not legacy_private or not legacy_public:
            return self._fresh(key_factory)

        state = WebPushRotationState(
            active=VapidKeyMaterial(
                private_pem=legacy_private,
                public_b64url=legacy_public,
                created_at=self._clock(),
                label="legacy-migrated",
            ),
            previous=None,
            overlap_until=None,
            history=[],
        )
        self._persist(state)
        return state

    def _persist(self, state: WebPushRotationState) -> None:
        # Delegate atomic writes to the canonical helper so the rotation
        # file benefits from the same crash-safe semantics as the rest
        # of the persistence layer.
        from shared.utils.ffmpeg_runtime import atomic_write_json

        atomic_write_json(self._state_path, state.to_dict())


__all__ = [
    "DEFAULT_OVERLAP_SECONDS",
    "DEFAULT_ROTATION_INTERVAL",
    "VapidKeyMaterial",
    "WebPushKeyRotation",
    "WebPushRotationState",
]
