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
- The first governed research handoff used five tools but exhausted that local
  window before writing evidence. A later current-source preview ran the
  canonical forced dimension evaluator for the approved local Qwen3.8 27B
  route. Persisted run `DE-E6344F87` measured reasoning `90`, codegen `100`,
  tool fidelity `100`, and native tool use, while the served engine reports a
  262,144-token context window. Exact route preview then selected that model
  for `external-mcp`. This is a material provider-state change and the
  authority for one new immutable recovery attempt; no model score or policy
  floor was hand-edited.
- The same preview produced direct reader-bound evidence from BI-42 spec review
  TaskRun `TR-MCP-Y210YXRramppMDAwMHoyazd4eDVmbnYydg-DA9AFCAFA98F`:
  `read_source_at_version` executed successfully twice, but only the first
  design section reached the reviewer. Its subsequent governed writer proposal
  failed closed because it combined `decision=pass` with a finding about that
  truncation. No receipt or baseline was written. This independently confirms
  that BI-SIG's immutable pagination/terminal-writer repair is the bounded
  bootstrap prerequisite; it does not count as BI-47 research approval.

## Backlog coverage

- Decision: atomic
- Parent: `BI-47ACE2C7`
- Deliverable: prompt-only semantic-review eligibility contract -> `BI-47ACE2C7`
- Rationale: the failing contract test and its two-file routing repair are one independently revertible invariant. Splitting them would create either an unguarded behavior change or a test with no delivery value.
- Dependencies: none for source implementation. Protected deployment is the prerequisite for BI-SIG-463E478D, BI-F48D7059, and BI-A45D744A to resume.
- Receipt: pending the independent `spec-approval` baseline and immutable plan coverage recording.

### Four-way traceability

The single atomic deliverable covers all baseline objectives and acceptance
statements. These identifiers are repeated verbatim so the coverage writer can
bind the immutable plan to the approved scope.

- Requirements: `OBJ-PSR-001`, `OBJ-PSR-002`, `OBJ-PSR-003`
- Contracts: `CONTRACT-PSR-001` (request capabilities come from the concrete
  tool surface), `CONTRACT-PSR-002` (context eligibility includes both prompts,
  response reserve, and proportional headroom)
- Flow: `FLOW-PSR-001` (`dispatchRoutedSemanticReview` constructs the bounded
  prompt-only contract, `routeAndCall` selects an eligible endpoint, and the
  existing reviewer fan-out produces the fail-closed disposition)
- Verification: `AC-PSR-001`, `AC-PSR-002`, `AC-PSR-003`, `AC-PSR-004`,
  `AC-PSR-005`, `AC-PSR-006`

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
- [x] Bootstrap attempts are recorded honestly: the current-main BI-SIG preview
  supplied the exact immutable reader/writer surface, but TaskRun
  `TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-B48A7E92B214` stopped before
  inference with zero tool executions and no receipt because no model was
  eligible at that instant. The consumed request key will not be reused.
- [x] A material provider-state change is proven independently: governed
  EndpointTestRun `TR-D6491A4E` completed against the exact local Qwen3.8 27B
  model with 8/8 probes passing, including native tool calling.
- [x] A newer canonical dimension evaluation is persisted as `DE-E6344F87`
  with reasoning `90`, codegen `100`, tool fidelity `100`, tool use enabled,
  and exact-route selection of the local 27B model. BI-42 TaskRun
  `TR-MCP-Y210YXRramppMDAwMHoyazd4eDVmbnYydg-DA9AFCAFA98F` proves the model
  can execute the immutable reader; its writer failed closed on pass-plus-
  finding after truncated source, so the occurrence remains evidence rather
  than a receipt.
- [x] The first scope-manifest spec-review identity
  `TR-MCP-Y210YXZuNWh5MDAwMGt2cDhnNmgyeWFudQ-15059785C93E` completed with one
  failed `read_source_at_version` and no writer or receipt because the isolated
  preview clone had not fetched commit `c067142f770478d8ad548d6e3b929d79381c7706`.
  The clone now resolves that exact commit and design blob
  `5ac674c03be1b21a335ea5b8607125f830e673a5`; the consumed request key will not
  be reused.
- [x] The next exact identity
  `TR-MCP-Y210YXcyc3pxMDAwMDFscDg4N2EyMnZ6ZA-BD059B8D9CDD` successfully read
  the full 110-line design at commit
  `4cf2f2181463457b78d5a217305dc684f717d8e9` in six persisted immutable reader
  executions, independently selected `decision=pass`, and proposed exact
  envelope `cmtaw9xbz005b4pp8ucwer4ad` for
  `record_initiative_design_review`. The external request client then reached
  its headers deadline and revoked the short-lived token before the approved
  same-TaskRun replay could occur. The proposal was cancelled through the
  supported envelope state machine; no writer receipt or baseline was
  inferred, and that request key will not be reused.
- [ ] Governed exact-tree local CI passes for the published candidate.
- [ ] Protected merge and deployment are verified.
- [ ] BI-SIG owner receives the deployment signal and records one fresh semantic-review result.
