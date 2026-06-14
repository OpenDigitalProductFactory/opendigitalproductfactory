# Native Mobile — Archetype Persona Apps — Design

**Date:** 2026-06-14
**Status:** Draft — for operator review
**Format:** Full design ships as an HTML artifact — [`2026-06-14-native-mobile-archetype-apps-design.html`](2026-06-14-native-mobile-archetype-apps-design.html). This Markdown file is the search stub (AGENTS.md §16).
**Extends:** [`2026-03-19-mobile-companion-app-design.md`](2026-03-19-mobile-companion-app-design.md), [`2026-05-13-realtime-hitl-mobile-companion-design.md`](2026-05-13-realtime-hitl-mobile-companion-design.md)
**Readiness input:** [`../audits/2026-05-13-realtime-hitl-mobile-readiness-report.md`](../audits/2026-05-13-realtime-hitl-mobile-readiness-report.md)

## Abstract

One generic native iOS/Android app (published by **Arcamanus LLC**, the OSS supporting company / Apple license
holder) that connects to any self-hosted single-org DPF install and lets the **install drive both the app's
design and its functionality** — the platform emits the uniqueness, the binary stays generic.

Key finding: mobile is not "basic backend" — `apps/mobile` is a substantially-built Expo SDK 55 / RN 0.83 app
(REST `/api/v1/*`, shared client/types/validators, JWT, a dynamic form/view renderer = an SDUI seed, Maestro
E2E). What's built targets the platform **operator**; the new ask is archetype **end-user** apps (customers,
field techs) on the same shell.

### The platform-drives-the-app model (server-driven)

After connect + login the app fetches one **install manifest** (`GET /api/v1/app/config`) with three layers:

1. **Design tokens** — the install's `BrandingConfig.tokens` as W3C DTCG design tokens → app re-themes at runtime.
2. **Capability gating** — archetype `activationProfile` + `OrganizationCapabilityActivation` → which functionality appears.
3. **Server-driven screens (SDUI)** — `DynamicForm`/`DynamicView` schema + field/widget registries + renderers → screens/nav as data.

Rendered by a fixed native component catalog. No per-company or per-archetype code ships in the binary.

### Standard, or invent? (researched, cited in the HTML)

Partially standardized — **adopt the primitives, build only the glue**:

- Design-as-data: **W3C DTCG Design Tokens** (first stable 2025.10) — adopt.
- SDUI: mature pattern, no single standard (DivKit Apache-2.0, Adaptive Cards, Airbnb GP) — adopt the approach; we already have the renderer seed.
- "Point-at-instance, absorb config/brand/features": Home Assistant / Nextcloud / Mastodon — adopt the flow.
- Per-archetype contract binding all three to installs: **novel — our IP**, = "archetype is bootstrap" extended to mobile.
- **~60% of the substrate already exists** in DPF.
- Apple guardrail (App Store 2.5.2): the manifest stays strictly declarative data — never downloaded executable code.

### Connectivity

Runtime server-URL config + `GET /.well-known/dpf-instance.json` descriptor + QR/deep-link onboarding +
optional later discovery directory. **P1 connectivity foundation: shipped** (runtime URL config + descriptor client).

## Decisions

- **Distribution (resolved 2026-06-14):** one generic app published by **Arcamanus LLC**; per-org white-label deferred to a possible premium.
- **Repo:** keep monorepo + a path-filtered mobile CI lane; native builds off the PR gate (EAS). No split now.
- **iOS build:** cannot build in the Linux Build Studio (macOS/Xcode only) → **EAS cloud**.
- **Build order:** P0 accounts (owner) ∥ P1 connectivity [done] → P2 install manifest + runtime theming → P3 SDUI screen layer → P4 field / P5 customer use-cases → P6 push+offline → P7 store.
- **Owner-only actions:** Apple Developer as Arcamanus LLC ($99/yr), Google Play ($25), Expo/EAS, Firebase + APNs key, physical devices, TestFlight/Play tester enrollment, store metadata + privacy policy.

See the HTML artifact for the architecture diagrams, the three-layer manifest contract, the persona × use-case
map, testing strategy, full research & citations, roadmap, reuse map, and the resolved decisions.
