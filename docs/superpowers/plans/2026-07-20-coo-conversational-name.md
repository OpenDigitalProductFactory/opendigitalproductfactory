# Organization-scoped conversational name for the AI COO

**Backlog item:** BI-ADEF2982
**Epic:** EP-AI-PROVIDER-SUITABILITY
**Work capsule:** WC-7DC40C78
**Branch:** `codex/coo-conversational-name`

## Outcome

During setup, an owner may keep “COO,” choose an optional suggestion, or enter a short organization-visible conversational name for the standing coworker. Approved conversational surfaces render `<name> · AI COO`; canonical workforce identity, routing, authority, model/provider attribution, A2A references, and authenticated action attribution remain `AGT-ORCH-000` / `COO`.

## Grounded substrate

- `Agent.displayName` is the canonical workforce label and `resolveAgentIdentity` forces `AGT-ORCH-000` to `COO`.
- The setup tour is a real-route sequence in `setup-constants.ts`; `SetupOverlay` and the distinct Onboarding COO own guidance and handoff.
- The standing chat header and message bylines currently resolve from canonical route/agent labels in `AgentCoworkerPanel`.
- The existing coworker record at `/platform/ai/agent/[agentId]` is the correct later-management surface.
- `PlatformSetupProgress.context` is workflow state, not durable presentation configuration. Registry aliases are technical routing identity, not organization preference.

## Architecture and amended persona decision

Decision `DI-B0D8FBA2C56C` recommends a nullable `Organization.cooConversationalName` field with high confidence (composite 12.365, margin 0.478, no commandment conflict). It outranks a generalized presentation table because this BI deliberately proves the contract only for the standing COO, and it decisively outranks reading completed setup context forever.

This narrowly amends the ratified role-only contract: `COO` remains the primary canonical identity and all byline/accountability rules remain binding. The organization may add a conversational address only when the UI simultaneously and persistently discloses `AI COO`. The preference is never an alias, author, principal, accountable officer, permission subject, prompt identity, or routing key.

## TDD implementation plan

1. Add pure validation and presentation-resolution tests first: default/clear, whitespace normalization, length/control-character rejection, system identifiers, reserved accountable titles, and collision with a real employee display name.
2. Add the nullable Organization field and fleet-safe migration, plus a data-impact manifest. No existing row changes and null means the role-only default.
3. Add authenticated server actions to read/save/clear the preference for the current install organization. Require `manage_platform`; validate again server-side and never write Agent or historical message/audit rows.
4. Insert a non-blocking `meet-your-coo` step before the final Workspace step. Render an accessible choice card with plain-language AI/authority disclosure, small inclusive suggestion groups, free text, Keep COO, and Skip/Later behavior. Persist the choice before advancing.
5. Include the saved presentation in the Onboarding COO’s final handoff trigger while keeping the two agents distinct.
6. Pass the preference from the server shell into the coworker panel. Override only standing-COO chat header, busy label, avatar, and standing-COO message byline with the role-preserving presentation string; all other coworkers and stored messages remain canonical.
7. Add the same editor to the existing standing-COO record page for authorized later change/clear. The record header, IDs, governance, and audit panels stay canonical.
8. Amend the persona/attribution decision, setup and AI Workforce user guides, and data-impact documentation. Run targeted unit/component/action tests, migration apply, typecheck/build, and authenticated desktop/mobile setup plus post-setup chat/settings walkthrough.

## Backlog coverage

- Decision: atomic
- Parent: `BI-ADEF2982`
- Organization preference, validation, setup choice/handoff, approved chat presentation, later editor, canonical identity invariants, and UX proof -> `BI-ADEF2982`
- Dependencies: none
- Receipt: `cmrt9hb47021401muieltufl2`
- Rationale: The organization preference, validation policy, setup choice/handoff, approved chat presentation, later settings editor, canonical identity invariants, and UX proof are one end-to-end personalization contract; no slice is safe or useful to ship independently.

The live MCP surface does not yet expose `record_plan_backlog_coverage`, so this receipt was written through governed `record_execution_evidence` with the equivalent atomic decision and mapping after live verification of the BI.

## Risks and rollback

- Anthropomorphism or implied accountability is the primary product risk. Every friendly presentation keeps `AI COO` visible, while audit/byline truth remains canonical.
- A deceptive name could impersonate a real worker or internal system. Server validation rejects employee collisions, control characters, internal identifiers, and a narrow reserved-title set; client validation is only assistance.
- Setup must never block on personalization. Keep COO, Skip, Later, and clearing all restore the null/default contract.
- The migration is additive and nullable. Code rollback ignores the field; data rollback is clearing the preference, not editing a committed migration.

## UX fit review — optional AI COO conversational name

- Decision: `fits-with-guardrails`.
- Owning area: Platform; setup is the contextual introduction, while `/platform/ai/agent/coo` is the canonical later-management home.
- Route family: the existing `/workspace` setup overlay and `/platform/ai/agent/coo`; no global or section navigation changes and no new route.
- Primary persona: a non-technical founder/operator choosing how to address the coworker who has their back, without needing to understand agent identifiers, provider routing, or permission models.
- Navigation layer touched: contextual setup action plus a local editor on the existing COO record.
- Reuse/convergence: reuses `SetupOverlay`, its established setup-action contract, the existing coworker record, theme tokens, and standard form controls. The report-kit is intentionally not used because this is a preference form, not reporting or data-display UI. The setup action observer was extracted from the oversized coworker panel into the setup component family rather than increasing that module's budget.
- Source truth: nullable `Organization.cooConversationalName`; `Agent.displayName`, `AGT-ORCH-000`, grants, routing, prompts, messages, and audit attribution remain canonical.
- Empty/failure behavior: null, Keep COO, Skip, Later, or clear all retain `COO`; invalid names stay in place with a plain-language error; unauthorized users see the value but no editor; save failures do not advance setup.
- AI boundary: choosing or saving a name sends no coworker prompt and grants no authority. The existing Onboarding COO narration remains informational, and advancing setup remains an explicit user action.
- Design-research result: the design-intelligence and existing-spec searches returned no closer pattern. The platform UX spine favors a contextual setup decision and a single canonical settings home. Advisory decision `DI-32A5A9AE792F` favored onboarding exposure over settings-only with high confidence; the dedicated late setup step preserves that exposure without crowding initial account fields.
- Guardrails folded into the implementation: optional language; persistent `AI COO` disclosure; no new navigation; server-side validation; role/accountability disclosure in setup and settings; desktop and narrow-viewport verification.
- Evidence before merge: focused route/component/action tests, module-size guard, token/theme scan through the normal build gate, additive migration apply, authenticated `/workspace` setup at desktop and 390×844, standing chat presentation, `/platform/ai/agent/coo` edit/clear, and exact-SHA merged-code pregate.
- Captured in: this plan and PR #3343.

## Completion evidence

- [x] Default, suggestion, custom, clear, invalid, employee-collision, authorization, and canonical identity tests pass (7 focused files, 41 tests).
- [x] Setup resume and Onboarding-COO-to-standing-COO handoff tests pass.
- [x] Chat header/message/busy presentation tests prove `<name> · AI COO`; routing and stored attribution remain canonical.
- [x] Migration, data-impact, typecheck, production build, and exact-SHA pregate pass (first acceptance gate: candidate `3f9a521dd98e026fb90e2acf04b7f38584e71000` merged with `origin/main` `65354b9a71cd5d5592e177a57014042915bff4e0` under lease `NPEL-4E2D460A13`; the final evidence-only amendment is re-gated before publication).
- [x] Authenticated desktop/mobile setup, chat, later-edit, clear, and comprehension walkthrough passes under governed Contributor preview lease `NPEL-E7220B211F`: suggestions and custom field were operable, save advanced the setup record, the 390×844 card fit within the viewport without overflow, standing chat rendered `Number Two · AI COO`, settings retained the canonical-identity disclosure, and `Use COO` cleared the organization preference.
- [ ] PR health is terminal/passing, merge queue lands it, and governed live verification confirms the deployed behavior.
