---
status: draft
---

# Recover immutable source reads after an invalid cursor

**Owner:** BI-E8237EAE; Workroom WC-9255BE6F.
**Blocks:** COO architecture review for BI-4B48E7FE / BI-C43FD3E5.
**Scope:** a small residual repair to the existing immutable reader contract.

## Observed failure and existing substrate

At source ec7d2fe41d9393180f6003b946291b83cd464fa1, two native COO
architecture attempts stopped before recording a verdict. Reader audits
cmvol9npm0svz01o02mit4ggd and cmvol9sj70swl01o0uk2yorcs supplied literal
cursor strings 0 and 1 and received invalid_cursor. The six-call budget was
exhausted without a complete artifact traversal. Prior attempts remain intact.

source-page.ts binds opaque continuation tokens to version, path and blob.
version-history-pack.ts exposes repository and build-revision readers, but
both return the error code as their entire recovery message. Their cursor
schema describes an opaque token without explaining the first request.
Existing terminal policy and source-page limits remain authoritative.

## Decision and boundaries

Retain strict cursor rejection. Share actionable error text at the existing
page-reader boundary and reuse one cursor description for both tools. The
first request omits cursor; continuation copies the prior successful
nextCursor unchanged. A failure never supplies evidence or a fresh cursor.

Reject treating numeric cursors as offsets, silently restarting an invalid
request, increasing budgets, rewriting task state or granting review authority.
Those approaches would hide the bad call or weaken the evidence boundary.
There is no schema migration, new service, permission or workflow engine.
The error code and page result structure stay unchanged; only explanatory
failure messages and tool input guidance improve. At least one fifth of this
repair consolidates shared reader behavior instead of duplicating adapter copy.

## Requirements and verification

**OBJ-CURSOR-RECOVERY:** Let the existing reviewer recover from a refused reader
call while preserving complete immutable evidence and independent judgement.

| Acceptance | Objective | Observable result |
| --- | --- | --- |
| AC-CURSOR-01 | OBJ-CURSOR-RECOVERY | Numeric, malformed and other-artifact cursors still fail; the response explains first-read and exact-token continuation recovery. |
| AC-CURSOR-02 | OBJ-CURSOR-RECOVERY | Both repository and build-revision readers share the recovery contract; a valid same-artifact traversal still returns exactly the source bytes. |
| AC-CURSOR-03 | OBJ-CURSOR-RECOVERY | A refused or incomplete read does not make the terminal writer eligible; a complete valid traversal does. Existing limits and authority checks remain intact. |
| AC-CURSOR-04 | OBJ-CURSOR-RECOVERY | After protected delivery and governed install advance, resume the original eligible architecture task and observe a genuine receipt or a precise remaining refusal. Source tests alone do not prove this. |

First write a failing handler-level recovery regression, run it, then implement
the shared text and tool descriptions. Run related immutable-reader and terminal
policy tests plus application/test typechecks. Preserve exact-head shared gate,
independent semantic review, DCO and protected publication. A denied scope stops
the denied action. Record any unavailable gate without calling it a pass.

Rollback restores the prior explanatory text through the normal source release;
existing reader tokens, task history, refusals and review receipts remain intact.
