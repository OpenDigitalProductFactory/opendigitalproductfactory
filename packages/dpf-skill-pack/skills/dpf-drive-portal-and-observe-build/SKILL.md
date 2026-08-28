---
name: dpf-drive-portal-and-observe-build
description: "Use when driving the live DPF portal through the browser — messaging a coworker, clicking through build gates, filling an admin form — or when establishing what the build engine actually did."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(docker logs *) Bash(docker exec *) Bash(curl *) Bash(nvidia-smi *) mcp__claude-in-chrome__navigate mcp__claude-in-chrome__read_page mcp__claude-in-chrome__find mcp__claude-in-chrome__get_page_text mcp__claude-in-chrome__computer mcp__claude-in-chrome__form_input mcp__dpf__resolve_model_selection mcp__dpf__get_build_sandbox_state mcp__dpf__list_build_activity_since

# DPF coworker fields (Surface B — in-portal seed loader)
category: verification
assignTo: ["build-specialist", "platform-engineer"]
capability: null
taskType: verification
triggerPattern: "drive the portal|drive the (live|running) (portal|install)|via the browser|claude-in-chrome|chrome mcp|send (a |the )?coworker( a)? message|click through|fill (in |out )?(the )?form|why is .* (stuck|stalled|hung)|which model (ran|is running)|why did .* tool call fail|observe the build|build (phase|engine|dispatch)|inference (truth|logs)|portal logs|runtime health|model selection"
userInvocable: true
agentInvocable: false
allowedTools: ["Bash", "mcp__claude-in-chrome__navigate", "mcp__claude-in-chrome__read_page", "mcp__claude-in-chrome__find", "mcp__claude-in-chrome__get_page_text", "mcp__claude-in-chrome__computer", "mcp__claude-in-chrome__form_input", "mcp__dpf__resolve_model_selection", "mcp__dpf__get_build_sandbox_state", "mcp__dpf__list_build_activity_since"]
composesFrom: ["dpf-evidence-before-diagnosis", "dpf-verify-on-live-install"]
contextRequirements: []
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/never-ask-user-to-run-commands
  - kernel/principles/structural-verification-is-not-functional
  - kernel/principles/evidence-before-diagnosis
  - kernel/principles/check-tool-signals-first
---

# DPF Drive Portal & Observe Build

**Two skills in one, because they're always used together: (A) reliably *drive* the live DPF portal through Claude-in-Chrome, and (B) *observe* what the build/inference engine is actually doing.** Both are full of non-obvious mechanics that cost a live session hours of DOM trial-and-error and false "it's broken" diagnoses. This skill encodes them so the next session drives and observes on the first try.

The driving rules satisfy `never-ask-user-to-run-commands` (the agent operates the UI; it never hands the click to the operator). The observation rules satisfy `evidence-before-diagnosis` and `check-tool-signals-first` (read the logs/DB/tool result before naming a cause) and `structural-verification-is-not-functional` (the UI rendering is not proof the mutation landed — verify the data).

## When to use

- Sending a coworker a message, clicking through a build's gates, or filling an admin form on the live portal via the browser.
- Diagnosing a build that looks stuck, a coworker that "didn't respond", a tool call that failed, or a phase that won't advance.
- Answering "which model/provider/engine ran this phase?" or "why did the local model time out?".
- Before driving a build at all — resolve the model selection so you know what *should* run (`resolve_model_selection`).

## When NOT to use

- Pure source-local work (typecheck, vitest) with no live portal interaction.
- Functional-verification *gating* — that's `dpf-verify-on-live-install` (run the preflight first; this skill is the driving/observation mechanics you use *after* CAN-TEST).
- A web app that has its own dedicated MCP — use that, not raw DOM driving.

---

## Part A — Driving the portal via Claude-in-Chrome

### A1. Real keystrokes for React inputs — `form_input` silently no-ops

DPF inputs are React-controlled. `form_input` sets the DOM `value` attribute but **does not fire React's `onChange`**, so React's internal state stays empty. A subsequent **Send / Submit reads the empty React state and no-ops** — the message never sends, the form never submits, and there is *no error*. This is the single most expensive trap: a coworker message silently failed this exact way until corrected.

**Do this instead:** focus the field, then type real keystrokes.

```
mcp__claude-in-chrome__find         { text: "Message", ... }     # get the input's ref
mcp__claude-in-chrome__computer     { action: "left_click", ref }  # focus it
mcp__claude-in-chrome__computer     { action: "type", text: "..." } # real keystrokes → fires onChange
# now the Send button reads populated React state
```

`form_input` is acceptable only for plain uncontrolled inputs — when in doubt on a DPF page, assume React and type.

### A2. Navigate → discover refs → act. Never guess coordinates.

```
mcp__claude-in-chrome__navigate     { url: "http://localhost:3000/..." }
mcp__claude-in-chrome__read_page    { filter: "interactive" }   # or find { text/role }
# act on the returned element refs (click/type by ref), not by pixel coordinates
```

`read_page filter=interactive` enumerates the actionable elements with stable refs. `find` locates one element by text/role. Coordinate-guessing breaks on the next re-render.

### A3. Screenshots TIME OUT on live pages — read text instead

`screenshot` waits for `document_idle`, which a live-updating page (a running build, a streaming coworker reply, anything polling) **never reaches**, so the call times out. Use `get_page_text` or `read_page` for state. Reserve screenshots for static pages.

### A4. Native `confirm()` / `alert()` cannot be dismissed by automation

A native browser `confirm()` / `alert()` dialog **blocks CDP** — the automation channel times out and cannot click OK/Cancel. Do **not** retry into the timeout. Either a human dismisses it, or the flow needs the in-app-modal fix (an in-DOM modal the browser tools *can* drive). **Flag this and stop**; file a BI for the native-dialog surface rather than burning retries.

### A5. First click while hydrating → no-op. Verify, then re-drive.

A click that lands before React finishes hydrating is swallowed. The page looks right but nothing happened. Pattern: after navigating, give the page a beat, drive the action, then **verify the result** (A6) — if the mutation didn't land, re-drive once.

### A6. ALWAYS verify a mutation via DB/logs, not the UI alone

The UI can lag, optimistic-render, or no-op during hydration. "The toast appeared" / "the field shows my text" is **not** proof the write happened (`structural-verification-is-not-functional`). Confirm the mutation in the source of truth:

```
docker logs dpf-portal-1 --since 2m | <grep for the route/tool/write>
docker exec dpf-postgres-1 psql -U postgres -d dpf -c "select ... from \"<Table>\" where ..."
```

Only after the DB/log confirms the row/state changed do you report the action as done.

### A7. NEVER submit a form by DOM index — forms[0] on every shell page is Sign out

The shell header renders an invisible `<form action={signOutAction}>` (the Sign out button) on **every** authenticated shell page, so `document.querySelector('form')` / `document.forms[0]` is the **sign-out server action**, not the page's editor form. Submitting it deliberately expires the session cookie and redirects to `/login` — with **zero errors in the portal logs**, because it is a clean sign-out. Editor forms (e.g. the wiki page editor) often have **no `action` attribute at all** (React `onSubmit`), making them look *less* like "the form" to naive selectors. This produced a false P1 outage report ("every server-action POST invalidates the session", BI-FFF8F0DA): deterministic, reproduced across fresh logins, and entirely an artifact of the repro method.

**Do this instead:** locate the form via its visible submit button, never by index:

```js
const save = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save');
save.closest('form').requestSubmit(save);   // or simply click the button
```

If a session unexpectedly lands on `/login` with the cookie gone and no auth errors logged, suspect an accidental sign-out submit before suspecting the auth stack.

---

## Part B — Observing build & inference architecture (where the truth lives)

### B1. Build lifecycle phases

`ideate → plan → design-review → plan-review → build → review → ship`.

- **Phase + step:** `FeatureBuild.phase` and `buildExecState->>'step'` (JSON) tell you where a build is.
- **Event stream:** `BuildActivity` rows carry the phase-transition and tool events over time. The `list_build_activity_since` MCP tool reads this without raw SQL.
- **Sandbox view:** `get_build_sandbox_state` returns the build's runtime/sandbox status for an agent.

```
docker exec dpf-postgres-1 psql -U postgres -d dpf -c \
  "select id, phase, \"buildExecState\"->>'step' as step, status from \"FeatureBuild\" order by \"updatedAt\" desc limit 5"
```

### B2. Coworker tool-use + inference truth is in the PORTAL LOGS

`docker logs dpf-portal-1` is the ground truth for what the model and tools actually did. Key markers:

| Log marker | Tells you |
|---|---|
| `[agentic-tool] CALL tool=… ` / `RESULT tool=…` | The model *did* request a tool and what it got back |
| `[agentic-loop] provider=local model=…` | Which provider/model the agentic loop is running |
| `[callWithFallbackChain] local failed: …` | Local inference failed (timeout / 502) → fell back; the cause is here |
| `[kernel-gate-trace]` | Kernel-gate decision trace (why a gate passed/blocked) |

**Standing thesis (verify before blaming the model):** the model usually tool-calls correctly. Failures are usually **tool / timeout / config**, not the model "being dumb." Read the `[agentic-tool]` and `[callWithFallbackChain]` lines first — `check-tool-signals-first`.

```
docker logs dpf-portal-1 --since 10m 2>&1 | Select-String "agentic-tool|agentic-loop|callWithFallbackChain|kernel-gate-trace"
```

### B3. Model selection — resolve it BEFORE driving a build

- **Surface for humans:** `/platform/ai/runtime-health` ("Model Selection & Runtime Health") resolves which model / provider / engine runs each phase and flags config mismatches.
- **Tool for agents:** `resolve_model_selection` gives an agent the same resolution before a build — call it first so you know what *should* run.

**Two config surfaces — don't confuse them:**

| Surface | Route | Governs |
|---|---|---|
| **Providers & Routing** | `/platform/ai/providers` | `routeAndCall` for ideate / plan / review phases, **and the local-only inference switch** (`residencyPolicy: local_only`, no silent cloud fallback) |
| **Build Runtime** | `/platform/ai/build-studio` | the **build-phase dispatch engine** + the local model + served context |

A "local" *engine* selection makes only the BUILD phase local; ideate/plan/review still route via Providers & Routing. Mismatch between the two is the classic "I set local but it called cloud" confusion — `runtime-health` flags it.

### B4. Local model — DMR at `localhost:12434`

Docker Model Runner serves OpenAI-compatible inference at `localhost:12434/engines/v1` (models: `qwen3-coder`, `gemma4`, `nomic-embed`).

- **Served context truth:** query `/engines/_configure` — **NOT** the `/models` metadata, which is static and misleading about the live context window.
- **GPU truth:** `nvidia-smi dmon`. **Docker/WSL2 GPU usage does NOT appear in Windows Task Manager** — Task Manager showing 0% GPU does not mean the model isn't on the GPU.

```
curl -s http://localhost:12434/engines/v1/models                 # static catalog (do not trust for context)
curl -s http://localhost:12434/engines/_configure                # served context (truth)
nvidia-smi dmon -c 5                                              # live GPU utilization
```

### B5. Gotchas

- **Self-upgrade swap disconnects the agent's MCP client AND can strand in-flight builds.** After a `/ops/self-upgrade`, the `dpf` MCP connector may drop — reconnect, and re-check any build that was mid-flight (it may have been stranded by the container swap). See `project_self_upgrade_deploy_stamps_merge_commit`.
- **WIP cap is 3.** No more than 3 builds in flight; a 4th won't start. If a build "won't start," check the in-flight count before assuming a defect.

---

## Steps (drive + observe a build, end to end)

1. **Resolve what should run.** `resolve_model_selection` (and/or read `/platform/ai/runtime-health`) so you know the expected model/provider/engine per phase *before* you touch the UI.
2. **Gate the runtime.** If this is functional verification, run `dpf-verify-on-live-install` first (preflight → CAN-TEST). Don't drive a build on an unprovable runtime.
3. **Drive via Chrome:** `navigate` → `read_page filter=interactive` / `find` → act on refs. **Type real keystrokes** for any input (A1). Don't screenshot live pages (A3).
4. **Observe progress** via `list_build_activity_since` + `FeatureBuild.phase`/`buildExecState`, not by staring at the UI.
5. **When something looks wrong,** read `docker logs dpf-portal-1` for `[agentic-tool]` / `[callWithFallbackChain]` / `[kernel-gate-trace]` *before* diagnosing (`evidence-before-diagnosis`). Suspect tool/timeout/config before the model (B2).
6. **Verify every mutation** in DB/logs, not the UI (A6). Report findings as dynamic-analysis prose (drove X, observed Y in log/DB), not a pile of screenshots.

## Guardrails

- **Never use `form_input` on a React input and then click Send.** It will silently no-op. Focus + type real keystrokes (A1).
- **Never retry into a native `confirm()`/`alert()`.** CDP can't dismiss it; flag it and stop (A4).
- **Never claim a portal action succeeded from the UI alone.** Confirm in the DB/log (A6, `structural-verification-is-not-functional`).
- **Never blame the model before reading the tool/inference logs.** The failure is usually tool/timeout/config (B2, `check-tool-signals-first`).
- **Never hand the click to the operator** to work around a driving difficulty — that violates `never-ask-user-to-run-commands`. Solve the driving problem or file a BI for the missing in-app surface.
- **Never submit a form by DOM index.** `forms[0]` on every shell page is the header's Sign out server action — submitting it kills the session with no logged error (A7). Select the form via its visible submit button.

## Worked example

A live session tried to send a DPF coworker a message: `form_input` set the textarea's value, the text was visibly in the box, then **Send did nothing** — no error, no message, no log line. Diagnosis via this skill: `form_input` never fired React's `onChange`, so the Send handler read empty state. Fix: `find` the textarea → `computer left_click` to focus → `computer type` the message as real keystrokes → Send. Confirmed it landed not by the UI but by `docker logs dpf-portal-1` showing the coworker route accept the message and the `[agentic-loop] provider=local model=qwen3-coder` line that followed. The same session learned screenshots of the running build page timed out (A3) and read `BuildActivity` + `buildExecState->>'step'` for progress instead.

## See also

- Memory: `feedback_dpf_portal_browser_driving` (the originating live-session learnings).
- Project memory: `project_model_selection_runtime_health` (the `resolve_model_selection` tool + `/platform/ai/runtime-health` surface), `project_local_build_config_ux` (DMR served-context API + local-only switch), `project_self_upgrade_deploy_stamps_merge_commit` (self-upgrade swap behavior).
- Composes after: `dpf-evidence-before-diagnosis` (read evidence before naming a cause), `dpf-verify-on-live-install` (preflight-gate the runtime before driving).
- Kernel: [`never-ask-user-to-run-commands`](../../../../docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md), [`structural-verification-is-not-functional`](../../../../docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md), [`evidence-before-diagnosis`](../../../../docs/founder-kernel/wiki/principles/evidence-before-diagnosis.md), [`check-tool-signals-first`](../../../../docs/founder-kernel/wiki/principles/check-tool-signals-first.md).
