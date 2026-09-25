---
status: binding
---

# Refusals Name the Real Cause

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Items | `BI-860A9668`, `BI-9D327C32` |
| Surface | federation join issuance; backlog completion transition |
| Profile | fix |

## 1. Decision

**A refusal must name the thing the caller can change.** Two refusals on this
platform named something else, and both were measured costing real time on live
work.

They are one defect in two places. In each, a check that could not tell two
situations apart let execution continue to a *later* failure, and the later
failure's message — accurate about itself — was wrong about the cause. The
caller then acted on the wrong lever: hunting a broken CA that was fine, or
dispatching a reviewer who could not have helped.

The fix in both cases is the same shape: **decide the thing you actually know,
as early as you know it, and say it.**

## 2. The two refusals, measured

### 2.1 A member told its CA is unreachable (`BI-860A9668`)

`issueOrganizationJoinFile` gates on `membershipRelayAvailable`, which
establishes only that an organization root PEM and a provisioner password are
**readable**. A member holds both — the root because it pinned the authority's
root when it joined, and a provisioner password because every installation
ships its own step-ca. So the authority check passes on a member, execution
reaches the CA call, and the failure surfaces as:

```
Join file not issued: ca-unreachable (unable to get local issuer certificate)
```

That reads as an outage. It is a role mismatch, and the code already has the
right reason code — `not-the-authority` — which was simply never reached.

What makes it undiagnosable rather than merely wrong: measured on the
development install, the local step-ca serves a complete chain ending at a root
whose subject is `O=DPF Organization CA, CN=DPF Organization CA Root CA`, and
the pinned organization root's subject is **character-for-character the same**.
Only the SHA-256 differs (`4127D884…` local, `32BBEE9A…` pinned). An operator
comparing names sees a match and concludes the CA is broken.

### 2.2 An author told to dispatch a reviewer (`BI-9D327C32`)

In a completion manifest, `ux: verified` and `migration: verified` are not
assertions — they are **promises to cite evidence**. `validateApplicability`
adds that dimension to the required set, and citing no `ux_verified` /
`migration_pass` activity fails the manifest.

That failure then disappeared. A merge through branch protection passes the
DELIVERY dimension on its own (`BI-B04A0203`), so the manifest's blockers were
dropped; `smallShapeAcceptance`, which requires `verdict.allowed`, silently went
false. What the author saw was `ACCEPTANCE_EVIDENCE_REQUIRED` and *"a medium
item owes an independent acceptance receipt… a coworker qualifies"*, alongside
`reviewerRoutes: []` — told to dispatch a reviewer for a defect only they could
fix, and given no route to dispatch one.

Measured on `BI-1F69D3F8`: two refusals (`IRD-988D9DAA8675`,
`IRD-7069DD2C59B8`), then **one `ux_verified` row added and nothing else
changed** → `IRD-94AE30934F5C` allowed. Four coworker dispatches were spent
before that, chasing a defect no reviewer could have resolved.

## 3. Contracts

**Join issuance.** Membership is the discriminator and needs no socket: an
authority never imports a join file, so it never has a
`federation.membership.v1` facts row. An installation that has one is a member,
and the row already carries `caUrl` — the address to send the operator to.
`issueOrganizationJoinFile` reads it before the relay check and returns
`not-the-authority` with that address in `detail`.

**Completion transition.** `unreadManifestReasons` carries the manifest's own
blockers onto the requirements the caller is being asked about, whether or not a
merge has excused the delivery dimension. The merge may excuse a dimension; it
must never silence a manifest the author can correct.

## 4. What this deliberately does not change

- The merge-through-gates recognition of `BI-B04A0203` stands. Delivery still
  passes on a merged item; only the *silence* is removed.
- No refusal becomes an approval. Both changes add or correct **text and
  routing**, never a verdict.
- Two CAs may still share a subject name. Naming them apart is a separate
  concern; this change makes the platform say which role *this* installation
  holds, which is what the operator needs first.

## 5. Objectives and acceptance

1. **OBJ-NAME-THE-LEVER:** A refusal names the condition the caller can act on,
   not a downstream symptom of it.
2. **OBJ-DECIDE-LOCALLY-FIRST:** A role or precondition knowable from local
   facts is decided before any network call that could fail for another reason.
3. **OBJ-NO-SILENT-MASKING:** A relaxation that excuses one requirement never
   suppresses a diagnosis the caller needs for another.

| Criterion | Objectives | Statement |
| --- | --- | --- |
| AC-MEMBER-TOLD-ITS-ROLE | OBJ-NAME-THE-LEVER, OBJ-DECIDE-LOCALLY-FIRST | On an installation holding a membership facts row, `issueOrganizationJoinFile` returns `not-the-authority` naming the authority's `caUrl`, and opens no connection to any CA. |
| AC-AUTHORITY-UNCHANGED | OBJ-DECIDE-LOCALLY-FIRST | An installation with no membership facts row still issues a join file exactly as before. |
| AC-MANIFEST-NAMES-ITSELF | OBJ-NO-SILENT-MASKING, OBJ-NAME-THE-LEVER | When the completion manifest does not pass, the refusal states that the manifest failed, names the missing dimension, and attributes the correction to the author — including when a merge has already passed the delivery dimension. |
| AC-QUIET-WHEN-PASSING | OBJ-NO-SILENT-MASKING | A passing manifest adds no manifest text to any requirement. |
