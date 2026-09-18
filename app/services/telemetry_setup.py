"""OTel exporter / tracer-provider setup.

Why this exists
---------------
The :mod:`services.telemetry` facade only handles the in-process
``Tracer`` API. To actually emit spans to an external collector (or
even just the console for development) the project needs a configured
``TracerProvider`` with one or more ``SpanProcessor`` instances wired
in.

This module owns that setup so the rest of the codebase can call
``setup_telemetry()`` once at boot and then ignore it. It is
deliberately tolerant of a missing OTel SDK — when ``opentelemetry-sdk``
isn't installed we leave the facade in no-op mode and the application
keeps working.

Environment
-----------
* ``CUE_OTEL_EXPORTER`` selects the exporter: ``"console"``,
  ``"otlp"`` (default) or ``"none"`` to disable completely.
* ``OTEL_EXPORTER_OTLP_ENDPOINT`` overrides the collector URL
  (default ``http://localhost:4317``).
* ``CUE_OTEL_SERVICE_NAME`` overrides the service name (default
  ``cue-studio``).
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Mapping


log = logging.getLogger("cue_studio.telemetry_setup")


_lock = threading.Lock()
_setup_done = False


def _import_otel_sdk():
    """Best-effort import of the OTel SDK.

    Returns ``None`` when the SDK is unavailable so the caller can
    continue without crashing.
    """

    try:
        from opentelemetry import trace  # type: ignore
        from opentelemetry.sdk.resources import Resource  # type: ignore
        from opentelemetry.sdk.trace import TracerProvider  # type: ignore
        from opentelemetry.sdk.trace.export import (  # type: ignore
            BatchSpanProcessor,
            ConsoleSpanExporter,
            SimpleSpanProcessor,
        )
        return {
            "trace": trace,
            "Resource": Resource,
            "TracerProvider": TracerProvider,
            "BatchSpanProcessor": BatchSpanProcessor,
            "ConsoleSpanExporter": ConsoleSpanExporter,
            "SimpleSpanProcessor": SimpleSpanProcessor,
        }
    except Exception as exc:  # noqa: BLE001
        log.info("[telemetry] opentelemetry-sdk unavailable: %s", exc)
        return None


def setup_telemetry(
    service_name: str | None = None,
    *,
    exporter: str | None = None,
    endpoint: str | None = None,
    sample_ratio: float = 1.0,
) -> bool:
    """Initialise the global ``TracerProvider``.

    Returns ``True`` when a real provider was configured, ``False``
    when the SDK was unavailable or the exporter was explicitly
    disabled. The result is cached so subsequent calls are no-ops.
    """

    global _setup_done
    with _lock:
        if _setup_done:
            return True
        sdk = _import_otel_sdk()
        if sdk is None:
            return False

        exporter_choice = (exporter or os.environ.get("CUE_OTEL_EXPORTER") or "otlp").lower()
        endpoint = endpoint or os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or "http://localhost:4317"
        service_name = service_name or os.environ.get("CUE_OTEL_SERVICE_NAME") or "cue-studio"

        if exporter_choice == "none":
            log.info("[telemetry] exporter disabled via config")
            _setup_done = True
            return False

        try:
            resource = sdk["Resource"].create({"service.name": service_name})
            provider = sdk["TracerProvider"](resource=resource)
            sdk["trace"].set_tracer_provider(provider)

            if exporter_choice == "console":
                # ConsoleSpanExporter prints to stdout; great for dev
                # but noisy in production. Use SimpleSpanProcessor so
                # spans appear synchronously.
                provider.add_span_processor(sdk["SimpleSpanProcessor"](sdk["ConsoleSpanExporter"]()))
            elif exporter_choice == "otlp":
                # OTLP gRPC exporter — only available if the
                # ``opentelemetry-exporter-otlp-proto-grpc`` package is
                # installed. Fall back to OTLP HTTP if gRPC is missing.
                try:
                    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (  # type: ignore
                        OTLPSpanExporter,
                    )
                    span_exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
                except Exception:
                    from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # type: ignore
                        OTLPSpanExporter as HTTPSpanExporter,
                    )
                    span_exporter = HTTPSpanExporter(endpoint=endpoint + "/v1/traces")
                provider.add_span_processor(sdk["BatchSpanProcessor"](span_exporter))
            else:
                log.warning("[telemetry] unknown exporter '%s'; no exporter installed", exporter_choice)
                _setup_done = True
                return True

            log.info(
                "[telemetry] exporter=%s endpoint=%s service=%s ready",
                exporter_choice,
                endpoint,
                service_name,
            )
            _setup_done = True
            return True
        except Exception as exc:  # noqa: BLE001
            log.warning("[telemetry] setup failed: %s", exc)
            _setup_done = True
            return False


def shutdown_telemetry() -> None:
    """Flush + shutdown the tracer provider so spans aren't dropped on exit."""

    global _setup_done
    try:
        from opentelemetry import trace  # type: ignore

        provider = trace.get_tracer_provider()
        shutdown = getattr(provider, "shutdown", None)
        if callable(shutdown):
            shutdown()
    except Exception:  # noqa: BLE001
        pass
    finally:
        _setup_done = False


def is_telemetry_active() -> bool:
    """True when setup_telemetry() successfully configured a real provider."""

    return _setup_done


__all__ = [
    "is_telemetry_active",
    "setup_telemetry",
    "shutdown_telemetry",
]
