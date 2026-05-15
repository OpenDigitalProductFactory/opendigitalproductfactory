# Current Documentation Coverage Audit - 2026-05-14

Backlog item: `BI-DOCS-AUDIT`

Scope: repo README, public `docs/index.html`, user guide, architecture docs, public meta-files, contextual docs routing, and the docs information architecture refactor lane.

Evidence sources:

- `git log --since="14 days ago" --first-parent --oneline origin/main -- docs README.md CONTRIBUTING.md SECURITY.md apps/web/lib/docs-route-map.ts apps/web/lib/docs-route-map.test.ts`
- `rg --files apps/web/app/(shell)` filtered for recently-added routes.
- `rg --files docs/user-guide` filtered for matching operating guides.
- Text sweeps across `README.md`, `docs/index.html`, `docs/user-guide`, `docs/architecture`, `docs/install`, and `CONTRIBUTING.md`.
- Route-map inspection in `apps/web/lib/docs-route-map.ts`.
- Open PR overlap sweep with `gh pr list --state open --search "docs OR README OR docs-route"`.

Open PR overlap as of this audit:

- PR #577 plans this epic: `doc/docs-public-site-current-state-refresh`.
- PR #582 and PR #583 are active Edge Node follow-on work; later copy must re-check Edge Node state before publishing final public wording.
- PR #587 repairs deployed wiki seeding; later wiki copy must verify the deployed portal receives founder-kernel content.

## Coverage Matrix

| Capability | Runtime evidence (file/route/commit) | README | Public site | User guide | Architecture docs | Status | Required change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Native Windows, macOS, and Linux install paths | `README.md` install matrix; `docs/install/macos.md`; `docs/install/linux.md`; `docs/install/verification-runbook.md`; commits `943de39d`, `8c9036ba`, `bd46d4f5` | current | stale | current | current | stale | Refresh `docs/index.html` deployment-status table so Linux/macOS no longer read as only tracked work. Keep "early access" until verification reports justify GA. |
| Edge Node single-host, multi-host, and air-gapped operations | `/platform/edge-nodes`; `services/edge-node`; `docs/install/edge-node-multi-host.md`; `docs/install/edge-node-air-gapped.md`; commits `15b182cb`, `37c95f08`, `64997b36`, `bd46d4f5` | stale | missing | missing | current | missing | Add a user-facing Edge Nodes guide, map `/platform/edge-nodes`, and update README/public site to describe the current operator surface. Re-check PR #582/#583 before final copy. |
| Platform wiki and founder kernel | `/wiki`; `/wiki/[...slug]`; `/admin/wiki/lint`; `apps/web/lib/wiki/*`; commits `980c7e63`, `8dda39c0`, `bf8cbd98`, `45a6d4f9` | missing | missing | missing | current | missing | Add wiki/founder-kernel user guide coverage and route mapping for `/wiki`; public copy can mention governed platform knowledge only after PR #587 lands or is accounted for. |
| Managed document workspace | `/workspace/documents`; `/workspace/documents/[documentId]`; `apps/web/lib/documents/document-store`; commit `69e9edfb` | missing | missing | stale | current | missing | Add a managed documents guide under workspace, update `/workspace/documents` contextual docs, and include the capability in README/public feature inventory. |
| Build Studio and shared workspace contribution flow | `/build`; `/platform/ai/build-studio`; `docs/user-guide/build-studio/*`; `CONTRIBUTING.md`; commits `43f6f921`, `ec4e861c`, `9e65ad10` | current | current | current | current | current | Keep core wording. Later guard work must verify Build Studio route copy and code-intelligence claims stay aligned with current sandbox behavior. |
| Code graph and impact intelligence | `apps/web/lib/integrate/code-graph*`; Build Studio impact reports; commits `ec4e861c`, `8a4b33b4`, `3e92fee3` | stale | missing | stale | current | stale | Add concise public and README wording only where it helps users understand Build Studio review impact; add user-guide detail inside Build Studio docs rather than a new top-level section. |
| AI Operations Map | `/platform/ai/operations-map`; `apps/web/app/(shell)/platform/ai/operations-map/page.tsx`; commit `14539ccb`; saved-view commits `14cb4117`, `310bd3f3` | missing | missing | stale | current | stale | Expand `docs/user-guide/platform/ai-operations.md`, explicitly map `/platform/ai/operations-map`, and add a short public capability line. |
| Capacity continuity | `/platform/ai/capacity-continuity`; `apps/web/lib/tak/autonomous-work-run.ts`; commit `a0785c82` | missing | missing | stale | current | stale | Keep the existing AI Operations user-guide section, add route-map coverage, and add public/README wording focused on governed ongoing AI work. |
| Coworker capability-needs review | `/platform/ai/capability-needs`; commit `2174f431` | missing | missing | missing | current | missing | Add user guide coverage and contextual docs route mapping; connect public wording to governed improvement intake, not generic chat feedback. |
| Licensing and permit readiness | `/compliance/licensing`; `apps/web/lib/tak/route-context-map.ts`; spec commit `9a64cdfb`; feature commit `ed84fb49` | missing | missing | missing | current | missing | Add compliance user-guide page for licensing readiness, map `/compliance/licensing`, and add a short feature mention in README/public site if compliance is listed as a platform domain. |
| Finance tax settings and remittance controls | `/finance/settings/tax`; `docs/user-guide/finance/controls-and-automation.md`; commit `7ed1a09e` | missing | missing | current | current | current | No standalone guide required. Public/README feature inventories can mention tax settings only if finance capability lists are expanded. |
| Native integrations: Google Business Profile and Google Marketing Intelligence | `/platform/tools/integrations/google-business-profile`; `/platform/tools/integrations/google-marketing-intelligence`; tests under matching route folders | missing | missing | stale | current | stale | Expand Tools and Integrations guide with concrete native integration examples and add route-map entries for individual integration pages if contextual help needs specific anchors. |
| External MCP endpoint and native CLI adapter | `/api/mcp/v1`; `apps/web/lib/mcp-tools.ts`; commit `9e65ad10`; public site MCP section | current | current | stale | current | current | Keep public wording. Add user-guide contributor setup notes only where they help operators connect external clients safely. |
| Route-aware contextual docs | `apps/web/lib/docs-route-map.ts`; current mappings omit `/wiki`, `/workspace/documents`, `/platform/edge-nodes`, `/platform/ai/operations-map`, `/platform/ai/capacity-continuity`, `/platform/ai/capability-needs`, and `/compliance/licensing` | intentionally-internal | intentionally-internal | stale | intentionally-internal | stale | Run the 20 percent refactor lane: sidebar/doc IA audit, route-map updates, tests, and orphan-page reconciliation before broad copy rewrites. |

## Public Meta-Files

| File | Status | Required change |
| --- | --- | --- |
| `CONTRIBUTING.md` | stale | Source-visible placeholder comments remain for GitHub auth screenshots. Replace with real captures or remove the placeholders when the contribution-flow doc pass runs. Add a direct DCO sign-off reminder in the PR expectations section. |
| `SECURITY.md` | current | No current feature-claim drift found. Keep security reporting focused and avoid mixing roadmap content into this file. |
| `CODE_OF_CONDUCT.md` | current | No current feature-claim drift found. |
| `NOTICE` | current | No current feature-claim drift found from text sweep. Re-check only if dependency/license changes land during later chunks. |
| `ACKNOWLEDGMENTS.md` | current | Includes the platform-kernel wiki design reference; no feature-claim drift found. |
| `docs/platform-usability-standards.md` | current | Keep as the canonical UI standard. Later public/docs-site styling must use theme tokens, not hardcoded color claims. |
| `docs/dark-theme-development-guidelines.md` | current | Keep as supporting styling guidance. |
| `AGENTS.md` | current | Treat as the agent operating contract, not public onboarding copy. Link only where contributor workflow requires it. |

## Future-State And False-Positive Sweep

The release-state sweep looked for placeholder and future-state language in README, public site, user-guide, and architecture docs, then separated genuine drift from intentional roadmap labels.

Findings:

- `README.md` lines 75-93 and 257-269 accurately say macOS/Linux installers are code-complete and early access, with Windows as the GA path.
- `README.md` line 229 says specs are research stubs awaiting benchmarking. That is stale for deployment and Edge Node work that now has runbooks, verification templates, or implemented slices.
- `docs/index.html` still describes Linux and macOS in a way that conflicts with the code-complete installer state. Public-site deployment copy needs the same early-access framing used by README and install docs.
- `docs/index.html` has intentional roadmap content for optional cloud, TAPPaaS, managed providers, and zero-click onboarding polish. Keep it clearly labeled as roadmap.
- `CONTRIBUTING.md` contains source-visible screenshot placeholders for GitHub contribution setup. These are real documentation debt, not runtime blockers.
- GAID matches in the release-state sweep are governance-standard references, not release-status claims.

## Refactor Lane

Use `BI-B0668CDC` for the documentation IA refactor budget before the rewrite chunks grow:

- Add or update route-map tests for the missing contextual docs routes.
- Decide whether wiki, managed documents, Edge Nodes, licensing, and capability needs get new user-guide pages or fit into existing domain guides.
- Reconcile orphan pages and sidebar/index entries after new user-guide pages are created.
- Keep docs navigation dense and operational. Avoid marketing-style cards inside the in-app docs.
- Keep this lane bounded to route mapping, sidebar/index structure, and stale-link cleanup; do not let it absorb the feature-copy rewrite work.

## Next Chunk Guidance

1. Do the contextual docs IA refactor first, because several runtime routes currently fall back to generic pages.
2. Rewrite README and `docs/index.html` from this matrix after checking whether PR #582, #583, and #587 landed.
3. Add user-guide pages for Edge Nodes, wiki/founder kernel, managed documents, licensing readiness, capability-needs review, and native integrations.
4. Add freshness guards for route-map coverage and public/docs route links.
5. Do Docker-served portal UX verification for any in-app docs navigation changes; audit-only changes do not require a portal rebuild.
