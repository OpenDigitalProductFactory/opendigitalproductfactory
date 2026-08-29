---
status: active
---

# Release images must materialize their Git LFS assets

**Backlog item:** BI-FEE26C36

## Problem

Every install fed by a published release artifact fails one seed step:

```
  x [seed] step "eaReferenceModels" FAILED (continuing): invalid zip data
================ SEED INCOMPLETE: 1 step(s) failed ================
```

Observed on self-upgrade SUR-946F62CC (2026-08-29, `ef3ba508` -> `d9ed4bdb`,
`v2026.08.29-review-prerequisite-recovery.1`). It fails non-fatally, so the
portal starts and the degradation is easy to scroll past. It has been failing on
every upgrade, because every release ships the same bytes.

## Evidence and root cause

`packages/db/src/seed-ea-reference-models.ts:20` reads
`docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx`. An `.xlsx` is a zip
archive, so "invalid zip data" means the file is not a workbook.

It is a Git LFS pointer. Inside the running release image:

```
/app/docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx   130 bytes
  version https://git-lfs.github.com/spec/v1
  oid sha256:be8951db1c...
  size 5004...
```

The same path in a source checkout is 50044 bytes and starts with `PK`.

The chain that produces this:

- `.gitattributes` tracks `*.xlsx` through LFS.
- `.dockerignore:30` deliberately un-ignores this one workbook, and
  `Dockerfile:193` copies it into the image.
- `.github/workflows/publish-image.yml` checks out with `actions/checkout@v7`
  and no `lfs` input, in the `build` job that supplies the image context.

`actions/checkout` does not fetch LFS objects unless asked, so the pointer file
is what reaches the build context, and the COPY bakes it in. The stub's mtime
inside the image is the image build time, which rules out a runtime mount as the
source.

Nothing downstream can recover: `EaReferenceModelElement` stays empty, so EA
views, reference-model comparison and architecture conformance all read an empty
table on every consumer install.

## Why the existing guard does not catch it

`seedEaReferenceModels` already carries a row-count assertion from BI-98D19DF2
for precisely this scenario -- its comment names "an LFS pointer stub
masquerading as the real .xlsx". That guard runs *after* the workbook read and
asserts the imported row count. Here the xlsx parser throws on the stub first, so
the anticipated failure arrives through a path the guard cannot observe.

The lesson generalises: a guard placed after a read cannot cover a read that
throws. The assertion has to sit where the bytes enter the artifact.

## Research and benchmarking

How comparable projects keep LFS assets out of their images by accident, and what
each approach costs:

| Approach | Used by | Cost | Fit |
| --- | --- | --- | --- |
| `lfs: true` on `actions/checkout` | GitHub's own documented default for LFS repos; Grafana, Godot CI | Fetches every LFS object in the repo (~11 files here: pdf, docx, pptx, xlsx) | Simple, declarative, one line |
| `git lfs pull --include=<path>` after checkout | Unity CI templates, large game repos | Fetches only what the image needs; an extra step to keep in sync with the Dockerfile | Cheaper bandwidth, more moving parts |
| Take the file out of LFS | Common once a "binary" turns out to be small | Changes `.gitattributes` for every `*.xlsx`; adds a new blob | Removes the failure mode rather than guarding it |
| Fetch at container runtime | Some ML images | Network dependency at install time; breaks air-gapped installs | Rejected -- a sovereign install must not need the network to seed |

DPF's own doctrine settles the tie-break. "A built image carries the identity of
its bytes" (`AGENTS.md` §12) means the artifact must be complete at build time,
not repaired later; and "fix the seed, not the runtime" means the correction
belongs in the publish path.

## Decision

Adopt `lfs: true` on the `build` job's checkout, and add a materialization
assertion to the Dockerfile.

`lfs: true` is chosen over the targeted `git lfs pull` because the include-list
would be a second place recording which LFS assets the image needs -- the
`.dockerignore` allowlist and the Dockerfile COPY already say that twice, and a
third copy is the kind of drift `AGENTS.md` §1 exists to prevent. The whole LFS
set for this repo is small enough that the bandwidth difference does not justify
the coupling.

Taking `*.xlsx` out of LFS is attractive and is worth doing on its own merits,
but it is a wider change to `.gitattributes` affecting files this defect does not
touch, and it would leave the publish path still able to ship a pointer for the
`.pdf` and `.docx` assets if one is ever COPYed. Fixing the publish path covers
every LFS asset, present and future.

## The guard

A `RUN` assertion immediately after the COPY in `Dockerfile`, failing the build
with a named error when the copied workbook is a pointer rather than a zip.

This belongs in the Dockerfile, not in a repo-policy guard: in the repository the
file is *supposed* to be a pointer, so no source-tree check can distinguish
healthy from broken. Only the build context can. Placing it in the Dockerfile
also means a local `docker build` is covered, not only the publish workflow.

The assertion fails the *publish*, never the install. That is the correct
direction: a release that cannot seed its reference models should not become
`:latest`.

Note that no PR check builds the image (`Production Build` runs `next build`), so
this guard fires at publish time. A workflow-shape test covers the case the
Dockerfile guard cannot see -- someone removing `lfs: true` from the checkout --
by asserting the input is present in the job that builds image contexts.

## Blast radius

- `lfs: true` adds one LFS fetch to the `build` job. The repo's LFS set is 11
  files; no other job changes.
- The Dockerfile `RUN` adds no layer content of consequence and runs in the
  `init` stage that already holds the COPY.
- No schema change, no runtime code change, no API change.
- Existing installs are repaired by the next upgrade: the seed step stops
  failing and imports the IT4IT and BIAN models on first successful run.

## Verification

- A freshly built image holds a real workbook at
  `/app/docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx` (zip magic,
  ~50 KB).
- `pnpm seed` completes with zero failed steps against a release image.
- `EaReferenceModelElement` is non-empty for both the IT4IT and BIAN models.
- Removing `lfs: true` from the workflow fails the new workflow-shape test.
- Feeding a pointer stub into the build context fails the image build with the
  named error rather than producing a publishable image.

## Follow-on: the guard also fires on the git-source upgrade path

**Backlog item:** BI-DDB48B04

The blast radius above says "no runtime code change" and reasons entirely about
the publish path. That is where this design was incomplete, and it broke every
upgrade on the git-source install shape within two hours of merging.

The Dockerfile assertion is enforced on **every** build of this Dockerfile, not
only CI's. On a git-source install the self-upgrade promoter builds the same
Dockerfile, and its build context is the `.upgrade-workspace` tree that the
**portal container** clones in `apps/web/lib/self-upgrade/prepare-source.ts`.
That path has no `actions/checkout`, so nothing was supplying `lfs: true`'s
guarantee. Two things then made pointer stubs the only possible outcome:

- the portal runner stage installed `git` but not `git-lfs`; and
- `defaultGitRunner` sets `GIT_LFS_SKIP_SMUDGE=1` on purpose, so the mechanical
  branch/merge operations never block on the network.

Result: `SUR-8784ADFE` (08:02) and every scheduled run after it failed ~2 minutes
into the promoter build, on the zip-magic assertion, with the cause visible only
in raw Docker output and the run row's `reason` column left empty.

The assertion itself was right and stays. What changed:

- **`Dockerfile`** — the runner stage installs `git-lfs`, so the workspace clone
  can materialize LFS objects at all. A shape test in
  `scripts/publish-image-release-identity.test.mjs` ratchets it, alongside the
  two this design already added.
- **`apps/web/lib/self-upgrade/lfs-materialization.ts`** (new) — after the
  workspace tree is final, `git lfs pull` then `git lfs ls-files`, and any path
  still marked `-` fails the run with reason `lfs-unmaterialized`.

Deliberately **generic**, not a second per-file check: `.gitattributes` LFS-tracks
`*.pdf`, `*.xlsx`, `*.docx` and `*.pptx`, while the Dockerfile asserts only the
one workbook it COPYs. A stub in any other tracked path was — and otherwise would
remain — invisible until something read it.

The wider lesson for this repo's two install shapes: a guard added for the
published-image shape lands on the git-source shape too, because both build this
Dockerfile. "Fail the publish, never the install" only holds if the install path
can satisfy the assertion. Ask which shapes execute a guard before assuming the
one you are fixing is the only one.
