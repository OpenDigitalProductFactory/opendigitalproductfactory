# Multi-Business "Town" Super-App — Mobile Design

> **Canonical spec is the HTML artifact:** [2026-06-14-multi-business-town-super-app-design.html](2026-06-14-multi-business-town-super-app-design.html)
> (HTML + embedded SysML v2 per the `dpf-sysml-architecture-substrate` convention). This `.md` is a pointer stub.

**Extends:** [2026-06-14-native-mobile-archetype-apps-design.html](2026-06-14-native-mobile-archetype-apps-design.html)
**Epic:** EP-MOBILE-ARCHETYPE · **Status:** draft (operator review) · **Date:** 2026-06-14

## One-paragraph summary

Evolve the mobile app from "one generic app ↔ **one** business install" to "one app engages with **many** local
businesses as *spaces*" — the town in one app. Each business stays a separate single-org-per-install backend
(**no server multi-tenancy**); the change is a **client-side generalization** (`serverConfig` → `Space[]` registry,
one session/manifest/persona per space, a switcher + "my town" home), a **shared device layer** (one wallet, one geo
grant, one push token reused across spaces — each business charges via *its own* processor), and **two consciously-thin
federation services** (a "Nearby" discovery directory + an optional sign-in-once identity broker — the only two things
every super-app centralizes). Persona is per space (customer at the salon, employee at the rental co), driven by that
install's manifest.

## Precedents (adopt, not invent)

- **Uber personal/business profiles** — one account, switchable profile, payment-method-per-profile → per-space context.
- **Slack / Mastodon multi-workspace** — N independent backends, one client, a switcher, notifications aggregated, no identity bleed → the "spaces" model.
- **WeChat / Gojek super-apps** — many independent merchants, shared wallet + discovery (geo "Nearby") + scoped-token identity → the federation layer.
- **Fresha / Booksy** — one consumer identity + saved card reused across independent businesses → customer surfaces.
- **Stripe Connect / Apple-Google Pay** — device holds the instrument; each business charges via its own processor (no central broker) → cohesion with DPF "conduit not broker." Physical/real-world services are IAP-exempt (Apple 3.1.3(e); Google Play).

## Milestones

| # | Milestone | Depends |
|---|-----------|---------|
| M1 | Multi-space client foundation (`Space[]` registry, switcher, "my town") — *buildable now* | — |
| M2 | Per-space customer auth + customer surfaces (waitlist / appointment / rental) | M1 |
| M3 | Shared device layer (wallet → per-business processor; geo + push fan-out) | M1 |
| M4 | Directory ("Nearby") — thin hosted registry | M1 |
| M5 | Optional identity broker (sign-in-once) | M2, M4 |

## Decisions for the operator

- **A · Identity** — *rec:* per-space memberships now, thin identity broker later.
- **B · Directory host** — *rec:* Arcamanus-hosted, opt-in (holds only public descriptors).
- **C · Payments** — *rec:* device wallet + each business's own processor (no central broker).
- **D · Scope first** — *rec:* single-business UX first, multi-space-ready (the "town" lights up as businesses join).
