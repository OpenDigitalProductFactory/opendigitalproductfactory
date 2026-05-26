# Edge Node Windows Install Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows installer and generated lifecycle scripts consistently install, start, and explain the bundled Edge Node for single-host DPF instances.

**Architecture:** Keep this slice on the existing container Edge Node path. The Windows installer should start core services first, mint an installer-owned auto-approve bootstrap token through the portal container, write the token and host name into `.env`, then start `edge-node` with `docker-compose.edge.yml`. Native Windows Service Mode 4 stays a separate implementation track because it requires signed Go artifacts, service registration, credential storage, and real Windows LAN verification.

**Tech Stack:** PowerShell 5.1 installer helpers, Docker Compose overlays, Pester 5 installer tests, React/Next.js Edge Nodes admin UI.

---

### Task 1: Installer Helper Tests

**Files:**
- Create: `scripts/installer/windows-edge-node-install.Tests.ps1`
- Modify: `install-dpf.ps1`

- [x] **Step 1: Write failing tests**

Add Pester tests that dot-source `install-dpf.ps1 -LibraryOnly` and assert:
- `Get-DPFComposeArgs` returns `docker-compose.yml`, optional `docker-compose.override.yml`, and `docker-compose.edge.yml` in that order.
- `Get-DPFComposeArgs -IncludeEdge:$false` omits `docker-compose.edge.yml`.
- `Get-DPFStartScriptContent` renders a start script that uses the same compose chain and includes the edge overlay.
- `Set-DPFEnvFileValue` appends and replaces `DPF_BOOTSTRAP_TOKEN` without duplicating keys.

- [x] **Step 2: Verify RED**

Run: `pwsh -NoProfile -Command "Invoke-Pester -Path scripts/installer/windows-edge-node-install.Tests.ps1 -Output Detailed"`

Expected: fails because the helper functions do not exist.

### Task 2: Installer Compose and Start Script Helpers

**Files:**
- Modify: `install-dpf.ps1`

- [x] **Step 1: Implement helpers**

Add helper functions before the `-LibraryOnly` return:
- `Get-DPFComposeArgs`
- `Get-DPFStartScriptContent`
- `Get-DPFStopScriptContent`
- `Set-DPFEnvFileValue`

- [x] **Step 2: Verify GREEN**

Run the new Pester test file. Expected: pass.

### Task 3: Windows Edge Node Bootstrap Flow

**Files:**
- Modify: `install-dpf.ps1`

- [x] **Step 1: Use core compose for first portal start**

Keep the first portal start on core compose so the Edge Node does not crash before a first-run bootstrap token exists.

- [x] **Step 2: Add post-health Edge Node bootstrap**

After portal health succeeds, run an installer bootstrap step that:
- finds the portal container,
- runs `scripts/issue-edge-bootstrap-token.ts --ttl-minutes 30 --auto-approve` inside it,
- writes `DPF_BOOTSTRAP_TOKEN` and `DPF_EDGE_NODE_NAME` into `.env`,
- starts/recreates `edge-node` with `docker-compose.edge.yml`,
- reports whether the edge container reached a running/healthy state.

- [x] **Step 3: Generate lifecycle scripts from helpers**

Use `Get-DPFStartScriptContent` and `Get-DPFStopScriptContent` for generated consumer scripts so `dpf-start.ps1` and `dpf-stop.ps1` preserve the same compose chain.

### Task 4: Operator UI Clarity

**Files:**
- Modify: `apps/web/components/platform/edge-nodes/EdgeNodesAdminClient.tsx`
- Modify: `apps/web/components/platform/edge-nodes/EdgeNodesAdminClient.test.tsx`

- [x] **Step 1: Write failing UI test**

Add a test that renders a Windows Docker Desktop-style container node and expects a concise runtime note that the bundled container is running in Docker container mode with limited host-LAN visibility.

- [x] **Step 2: Implement runtime summary**

Add a compact status strip above the nodes table showing:
- trusted / pending counts,
- active runtime modes,
- a warning note when any node uses `container-host` or `container-vm` on a desktop platform.

### Task 5: Verification

**Files:**
- Existing tests and build scripts

- [x] **Step 1: Run targeted installer tests**

Run:
`pwsh -NoProfile -Command "Invoke-Pester -Path scripts/installer/windows-edge-node-install.Tests.ps1,scripts/installer/windows-install-drive.Tests.ps1 -Output Detailed"`

- [x] **Step 2: Run UI tests**

Run:
`pnpm --filter web exec vitest run components/platform/edge-nodes/EdgeNodesAdminClient.test.tsx`

- [x] **Step 3: Run production build**

Run:
`pnpm --filter web build`

- [x] **Step 4: Local install verification**

Rebuild/recreate the local portal and edge-node from the verified branch or merged main, then confirm:
- `/api/health` returns 200,
- `dpf-edge-node-1` is running and healthy,
- the Edge Node row is trusted,
- a recent `DiscoveryRun` exists for the Edge Node.

### Verification Evidence

- `pwsh -NoProfile -Command "Invoke-Pester -Path scripts/installer/windows-edge-node-install.Tests.ps1,scripts/installer/windows-install-drive.Tests.ps1 -Output Detailed"`: 16 passed, 0 failed.
- `pnpm --filter web exec vitest run components/platform/edge-nodes/EdgeNodesAdminClient.test.tsx`: 10 passed, 0 failed.
- `pnpm --filter web typecheck`: passed.
- `pnpm --filter web build`: passed with the existing Edge Runtime Node API warnings.
- `D:\DPF\dpf-start.ps1 -NoBrowser`: portal recreated healthy with the Edge Node overlay included.
- Local runtime checks: `/api/health` returned `{"status":"ok"}`, `dpf-portal-1` and `dpf-edge-node-1` were healthy, the live `EdgeNode` row was `active` / `trusted`, and recent `DiscoveryRun` rows completed for `edge_1f89971d7b21439a`.
