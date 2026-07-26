# Codex DPF skill exposure repair plan

Backlog: BI-BCA162CF
Work capsule: WC-AD184862

## Outcome

After the DPF agent-toolchain bootstrap runs, Codex must report
`dpf-platform@personal` as installed and enabled, and a newly started Codex task
must expose the plugin's DPF-native skills. Bootstrap output must not use one
client's skill inventory as evidence for another client.

## Evidence and source of truth

- `codex plugin list --marketplace personal --available --json` resolves
  `./plugins/dpf-platform` to `~/plugins/dpf-platform`.
- The updater currently copies only to
  `~/.agents/plugins/plugins/dpf-platform`, which is the shared Claude/Grok
  source, and never calls `codex plugin add`.
- The bootstrap currently injects Grok's plugin inventory into a generic
  exposure variable and then labels the result as “this session.”
- Canonical implementation:
  `packages/dpf-skill-pack/scripts/update_agent_toolchain.py`.
- Platform adapters:
  `scripts/dpf-bootstrap-agent-toolchain.ps1` and
  `scripts/dpf-bootstrap-agent-toolchain.sh`.

## Implementation

1. Keep separate Codex and shared managed plugin copies because the clients
   resolve their local marketplace paths differently.
2. Resolve the runnable Codex app CLI, install through
   `codex plugin add dpf-platform@personal --json`, and verify the installed,
   enabled state through Codex's JSON inventory.
3. Remove cross-client exposure inference. Only explicit session-scoped
   evidence may produce a “loaded/exposed” verdict in the multi-client
   bootstrap.
4. Add regression tests for marketplace path resolution, actual Codex registry
   verification, dual managed copies, and Grok/Codex evidence isolation.
5. Re-run the updater against this install and verify both Codex registry state
   and a newly started task's skill catalog.

## Documentation impact

Update the skill-pack README because the operator/contributor installation
contract changes from one shared managed copy plus config toggling to
client-correct sources plus verified Codex installation.

## Design grounding

- Existing design:
  `docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md`.
- Existing implementation and merged exposure-adapter work: PR #3498.
- Decision: extend the existing updater and personal marketplace; do not add a
  parallel skill loader or direct `.agents/skills` links.
