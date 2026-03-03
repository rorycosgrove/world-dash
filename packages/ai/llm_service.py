"""
LLM service for semantic text analysis using Ollama/Llama.
Configuration is read at call-time from Redis (set via the Settings UI)
and falls back to environment variables when no override exists.
"""

import json
from typing import Optional

import httpx
import numpy as np
import redis as _redis

from packages.shared.config import get_settings
from packages.shared.logging import get_logger

logger = get_logger(__name__)

# Redis keys used to store runtime LLM configuration
_REDIS_PREFIX = "worlddash:llm_config"
_KEY_ENDPOINT = f"{_REDIS_PREFIX}:endpoint"
_KEY_MODEL = f"{_REDIS_PREFIX}:model"
_KEY_TIMEOUT = f"{_REDIS_PREFIX}:timeout"
_KEY_ENABLED = f"{_REDIS_PREFIX}:enabled"
_KEY_EMBEDDING_MODEL = f"{_REDIS_PREFIX}:embedding_model"


def _get_redis() -> _redis.Redis:
    settings = get_settings()
    return _redis.Redis(
        host=settings.redis.host,
        port=settings.redis.port,
        db=settings.redis.db,
        decode_responses=True,
    )


# ---------------------------------------------------------------------------
# Runtime config helpers (used by API + worker)
# ---------------------------------------------------------------------------

def get_runtime_llm_config() -> dict:
    """
    Return the effective LLM config: Redis overrides > env vars.
    """
    settings = get_settings()
    r = _get_redis()

    endpoint = r.get(_KEY_ENDPOINT) or settings.ollama.endpoint
    model = r.get(_KEY_MODEL) or settings.ollama.model
    embedding_model = r.get(_KEY_EMBEDDING_MODEL) or settings.ollama.embedding_model
    timeout_raw = r.get(_KEY_TIMEOUT)
    timeout = int(timeout_raw) if timeout_raw else settings.ollama.timeout_seconds
    enabled_raw = r.get(_KEY_ENABLED)
    if enabled_raw is not None:
        enabled = enabled_raw.lower() in ("true", "1", "yes")
    else:
        enabled = settings.ollama.enabled

    return {
        "endpoint": endpoint,
        "model": model,
        "embedding_model": embedding_model,
        "timeout_seconds": timeout,
        "enabled": enabled,
    }


def set_runtime_llm_config(
    endpoint: Optional[str] = None,
    model: Optional[str] = None,
    embedding_model: Optional[str] = None,
    timeout_seconds: Optional[int] = None,
    enabled: Optional[bool] = None,
) -> dict:
    """
    Persist LLM config overrides in Redis.  Workers pick this up on the
    very next task — no container restart required.
    """
    r = _get_redis()

    if endpoint is not None:
        r.set(_KEY_ENDPOINT, endpoint)
    if model is not None:
        r.set(_KEY_MODEL, model)
    if embedding_model is not None:
        r.set(_KEY_EMBEDDING_MODEL, embedding_model)
    if timeout_seconds is not None:
        r.set(_KEY_TIMEOUT, str(timeout_seconds))
    if enabled is not None:
        r.set(_KEY_ENABLED, str(enabled).lower())

    return get_runtime_llm_config()


# ---------------------------------------------------------------------------
# LLM Service
# ---------------------------------------------------------------------------

class LlamaService:
    """Service for interacting with local Ollama instance."""

    def __init__(
        self,
        endpoint: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[int] = None,
    ):
        # Read runtime config (Redis > env)
        cfg = get_runtime_llm_config()
        self.endpoint = endpoint or cfg["endpoint"]
        self.model = model or cfg["model"]
        self.embedding_model = cfg["embedding_model"]
        self.timeout = timeout or cfg["timeout_seconds"]
        self.enabled = cfg["enabled"]

    def _build_extraction_prompt(self, text: str) -> str:
        return f"""Analyze this geopolitical intelligence event and extract key semantic information:

Event: {text}

Respond in JSON format with these fields:
- categories: list of 2-4 semantic categories (e.g., "military", "diplomatic", "economic", "humanitarian", "protest", "conflict", "trade", "sanctions", "alliance", "cyber", "environmental")
- actors: list of 1-3 key actors/entities (countries, organizations, groups)
- locations: list of 1-3 geographic regions affected
- themes: list of 1-3 overarching themes (what this is fundamentally about)
- significance: one of "low", "medium", "high", "critical"

Return only the JSON object, no additional text."""

    @staticmethod
    def _parse_json_response(response_text: str) -> Optional[dict]:
        """Parse JSON from LLM response, handling markdown code blocks and <think> tags."""
        json_text = response_text.strip()

        # Strip <think>...</think> blocks (deepseek-r1 produces these)
        import re
        json_text = re.sub(r"<think>.*?</think>", "", json_text, flags=re.DOTALL).strip()

        if "```" in json_text:
            parts = json_text.split("```")
            for part in parts[1:]:
                cleaned = part.strip()
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()
                if cleaned.startswith("{"):
                    json_text = cleaned
                    break

        # If there's still extra text around the JSON, extract the first { ... }
        start = json_text.find("{")
        end = json_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            json_text = json_text[start : end + 1]

        try:
            return json.loads(json_text)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _empty_result() -> dict:
        return {
            "categories": [],
            "actors": [],
            "locations": [],
            "themes": [],
            "significance": "medium",
        }

    @staticmethod
    def _sanitize_result(parsed: dict) -> dict:
        return {
            "categories": parsed.get("categories", [])[:4],
            "actors": parsed.get("actors", [])[:3],
            "locations": parsed.get("locations", [])[:3],
            "themes": parsed.get("themes", [])[:3],
            "significance": parsed.get("significance", "medium"),
        }

    # ---- async interface (used by API on-demand analysis) ----

    async def extract_event_context(
        self,
        title: str,
        description: Optional[str] = None,
    ) -> dict:
        if not self.enabled:
            logger.debug("llm_disabled", reason="OLLAMA_ENABLED=false")
            return self._empty_result()

        text = f"{title}\n{description}" if description else title
        prompt = self._build_extraction_prompt(text)

        try:
            async with httpx.AsyncClient(timeout=float(self.timeout)) as client:
                response = await client.post(
                    f"{self.endpoint}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "temperature": 0.3,
                    },
                )
                response.raise_for_status()
                result = response.json()
                response_text = result.get("response", "").strip()

                parsed = self._parse_json_response(response_text)
                if parsed:
                    return self._sanitize_result(parsed)

                logger.warning("llm_json_parse_failed", response_text=response_text[:200])
                return self._empty_result()

        except httpx.ConnectError:
            logger.warning("llm_service_unavailable", endpoint=self.endpoint)
            return self._empty_result()
        except httpx.TimeoutException:
            logger.warning("llm_service_timeout", endpoint=self.endpoint, timeout=self.timeout)
            return self._empty_result()
        except Exception as e:
            logger.error("llm_extract_error", error=str(e))
            return self._empty_result()

    # ---- sync interface (used by Celery worker) ----

    def extract_event_context_sync(
        self,
        title: str,
        description: Optional[str] = None,
    ) -> dict:
        if not self.enabled:
            logger.debug("llm_disabled_sync", reason="OLLAMA_ENABLED=false")
            return self._empty_result()

        text = f"{title}\n{description}" if description else title
        prompt = self._build_extraction_prompt(text)

        try:
            with httpx.Client(timeout=float(self.timeout)) as client:
                response = client.post(
                    f"{self.endpoint}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "temperature": 0.3,
                    },
                )
                response.raise_for_status()
                result = response.json()
                response_text = result.get("response", "").strip()

                parsed = self._parse_json_response(response_text)
                if parsed:
                    return self._sanitize_result(parsed)

                logger.warning("llm_json_parse_failed_sync", response_text=response_text[:200])
                return self._empty_result()

        except httpx.ConnectError:
            logger.warning("llm_service_unavailable_sync", endpoint=self.endpoint)
            return self._empty_result()
        except httpx.TimeoutException:
            logger.warning("llm_service_timeout_sync", endpoint=self.endpoint)
            return self._empty_result()
        except Exception as e:
            logger.error("llm_extract_error_sync", error=str(e))
            return self._empty_result()

    # ---- embeddings ----

    async def embed_text(self, text: str) -> Optional[list[float]]:
        """Generate embedding vector for text using Ollama embeddings API."""
        if not self.enabled:
            return None

        try:
            async with httpx.AsyncClient(timeout=float(self.timeout)) as client:
                response = await client.post(
                    f"{self.endpoint}/api/embeddings",
                    json={
                        "model": self.embedding_model,
                        "prompt": text,
                    },
                )
                response.raise_for_status()
                result = response.json()
                embedding = result.get("embedding")
                if embedding:
                    # Normalize to unit vector for cosine similarity
                    arr = np.array(embedding, dtype=np.float32)
                    norm = np.linalg.norm(arr)
                    if norm > 0:
                        arr = arr / norm
                    return arr.tolist()
                logger.warning("embed_empty_response")
                return None

        except httpx.ConnectError:
            logger.warning("embed_service_unavailable", endpoint=self.endpoint)
            return None
        except httpx.TimeoutException:
            logger.warning("embed_service_timeout", endpoint=self.endpoint)
            return None
        except Exception as e:
            logger.error("embed_error", error=str(e))
            return None

    def embed_text_sync(self, text: str) -> Optional[list[float]]:
        """Synchronous embedding generation (for Celery workers)."""
        if not self.enabled:
            return None

        try:
            with httpx.Client(timeout=float(self.timeout)) as client:
                response = client.post(
                    f"{self.endpoint}/api/embeddings",
                    json={
                        "model": self.embedding_model,
                        "prompt": text,
                    },
                )
                response.raise_for_status()
                result = response.json()
                embedding = result.get("embedding")
                if embedding:
                    arr = np.array(embedding, dtype=np.float32)
                    norm = np.linalg.norm(arr)
                    if norm > 0:
                        arr = arr / norm
                    return arr.tolist()
                logger.warning("embed_empty_response_sync")
                return None

        except httpx.ConnectError:
            logger.warning("embed_service_unavailable_sync", endpoint=self.endpoint)
            return None
        except httpx.TimeoutException:
            logger.warning("embed_service_timeout_sync", endpoint=self.endpoint)
            return None
        except Exception as e:
            logger.error("embed_error_sync", error=str(e))
            return None

    def build_event_embed_text(self, title: str, description: Optional[str] = None,
                                categories: Optional[list] = None,
                                actors: Optional[list] = None,
                                themes: Optional[list] = None) -> str:
        """Build a text representation of an event optimized for embedding."""
        parts = [title]
        if description:
            # Truncate description to keep embedding focused
            parts.append(description[:500])
        if categories:
            parts.append(f"Categories: {', '.join(categories)}")
        if actors:
            parts.append(f"Actors: {', '.join(actors)}")
        if themes:
            parts.append(f"Themes: {', '.join(themes)}")
        return "\n".join(parts)

    # ---- related events ----

    async def find_related_events(
        self,
        event_title: str,
        event_context: dict,
        other_events: list,
    ) -> list:
        if not other_events or not self.enabled:
            return []

        other_titles = "\n".join(
            [f"{i+1}. [{e.get('id')}] {e.get('title')}" for i, e in enumerate(other_events[:10])]
        )

        prompt = f"""Given a reference geopolitical event and a list of other events, identify which events are semantically related (same topic, same region, same actors, etc).

Reference Event: {event_title}
Context: {json.dumps(event_context)}

Other Events:
{other_titles}

Return a JSON array of event IDs that are related. Only include clear connections. Format: {{"related_ids": ["id1", "id2", ...]}}

Return only the JSON, no additional text."""

        try:
            async with httpx.AsyncClient(timeout=float(self.timeout)) as client:
                response = await client.post(
                    f"{self.endpoint}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "temperature": 0.3,
                    },
                )
                response.raise_for_status()
                result = response.json()
                response_text = result.get("response", "").strip()

                parsed = self._parse_json_response(response_text)
                if parsed:
                    return parsed.get("related_ids", [])

                logger.warning("llm_related_parse_failed")
                return []

        except Exception as e:
            logger.error("llm_find_related_error", error=str(e))
            return []

    # ---- health / model listing ----

    async def check_health(self) -> dict:
        """Check Ollama connectivity and model availability."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.endpoint}/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    models = data.get("models", [])
                    model_found = any(
                        m.get("name", "").startswith(self.model) for m in models
                    )
                    return {
                        "status": "healthy" if model_found else "degraded",
                        "endpoint": self.endpoint,
                        "model": self.model,
                        "available_models": [m.get("name", "unknown") for m in models],
                        "model_found": model_found,
                        "enabled": self.enabled,
                    }
                return {
                    "status": "unhealthy",
                    "endpoint": self.endpoint,
                    "model": self.model,
                    "error": f"HTTP {response.status_code}",
                    "enabled": self.enabled,
                }
        except Exception as e:
            return {
                "status": "unhealthy",
                "endpoint": self.endpoint,
                "model": self.model,
                "error": str(e),
                "enabled": self.enabled,
            }

    async def list_models(self) -> list[str]:
        """Return names of all models available on the Ollama server."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.endpoint}/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    return [m.get("name", "unknown") for m in data.get("models", [])]
        except Exception as e:
            logger.warning("list_models_failed", error=str(e))
        return []


def get_llama_service(
    endpoint: Optional[str] = None,
    model: Optional[str] = None,
) -> LlamaService:
    """Create a LlamaService instance (reads runtime config from Redis)."""
    return LlamaService(endpoint=endpoint, model=model)
