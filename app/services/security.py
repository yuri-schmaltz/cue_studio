"""Security and authentication services for Cue Studio / Maestro API."""

import os
import secrets
from typing import Optional
from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security_scheme = HTTPBearer(auto_error=False)

# Configuração global de segurança
_api_key: Optional[str] = None
_require_auth: bool = False
_allow_unauthenticated_local: bool = True


def configure_security(
    api_key: Optional[str] = None,
    require_auth: bool = False,
    allow_unauthenticated_local: bool = True,
) -> str | None:
    """Configure API security settings.
    
    If require_auth is True and no api_key is provided, a secure random key is generated.
    Returns the active API key (or None if auth is disabled).
    """
    global _api_key, _require_auth, _allow_unauthenticated_local
    
    env_key = os.environ.get("CUE_API_KEY") or os.environ.get("MAESTRO_API_KEY")
    key = api_key or env_key
    
    _require_auth = require_auth
    _allow_unauthenticated_local = allow_unauthenticated_local
    
    if _require_auth and not key:
        key = secrets.token_urlsafe(32)
        print(f"\n[Security] Generated temporary API Key for protected mode: {key}\n")
        
    _api_key = key
    return _api_key


def get_active_api_key() -> Optional[str]:
    """Return the configured API key if authentication is enabled."""
    return _api_key if _require_auth else None


def is_auth_required() -> bool:
    """Return whether authentication is currently enforced."""
    return _require_auth


def is_local_client(request: Request) -> bool:
    """Return True if the request originates from loopback address."""
    client_host = request.client.host if request.client else ""
    return client_host in ("127.0.0.1", "::1", "localhost")


async def verify_api_key(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = None,
) -> bool:
    """Verify API request authentication.
    
    If authentication is not required, allow immediately.
    If local unauthenticated access is allowed and request is from loopback, allow.
    Otherwise, require a valid Bearer token matching the configured API key.
    """
    if not _require_auth:
        return True
        
    # Isenção para rotas de documentação pública ou arquivos estáticos
    if request.url.path in ("/docs", "/openapi.json", "/redoc", "/favicon.ico", "/maestro-icon.png"):
        return True
        
    # Verificar loopback se permitido
    if _allow_unauthenticated_local and is_local_client(request):
        return True

    token = credentials.credentials if credentials else None
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif "api_key" in request.query_params:
            token = request.query_params["api_key"]
            
    if not token or not _api_key or not secrets.compare_digest(token, _api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Valid API Bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    return True
