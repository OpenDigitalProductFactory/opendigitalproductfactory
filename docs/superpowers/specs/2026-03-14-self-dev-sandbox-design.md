# EP-SELF-DEV-001A: Product Development Studio + Sandboxed Code Generation — Design Spec

**Date:** 2026-03-14
**Goal:** A non-developer describes what they want in plain language. The platform builds it in a sandboxed container, shows a live preview, and deploys when approved. Features can be contributed back to the Hive Mind.

**Target user:** Small business owner with zero coding experience. They describe ideas in text, screenshots, drawings, or URLs of products they like. The AI handles everything else.

---

## 1. Product Development Studio (`/build`)

### Route: `apps/web/app/(shell)/build/page.tsx`

A dedicated workspace for creating new features. Three-panel layout:

| Panel | Content |
|-------|---------|
| **Left** | Conversation with the AI agent (full co-worker panel, not floating) |
| **Right** | Live sandbox preview (iframe) or Feature Brief summary |
| **Bottom bar** | Phase indicator: Ideate → Plan → Build → Review → Ship |

**Auth:** `view_platform` capability (HR-000, HR-200, HR-300). Not all roles should build features — this is a platform management function.

### The Five Phases

| Phase | What the User Does | What the Agent Does |
|-------|-------------------|-------------------|
| **Ideate** | Describes the idea. Uploads screenshots, pastes URLs, answers questions. Picks a portfolio context from the taxonomy. | Asks plain-language questions. Builds a structured Feature Brief. Never asks technical questions. |
| **Plan** | Sees a summary: "I'll create a feedback form with 3 fields, a new page at /feedback, and save responses to the database." Approves or asks for changes. | Creates an internal implementation plan (files, components, schema). User sees the summary, not the plan details. |
| **Build** | Watches the live preview update as the agent works. Can say "make the button bigger" or "add a date field." | Launches sandbox container. Runs coding agent (Claude Code / Agent SDK). Writes code. Updates preview in real-time. |
| **Review** | Sees the finished preview. Agent reports test results. User clicks through the feature to verify. | Runs tests, type checks. Presents a summary: "3 files created, 1 migration, all tests pass." |
| **Ship** | Clicks "Deploy" → feature goes live. Optionally clicks "Contribute to Hive Mind." | Extracts git diff. Applies to running platform. Packages Feature Pack for contribution if requested. |

### Feature Brief

A structured document built during the Ideate phase:

```typescript
type FeatureBrief = {
  title: string;                    // "Customer Feedback Form"
  description: string;              // Plain language description
  portfolioContext: string;         // taxonomy slug — e.g., "products_and_services_sold"
  targetRoles: string[];            // which HR roles will use it
  inputs: string[];                 // screenshots, URLs, drawings uploaded by user
  dataNeeds: string;                // what data it stores (agent translates internally)
  acceptanceCriteria: string[];     // what "done" looks like, in plain language
};
```

### Input Types

Users can provide:
- **Text** — describe what they want in conversation
- **Screenshots** — upload images of existing products or sketches
- **URLs** — link to products they like ("I want something like this")
- **Drawings** — hand-drawn mockups uploaded as images
- **Voice** (future) — describe verbally

All inputs are attached to the Feature Brief and passed to the coding agent as context.

---

## 2. Sandbox Architecture

### Docker Image: `dpf-sandbox`

Lightweight, disposable container for code generation:

```dockerfile
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache git
WORKDIR /workspace
# No database access, no secrets, no Docker socket
# Resource limits applied at container creation
```

Image is built once and reused. Each build task gets a fresh container.

### Sandbox Lifecycle

1. **Create:** Portal calls Docker API to create container from `dpf-sandbox` image. Mounts a git worktree of the repo. Sets resource limits (2 CPU, 4GB RAM, 10GB disk).
2. **Install:** Container runs `pnpm install` (cached via volume mount for speed).
3. **Dev server:** Container starts `next dev` on port 3001. Portal proxies via `/api/sandbox/preview`.
4. **Code generation:** Portal sends the Feature Brief + implementation plan to the coding agent inside the container.
5. **Iteration:** User gives feedback → agent modifies code → preview updates live.
6. **Extract:** When approved, portal extracts the git diff from the container.
7. **Destroy:** `docker rm` — container and all state is deleted.

### Sandbox Security

- **No database access** — sandbox cannot reach Postgres, Neo4j, or any platform service
- **No secrets** — no `.env`, no API keys, no credentials mounted
- **No Docker socket** — sandbox cannot spawn other containers
- **Network isolation** — sandbox can only reach the internet for npm packages (or fully air-gapped)
- **Resource limits** — CPU, memory, disk caps prevent abuse
- **Time limit** — sandbox auto-destroys after 30 minutes of inactivity

### Preview Proxy

The portal proxies the sandbox dev server to the browser:

```
Browser → /api/sandbox/preview → http://sandbox-container:3001
```

This avoids CORS issues and keeps the sandbox port internal. The Build page renders it in an iframe.

---

## 3. Coding Agent Integration

### Agent Selection

The platform selects the best available coding model based on task suitability:

1. Check `ModelProfile.codingCapability` rating (new field):
   - `"excellent"` — Claude Sonnet/Opus, GPT-4o, DeepSeek Coder V2 (green, recommended)
   - `"adequate"` — qwen3:8b, Llama 3 70B, Mistral Large (yellow, warning)
   - `"insufficient"` — qwen3:1.7b, phi3:mini, small models (red, blocked for Build tasks)
2. If best available is `"insufficient"`: warn user and suggest configuring a capable provider
3. If best available is `"adequate"`: show warning: "Results may need more refinement. For best results, configure [recommended provider]."
4. The weekly optimization agent updates `codingCapability` based on community benchmarks (SWE-bench, BigCodeBench, HumanEval)

### Coding Agent Execution

The coding agent runs inside the sandbox container. Two approaches supported:

**Claude Code CLI** (preferred when Anthropic API key configured):
- Portal installs Claude Code in the sandbox
- Passes the Feature Brief + CLAUDE.md as context
- Claude Code has full repo access inside the sandbox
- Results: modified files tracked via git diff

**Direct LLM API** (fallback for any provider):
- Portal sends a structured code generation prompt to the configured coding model
- Response contains file contents
- Portal writes files into the sandbox via Docker exec
- Less interactive but works with any provider

### Task-Aware Provider Selection

New concept: **Task Profiles** on the provider priority system.

The `PlatformConfig` key `provider_priority` is extended with task-specific rankings:

```typescript
type ProviderPriority = {
  conversation: ProviderPriorityEntry[];   // for chat (existing)
  code_generation: ProviderPriorityEntry[];  // for Build studio
  analysis: ProviderPriorityEntry[];         // for data/reporting tasks (future)
};
```

The weekly optimization agent ranks each task category separately. A local model might be rank 1 for conversation but rank 3 for code generation (behind Anthropic and OpenAI).

The Build studio's AI agent explains this to the user: "To build this feature, I recommend using Claude (excellent for code). Your local model can handle conversations but code generation works better with a specialized model."

---

## 4. Build Workflow MCP Tools

New MCP tools added to the platform's tool registry:

| Tool | Capability | Description |
|------|-----------|-------------|
| `start_feature_brief` | `view_platform` | Create a new FeatureBuild record, start Ideate phase |
| `launch_sandbox` | `view_platform` | Spin up sandbox container, install deps, start dev server |
| `generate_code` | `view_platform` | Send plan to coding agent in sandbox |
| `iterate_sandbox` | `view_platform` | Send refinement instructions to coding agent |
| `preview_sandbox` | `view_platform` | Get the sandbox preview proxy URL |
| `run_sandbox_tests` | `view_platform` | Run `pnpm test` + `tsc --noEmit` inside sandbox, return results |
| `deploy_feature` | `manage_capabilities` | Extract diff, apply to running platform, run migrations |
| `contribute_to_hive` | `view_platform` | Package Feature Pack, create contribution (PR or registry upload) |

All tools follow the existing MCP tool-use pattern with HITL approval for destructive actions (`deploy_feature` requires `manage_capabilities` — HR-000 only).

---

## 5. Schema

### FeatureBuild

Tracks a build through the five phases:

```prisma
model FeatureBuild {
  id              String   @id @default(cuid())
  buildId         String   @unique  // "FB-XXXXX"
  title           String
  description     String?  @db.Text
  portfolioId     String?
  brief           Json?    // FeatureBrief structure
  plan            Json?    // Internal implementation plan
  phase           String   @default("ideate") // ideate | plan | build | review | ship | complete | failed
  sandboxId       String?  // Docker container ID
  sandboxPort     Int?     // Dev server port
  diffSummary     String?  @db.Text  // Human-readable change summary
  diffPatch       String?  @db.Text  // Git patch content
  codingProvider  String?  // Which provider/model did the code generation
  threadId        String?  // Links to the conversation thread
  createdById     String
  createdBy       User     @relation(fields: [createdById], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([phase])
  @@index([createdById])
}
```

### FeaturePack

Packaged feature for Hive Mind sharing:

```prisma
model FeaturePack {
  id            String   @id @default(cuid())
  packId        String   @unique  // "FP-XXXXX"
  title         String
  description   String?  @db.Text
  portfolioContext String?
  version       String   @default("1.0.0")
  manifest      Json     // files, migrations, seeds, dependencies
  screenshot    String?  // URL or base64 preview image
  buildId       String?  // Links to the FeatureBuild that created it
  status        String   @default("local")  // local | contributed | published
  createdAt     DateTime @default(now())
}
```

### ModelProfile Extension

Add to existing `ModelProfile`:

```prisma
  codingCapability String? // "excellent" | "adequate" | "insufficient"
```

### ProviderPriority Extension

The `PlatformConfig` key `provider_priority` value shape changes from flat array to task-keyed:

```typescript
{
  conversation: [...],     // existing entries
  code_generation: [...],  // new
}
```

`getProviderPriority()` accepts a task parameter and returns the appropriate ranked list. Falls back to `conversation` for unknown task types.

---

## 6. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `Dockerfile.sandbox` | Lightweight sandbox image (Node + pnpm + git) |
| `apps/web/app/(shell)/build/page.tsx` | Build studio page (three-panel layout) |
| `apps/web/app/(shell)/build/layout.tsx` | Auth gate (`view_platform`) |
| `apps/web/app/api/sandbox/preview/route.ts` | Proxy sandbox dev server to browser |
| `apps/web/lib/sandbox.ts` | Sandbox lifecycle management (create, start, exec, extract, destroy) |
| `apps/web/lib/feature-build-types.ts` | FeatureBrief, FeatureBuild types |
| `apps/web/lib/actions/build.ts` | Server actions for build phases |
| `apps/web/lib/coding-agent.ts` | Coding agent orchestration (Claude Code or direct LLM) |
| `apps/web/components/build/BuildStudio.tsx` | Three-panel layout component |
| `apps/web/components/build/FeatureBriefPanel.tsx` | Feature Brief display/edit |
| `apps/web/components/build/SandboxPreview.tsx` | Iframe preview component |
| `apps/web/components/build/PhaseIndicator.tsx` | Phase progress bar |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | FeatureBuild + FeaturePack models, ModelProfile.codingCapability, User reverse relations |
| `apps/web/lib/mcp-tools.ts` | Add 8 Build studio tools |
| `apps/web/lib/ai-provider-priority.ts` | `getProviderPriority` accepts task parameter |
| `apps/web/lib/permissions.ts` | Add `view_build` capability if needed (or reuse `view_platform`) |
| `apps/web/components/shell/Header.tsx` | Add "Build" nav item |
| `docker-compose.yml` | Add `dpf-sandbox` service definition (optional, on-demand) |

---

## 7. Testing Strategy

- **Unit tests for sandbox lifecycle**: create/start/exec/destroy (mock Docker API)
- **Unit tests for MCP build tools**: tool definitions, capability filtering
- **Unit tests for task-aware provider selection**: conversation vs code_generation ranking
- **Unit tests for FeatureBrief validation**: required fields, portfolio context
- **Integration test**: Ideate → Plan → Build → Review → Ship with mock coding agent
- **Visual verification**: Build page layout, iframe preview, phase transitions

---

## 8. Not in Scope (Subsystem B — Separate Epic)

- **Governed deployment pipeline** — BI-SELFDEV-003 (diff review workflow, automated test gates)
- **Platform self-update** — BI-SELFDEV-004 (pull from repo, apply migrations, restart)
- **Hive Mind registry** — community feature marketplace (browse, install, rate packs)
- **Voice input** — describing features verbally
- **Multi-user collaboration** — multiple people working on the same build simultaneously
