# Delivery — one operator home

Status: standard (BI-ARCH-DELIVERY-IA, EP-PLATFORM-CONSOLIDATION)
Spec: [`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`](../superpowers/specs/2026-06-25-platform-consolidation-spine-design.md) §6.3

Delivery work used to be scattered: Build Studio under the Platform rail section, the
backlog under Products, change lanes under `/platform/development`, and
promotion/dev-loop/self-upgrade under `/ops`. There was no single operator home for "build,
ship, and track."

`/delivery` is that home — a **hub**, not a new system.

## What it is

- A new **Delivery** rail section (`apps/web/lib/govern/permissions.ts` `SHELL_SECTIONS` +
  the `PortalShellSectionKey` union).
- `/delivery` ([`apps/web/app/(shell)/delivery/page.tsx`](../../apps/web/app/(shell)/delivery/page.tsx))
  — a launcher that groups the existing delivery surfaces: Build & ship (Build Studio,
  Work control), Plan (Backlog), Track & release (Change lanes, Promotions, Dev loop,
  Self-upgrade).
- The **Build Studio work surface (`/build`)** moves into the Delivery rail section. It is
  already `domain: "delivery"`; this aligns the rail grouping with the domain. Build Studio
  **configuration** (models/providers) stays under Platform at `/platform/ai/build-studio`
  — that is platform administration (spec §6.3).

## What it deliberately is NOT

- **Not a second timeline / tracking model.** Work tracking + evidence remain in change
  lanes and the EP-UNIFIED-TRACKING work; the hub *links* to them. When the unified
  timeline projection lands, a `/delivery/timeline` surface can render it — this PR does not
  pre-empt that.
- **Not a re-route.** Every link targets a route that already exists; all deep links
  (`/build`, `/build/work`, `/ops`, `/ops/promotions`, `/ops/dev-loop`, `/ops/self-upgrade`,
  `/platform/development/change-lanes`) are preserved.

## UX / cognitive-load rationale

Per Open Decision #2 this ships as a grouped route under the current shell (a new section +
home), not a disruptive re-home of every surface. It is a net cognitive-load **reduction**
for delivery work — one home instead of hunting across Platform/Ops/Products — and is
operator-only (workers never see it, so no added chrome for day-to-day users). It honors
EP-NAV-COHERENCE: Delivery is its own rail section, so moving between it and other sections
is the rail's job (no cross-section secondary-nav teleport).

## Follow-ups (operator-verified)

- Move the Backlog (`/ops`) and the work-tracking surfaces fully into the Delivery section
  once the `/ops` Runtime & Releases grouping is re-homed (coordinates with the OpsTabNav
  groups).
- Add `/delivery/timeline` rendering the EP-UNIFIED-TRACKING unified projection when it
  lands.
