# Offline recovery preparation and compatible rollout

BI-7A4E70E9 owns the [offline recovery design](../superpowers/specs/2026-10-14-offline-recovery-execution-design.md).
The current preparation provides validation and filesystem primitives. It does
not expose an executable offline restore command or satisfy the design's outage
acceptance. Operator authorization still comes from the supported recovery
procedure and pre-enrolled independent authorities, never from this document.

## Available source primitives

- `offline-recovery-authority.mjs` verifies exact canonical approval bytes,
  distinct pre-enrolled public Ed25519 keys, installation/runtime bindings,
  epochs, expiry, bounded actions and rollback deadlines. A verifier success
  alone grants no runtime mutation capability.
- `offline-recovery-kit.mjs` reads protected POSIX files and checks original
  ancestry and directory generations. Enrollment remains outside the kit.
- `offline-recovery-enrollment.mjs` supplies a create-new POSIX enrollment
  helper. An administrator supplies independently witnessed public key pins and
  a manifest signed by both owners. It verifies the exact manifest, installation
  and expiry before writing a private canonical trust file, flushes it, and
  checks file and parent generations. The directory flush uses the retained,
  no-follow directory descriptor whose identity was verified before creation.
  It never replaces an existing enrollment,
  receives private keys, or enrolls keys from a portable kit. There is no
  operator-facing enrollment command yet. Rotation and epoch advancement still
  require the remaining shared-writer protocol. A late flush failure retains
  complete or partial output for inspection; it does not prove no file exists.
- `offline-recovery-kit-prepare.mjs` copies the captured verified public bytes
  into a new protected destination, flushes them and verifies the result.
  Interrupted writes retain their destination for inspection. A late directory
  flush failure can report an error while leaving a complete, loadable kit;
  failure does not imply that the destination is absent or incomplete.
- `runtime-apply-lock.mjs` binds the existing apply-lock pathname to a process
  start identity, host, token and directory generations. It refuses every
  existing claim, including dead owners, because owner death does not establish
  descendant or Docker-daemon settlement. It does not reclaim automatically.
- `install-state-transaction.mjs` accepts an in-process held lock for bounded
  update/restore transactions without reacquiring or releasing its caller's
  lock. Copies of a handle are not capabilities. Borrowing is exclusive through
  temporary-file cleanup, and generation mismatch preserves replacement files.

Windows protected offline files and apply locking remain unavailable. Existing
Windows key initialization retains its ACL path. POSIX check-then-unlink is not
an atomic conditional deletion against arbitrary external replacement; these
helpers do not claim protection against a hostile same-user/root filesystem
writer. Full cooperative writer integration and settlement are still required.
Legacy apply/rotation paths no longer erase an apply lock merely because its
timestamp expired.

## Release sequence

The already-deployed portal stages candidate promoter files from its own fixed
list. Adding a helper and importing it from an existing entrypoint in the same
release would break that older caller before it could upgrade itself. The
existing N-1 closure evidence remains in
`scripts/promoter-closure-n-minus-one.json` and must not be advanced merely
because candidate source contains a new file.

1. Ship the staging list, portal-baked files, JIT recipe and release bundle
   together, with the new helpers inactive. Existing entrypoints and candidate
   readiness must continue to work with only the historical staged file set.
   This preparation does not activate key rotation's new shared-lock integration
   or an offline service swap.
2. Verify canonical deployment of the staging release before recording its
   released closure. Preserve the actual release identity and evidence.
3. Enable shared apply ownership across all runtime writers, including promoter,
   and the bounded recovery executor only after the remaining design contracts
   and canonical isolated failure exercises pass. Preserve the tested rotation
   integration for that activation; do not treat preparation as completion.

The compatibility tests separately enforce complete imports for every current
staged module and N-1 imports for candidate modules the old caller actually
stages. A new inactive module may depend on another newly staged module; an
existing staged entrypoint may not import either before rollout. Tests also
reject new candidate readiness requirements absent from old staging and execute
key initialization from a temporary directory containing only historical staged
files. That source-local execution is not a canonical runtime or deployment test.

## Remaining acceptance

Operational witnessed enrollment and epoch advancement, all-writer exclusion,
measured descendant/daemon settlement, bounded restore/resume/rollback, signed
journal and authenticated idempotent evidence import remain required. The final
path must pass the design's portal/MCP/queue/approval-store/self-upgrade outage
exercises on the canonical isolated target. Until then, unavailable gates remain
unrun and the original recovery outcome remains open.
