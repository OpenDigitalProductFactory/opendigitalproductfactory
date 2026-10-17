---
status: active
---

# Candidate worktree binding for sandbox admission

Date: 2026-10-17. Implementation owner: **BI-A254A94C**. Workroom:
**WC-35857ACB**. Delivery shape: `delivery-small@1.0.0`; readiness profile: `fix`.

## Problem and observed evidence

The existing documentation exemption is the intended policy. This repair binds
its inputs to the candidate that `gate-worktree` actually receives; it does not
change which paths are exempt or create an alternative gate.

At source `305c5e2af8d446c4e263cf96d90fad41c82fc5a2`,
`scripts/gate-worktree.mjs:1723` calls `sandboxDecisionForHead()` without the
selected worktree or configured Git executable. That helper defaults to its
module's repository (`scripts/derived-artifacts-gate.mjs:188-198`), as does its
artifact checker (`267-285`). A gate invoked from one checkout for another
candidate can classify and check the invoking checkout instead.

Before source edits, `node --test scripts/gate-worktree-resume.test.mjs` on that
commit produced 2 passes and 1 failure: AC-DW-01 expected cancellation exit 81,
but returned documentation-exempt exit 0 before claiming. Evidence:
`cmvd1jeqr1ah301nqoxdj6xwy`. The two source-drift controls passed. The same symptom
appears in PR 6476's actual Policy Guards (source) job, alongside lifecycle
contract failures. That CI result remains failed until repaired and rerun.

The fixtures are also incomplete: both the resume README fixture and the Node
contract's code fixture set `origin/main` to their only commit. Their candidate
diff is therefore empty. A direct helper probe confirmed empty diff means
`claim: false`, while a `code.ts` delta means `claim: true`. Binding the correct
candidate alone cannot make these empty fixtures exercise admission. Fixture
repairs must add an actual committed code delta after the base, rather than
disable classification. No evidence indicates a real cancellation or queue
policy failure: the failing case never reaches that boundary.

## Contract and scope

- **R1 / C1:** `sandboxDecisionForHead` uses the selected candidate worktree and
  configured Git executable for merge-base and changed paths. Its default
  behavior remains compatible for ordinary callers in the module checkout.
  When the gate supplies an expected candidate SHA, a different or unreadable
  worktree HEAD cannot establish exemption for that requested candidate.
- **R2 / C2:** affected artifact checks run in that same selected worktree;
  another checkout's generated output cannot establish candidate freshness.
- **R3 / C3:** an unresolved merge base or unreadable diff returns an inconclusive
  classifier result and continues ordinary gated admission. It must not become
  an empty diff or an exemption. Existing resume/finalization behavior remains.
- **R4 / C4:** tests expecting a lease, cancellation or execution use a real
  post-base code change. Documentation-only candidates retain their existing
  exemption; no test-only policy bypass is introduced.

**F1:** explicit candidate and Git executable -> candidate merge base/diff ->
existing exemption predicate -> candidate artifact checks -> sandbox decision ->
existing lease/execution/evidence flow. A classifier failure continues that flow.

The atomic change touches the two production scripts and their existing derived,
resume, Node and shell contract tests. There is no migration, grant change,
runtime deployment, new service, provider call or alteration to the registry's
path policy. Ordinary same-worktree documentation evidence is not invalidated by
this cross-worktree defect.

## Ordered implementation and verification

1. **V1 — Red:** add a real temporary-repository regression through the production
   helper, using distinct candidate and invoking repositories. Assert that a code
   candidate requires admission despite a documentation invoking checkout, and a
   documentation candidate is classified independently of unrelated invoking
   code. Add a real checker whose result depends on candidate-local content.
   Assert that Git failure and a requested SHA/HEAD mismatch remain inconclusive.
   Observe failure before the fix.
2. Bind the helper's Git and checker execution to the explicit candidate; pass
   the existing gate's `worktreePath` and `gitBin`. Preserve null versus empty
   output and existing environment/path handling. Reuse existing Git helpers.
3. **V2 — Lifecycle:** repair empty fixtures with a real post-base code commit.
   Run resume contracts and both Node/shell gate contract suites. Confirm
   cancellation remains exit 81, no replacement claim occurs, and normal code
   execution writes its expected evidence rather than documentation-exiting.
4. **V3 — Regression:** run the full derived-artifact suite, related Git tests,
   documentation/index checks and applicable host guards. Remove the new binding
   temporarily in a private test copy or equivalent controlled regression check
   to demonstrate that the regression actually detects the wrong-repository path.
5. **V4 — Delivery:** obtain independent review of the committed diff, run the
   canonical exact-tree integration gate, publish a DCO-signed ready PR, inspect
   required CI and merge through the protected queue. After the fix is on main,
   rerun the affected publication CI and retain the real result. A source-local
   pass alone is not CI restoration or runtime acceptance.

The claimed-path impact contract is resolved and names no additional test impacts
or guard obligations. It requires normal preflight, exact-tree integration and
PR health, and lists the derived document index. The dated design is excluded
from the public corpus; check the index and include a generated change only if
one actually results. Missing graph advice does not exempt the explicit suites.

## Backlog coverage

One atomic deliverable maps to **BI-A254A94C**. Requirements R1-R4, contracts
C1-C4, flow F1 and verification V1-V4 above form its four-way traceability.
The production binding and truthful fixture corrections must land together:
neither a source fix with fixtures that no longer exercise admission nor tests
that hide the wrong-candidate behavior are independently acceptable deliveries.
Record immutable coverage against this implementation item before code changes.
The live receipt is authoritative; this paragraph is not a receipt.

Research receipt: `initiative-6e83f600-6bad-45ef-ad58-5d2591732b2e`, bound to the
provider-verified current source blob and the actual pre-edit reproduction above.

## Risks and rollback

The main risks are accidentally widening exemptions, swallowing Git failures as
empty output, checking freshness in another checkout, and contract tests masking
the real path with a stub. Test each explicitly. Preserve current checker outcome
classification and legacy default behavior. Revert the PR to roll back; no data
or live runtime state is changed by the source repair itself.
