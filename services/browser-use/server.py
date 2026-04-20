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

# browser-use imports
from browser_use import Agent, Browser, BrowserConfig
from langchain_openai import ChatOpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browser-use-mcp")

# ── Configuration ──────────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "8500"))
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://model-runner.docker.internal/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "not-needed-for-local")
EVIDENCE_DIR = os.environ.get("EVIDENCE_DIR", "/evidence")
SESSION_TIMEOUT_SECONDS = int(os.environ.get("SESSION_TIMEOUT_SECONDS", "600"))

os.makedirs(EVIDENCE_DIR, exist_ok=True)


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
class BrowserSession:
    """Persistent browser session with evidence capture."""
    session_id: str
    browser: Browser
    agent: Agent | None = None
    created_at: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)
    actions: list[ActionRecord] = field(default_factory=list)
    url: str = ""

    def touch(self):
        self.last_used = time.time()

    def is_expired(self) -> bool:
        return (time.time() - self.last_used) > SESSION_TIMEOUT_SECONDS


class SessionManager:
    """Manages persistent browser sessions with auto-cleanup."""

    def __init__(self):
        self._sessions: dict[str, BrowserSession] = {}
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

    async def open(self, url: str | None = None) -> BrowserSession:
        session_id = str(uuid.uuid4())[:8]
        browser = Browser(config=BrowserConfig(headless=True))
        session = BrowserSession(session_id=session_id, browser=browser)

        if url:
            session.url = url

        self._sessions[session_id] = session
        logger.info("Opened session %s (url=%s)", session_id, url or "none")
        return session

    def get(self, session_id: str) -> BrowserSession | None:
        session = self._sessions.get(session_id)
        if session and not session.is_expired():
            session.touch()
            return session
        return None

    async def close(self, session_id: str) -> BrowserSession | None:
        session = self._sessions.pop(session_id, None)
        if session:
            await self._close_session(session)
        return session

    async def _close_session(self, session: BrowserSession):
        try:
            await session.browser.close()
        except Exception as e:
            logger.warning("Error closing browser for session %s: %s", session.session_id, e)
        self._sessions.pop(session.session_id, None)


def _build_llm() -> ChatOpenAI:
    """Build the LLM client for browser-use agents."""
    return ChatOpenAI(
        model=LLM_MODEL,
        base_url=LLM_BASE_URL,
        api_key=OPENAI_API_KEY,
    )


async def _save_screenshot(session: BrowserSession, label: str) -> str | None:
    """Capture and save a screenshot, returning the file path."""
    try:
        context = await session.browser.get_context()
        pages = context.pages
        if not pages:
            return None
        page = pages[-1]
        filename = f"{session.session_id}_{label}_{int(time.time())}.png"
        filepath = os.path.join(EVIDENCE_DIR, filename)
        await page.screenshot(path=filepath)
        return filepath
    except Exception as e:
        logger.warning("Screenshot failed: %s", e)
        return None


async def _get_screenshot_base64(session: BrowserSession) -> str | None:
    """Capture a screenshot and return as base64."""
    try:
        context = await session.browser.get_context()
        pages = context.pages
        if not pages:
            return None
        page = pages[-1]
        screenshot_bytes = await page.screenshot()
        return base64.b64encode(screenshot_bytes).decode("utf-8")
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
    session = await sessions.open(url)

    result: dict[str, Any] = {"session_id": session.session_id}

    if url:
        try:
            llm = _build_llm()
            agent = Agent(
                task=f"Navigate to {url} and wait for the page to load.",
                llm=llm,
                browser=session.browser,
            )
            agent_result = await agent.run()
            session.actions.append(ActionRecord(
                timestamp=time.time(),
                action="navigate",
                detail=f"Opened {url}",
                success=True,
            ))
            result["status"] = "navigated"
            result["url"] = url
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
        # Navigate to the URL first
        llm = _build_llm()
        nav_agent = Agent(
            task=f"Navigate to {url} and wait for the page to load completely.",
            llm=llm,
            browser=session.browser,
        )
        await nav_agent.run()

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

                # Screenshot persistence: when evidence_subdir is set, write
                # a PNG and return the filename so the portal route can serve
                # it. Otherwise, keep the legacy base64 payload for callers
                # that haven't migrated yet.
                if evidence_subdir:
                    try:
                        context = await session.browser.get_context()
                        pages = context.pages
                        if pages:
                            filename = f"{i}.png"
                            filepath = os.path.join(evidence_subdir, filename)
                            await pages[-1].screenshot(path=filepath)
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
    failed_count = sum(1 for r in results if r["status"] != "pass")

    return {
        "url": url,
        "total": len(tests),
        "passed": passed_count,
        "failed": failed_count,
        "results": results,
    }


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
            logger.exception("Tool %s failed", tool_name)
            return JSONResponse(content={
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": str(e)},
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
