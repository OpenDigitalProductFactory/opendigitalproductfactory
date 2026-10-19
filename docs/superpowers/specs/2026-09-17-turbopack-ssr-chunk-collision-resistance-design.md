---
status: active
---

# Turbopack SSR chunk-name collisions — what moves the number, and what does not

**Date:** 2026-09-17 · **Backlog:** BI-49A76F44 (structural follow-up to BI-E6EF9C2C / PR #5421)

## Problem

Turbopack names every emitted chunk `<path-derived prefix>_<7-char hash>._.js`. Seven
base-38 characters is about 36 bits, and vercel/next.js#97765 records that at ~10^5
chunks with a shared prefix, pairs collide. A collision is not a warning: `next build`
aborts with "Two or more assets with different content were emitted to the same output
path", the portal image cannot be built, and the install cannot self-upgrade. That
blocked every upgrade from cddc1085 for 24 hours across four runs.

PR #5421 renamed one of the two colliding modules. That separates one pair and adds no
collision resistance; any commit can collide a different pair. This note records what
was measured on the real build stage, so the next person starts from numbers and not
from the same list of guesses.

Everything below was measured with `docker build --target build .` on `392e0f763`.
A host `next build` passes clean on the same tree and cannot reproduce any of it,
because the Docker stage compiles the narrower tree the Dockerfile COPY allowlist
admits. Only the image build is evidence.

## What the population actually is

| measure | value |
|---|---|
| SSR chunk files (`.next/server/chunks/ssr/*.js`) | 24,267 (plus one `.map` each) |
| chunks holding exactly one module | 20,766 |
| chunks holding two modules | 3,308 |
| chunks that are only async-loader stubs (`a.v(…)` wrappers) | 650 |
| chunks under 4 KB | 13,078 |
| largest prefix group, `apps_web_lib_<hash>` | 8,095 |
| next groups | `[root-of-the-server]_` 3,794 · bare `<hash>` 941 · `apps_web_lib_tak_` 734 |

The SSR layer is chunked per module. The count is the size of the module graph the
client-component SSR layer reaches, not a chunker budget.

**The hash space is smaller than 38^7.** Across the 8,095 `apps_web_lib_` names,
positions 2–7 use 36 distinct characters and position 1 uses only `0`, `1` and (rarely)
`2` — 3,966 / 4,003 / 126. The effective space per prefix is therefore about
2 × 36^6 ≈ 4.4 × 10^9, close to the "≈6 × 10^9" the upstream issue estimates. For the
largest group the expected number of colliding pairs per build is n²/2M ≈ 0.0075; the
sum over all prefix groups is ≈ 0.0095. That is roughly one broken build per hundred
distinct module-path sets, and the path set changes with every rename, move or new
file — which is how it was hit.

## Research & benchmarking — the levers, each measured

| lever | result | verdict |
|---|---|---|
| `experimental.turbopackChunking` `{ minChunkSize: 200000, maxChunkCountPerGroup: 8, maxMergeChunkSize: 1000000 }` | 24,267 chunks, 8,095 in the largest group — byte-identical population | client-only, as its documentation says; does not reach SSR |
| `experimental.turbopackScopeHoisting: true` | 24,267 / 8,095 — identical | does not merge SSR modules in 16.3.3 |
| module content, comments, build-cache toggles, `turbopackIgnore` on the five whole-project-tracing sites (PR #5421) | identical hashes | the name hash is over module paths only |
| `--webpack` | crashes in Next 16.2.7's minify-webpack-plugin (Dockerfile note) | unavailable |
| upstream widening to 10 base-38 characters (~52 bits), proposed on #97765 | unshipped; the issue is closed with no linked fix; 16.3.4 and 16.3.5 release notes do not touch chunk naming | the durable fix, not in our hands |

Comparable systems: webpack's `[contenthash]`/`[chunkhash]` default to 20 hex characters
(80 bits) and are configurable via `output.hashDigestLength`; Rollup/Vite default to 8
base-64 characters (48 bits) and expose `build.rollupOptions.output.chunkFileNames`.
Turbopack exposes neither the length nor the template for server chunks. DPF adopts
nothing from the config surface because there is nothing to adopt; it rejects the
"rename a module" pattern as a durable mitigation.

## Decision

1. **Track upstream and contribute the reproduction.** This install's evidence is
   unusually clean — deterministic, byte-identical colliding hashes across four target
   SHAs, both colliding modules identified by extracting them from the image, exact
   population counts, and the measured 3-symbol first position that shrinks the space.
   The comment below is ready to post on #97765; posting is an operator action.
2. **Keep the build-time classifier** (PR #5419) so a recurrence names its class
   immediately instead of a failed self-upgrade naming two files nobody recognises.
3. **Do not pursue the config levers further** on 16.3.x; both are measured inert for
   SSR. Re-measure only on a Next release whose notes touch chunking or chunk naming.
4. **The only in-tree lever is the module graph itself.** 20,766 single-module chunks
   means the SSR population tracks the number of modules the client-component layer can
   reach. Whether a handful of barrel files pull most of `apps/web/lib` into that graph
   is the question the next slice answers with the Turbopack trace, before anyone
   proposes restructuring imports on a hunch. That is filed as follow-up work, not
   started here.

## Upstream contribution (draft, for the operator to post on vercel/next.js#97765)

> Additional data from a production monorepo (Next 16.3.3, Turbopack, `output:
> "standalone"`): 24,267 SSR chunks; 8,095 share the prefix `apps_web_lib_` and are
> distinguished only by the 7-character hash. Two unrelated modules
> (`lib/crm/presentation.ts` and `lib/evidence/bounded-output.ts`) both emitted
> `apps_web_lib_1nqemst._.js` and the build aborted with "Two or more assets with
> different content were emitted to the same output path", byte-identical across four
> different commits, so it is deterministic on module paths (content edits do not move
> it). Renaming one module cleared it. Two observations that may help size the fix: (1)
> across those 8,095 names the first hash character takes only the values `0`, `1` and
> rarely `2` while positions 2–7 use 36 symbols, so the effective space is about
> 2 × 36^6 ≈ 4.4e9 rather than 38^7; (2) neither `experimental.turbopackChunking` nor
> `experimental.turbopackScopeHoisting` changes the SSR population at all, so users
> have no configuration escape. Widening to 10 characters would put this app's
> per-build collision expectation from ~1e-2 to ~1e-7.

## Non-goals

- Moving off Turbopack. `--webpack` is broken on this Next line and is not a
  collision fix anyway.
- Renaming modules pre-emptively. Every rename re-rolls every hash in its prefix group.
