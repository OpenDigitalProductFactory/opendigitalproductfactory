# Generic client TOML on Python 3.9

BI-7C762BE3. Workroom WC-FB256E69. Related BI-90C9478D and
BI-4A28B171 delivered Codex fallback and client selection; this is the distinct
all-client semantic-parser regression. The root checkout stays read-only.

## Objective and requirements

REQ-GENERIC: Valid Grok TOML must not be judged against Codex's reserved schema.
REQ-PRESERVE: Preserve plugin strings, nested tables, quoted keys, arrays and
multiline string contents; refuse malformed or unsupported values before writes.
REQ-BOUNDARY: No configuration credentials are displayed, no real client files
are written during verification, and this task never upgrades the runtime.

## Existing contracts

CONTRACT-M4: docs/superpowers/specs/2026-10-27-self-converging-agent-toolchain-design.md
M4/M5 govern the existing parser and supported Python floor. Reuse its private
throwaway Codex home and stdlib/tomli preference, without another dependency.
Keep codex_toml.loads as the Codex-specific semantic reader. loads_any is the
generic syntax reader consumed by routine_permissions and the updater.

## Ordered atomic delivery

FLOW-PARSE: First add failing fixtures for non-Codex plugins. For the generic
fallback only, place the document beneath a private unknown root namespace,
prefix its real table headers and retrieve that raw user-layer subtree. A small
lexical scanner must distinguish table headers from comments and quoted or
multiline string content; Codex still parses the full TOML grammar. Never
normalize Grok's plugin semantics to Codex's schema. Preserve the existing
fail-closed behavior for unsupported TOML date/time values and unavailable CLI.

FLOW-VERIFY: Test ordinary and array tables, dotted/quoted keys, literal/basic
multiline strings, escapes, malformed input and unavailable parsers. Exercise
routine permission planning with temporary fixture homes for all clients,
checking preservation, dry-run nonmutation and idempotence. Read-only real
cross-client configuration validation prints counts/outcomes only.

VERIFY-UNIT: Run codex_toml_test.py, routine_permissions_test.py and the updater's
Python suites on stock Python 3.9. Observe red before the correction and green
after. Run Python compilation, relevant source guards and qualified delivery
checks. Obtain an independent source assessment; use a regular ready PR and
protected merge flow. No merge or installed-acceptance claim without its proof.

This is one atomic correction: the generic parser boundary and preservation
regressions must land together. No independently shippable phase or new runtime,
credential store, permission authority, client configuration writer or library.

## Risks and rollback

Lexical prefixing could alter multiline strings or table semantics; exact
parsed-value comparisons and round-trip fixtures guard that risk. Keep the
Codex-specific path unchanged. Rollback reverts this patch without editing
operator configurations. Unsupported parsing remains an honest refusal.

## Backlog coverage

Canonical coverage is recorded against this immutable plan blob before source
implementation. References: REQ-GENERIC, REQ-PRESERVE, REQ-BOUNDARY,
CONTRACT-M4, FLOW-PARSE, FLOW-VERIFY, VERIFY-UNIT.
