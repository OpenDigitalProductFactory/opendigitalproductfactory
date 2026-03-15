# External Site Access Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-scoped external-site access to the coworker, implement public search and fetch capabilities with evidence logging, and wire branding analysis into the admin branding workflow.

**Architecture:** Extend the existing coworker tool/proposal system rather than creating a parallel web-access path. Use a page-aware session toggle to gate public search/fetch tools, implement server-side adapters for Brave Search and public page fetch, persist evidence records, and expose a branding-analysis path that can populate the admin branding form when `Hands On` is enabled.

**Tech Stack:** Next.js app router, React client components, TypeScript, Prisma, Vitest, server-side fetch

---

## File Map

- Modify: `apps/web/components/agent/AgentPanelHeader.tsx`
  - add `External Off / External On` pill UI
- Modify: `apps/web/components/agent/AgentPanelHeader.test.tsx`
  - cover the new external-access pill rendering
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`
  - surface external access session state into the coworker flow
- Create: `apps/web/components/agent/agent-external-access-session.ts`
  - session-scoped route-aware external access helpers
- Modify: `apps/web/lib/mcp-tools.ts`
  - add read-only public web search/fetch/branding tools
- Create: `apps/web/lib/public-web-tools.ts`
  - Brave Search and public fetch adapters plus SSRF-safe validation
- Create: `apps/web/lib/public-web-tools.test.ts`
  - verify normalization and URL blocking logic
- Modify: `apps/web/lib/actions/agent-coworker.ts`
  - expose external tools only when session access is enabled
- Modify: `apps/web/components/admin/BrandingConfigurator.tsx`
  - register branding form assist and consume branding-analysis suggestions
- Create: `apps/web/components/admin/branding-form-assist.ts`
  - safe field update application for branding fields
- Create: `apps/web/lib/actions/external-evidence.ts`
  - evidence logging helpers
- Add Prisma migration and schema changes in `packages/db`
  - evidence record model for public search/fetch operations

## Chunk 1: External Access Session Toggle

### Task 1: Add failing header test for external access pill

**Files:**
- Modify: `apps/web/components/agent/AgentPanelHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

Add coverage that expects the header to render `External Off` by default and `External On` when enabled.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/AgentPanelHeader.test.tsx --reporter=basic"
```

Expected: FAIL because the header does not yet render an external-access pill.

- [ ] **Step 3: Write minimal implementation**

Update `AgentPanelHeader.tsx` to:
- render a second pill for external access
- show `External Off` / `External On`
- call a new toggle callback

- [ ] **Step 4: Run test to verify it passes**

Run the same `vitest` command.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/agent/AgentPanelHeader.tsx apps/web/components/agent/AgentPanelHeader.test.tsx
git commit -m "feat: add coworker external access pill"
```

### Task 2: Add failing tests for session-scoped external access state

**Files:**
- Create: `apps/web/components/agent/agent-external-access-session.ts`
- Create: `apps/web/components/agent/agent-external-access-session.test.ts`
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`

- [ ] **Step 1: Write the failing tests**

Add tests for a helper that:
- stores external access state by `user + route + session`
- defaults to disabled
- does not imply long-term persistence

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run components/agent/agent-external-access-session.test.ts --reporter=basic"
```

Expected: FAIL because the helper does not yet exist.

- [ ] **Step 3: Write minimal implementation**

Create the helper and wire `AgentCoworkerPanel.tsx` to use it for the current route and session.

- [ ] **Step 4: Run test to verify it passes**

Run the same `vitest` command.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/agent/agent-external-access-session.ts apps/web/components/agent/agent-external-access-session.test.ts apps/web/components/agent/AgentCoworkerPanel.tsx
git commit -m "feat: add session-scoped coworker external access state"
```

## Chunk 2: Public Search and Fetch Foundation

### Task 3: Add failing tests for public web validation and normalization

**Files:**
- Create: `apps/web/lib/public-web-tools.ts`
- Create: `apps/web/lib/public-web-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for:
- blocking localhost and private-network targets
- normalizing public fetch inputs
- normalizing search results into a stable shape

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\vitest.CMD run lib/public-web-tools.test.ts --reporter=basic"
```

Expected: FAIL because the adapter file does not yet exist.

- [ ] **Step 3: Write minimal implementation**

Create:
- URL validation helpers
- public fetch normalization
- Brave Search result normalization

Do not add the full branding analysis yet.

- [ ] **Step 4: Run test to verify it passes**

Run the same `vitest` command.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/public-web-tools.ts apps/web/lib/public-web-tools.test.ts
git commit -m "feat: add public web search and fetch foundation"
```

### Task 4: Add evidence schema and logging helpers

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration under `packages/db/prisma/migrations/...`
- Create: `apps/web/lib/actions/external-evidence.ts`
- Add tests in `packages/db` or `apps/web` as appropriate

- [ ] **Step 1: Write the failing test**

Add a small test for evidence creation or serialization shape.

- [ ] **Step 2: Run test to verify it fails**

Run the focused test command you add for this evidence helper.

- [ ] **Step 3: Write minimal implementation**

Add an evidence record model with fields for:
- operation type
- actor user id
- route
- query/url
- result summary
- source/provider
- created timestamp

Then add a helper to write records from search/fetch flows.

- [ ] **Step 4: Run test to verify it passes**

Run the same focused test.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/web/lib/actions/external-evidence.ts <test files>
git commit -m "feat: add external evidence logging"
```

## Chunk 3: Coworker Tool Integration

### Task 5: Add failing tests for gated external tool availability

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify or Create tests for tool availability and coworker action gating

- [ ] **Step 1: Write the failing tests**

Add tests showing:
- external tools are hidden when `External Off`
- external tools are available when `External On`
- tools remain read-only and capability-scoped

- [ ] **Step 2: Run test to verify it fails**

Run the focused test command for the modified files.

- [ ] **Step 3: Write minimal implementation**

Update:
- `mcp-tools.ts` to register read-only public web tools
- `agent-coworker.ts` to pass external tools only when the external access session state is enabled

- [ ] **Step 4: Run test to verify it passes**

Run the same focused tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/actions/agent-coworker.ts <test files>
git commit -m "feat: gate external coworker tools by session access"
```

## Chunk 4: Branding Analysis and Form Wiring

### Task 6: Add failing tests for branding form assist registration

**Files:**
- Modify: `apps/web/components/admin/BrandingConfigurator.tsx`
- Create: `apps/web/components/admin/branding-form-assist.ts`
- Add tests under `apps/web/components/admin`

- [ ] **Step 1: Write the failing tests**

Add tests showing:
- branding fields can be registered for assist
- structured field updates only affect allowed branding fields

- [ ] **Step 2: Run test to verify it fails**

Run the focused admin component test command.

- [ ] **Step 3: Write minimal implementation**

Wire the branding configurator into `registerActiveFormAssist` and add a helper to safely apply:
- company name
- logo URL
- selected token fields

- [ ] **Step 4: Run test to verify it passes**

Run the same focused tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/BrandingConfigurator.tsx apps/web/components/admin/branding-form-assist.ts <test files>
git commit -m "feat: add branding form assist wiring"
```

### Task 7: Add branding-analysis tool flow

**Files:**
- Modify: `apps/web/lib/public-web-tools.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Add focused tests

- [ ] **Step 1: Write the failing tests**

Add tests for a branding-analysis helper that transforms fetched public page evidence into:
- company name candidate
- logo URL candidate
- color candidates

- [ ] **Step 2: Run test to verify it fails**

Run the focused test command.

- [ ] **Step 3: Write minimal implementation**

Implement a read-only `analyze_public_website_branding` flow on top of the public fetch adapter and evidence logging.

- [ ] **Step 4: Run test to verify it passes**

Run the same focused test command.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/public-web-tools.ts apps/web/lib/mcp-tools.ts <test files>
git commit -m "feat: add branding analysis from public websites"
```

## Chunk 5: Focused Verification

### Task 8: Run branch-level verification

**Files:**
- Verify only

- [ ] **Step 1: Run focused vitest suite**

Run all newly added or modified focused tests for:
- agent header/session
- public web tools
- coworker tool gating
- branding form assist

- [ ] **Step 2: Run web typecheck**

Run:

```bash
cmd /c "D:\OpenDigitalProductFactory\apps\web\node_modules\.bin\tsc.CMD --noEmit"
```

- [ ] **Step 3: Run web build**

Run:

```bash
$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter web build
```

- [ ] **Step 4: Commit final verification-driven fixes if needed**

```bash
git add <files>
git commit -m "fix: complete external site access verification"
```

Only if needed.
