# EP-OPS-FILTER-001: Backlog Hide Done Filter

**Status:** Implemented
**Date:** 2026-03-16
**Scope:** Ops backlog page — epic and backlog item filtering

---

## Problem Statement

The operations backlog page displays all epics and backlog items regardless of status. As the number of completed items grows, it becomes difficult to focus on active work. There is no way to filter out completed items.

## Decision

Add a "Hide done" checkbox filter to the ops backlog page that applies to all three sections: Epics, Portfolio Backlog, and Product Backlog.

## Design

### Filter Behavior

- **Default state:** Checked (hide completed items by default)
- **Scope:** Single checkbox controls filtering across all three sections
- **Epic filter:** Hides epics with status `"done"`
- **Backlog item filter:** Hides items with status `"done"` or `"deferred"`
- **Hidden count:** Each section shows "N completed items/epics hidden" when filter is active
- **Empty state:** When all items in a section are filtered out, show "All N items are done. Uncheck 'Hide done' to see them."

### UI Placement

The checkbox appears next to the "Epics" section header, inline with the existing sort controls. It is a single control point — not duplicated per section — since the intent is a page-level view preference.

### State Management

Client-side `useState` — no persistence needed. Defaults to `true` on each page load, which is the common case (focus on active work).

## Files Affected

- `apps/web/components/ops/OpsClient.tsx` — added `hideDone` state, filter logic for epics and backlog items, checkbox UI, hidden counts

## Implementation

Completed in commits `2f08d74` and `eabc02c` on 2026-03-16.
