# EP-OPS-PANEL-001: Backlog Panel Centered Modal

**Status:** Implemented
**Date:** 2026-03-16
**Scope:** Ops backlog page — edit panel layout for epics and backlog items

---

## Problem Statement

The backlog item and epic edit panels render as narrow sidebars (`w-96`, ~384px) pinned to the right edge of the screen. This makes form fields cramped and difficult to work with, especially on larger displays where the panel occupies a small fraction of available space.

## Decision

Convert both panels from right-pinned sidebars to centered modal dialogs at 3/4 screen width, consistent with how edit forms are typically presented in enterprise applications.

## Design

### Layout

- **Position:** Centered on screen using `fixed inset-0` with flexbox centering
- **Width:** `w-3/4` (75% of viewport)
- **Max height:** `max-h-[85vh]` to prevent overflow on shorter screens
- **Border:** Rounded corners (`rounded-lg`) with border, replacing the flat left-border sidebar style
- **Backdrop:** Existing `bg-black/40` overlay retained — clicking it closes the panel
- **Pointer events:** Outer centering wrapper is `pointer-events-none`, inner panel is `pointer-events-auto` so backdrop clicks pass through correctly

### Applies To

Both panels follow the same pattern:
- `BacklogPanel` — create/edit backlog items
- `EpicPanel` — create/edit epics

## Files Affected

- `apps/web/components/ops/BacklogPanel.tsx` — layout change from sidebar to centered modal
- `apps/web/components/ops/EpicPanel.tsx` — same layout change

## Implementation

Completed in commit `18c2fbe` on 2026-03-16.
