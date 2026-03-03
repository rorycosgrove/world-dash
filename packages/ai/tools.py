"""
LLM tool definitions and executor.

Defines a set of 'tools' that the LLM can invoke during a chat conversation
to query the database.  Each tool maps to an ``EventRepository`` method (or
equivalent) and returns structured data the LLM can use to build its answer
and chart specs.

Two output formats are provided:

1. **OpenAI function-calling schema** – used when routing through a cloud
   provider that supports native tool use (OpenAI, Anthropic, etc.).
2. **Fenced-block spec** – a text description appended to the system prompt
   so that local Ollama models can emit ``tool-call`` blocks.
"""

import json
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from packages.shared.logging import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Tool registry — each entry declares its name, description, parameters
# (JSON-Schema style), and an executor function.
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_events",
            "description": "Search events with optional filters for severity, category, time range, and free-text search.  Returns the most recent matching events.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Free-text search term (matched against title and description).",
                    },
                    "severity": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical"],
                        "description": "Filter to a specific severity level.",
                    },
                    "category": {
                        "type": "string",
                        "description": "Filter to events whose categories array contains this value (e.g. 'military', 'economic').",
                    },
                    "since_hours": {
                        "type": "integer",
                        "description": "Only include events published within the last N hours.  Default 168 (7 days).",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default 10).",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_event_detail",
            "description": "Retrieve full details of a single event by its ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {
                        "type": "string",
                        "description": "UUID of the event.",
                    },
                },
                "required": ["event_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_similar_events",
            "description": "Find events semantically similar to a given event using vector embeddings.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {
                        "type": "string",
                        "description": "UUID of the reference event.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 8).",
                    },
                },
                "required": ["event_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_by_category",
            "description": "Find events that share any of the given categories.",
            "parameters": {
                "type": "object",
                "properties": {
                    "categories": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of category names to match (e.g. ['military', 'conflict']).",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10).",
                    },
                },
                "required": ["categories"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_by_actors",
            "description": "Find events involving any of the given actors (countries, organizations, groups).",
            "parameters": {
                "type": "object",
                "properties": {
                    "actors": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of actor names (e.g. ['NATO', 'Russia', 'China']).",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10).",
                    },
                },
                "required": ["actors"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "semantic_search",
            "description": "Perform a semantic (vector similarity) search across all events using a natural language query.  Use this when the user asks broad analytical questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language query text to find semantically similar events.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 8).",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_analytics_summary",
            "description": "Return aggregate statistics: top categories, top actors, top themes, severity counts, significance distribution.  Useful for dashboard-level overviews.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]


def get_tool_definitions() -> list[dict]:
    """Return tool definitions in OpenAI function-calling format."""
    return TOOL_DEFINITIONS


def get_tool_prompt_block() -> str:
    """Return a text block describing available tools for the system prompt.

    Used when the LLM does not support native function calling (e.g. Ollama).
    The LLM is instructed to emit a fenced ``tool-call`` block.
    """
    lines = [
        "TOOL USE CAPABILITY:",
        "You can query the intelligence database by emitting a tool-call block.",
        "When you need data to answer the user's question, output a fenced block:",
        "",
        "```tool-call",
        '{"tool": "<tool_name>", "args": {<arguments>}}',
        "```",
        "",
        "Available tools:",
    ]
    for td in TOOL_DEFINITIONS:
        fn = td["function"]
        params = fn["parameters"].get("properties", {})
        param_desc = ", ".join(
            f'{k}: {v.get("type", "string")}' for k, v in params.items()
        )
        lines.append(f'  - {fn["name"]}({param_desc}) — {fn["description"]}')
    lines += [
        "",
        "After I execute the tool, I will provide the results and you should then give your final answer.",
        "You may call at most one tool per response.  If no tool is needed, answer directly.",
        "",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool executor
# ---------------------------------------------------------------------------

def _serialize_event(event) -> dict:
    """Convert an EventRead to a compact dict for the LLM context."""
    return {
        "id": str(event.id),
        "title": event.title,
        "description": (event.description or "")[:300],
        "severity": event.severity,
        "risk_score": event.risk_score,
        "categories": event.categories or [],
        "actors": event.actors or [],
        "themes": event.themes or [],
        "llm_significance": event.llm_significance,
        "published_at": event.published_at.isoformat() if event.published_at else None,
    }


async def execute_tool(
    tool_name: str,
    args: dict,
    db_session,
    llm_service=None,
) -> dict:
    """Execute a named tool and return structured results.

    Parameters
    ----------
    tool_name : str
        One of the registered tool names.
    args : dict
        Arguments parsed from the LLM's tool call.
    db_session : sqlalchemy.orm.Session
        Active database session.
    llm_service : LlamaService | None
        For semantic_search — needs the embed_text method.

    Returns
    -------
    dict
        ``{"success": bool, "data": ..., "error": str | None}``
    """
    from packages.storage.repositories import EventRepository

    event_repo = EventRepository(db_session)

    try:
        if tool_name == "search_events":
            since = None
            since_hours = args.get("since_hours", 168)
            if since_hours:
                since = datetime.utcnow() - timedelta(hours=int(since_hours))

            severity = args.get("severity")
            search = args.get("query")
            limit = min(int(args.get("limit", 10)), 30)

            # If a category filter is requested, use list_by_categories
            category = args.get("category")
            if category and not search and not severity:
                events = event_repo.list_by_categories([category], limit=limit)
            else:
                from packages.shared.schemas import EventSeverity as ES
                sev = None
                if severity:
                    # Normalise LLM-provided severity to valid enum value
                    _sev_map = {"severe": "critical", "critical": "critical", "high": "high", "medium": "medium", "moderate": "medium", "low": "low", "minor": "low"}
                    try:
                        sev = ES(severity.lower())
                    except ValueError:
                        mapped = _sev_map.get(severity.lower())
                        sev = ES(mapped) if mapped else None
                events = event_repo.list_recent(
                    limit=limit,
                    severity=sev,
                    since=since,
                    search=search,
                )
                # Post-filter by category if also specified
                if category:
                    events = [e for e in events if category.lower() in [c.lower() for c in (e.categories or [])]]

            return {
                "success": True,
                "data": {
                    "count": len(events),
                    "events": [_serialize_event(e) for e in events],
                },
            }

        elif tool_name == "get_event_detail":
            event_id = args.get("event_id")
            if not event_id:
                return {"success": False, "data": None, "error": "event_id is required"}
            event = event_repo.get_by_id(UUID(event_id))
            if not event:
                return {"success": False, "data": None, "error": f"Event {event_id} not found"}
            return {"success": True, "data": _serialize_event(event)}

        elif tool_name == "find_similar_events":
            event_id = args.get("event_id")
            if not event_id:
                return {"success": False, "data": None, "error": "event_id is required"}
            limit = min(int(args.get("limit", 8)), 20)
            results = event_repo.find_similar_to_event(UUID(event_id), limit=limit, min_similarity=0.35)
            return {
                "success": True,
                "data": {
                    "count": len(results),
                    "events": [
                        {**_serialize_event(r["event"]), "similarity": r["similarity"]}
                        for r in results
                    ],
                },
            }

        elif tool_name == "search_by_category":
            categories = args.get("categories", [])
            if not categories:
                return {"success": False, "data": None, "error": "categories list is required"}
            limit = min(int(args.get("limit", 10)), 30)
            events = event_repo.list_by_categories(categories, limit=limit)
            return {
                "success": True,
                "data": {
                    "count": len(events),
                    "events": [_serialize_event(e) for e in events],
                },
            }

        elif tool_name == "search_by_actors":
            actors = args.get("actors", [])
            if not actors:
                return {"success": False, "data": None, "error": "actors list is required"}
            limit = min(int(args.get("limit", 10)), 30)
            events = event_repo.list_by_actors(actors, limit=limit)
            return {
                "success": True,
                "data": {
                    "count": len(events),
                    "events": [_serialize_event(e) for e in events],
                },
            }

        elif tool_name == "semantic_search":
            query = args.get("query", "")
            if not query:
                return {"success": False, "data": None, "error": "query is required"}
            if not llm_service:
                return {"success": False, "data": None, "error": "LLM service unavailable for embeddings"}
            limit = min(int(args.get("limit", 8)), 20)
            embedding = await llm_service.embed_text(query)
            if not embedding:
                return {"success": False, "data": None, "error": "Failed to generate embedding"}
            results = event_repo.find_similar(embedding=embedding, limit=limit, min_similarity=0.35)
            return {
                "success": True,
                "data": {
                    "count": len(results),
                    "events": [
                        {**_serialize_event(r["event"]), "similarity": r["similarity"]}
                        for r in results
                    ],
                },
            }

        elif tool_name == "get_analytics_summary":
            # Reuse the same logic as the /analysis/summary endpoint
            from sqlalchemy import func as sa_func
            from packages.storage.models import Event
            from packages.shared.schemas import EventStatus as ES

            all_events = event_repo.list_recent(limit=500)
            llm_processed = [e for e in all_events if e.llm_processed_at]
            with_enrichment = [e for e in all_events if e.categories]

            # Top categories
            cat_counts: dict[str, int] = {}
            for e in all_events:
                for c in (e.categories or []):
                    cat_counts[c] = cat_counts.get(c, 0) + 1
            top_categories = sorted(cat_counts.items(), key=lambda x: -x[1])[:10]

            # Top actors
            actor_counts: dict[str, int] = {}
            for e in all_events:
                for a in (e.actors or []):
                    actor_counts[a] = actor_counts.get(a, 0) + 1
            top_actors = sorted(actor_counts.items(), key=lambda x: -x[1])[:10]

            # Top themes
            theme_counts: dict[str, int] = {}
            for e in all_events:
                for t in (e.themes or []):
                    theme_counts[t] = theme_counts.get(t, 0) + 1
            top_themes = sorted(theme_counts.items(), key=lambda x: -x[1])[:10]

            # Severity distribution
            sev_counts: dict[str, int] = {}
            for e in all_events:
                s = e.severity or "medium"
                sev_counts[s] = sev_counts.get(s, 0) + 1

            # Significance distribution
            sig_counts: dict[str, int] = {}
            for e in all_events:
                sig = e.llm_significance or "unknown"
                sig_counts[sig] = sig_counts.get(sig, 0) + 1

            return {
                "success": True,
                "data": {
                    "total_events": len(all_events),
                    "llm_processed": len(llm_processed),
                    "with_enrichment": len(with_enrichment),
                    "top_categories": [{"name": n, "count": c} for n, c in top_categories],
                    "top_actors": [{"name": n, "count": c} for n, c in top_actors],
                    "top_themes": [{"name": n, "count": c} for n, c in top_themes],
                    "severity_distribution": [{"level": k, "count": v} for k, v in sev_counts.items()],
                    "significance_distribution": [{"level": k, "count": v} for k, v in sig_counts.items()],
                },
            }

        else:
            return {"success": False, "data": None, "error": f"Unknown tool: {tool_name}"}

    except Exception as e:
        logger.error("tool_execution_error", tool=tool_name, error=str(e))
        return {"success": False, "data": None, "error": str(e)}
