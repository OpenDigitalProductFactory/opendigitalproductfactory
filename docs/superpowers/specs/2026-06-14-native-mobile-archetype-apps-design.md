# Native Mobile — Archetype Persona Apps — Design

**Date:** 2026-06-14
**Status:** Draft — for operator review
**Format:** Full design ships as an HTML artifact — [`2026-06-14-native-mobile-archetype-apps-design.html`](2026-06-14-native-mobile-archetype-apps-design.html). This Markdown file is the search stub (AGENTS.md §16).
**Extends:** [`2026-03-19-mobile-companion-app-design.md`](2026-03-19-mobile-companion-app-design.md), [`2026-05-13-realtime-hitl-mobile-companion-design.md`](2026-05-13-realtime-hitl-mobile-companion-design.md)
**Readiness input:** [`../audits/2026-05-13-realtime-hitl-mobile-readiness-report.md`](../audits/2026-05-13-realtime-hitl-mobile-readiness-report.md)

## Abstract

Native iOS/Android apps for DPF, covering both the platform and each archetype's real-world use cases
(customer self-service for recurring businesses; field-service for employees) as **one binary routed at
runtime by persona × use case**.

Key finding: mobile is not "basic backend" — `apps/mobile/` is a substantially-built Expo SDK 55 / RN 0.83
app with a complete `/api/v1/*` REST surface, shared client/types/validators packages, JWT auth, a dynamic
form/view renderer, and Maestro E2E. What's built targets the **platform-operator** persona (later narrowed
to Paused-Work HITL approvals). The new ask is a second product line: **archetype end-user apps** (customers,
field techs), sharing the same shell.

Three real gaps, none of them basics:

1. **Connectivity / discovery** — one app-store binary must reach *N* self-hosted single-org installs; today
   the server URL is hard-coded (`EXPO_PUBLIC_API_URL`). Solved with the self-hosted multi-instance pattern:
   runtime server-URL config + `GET /.well-known/dpf-instance.json` descriptor + QR/deep-link onboarding +
   an optional later discovery directory.
2. **Persona-driven runtime UX** — a `GET /api/v1/app/config` **persona manifest** (principal kind,
   archetype, tabs, modules, vocabulary, branding) drives a shared shell into customer / field / operator
   mode. No per-archetype app code. Composes existing `BusinessModelRole`, `StorefrontArchetype.activationProfile`,
   `getShellNavSections`, `WorkItem/WorkSchedule`, `CustomerAccount/Contact`, and principal convergence (AGENTS §11).
3. **Native build & release** — iOS can't build in our Linux Build Studio (macOS/Xcode only). Split
   "write/test code" (Build Studio / Claude / Codex, all Linux) from "compile native" (**EAS Build** cloud,
   macOS for iOS + Linux for Android) and "submit" (**EAS Submit**).

## Decisions in the doc

- **Repo:** keep monorepo + add a **path-filtered mobile CI lane**; native builds off the PR gate (EAS). Do not split now.
- **Distribution:** one generic app + instance URL now; per-org white-label deferred to premium.
- **Build order:** P0 accounts (owner) ∥ P1 connectivity → P2 persona manifest → P3 customer / P4 field → P5 push+offline → P6 store.
- **What only the owner can do:** Apple Developer ($99/yr), Google Play ($25), Expo/EAS, Firebase + APNs key, physical devices, TestFlight/Play tester enrollment, store metadata + privacy policy, publishing entity + bundle ids.

See the HTML artifact for the full architecture diagrams, persona×use-case map, testing strategy, research &
benchmarking, roadmap, reuse map, and the three operator decisions.
