"""ApiError padronizado (A15).

Padroniza payload de erro para todos os endpoints REST. Inclui um `operationId`
(UUID) que serve como chave idempotente para retries seguros (A19).
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse


class ApiError(HTTPException):
    """Erro padronizado. Use ao levantar erros da aplicação.

    FastAPI por padrão serializa `detail` como `{"detail": ...}`. Aqui
    usamos `detail` como string e expomos `code/message/operationId`
    como atributos. O `app_main` registra um exception handler que
    converte esta exceção em JSONResponse com payload canônico.
    """

    def __init__(
        self,
        code: str,
        message: str,
        status: int = 400,
        cause: str | None = None,
        operation_id: str | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.operation_id = operation_id or str(uuid.uuid4())
        self.cause = cause
        super().__init__(status_code=status, detail=message)


def error_response(
    code: str,
    message: str,
    status: int,
    cause: str | None = None,
    operation_id: str | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "code": code,
            "message": message,
            "operationId": operation_id or str(uuid.uuid4()),
            "cause": cause,
        },
    )


async def api_error_handler(request, exc: ApiError):  # pragma: no cover
    """Exception handler que serializa ApiError como payload padronizado."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": exc.code,
            "message": exc.message,
            "operationId": exc.operation_id,
            "cause": exc.cause,
        },
    )


def install_api_error_handler(app) -> None:
    app.add_exception_handler(ApiError, api_error_handler)


# Códigos canônicos (usar para i18n e ações na UI).
class ErrorCode:
    AUTH_MISSING = "auth.missing"
    AUTH_INVALID = "auth.invalid"

    QUEUE_CANCEL_NOT_ALLOWED = "queue.cancel.not_allowed"
    QUEUE_RESUME_NOT_ALLOWED = "queue.resume.not_allowed"

    PROJECT_NOT_FOUND = "project.not_found"
    PROJECT_INVALID_BRIEFING = "project.briefing.invalid"

    EDITOR_NOT_READY = "editor.not_ready"
    EDITOR_CLIP_NOT_FOUND = "editor.clip.not_found"

    MODEL_NOT_READY = "model.not_ready"
    MODEL_OOM = "model.oom"

    INTERNAL = "internal.unexpected"


__all__ = ["ApiError", "error_response", "ErrorCode", "install_api_error_handler"]