---
status: active
---

# DPF plugin installation convergence

Backlog: BI-024A5CDE. Workroom: WC-54BD4138.

## Observed defect and existing contract

Codex reports both `dpf-platform@personal` and
`dpf-platform@dpf-platform-local` installed and enabled. Both contribute skills
to the same session. The shared updater installs the personal registration but
only migrates the bare `dpf-platform` key, leaving the repository marketplace
registration active. Neither installed Codex manifest declares a logo.

Extend the existing agent-toolchain bootstrap design and standalone Python
updater; do not add another installer. Claude uses its existing qualified
marketplace identity, Grok its named plugin store, and Antigravity its skill
directory. They must retain their native contracts.

## Refreshed evidence (2026-10-01)

Codex's native inventory still reports both qualified DPF registrations enabled,
now on version 0.2.8. The one-plugin-owned-connector change in PR #5845 removes
duplicate MCP connector writers; it does not reconcile plugin marketplace
registrations. Preserve that change when updating the installer. The reported
Windows installation has one plugin and needs no duplicate cleanup.

[OpenAI's packaging contract](https://developers.openai.com/plugins/build/plugins)
supports `interface.logo` and `interface.composerIcon` in the existing Codex
compatibility manifest, with `./assets/` paths relative to the plugin root.
No new manifest format is needed for this repair. Native `codex plugin remove`
explicitly removes its cache, so this migration uses disable-not-delete.
One active plugin is the verifiable runtime contract; removal of the redundant
row from the desktop installed list needs separate visual evidence.
This repair declares `interface.logo`; it does not add a separate composer icon.

Baseline on the refreshed branch: 85 updater tests pass using the bundled
modern Python runtime, with no skips. macOS system Python passes with four
TOML-parser tests skipped because its standard library predates `tomllib`.

## Ordered repair

1. Add regression fixtures for the two enabled Codex registrations, disabled
   operator choices, dry runs, failed replacement installation, preserved
   unrelated settings and hook trust, and repeat-run convergence.
2. Verify the canonical personal plugin through the existing native CLI and
   content digest before disabling the obsolete DPF registration. Do not
   disable unrelated plugins or delete caches as part of this migration.
   Include the cross-marketplace inventory in convergence verification.
3. Package the existing platform brand asset with the standalone plugin and
   declare it through supported Codex manifest metadata. Verify copied assets
   resolve from the installed package, including after content-version changes.
4. Audit bootstrap entry points and Claude/Grok/Antigravity paths for duplicate
   DPF registrations and maintain one native installation per client. Update the
   skill-pack installation documentation with migration and recovery behavior.
5. Run the complete dependency-free Python updater suite (the code graph has no
   related tests indexed, so use the colocated exhaustive suite), applicable
   source guards, and the required shared/cloud gates. Use the repaired updater
   on this installation and confirm one active DPF registration through Codex's
   own inventory. Record desktop visual verification separately: computer use
   refuses access to the Codex app itself. Never report that check passed.

## Risks and rollback

An unsuccessful replacement must leave the prior plugin usable. Preserve
explicit disabled choices and existing trust records; do not manufacture hook
trust for changed code. The public source patch travels through a signed PR.
Rollback re-enables the preserved prior registration through normal settings;
the migration does not delete its cache. Installing the repaired package here
does not imply other installations have received it.

## Backlog coverage

One atomic installer repair maps to BI-024A5CDE. Regression checks, migration,
packaging, documentation and local verification jointly establish the same
one-active-plugin contract; they are internal sequencing, not independently
shippable features. Pre-implementation coverage receipt
`cmuqg3is401di01t36za1hg1d` binds this plan at commit
`907e1819df7616df3944cecd29df5c8e953f02c3` to the claimed scope, including the
packaged brand asset. The receipt was recorded before source implementation.

The entry-point audit found that repository bootstrap delegated to the shared
updater only on fallback. Coverage was refreshed as
`cmuqgtqqq0e5s01t33hg9hdse` at published commit
`d42541e60885e5eedbe008d34b9da2a0aeca12b3` before editing the shell and PowerShell
adapters. Both normal paths now refresh plugins before their configuration plan
reads preferences; they share the updater rather than duplicate its migration.
Independent review required narrowing that delegation to registration only.
The `--codex-plugin-only` mode owns Codex package/marketplace/registration refresh;
the normal configuration planner continues owning connector configuration and
other clients. The full updater runs only as the standalone command or the
existing failed-plan fallback. A regression preserves an operator-owned MCP
table byte-for-byte and proves no other client directories are written by the
registration-only mode.

## Separate access review

The workroom initially had no declared sensitivity and inherited an Internal
fallback. The operator restored access through the audited identity UI. Review
development classification, database policy and inference routing separately;
this plugin repair must not lower access controls or classify private install
evidence as public.
