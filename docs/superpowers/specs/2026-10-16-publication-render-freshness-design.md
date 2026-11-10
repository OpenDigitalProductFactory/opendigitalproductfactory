---
title: Word publication requires freshly rendered Mermaid companions
date: 2026-10-16
status: active
backlog: BI-7939AE2A
epic: EP-B932453F
---

# Word publication requires freshly rendered Mermaid companions

## Problem and evidence

At `46bd5e2414bc90c1864016ef9d2159c2602fc5d7`,
`docs/architecture/generate-docx-from-markdown.mjs` decides freshness from an
SVG's timestamp, although `embeddableImagePath` embeds its PNG companion into
Word. A missing or old PNG therefore survives a fresh SVG. The same rendering
loop warns and continues when its renderer is unavailable or either rendering
fails. Conversion can then publish stale diagram content.

During the BI-928E1B0F edition review, the committed GAID receipt-chain PNG
omitted all eight messages present in its Mermaid source. A private invocation
of the actual generator and shared renderer adapter reproduced five failing
cases and a candidate correction. Those diagnostic results are not a committed
source gate, a published edition, or proof of runtime conformance.

## Scope and ownership

BI-7939AE2A owns the existing rendering loop, its behavioral regressions, and
this proportional design. BI-928E1B0F retains edition refresh, source parity,
layout and actual public-byte verification. BI-6CC40F77 retains the white paper
and its layout helper. BI-A484D58F owns normative text. The completed historical
BI-56C4EFCF and dependency-removal BI-DBDB8C6D supply provenance; neither is
reopened by this repair. BI-B97611BC validates Jekyll publication, and
BI-F6A81F64 repairs a Docker build-context omission; neither fixes this loop.

The authority boundary is a source-local publication command using public
repository files and the existing pinned renderer and hardened converter. It
does not execute a DPF business action or change a running installation. There
are no credential, grant, policy, schema, migration, normative text, dependency
or service changes. Refreshed public binaries, general image validation and a
new cache manifest are outside this unit.

## Chosen correction

For every Mermaid source present in the selected diagrams directory, render
both SVG and high-resolution PNG through `scripts/lib/mermaid-renderer.mjs`
on every publication invocation. Timestamp equality is not evidence that the
two formats represent the same source. Retain the existing configuration,
background, PNG scale, pinned renderer resolution and hardened doctools argv.

Render each pair into a fresh private temporary directory, keeping the SVG and
PNG extensions. Require both outputs to exist and be nonempty before copying
them to their publication paths, and always remove the temporary directory.
This prevents a local renderer that exits successfully without producing an
output from silently retaining an old companion. It is a presence/provenance
check, not an image parser or semantic diagram validator.

If a renderer is unavailable or either rendering fails, reject the publication
before HTML conversion and before writing the output DOCX. A previous DOCX
therefore remains intact. Successfully refreshed diagram files may remain after
a later rendering failure, but no new edition is published. A subsequent run
renders both formats again. This repair does not promise atomic multi-file
diagram updates or change missing non-Mermaid image handling.

Alternatives considered: checking both timestamps still trusts checkout times
as content identity; a content manifest would add persistence and invalidation
machinery for this small command. Re-rendering reuses the current adapter and
provides the needed companion-generation guarantee without either assumption.

## Acceptance criteria

- A fresh SVG with a stale PNG triggers both renders before conversion.
- A missing PNG triggers both renders before conversion.
- An unavailable renderer with existing images aborts before conversion and preserves the prior DOCX.
- An SVG or PNG rendering failure aborts before conversion and preserves the prior DOCX.
- A renderer that exits successfully without producing either companion aborts before conversion and preserves the prior DOCX.
- The normal successful publication path retains the existing shared renderer and hardened converter contracts.

## Ordered repair and verification

1. Claim exact generator and colocated test paths and inspect their impact
   contract. Reproduce stale and missing companions plus unavailable, SVG-fail
   and PNG-fail cases against the unchanged generator, including success exits
   without output. Exercise the actual
   publication entry point with controlled renderer/converter executables;
   never copy its freshness predicate into a test.
2. Remove the SVG-only shortcut and propagate rendering failures. Verify that
   the converter is not invoked on a rendering failure and that an existing
   DOCX is unchanged. Keep successful-path assertions on rendered formats and
   retained converter hardening.
3. Run the affected publication tests and required repository gate, then obtain
   an independent assessment of the exact committed change. Record native
   review accurately under the checked-in publication policy; unavailable or
   uncertain infrastructure is not a passing review.
4. Publish a DCO-signed ready PR, use the protected merge queue and record the
   merged identity. Its source result is a prerequisite for, and separate from,
   the later edition rendering and actual download checks in BI-928E1B0F.

This is one bounded, independently shippable bug fix. Rollback is a normal
revert of its source and tests; no data rollback or runtime mutation is needed.
More rendering work per publication is expected. Failure is deliberately
visible instead of silently retaining stale images.

## Current state

Design claim `IRD-D70146B836FC` admitted this source design in WC-965A7A3E.
The older broad architecture read claim initially blocked the code/test paths.
After its lease expired at 20:00:41 UTC, an ordinary native claim admitted the
exact generator/test paths and generated index. No release, force override or
approval was inferred from elapsed time. The earlier owner release request
`cmvbdwr9e4vem01ptdhn5a8ek` has not executed and is no longer a prerequisite for
this independently admitted scope. Reproduction and source verification still
precede the implementation and delivery claims.
