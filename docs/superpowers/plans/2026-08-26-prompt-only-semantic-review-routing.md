# Prompt-only semantic-review routing

**Backlog item:** BI-47ACE2C7  
**Epic:** EP-56AE0F69  
**Workroom:** WC-9D78F369  
**Branch:** `fix/prompt-only-semantic-review-routing`

## Outcome

The governed semantic reviewer routes according to the request it actually sends. A prompt-only review does not require native tool use, and its context floor is derived from the bounded system and user prompts with explicit response and safety headroom. Confidentiality, local-only policy, robust model tier, high effort, independent reviewer branches, and fail-closed verdict handling remain unchanged.

## Grounding

- `dispatchRoutedSemanticReview` passes one user message and a system prompt to `routeAndCall`; it attaches no tools.
- The current caller nevertheless hard-codes `minimumCapabilities: { toolUse: true }` and `agentMinimumContextTokens: 32_000`.
- `inferContract` already derives `requiresTools` from a non-empty `options.tools` array. Supplying no tools is therefore the canonical no-tool contract; a caller-specific tool floor duplicates and contradicts that substrate.
- `inferContract` estimates message tokens but does not include the separately supplied system prompt. This caller must therefore add a bounded floor for both prompt components rather than retain the unrelated coworker default.
- The code graph identifies one exact colocated test file. The Workroom impact contract also requires the style-drift guard and normal source preflight.
- Live evidence on unchanged BI-SIG head `14bf816838950a794e4a8b7958c927e2b0b436cc` proves the defect: ChatGPT/gpt-5.4 is excluded only for `supportsToolUse=false`, while local Qwen3.8 27B is excluded only because 24,576 is below the static 32,000 floor.
- The first governed research handoff used five tools but exhausted that local window before writing evidence. The already-connected OpenAI Codex provider was then readied through the canonical provider UI; its active tool-capable 400k and 1M models provide the changed state required for one fresh immutable recovery attempt.

## Backlog coverage

- Decision: atomic
- Parent: `BI-47ACE2C7`
- Deliverable: prompt-only semantic-review eligibility contract -> `BI-47ACE2C7`
- Rationale: the failing contract test and its two-file routing repair are one independently revertible invariant. Splitting them would create either an unguarded behavior change or a test with no delivery value.
- Dependencies: none for source implementation. Protected deployment is the prerequisite for BI-SIG-463E478D, BI-F48D7059, and BI-A45D744A to resume.
- Receipt: pending immutable plan coverage recording.

## TDD implementation

1. In `routed-semantic-review.test.ts`, add a failing assertion that the prompt-only call supplies no tool-use floor and derives a context floor below a 24,576-token endpoint when the bounded packet fits. Add a large-packet assertion so context safety still fails closed rather than collapsing to a constant.
2. In `routed-semantic-review.ts`, compute the context floor from the actual system and user prompt lengths, reserve the routing contract's expected output, and add explicit proportional headroom. Remove the unused caller-level tool-use capability floor; leave tool requirement derivation to the canonical `options.tools` contract.
3. Refactor the context calculation into one small pure helper so the invariant is named, unit-testable through the route options, and not duplicated across reviewer branches.
4. Run the focused test red then green, web typecheck, style-drift guard, docs/index checks selected by preflight, and the full source preflight.
5. Commit the exact tree and request native semantic review once. Because this defect blocks its own reviewer, infrastructure-inconclusive evidence is disclosed rather than presented as PASS. Then run one governed exact-tree local-CI gate before publication.
6. Publish a ready PR with DCO sign-off, arm protected auto-merge, verify the protected merge and canonical deployment, then notify the BI-SIG owner to make exactly one fresh review attempt on its unchanged identity.

## Risk, blast radius, and rollback

- Risk: lowering an endpoint floor too far could select a model that cannot fit the review packet. Mitigation: derive the floor from both prompt components plus response reserve and proportional headroom, and test both fitting and oversized packets.
- Risk: removing `minimumCapabilities` could weaken a future tool-bearing review. Mitigation: this call attaches no tools; the canonical router already derives tool requirements from `options.tools`. Any future tool attachment will restore `requiresTools` through that source of truth.
- Blast radius: only semantic-review endpoint eligibility changes. Reviewer fan-out, prompt contents, parsing, findings, confidentiality, residency, quality tier, and effort do not change.
- Documentation impact: no customer, operator, install, route, or UI documentation changes. This implementation plan is the durable contributor/process record.
- Migration and UX: not applicable; no schema, migration, API, or rendered surface changes.
- Rollback: revert the single PR. The previous behavior is restored without data repair or migration.

## Completion evidence

- [ ] Focused regression test observed red before source repair.
- [ ] Focused test passes after the repair.
- [ ] Web typecheck, required guards, docs checks, and source preflight pass.
- [ ] Bootstrap semantic-review attempt is recorded honestly.
- [ ] Governed exact-tree local CI passes for the published candidate.
- [ ] Protected merge and deployment are verified.
- [ ] BI-SIG owner receives the deployment signal and records one fresh semantic-review result.
