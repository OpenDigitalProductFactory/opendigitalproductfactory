---
status: binding
---

# Installation Identity Declaration Surface

| Field | Value |
| --- | --- |
| Date | 2026-08-22 |
| Epic | `EP-1FABA22D` — Purpose-Aware Installation and Ecosystem Productivity |
| Surface | `/workspace` installation-identity panel, `PlatformConfig`, server actions |
| Owners | Platform installation lifecycle, workspace home |
| Related | `2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md`; `2026-08-22-installation-identity-and-agent-stance-design.md`; `2026-08-22-governed-installation-teardown-design.md` |
| Prototype | `docs/superpowers/mockups/2026-08-22-installation-identity-declaration.html` |

## 1. Decision

An operator shall be able to read and correct the **whole** installation identity
from the portal, and shall be able to see the stances that identity produces
together with the reason for each one.

`2026-08-22-installation-identity-and-agent-stance-design.md` made the identity
matter: it resolves four brakes that every agent-facing surface honours. It left
three gaps, all of them operator-facing:

1. `InstallationPurposePanel` was a bare `<select>` for `primaryPurpose`. There
   was no surface for `environmentClass` or `pairedProductionInstallationRef`,
   so correcting a wrong identity meant re-running the installer or editing
   `PlatformConfig` by hand.
2. `environmentClass` was settable only through the new `-EnvironmentClass` /
   `--environment-class` installer flag.
3. The resolved `InstanceStanceProfile` — what agents may actually do here — was
   visible nowhere in the portal, so a brake could be in force with no way for
   the operator to see it, let alone see why.

This design closes all three inside the existing workspace panel. It adds no
route, no navigation item, and no database table.

## 2. Current repository truth

Verified on this repository on 2026-08-22, against
`feat/instance-identity-and-purpose` (PR #4474), which this change is stacked on:

- `apps/web/components/workspace/InstallationPurposePanel.tsx` rendered one
  `<select>` and one confirm button, and unconditionally stored
  `confirmation.status: "confirmed"` with `confidence: "high"` on every save.
- `confirmInstallationOperatingPurpose` was that panel's only writer, and the
  panel was its only caller.
- `resolveInstanceStance` and its `rationale` strings had exactly one consumer,
  the MCP `initialize` briefing. A repository-wide search found no portal reader.
- Nothing anywhere resolved an environment class other than
  `readInstallEnvironmentClass`, which reads installer state alone. The
  precedence order the parent design fixes in §4.4 existed only as a sentence in
  that document.
- `/workspace` carries `sweepEligible: false` in
  `apps/web/lib/ux-budget/route-purpose.generated.json`
  (`sweepExclusionReason: wall-clock-collection`), so it is outside the rendered
  UX-budget sweep. The panel still follows the parent design's §11.1 first-
  viewport rules, because the sweep's absence is a measurement gap and not a
  licence.

## 3. Authority and precedence

The parent design's §4.4 fixes the order; this change is the first code to
implement it, in `apps/web/lib/install/environment-class.ts`:

| Rank | Tier | Written by | Read from |
| --- | --- | --- | --- |
| 1 | `process-override` | the runtime deployment | `DPF_ENVIRONMENT_CLASS` |
| 2 | `installer-state` | `install-dpf.sh` / `install-dpf.ps1` | `/dpf-state/install-state.json` |
| 3 | `portal-declaration` | this panel | `PlatformConfig installation.environment-class.v1` |
| 4 | `default` | nobody | `UNDECLARED_ENVIRONMENT_CLASS` (`production`) |

**The portal never writes installer state.** It writes the derived-projection
tier, which ranks below the host fact. Local drift is repaired *from* installer
state, never into it, exactly as §4.4 requires.

A declaration that a higher tier overrules is not discarded and not silently
ignored. It is recorded, reported as `shadowedPortalDeclaration`, and shown to
the operator with the winning value and the installer flag that would change it.

### 3.1 Why a shadowed declaration is not confirmed

`confirmation.status` describes the identity record, and the record is only
trustworthy when it matches the identity in force. So when the declared
environment is shadowed, `declareInstallationIdentity` stores the declaration
with `status: "needs-review"` and `confidence: "medium"`, and appends an evidence
entry naming the disagreement. The panel then shows "Needs review" and explains
it. This is the concrete form of the parent design's §5.3 rule that a change sets
`confirmation.status` appropriately rather than silently re-confirming.

## 4. The material-change contract

Parent design §5.3 and §13.3: a material identity change requires an impact
preview and explicit confirmation.

A change is **material** when any of `primaryPurpose`, `environmentClass`, or
`pairedProductionInstallationRef` differs from the identity in force. A
whitespace-only edit to the pairing is not a change.

`buildInstallationIdentityImpact` derives the preview; it never hand-writes it.
It resolves `resolveInstanceStance` twice — once for the identity in force and
once for the identity proposed — and reports:

- the field diff in plain language;
- the stance diff, each row carrying the resolver's own post-change `rationale`
  and a direction computed from a caution rank rather than asserted per
  transition, so a new stance value cannot be reported as "no change";
- the evidence that goes stale, restricted to the non-human sources that derived
  a field which actually changed (per `deriveExistingInstallIntent`);
- warnings for every loosened brake, for a change in who may fund, and for a
  dropped pairing.

Existing evidence is never deleted. A superseded inference stays in the record as
history; the preview is what tells the operator it no longer describes the
install.

### 4.1 Explicit confirmation is enforced, not requested

The preview carries a `previewToken`: a sha256 over both the identity in force
and the identity proposed. `declareInstallationIdentity` recomputes it from the
current state and refuses any material change whose token does not match,
returning the fresh preview instead of writing.

That makes the confirmation a real guarantee rather than a checkbox. Editing a
field after previewing invalidates the token, and so does another operator's
change landing between the preview and the confirm.

A non-material save needs no token: confirming a `suggested` record is a real
act, and it is not a change. A non-material save against an already-confirmed
record that matches writes nothing at all, so opening the panel cannot restamp a
timestamp or grow the evidence log.

## 5. Experience design

**UX-fit decision:** fits-with-guardrails, inherited from the parent design
§11.5. Owning area Workspace, canonical home `/workspace`, contextual actions
only, no navigation change.

The panel replaces `InstallationPurposePanel` at the same mount point, still
behind `manage_platform`. Its read view is:

1. one sentence naming what this installation is, including the cautious default
   stated in words rather than as a blank field;
2. the pairing and the environment's authority, when either has something to say;
3. four stance rows, each with its resolver rationale, so a brake is explained
   rather than asserted;
4. one sentence stating that a stance is a brake and never a permission.

Everything else — the three form fields, the impact tables, the stale-evidence
list — sits behind a single `ExpandableCard` disclosure. Composition reuses
`ui/Button`, `ui/Surface`, `report-kit` `Notice`/`StatusBadge`/`ExpandableCard`,
and `form/SelectField`/`TextField`. No new status-color map, card family, or
empty-state dialect is introduced.

Every visible string is produced by `installation-identity-view.ts` or by the
stance resolver's own `rationale`, honouring §11.5's "no visible status may be
computed independently in a component".

### 5.1 AI boundary

Declaring identity saves governed configuration and sends no prompt. The panel
starts no coworker work.

## 6. Non-goals

- No new Prisma model or table.
- No portal write to installer state, and no installer change.
- No teardown execution. This surface shows the teardown brake; the governed
  teardown design owns acting on it.
- No new agent-facing tool. `operating_profile_get` remains the external agent
  operating contract design's.
- No change to federation trust, GAID, TAK, or JSI. Dropping a pairing records
  intent; revoking a `FederationLink` stays its own governed action.

## 7. Acceptance criteria

1. The precedence chain resolves in the documented order, and an override
   outside the closed vocabulary is ignored rather than honoured.
2. A portal declaration that a higher tier overrules is reported as shadowed,
   with the winning tier and value; agreement is not reported as drift.
3. Every read fails toward the cautious default, and one failed read does not
   discard the others.
4. The panel shows all four stances with the resolver's rationale for each.
5. A material change without a matching preview token is refused, and the
   refusal returns the fresh preview.
6. Editing a field after previewing withdraws the confirm control.
7. A shadowed environment declaration stores `needs-review`, not `confirmed`.
8. A non-material save against a matching confirmed record writes nothing.
9. Only the non-human evidence that derived a changed field is reported stale,
   and no evidence is deleted.
10. Both writes land in one transaction, and neither of them is installer state.

## 8. Decision record

- **Portal writes the projection tier, not installer state.** Writing
  `install-state.json` from the portal would give one fact two writers and race
  the installer and the self-upgrade loop. Recording a lower-ranked declaration
  and reporting the disagreement keeps one writer per tier.
- **A shadowed declaration is stored, not rejected.** Refusing it would lose the
  operator's stated intent, which is the thing a later installer run should
  honour. Storing it as `needs-review` keeps the intent and the honesty.
- **The preview token binds the confirmation.** A boolean "I confirm" flag would
  be satisfiable without a preview ever being rendered. Recomputing a hash of
  both sides makes the guarantee mechanical, and makes a concurrent change fail
  loudly instead of silently overwriting.
- **The impact is derived from the resolver, not written by hand.** Hand-written
  consequence copy is the failure mode the panel replaces: the old panel's one
  sentence about funding was the only consequence it could state, and nothing
  kept it true. Resolving the stance twice cannot drift from the stance an agent
  is given.
- **Direction comes from a caution rank.** Asserting "tightens" per transition
  would silently report a newly added stance value as unchanged.
- **Stale evidence is reported, never deleted.** The evidence log is provenance.
  Removing a superseded inference would destroy the record of why the
  installation once believed something else.
- **Extend the panel, do not add a route.** The parent design's §11.5 puts this
  in Workspace with no navigation change, and a net-new route would add a
  UX-budget surface for content that belongs beside the identity it describes.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-08-08-purpose-aware-installation-ecosystem-productivity-design.md`
    §4.3 authority matrix, §4.4 persistence and precedence, §5.3 change and
    drift, §11.1–§11.5 experience design, §13.3 profile changes.
  - `docs/superpowers/specs/2026-08-22-installation-identity-and-agent-stance-design.md`
    §4 safety invariants, §5 contracts, §6 archetype generality.
  - `docs/superpowers/specs/2026-08-22-governed-installation-teardown-design.md`
    for the teardown boundary this surface must not cross.
- Current code substrate reviewed:
  - `packages/db/src/installation-instance-stance.ts` — the four stances, their
    closed vocabularies, and the rationale strings this panel renders.
  - `packages/db/src/installation-operating-intent.ts` — the stored contract, its
    validator, and `UNDECLARED_ENVIRONMENT_CLASS`.
  - `apps/web/lib/install/instance-stance.ts` — the composition entry point and
    its fail-cautious reads.
  - `apps/web/lib/installation-journey/operating-intent.ts` —
    `deriveExistingInstallIntent`, which fixes which evidence source derived
    which field.
  - `apps/web/lib/install/host-profile.ts` — source capability, which stays a
    host fact and not a purpose.
  - `apps/web/components/ui/{Button,Surface}.tsx` and
    `apps/web/components/ui/report-kit/` — the primitives the ratchet requires.
  - `apps/web/lib/ux-budget/route-purpose.generated.json` — `/workspace` sweep
    eligibility.
- Source of truth:
  - the §4.3 authority matrix plus the §5.4 addendum in the stance design; the
    resolved stance is a derived projection and is never persisted.
- Decision:
  - extend the existing workspace panel; write the environment declaration to
    the derived-projection tier only; derive the impact preview from the stance
    resolver; enforce confirmation with a recomputed preview token.
