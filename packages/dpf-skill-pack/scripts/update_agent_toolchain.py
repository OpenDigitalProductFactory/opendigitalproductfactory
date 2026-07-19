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
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional


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


def process_spine_contract_path(skill_pack: Path) -> Path:
    return skill_pack / "process-spine-replacements.json"


def load_process_spine_contract(skill_pack: Optional[Path] = None) -> list[dict[str, Any]]:
    root = skill_pack or default_skill_pack_path()
    data = read_json(process_spine_contract_path(root), {})
    replacements = data.get("replacements")
    if not isinstance(replacements, list):
        raise SystemExit(f"Missing replacements[] in {process_spine_contract_path(root)}")
    return replacements


def load_process_spine_cleanup_policy(skill_pack: Optional[Path] = None) -> dict[str, Any]:
    root = skill_pack or default_skill_pack_path()
    data = read_json(process_spine_contract_path(root), {})
    policy = data.get("cleanupPolicy")
    if not isinstance(policy, dict) or not isinstance(policy.get("clients"), list):
        raise SystemExit(f"Missing cleanupPolicy.clients[] in {process_spine_contract_path(root)}")
    return policy


def codex_competitive_plugin_ids(skill_pack: Optional[Path] = None) -> list[str]:
    policy = load_process_spine_cleanup_policy(skill_pack)
    for client in policy.get("clients", []):
        if client.get("client") == "codex":
            ids = client.get("competitivePluginIds")
            if isinstance(ids, list):
                return [str(item) for item in ids if str(item)]
    return []


def _normalize_skill_id(value: object) -> str:
    return str(value or "").strip().lstrip("$@").lower()


def _dpf_aliases(entry: dict[str, Any]) -> set[str]:
    slug = _normalize_skill_id(entry.get("dpfSkill"))
    return {slug, f"dpf-platform:{slug}"}


def _retired_aliases(entry: dict[str, Any]) -> set[str]:
    aliases = {_normalize_skill_id(entry.get("retiredSkill"))}
    for alias in entry.get("retiredSurfaceIds") or []:
        aliases.add(_normalize_skill_id(alias))
    return aliases


def exposed_process_spine_skills_from_env() -> Optional[list[str]]:
    raw_json = os.environ.get("DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON")
    if raw_json:
        parsed = json.loads(raw_json)
        if not isinstance(parsed, list):
            raise SystemExit("DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON must be a JSON array")
        return [str(v) for v in parsed]
    file_path = os.environ.get("DPF_PROCESS_SPINE_EXPOSED_SKILLS_FILE")
    if file_path:
        raw = Path(file_path).read_text(encoding="utf-8").strip()
        if not raw:
            return []
        if raw.startswith("["):
            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                raise SystemExit("DPF_PROCESS_SPINE_EXPOSED_SKILLS_FILE JSON must be an array")
            return [str(v) for v in parsed]
        return [line.strip() for line in raw.splitlines() if line.strip()]
    raw_list = os.environ.get("DPF_PROCESS_SPINE_EXPOSED_SKILLS")
    if raw_list:
        return [part.strip() for part in re.split(r"[,\r\n]+", raw_list) if part.strip()]
    return None


def assess_process_spine_health(
    skill_pack: Path,
    exposed_skills: Optional[list[str]] = None,
) -> dict[str, Any]:
    replacements = load_process_spine_contract(skill_pack)
    exposed = None
    if exposed_skills is not None:
        exposed = {_normalize_skill_id(skill) for skill in exposed_skills if _normalize_skill_id(skill)}

    rows = []
    for entry in replacements:
        dpf_skill = str(entry.get("dpfSkill"))
        retired_skill = str(entry.get("retiredSkill"))
        skill_path = skill_pack / "skills" / dpf_skill / "SKILL.md"
        dpf_exposed = None if exposed is None else bool(exposed.intersection(_dpf_aliases(entry)))
        generic_exposed = None if exposed is None else bool(exposed.intersection(_retired_aliases(entry)))
        rows.append(
            {
                "dpfSkill": dpf_skill,
                "retiredSkill": retired_skill,
                "skillPath": str(skill_path),
                "installed": skill_path.exists(),
                "dpfExposed": dpf_exposed,
                "genericExposed": generic_exposed,
            }
        )

    missing_installed = [row["dpfSkill"] for row in rows if not row["installed"]]
    missing_exposed = [row["dpfSkill"] for row in rows if exposed is not None and not row["dpfExposed"]]
    conflicts = [
        {"dpfSkill": row["dpfSkill"], "retiredSkill": row["retiredSkill"]}
        for row in rows
        if exposed is not None and row["genericExposed"] and not row["dpfExposed"]
    ]
    severity = "ok"
    if missing_installed:
        severity = "fail"
    elif conflicts or missing_exposed:
        severity = "warn"

    return {
        "severity": severity,
        "replacements": rows,
        "installed": {
            "ok": not missing_installed,
            "total": len(rows),
            "present": len(rows) - len(missing_installed),
            "missingDpfSkills": missing_installed,
        },
        "exposed": {
            "state": "verified" if exposed is not None else "unknown",
            "total": len(rows),
            "present": (len(rows) - len(missing_exposed)) if exposed is not None else None,
            "missingDpfSkills": missing_exposed,
        },
        "conflicts": conflicts,
    }


def render_process_spine_health(verdict: dict[str, Any]) -> list[str]:
    lines = ["Process spine health:"]
    installed = verdict["installed"]
    if installed["ok"]:
        lines.append(
            f"  DPF-native replacement skills installed: OK ({installed['present']}/{installed['total']})."
        )
    else:
        lines.append(
            "  DPF-native replacement skills installed: MISSING "
            + ", ".join(installed["missingDpfSkills"])
            + "."
        )

    exposed = verdict["exposed"]
    if exposed["state"] == "verified":
        if exposed["missingDpfSkills"]:
            lines.append(
                "  DPF-native replacement skills loaded/exposed in this session: MISSING "
                + ", ".join(exposed["missingDpfSkills"])
                + "."
            )
        else:
            lines.append(
                f"  DPF-native replacement skills loaded/exposed in this session: OK ({exposed['present']}/{exposed['total']})."
            )
    else:
        lines.append(
            "  DPF-native replacement skills loaded/exposed in this session: unknown "
            "(this client did not provide active skill evidence)."
        )

    if verdict["conflicts"]:
        pairs = ", ".join(
            f"superpowers:{item['retiredSkill']} without {item['dpfSkill']}"
            for item in verdict["conflicts"]
        )
        lines.append(
            "  WARNING: DPF-native replacement skills are not active for visible retired "
            f"generic skills: {pairs}."
        )
    if verdict["severity"] != "ok":
        lines.append(
            "  Plain-language fix: restart the client after bootstrap; if the DPF "
            "replacements are still absent, repair the dpf-platform plugin exposure "
            "before project work begins."
        )
    return lines


def render_process_spine_cleanup_policy(policy: dict[str, Any]) -> list[str]:
    lines = ["Process spine cleanup/update:"]
    mode = str(policy.get("mode", "unspecified"))
    lines.append(
        f"  Policy: {mode} - rerun bootstrap/updater after DPF skill-pack changes; "
        "safe adapters never delete user-owned skill files or plugin caches."
    )
    for client in policy.get("clients", []):
        name = str(client.get("client", "client")).capitalize()
        ids = ", ".join(str(item) for item in client.get("competitivePluginIds", []))
        status = str(client.get("status", "unknown"))
        if status == "reconciles-safe-config":
            lines.append(f"  {name}: disables known competitive plugins when found ({ids}).")
        else:
            lines.append(f"  {name}: {status}; warns if competitive process skills are active ({ids}).")
    return lines


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


def _is_table_boundary(line: str) -> bool:
    stripped = line.strip()
    return canonical_toml_table_header(stripped) is not None or (
        stripped.startswith("[[") and stripped.endswith("]]")
    )


def upsert_toml_table(text: str, header: str, body_lines: list[str]) -> str:
    lines = text.splitlines()
    target_header = canonical_toml_table_header(header)

    # Collect the [start, end) span of EVERY table whose canonical key matches.
    # Canonical matching (added in #2657) already stops us appending a fresh
    # duplicate, but a config a pre-#2657 updater already corrupted still carries
    # a stray second copy. Collapsing all matches into one block heals that in
    # place -- a duplicate table is a TOML redefinition error, so leaving it
    # forces the operator to hand-delete the block on every run.
    ranges: list[tuple[int, int]] = []
    index = 0
    while index < len(lines):
        if target_header is not None and canonical_toml_table_header(lines[index]) == target_header:
            end = index + 1
            while end < len(lines) and not _is_table_boundary(lines[end]):
                end += 1
            ranges.append((index, end))
            index = end
        else:
            index += 1

    if not ranges:
        prefix = "\n" if text.strip() else ""
        return text.rstrip() + prefix + "\n".join([header, *body_lines]) + "\n"

    # Preserve the first occurrence's existing header spelling so we never
    # gratuitously reformat a table whose quoting another writer owns.
    first_start = ranges[0][0]
    block = [lines[first_start].strip(), *body_lines]
    removal = {ln for start, end in ranges for ln in range(start, end)}
    rebuilt: list[str] = []
    for i, line in enumerate(lines):
        if i == first_start:
            rebuilt.extend(block)
        if i in removal:
            continue
        rebuilt.append(line)
    return "\n".join(rebuilt).rstrip() + "\n"


def disable_competitive_codex_plugins(text: str, plugin_ids: list[str]) -> str:
    for plugin_id in dict.fromkeys(plugin_ids):
        if not plugin_id or plugin_id == PLUGIN_NAME:
            continue
        text = upsert_toml_table(
            text,
            f'[plugins."{plugin_id}"]',
            ["enabled = false"],
        )
    return text


def ensure_codex_config(
    home: Path,
    mcp_url: str,
    dry_run: bool,
    skill_pack: Optional[Path] = None,
) -> bool:
    path = codex_config_path(home)
    text = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    text = upsert_toml_table(
        text,
        f'[plugins."{PLUGIN_NAME}"]',
        ["enabled = true"],
    )
    text = disable_competitive_codex_plugins(text, codex_competitive_plugin_ids(skill_pack))
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
    home = home_dir()
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


def resolve_codex_binary() -> str | None:
    found = shutil.which("codex")
    if found:
        return found
    home = home_dir()
    candidates: list[str] = []
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidates.append(str(Path(local) / "Programs" / "Codex" / "codex.exe"))
        candidates.append(str(home / "AppData" / "Roaming" / "npm" / "codex.cmd"))
    else:
        candidates.extend([
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
            str(home / ".local" / "bin" / "codex"),
        ])
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def resolve_grok_binary() -> str | None:
    found = shutil.which("grok")
    if found:
        return found
    home = home_dir()
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


def resolve_antigravity_binary() -> str | None:
    """Locate Google Antigravity's `agy` CLI (a standalone Go binary).

    The official installer drops `agy` in ~/.local/bin on Unix and under
    %LOCALAPPDATA%\\Antigravity on Windows. Detection only — this script never
    runs the vendor installer; that stays an explicit operator opt-in in the
    bootstrap adapters (kernel DI-B91843F8C157, least-privilege deny-by-default).
    """
    found = shutil.which("agy")
    if found:
        return found
    home = home_dir()
    candidates: list[str] = []
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidates.append(str(Path(local) / "Antigravity" / "agy.exe"))
        candidates.append(str(home / ".local" / "bin" / "agy.exe"))
    else:
        candidates.extend([
            str(home / ".local" / "bin" / "agy"),
            "/opt/homebrew/bin/agy",
            "/usr/local/bin/agy",
        ])
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def antigravity_mcp_config_path(home: Path) -> Path:
    # Antigravity is Windsurf/VS Code-derived; its MCP config is a JSON block
    # keyed by `mcpServers`. The exact path is not yet pinned in public docs —
    # this is the documented default; the live install confirms it during the
    # EP-ANTIGRAVITY-001 evidence gate (BI-ECAE3494 / BI-47A81FEB).
    return home / ".antigravity" / "mcp_config.json"


def ensure_antigravity_mcp_config(home: Path, mcp_url: str, dry_run: bool) -> str:
    """Upsert the DPF `mcpServers.dpf` block into agy's JSON MCP config.

    Env-backed (no secret written): the CLI reads the token from
    DPF_MCP_BEARER_TOKEN at runtime. Idempotent — merges into any existing
    config rather than clobbering the operator's other MCP servers. Skips
    cleanly when `agy` is not installed (nothing to wire).
    """
    if resolve_antigravity_binary() is None:
        return "skipped: Antigravity CLI (agy) not found"
    path = antigravity_mcp_config_path(home)
    data = read_json(path, {})
    if not isinstance(data, dict):
        data = {}
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        servers = {}
    servers["dpf"] = {
        "type": "http",
        "url": mcp_url,
        "headers": {"Authorization": f"Bearer ${{{TOKEN_ENV_VAR}}}"},
    }
    data["mcpServers"] = servers
    if dry_run:
        return f"dry-run: would upsert dpf server into {path}"
    changed = write_json(path, data)
    return "converged" if changed else "already current"


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


# Bash-scoped blocking guards for Codex's user hook plane (~/.codex/hooks.json).
# decision-routing-guard is wired separately on AskUserQuestion (Gate A).
CODEX_BASH_GUARDS = (
    "lease-guard.mjs",
    "root-clone-guard.mjs",
    "compose-guard.mjs",
    "lease-punt-guard.mjs",
)
CODEX_ASK_GUARDS = ("decision-routing-guard.mjs",)


def codex_hooks_file(home: Path) -> Path:
    return home / ".codex" / "hooks.json"


def _dpf_hook_command(command: str, managed_hooks_dir: Path) -> bool:
    if not command:
        return False
    managed_prefix = str(managed_hooks_dir)
    if managed_prefix in command and ".mjs" in command:
        return True
    return any(name in command for name in (*CODEX_BASH_GUARDS, *CODEX_ASK_GUARDS))


def _build_codex_pre_tool_use_groups(managed: Path, *, dry_run: bool) -> list[dict[str, Any]]:
    hooks_dir = managed / "hooks"
    groups: list[dict[str, Any]] = []
    bash_entries = [
        {"type": "command", "command": f'node "{hooks_dir / guard}"', "timeout": 15}
        for guard in CODEX_BASH_GUARDS
        if dry_run or (hooks_dir / guard).exists()
    ]
    if bash_entries:
        groups.append({"matcher": "Bash", "hooks": bash_entries})
    ask_entries = [
        {"type": "command", "command": f'node "{hooks_dir / guard}"', "timeout": 15}
        for guard in CODEX_ASK_GUARDS
        if dry_run or (hooks_dir / guard).exists()
    ]
    if ask_entries:
        groups.append({"matcher": "AskUserQuestion", "hooks": ask_entries})
    return groups


def merge_codex_hooks_payload(existing: dict[str, Any], managed: Path, *, dry_run: bool) -> dict[str, Any]:
    """Upsert DPF plane-1 guards into ~/.codex/hooks.json without clobbering other hooks."""
    hooks_dir = managed / "hooks"
    payload = dict(existing) if isinstance(existing, dict) else {}
    events = payload.setdefault("hooks", {})
    if not isinstance(events, dict):
        events = {}
        payload["hooks"] = events

    pre_tool_use = events.get("PreToolUse")
    if not isinstance(pre_tool_use, list):
        pre_tool_use = []
    cleaned: list[Any] = []
    for group in pre_tool_use:
        if not isinstance(group, dict):
            cleaned.append(group)
            continue
        kept = [
            hook
            for hook in group.get("hooks", [])
            if isinstance(hook, dict)
            and not _dpf_hook_command(str(hook.get("command", "")), hooks_dir)
        ]
        if kept:
            cleaned.append({**group, "hooks": kept})
    dpf_groups = _build_codex_pre_tool_use_groups(managed, dry_run=dry_run)
    for dpf_group in dpf_groups:
        matcher = dpf_group.get("matcher")
        merged = False
        for group in cleaned:
            if isinstance(group, dict) and group.get("matcher") == matcher:
                existing_cmds = {
                    str(hook.get("command", ""))
                    for hook in group.get("hooks", [])
                    if isinstance(hook, dict)
                }
                for hook in dpf_group.get("hooks", []):
                    cmd = str(hook.get("command", ""))
                    if cmd and cmd not in existing_cmds:
                        group.setdefault("hooks", []).insert(0, hook)
                        existing_cmds.add(cmd)
                merged = True
                break
        if not merged:
            cleaned.insert(0, dpf_group)
    events["PreToolUse"] = cleaned
    return payload


def install_codex_hooks(managed: Path, home: Path, dry_run: bool) -> str:
    """Wire plane-1 guards into Codex's user hook plane (~/.codex/hooks.json).

    Plugin-bundled hooks still require interactive HOOK TRUST (BI-66EBEA06).
    Delivering the same guards via the user hook file ensures Codex discovers
    them alongside plugin hooks and surfaces them in `/hooks` for a one-time
    trust grant. We do NOT forge trusted_hash entries (openai/codex#21615).
    """
    path = codex_hooks_file(home)
    existing = read_json(path, {"hooks": {}})
    payload = merge_codex_hooks_payload(existing, managed, dry_run=dry_run)
    dpf_groups = _build_codex_pre_tool_use_groups(managed, dry_run=dry_run)
    if not dpf_groups:
        return "skipped: no guard scripts found in managed copy"
    if dry_run:
        bash_count = sum(len(g.get("hooks", [])) for g in dpf_groups if g.get("matcher") == "Bash")
        ask_count = sum(len(g.get("hooks", [])) for g in dpf_groups if g.get("matcher") == "AskUserQuestion")
        return f"dry-run: would merge {bash_count} Bash + {ask_count} AskUserQuestion guard(s) into {path}"
    changed = write_json(path, payload)
    return f"merged guards into {path}" + ("" if changed else " (unchanged)")


def codex_hook_trust_established(home: Path) -> bool:
    """True when Codex has persisted at least one hook-trust entry.

    Live-probed (BI-883FC2FC): absent `hooks.state` / `[hooks.state.*] trusted_hash`
    means every plugin + user hook is silently fail-open until the operator
    reviews `/hooks` and trusts. We treat ANY persisted trust as "operator has
    completed the flow at least once" — a coarse but non-forged signal.
    """
    config = codex_config_path(home)
    if config.exists():
        text = config.read_text(encoding="utf-8")
        if "hooks.state" in text and "trusted_hash" in text:
            return True
    for name in ("hooks.state", "hooks.state.toml"):
        state_path = home / ".codex" / name
        if state_path.exists() and state_path.stat().st_size > 0:
            return True
    return False


def codex_hook_trust_pending(home: Path, *, codex_present: bool) -> bool:
    if not codex_present:
        return False
    return not codex_hook_trust_established(home)


def codex_hook_trust_blocking_notice() -> list[str]:
    return [
        "",
        "ACTION REQUIRED — Codex hook trust not granted (BI-66EBEA06)",
        "Plane-1 governance guards are installed but will NOT run until you trust them.",
        "  1. Start Codex in this repo:  codex",
        "  2. Run:  /hooks",
        "  3. Review the hook roster below and choose 'Trust all and continue'",
        "  4. Start a new Codex session — guards should then DENY unsafe commands",
        "",
        "Upstream: https://github.com/openai/codex/issues/21615 (no non-interactive trust API).",
        "Per-invocation bypass only: codex exec --dangerously-bypass-hook-trust ...",
        "",
    ]


# One-line purpose per hook script. The operator granting hook-trust on Codex/Grok
# sees an opaque numbered list ("Hook 1..N") because the hook-object schema has no
# name/description field (BI-276EC984; upstream asks openai/codex#31469 and
# xai-org/plugin-marketplace#71). Until those land, the installer prints this roster
# so the trust decision is informed. Keyed by script basename; a CI test asserts
# every command hook in hooks.json has an entry here (kept in sync mechanically).
HOOK_PURPOSES = {
    "lease-guard.mjs": "blocks launching a long-running server without a nonprod lease",
    "root-clone-guard.mjs": "blocks destructive rm / git clean aimed at the root clone",
    "compose-guard.mjs": "blocks docker compose commands that tear down shared services",
    "lease-punt-guard.mjs": "blocks a runtime-bound gate (prisma migrate / db push) in a source-only worktree",
    "decision-routing-guard.mjs": "blocks asking the operator a platform decision with no kernel consultation",
    "ux-fit-precheck.mjs": "reminds to run a UX-fit review when editing UI surfaces",
    "spec-plan-doc-precheck.mjs": "reminds to attach a spec/plan/doc when writing gated files",
    "design-grounding-precheck.mjs": "reminds to review specs and current code substrate before UX/workflow edits",
    "tool-economy-precheck.mjs": "reminds about tool-economy budget when adding tool surface",
    "worktree-create.mjs": "seeds a new worktree with MCP config on WorktreeCreate",
    "process-spine-health-check.mjs": "SessionStart: warns when DPF-native replacement skills are missing or hidden by retired generic skills",
    "governance-freshness-check.mjs": "SessionStart: warns if governance guard wiring is stale",
    "uncommitted-work-guard.mjs": "SessionEnd/Stop/post-checkout: warns before uncommitted spec/plan loss",
}


def hook_script_basename(command: str) -> str | None:
    """Extract the `*.mjs` script name from a hook `command` string."""
    match = re.search(r"([A-Za-z0-9_.-]+\.mjs)", command or "")
    return match.group(1) if match else None


def hook_roster(skill_pack: Path) -> list[str]:
    """Human-readable roster of the plugin's hooks (name + purpose), grouped by event.

    Printed so an operator granting hook-trust on Codex/Grok knows what each numbered
    "Hook N" actually is (BI-276EC984). Order matches hooks.json, which is the order
    the trust UIs number them.
    """
    hooks_json = skill_pack / "hooks" / "hooks.json"
    try:
        data = json.loads(hooks_json.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    events = data.get("hooks", {})
    if not isinstance(events, dict):
        return []
    lines = ["Plugin hooks — what each numbered 'Hook N' in the Codex/Grok trust UI is:"]
    for event, groups in events.items():
        entry_lines = []
        n = 0
        for group in groups if isinstance(groups, list) else []:
            matcher = group.get("matcher") if isinstance(group, dict) else None
            for hook in group.get("hooks", []) if isinstance(group, dict) else []:
                n += 1
                base = hook_script_basename(hook.get("command", "")) or "?"
                purpose = HOOK_PURPOSES.get(base, "(undescribed — add to HOOK_PURPOSES)")
                mtag = f" [{matcher}]" if matcher else ""
                entry_lines.append(f"    Hook {n}{mtag}: {base} — {purpose}")
        if entry_lines:
            lines.append(f"  {event}:")
            lines.extend(entry_lines)
    return lines


def guard_liveness_advisory() -> list[str]:
    """Per-surface caveats about whether the plane-1 guards actually FIRE.

    "Installed" is not "enforcing". These are the live-probed (BI-883FC2FC)
    conditions under which the plane-1 PreToolUse guards are inert on the
    non-Claude surfaces, so the operator is not left believing enforcement is on
    when it is fail-open. See docs/superpowers/specs/2026-07-03-...-gates-design.md
    section 11.
    """
    codex_line = (
        "  Codex : guards are wired into ~/.codex/hooks.json and DENY correctly once trusted, "
        + "but Codex gates every non-managed hook behind interactive HOOK TRUST. Until you "
        + "open a Codex TUI session and choose 'Trust all and continue' in /hooks, every guard "
        + "is silently fail-open. There is no non-interactive trust API (openai/codex#21615); "
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
    parser = argparse.ArgumentParser(description="Update DPF Codex/Claude/Grok/Antigravity agent skills and MCP wiring.")
    parser.add_argument("--skill-pack-path", default=str(default_skill_pack_path()))
    parser.add_argument("--mcp-url", default=os.environ.get("DPF_MCP_URL", DEFAULT_MCP_URL))
    parser.add_argument("--codex-only", action="store_true")
    parser.add_argument("--claude-only", action="store_true")
    parser.add_argument("--skip-claude-cli-install", action="store_true")
    parser.add_argument("--skip-grok-cli-install", action="store_true")
    parser.add_argument(
        "--skip-antigravity-cli-install",
        action="store_true",
        help="Skip wiring the DPF MCP config into Antigravity's (agy) config.",
    )
    parser.add_argument(
        "--require-codex-hook-trust",
        action="store_true",
        help="Exit 2 when Codex is installed but hook trust has not been granted (BI-66EBEA06).",
    )
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
    process_spine_root = skill_pack if args.dry_run else managed
    if not process_spine_contract_path(process_spine_root).exists():
        process_spine_root = skill_pack
    process_spine_verdict = assess_process_spine_health(
        process_spine_root,
        exposed_skills=exposed_process_spine_skills_from_env(),
    )
    for line in render_process_spine_health(process_spine_verdict):
        print(line)
    for line in render_process_spine_cleanup_policy(load_process_spine_cleanup_policy(process_spine_root)):
        print(line)

    codex_present = resolve_codex_binary() is not None

    if not args.claude_only:
        ensure_codex_marketplace(home, version, args.dry_run)
        ensure_codex_config(home, args.mcp_url, args.dry_run, process_spine_root)
        codex_hooks_status = install_codex_hooks(managed, home, args.dry_run)
        print(f"  Codex      : marketplace + config converged; hooks {codex_hooks_status}")
        grok_status = "skipped by flag"
        if not args.skip_grok_cli_install:
            grok_status = install_grok_plugin(managed, args.dry_run)
        print(f"  Grok       : plugin install {grok_status}")
        # Grok's hook plane ignores plugin-bundled hooks (BI-883FC2FC), so the
        # blocking guards are delivered via the always-trusted global hook plane.
        grok_hooks_status = install_grok_hooks(managed, home, args.dry_run)
        print(f"  Grok hooks : {grok_hooks_status}")
        # Antigravity (agy): MCP-config wiring only. Its plugin-install verb and
        # hook plane are unconfirmed (EP-ANTIGRAVITY-001 evidence gate), so we do
        # not install a plugin or hooks here — just wire the governed MCP server.
        antigravity_status = "skipped by flag"
        if not args.skip_antigravity_cli_install:
            antigravity_status = ensure_antigravity_mcp_config(home, args.mcp_url, args.dry_run)
        print(f"  Antigravity: MCP config {antigravity_status}")

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

    exit_code = 0
    roster_printed = False
    trust_pending = codex_hook_trust_pending(home, codex_present=codex_present)
    if trust_pending:
        for line in codex_hook_trust_blocking_notice():
            print(line)
        for line in hook_roster(skill_pack):
            print(line)
        roster_printed = True
        require = args.require_codex_hook_trust or os.environ.get("DPF_REQUIRE_CODEX_HOOK_TRUST") == "1"
        if require:
            exit_code = 2
    if not roster_printed:
        for line in hook_roster(skill_pack):
            print(line)

    print("Done. Start a new Codex/Claude/Grok session to load updated skills.")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
