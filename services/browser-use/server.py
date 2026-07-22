"""
browser-use MCP Server
Exposes AI-powered browser automation as MCP tools over HTTP JSON-RPC.
Sessions persist across tool calls for context continuity.
"""

import asyncio
import base64
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# browser-use 0.12.x: Agent + BrowserSession live at top-level, ChatOpenAI is
# shipped by the library (no langchain dependency).
from browser_use import Agent, BrowserSession, ChatOpenAI, ChatAnthropic

# Pure URL navigation policy (SSRF guard + per-session target-domain allowlist).
# EP-BROWSER-DRIVE Phase 2 — kept in a stdlib-only module so it is unit-testable
# without the browser_use deps.
from url_policy import check_navigation

# Agent-run outcome inspection (BI-1BAA177C) — stdlib-only, unit-tested.
# Agent.run() does not raise on an aborted run; without this check a dead
# browser session becomes success-shaped empty results.
from agent_outcome import agent_outcome

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browser-use-mcp")

# ── Configuration ──────────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "8500"))
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://model-runner.docker.internal/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "not-needed-for-local")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
EVIDENCE_DIR = os.environ.get("EVIDENCE_DIR", "/evidence")
SESSION_TIMEOUT_SECONDS = int(os.environ.get("SESSION_TIMEOUT_SECONDS", "600"))
# The Dockerfile installs the system Chromium at /usr/bin/chromium. browser-use
# 0.12.x otherwise looks for a Playwright-managed browser (not installed in this
# image), so its BrowserSession never connects and every navigate fails with
# "CDP client not initialized - browser may not be connected yet". Point it at
# the installed binary explicitly. Overridable via CHROME_BIN.
CHROME_BIN = os.environ.get("CHROME_BIN") or "/usr/bin/chromium"
# Service-account Chromium profiles live here (EP-BROWSER-DRIVE, spec §8.9).
# Sidecar-only volume; a requested profile_path must resolve inside it.
PROFILES_DIR = os.environ.get("PROFILES_DIR", "/profiles")

os.makedirs(EVIDENCE_DIR, exist_ok=True)


def _is_safe_profile_path(profile_path: str) -> bool:
    """True if profile_path resolves to a location inside PROFILES_DIR (no
    traversal/symlink escape). Defense in depth around the secret profiles
    volume."""
    if not isinstance(profile_path, str) or not profile_path.strip():
        return False
    root = os.path.realpath(PROFILES_DIR)
    target = os.path.realpath(profile_path)
    return target == root or target.startswith(root + os.sep)


# ── Session Manager ────────────────────────────────────────────────────────

@dataclass
class ActionRecord:
    """A single action performed during a browser session."""
    timestamp: float
    action: str
    detail: str
    success: bool
    screenshot_path: str | None = None


@dataclass
class BrowserSessionWrapper:
    """Persistent browser session with evidence capture."""
    session_id: str
    browser: BrowserSession
    agent: Agent | None = None
    created_at: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)
    actions: list[ActionRecord] = field(default_factory=list)
    url: str = ""
    # EP-BROWSER-DRIVE Phase 2: per-session driving policy + persistence.
    target_domains: list[str] | None = None
    profile_path: str | None = None
    evidence_subdir: str | None = None

    def touch(self):
        self.last_used = time.time()

    def is_expired(self) -> bool:
        return (time.time() - self.last_used) > SESSION_TIMEOUT_SECONDS


class SessionManager:
    """Manages persistent browser sessions with auto-cleanup."""

    def __init__(self):
        self._sessions: dict[str, BrowserSessionWrapper] = {}
        self._cleanup_task: asyncio.Task | None = None

    async def start(self):
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def stop(self):
        if self._cleanup_task:
            self._cleanup_task.cancel()
        for session in list(self._sessions.values()):
            await self._close_session(session)

    async def _cleanup_loop(self):
        while True:
            await asyncio.sleep(60)
            expired = [s for s in self._sessions.values() if s.is_expired()]
            for session in expired:
                logger.info("Auto-closing expired session %s", session.session_id)
                await self._close_session(session)

    async def open(
        self,
        url: str | None = None,
        profile_path: str | None = None,
        target_domains: list[str] | None = None,
        evidence_dir: str | None = None,
    ) -> BrowserSessionWrapper:
        session_id = str(uuid.uuid4())[:8]
        # BrowserSession takes profile fields directly as kwargs in 0.12.x.
        # executable_path pins the installed system Chromium (no Playwright
        # browser is bundled). chromium_sandbox=False + --no-sandbox because the
        # container doesn't run as an unprivileged user with user-namespace
        # support; --disable-dev-shm-usage avoids crashes on the small default
        # /dev/shm in containers; --disable-gpu for headless servers.
        browser_kwargs: dict[str, Any] = dict(
            headless=True,
            executable_path=CHROME_BIN,
            chromium_sandbox=False,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        # Persisted service-account profile (EP-BROWSER-DRIVE §8.9): a Chromium
        # user-data-dir whose cookie jar carries the account's logins. When
        # omitted, the session is ephemeral (the existing QA behavior).
        if profile_path:
            browser_kwargs["user_data_dir"] = profile_path
        browser = BrowserSession(**browser_kwargs)
        await browser.start()

        # Optional session-scoped evidence subdirectory.
        evidence_subdir = None
        if isinstance(evidence_dir, str) and evidence_dir.strip():
            safe_name = os.path.basename(evidence_dir.strip())
            if safe_name and safe_name == evidence_dir.strip():
                evidence_subdir = os.path.join(EVIDENCE_DIR, safe_name)
                os.makedirs(evidence_subdir, exist_ok=True)

        session = BrowserSessionWrapper(
            session_id=session_id,
            browser=browser,
            target_domains=target_domains or None,
            profile_path=profile_path,
            evidence_subdir=evidence_subdir,
        )

        if url:
            session.url = url

        self._sessions[session_id] = session
        logger.info(
            "Opened session %s (url=%s profile=%s domains=%s)",
            session_id, url or "none", bool(profile_path), target_domains or [],
        )
        return session

    def get(self, session_id: str) -> BrowserSessionWrapper | None:
        session = self._sessions.get(session_id)
        if session and not session.is_expired():
            session.touch()
            return session
        return None

    async def close(self, session_id: str) -> BrowserSessionWrapper | None:
        session = self._sessions.pop(session_id, None)
        if session:
            await self._close_session(session)
        return session

    async def _close_session(self, session: BrowserSessionWrapper):
        try:
            await session.browser.stop()
        except Exception as e:
            logger.warning("Error stopping browser for session %s: %s", session.session_id, e)
        self._sessions.pop(session.session_id, None)


def _build_llm():
    """Build the LLM client for browser-use agents.

    Capable agentic browser-driving needs a strong model. When configured for
    Anthropic (LLM_MODEL begins with "claude", or LLM_PROVIDER=anthropic), use
    ChatAnthropic with the direct Anthropic API key. Otherwise fall back to the
    OpenAI-compatible client (LLM_BASE_URL), which also covers local model
    runners. (2026-06-07: the prior gpt-4o-against-local-runner config produced
    empty agent histories / vacuous passes; operator chose Anthropic Claude.)
    """
    provider = os.environ.get("LLM_PROVIDER", "").lower()
    if provider == "anthropic" or LLM_MODEL.startswith("claude"):
        return ChatAnthropic(model=LLM_MODEL, api_key=ANTHROPIC_API_KEY)
    return ChatOpenAI(
        model=LLM_MODEL,
        base_url=LLM_BASE_URL,
        api_key=OPENAI_API_KEY,
    )


async def _save_screenshot(session: BrowserSessionWrapper, label: str) -> str | None:
    """Capture a screenshot and write it to EVIDENCE_DIR, returning the path."""
    try:
        page = await session.browser.get_current_page()
        if not page:
            return None
        b64 = await page.screenshot()
        filename = f"{session.session_id}_{label}_{int(time.time())}.png"
        target_dir = session.evidence_subdir or EVIDENCE_DIR
        filepath = os.path.join(target_dir, filename)
        with open(filepath, "wb") as f:
            f.write(base64.b64decode(b64))
        return filepath
    except Exception as e:
        logger.warning("Screenshot failed: %s", e)
        return None


async def _get_screenshot_base64(session: BrowserSessionWrapper) -> str | None:
    """Capture a screenshot and return it as a base64 string."""
    try:
        page = await session.browser.get_current_page()
        if not page:
            return None
        return await page.screenshot()
    except Exception as e:
        logger.warning("Screenshot failed: %s", e)
        return None


# ── MCP Tool Definitions ───────────────────────────────────────────────────

TOOLS = [
    {
        "name": "browse_open",
        "description": (
            "Open a new browser session. Optionally navigate to a URL. "
            "Returns a session_id for use in subsequent browse_* calls. "
            "Sessions persist across calls for context continuity."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "URL to navigate to on open. Optional.",
                },
                "profile_path": {
                    "type": "string",
                    "description": (
                        "Absolute path to a persisted Chromium user-data-dir under "
                        "/profiles (a service-account profile that holds the account's "
                        "logins). Optional; omit for an ephemeral headless session."
                    ),
                },
                "target_domains": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Navigation allowlist. The open URL and any later browse_act "
                        "navigation that lands off these domains is blocked. SSRF "
                        "targets (localhost, private/link-local IPs) are always blocked."
                    ),
                },
                "evidence_dir": {
                    "type": "string",
                    "description": (
                        "Optional subdirectory name under /evidence for this session's "
                        "screenshots (segment name only, no path traversal)."
                    ),
                },
            },
        },
    },
    {
        "name": "browse_act",
        "description": (
            "Execute a natural-language browser action within a session. "
            "The AI agent drives the browser adaptively: clicking, typing, scrolling, "
            "navigating. Describe what you want done in plain English. "
            "Examples: 'click the login button', 'fill in the search box with AI tools and press enter', "
            "'scroll down to the pricing section'."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID from browse_open.",
                },
                "task": {
                    "type": "string",
                    "description": "Natural-language description of the browser action to perform.",
                },
            },
            "required": ["session_id", "task"],
        },
    },
    {
        "name": "browse_extract",
        "description": (
            "Extract structured data from the current page using a natural-language query. "
            "Describe what data you want and the agent will find and structure it. "
            "Examples: 'list all product names and prices', 'get the main heading and first paragraph'."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID from browse_open.",
                },
                "query": {
                    "type": "string",
                    "description": "Natural-language description of what to extract.",
                },
            },
            "required": ["session_id", "query"],
        },
    },
    {
        "name": "browse_screenshot",
        "description": "Capture a screenshot of the current page in a session. Returns base64-encoded PNG.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID from browse_open.",
                },
            },
            "required": ["session_id"],
        },
    },
    {
        "name": "browse_run_tests",
        "description": (
            "Run a list of natural-language test cases against a URL. "
            "Each test is a plain English assertion. Returns structured pass/fail results "
            "with evidence (screenshots, action logs) for each test case."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "URL to test against.",
                },
                "tests": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of natural-language test assertions.",
                },
                "evidence_dir": {
                    "type": "string",
                    "description": (
                        "Optional subdirectory name under /evidence to write "
                        "per-test PNG screenshots into (e.g. 'build_FB-1234'). "
                        "When set, results include screenshot_path (filename "
                        "relative to the subdir). When omitted, the legacy "
                        "base64 payload is returned instead."
                    ),
                },
            },
            "required": ["url", "tests"],
        },
    },
    {
        "name": "browse_close",
        "description": (
            "Close a browser session. Returns the full action log and evidence summary."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Session ID from browse_open.",
                },
            },
            "required": ["session_id"],
        },
    },
]


# ── Tool Handlers ──────────────────────────────────────────────────────────

sessions = SessionManager()


async def handle_browse_open(params: dict[str, Any]) -> dict[str, Any]:
    url = params.get("url")
    profile_path = params.get("profile_path")
    target_domains = params.get("target_domains")
    evidence_dir = params.get("evidence_dir")

    # A requested profile must resolve inside the secret profiles volume.
    if profile_path is not None and not _is_safe_profile_path(profile_path):
        return {"status": "blocked", "error": "profile_path must resolve under /profiles"}

    # Pre-navigation SSRF + allowlist check on the open URL.
    if url:
        ok, reason = check_navigation(url, target_domains)
        if not ok:
            return {"status": "blocked", "error": reason, "url": url}

    session = await sessions.open(
        url,
        profile_path=profile_path,
        target_domains=target_domains,
        evidence_dir=evidence_dir,
    )

    result: dict[str, Any] = {"session_id": session.session_id}

    if url:
        try:
            llm = _build_llm()
            agent = Agent(
                task=f"Navigate to {url} and wait for the page to load.",
                llm=llm,
                browser=session.browser,
            )
            nav_history = await agent.run()
            nav_ok, nav_reason = agent_outcome(nav_history)
            session.actions.append(ActionRecord(
                timestamp=time.time(),
                action="navigate",
                detail=f"Opened {url}",
                success=nav_ok,
            ))
            if nav_ok:
                result["status"] = "navigated"
                result["url"] = url
            else:
                # BI-1BAA177C: an aborted navigation agent must never look
                # like a navigated session — callers treat degraded as NOT-RUN.
                result["status"] = "degraded"
                result["degraded"] = True
                result["reason"] = nav_reason
                result["url"] = url
                logger.error("browse_open DEGRADED for %s: %s", url, nav_reason)
        except Exception as e:
            result["status"] = "error"
            result["error"] = str(e)
    else:
        result["status"] = "ready"

    screenshot = await _get_screenshot_base64(session)
    if screenshot:
        result["screenshot_base64"] = screenshot

    return result


async def handle_browse_act(params: dict[str, Any]) -> dict[str, Any]:
    session_id = params["session_id"]
    task = params["task"]

    session = sessions.get(session_id)
    if not session:
        return {"error": f"Session {session_id} not found or expired."}

    try:
        llm = _build_llm()
        agent = Agent(
            task=task,
            llm=llm,
            browser=session.browser,
        )
        agent_result = await agent.run()
        act_ok, act_reason = agent_outcome(agent_result)
        if not act_ok:
            session.actions.append(ActionRecord(
                timestamp=time.time(), action="act", detail=task, success=False,
            ))
            logger.error("browse_act DEGRADED (session %s): %s", session_id, act_reason)
            return {
                "session_id": session_id,
                "status": "degraded",
                "degraded": True,
                "reason": act_reason,
                "task": task,
            }

        # Enforce the target-domain allowlist on the page the action landed on.
        # The act loop drives adaptively, so this is the deterministic checkpoint:
        # if the agent navigated off the allowlist, the action is reported blocked
        # rather than its result being trusted (EP-BROWSER-DRIVE §8.10).
        if session.target_domains:
            try:
                landed = await session.browser.get_current_page()
                current_url = getattr(landed, "url", None) if landed else None
                if current_url:
                    ok, reason = check_navigation(current_url, session.target_domains)
                    if not ok:
                        session.actions.append(ActionRecord(
                            timestamp=time.time(), action="act", detail=task, success=False,
                        ))
                        return {
                            "session_id": session_id,
                            "status": "blocked",
                            "error": f"action left the target-domain allowlist: {reason}",
                            "url": current_url,
                        }
            except Exception as e:
                logger.warning("post-act allowlist check failed: %s", e)

        screenshot_path = await _save_screenshot(session, "act")
        session.actions.append(ActionRecord(
            timestamp=time.time(),
            action="act",
            detail=task,
            success=True,
            screenshot_path=screenshot_path,
        ))

        screenshot = await _get_screenshot_base64(session)
        result: dict[str, Any] = {
            "session_id": session_id,
            "status": "completed",
            "task": task,
            "result": str(agent_result),
        }
        if screenshot:
            result["screenshot_base64"] = screenshot
        return result

    except Exception as e:
        session.actions.append(ActionRecord(
            timestamp=time.time(),
            action="act",
            detail=task,
            success=False,
        ))
        return {"session_id": session_id, "status": "error", "error": str(e)}


async def handle_browse_extract(params: dict[str, Any]) -> dict[str, Any]:
    session_id = params["session_id"]
    query = params["query"]

    session = sessions.get(session_id)
    if not session:
        return {"error": f"Session {session_id} not found or expired."}

    try:
        llm = _build_llm()
        extraction_task = (
            f"Extract the following data from the current page and return it as structured JSON: {query}"
        )
        agent = Agent(
            task=extraction_task,
            llm=llm,
            browser=session.browser,
        )
        agent_result = await agent.run()
        extract_ok, extract_reason = agent_outcome(agent_result)
        if not extract_ok:
            session.actions.append(ActionRecord(
                timestamp=time.time(), action="extract", detail=query, success=False,
            ))
            logger.error("browse_extract DEGRADED (session %s): %s", session_id, extract_reason)
            return {
                "session_id": session_id,
                "status": "degraded",
                "degraded": True,
                "reason": extract_reason,
                "query": query,
            }

        session.actions.append(ActionRecord(
            timestamp=time.time(),
            action="extract",
            detail=query,
            success=True,
        ))

        return {
            "session_id": session_id,
            "status": "completed",
            "query": query,
            "data": str(agent_result),
        }

    except Exception as e:
        session.actions.append(ActionRecord(
            timestamp=time.time(),
            action="extract",
            detail=query,
            success=False,
        ))
        return {"session_id": session_id, "status": "error", "error": str(e)}


async def handle_browse_screenshot(params: dict[str, Any]) -> dict[str, Any]:
    session_id = params["session_id"]

    session = sessions.get(session_id)
    if not session:
        return {"error": f"Session {session_id} not found or expired."}

    screenshot = await _get_screenshot_base64(session)
    if screenshot:
        return {"session_id": session_id, "screenshot_base64": screenshot}
    return {"session_id": session_id, "error": "No page available for screenshot."}


async def handle_browse_run_tests(params: dict[str, Any]) -> dict[str, Any]:
    url = params["url"]
    tests = params["tests"]
    # Optional: scope per-test screenshots to a subdirectory of /evidence so
    # the portal can serve them via /api/build/<buildId>/evidence/<file>.png
    # without cross-build collisions. When absent, we fall back to the
    # legacy base64-only response (backward compatible).
    evidence_dir = params.get("evidence_dir")
    evidence_subdir = None
    if isinstance(evidence_dir, str) and evidence_dir.strip():
        # Defense in depth: only allow simple segment names, no traversal
        safe_name = os.path.basename(evidence_dir.strip())
        if safe_name and safe_name == evidence_dir.strip():
            evidence_subdir = os.path.join(EVIDENCE_DIR, safe_name)
            os.makedirs(evidence_subdir, exist_ok=True)

    results = []
    session = await sessions.open(url)

    try:
        llm = _build_llm()
        nav_agent = Agent(
            task=f"Navigate to {url} and wait for the page to load completely.",
            llm=llm,
            browser=session.browser,
        )
        nav_history = await nav_agent.run()
        nav_ok, nav_reason = agent_outcome(nav_history)
        if not nav_ok:
            # BI-1BAA177C: if the browser cannot even navigate, every per-test
            # verdict would be noise — and the old word-heuristic could score
            # an aborted agent as PASS. Report the whole run as degraded;
            # callers must treat it as NOT-RUN, never as pass/fail evidence.
            logger.error("browse_run_tests DEGRADED for %s: %s", url, nav_reason)
            await sessions.close(session.session_id)
            return {
                "url": url,
                "degraded": True,
                "reason": f"navigation agent could not drive the browser: {nav_reason}",
                "total": len(tests),
                "passed": 0,
                "failed": 0,
                "results": [],
            }

        for i, test_case in enumerate(tests):
            try:
                test_task = (
                    f"Verify the following assertion about the current page. "
                    f"If you need to navigate or interact to check it, do so. "
                    f"Report whether it passes or fails with a brief explanation.\n\n"
                    f"Assertion: {test_case}"
                )
                agent = Agent(
                    task=test_task,
                    llm=llm,
                    browser=session.browser,
                )
                agent_result = await agent.run()
                step_ok, step_reason = agent_outcome(agent_result)
                if not step_ok:
                    results.append({
                        "test": test_case,
                        "status": "degraded",
                        "detail": f"agent could not drive the browser: {step_reason}",
                    })
                    continue
                result_str = str(agent_result).lower()

                # Heuristic: check if the agent reported failure
                passed = not any(
                    word in result_str
                    for word in ["fail", "not found", "missing", "error", "false", "does not"]
                )

                step_result: dict[str, Any] = {
                    "test": test_case,
                    "status": "pass" if passed else "fail",
                    "detail": str(agent_result),
                }

                if evidence_subdir:
                    try:
                        page = await session.browser.get_current_page()
                        if page:
                            filename = f"{i}.png"
                            filepath = os.path.join(evidence_subdir, filename)
                            b64 = await page.screenshot()
                            with open(filepath, "wb") as f:
                                f.write(base64.b64decode(b64))
                            step_result["screenshot_path"] = filename
                    except Exception as e:
                        logger.warning("Step %d screenshot save failed: %s", i, e)
                else:
                    screenshot = await _get_screenshot_base64(session)
                    step_result["screenshot_base64"] = screenshot

                results.append(step_result)

            except Exception as e:
                results.append({
                    "test": test_case,
                    "status": "error",
                    "detail": str(e),
                })

    finally:
        await sessions.close(session.session_id)

    passed_count = sum(1 for r in results if r["status"] == "pass")
    degraded_count = sum(1 for r in results if r["status"] == "degraded")
    failed_count = sum(1 for r in results if r["status"] not in ("pass", "degraded"))

    response: dict[str, Any] = {
        "url": url,
        "total": len(tests),
        "passed": passed_count,
        "failed": failed_count,
        "results": results,
    }
    if degraded_count:
        response["degraded_steps"] = degraded_count
        # Whole run is only evidence when at least one assertion actually ran.
        if degraded_count == len(results):
            response["degraded"] = True
            response["reason"] = "every test agent failed to drive the browser"
    return response


async def handle_browse_close(params: dict[str, Any]) -> dict[str, Any]:
    session_id = params["session_id"]
    session = await sessions.close(session_id)

    if not session:
        return {"error": f"Session {session_id} not found."}

    action_log = [
        {
            "timestamp": a.timestamp,
            "action": a.action,
            "detail": a.detail,
            "success": a.success,
        }
        for a in session.actions
    ]

    return {
        "session_id": session_id,
        "status": "closed",
        "duration_seconds": round(time.time() - session.created_at, 1),
        "action_count": len(session.actions),
        "action_log": action_log,
    }


TOOL_HANDLERS = {
    "browse_open": handle_browse_open,
    "browse_act": handle_browse_act,
    "browse_extract": handle_browse_extract,
    "browse_screenshot": handle_browse_screenshot,
    "browse_run_tests": handle_browse_run_tests,
    "browse_close": handle_browse_close,
}


# ── FastAPI App (MCP HTTP Transport) ──────────────────────────────────────

app = FastAPI(title="browser-use MCP Server")


@app.on_event("startup")
async def startup():
    await sessions.start()
    logger.info("browser-use MCP server started on port %s", PORT)
    logger.info("LLM: %s @ %s", LLM_MODEL, LLM_BASE_URL)


@app.on_event("shutdown")
async def shutdown():
    await sessions.stop()


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "browser-use-mcp", "model": LLM_MODEL}


# BI-1BAA177C: /health only proves HTTP liveness — the live incident had a
# healthy healthcheck over a browser that could not produce state. This probe
# exercises the actual capability (launch Chromium, load a page, read state).
# Cached because a real browser launch is expensive; consumers (portal
# capability reporting, EP-UX-SYSTEM capability probes) poll infrequently.
_capability_cache: dict[str, Any] = {"checked_at": 0.0, "result": None}
_CAPABILITY_TTL_SECONDS = int(os.environ.get("CAPABILITY_PROBE_TTL_SECONDS", "300"))


@app.get("/health/capability")
async def health_capability():
    now = time.time()
    cached = _capability_cache["result"]
    if cached is not None and (now - _capability_cache["checked_at"]) < _CAPABILITY_TTL_SECONDS:
        return {**cached, "cached": True}

    result: dict[str, Any]
    probe = None
    try:
        probe = BrowserSession(
            headless=True,
            executable_path=CHROME_BIN,
            chromium_sandbox=False,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        await probe.start()
        page = await probe.get_current_page()
        if page is None:
            result = {"capable": False, "reason": "browser started but produced no page"}
        else:
            b64 = await page.screenshot()
            if b64:
                result = {"capable": True, "reason": ""}
            else:
                result = {"capable": False, "reason": "page produced no screenshot (browser state unavailable)"}
    except Exception as e:
        logger.exception("capability probe failed")
        result = {"capable": False, "reason": f"probe error: {e.__class__.__name__}"}
    finally:
        if probe is not None:
            try:
                await probe.stop()
            except Exception:
                # Cleanup must not mask the probe verdict — the capability
                # result is already decided; a stop failure is only logged.
                logger.warning("capability probe browser stop failed", exc_info=True)

    result["service"] = "browser-use-mcp"
    _capability_cache["checked_at"] = now
    _capability_cache["result"] = result
    status_code = 200 if result.get("capable") else 503
    return JSONResponse(content={**result, "cached": False}, status_code=status_code)


@app.post("/mcp")
async def mcp_endpoint(request: Request):
    """MCP JSON-RPC endpoint for tool discovery and execution."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            content={"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": None},
            status_code=400,
        )

    method = body.get("method")
    req_id = body.get("id")
    params = body.get("params", {})

    # ── tools/list ──
    if method == "tools/list":
        return JSONResponse(content={
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": TOOLS},
        })

    # ── tools/call ──
    if method == "tools/call":
        tool_name = params.get("name")
        tool_args = params.get("arguments", {})

        handler = TOOL_HANDLERS.get(tool_name)
        if not handler:
            return JSONResponse(content={
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            })

        try:
            result = await handler(tool_args)
            return JSONResponse(content={
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(result)}]},
            })
        except Exception as e:
            # CodeQL #18 (py/stack-trace-exposure): str(e) can leak stack
            # trace context to clients. logger.exception() captures the
            # full trace server-side for diagnostics; the client gets a
            # generic message instead.
            #
            # CodeQL #106 (py/log-injection): tool_name comes from the
            # JSON-RPC request body — an attacker could embed CR/LF to
            # forge fake log lines. repr() escapes control characters and
            # is a CodeQL-recognised log-injection sanitiser. The repr()
            # form also makes clear in logs that this is untrusted input.
            logger.exception("Tool %s failed", repr(tool_name))
            _ = e  # consumed by logger.exception
            return JSONResponse(content={
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": "Tool invocation failed (see server logs)"},
            })

    # ── initialize ──
    if method == "initialize":
        return JSONResponse(content={
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "browser-use-mcp", "version": "1.0.0"},
                "capabilities": {"tools": {}},
            },
        })

    return JSONResponse(content={
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    })


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
