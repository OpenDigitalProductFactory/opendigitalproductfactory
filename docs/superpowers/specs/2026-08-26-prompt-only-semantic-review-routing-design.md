---
status: active
---

# Prompt-only semantic-review routing contract

**Backlog item:** BI-47ACE2C7  
**Epic:** EP-56AE0F69  
**Workroom:** WC-9D78F369  
**Branch:** `fix/prompt-only-semantic-review-routing`

## Problem

`dispatchRoutedSemanticReview` sends a system prompt and one user prompt to
`routeAndCall` without attaching tools. The caller nevertheless requires
`minimumCapabilities.toolUse=true` and a fixed 32,000-token context window.

Live routing evidence on BI-SIG-463E478D showed that these caller-owned floors
exclude every active reviewer before inference: the local Qwen3.8 27B endpoint
has a measured 24,576-token window, while the long-context ChatGPT endpoint was
excluded only because its profile reported `supportsToolUse=false`. The route
returned infrastructure-inconclusive without a semantic finding even though
the review request itself does not use tools.

## Existing substrate

- `routeAndCall` and its contract inference remain the canonical authority for
  deriving tool-use requirements from the actual `options.tools` array.
- `dispatchRoutedSemanticReview` remains the owner of the semantic-review
  prompts, required reviewer branches, sensitivity, residency, quality tier,
  effort, parsing, and fail-closed verdict behavior.
- Endpoint capability profiles remain authoritative. This repair does not
  relabel a model or weaken provider capability checks.
- Immutable reviewer identity, independent review, exact-tree CI, DCO, and the
  protected merge path remain unchanged.

## Decision

The semantic-review route must describe the request it actually sends.

1. A prompt-only review does not add a caller-level `toolUse` requirement.
   Canonical contract inference continues to require tool use automatically if
   tools are attached in the future.
2. The route derives its minimum context requirement from both prompt
   components, plus an explicit response reserve and proportional safety
   headroom. It does not inherit the unrelated 32,000-token coworker floor.
3. The calculation is implemented as one small pure helper so the invariant is
   named and covered without duplicating routing policy across reviewer
   branches.
4. Confidential sensitivity, local-only residency policy, robust model tier,
   high effort, required Change Reviewer and specialist branches, and
   infrastructure-inconclusive behavior remain unchanged.
5. If no endpoint satisfies the resulting prompt, output, sensitivity,
   residency, tier, and effort contract, the review still fails closed with
   observable exclusion reasons.

## Trust boundaries

| Boundary | Preserved rule |
|---|---|
| Review caller -> router | The caller declares prompts and attached tools; the router derives capabilities from those concrete inputs. |
| Router -> provider | Provider capability profiles are consumed as recorded and are not rewritten to make routing succeed. |
| Prompt size -> eligibility | Both system and user prompts, response reserve, and safety headroom contribute to the context floor. |
| Endpoint selection -> verdict | Endpoint eligibility cannot turn an incomplete reviewer branch into PASS. |
| Author -> reviewer | Independent semantic review and immutable artifact identity remain required. |

## Governed scope manifest

- **OBJ-PSR-001:** Route semantic reviews from the capabilities of the concrete
  request, so a prompt-only review does not require native tool use while any
  future tool-bearing review still does.
- **OBJ-PSR-002:** Derive a bounded context floor from both prompts, response
  reserve, and proportional safety headroom instead of a fixed unrelated floor.
- **OBJ-PSR-003:** Preserve independent reviewer branches, confidentiality,
  residency, model quality, immutable evidence, and fail-closed dispositions.

| Acceptance ID | Objective IDs | Acceptance statement |
|---|---|---|
| AC-PSR-001 | OBJ-PSR-001 | A prompt-only semantic review can select an otherwise eligible long-context endpoint whose profile reports `supportsToolUse=false`. |
| AC-PSR-002 | OBJ-PSR-001 | Attaching any tool restores the canonical tool-use capability requirement. |
| AC-PSR-003 | OBJ-PSR-002 | A bounded prompt that fits within a 24,576-token endpoint is not rejected by a fixed 32,000-token floor. |
| AC-PSR-004 | OBJ-PSR-002 | An oversized prompt remains ineligible; the repair cannot collapse context safety to a permissive constant. |
| AC-PSR-005 | OBJ-PSR-003 | All required reviewer branches remain mandatory and incomplete execution is infrastructure-inconclusive, never PASS. |
| AC-PSR-006 | OBJ-PSR-001, OBJ-PSR-002, OBJ-PSR-003 | Focused tests, typecheck, source preflight, independent semantic review, exact-tree local CI, DCO, protected merge, deployment, and one live routing verification succeed. |

## Blast radius and rollback

The source boundary is limited to
`apps/web/lib/change-review/routed-semantic-review.ts` and its colocated test.
The only behavioral change is endpoint eligibility for this semantic-review
route. Prompt contents, branch fan-out, findings, parsing, authorization,
confidentiality, residency, and verdict semantics do not change.

No schema, migration, API, UI, customer documentation, or operator workflow is
affected. Reverting the delivery commit restores the previous eligibility
contract without data repair.

## Non-goals

- Changing global coworker context floors or model profiles.
- Enabling providers, changing credentials, or changing pricing policy.
- Modifying BI-SIG immutable traversal or terminal-writer behavior.
- Weakening confidentiality, residency, reviewer independence, or fail-closed
  review semantics.
- Fabricating a readiness or semantic-review receipt to bootstrap this repair.

## Implementation plan

See
[`../plans/2026-08-26-prompt-only-semantic-review-routing.md`](../plans/2026-08-26-prompt-only-semantic-review-routing.md).
