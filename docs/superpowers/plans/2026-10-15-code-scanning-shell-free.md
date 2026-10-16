# Shell-free host package-manager execution

Backlog: BI-263055E3. Workroom: WC-F669983A.

## Evidence and existing design

GitHub reports eight open CodeQL `js/indirect-command-line-injection` alerts
(460–467) on main d0df32810b35f3cfbad6fe217aa124bf902dd0f7. The host command
adapter joins pnpm arguments into cmd.exe input; the process observer also
defaults to shell execution on Windows. The local-CI launcher delegates to the
adapter. Retain the shared adapter introduced by
[host claim recovery](../specs/2026-10-14-host-claim-recovery-design.md), replacing
its implementation rather than copying resolution into each caller.

[CodeQL guidance](https://codeql.github.com/codeql-query-help/javascript/js-indirect-command-line-injection/)
recommends executable plus argument arrays without a shell.
[Node's Windows guidance](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)
explains why directly executing a cmd shim is insufficient. Resolve installed
pnpm/Corepack JavaScript entrypoints and invoke them with the current Node
executable. Keep native pnpm executables and POSIX commands direct. Missing
supported installations fail explicitly; there is no shell fallback.

## Ordered work

One atomic deliverable HOST-ARGV implements requirement REQ-LITERAL-ARGV using
contract CT-HOST-COMMAND and flow FLOW-CI-LAUNCH. All sequencing below belongs to
BI-263055E3; none independently delivers the eight-alert repair.

1. Add regression fixtures for literal metacharacters, quotes, percent and bang
   expansion syntax, spaced paths, pnpm/Corepack installation layouts and absent
   installations. Verify the existing adapter fails these assertions.
2. Refactor `scripts/lib/host-command-invocation.mjs` to preserve argv without
   cmd.exe. Update local-CI pinning and observer execution, including generated
   pinned shims, so direct launches retain repository version selection.
3. Update affected script tests and platform support documentation. Run
   VERIFY-HOST-ARGV: scoped built-in Node tests, actual child argv round-trip,
   managed provisioning/readiness and the required pregate/context checks.
4. Publish a DCO-signed PR, verify CodeQL and all checks, queue merge and query
   the main-branch alert inventory again. Do not dismiss unresolved findings.

## Risk and rollback

Resolution must support npm global pnpm, Corepack and native standalone pnpm,
preserve PATH precedence and honor the already selected host executable. Avoid
reinterpreting generated pinning wrappers. Unsupported layouts must produce an
actionable failure. Revert the protected PR if compatibility fails; do not edit
the installed runtime. No UI, database schema or grant changes are required.

## Backlog coverage

Atomic mapping: HOST-ARGV -> BI-263055E3; dependencies: none. References:
REQ-LITERAL-ARGV, CT-HOST-COMMAND, FLOW-CI-LAUNCH, VERIFY-HOST-ARGV.
The immutable plan commit is submitted to record_plan_backlog_coverage before
source implementation; its governed receipt is recorded here after issuance.
