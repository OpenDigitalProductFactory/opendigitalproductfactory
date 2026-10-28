# Keep Codex notify compatible with permission convergence

Backlog: BI-34E03B27. Profile: fix. Declared small; effective medium because the existing permission writer is sensitive.

## Problem and design grounding

On source base 631012db62307fa334ca0d0109e78f339050fba5,
`packages/dpf-skill-pack/scripts/routine_permissions.py` serializes every key
with JSON quotes. Codex desktop 26.1023.6621.0 reads quoted notify correctly,
but removes only bare notify when replacing an old computer-use runtime path.
It then appends a duplicate. The existing October 26 permissions backup has a
bare notify, while the later pre-repair snapshot has the quoted form. The
October 28 desktop log records repair then duplicate-key failure five milliseconds
later. Removing the appended line leaves the stale quoted root key and repeats
the same attempted replacement on startup.

BI-CAA7BE5D already fixed quoted-key handling in DPF-owned plugin and endpoint
writers. It did not cover the signed desktop's notify writer. Extend the existing
validated serializer and atomic permission plan, rather than modify the vendor
binary or add a configuration watcher. Existing permission restrictions, callback
arguments, native inspection and compare-before-replace remain authoritative.

## Objectives and acceptance

**OBJ-1:** Permission serialization remains compatible with Codex runtime replacement.
**OBJ-2:** Existing installs converge idempotently without changing callback or permission values.

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1, OBJ-2 | Permission writes emit a bare root notify key while preserving all parsed settings and callback arguments. |
| AC-2 | OBJ-2 | Existing quoted root notify converges once even when permission values are unchanged; the next run is byte-stable. |
| AC-3 | OBJ-1 | Repeated permission writes followed by desktop runtime replacement remain valid TOML with exactly one root notify. |
| AC-4 | OBJ-2 | Dry-run, backups, atomic replacement and concurrent-edit refusal remain intact; no permission policy or trust decision is broadened. |

AC-1: Permission writes emit a bare root notify key while preserving all parsed settings and callback arguments.
AC-2: Existing quoted root notify converges once even when permission values are unchanged; the next run is byte-stable.
AC-3: Repeated permission writes followed by desktop runtime replacement remain valid TOML with exactly one root notify.
AC-4: Dry-run, backups, atomic replacement and concurrent-edit refusal remain intact; no permission policy or trust decision is broadened.

## Ordered implementation

1. REQ-NOTIFY: Add regressions to the existing routine_permissions_test.py for
   scalar-key output, special-key quoting, existing quoted notify, multiline
   callback values, custom callback arguments and a second project trust write.
2. CONTRACT-TOML: Add one standard bare-key renderer for legal ASCII TOML keys;
   retain JSON quoting for special keys. Keep complete semantic round-trip
   validation. Permission values and policy remain unchanged.
3. FLOW-CONVERGE: If an existing Codex configuration has a root notify and a
   quoted notify assignment, canonicalize it through the same validated renderer
   even when permission values are otherwise unchanged. Use the existing dry-run,
   backup and atomic concurrent-edit checks. Subsequent convergence is byte-stable.
4. VERIFY-NOTIFY: Exercise serializer output followed by the desktop's observed
   replacement operation repeatedly; compare parsed values with only the expected
   runtime callback change. Run the complete permission suite and Python compile,
   then the governed publication gate and independent review.

One atomic deliverable: rendering and no-op convergence must ship together to
protect existing and newly written configuration. No permission setting is added
by this compatibility repair. Existing malformed duplicate-key TOML remains a
refusal requiring a scoped repair; do not guess which duplicate the owner wanted.

## Backlog coverage, risks and rollback

REQ-NOTIFY, CONTRACT-TOML, FLOW-CONVERGE and VERIFY-NOTIFY map to BI-34E03B27.
The immutable coverage receipt lives in the database. Canonicalization can change
formatting once; parsed values are the invariant. The existing backup preserves
the prior bytes. Revert the scoped serializer commit to roll back, retaining the
already repaired host configuration. Signed desktop code and trust are untouched.
