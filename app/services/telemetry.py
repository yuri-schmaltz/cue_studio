"""OpenTelemetry tracing wrapper for Cue Studio.

Why this exists
---------------
Every Cue Studio request that ends up running a heavy operation
(audio analysis, Director plan, image generation, FFmpeg encode)
currently has no distributed-tracing instrumentation. When something
goes wrong in production the only signal we have is the access log,
which records the URL and HTTP status but nothing about how long the
underlying stages took.

This module wraps the OTel API behind a tiny facade so the rest of the
codebase doesn't have to know whether the OTel SDK is installed. When
``opentelemetry-api`` is missing, every call becomes a no-op and the
binary keeps working. When it is present, the same calls produce
spans that an OTel collector can pick up.

The wrapper intentionally only exposes the four operations we
actually use (``start_span``, ``record_event``, ``record_exception``,
``set_attribute``). Anything more elaborate — metrics, logs, baggage
— is left for follow-up so the dependency surface stays tiny.

Why a facade rather than a direct OTel import?
----------------------------------------------
* OTel ships multiple ``API`` and ``SDK`` packages. Importing the
  wrong one in a CUDA-bound environment can fail at module load
  with no clear error.
* Tests should be able to construct a span tree without running an
  exporter. The facade returns a ``NoopSpan`` when OTel is missing so
  call sites can always call ``span.set_attribute(...)`` without
  defensive ``if``s.
* Future migration to a different tracing backend (Datadog, Lightstep)
  becomes a single-file change rather than a cross-codebase refactor.
"""

from __future__ import annotations

import contextlib
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Iterator, Mapping


log = logging.getLogger("cue_studio.telemetry")


@dataclass
class NoopSpan:
    """Drop-in stand-in for OTel's ``Span`` when OTel is unavailable.

    Every method is a no-op so call sites can use the same code path
    with both the real tracer and the fallback.
    """

    name: str = ""
    start_time: float = field(default_factory=time.monotonic)
    attributes: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    status: str = "ok"

    def set_attribute(self, key: str, value: Any) -> "NoopSpan":
        self.attributes[key] = value
        return self

    def set_attributes(self, attrs: Mapping[str, Any]) -> "NoopSpan":
        self.attributes.update(attrs)
        return self

    def add_event(self, name: str, attributes: Mapping[str, Any] | None = None) -> "NoopSpan":
        self.events.append({"name": name, "attributes": dict(attributes or {})})
        return self

    def record_exception(self, exc: BaseException) -> "NoopSpan":
        self.status = "error"
        self.events.append({"name": "exception", "attributes": {"type": type(exc).__name__, "message": str(exc)}})
        return self

    def end(self) -> None:
        # No-op. We record the duration anyway so the caller can log
        # latency locally if OTel is missing.
        pass

    @property
    def elapsed_seconds(self) -> float:
        return time.monotonic() - self.start_time


class Telemetry:
    """Lightweight OpenTelemetry facade.

    Usage::

        tracer = Telemetry.get("cue-studio.director")
        with tracer.start_span("director.v2.plan") as span:
            span.set_attribute("skill", "music_video")
            ...
    """

    _global: "Telemetry | None" = None
    _lock = None  # populated lazily

    def __init__(self, service_name: str) -> None:
        self.service_name = service_name
        self._real_tracer = self._try_otel(service_name)

    @classmethod
    def get(cls, service_name: str) -> "Telemetry":
        # No lock needed: constructing the same Telemetry twice is
        # cheap (the only state is the service name) and the fallback
        # path is the slow path.
        if cls._global is None:
            cls._global = cls(service_name)
        return cls._global

    def _try_otel(self, service_name: str) -> Any:
        """Best-effort: try to bind to a real OTel tracer.

        If ``opentelemetry-api`` isn't installed we return ``None`` and
        every span we hand out becomes a ``NoopSpan``.
        """

        try:
            from opentelemetry import trace  # type: ignore
        except Exception as exc:  # noqa: BLE001
            log.debug("[telemetry] opentelemetry not available (%s); running with no-op spans", exc)
            return None
        try:
            return trace.get_tracer(service_name)
        except Exception as exc:  # noqa: BLE001
            log.debug("[telemetry] tracer initialisation failed (%s); running with no-op spans", exc)
            return None

    @contextlib.contextmanager
    def start_span(self, name: str, *, attributes: Mapping[str, Any] | None = None) -> Iterator[NoopSpan]:
        """Open a new span and yield it.

        Returns the wrapper whether the underlying tracer is OTel or
        no-op. The yield ensures the span's ``end()`` is called on
        exit; an exception flips the status to ``error`` so the
        caller's local telemetry log can highlight failed operations.
        """

        span = NoopSpan(name=name)
        if attributes:
            span.set_attributes(attributes)
        real_span_cm = None
        if self._real_tracer is not None:
            try:
                real_span_cm = self._real_tracer.start_as_current_span(name)
            except Exception:  # noqa: BLE001
                real_span_cm = None
        try:
            if real_span_cm is not None:
                with real_span_cm:
                    yield span
            else:
                yield span
        except BaseException as exc:
            span.record_exception(exc)
            raise
        finally:
            span.end()

    def record_event(self, span: NoopSpan, name: str, attributes: Mapping[str, Any] | None = None) -> None:
        span.add_event(name, attributes)

    def set_attribute(self, span: NoopSpan, key: str, value: Any) -> None:
        span.set_attribute(key, value)


__all__ = ["NoopSpan", "Telemetry"]


def get_tracer(service_name: str = "cue-studio") -> Telemetry:
    """Convenience accessor matching OTel's ``get_tracer`` naming."""

    return Telemetry.get(service_name)
