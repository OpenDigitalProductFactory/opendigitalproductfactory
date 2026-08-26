---
status: active
---

# Installation Estate Identity — Implementation Plan

- **Design:** `docs/superpowers/specs/2026-08-25-installation-estate-identity-design.md`
- **Epic:** `EP-1FABA22D`
- **Workroom:** `WC-DF6943D2`
- **Branch:** `feat/installation-estate-identity-header-badge-mcp-se`

> Deferred work lives in backlog items, not in this file. Every independently
> shippable deliverable below is a live `BI-*`. This plan describes sequence and
> risk; it is not a task store.

## Delivery shape

The founder directed a single branch rather than four, because the CI/CD merge
path is currently unreliable and each additional PR multiplies the exposure to
that. `AGENTS.md` section 3 prefers one concern per PR; this is a deliberate,
recorded exception, not an oversight.

The mitigation is that each phase below is **one commit with its own tests**, so
the branch can be split into four PRs later without archaeology if the queue
recovers before this lands.

## Backlog coverage

- Decision: multi-item, one branch
- Repair the workspace front page -> `BI-7626A660`
- Make the MCP handshake state its installation -> `BI-C7151B1B`
- Revive peer discovery and pre-fill the estate name -> `BI-6052C2C2`
- Repair self-declarative copy and the incentive behind it -> `BI-06005FE0`
- Dependencies: phases 2 to 5 all depend on phase 1
- Rationale: all four reported defects are consumers of one missing primitive
  (installation identity). Building the primitive once and landing its consumers
  together is what keeps it a single source of truth; splitting them would ship
  three surfaces that each re-derive identity.

## Sequencing

```
  Phase 1 ── estate identity primitive + resolver (BI-7626A660)
      |
      ├──▶ Phase 2 ── header badge + panel demotion   (BI-7626A660)
      ├──▶ Phase 3 ── MCP self-identification         (BI-C7151B1B)
      ├──▶ Phase 4 ── copy repair + prose-lint rule   (BI-06005FE0)
      └──▶ Phase 5 ── edge node + discovery pre-fill  (BI-6052C2C2)
```

Phases 2 to 4 are independent of each other and may land in any order. Phase 5 is
last because it is the only one that cannot be fully verified on a single
installation.

## Phase 1 — The primitive (`BI-7626A660`)

Add `packages/db/src/installation-estate-identity.ts`: pure types, the closed
`source` vocabulary, and a total validator for the name grammar. No database
access, mirroring `installation-operating-intent.ts`.

Add `apps/web/lib/install/estate-identity.ts` for the precedence chain, mirroring
`environment-class-contract` so the two halves of the badge resolve the same way.

Add `resolveInstallationIdentity()` returning the section 5.2 shape.

**Risk:** the resolver reaches installer state through `node:fs/promises`. It must
stay out of any module a client component imports for a value. Phase 2 is where
that bites.

**Verification:** unit tests for the grammar, every precedence branch, and the
unset state.

## Phase 2 — Badge and demotion (`BI-7626A660`)

Resolve identity in `apps/web/app/(shell)/layout.tsx` (already a server component
that resolves org and branding) and pass a plain serialisable prop to `Header`.

Render the badge only when the class is not `production`. Reuse the existing badge
styling on the logo line; no new colors, per `AGENTS.md` section 9.

Remove `InstallationIdentityPanel` from `apps/web/app/(shell)/workspace/page.tsx`
and add `apps/web/app/(shell)/ops/installation/page.tsx` rendering it, with the
badge linking there.

**Risk — the one that only the production build catches:** importing anything that
reaches `node:fs/promises` into `Header.tsx` breaks the build with "the chunking
context does not support external modules". Typecheck and vitest both pass while
this is broken. `pnpm --filter web build` is mandatory before this phase is called
done.

**Risk:** removing the panel changes the workspace home word count, which is a
measured UX budget. `workspace/page.test.tsx` asserts the panel is present and
must be updated in the same commit.

**Verification:** header tests for all four badge states; workspace page test
proving the panel is gone; new ops route test; production build.

## Phase 3 — MCP self-identification (`BI-C7151B1B`)

Slugify the estate name and compose `serverInfo.name` with the documented
fallback chain. Add the `INSTALLATION:` line to `formatInstanceStanceBriefing`.

Move device-ID minting out of the lazy federation read so identity resolves on a
never-federated install.

**Risk:** `formatInstanceStanceBriefing` output is consumed by agents as a
behavioural contract, and the same rationale strings are reused by the portal
panel. Changing them changes two audiences at once; phase 4 must agree with it.

**Risk:** `buildMcpInitializeResult` is fail-open by design — every compose step is
individually caught so a failure degrades the briefing rather than the handshake.
The new identity lookup must preserve that, not introduce a throw.

**Verification:** initialize tests covering named, unnamed, and production installs;
a test proving identity resolves with no `federation.identity` row present.

## Phase 4 — Copy and the incentive (`BI-06005FE0`)

Rewrite `buildIdentityHeadline`, the panel heading, and the stance rationales in
`packages/db/src/installation-instance-stance.ts`.

Sweep for the same pattern: headings of the form "What this X is", standalone
`A <adjective> <noun>.` fragments, and `Its <noun>:` colon-fragments.

Decide and record whether `scripts/check-prose-lint.ts` gains a body-copy fragment
rule. Without it the style regrows, because the reading-grade cap still rewards it.

**Trap:** running the prose-lint baseline with `--update` retightens roughly 40
untouched files. Splice only the entries for routes this branch changed.

**Verification:** the UX budget test for the identity surface still passes, proving
the natural-language rewrite did not cost reading grade.

## Phase 5 — Edge node and discovery pre-fill (`BI-6052C2C2`)

Provision an Edge Node with `federation.discovery` by default, and add the estate
name to the mDNS TXT record in `services/edge-node-go/internal/federation`.

Pre-fill the estate name from a discovered peer at first boot, operator-confirmed.

**Honest limitation, stated up front:** acceptance criterion 5 requires two
installations on one LAN. This installation is the only one running, so phase 5
can be unit- and contract-tested here but **cannot be end-to-end verified in this
pass**. If it lands unverified, it lands labelled unverified — per `AGENTS.md`
section 10, a skipped step is reported as skipped.

Wiring `evaluateOrganizationEnrollment` to a production caller is adjacent and
tempting, and is deliberately **out of scope**: it is the zero-touch design's own
work, it carries real trust consequences, and folding it into an already-oversized
branch is how a trust boundary gets reviewed carelessly.

## Gate

Per `AGENTS.md` section 4, all four apply:

1. `pnpm --filter @dpf/db exec vitest run` and `pnpm --filter web exec vitest run`
   for affected files.
2. `pnpm --filter web build` — mandatory, and load-bearing for phase 2.
3. UX verification against the running portal for the badge, the workspace home,
   and `/ops/installation`.
4. No migration is added; the estate record is `PlatformConfig`, so criterion 4 is
   not applicable and is recorded as such rather than skipped silently.

---

## Delivery record (2026-08-25)

Written at the end of the implementation pass. It states what landed and what did
not, so the next reader does not have to infer it from commits.

### Landed

| Phase | Item | Evidence |
| --- | --- | --- |
| 1 | Estate identity contract, precedence chain, resolver | 43 unit tests |
| 2 | Header badge, panel demoted to `/ops/installation` | 8 badge tests, workspace assertions inverted, production build |
| 2b | Ratified page-purpose contract for the new route | identity ratchet passes, 13 ratified routes |
| 3 | MCP `serverInfo` per installation + `INSTALLATION` briefing line | 8 handshake tests |
| 4 | Copy rewritten off self-declarative fragments | reading grade **6.6** against a cap of 9 |
| 5 | Operator field to set the estate name | 9 action tests |
| — | `prose-is-not-a-control-gate` kernel commandment | golden-decisions guard passes at margin 0.3152 |

### NOT landed, and why

- **Edge Node provisioning and mDNS estate-name pre-fill (`BI-6052C2C2`).** Not
  started. The prerequisite is an Edge Node carrying `federation.discovery`, which
  this installation does not run at all (`EdgeNode` = 0 rows), and acceptance
  criterion 5 needs two installations on one LAN. It could have been written
  blind and could not have been verified, so it was left rather than shipped
  unproven.
- **`evaluateOrganizationEnrollment` still has no production caller.** Out of
  scope by design (plan Phase 5) and unchanged.
- **The prose-lint fragment rule (`BI-06005FE0`).** The copy is fixed; the
  incentive that produced it is not. Without a rule the style regrows, because
  the reading-grade cap still rewards fragments.
- **Envelope expiry observability (`BI-78D3CF1E`).** Still open.
- **`request_coworker` timeout-versus-parked reporting (`BI-B9312D74`).** The
  traps are now documented in the backlog-and-planning runbook; the tool
  behaviour is unchanged.

### Gate status

1. Unit tests — pass for every affected package.
2. Production build — `pnpm --filter web build` compiles, `/ops/installation`
   present, no client-bundle regression.
3. **UX verification — NOT performed.** AGENTS.md §4.3 wants the path exercised
   against the running app; the running portal is a released image and these
   changes are branch-only. This is a real gap, not a formality: the badge's
   placement and the panel's new home are exactly the kind of thing a test cannot
   confirm looks right.
4. Migration — not applicable. The estate record is `PlatformConfig`, so no
   migration was added.

### Governance note

Implementation proceeded under an explicit founder waiver of `RESEARCH_REQUIRED`
and `PLAN_REQUIRED`, recorded on `WC-DF6943D2`. The reviewer coworker
(`AGT-WS-PORTFOLIO`) did evaluate the design and returned `decision: pass`; it
could not record that because three successive approval envelopes expired
unactioned. The waiver's original premise — that no approval surface existed —
was **wrong** and is corrected on `BI-78D3CF1E`.
