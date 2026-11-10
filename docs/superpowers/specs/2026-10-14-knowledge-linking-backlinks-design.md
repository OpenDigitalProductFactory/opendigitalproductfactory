---
status: active
---

# Wiki backlinks and unlinked mentions (BI-4EAFF7AC)

Scope manifest for BI-4EAFF7AC. The design is §4 of the
[knowledge linking design](2026-10-14-knowledge-linking-design.md), and the
scope rules R1–R7 in its §2 apply in full. This item depends on BI-23900D0A,
which makes the link rows correct, and on BI-825D3487, which provides the
corpus read grants. It builds the shared reader (§3.4) that later items reuse.

## Objectives and acceptance

**OBJ-KLB-1:** On any wiki page, a reader sees the pages that link to it and the pages that mention it without linking, limited to pages the reader can open.

**OBJ-KLB-2:** Backlinks never reveal a page the reader cannot open.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-KLB-1 | OBJ-KLB-1 | When N pages the reader can open cite a page, the panel lists exactly those N pages, matching the readable inbound `WikiPageLink` rows. Each row shows the title, kind chip, scope badge and link context. |
| AC-KLB-2 | OBJ-KLB-1 | Unlinked mentions lists readable pages whose plain text names the page's title or the last segment of its slug, and leaves out pages that already link to it. |
| AC-KLB-3 | OBJ-KLB-1 | The panel works on kernel, overlay and override pages, shows a plain empty state, and passes the UX-fit review and the theme rules. |
| AC-KLB-4 | OBJ-KLB-2 | A contract test plants an inbound link from a page in another organization and one from a page outside the reader's corpus grant. Neither appears and neither is counted. |
| AC-KLB-5 | OBJ-KLB-2 | "Link it" appears only on overlay pages the reader may edit, and it creates a proposal. It never appears on kernel or profession pages. |
| AC-KLB-6 | OBJ-KLB-2 | The wiki route takes the reader's organization from the session, not `prisma.organization.findFirst()`. A test with two organizations shows each reader only their own organization's overlay backlinks. |
