# Founder Kernel — Raw Sources Licensing

This file enumerates the licensing approach for every raw source bundled in `docs/founder-kernel/raw-sources/`. It is a companion to [`/ACKNOWLEDGMENTS.md`](../../ACKNOWLEDGMENTS.md) (which credits ideas) and [`/NOTICE`](../../NOTICE) (which credits open-source software).

Spec: [`../superpowers/specs/2026-05-09-platform-kernel-wiki-design.md`](../superpowers/specs/2026-05-09-platform-kernel-wiki-design.md) §13.

---

## Policy

The DPF repository is licensed under Apache-2.0. The founder kernel ships in this repository, so every file under `docs/founder-kernel/raw-sources/` must be one of the following:

1. **Mark Bodman's original work** for which Mark holds copyright (LinkedIn articles he authored, DPF specs, original frameworks). Bundled fully under Apache-2.0 alongside the rest of the repository.
2. **Abstract + locator only** for third-party material. Includes title, authors, publication date, canonical URL, DOI (if any), short author-written abstract (Mark's words, not the source's), and 1–3 fair-use excerpts each ≤ 200 words. The full text stays at the original publisher.
3. **Pointer-only** for material under restrictive licenses (e.g. The Open Group IT4IT, CSDM). The kernel page is a stub linking to `[URL]` with a brief description of what the source contributes to DPF's thinking.

Material that fits none of the above does not belong in `raw-sources/`. Per-org installs may upload such material to their own overlay (`organizationId != NULL`, `isKernel = false`) at their own licensing responsibility.

## Frontmatter Convention

Every file under `raw-sources/` must declare in YAML frontmatter:

```yaml
---
sourceKey: papers/<slug>
sourceType: paper | article | spec | doc | framework | external-url
authorshipModel: original-by-mark | abstract-only | pointer-only
license: Apache-2.0 | <publisher-license-name> | proprietary
redistributable: true | false
url: https://...
---
```

`redistributable: true` is allowed only for `authorshipModel: original-by-mark`. The seed step (`packages/db/src/seed-wiki-kernel.ts`, Phase 5 of EP-WIKI-001) validates this invariant and refuses to seed sources that violate it.

## Per-Source Index

> No raw sources are bundled in kernel v0.1.0. Entries are added as Mark seeds content in Phase 5 of EP-WIKI-001.

When sources are added, each gets an entry below in this format:

```
### `<sourceKey>`

- **Title**: ...
- **Author(s)**: ...
- **Publisher / venue**: ...
- **URL**: ...
- **License**: ...
- **Authorship model**: original-by-mark | abstract-only | pointer-only
- **Rationale for inclusion**: ...
```
