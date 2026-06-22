# Derive Operating-Hours Timezone from the Captured Business Location

**Date:** 2026-06-20
**Epic:** EP-UPGRADE-LIFECYCLE
**Item:** BI-0C000AB3 (follows BI-6DA3B06F / the self-upgrade window timezone fix)

## Why

Operator feedback on the self-upgrade window fix: *"we provided the business
location at install, so the timezone should be derived from that"* — rather than
asking, or falling back to UTC (which is what put the maintenance window at local
noon for a US Central store).

Two real gaps today:

1. **Timezone is only derived at brand-URL import**, and only at **country**
   granularity (`COUNTRY_TO_TIMEZONE` in `public-web-tools.ts`, used by
   `branding.ts`). For the US that map returns `America/New_York` — so even when
   it fires, a Central store lands on Eastern. Country granularity cannot resolve
   a US timezone (six zones).
2. **The structured location signal that IS captured — `BusinessContext.stateCode`
   — is never used to derive a timezone.** And on a fresh/reset install with no
   confirmed `BusinessProfile`, the operating-hours timezone falls back to UTC.

## Design

- New pure module `apps/web/lib/timezone-from-location.ts`:
  - `US_STATE_TO_TIMEZONE` — predominant IANA zone per US state/territory (split
    states default to their majority zone; operator can override via the picker).
  - `COUNTRY_TO_TIMEZONE` — **moved here as the canonical home**; re-exported from
    `public-web-tools.ts` so `branding.ts` and the brand-import path are unchanged.
  - `resolveTimezoneFromLocation({ stateCode, countryCode })` — US state first
    (precise), then country; `null` when unresolvable so callers fall back safely.
  - Intentionally dependency-light (pure data + function) so the unattended cron
    path can import it without a bundle-boundary violation.
- Wire it into the timezone resolution, preferring the most precise signal:
  **confirmed profile tz → location-derived (state, then country) → brand-import
  suggestion → browser-detected (editor only) → UTC.**
  - `resolveOperatingScheduleForSystem` (cron / system path): when the active
    `BusinessProfile.timezone` is missing or the UTC placeholder, derive from
    `BusinessContext.stateCode` / jurisdiction so the **self-upgrade window is
    correct from the captured location even before the operator confirms hours.**
  - `getOperatingHours` (editor path): return the location-derived zone as the
    resolved default so the Operating Hours editor shows the right zone, not UTC.

The Operating Hours timezone **picker** (BI-6DA3B06F) remains the override /
confirmation; this change only makes the **default** correct from captured data.

## Research / accuracy note

Split-zone US states resolve to their majority zone (TX→Chicago, FL→New_York,
TN→Chicago, MI→Detroit, ID→Boise). This is a sane default, not a claim of
per-address precision; the picker covers the minority-zone exceptions.

## Verification

- Unit tests for `resolveTimezoneFromLocation`: US state precision (IL/TX→Chicago,
  CA→Los_Angeles, NY→New_York), `US-IL` subdivision form, country fallback
  (GB→London), and `null` when unresolvable.
- Build gate via CI (source-only worktree cannot run it locally).

## Out of scope

- Per-address (sub-state) precision — the picker handles exceptions.
- Changing the brand-import country detection itself.
