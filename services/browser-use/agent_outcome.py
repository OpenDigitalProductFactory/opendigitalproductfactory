"""Agent-run outcome inspection (BI-1BAA177C).

browser-use's Agent.run() does NOT raise when the agent aborts (e.g. after
consecutive BrowserStateRequestEvent failures when the internal browser
session cannot produce state) — it returns an AgentHistoryList that simply
never reached a terminal success. Upstream code that stringifies that history
turns a dead browser into success-shaped empty results, which the portal then
cannot distinguish from "page has no issues".

Kept stdlib-only (duck-typed against the history object) so it is unit
testable without the browser_use dependency — same pattern as url_policy.py.
"""

from typing import Any, Tuple


def agent_outcome(agent_result: Any) -> Tuple[bool, str]:
    """Classify an Agent.run() return value.

    Returns (ok, reason). ok=False means the agent did not complete its task
    — the run is DEGRADED and its content must not be treated as an empty
    success. Inspection is defensive: if the history object does not expose
    the expected browser-use API, we do NOT degrade (never false-alarm on an
    API drift; the capability probe owns deep detection).
    """
    if agent_result is None:
        return False, "agent returned no history"

    try:
        is_done = getattr(agent_result, "is_done", None)
        done = is_done() if callable(is_done) else None

        is_successful = getattr(agent_result, "is_successful", None)
        successful = is_successful() if callable(is_successful) else None

        if done is False:
            return False, (
                "agent stopped before completing its task "
                "(browser state unavailable or consecutive step failures)"
            )
        if successful is False:
            return False, "agent completed but reported failure"

        # done True/unknown and successful True/None/unknown → treat as ok.
        return True, ""
    except Exception as exc:  # noqa: BLE001 — inspection must never crash a handler
        return True, f"outcome inspection unavailable: {exc}"
