---
title: Preserve working Codex configuration during toolchain convergence
status: active
author: Mark Bodman
date: 2026-10-26
backlog:
  - BI-CAA7BE5D
---

# Preserve working Codex configuration during toolchain convergence

The routine-permission serializer introduced in PR #6596 quotes scalar keys.
This is valid TOML, but the existing updater recognized only bare scalar keys.
A later refresh retained `"enabled"` and `"url"` while adding equivalent bare
keys. Codex then refused its entire configuration. The endpoint reader also
missed the saved URL and substituted the default origin.

## Scope and implementation order

1. Reproduce permission apply followed by core updater refresh on temporary
   homes, on base a797ececb85bd5d3be63bcfc93e878210a4af585.
2. Centralize scalar-key identity for bare, basic-quoted and literal-quoted
   spellings, reusing the table-key decoder. Preserve operator choices.
3. Validate the complete candidate before both dry-run success and any TOML
   write. Stage in the destination directory, flush, and atomically replace.
   Reject unavailable parsing or invalid candidates without native Codex
   mutations; report failure while allowing other clients to converge.
4. Test the composed permission/updater sequence twice, malformed candidates,
   missing parser and failed replacement. Verify the native Codex parser on
   an isolated copy of the operator configuration, without a model call.
5. Deliver through the protected PR and canonical release/updater path.

## Acceptance

- Permission apply followed by refresh produces parseable TOML, preserves the
  selected endpoint, disabled plugin, custom authentication and unrelated data.
- Repeating both writers is byte-stable on the converged fixture.
- Invalid candidates, missing parsers and staging/replacement failures leave
  the previous configuration intact. Dry-run cannot endorse invalid TOML.
- The native Codex parser accepts an updated copy of the repaired host config.

## Why the existing checks missed it

The permission writer tested its own semantic round trip and idempotence. The
updater tested its own bare-key fixtures. The bootstrap CI workflow discovers
both suites, but neither exercised their output/input boundary. The shared
updater file writer did not parse the final document, so no runtime invariant
stopped duplicate keys. This repair puts the composition test in that existing
CI-discovered suite and validation in the shared TOML write boundary.

The source worktree's Python tests are source-local evidence. They are not a
claim that the canonical installed release has already advanced. Fleet exposure
exists in shared code; the number of affected installations is unknown.
