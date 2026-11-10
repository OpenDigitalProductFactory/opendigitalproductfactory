#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
SKILL_PACK_PATH="$(cd "$SCRIPT_DIR/.." && pwd -P)"

# update_agent_toolchain.py owns the default endpoint (DPF_MCP_URL, else its
# canonical https origin) and the OAuth auth mode; callers may pass --mcp-url.
exec python3 "$SCRIPT_DIR/update_agent_toolchain.py" \
  --skill-pack-path "$SKILL_PACK_PATH" \
  "$@"
