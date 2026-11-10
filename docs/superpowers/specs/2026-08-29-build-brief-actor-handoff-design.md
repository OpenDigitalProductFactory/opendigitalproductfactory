---
status: active
backlogItem: BI-7175C7DB
---

# Build brief actor handoff

## Problem

`update_feature_brief` is a governed MCP tool. Its handler already receives the
resolved actor and resolves only a build that actor owns, but it calls the
session-oriented `updateFeatureBrief` action without forwarding that actor. The
action consequently calls `auth()` in a background MCP execution and returns
`Unauthorized` before its existing build-ownership check can run.

This is reproducible on `FB-668407A5`: the authenticated Build Studio coworker
can inspect and discuss the brief, while its direct `update_feature_brief` call
fails with `Unauthorized` outside an HTTP request session.

## Objectives

**OBJ-BBAH-001:** A governed build-lifecycle MCP call preserves the exact
server-resolved actor through the feature-brief write boundary without relying
on an HTTP session.

**OBJ-BBAH-002:** Interactive callers retain session authentication, and both
paths retain the existing owner, phase, validation, organization, and atomic
legacy/business-brief persistence checks.

## Acceptance criteria

| Acceptance criterion | Objective | Required evidence |
| --- | --- | --- |
| AC-BBAH-001: The MCP handler passes its resolved `userId` to `updateFeatureBrief`. | OBJ-BBAH-001 | Handler regression test |
| AC-BBAH-002: A supplied actor skips session lookup but must still equal `FeatureBuild.createdById`. | OBJ-BBAH-001, OBJ-BBAH-002 | Action owner/non-owner tests |
| AC-BBAH-003: Omitting the actor preserves the existing session-authenticated UI call shape. | OBJ-BBAH-002 | Existing action test plus explicit session assertion |
| AC-BBAH-004: Brief merge semantics, Ideate-only validation, and dual brief persistence are unchanged. | OBJ-BBAH-002 | Existing governed build tests and focused regression suite |

## Existing substrate and benchmarking

The repository already solves the same sessionless execution boundary in
`shipBuild`: an optional `actorUserId` is accepted by the action, while the
handler passes the resolved MCP actor and UI callers omit it. The action still
checks `FeatureBuild.createdById` against the resulting actor. Reusing that
contract is preferable to adding a second authorization helper or weakening
`requireBuildAccess`.

Two alternatives were rejected:

1. Making `requireBuildAccess` infer a background actor would mix HTTP-session
   and MCP authority and make the caller identity implicit.
2. Moving brief persistence into the MCP handler would duplicate validation and
   transaction behavior owned by the action.

## Architecture

Extend `updateFeatureBrief` with a single optional options object containing
`actorUserId`. Resolve `userId` as the supplied actor or the existing
`requireBuildAccess()` result. The MCP handler supplies `{ actorUserId: userId }`.
No schema, grant, capability, database, UI, or response-shape change is needed.

## Security and failure behavior

The explicit actor is trusted only because it is produced by the governed tool
handler after token, subject, organization, capability, and active-build
resolution. It is not accepted from model parameters. A missing build,
non-owner actor, non-Ideate build, invalid brief, or missing organization still
fails closed before persistence.

## Documentation impact

No user-facing documentation changes are needed. This restores the documented
`update_feature_brief` behavior and introduces no new operator or UI contract.

