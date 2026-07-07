#!/usr/bin/env python3
"""Install or update the DPF agent toolchain without a full DPF install.

This script is intentionally dependency-free. It lets a contributor install the
DPF platform plugin from a standalone `packages/dpf-skill-pack` checkout or
artifact, without Docker, pnpm, Prisma, or the portal runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


PLUGIN_NAME = "dpf-platform"
MARKETPLACE_NAME = "dpf-platform-local"
TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN"
DEFAULT_MCP_URL = "http://127.0.0.1:3000/api/mcp/v1"


def home_dir() -> Path:
    override = os.environ.get("DPF_AGENT_TOOLCHAIN_HOME")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home()


def default_skill_pack_path() -> Path:
    return Path(__file__).resolve().parents[1]


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Cannot parse JSON at {path}: {exc}") from exc


def write_json(path: Path, data: Any) -> bool:
    content = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    return write_text_if_changed(path, content)


def write_text_if_changed(path: Path, content: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    # Path.write_text() only grew its newline= kwarg in Python 3.10; the
    # bootstrap runs this script with the system python3, which is 3.9 on
    # stock macOS. Write bytes so LF endings survive on every platform.
    path.write_bytes(content.encode("utf-8"))
    return True


def validate_skill_pack(path: Path) -> dict[str, Any]:
    codex_manifest = path / ".codex-plugin" / "plugin.json"
    claude_manifest = path / ".claude-plugin" / "plugin.json"
    skills_dir = path / "skills"
    if not codex_manifest.exists():
        raise SystemExit(f"Missing Codex plugin manifest: {codex_manifest}")
    if not claude_manifest.exists():
        raise SystemExit(f"Missing Claude plugin manifest: {claude_manifest}")
    if not skills_dir.exists():
        raise SystemExit(f"Missing skills directory: {skills_dir}")
    manifest = read_json(codex_manifest, {})
    if manifest.get("name") != PLUGIN_NAME:
        raise SystemExit(f"Unexpected plugin name in {codex_manifest}: {manifest.get('name')}")
    return manifest


def copy_skill_pack(source: Path, destination: Path, dry_run: bool) -> bool:
    if dry_run:
        return True
    if destination.exists():
        shutil.rmtree(destination)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
    shutil.copytree(source, destination, ignore=ignore)
    return True


def codex_marketplace_path(home: Path) -> Path:
    return home / ".agents" / "plugins" / "marketplace.json"


def managed_plugin_path(home: Path) -> Path:
    return home / ".agents" / "plugins" / "plugins" / PLUGIN_NAME


def claude_marketplace_path(home: Path) -> Path:
    return home / ".agents" / "plugins" / ".claude-plugin" / "marketplace.json"


def codex_config_path(home: Path) -> Path:
    return home / ".codex" / "config.toml"


def ensure_codex_marketplace(home: Path, version: str, dry_run: bool) -> bool:
    path = codex_marketplace_path(home)
    data = read_json(
        path,
        {
            "name": "personal",
            "interface": {"displayName": "Personal"},
            "plugins": [],
        },
    )
    data.setdefault("name", "personal")
    data.setdefault("interface", {"displayName": "Personal"})
    plugins = data.setdefault("plugins", [])
    entry = {
        "name": PLUGIN_NAME,
        "source": {"source": "local", "path": f"./plugins/{PLUGIN_NAME}"},
        "policy": {"installation": "INSTALLED_BY_DEFAULT", "authentication": "ON_INSTALL"},
        "category": "Productivity",
    }
    replaced = False
    for index, plugin in enumerate(plugins):
        if plugin.get("name") == PLUGIN_NAME:
            plugins[index] = {**plugin, **entry}
            replaced = True
            break
    if not replaced:
        plugins.append(entry)
    if dry_run:
        return True
    return write_json(path, data)


def ensure_claude_marketplace(home: Path, version: str, dry_run: bool) -> bool:
    path = claude_marketplace_path(home)
    data = {
        "name": MARKETPLACE_NAME,
        "owner": {"name": "Digital Product Factory"},
        "metadata": {
            "description": "Personal marketplace for the standalone DPF platform agent plugin.",
            "version": version,
        },
        "plugins": [
            {
                "name": PLUGIN_NAME,
                "source": f"./plugins/{PLUGIN_NAME}",
                "description": "DPF-native agent plugin for contributor sessions.",
                "version": version,
                "author": {"name": "Digital Product Factory"},
                "category": "Governance",
                "tags": ["dpf", "skills", "kernel", "backlog"],
            }
        ],
    }
    if dry_run:
        return True
    return write_json(path, data)


def split_toml_dotted_key(key: str) -> list[str] | None:
    parts: list[str] = []
    current: list[str] = []
    quoted = False
    escape = False

    for char in key.strip():
        if quoted:
            if escape:
                current.append(char)
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                quoted = False
            else:
                current.append(char)
        elif char == '"':
            quoted = True
        elif char == ".":
            part = "".join(current).strip()
            if not part:
                return None
            parts.append(part)
            current = []
        else:
            current.append(char)

    if quoted or escape:
        return None
    part = "".join(current).strip()
    if not part:
        return None
    parts.append(part)
    return parts


def canonical_toml_table_header(line: str) -> str | None:
    stripped = line.strip()
    if not stripped.startswith("[") or not stripped.endswith("]") or stripped.startswith("[["):
        return None
    parts = split_toml_dotted_key(stripped[1:-1])
    if parts is None:
        return None
    return ".".join(parts)


def upsert_toml_table(text: str, header: str, body_lines: list[str]) -> str:
    lines = text.splitlines()
    start = None
    target_header = canonical_toml_table_header(header)
    for index, line in enumerate(lines):
        if target_header is not None and canonical_toml_table_header(line) == target_header:
            start = index
            break
    block = [lines[start].strip() if start is not None else header, *body_lines]
    if start is None:
        prefix = "\n" if text.strip() else ""
        return text.rstrip() + prefix + "\n".join(block) + "\n"
    end = start + 1
    while end < len(lines):
        stripped = lines[end].strip()
        if canonical_toml_table_header(stripped) is not None or (
            stripped.startswith("[[") and stripped.endswith("]]")
        ):
            break
        end += 1
    next_lines = lines[:start] + block + lines[end:]
    return "\n".join(next_lines).rstrip() + "\n"


def ensure_codex_config(home: Path, mcp_url: str, dry_run: bool) -> bool:
    path = codex_config_path(home)
    text = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    text = upsert_toml_table(
        text,
        f'[plugins."{PLUGIN_NAME}"]',
        ["enabled = true"],
    )
    text = upsert_toml_table(
        text,
        "[mcp_servers.dpf]",
        [
            f'url = "{mcp_url}"',
            f'bearer_token_env_var = "{TOKEN_ENV_VAR}"',
            "enabled = true",
        ],
    )
    if dry_run:
        return True
    return write_text_if_changed(path, text)


def ensure_claude_repo_mcp_config(skill_pack_path: Path, mcp_url: str, dry_run: bool) -> bool:
    """Keep the packaged Claude MCP descriptor current for standalone installs."""
    content = json.dumps(
        {
            "mcpServers": {
                "dpf": {
                    "type": "http",
                    "url": "${DPF_MCP_URL:-" + mcp_url + "}",
                    "headers": {"Authorization": "Bearer ${DPF_MCP_BEARER_TOKEN:-}"},
                }
            }
        },
        indent=2,
    ) + "\n"
    if dry_run:
        return True
    return write_text_if_changed(skill_pack_path / "claude.mcp.json", content)


def resolve_claude_binary() -> str | None:
    candidates: list[str] = []
    found = shutil.which("claude")
    if found:
        return found
    home = Path.home()
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidates.append(str(Path(local) / "Programs" / "Claude" / "claude.exe"))
        candidates.extend([
            str(home / ".claude" / "local" / "claude.exe"),
            str(home / "AppData" / "Roaming" / "npm" / "claude.cmd"),
        ])
    else:
        candidates.extend([
            str(home / ".claude" / "local" / "claude"),
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
            str(home / ".local" / "bin" / "claude"),
        ])
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def install_claude_plugin(home: Path, dry_run: bool) -> str:
    claude = resolve_claude_binary()
    if not claude:
        return "skipped: Claude CLI not found"
    marketplace_root = home / ".agents" / "plugins"
    if dry_run:
        return f"dry-run: would install {PLUGIN_NAME}@{MARKETPLACE_NAME}"
    commands = [
        [claude, "plugin", "marketplace", "add", str(marketplace_root), "--scope", "local"],
        [claude, "plugin", "install", f"{PLUGIN_NAME}@{MARKETPLACE_NAME}", "--scope", "local"],
    ]
    for command in commands:
        result = subprocess.run(command, cwd=str(marketplace_root), capture_output=True, text=True)
        if result.returncode != 0:
            return f"failed: {' '.join(command[:3])} exited {result.returncode}"
    return "installed"


def resolve_grok_binary() -> str | None:
    found = shutil.which("grok")
    if found:
        return found
    home = Path.home()
    candidates: list[str] = []
    if platform.system() == "Windows":
        candidates.append(str(home / ".grok" / "bin" / "grok.exe"))
    else:
        candidates.extend([
            str(home / ".grok" / "bin" / "grok"),
            "/opt/homebrew/bin/grok",
            "/usr/local/bin/grok",
            str(home / ".local" / "bin" / "grok"),
        ])
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def install_grok_plugin(managed: Path, dry_run: bool) -> str:
    """Install the plugin into Grok's OWN plugin store.

    Grok does not read Codex's `~/.codex/config.toml` marketplace; a plugin only
    surfaces skills/hooks in Grok when installed via `grok plugin install`. The
    `--trust` flag skips the interactive trust prompt (headless-safe). Installing
    from the managed copy — the dir that CONTAINS `.grok-plugin/` — is what makes
    the manifest's plugin-root-relative component paths resolve (BI-883FC2FC).
    """
    grok = resolve_grok_binary()
    if not grok:
        return "skipped: Grok CLI not found"
    if dry_run:
        return f"dry-run: would install {PLUGIN_NAME} from {managed}"
    result = subprocess.run(
        [grok, "plugin", "install", str(managed), "--trust"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return f"failed: grok plugin install exited {result.returncode}"
    return "installed"


# PreToolUse guards to wire into Grok's hook plane. Blocking safety/decision
# guards only; the Write/Edit advisory prechecks are Claude-shaped and non-blocking.
GROK_HOOK_GUARDS = (
    "lease-punt-guard.mjs",
    "decision-routing-guard.mjs",
    "lease-guard.mjs",
    "root-clone-guard.mjs",
    "compose-guard.mjs",
)


def grok_hooks_file(home: Path) -> Path:
    return home / ".grok" / "hooks" / "dpf-guards.json"


def install_grok_hooks(managed: Path, home: Path, dry_run: bool) -> str:
    """Wire the plane-1 guards into a hook plane Grok actually executes.

    Live probe (BI-883FC2FC, Grok 0.2.87) proved Grok runs PreToolUse blocking
    command-hooks and honors deny, but its hook-execution plane loads ONLY from
    ~/.grok/hooks, ~/.claude/settings.json, and ~/.cursor/hooks — NOT from a
    plugin's bundled hooks.json (a plugin shows has_hooks=true in inventory yet
    contributes total_hooks=0 to the plane). So `grok plugin install` surfaces the
    SKILLS but never the guards. This writes a global ~/.grok/hooks/dpf-guards.json
    pointing at the managed guard copies. Global hooks are always-trusted (no
    folder-trust prompt); the guards self-scope to DPF checkouts (inDpfWorkspace)
    so they never fire DPF-branded denials in unrelated repos. Kernel ledger
    DI-C17A5861CE0E (opt_global_context_gated).
    """
    hooks_dir = managed / "hooks"
    entries = [
        {"hooks": [{"type": "command", "command": f'node "{hooks_dir / guard}"', "timeout": 15}]}
        for guard in GROK_HOOK_GUARDS
        if (dry_run or (hooks_dir / guard).exists())
    ]
    if not entries:
        return "skipped: no guard scripts found in managed copy"
    payload = {"hooks": {"PreToolUse": entries}}
    path = grok_hooks_file(home)
    if dry_run:
        return f"dry-run: would write {len(entries)} guard(s) to {path}"
    path.parent.mkdir(parents=True, exist_ok=True)
    changed = write_json(path, payload)
    return f"wired {len(entries)} guard(s) -> {path}" + ("" if changed else " (unchanged)")


def guard_liveness_advisory() -> list[str]:
    """Per-surface caveats about whether the plane-1 guards actually FIRE.

    "Installed" is not "enforcing". These are the live-probed (BI-883FC2FC)
    conditions under which the plane-1 PreToolUse guards are inert on the
    non-Claude surfaces, so the operator is not left believing enforcement is on
    when it is fail-open. See docs/superpowers/specs/2026-07-03-...-gates-design.md
    section 11.
    """
    codex_line = (
        "  Codex : guards are Claude-contract-compatible and DENY correctly, but Codex "
        + "gates all plugin hooks behind interactive HOOK TRUST. Until you open a Codex TUI "
        + "session in this repo and choose 'Trust all and continue', every guard is silently "
        + "fail-open. There is no non-interactive trust API (codex-cli 0.142.x); "
        + "'--dangerously-bypass-hook-trust' is per-invocation only."
    )
    grok_line = (
        "  Grok  : guards now DENY (live-probed, Grok 0.2.87). Grok DOES execute PreToolUse "
        + "blocking command-hooks, but its hook plane ignores plugin-bundled hooks — so the guards "
        + "are wired into ~/.grok/hooks/dpf-guards.json (always-trusted) instead, and self-scope to "
        + "DPF checkouts. Restart Grok to load them; `/hooks` should list 5 PreToolUse guards."
    )
    return [
        "Guard liveness (plane-1 PreToolUse enforcement is NOT implied by install):",
        codex_line,
        grok_line,
    ]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Update DPF Codex/Claude/Grok agent skills and MCP wiring.")
    parser.add_argument("--skill-pack-path", default=str(default_skill_pack_path()))
    parser.add_argument("--mcp-url", default=os.environ.get("DPF_MCP_URL", DEFAULT_MCP_URL))
    parser.add_argument("--codex-only", action="store_true")
    parser.add_argument("--claude-only", action="store_true")
    parser.add_argument("--skip-claude-cli-install", action="store_true")
    parser.add_argument("--skip-grok-cli-install", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if args.codex_only and args.claude_only:
        raise SystemExit("--codex-only and --claude-only cannot be combined")

    skill_pack = Path(args.skill_pack_path).expanduser().resolve()
    manifest = validate_skill_pack(skill_pack)
    version = str(manifest.get("version", "0.0.0"))
    home = home_dir()
    managed = managed_plugin_path(home)

    print(f"DPF agent toolchain updater")
    print(f"  skill pack : {skill_pack}")
    print(f"  version    : {version}")
    print(f"  home       : {home}")
    print(f"  MCP URL    : {args.mcp_url}")

    copy_skill_pack(skill_pack, managed, args.dry_run)
    print(f"  managed copy: {managed}")

    if not args.claude_only:
        ensure_codex_marketplace(home, version, args.dry_run)
        ensure_codex_config(home, args.mcp_url, args.dry_run)
        print("  Codex      : marketplace + config converged")
        grok_status = "skipped by flag"
        if not args.skip_grok_cli_install:
            grok_status = install_grok_plugin(managed, args.dry_run)
        print(f"  Grok       : plugin install {grok_status}")
        # Grok's hook plane ignores plugin-bundled hooks (BI-883FC2FC), so the
        # blocking guards are delivered via the always-trusted global hook plane.
        grok_hooks_status = install_grok_hooks(managed, home, args.dry_run)
        print(f"  Grok hooks : {grok_hooks_status}")

    if not args.codex_only:
        ensure_claude_marketplace(home, version, args.dry_run)
        ensure_claude_repo_mcp_config(managed if not args.dry_run else skill_pack, args.mcp_url, args.dry_run)
        status = "skipped by flag"
        if not args.skip_claude_cli_install:
            status = install_claude_plugin(home, args.dry_run)
        print(f"  Claude     : marketplace converged; plugin install {status}")

    token_present = bool(os.environ.get(TOKEN_ENV_VAR))
    print(f"  MCP token  : {'present' if token_present else 'missing'} ({TOKEN_ENV_VAR})")
    for line in guard_liveness_advisory():
        print(line)
    print("Done. Start a new Codex/Claude/Grok session to load updated skills.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
