"""LLM Multi-Role Router for Cue Studio.

Enables role-based routing across creative and technical stages of the production pipeline:
  - ROLE_CREATIVE: Pass 1 screenplay writing, character bibles, worldbuilding.
  - ROLE_TECHNICAL: Pass 2 timeline breakdown, shot sequencing, JSON schemas.
  - ROLE_POLISH: Pass 3 visual prompt expansion, model dialects, LoRA guides.
  - ROLE_VISION: Multimodal analysis of visual references (character, setting, lighting).

Each role can be individually mapped to a local model or a remote API provider
(OpenAI, Anthropic, Ollama, custom endpoint). If a role is unconfigured, it seamlessly
falls back to the global active model in llm_service.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# Standard pipeline roles
ROLE_CREATIVE = "creative"
ROLE_TECHNICAL = "technical_json"
ROLE_POLISH = "prompt_polish"
ROLE_VISION = "vision"

ALL_ROLES = (ROLE_CREATIVE, ROLE_TECHNICAL, ROLE_POLISH, ROLE_VISION)

# Thread-safe role configuration store
_router_lock = threading.RLock()
_role_configurations: Dict[str, Dict[str, Any]] = {}
_router_enabled: bool = False


def is_role_routing_enabled() -> bool:
    """Return whether role-based routing is active."""
    with _router_lock:
        return _router_enabled


def set_role_routing_enabled(enabled: bool) -> None:
    """Enable or disable role-based routing."""
    global _router_enabled
    with _router_lock:
        _router_enabled = bool(enabled)


def set_role_config(
    role: str,
    provider: str = "local",
    model_id: str = "",
    remote_url: str = "",
    api_key: str = "",
    extra_options: Optional[Dict[str, Any]] = None,
) -> None:
    """Configure model settings for a specific role.

    Args:
        role: One of ALL_ROLES.
        provider: 'local' | 'remote' | 'openai' | 'anthropic' | 'minimax' | 'ollama'
        model_id: Model identifier (e.g. HuggingFace repo ID, 'claude-sonnet-4-6', 'gpt-4o', etc.)
        remote_url: Custom base URL for remote/openai/ollama providers.
        api_key: API key if using paid/authenticated endpoints.
        extra_options: Optional sampling or execution overrides for this role.
    """
    if role not in ALL_ROLES:
        logger.warning("Configuring non-standard role '%s'", role)

    with _router_lock:
        _role_configurations[role] = {
            "provider": provider or "local",
            "model_id": model_id or "",
            "remote_url": remote_url or "",
            "api_key": api_key or "",
            "extra_options": extra_options or {},
        }


def get_role_config(role: str) -> Optional[Dict[str, Any]]:
    """Get configured settings for a role, or None if not set."""
    with _router_lock:
        cfg = _role_configurations.get(role)
        return dict(cfg) if cfg else None


def get_all_role_configs() -> Dict[str, Dict[str, Any]]:
    """Return all configured roles and routing status."""
    with _router_lock:
        return {
            "enabled": _router_enabled,
            "roles": {r: dict(cfg) for r, cfg in _role_configurations.items()},
        }


def reset_role_configs() -> None:
    """Clear all role overrides and disable role routing."""
    global _router_enabled
    with _router_lock:
        _role_configurations.clear()
        _router_enabled = False


def resolve_role_target(role: str) -> Dict[str, Any]:
    """Resolve the effective model, provider and settings for a given role.

    If role routing is disabled or the role has no specific configuration,
    falls back to the global active model in llm_service.
    """
    from services import llm_service

    global_status = llm_service.get_status()
    default_target = {
        "role": role,
        "provider": global_status.get("provider", "local") or "local",
        "model_id": global_status.get("model_id", "") or getattr(llm_service, "_model_id", "") or getattr(llm_service, "DEFAULT_HF_REPO", ""),
        "remote_url": getattr(llm_service, "_remote_url", "") or "",
        "api_key": getattr(llm_service, "_api_key", "") or "",
        "is_override": False,
        "extra_options": {},
    }

    if not is_role_routing_enabled():
        return default_target

    with _router_lock:
        cfg = _role_configurations.get(role)
        if not cfg or not cfg.get("model_id"):
            return default_target

        return {
            "role": role,
            "provider": cfg.get("provider", "local"),
            "model_id": cfg.get("model_id", ""),
            "remote_url": cfg.get("remote_url", ""),
            "api_key": cfg.get("api_key", ""),
            "is_override": True,
            "extra_options": cfg.get("extra_options", {}),
        }


def generate_for_role(
    role: str,
    prompt: str,
    system_prompt: str = "",
    max_new_tokens: int = 256,
    temperature: float = 0.7,
    top_p: float = 0.9,
    thinking_budget: int = 0,
    enable_thinking: Optional[bool] = None,
    json_schema: Optional[dict] = None,
    frequency_penalty: float = 0.0,
    presence_penalty: float = 0.0,
    image_paths: Optional[list] = None,
    **kwargs: Any,
) -> str:
    """Route and execute a text/JSON generation call for a specific pipeline role.

    Handles remote isolation (executing remote APIs without switching local weights)
    and falls back to llm_service.generate.
    """
    from services import llm_service

    target = resolve_role_target(role)

    # Check if target is a remote API provider while local server is running
    is_remote = target["provider"] in ("openai", "anthropic", "minimax", "remote", "ollama")
    current_provider = getattr(llm_service, "_provider", "local")

    # If it uses the current active provider and model, call directly
    if not target["is_override"] or (
        target["provider"] == current_provider
        and (target["model_id"] == getattr(llm_service, "_model_id", "") or is_remote)
    ):
        return llm_service.generate(
            prompt=prompt,
            system_prompt=system_prompt,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            top_p=top_p,
            thinking_budget=thinking_budget,
            enable_thinking=enable_thinking,
            json_schema=json_schema,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
            image_paths=image_paths,
            **kwargs,
        )

    # If role targets a remote provider, invoke it via isolated HTTP request
    # to avoid unloading the local llama-server weights
    if is_remote:
        return _invoke_remote_isolated(
            target=target,
            prompt=prompt,
            system_prompt=system_prompt,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            top_p=top_p,
            json_schema=json_schema,
            image_paths=image_paths,
            **kwargs,
        )

    # If role targets a different local model, switch models on the local server
    if target["provider"] == "local" and target["model_id"] != getattr(llm_service, "_model_id", ""):
        logger.info(
            "Role '%s' requested local model switch: %s -> %s",
            role,
            getattr(llm_service, "_model_id", "none"),
            target["model_id"],
        )
        llm_service.load_model(model_id=target["model_id"], provider="local")

    return llm_service.generate(
        prompt=prompt,
        system_prompt=system_prompt,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
        top_p=top_p,
        thinking_budget=thinking_budget,
        enable_thinking=enable_thinking,
        json_schema=json_schema,
        frequency_penalty=frequency_penalty,
        presence_penalty=presence_penalty,
        image_paths=image_paths,
        **kwargs,
    )


def _invoke_remote_isolated(
    target: Dict[str, Any],
    prompt: str,
    system_prompt: str = "",
    max_new_tokens: int = 256,
    temperature: float = 0.7,
    top_p: float = 0.9,
    json_schema: Optional[dict] = None,
    image_paths: Optional[list] = None,
    **kwargs: Any,
) -> str:
    """Execute request against remote provider without mutating llm_service singleton."""
    import requests

    provider = target["provider"]
    model_id = target["model_id"]
    api_key = target.get("api_key", "")
    remote_url = target.get("remote_url", "")

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    if provider in ("anthropic", "minimax"):
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        base_url = remote_url if remote_url else (
            "https://api.minimax.com" if provider == "minimax" else "https://api.anthropic.com"
        )
        anthropic_messages = [{"role": "user", "content": prompt}]
        body = {
            "model": model_id or ("claude-sonnet-4-6" if provider == "anthropic" else "minimax-m3"),
            "max_tokens": max_new_tokens,
            "temperature": max(temperature, 0.01),
            "top_p": top_p,
            "messages": anthropic_messages,
        }
        if system_prompt:
            body["system"] = system_prompt

        resp = requests.post(f"{base_url.rstrip('/')}/v1/messages", json=body, headers=headers, timeout=(10, 600))
        resp.raise_for_status()
        data = resp.json()
        parts = [block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"]
        return "".join(parts)

    # OpenAI-compatible surface (OpenAI, Ollama, custom remote)
    if provider == "ollama":
        base_url = remote_url.rstrip("/") if remote_url else "http://localhost:11434"
        endpoint = f"{base_url}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
    elif provider == "openai":
        base_url = remote_url.rstrip("/") if remote_url else "https://api.openai.com/v1"
        endpoint = f"{base_url}/chat/completions" if "/v1" in base_url else f"{base_url}/v1/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    else:  # generic remote
        base_url = remote_url.rstrip("/")
        endpoint = f"{base_url}/v1/chat/completions" if not base_url.endswith("/v1") else f"{base_url}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model_id,
        "messages": messages,
        "max_tokens": max_new_tokens,
        "temperature": max(temperature, 0.01),
        "top_p": top_p,
    }
    if json_schema:
        if provider == "openai":
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "plan_output", "schema": json_schema, "strict": True},
            }
        else:
            payload["response_format"] = {"type": "json_object"}

    resp = requests.post(endpoint, json=payload, headers=headers, timeout=(10, 600))
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"].get("content") or ""
