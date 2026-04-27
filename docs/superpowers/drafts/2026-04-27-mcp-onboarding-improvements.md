# MCP Onboarding Improvements — drafts ready to file

Generated 2026-04-27 from the MCP-connect debugging session. The MCP token used to file these is read-only, which is why they are saved here as text instead of being filed via `mcp__dpf__propose_improvement` directly. Mint a write-capable token through Admin > Platform Development (the gate fix in this same PR makes the Write radio clickable when `contributionMode` is `selective` or `contribute_all`), then either paste each block into the propose_improvement tool or run them via the MCP CLI.

---

## 1. One-click "Connect Claude Code" — eliminate token paste from MCP onboarding

- **category**: ux_friction
- **severity**: high

### description
**Problem.** The current MCP onboarding flow requires the operator to (1) navigate to Admin > Platform Development, (2) click Generate token, (3) copy the bearer, (4) open or create `.vscode/mcp.json` (or `.mcp.json`) at the right path, (5) paste a JSON block including the bearer, (6) restart VS Code or the dpf MCP server. Six manual steps with three different file paths to know about. Violates the established zero-click provider setup principle.

**Proposed flow.**
1. Admin > Platform Development shows a "Connect Claude Code" card.
2. Operator clicks it. The portal:
   - Auto-mints a default-scoped read token (or write, gated on contribution mode) attributed to the current user.
   - Uses the browser's File System Access API to ask the operator to pick their workspace folder once.
   - Writes `.vscode/mcp.json` (correct format: `{ servers: { dpf: { type: "http", url, headers } } }`) atomically.
   - Shows "Done. Open VS Code → MCP panel → click Start on dpf." (one click left.)
3. On subsequent connects, remembers the workspace path so step 2 collapses to a single click.

**Architectural notes.**
- The bearer must never be displayed in the UI in this flow — write-then-forget. The current "shown once, copy now" dialog stays as a fallback for users who can't grant File System Access (e.g. WebKit on iOS).
- Because `.vscode/mcp.json` contains a live bearer, the portal action must include guidance to add the file to `.gitignore` (or write a `.gitignore` line itself when permission allows).
- Same flow should also offer a `.mcp.json` write for users running Claude Code from the CLI, with both files written atomically when the workspace supports both.

**Acceptance criteria.**
- A new fresh-install operator can go from "I just finished docker compose up" to "Claude Code can call list_epics" in under 60 seconds with at most one paste-or-click per file write.
- The flow works on Chromium (File System Access API supported) and provides a graceful fallback (download a .vscode/mcp.json file the user moves into place) on Firefox/Safari.
- The portal never logs or persists the plaintext bearer beyond the in-memory write.

### observedFriction
Spent ~3 hours over the course of one session debugging MCP connectivity. Three independent platform bugs blocked the flow. After fixing all three, the actual onboarding *still* required a 6-step paste-and-restart dance, plus a separate decision about which of three config file paths to use (.mcp.json vs .vscode/mcp.json vs ~/.claude.json) — none of which is documented in the token-issuance dialog. The maintainer's reaction: "it needs to be easy, not lots of copy and paste."

---

## 2. Auto-configure contributionModel after GitHub OAuth — remove invisible prereq for write tokens

- **category**: ux_friction
- **severity**: medium

### description
**Problem.** The "Write" capability radio in the MCP token issuance dialog is gated behind `PlatformDevConfig.contributionModel != null`. That field is only writable through `ForkSetupPanel`, which only renders when the env var `CONTRIBUTION_MODEL_ENABLED=true`. On default installs the panel never appears, the field stays null forever, and the Write radio is permanently disabled with a generic "configure contribution mode first" hint that points the user nowhere.

This PR ships a relaxed gate (flag-off installs accept `contributionMode in ('selective','contribute_all')`), which unblocks the immediate UX problem. But that is a stopgap. The architecturally correct fix is for the system to determine and persist `contributionModel` automatically.

**Proposed flow.** After the user completes the GitHub OAuth handshake on the platform-development page:
1. Probe the connected GitHub identity for push access to the configured upstream repo (one API call).
2. If push access is granted → set `contributionModel = "maintainer-direct"` and save.
3. Otherwise → fork the upstream into the user's account via the GitHub API, wait for fork creation, write `contributorForkOwner`/`contributorForkRepo`/`forkVerifiedAt`, set `contributionModel = "fork-pr"`.
4. Show a single status banner that reflects the resolved model, with a "Switch to fork-PR" override link for maintainers who want to PR through their own fork even though they have direct push.

**Architectural notes.**
- This eliminates a class of "configuration" the user shouldn't have to make. The system has all the information needed.
- It also removes the dual-name confusion (contributionMode vs contributionModel) by making one of them automatic.
- Once shipped, the relaxed gate in this PR can be reverted — the gate becomes invisible because the field is always set.

**Acceptance criteria.**
- A user who has just completed GitHub OAuth has a non-null `contributionModel` within 5 seconds, with no further click.
- The Write radio in the MCP token dialog becomes enabled immediately, with no instruction to "configure contribution mode first."
- An override link is available for the rare case (maintainer who wants fork-PR despite having direct push).

### observedFriction
After fixing the gate-logic bug so the Write radio could be enabled at all, the architecturally correct outcome (the user shouldn't even be asked) became obvious. The maintainer's question — "should this be automated?" — was rhetorical: the user memory `feedback_zero_click_provider_setup` already records the principle. The current state forces the user to choose between two deployment models they don't understand.

---

## 3. Fix MCP token issuance dialog: VS Code snippet uses wrong format and points to wrong file path

- **category**: missing_feature
- **severity**: medium

### description
**Problem.** The MCP token issuance dialog at `apps/web/lib/actions/mcp-tokens.ts` (`buildSetupSnippets`) generates three setup snippets: Claude Code, Codex, and VS Code. The VS Code snippet uses the right shape (`{ servers: { dpf: { url, headers } } }`) but does NOT specify `type: "http"`. VS Code's MCP system needs `type: "http"` declared explicitly for HTTP transports — without it the entry is treated as ambiguous and may not start. It also does not tell the user where to save the file.

Additionally, none of the three snippets are accompanied by guidance on where the file goes:
- Claude Code CLI snippet → `.mcp.json` at workspace root
- VS Code snippet → `.vscode/mcp.json` at workspace root
- Codex snippet → `~/.codex/mcp.json` (or wherever Codex looks)

Users who don't already know the right path can't act on the snippet without a separate documentation lookup.

**Proposed fix.**
1. Update `buildSetupSnippets` in `apps/web/lib/actions/mcp-tokens.ts`:
   - VS Code snippet: add `"type": "http"` to the server entry.
2. Update `apps/web/components/admin/McpTokenManager.tsx`:
   - Above each tab's `<pre>`, add a "Save as: `.vscode/mcp.json` at the root of your workspace" hint with the path appropriate to the active tab.
   - For VS Code: add a sentence "Open VS Code's command palette and run 'MCP: List Servers' to start the dpf server after saving."
3. Once issue #1 (one-click flow) ships, this dialog becomes a fallback path for users who can't grant File System Access — at which point the snippet hints become essential.

**Acceptance criteria.**
- A user pasting the VS Code snippet into a fresh `.vscode/mcp.json` and starting the server in VS Code's MCP panel sees `dpf` connect successfully on first try.
- Each tab in the issuance dialog shows the correct file path and the next step.

### observedFriction
The original session-recovered token failed with a corrupted base32 encoding (separate bug, fixed in this PR), but even with a clean token the VS Code snippet did not work without manually adding `type: "http"`. The user did not initially know `.vscode/mcp.json` was the right path; the dialog only mentioned Claude Code's `.mcp.json`, and three different paths were tried before discovering the VS Code-native one is what the extension reads.
