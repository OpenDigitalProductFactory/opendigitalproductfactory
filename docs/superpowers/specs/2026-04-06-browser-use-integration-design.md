# Browser-Use Integration — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | Platform Infrastructure |
| **Status** | Draft |
| **Created** | 2026-04-06 |
| **Author** | Claude Code for Mark Bodman |
| **Scope** | `docker-compose.yml`, `services/browser-use/`, MCP server registration |
| **Replaces** | Existing `playwright` container (profile: `build-images`) |
| **Primary Goal** | Replace Playwright with AI-powered browser automation as DPF's primary browser interaction layer — for testing, QA, and external website interaction |

---

## 1. Problem Statement

DPF's current browser automation is a bare Playwright container (inactive, `build-images` profile) that runs scripted tests with explicit CSS selectors. In practice this approach has significant issues:

- **Changes and feedback become lost and disconnected** — Playwright scripts fire at DOM snapshots with no understanding of what happened, why something changed, or what the user actually intended. When the UI evolves, scripts silently break or test the wrong thing.
- **Brittle selectors** — CSS/XPath selectors break on any layout or class name change, creating constant maintenance burden.
- **No adaptive recovery** — A failed selector throws `TimeoutError` with no ability to retry differently, scroll, or try an alternative path.
- **No context continuity** — Each script invocation starts from zero. There's no memory of prior interactions or accumulated understanding of the application.
- **External sites impossible** — You can't pre-script selectors for sites you don't control.

**browser-use** (https://github.com/browser-use/browser-use, MIT license) solves these problems by adding an LLM intelligence layer on top of Playwright's browser engine. The LLM maintains a mental model of the page, finds elements by intent rather than selector, recovers from failures adaptively, and maintains context across interactions.

Since browser-use uses Playwright internally, it is a strict superset — every capability Playwright has, browser-use has, plus the AI layer.

### Use cases

1. **Build Studio QA** — After a sandbox build completes, an agent browses the preview URL and verifies the UI works: navigation, form submission, visual correctness. Adapts automatically when the build changes the layout.
2. **External website interaction** — Agents fetch data from external sites, fill forms, interact with third-party services. No pre-scripted selectors needed.
3. **Self-healing regression tests** — Natural-language test cases that adapt to UI changes. "Verify the dashboard shows the product count" works regardless of whether the count is in an `<h2>`, a `<span>`, or a table cell.
4. **Evidence-driven QA** — Every browser action produces structured evidence (screenshots, action logs, DOM state) that feeds back into Build Studio as reviewable artifacts.
5. **Competitive research / data extraction** — Agents browse competitor sites, extract structured data, compare features.

---

## 2. Architecture

### 2.1 Service topology

```
┌──────────────────────────────────────────────┐
│              portal (Next.js)                 │
│        MCP tool call: browser-use__*          │
│                                               │
│  Build Studio agents, QA flows, data tasks    │
└───────────────────┬──────────────────────────┘
                    │ HTTP JSON-RPC (MCP protocol)
                    ▼
┌──────────────────────────────────────────────┐
│          browser-use-mcp (Python)            │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │  Session Manager                        │ │
│  │  - Persistent sessions across calls     │ │
│  │  - Session pool (configurable)          │ │
│  │  - Auto-cleanup on timeout              │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Evidence Capture                       │ │
│  │  - Screenshot before/after each action  │ │
│  │  - Structured action log (JSON)         │ │
│  │  - Page state snapshots                 │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Test Plan Runner                       │ │
│  │  - Accept NL test cases as a list       │ │
│  │  - Run sequentially, report pass/fail   │ │
│  │  - Produce evidence per test case       │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  browser-use + Playwright + Chromium    │ │
│  │  (headless, sandboxed)                  │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 2.2 Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Replaces Playwright** | Yes — remove `playwright` service from compose | browser-use is a superset; maintaining both creates confusion and divergent test paths |
| Transport | HTTP (JSON-RPC) | Matches existing MCP server pattern; discoverable by `mcp-server-tools.ts` |
| Container base | `python:3.11-slim` + Playwright system deps | browser-use requires Python >= 3.11; Playwright provides the browser engine |
| LLM backend | OpenAI-compatible via `LLM_BASE_URL` | Reuses DPF's existing Docker Model Runner or configured provider |
| Session model | Persistent sessions with pooling | Solves the "lost and disconnected" problem — context carries across tool calls |
| Evidence capture | Built-in, always on | Every action produces reviewable artifacts; feeds Build Studio QA |
| Profile | `browser-use` (opt-in) | Not started by default — activated when needed |
| Port | 8500 (internal) | Avoids conflicts with existing services |

### 2.3 MCP tools exposed

| Tool name | Description |
|-----------|-------------|
| `browse_open` | Open a new browser session, optionally navigate to a URL. Returns session ID. |
| `browse_act` | Execute a natural-language browser action within a session. The LLM drives the browser adaptively. |
| `browse_extract` | Extract structured data from the current page using a natural-language description of what to extract. Returns JSON. |
| `browse_screenshot` | Capture a screenshot of the current page. Returns base64 image. |
| `browse_run_tests` | Accept a list of natural-language test cases, execute them sequentially against a URL, return structured pass/fail results with evidence. |
| `browse_close` | Close a browser session and return the full action log + evidence. |

These will be namespaced as `browser-use__browse_open`, `browser-use__browse_act`, etc. by the MCP tool discovery system.

### 2.4 Session lifecycle

```
browse_open(url="http://sandbox:3000")
  → session_id: "abc123"
  → screenshot of initial page

browse_act(session="abc123", task="navigate to the products page")
  → action log: [{action: "click", target: "Products nav link", success: true}]
  → screenshot after

browse_act(session="abc123", task="verify there are at least 3 products listed")
  → result: {verified: true, detail: "Found 5 product cards"}
  → screenshot after

browse_extract(session="abc123", query="list all product names and prices")
  → [{name: "Widget A", price: "$29.99"}, ...]

browse_close(session="abc123")
  → full evidence bundle (all screenshots, action log, timing)
```

Context is maintained throughout — the agent remembers what it clicked, what pages it visited, and what it observed.

### 2.5 Test plan execution

The `browse_run_tests` tool accepts a structured test plan:

```json
{
  "url": "http://sandbox:3000",
  "tests": [
    "The homepage loads and shows the company logo",
    "Clicking 'Products' navigates to a page with at least one product card",
    "Each product card shows a name, price, and 'Add to Cart' button",
    "Clicking 'Add to Cart' shows a confirmation message",
    "The cart icon in the header updates to show item count"
  ]
}
```

Returns:

```json
{
  "passed": 4,
  "failed": 1,
  "results": [
    {"test": "The homepage loads...", "status": "pass", "screenshot": "base64..."},
    {"test": "Clicking 'Products'...", "status": "pass", "screenshot": "base64..."},
    ...
    {"test": "The cart icon...", "status": "fail", "reason": "Cart icon not found in header", "screenshot": "base64..."}
  ]
}
```

---

## 3. Implementation Plan

### 3.1 New files

| File | Purpose |
|------|---------|
| `services/browser-use/Dockerfile` | Python 3.11 + browser-use + Playwright + Chromium + MCP server |
| `services/browser-use/requirements.txt` | Python dependencies: `browser-use`, `fastapi`, `uvicorn`, `pydantic` |
| `services/browser-use/server.py` | MCP HTTP server: session manager, evidence capture, tool handlers |

### 3.2 Modified files

| File | Change |
|------|--------|
| `docker-compose.yml` | Add `browser-use` service (profile: `browser-use`); remove `playwright` service and its volumes |
| `packages/db/prisma/seed/` | Register browser-use MCP server on fresh installs |

### 3.3 Docker Compose changes

**Remove:**

```yaml
# The playwright service and playwright_scripts / playwright_results volumes
```

**Add:**

```yaml
browser-use:
  build:
    context: ./services/browser-use
    dockerfile: Dockerfile
  restart: unless-stopped
  profiles: ["browser-use"]
  ports:
    - "8500:8500"
  volumes:
    - browser_evidence:/evidence
  environment:
    LLM_BASE_URL: ${LLM_BASE_URL:-http://model-runner.docker.internal/v1}
    LLM_MODEL: ${BROWSER_USE_MODEL:-gpt-4o}
    OPENAI_API_KEY: ${OPENAI_API_KEY:-not-needed-for-local}
    ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
    PORT: 8500
  extra_hosts:
    - "host.docker.internal:host-gateway"
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8500/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

### 3.4 MCP server registration

On seed, register an `McpServer` row:
- **name**: `Browser Use`
- **slug**: `browser-use`
- **transport**: `http`
- **url**: `http://browser-use:8500/mcp`
- **description**: `AI-powered browser automation — testing, QA, and web interaction with self-healing navigation and evidence capture`

Tool discovery will automatically populate `McpServerTool` rows on first health check.

---

## 4. Activation

```bash
# Start the browser-use service
docker compose --profile browser-use up -d browser-use

# Or include in full stack
docker compose --profile browser-use up -d
```

Profile-gated so it doesn't affect default startup.

---

## 5. Migration from Playwright

| What | Action |
|------|--------|

| `playwright` service in compose | Remove |
| `playwright_scripts` volume | Remove |
| `playwright_results` volume | Remove |
| `@axe-core/playwright` in web deps | Keep — accessibility checks can be called from browser-use via Playwright API |
| Any existing Playwright test scripts | Convert to natural-language test plans for `browse_run_tests` |

The migration is clean because the Playwright container was inactive (profile: `build-images`, command: `sleep infinity`). No production workflows depend on it.

---

## 6. Security Considerations

- Browser sessions run inside the container with no host filesystem access.
- Evidence files are written to a dedicated volume (`browser_evidence`), not the host filesystem.
- The service is on the internal Docker network; port 8500 exposure is for debugging only.
- External website access is unrestricted by default — network policies can be layered on later.
- API keys passed via environment variables, never stored in the container image.

---

## 7. Future Enhancements

1. **Deterministic replay mode** — Record an AI-driven session, export as a replayable action sequence (no LLM needed). This gives CI-grade speed when you want it, with AI-grade adaptability when you need it.
2. **Visual regression** — Compare screenshots across builds to detect unintended visual changes.
3. **Cloud scaling** — Swap self-hosted for `api.browser-use.com` cloud API for parallel browser sessions at scale.
4. **Build Studio integration** — Auto-trigger `browse_run_tests` after each sandbox build phase, surface results in the Build Studio UI as a QA evidence panel.
