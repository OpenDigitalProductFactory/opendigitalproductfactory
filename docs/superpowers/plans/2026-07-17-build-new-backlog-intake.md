# Build Studio New Work Backlog Intake

## Backlog

- `BI-1A876339` - `/build` New button must originate work as a BI with portfolio assignment.

## Problem

The `/build` sidebar starts direct `FeatureBuild` rows from plain text. That bypasses the backlog ledger, required portfolio attribution, and the explicit promote step that keeps Build Studio work governed and measurable.

## Plan

1. Add a Build Studio intake server action that requires title plus portfolio and creates an open, build-triaged backlog item.
2. Reuse the existing `startBacklogBuild` / `promoteBacklogItemToBuildDraft` path for promotion instead of duplicating build creation in the client.
3. Carry `BacklogItem.portfolioId` onto the promoted `FeatureBuild`.
4. Replace the sidebar instant-build button with required portfolio selection, inline filed-BI confirmation, and an explicit promote action.
5. Cover the server action and promotion contract with focused tests, then typecheck the web package.

## Design Grounding

- Existing specs/plans reviewed:
  - `BI-1A876339` backlog body and its IT4IT Strategy-to-Portfolio / Requirement-to-Deploy hand-off requirement.
  - Build Studio governed backlog promotion plan already encoded in `apps/web/lib/governed-backlog-tee-up.ts`.
- Current code substrate reviewed:
  - `apps/web/components/build/BuildStudio.tsx` sidebar intake and active-build selection.
  - `apps/web/lib/actions/backlog-build.ts` semantic BI promotion action.
  - `apps/web/lib/governed-backlog-tee-up.ts` shared promotion core used by MCP and backlog UI.
  - `apps/web/lib/backlog-data.ts` portfolio select data contract.
- Source of truth:
  - Backlog work starts as `BacklogItem`, promotion uses `promoteBacklogItemToBuildDraft`, and `BacklogItem.portfolioId` is the budget/measurement anchor.
- Decision:
  - `/build` files a portfolio-attributed BI first and exposes promotion as a second explicit action. It does not create a direct `FeatureBuild` from the sidebar.
