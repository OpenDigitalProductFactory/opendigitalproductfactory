---
status: active
---

# Instance planning scope — fix design

Backlog item: BI-B223F45E  
Workroom: WC-22868A77  
Named baseline: `origin/main` at `0cd1ef55743f88309f46f864b82627656aed549c`

## Problem and evidence

The approved proactive Workrooms design separates reusable platform and archetype behavior from an organization's Layer 3 instance overlay. The live customer-zero configuration item BI-A967717A is bound to its organization, but the planning-scope contract offers only `platform`, `common`, archetype variants, and `unknown`. `unknown` fails initiative classification readiness. Any other value falsely promotes private customer-zero configuration into reusable product scope.

The defect is present on the named baseline in `apps/web/lib/explore/backlog.ts`, where `BACKLOG_SCOPE_KIND_VALUES` omits `instance`. `apps/web/lib/backlog/initiative-readiness/profiles.ts` already treats unrecognized ownership values neutrally, so the missing enum—not readiness risk projection—is the primary cause. Live backlog, source graph, open pull request, and Git history searches found no existing implementation or duplicate backlog item.

## Contract

`instance` means work intentionally bounded to one organization. It is an ownership/classification axis, not an archetype, common capability, platform-wide change, or elevated readiness profile.

- An instance-scoped backlog item must carry `organizationId`.
- MCP create/update/filter schemas and UI/workbook option sources derive from the canonical enum and expose the value without parallel literals.
- Readiness derives risk strength from work type and immutable evidence; `instance` itself neither raises nor lowers the profile.
- An instance-scoped epic is valid only when its originating backlog item supplies the organization boundary. The Epic model does not gain a second organization store.
- Existing rows remain unchanged; `scopeKind` is a nullable string, so no data migration is required.

## Ordered fix sequence

1. Add failing tests proving the enum omission, organization binding invariant, and neutral readiness projection.
2. Add `instance` to the canonical planning-scope enum and update its single schema description.
3. Enforce organization binding in shared backlog input validation and governed MCP ingest/update paths, reusing the canonical `organizationId` field.
4. Validate instance-scoped epic create/update against the originating backlog item's organization rather than adding an Epic identity field.
5. Run the focused enum, validation, MCP pack, epic-tool, and readiness suites; then run the affected web gate and production build.
6. Reclassify BI-A967717A through the live tool/UX and verify its readiness no longer reports CLASSIFICATION_REQUIRED.

## Candidate causes ruled out

- **A hidden database enum:** ruled out by inspecting `packages/db/prisma/schema/work-coordination.prisma`; both BacklogItem and Epic store nullable strings.
- **An existing organization-specific scope under another label:** ruled out by the canonical enum, live backlog, code graph, PR, and Git-history searches.
- **Readiness incorrectly treating instance work as archetype work:** ruled out by inspecting the readiness projection; only enumerated archetype labels elevate to the archetype profile.
- **A need for a parallel instance identity:** ruled out because BacklogItem already owns `organizationId`, and Epic already has a canonical originating-item relation.

## Verification mapping

- R1 enum/public tool parity → `apps/web/lib/backlog-enums.test.ts`
- R2 organization binding → `apps/web/lib/explore/backlog.test.ts` plus MCP pack/update tests
- R3 readiness neutrality → `apps/web/lib/backlog/initiative-readiness-policy.test.ts`
- R4 epic identity reuse → `apps/web/lib/backlog/mcp-epic-tools.test.ts`
- R5 customer-zero unblock → live BI-A967717A readiness readback after deployment

Documentation impact: the tool schema description and this design are the user/coworker-facing contract; no public product documentation changes are needed because planning scope is backstage coordination metadata.
