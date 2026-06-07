#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
SKILL_PACK_PATH="$(cd "$SCRIPT_DIR/.." && pwd -P)"
MCP_URL="${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}"

exec python3 "$SCRIPT_DIR/update_agent_toolchain.py" \
  --skill-pack-path "$SKILL_PACK_PATH" \
  --mcp-url "$MCP_URL" \
  "$@"
