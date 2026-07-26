---
title: Documentation content and visual quality
date: 2026-07-26
status: active
epic: EP-UX-SYSTEM
backlog:
  - BI-A51A8786
  - BI-5CC999F1
  - BI-EB04747F
  - BI-519DC022
---

# Documentation content and visual quality

The human-readable audit and implementation plan is the companion
[HTML artifact](2026-07-26-documentation-content-visual-quality.html).

DPF will use a hybrid publication model: semantic HTML for the public
storytelling surface, enriched Markdown with generated visuals for the shared
user-guide corpus, and selective GitHub-safe HTML plus images in the repository
README. This preserves the documentation system's canonical indexing, link,
diagram, and impact contracts while improving visual explanation.

## Backlog coverage

- Umbrella: `BI-A51A8786`
- Decision: `decomposed`
- Coverage receipt: `cms2c4bms002i01qod4bv1lt2`
- Public overview: `BI-5CC999F1`
- Repository README: `BI-EB04747F`
- User guide: `BI-519DC022`
- Existing progressive-disclosure dependency: `BI-1D718FCA`

Each mapped deliverable is independently shippable and must use one branch and
one PR. The user-guide slice must not overlap the active capsule currently
editing `docs/user-guide/ai-workforce/*`.

## Design grounding

- `docs/superpowers/specs/2026-07-16-documentation-system-design.md`
- `docs/superpowers/plans/2026-05-14-docs-public-site-current-state-refresh.md`
- `docs/superpowers/plans/2026-07-04-documentation-definition-of-done.md`
- `docs/platform-usability-standards.md`
- `docs/superpowers/html-artifacts-guide.md`
- `README.md`, `docs/README.md`, `docs/index.html`, and
  `docs/user-guide/index.md`

UX-fit decision: `fits-with-guardrails`. The format choice was ratified by
`principle_decide` interaction `DI-6D6BB6BFC1ED`, which recommended the
hybrid-by-surface model with high confidence.
