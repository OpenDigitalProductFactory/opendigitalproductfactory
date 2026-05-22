# AI Question Method Platform Implementation

> Status: draft implementation plan after transcript review.
> Source guidance: `docs/superpowers/specs/2026-04-14-ai-coworker-calm-prompting-guidelines.md`.
> Related specs: `2026-03-14-agent-panel-ux-redesign.md`, `2026-03-14-build-studio-conversation-integration-design.md`, `2026-03-30-ai-coworker-skills-marketplace.md`, `2026-04-23-a2a-aligned-coworker-runtime-design.md`, `2026-05-17-wwmd-decision-perspective-kernel-design.md`, `2026-05-19-wwmd-mcp-exposure-design.md`.
> Related live epics checked through DPF MCP on 2026-05-22: `EP-BUILD-STUDIO`, `EP-BUILD-STUDIO-UX`, `EP-A2A`, `EP-WWMD-MCP`, `EP-TAK-3F9A21`.

## Goal

Turn the transcript-derived "senior partner question method" into a platform contract that improves coworker collaboration without turning every interaction into a form, and without confusing advisory thinking with governed decisions.

The first implementation should make the human-to-AI interface better at carrying:

- intent center
- hard edges
- context references
- success shape
- operator thesis
- pushback permission
- expected artifact

The contract must preserve the core routing rule:

> Direct ask helps think; WWMD helps decide.

## Live Backlog Grounding

MCP searches for `AI question method prompting coworker composer Build Studio A2A skills WWMD` returned no exact existing epic, backlog item, or indexed spec/plan match. The related live epics with open work are:

| Epic | Fit |
| --- | --- |
| `EP-BUILD-STUDIO` | Build Studio ideate/plan prompt and gate behavior. |
| `EP-BUILD-STUDIO-UX` | Composer and work-surface UI affordances. |
| `EP-A2A` | Task-native handoff and `TaskArtifact` packet work. |
| `EP-WWMD-MCP` | Advisory vs governed WWMD tool exposure. |
| `EP-TAK-3F9A21` | Prompt envelope, authority, memory, and governance alignment. |

No new live epic is created by this plan. If accepted, the implementation can either attach slices to those existing epics or create a narrow epic such as `EP-AI-QUESTION-METHOD` through MCP with this plan path as evidence.

## Architecture Shape

Add a small reusable question-packet layer rather than scattering string conventions across components.

Candidate module:

- `apps/web/lib/tak/question-packet.ts`
- `apps/web/lib/tak/question-packet.test.ts`

Core type:

```ts
export type QuestionPacket = {
  intentCenter?: string;
  explorationQuestions?: string[];
  hardEdges?: string[];
  contextRefs?: Array<{
    kind: "file" | "route" | "task-artifact" | "db-record" | "spec" | "plan" | "tool-receipt" | "freeform";
    label: string;
    ref: string;
  }>;
  successShape?: string;
  operatorThesis?: string;
  pushbackPermission?: "none" | "gentle" | "direct";
  expectedArtifact?: "answer" | "brief" | "plan" | "patch" | "task-artifact" | "decision-packet" | "backlog-item";
};
```

The first slice should keep the type optional and additive. Existing chat sends still work with only `message: string`.

## Routing Contract

| Situation | Runtime path |
| --- | --- |
| Simple or low-risk user question | Direct chat; no packet required. |
| Knowledge-work chat with optional fields populated | Direct chat with question packet injected into prompt envelope. |
| Deterministic pipeline/action | Schema, checklist, eval, tool authorization, tests; no open-ended packet. |
| A2A handoff with ambiguity | Persist packet as `TaskArtifact.metadata.artifactType = "question-packet"`. |
| High ambiguity + high consequence | Route to deliberation or governed WWMD, with `routingReason`. |
| Exploration of a consequential topic without decision authority | Use advisory `wwmd_evaluate`, not governed `wwmd_decide`. |

## TDD Sequence

1. `question-packet` pure helper tests
   - Normalizes empty strings and empty arrays out of the packet.
   - Formats a packet into a compact prompt block.
   - Preserves `contextRefs` without reading files or records itself.
   - Returns `null` for an empty packet so simple chat remains lightweight.
   - Rejects invalid `expectedArtifact` and `pushbackPermission` values via runtime guards.

2. Prompt assembly tests
   - `assembleSystemPrompt` includes a question packet block only when the packet is non-empty.
   - Explanation-only requests remain read-only and do not gain side-effecting tool language from the packet.
   - `pushbackPermission: "direct"` produces explicit permission to challenge the operator thesis.
   - Missing context references are not fabricated.

3. Coworker composer tests
   - The main text area remains sufficient to send a message.
   - Optional intent/source/exclusion/artifact fields are not required.
   - Filled fields are passed to the send path as a structured packet.
   - Skill-click scaffolds merge with the user's current message instead of replacing it.

4. Build Studio prompt tests
   - Ideate and Plan prompts include the question-method overlay.
   - Build, Review, and Ship stay more deterministic and do not ask broad strategy questions unless the user explicitly reopens intent.
   - Non-technical users are not asked database/schema/tooling questions.

5. TaskArtifact handoff tests
   - Ambiguous A2A handoffs persist a `question-packet` artifact.
   - Straightforward handoffs can persist the smaller existing handoff artifact.
   - The packet links back to `TaskRun` and context refs without duplicating raw chat history.

## Implementation Slices

### Slice 1 - Shared question packet contract

Files:

- `apps/web/lib/tak/question-packet.ts`
- `apps/web/lib/tak/question-packet.test.ts`
- `apps/web/lib/tak/prompt-assembler.ts`
- existing prompt assembler tests

Exit:

- Empty packet produces no prompt block.
- Non-empty packet is formatted into a calm, structured "Question packet" prompt section.
- Tests prove read-only/explanation-only guardrails still win over packet content.

### Slice 2 - Question-aware coworker composer

Files:

- `apps/web/components/agent/AgentMessageInput.tsx`
- `apps/web/components/agent/AgentCoworkerPanel.tsx`
- nearby component tests

UI:

- Keep a single main text area.
- Add optional compact affordances for intent, sources, exclusions, and expected artifact.
- Use DPF CSS variables only.
- Do not block send when optional fields are empty.

Exit:

- Simple messages behave exactly as before.
- Populated fields are sent as `questionPacket`.
- Keyboard and screen-reader behavior remains usable.

### Slice 3 - Runtime send path and prompt envelope

Files:

- `apps/web/lib/actions/agent-coworker.ts`
- `apps/web/lib/tak/prompt-assembler.ts`
- `apps/web/lib/tak/conversation-intent.ts` only if an intent guard must be extended

Exit:

- `sendMessage` accepts optional `questionPacket`.
- Prompt assembly includes the packet after identity/authority and before volatile route data.
- Side-effecting tools remain stripped for explanation-only turns.

### Slice 4 - Build Studio ideate/plan overlay

Files:

- `apps/web/lib/integrate/build-agent-prompts.ts`
- `apps/web/lib/build-agent-prompts.ts` only as shim coverage if needed
- prompt tests near existing Build Studio prompt coverage

Exit:

- Ideate and Plan ask for intent center, hard edges, source breadth, success shape, and expected artifact.
- Build/Review/Ship remain gate/test/action oriented.
- Prompt language follows the calm prompting rules.

### Slice 5 - A2A question-packet artifact helper

Files:

- `apps/web/lib/tak/task-records.ts`
- caller-specific tests where handoff artifacts are created

Exit:

- Helper can persist `artifactType: "question-packet"`.
- Packet references existing task context and evidence instead of copying full transcript.
- Straightforward handoffs still use the smaller handoff artifact.

### Slice 6 - Skill quality and prompt review checklist

Files:

- skill evaluation code or review docs, depending on current implementation seam
- prompt admin/review docs if no runtime review UI exists yet

Exit:

- Knowledge-work skills are scored for question-scaffold structure.
- Pipeline skills are scored for typed inputs, deterministic checks, and verification.
- The review checklist can be used before any skill becomes active.

## Verification Commands

Expected focused verification for Slice 1 through Slice 4:

```powershell
pnpm --filter web exec vitest run lib/tak/question-packet.test.ts
pnpm --filter web exec vitest run lib/tak/prompt-assembler.test.ts lib/tak/conversation-intent.test.ts
pnpm --filter web exec vitest run components/agent/AgentMessageInput.test.tsx
pnpm --filter web exec vitest run lib/integrate/build-agent-prompts.test.ts
pnpm --filter web typecheck
```

Run `pnpm --filter web exec next build` before closing any implementation branch that changes runtime code.

## UX Verification

Against the Docker-served portal:

1. Log in as `admin@dpf.local`.
2. Open a normal route coworker panel and send a simple question; confirm no extra form is required.
3. Fill optional composer fields and confirm the coworker answer reflects intent, edges, sources, and expected artifact.
4. Click a skill while text is already present; confirm the skill scaffolds the user's message instead of replacing it.
5. Open `/build`, start or select a build in Ideate/Plan, and confirm the coworker asks outcome-framing questions rather than technical implementation questions.
6. Trigger a read-only explanation request and confirm no backlog/action proposal is created.

## Refactoring Budget

Use the refactor budget on the shared question-packet module and prompt-envelope insertion point. This keeps the concept reusable across composer UI, Build Studio, A2A handoff, skills, and WWMD rather than creating one-off prompt strings in each surface.

Avoid a large UI redesign in the first implementation slice. The first useful change is a small optional packet path with strong tests.

## Risks and Controls

| Risk | Control |
| --- | --- |
| Chat becomes a form | Optional fields only; empty packet omitted. |
| Packet bypasses authority | Prompt packet carries thinking context only; tool grants and proposal gates remain authoritative. |
| WWMD overuse | Governed `wwmd_decide` requires ambiguity, consequence, and `routingReason`. |
| User thesis gets mirrored blindly | `pushbackPermission` is explicit and tested. |
| Context refs become hallucinated evidence | Packet stores refs; loaders/readers must verify them separately. |
| Pipeline work becomes vague | Deterministic pipeline path stays schema/test/checklist based. |

## Open Questions

1. Should the composer fields be visible chips by default, or an expandable "Add context" tray?
2. Should `questionPacket` live in the persisted `AgentMessage.metadata`, or only in the transient prompt envelope for Slice 1?
3. Should skill frontmatter gain question-scaffold fields now, or should they be derived during skill evaluation first?
4. Should A2A handoff use `question-packet` as a separate artifact type, or extend the existing handoff artifact with a `questionPacket` sub-object?
5. Should accepted question packets become candidate prompt material in the same review queue as WWMD candidate materials, or a separate prompt-improvement queue?
