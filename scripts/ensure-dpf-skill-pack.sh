#!/usr/bin/env bash
# Open Digital Product Factory -- contributor plugin installer (POSIX)
#
# Ensures the repo-local dpf-platform plugin is available to contributor
# coding clients without affecting customer coworker seeding. Surface B always
# seeds from packages/dpf-skill-pack via packages/db/src/seed-skills.ts.

set -euo pipefail

repo_root="${1:-$PWD}"
repo_root="$(cd "$repo_root" && pwd -P)"

ok() { printf '  [OK] %s\n' "$1"; }
skip() { printf '  [SKIP] %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }

printf '\n-> Ensuring DPF contributor plugin\n'

claude_marketplace="$repo_root/.claude-plugin/marketplace.json"
claude_plugin_manifest="$repo_root/packages/dpf-skill-pack/.claude-plugin/plugin.json"
codex_marketplace="$repo_root/.agents/plugins/marketplace.json"
codex_plugin_manifest="$repo_root/packages/dpf-skill-pack/.codex-plugin/plugin.json"

if [ -d "$HOME/.claude" ] && command -v claude >/dev/null 2>&1; then
  if [ -f "$claude_marketplace" ] && [ -f "$claude_plugin_manifest" ]; then
    (
      cd "$repo_root"
      claude plugin validate "$claude_plugin_manifest" >/dev/null
      claude plugin validate "$claude_marketplace" >/dev/null
      claude plugin marketplace add ./ --scope local >/dev/null
      claude plugin install dpf-platform@dpf-platform-local --scope local >/dev/null
    ) && ok "Claude Code local scope points at dpf-platform." \
      || warn "Claude Code dpf-platform install failed (non-fatal)."
  else
    warn "Claude marketplace or plugin manifest missing; skipping Claude Code skill install."
  fi
else
  skip "Claude Code home/CLI not detected; Surface A install deferred."
fi

if [ -f "$codex_marketplace" ] && [ -f "$codex_plugin_manifest" ]; then
  ok "Codex repo marketplace is present at .agents/plugins/marketplace.json."
  ok "Codex will discover dpf-platform as the repo plugin for DPF skills and MCP wiring."
else
  warn "Codex marketplace or plugin manifest missing."
fi

printf '\n'
