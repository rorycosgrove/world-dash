"""
Cloud LLM service for chat generation via OpenAI, Anthropic, Azure, and OpenRouter.

Reads configuration from Redis (`worlddash:cloud_ai_config`).  When the cloud
provider is enabled the chat endpoint will route generation through this module
instead of the local Ollama instance, while embeddings still remain on Ollama so
that the pgvector search stays consistent.
"""

import json
from typing import Optional

import httpx
import redis as _redis

from packages.shared.config import get_settings
from packages.shared.logging import get_logger

logger = get_logger(__name__)

_CLOUD_AI_REDIS_KEY = "worlddash:cloud_ai_config"


def _get_redis() -> _redis.Redis:
    settings = get_settings()
    return _redis.Redis(
        host=settings.redis.host,
        port=settings.redis.port,
        db=settings.redis.db,
        decode_responses=True,
    )


def get_cloud_ai_config() -> dict:
    """Read cloud AI configuration from Redis.  Returns a dict with
    ``provider``, ``api_key``, ``model``, ``endpoint``, ``enabled``.
    """
    try:
        r = _get_redis()
        raw = r.get(_CLOUD_AI_REDIS_KEY)
        if raw:
            data = json.loads(raw)
            # Decrypt the API key if an encryption key is configured
            if data.get("api_key"):
                data["api_key"] = _decrypt_api_key(data["api_key"])
            return data
    except Exception as e:
        logger.warning("cloud_ai_config_read_failed", error=str(e))
    return {"provider": "openai", "api_key": "", "model": "gpt-4o-mini", "endpoint": "", "enabled": False}


def _decrypt_api_key(value: str) -> str:
    """Decrypt a Fernet-encrypted API key.  Falls back to returning the raw
    value if no ENCRYPTION_KEY is set or decryption fails (e.g. key was stored
    before encryption was enabled)."""
    settings = get_settings()
    key = settings.api.encryption_key
    if not key:
        return value
    try:
        from cryptography.fernet import Fernet
        f = Fernet(key.encode() if isinstance(key, str) else key)
        return f.decrypt(value.encode()).decode()
    except Exception:
        return value


def is_cloud_ai_enabled() -> bool:
    cfg = get_cloud_ai_config()
    return bool(cfg.get("enabled") and cfg.get("api_key"))


# ---------------------------------------------------------------------------
# Provider-specific helpers
# ---------------------------------------------------------------------------

def _openai_compatible_payload(
    system_prompt: str,
    user_message: str,
    model: str,
    temperature: float = 0.5,
    tools: Optional[list[dict]] = None,
) -> dict:
    """Build an OpenAI-compatible chat-completions payload (works for
    OpenAI, Azure, OpenRouter, and any compatible endpoint)."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    return payload


def _anthropic_payload(
    system_prompt: str,
    user_message: str,
    model: str,
    temperature: float = 0.5,
    tools: Optional[list[dict]] = None,
) -> dict:
    """Build an Anthropic Messages API payload."""
    payload: dict = {
        "model": model,
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = [
            {
                "name": t["function"]["name"],
                "description": t["function"].get("description", ""),
                "input_schema": t["function"].get("parameters", {}),
            }
            for t in tools
        ]
    return payload


def _resolve_endpoint(provider: str, endpoint: str) -> str:
    """Return the full URL for the chat completions endpoint."""
    if provider == "anthropic":
        return endpoint or "https://api.anthropic.com/v1/messages"
    if provider == "azure":
        # Azure requires endpoint like https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-06-01
        return endpoint  # user provides the full URL
    if provider == "openrouter":
        return endpoint or "https://openrouter.ai/api/v1/chat/completions"
    # openai / custom
    base = endpoint or "https://api.openai.com/v1"
    if base.endswith("/"):
        base = base.rstrip("/")
    if not base.endswith("/chat/completions"):
        base += "/chat/completions"
    return base


def _build_headers(provider: str, api_key: str) -> dict:
    if provider == "anthropic":
        return {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
    if provider == "azure":
        return {
            "api-key": api_key,
            "content-type": "application/json",
        }
    # openai / openrouter / custom
    return {
        "Authorization": f"Bearer {api_key}",
        "content-type": "application/json",
    }


def _extract_text_from_response(provider: str, data: dict) -> str:
    """Pull the assistant text from the provider-specific JSON response."""
    if provider == "anthropic":
        # Anthropic returns {content: [{type:"text", text:"..."}]}
        for block in data.get("content", []):
            if block.get("type") == "text":
                return block.get("text", "")
        return ""
    # OpenAI-compatible
    choices = data.get("choices", [])
    if choices:
        return choices[0].get("message", {}).get("content", "")
    return ""


def _extract_tool_calls_from_response(provider: str, data: dict) -> list[dict]:
    """Extract native tool-call objects from the provider response."""
    if provider == "anthropic":
        calls = []
        for block in data.get("content", []):
            if block.get("type") == "tool_use":
                calls.append({
                    "id": block.get("id", ""),
                    "name": block.get("name", ""),
                    "arguments": block.get("input", {}),
                })
        return calls
    # OpenAI-compatible
    choices = data.get("choices", [])
    if not choices:
        return []
    msg = choices[0].get("message", {})
    raw_calls = msg.get("tool_calls", [])
    calls = []
    for tc in raw_calls:
        fn = tc.get("function", {})
        args = fn.get("arguments", "{}")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        calls.append({
            "id": tc.get("id", ""),
            "name": fn.get("name", ""),
            "arguments": args,
        })
    return calls


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

async def cloud_generate(
    system_prompt: str,
    user_message: str,
    *,
    tools: Optional[list[dict]] = None,
    temperature: float = 0.5,
    timeout: float = 120.0,
) -> dict:
    """Call the configured cloud LLM provider.

    Returns ``{"text": str, "tool_calls": list[dict], "raw": dict}``.
    Raises ``RuntimeError`` when the provider is not configured or the call fails.
    """
    cfg = get_cloud_ai_config()
    if not cfg.get("enabled") or not cfg.get("api_key"):
        raise RuntimeError("Cloud AI is not configured or not enabled")

    provider = cfg.get("provider", "openai")
    api_key = cfg["api_key"]
    model = cfg.get("model", "gpt-4o-mini")
    endpoint = _resolve_endpoint(provider, cfg.get("endpoint", ""))
    headers = _build_headers(provider, api_key)

    if provider == "anthropic":
        payload = _anthropic_payload(system_prompt, user_message, model, temperature, tools)
    else:
        payload = _openai_compatible_payload(system_prompt, user_message, model, temperature, tools)

    logger.info("cloud_llm_request", provider=provider, model=model, endpoint=endpoint)

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    text = _extract_text_from_response(provider, data)
    tool_calls = _extract_tool_calls_from_response(provider, data) if tools else []

    return {"text": text, "tool_calls": tool_calls, "raw": data}
