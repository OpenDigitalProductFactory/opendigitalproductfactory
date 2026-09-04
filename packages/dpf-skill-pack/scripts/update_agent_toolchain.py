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
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


PLUGIN_NAME = "dpf-platform"
CODEX_PLUGIN_ID = f"{PLUGIN_NAME}@personal"
MARKETPLACE_NAME = "dpf-platform-local"
TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN"
DEFAULT_MCP_URL = "http://127.0.0.1:3000/api/mcp/v1"


def with_mcp_catalog_tier(mcp_url: str, tier: str) -> str:
    """Set DPF's explicit catalog tier while preserving other query state."""
    if tier not in {"core", "full"}:
        raise ValueError(f"Unsupported DPF MCP catalog tier: {tier}")
    parsed = urlsplit(mcp_url)
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key != "tier"
    ]
    query.append(("tier", tier))
    return urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment)
    )


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


def codex_managed_plugin_path(home: Path) -> Path:
    """Return the source path Codex resolves for the personal marketplace.

    Codex resolves `./plugins/<name>` in ~/.agents/plugins/marketplace.json
    against the user home, not against the marketplace file's directory.
    `codex plugin list --available --json` reports this exact absolute path.
    """
    return home / "plugins" / PLUGIN_NAME


def shared_managed_plugin_path(home: Path) -> Path:
    """Return the managed copy consumed by Claude, Grok, and global hooks."""
    return home / ".agents" / "plugins" / "plugins" / PLUGIN_NAME


# Backward-compatible name for existing hook/install helpers and callers.
def managed_plugin_path(home: Path) -> Path:
    return shared_managed_plugin_path(home)


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


def competitive_plugin_ids_for(client_name: str, skill_pack: Optional[Path] = None) -> list[str]:
    """Contract-backed competitive plugin ids for one client (disable-not-delete)."""
    policy = load_process_spine_cleanup_policy(skill_pack)
    for client in policy.get("clients", []):
        if client.get("client") == client_name:
            ids = client.get("competitivePluginIds")
            if isinstance(ids, list):
                return [str(item) for item in ids if str(item)]
    return []


def codex_competitive_plugin_ids(skill_pack: Optional[Path] = None) -> list[str]:
    return competitive_plugin_ids_for("codex", skill_pack)


def grok_competitive_plugin_ids(skill_pack: Optional[Path] = None) -> list[str]:
    return competitive_plugin_ids_for("grok", skill_pack)


def claude_competitive_plugin_ids(skill_pack: Optional[Path] = None) -> list[str]:
    return competitive_plugin_ids_for("claude", skill_pack)


def _grok_plugin_active(plugins: list[Any], plugin_id: str) -> bool:
    for plugin in plugins:
        if isinstance(plugin, dict) and plugin.get("name") == plugin_id:
            return plugin.get("enabled") is not False
    return False


def probe_grok_exposed_skills(skill_pack: Path) -> Optional[list[str]]:
    """Grok active-skill exposure adapter (BI-BCA162CF), Python-fallback mirror.

    `grok plugin list --json` is Grok's OWN plugin registry, not a filesystem
    check — install_grok_plugin() above already depends on the same command's
    `name` field to detect an existing dpf-platform install, so this is not a
    new, unverified surface. It is materially stronger evidence than checking
    whether a SKILL.md file exists in the managed copy on disk. See the Node
    twin (hooks/grok-skill-exposure-adapter.mjs) for the full fidelity note on
    why Codex and Antigravity do NOT get an equivalent adapter: neither has a
    discoverable non-interactive active-skill-list mechanism.

    Returns None (leave exposure unknown) whenever Grok is absent or the probe
    fails — never a falsely-empty "verified" list.
    """
    grok = resolve_grok_binary()
    if not grok:
        return None
    try:
        result = subprocess.run([grok, "plugin", "list", "--json"], capture_output=True, text=True)
    except OSError:
        return None
    if result.returncode != 0:
        return None
    try:
        plugins = json.loads(result.stdout or "[]")
    except json.JSONDecodeError:
        return None
    if not isinstance(plugins, list):
        return None

    replacements = load_process_spine_contract(skill_pack)
    exposed: set[str] = set()
    if _grok_plugin_active(plugins, PLUGIN_NAME):
        for entry in replacements:
            exposed |= _dpf_aliases(entry)
    if any(_grok_plugin_active(plugins, plugin_id) for plugin_id in grok_competitive_plugin_ids(skill_pack)):
        for entry in replacements:
            exposed |= _retired_aliases(entry)
    return sorted(item for item in exposed if item)


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
    exposure_unknown = exposed is None
    severity = "ok"
    if missing_installed:
        severity = "fail"
    elif exposure_unknown or conflicts or missing_exposed:
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
            "message": (
                None
                if exposed is not None
                else "client did not provide active skill evidence; DPF cannot prove replacements are loaded"
            ),
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
            "  DPF-native replacement skills loaded/exposed in this session: UNKNOWN - "
            "this client did not provide active skill evidence; DPF cannot prove "
            "replacements are loaded."
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
        "safe adapters preserve user-owned skills and unmanaged plugin data. A managed "
        "DPF client cache may be replaced through that client's plugin CLI."
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


def remove_toml_table(text: str, canonical_key: str) -> str:
    """Remove every exact table match while preserving all other text."""
    lines = text.splitlines()
    ranges: list[tuple[int, int]] = []
    index = 0
    while index < len(lines):
        if canonical_toml_table_header(lines[index]) == canonical_key:
            end = index + 1
            while end < len(lines) and not _is_table_boundary(lines[end]):
                end += 1
            ranges.append((index, end))
            index = end
        else:
            index += 1
    removal = {line_no for start, end in ranges for line_no in range(start, end)}
    return "\n".join(line for index, line in enumerate(lines) if index not in removal).rstrip() + "\n"


def toml_table_enabled(text: str, canonical_key: str) -> Optional[bool]:
    """Read an explicit enabled boolean from one table without a TOML dependency."""
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if canonical_toml_table_header(line) != canonical_key:
            continue
        end = index + 1
        while end < len(lines) and not _is_table_boundary(lines[end]):
            match = re.match(r"^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$", lines[end], re.IGNORECASE)
            if match:
                return match.group(1).lower() == "true"
            end += 1
    return None


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
    # NOTE (BI-BCA162CF): the `[plugins."<id>"].enabled` toggles this function
    # writes/reads here are Codex's PERSISTED CONFIG STATE, not a non-interactive
    # active-skill-list API. There is no known non-interactive Codex command
    # that enumerates the skills actually loaded/exposed in the running
    # session -- `codex exec --json` startup events carry no plugin/skill field
    # (docs/superpowers/audits/evidence/2026-04-29-codex-cli-jsonl-probe.md).
    # Feeding a config-toggle read into the shared DPF_PROCESS_SPINE_EXPOSED_
    # SKILLS_* channel would misrepresent "configured enabled" as "verified
    # loaded" (Codex also gates every hook behind interactive HOOK TRUST, so
    # enabled=true configuration is not proof a session honored it -- see
    # guard_liveness_advisory() below). Grok gets a real adapter
    # (probe_grok_exposed_skills / hooks/grok-skill-exposure-adapter.mjs)
    # because `grok plugin list --json` answers the client's OWN runtime
    # state, not just a config file. Codex remains a documented gap until it
    # ships an equivalent command.
    path = codex_config_path(home)
    text = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    current_enabled = toml_table_enabled(text, f"plugins.{CODEX_PLUGIN_ID}")
    legacy_enabled = toml_table_enabled(text, f"plugins.{PLUGIN_NAME}")
    desired_enabled = current_enabled if current_enabled is not None else legacy_enabled
    # Pre-plugin-registry DPF installers wrote the bare key. Current Codex
    # requires <plugin>@<marketplace> and logs the bare key as invalid.
    text = remove_toml_table(text, f"plugins.{PLUGIN_NAME}")
    text = upsert_toml_table(
        text,
        f'[plugins."{CODEX_PLUGIN_ID}"]',
        [f"enabled = {'false' if desired_enabled is False else 'true'}"],
    )
    text = disable_competitive_codex_plugins(text, codex_competitive_plugin_ids(skill_pack))
    lazy_host_mcp_url = with_mcp_catalog_tier(mcp_url, "full")
    text = upsert_toml_table(
        text,
        "[mcp_servers.dpf]",
        [
            f'url = "{lazy_host_mcp_url}"',
            f'bearer_token_env_var = "{TOKEN_ENV_VAR}"',
            "enabled = true",
        ],
    )
    if dry_run:
        return True
    return write_text_if_changed(path, text)


def ensure_claude_repo_mcp_config(skill_pack_path: Path, mcp_url: str, dry_run: bool) -> bool:
    """Keep the packaged Claude MCP descriptor current for standalone installs."""
    lazy_host_mcp_url = with_mcp_catalog_tier(mcp_url, "full")
    content = json.dumps(
        {
            "mcpServers": {
                "dpf": {
                    "type": "http",
                    "url": "${DPF_MCP_URL:-" + lazy_host_mcp_url + "}",
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
        [claude, "plugin", "update", f"{PLUGIN_NAME}@{MARKETPLACE_NAME}", "--scope", "local"],
    ]
    for command in commands:
        result = subprocess.run(command, cwd=str(marketplace_root), capture_output=True, text=True)
        if result.returncode != 0:
            return f"failed: {' '.join(command[:3])} exited {result.returncode}"
    return "installed and refreshed"


def _claude_plugin_matches(installed_id: str, competitive_id: str) -> bool:
    """Match contract ids against Claude's plugin@marketplace ids.

    Claude `plugin list --json` reports `id` as `name@marketplace`. The cleanup
    contract may list bare names (`superpowers`) or fully-qualified ids.
    """
    if not installed_id or not competitive_id:
        return False
    if installed_id == competitive_id:
        return True
    # Never treat dpf-platform as competitive even if bare-name logic runs.
    if installed_id == PLUGIN_NAME or installed_id.startswith(f"{PLUGIN_NAME}@"):
        return False
    inst_bare = installed_id.split("@", 1)[0]
    if "@" not in competitive_id:
        # Contract bare name matches any marketplace-qualified install of that name.
        return inst_bare == competitive_id
    # Competitive id is fully qualified; equality was already checked above.
    return False


def disable_competitive_claude_plugins(
    skill_pack: Optional[Path] = None, dry_run: bool = False
) -> str:
    """Disable known competitive process plugins on Claude Code (disable-not-delete).

    Codex writes enabled=false into config.toml; Grok uses `grok plugin disable`.
    Claude uses `claude plugin list --json` + `claude plugin disable <id>`
    (optionally `--scope`). Only acts when a competitive plugin is installed and
    still enabled. Never uninstalls or deletes caches (BI-A4BEFE99).
    """
    claude = resolve_claude_binary()
    if not claude:
        return "skipped: Claude CLI not found"
    plugin_ids = claude_competitive_plugin_ids(skill_pack)
    if not plugin_ids:
        return "skipped: no competitive plugin ids in cleanup policy"
    if dry_run:
        return f"dry-run: would disable competitive plugins {plugin_ids}"

    list_result = subprocess.run(
        [claude, "plugin", "list", "--json"],
        capture_output=True,
        text=True,
    )
    if list_result.returncode != 0:
        return f"failed: claude plugin list exited {list_result.returncode}"
    try:
        installed = json.loads(list_result.stdout or "[]")
    except json.JSONDecodeError:
        return "failed: claude plugin list returned invalid JSON"
    if not isinstance(installed, list):
        return "failed: claude plugin list shape unexpected"

    contract_ids = [
        plugin_id
        for plugin_id in dict.fromkeys(plugin_ids)
        if plugin_id
        and plugin_id != PLUGIN_NAME
        and not plugin_id.startswith(f"{PLUGIN_NAME}@")
    ]

    # Deduplicate installed entries (same id may appear under multiple scopes).
    # A single installed plugin can match several contract ids (bare + qualified);
    # act once per (id, scope), not once per contract id.
    matched_contract: set[str] = set()
    targets: list[dict[str, Any]] = []
    seen_labels: set[str] = set()
    for entry in installed:
        if not isinstance(entry, dict):
            continue
        full_id = str(entry.get("id") or entry.get("name") or "")
        if not full_id:
            continue
        hits = [cid for cid in contract_ids if _claude_plugin_matches(full_id, cid)]
        if not hits:
            continue
        matched_contract.update(hits)
        scope = entry.get("scope")
        label = f"{full_id}#{scope}" if scope else full_id
        if label in seen_labels:
            continue
        seen_labels.add(label)
        targets.append(entry)

    disabled: list[str] = []
    already: list[str] = []
    failed: list[str] = []
    missing = [cid for cid in contract_ids if cid not in matched_contract]

    for entry in targets:
        full_id = str(entry.get("id") or entry.get("name") or "")
        scope = entry.get("scope")
        label = f"{full_id}#{scope}" if scope else full_id
        if entry.get("enabled") is False:
            already.append(label)
            continue
        command = [claude, "plugin", "disable", full_id]
        if scope in ("user", "project", "local"):
            command.extend(["--scope", str(scope)])
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            disabled.append(label)
        else:
            failed.append(label)

    parts: list[str] = []
    if disabled:
        parts.append(f"disabled {disabled}")
    if already:
        parts.append(f"already-disabled {already}")
    if missing:
        parts.append(f"not-installed {missing}")
    if failed:
        parts.append(f"failed {failed}")
    return "; ".join(parts) if parts else "no competitive plugins present"


def resolve_codex_binary() -> str | None:
    home = home_dir()
    candidates: list[str] = []
    configured = os.environ.get("CODEX_CLI_PATH")
    if configured:
        candidates.append(configured)
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidates.append(str(Path(local) / "Programs" / "Codex" / "codex.exe"))
            app_bin = Path(local) / "OpenAI" / "Codex" / "bin"
            if app_bin.exists():
                candidates.extend(
                    str(path)
                    for path in sorted(
                        app_bin.glob("*/codex.exe"),
                        key=lambda path: path.stat().st_mtime,
                        reverse=True,
                    )
                )
                candidates.append(str(app_bin / "codex.exe"))
        candidates.append(str(home / "AppData" / "Roaming" / "npm" / "codex.cmd"))
    else:
        candidates.extend([
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
            str(home / ".local" / "bin" / "codex"),
        ])
    found = shutil.which("codex")
    if found:
        candidates.append(found)
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def install_codex_plugin(home: Path, dry_run: bool) -> str:
    """Install and verify the DPF plugin through Codex's own registry."""
    codex = resolve_codex_binary()
    if not codex:
        return "skipped: Codex CLI not found"
    selector = f"{PLUGIN_NAME}@personal"
    if dry_run:
        return f"dry-run: would install and verify {selector}"
    try:
        installed = subprocess.run(
            [codex, "plugin", "add", selector, "--json"],
            cwd=str(home),
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        return f"failed: Codex CLI could not start ({exc.__class__.__name__})"
    if installed.returncode != 0:
        return f"failed: codex plugin add exited {installed.returncode}"
    listed = subprocess.run(
        [codex, "plugin", "list", "--marketplace", "personal", "--json"],
        cwd=str(home),
        capture_output=True,
        text=True,
    )
    if listed.returncode != 0:
        return f"failed: codex plugin list exited {listed.returncode}"
    try:
        inventory = json.loads(listed.stdout or "{}")
    except json.JSONDecodeError:
        return "failed: codex plugin list returned invalid JSON"
    matches = [
        plugin
        for plugin in inventory.get("installed", [])
        if isinstance(plugin, dict) and plugin.get("pluginId") == selector
    ]
    if not matches or not matches[0].get("installed") or not matches[0].get("enabled"):
        return "failed: Codex did not report dpf-platform installed and enabled"
    return "installed, enabled, and verified"


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


def ensure_antigravity_skills(skill_pack: Path, home: Path, dry_run: bool) -> str:
    """Sync skills from packages/dpf-skill-pack/skills to ~/.gemini/antigravity/skills."""
    source = skill_pack / "skills"
    dest = home / ".gemini" / "antigravity" / "skills"
    if not source.exists():
        return "skipped: source skills directory missing"
    if dry_run:
        return f"dry-run: would copy skills from {source} to {dest}"
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    for skill_dir in source.iterdir():
        if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
            target = dest / skill_dir.name
            if target.exists():
                shutil.rmtree(target)
            ignore = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
            shutil.copytree(skill_dir, target, ignore=ignore)
            count += 1
    return f"synced {count} skill(s) -> {dest}"


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

    list_result = subprocess.run(
        [grok, "plugin", "list", "--json"],
        capture_output=True,
        text=True,
    )
    if list_result.returncode != 0:
        return f"failed: grok plugin list exited {list_result.returncode}"
    try:
        installed_plugins = json.loads(list_result.stdout or "[]")
    except json.JSONDecodeError:
        return "failed: grok plugin list returned invalid JSON"
    already_installed = any(
        isinstance(plugin, dict) and plugin.get("name") == PLUGIN_NAME
        for plugin in installed_plugins
    )
    if already_installed:
        uninstall_result = subprocess.run(
            [grok, "plugin", "uninstall", PLUGIN_NAME, "--confirm", "--keep-data"],
            capture_output=True,
            text=True,
        )
        if uninstall_result.returncode != 0:
            return f"failed: grok plugin uninstall exited {uninstall_result.returncode}"

    result = subprocess.run(
        [grok, "plugin", "install", str(managed), "--trust"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return f"failed: grok plugin install exited {result.returncode}"
    return "reinstalled" if already_installed else "installed"


# PreToolUse guards to wire into Grok's hook plane. Blocking safety/decision
# guards only; the Write/Edit advisory prechecks are Claude-shaped and non-blocking.
# Flat list kept for drift tests vs hooks.json emitDeny set.
GROK_HOOK_GUARDS = (
    "lease-punt-guard.mjs",
    "decision-routing-guard.mjs",
    "lease-guard.mjs",
    "root-clone-guard.mjs",
    "compose-guard.mjs",
    "portal-image-guard.mjs",
    "plan-backlog-coverage-guard.mjs",
    "pregate-evidence-guard.mjs",
    "pregate-invocation-guard.mjs",
    # BI-0B292D84: AGENTS.md 12 requires a Workroom claim before work on every
    # surface. Grok ignores the plugin-bundled hooks.json entirely, so a guard
    # absent from this tuple never reaches Grok at all.
    "workroom-claim-guard.mjs",
)
# Matcher-scoped groups (BI-pretooluse): without matchers Grok runs EVERY PreToolUse
# command on EVERY tool (6 serial node spawns per call), which looks like
# "PreToolUse is broken/slow" and races the 15s per-hook timeout under load.
# Tool names are the Grok+Claude union (Shell/Bash/run_terminal_command).
GROK_PRETOOLUSE_GROUPS = (
    (
        "Shell|Bash|run_terminal_command|run_terminal_cmd",
        (
            "lease-punt-guard.mjs",
            "lease-guard.mjs",
            "root-clone-guard.mjs",
            "compose-guard.mjs",
            "portal-image-guard.mjs",
            "pregate-evidence-guard.mjs",
            "pregate-invocation-guard.mjs",
            "workroom-claim-guard.mjs",
        ),
    ),
    (
        "AskQuestion|AskUserQuestion",
        ("decision-routing-guard.mjs",),
    ),
    (
        "Write|Edit|MultiEdit",
        ("plan-backlog-coverage-guard.mjs", "workroom-claim-guard.mjs"),
    ),
)

# Session/Stop plane for Grok (BI-BCA23DBB + session worktree hygiene).
# Plugin hooks.json names these for Claude; Grok only executes ~/.grok/hooks.
# - grok-session-start: process-spine exposure + governance-freshness
# - worktree-session-hygiene: transactional Tier-A reap of THIS worktree (primary;
#   fleet schedule ops/worktree-janitor is backstop only)
GROK_SESSION_START_SCRIPTS = (
    "grok-session-start.mjs",
    "worktree-session-hygiene.mjs",
)
GROK_SESSION_END_SCRIPTS = (
    "uncommitted-work-guard.mjs",
    "worktree-session-hygiene.mjs",
)
# Stop is NOT SessionEnd (BI-E5D810B8). Grok fires `Stop` after every turn, so a
# destructive reap wired here removes the worktree the session is still working
# in — from the turn its PR merges (when a live tree first satisfies Tier A)
# onward. Stop carries the non-destructive uncommitted-work warning only; the
# reaper stays on SessionEnd. Mirrors hooks.json for the Claude plane.
GROK_STOP_SCRIPTS = ("uncommitted-work-guard.mjs",)
# Back-compat single names (older docs / tests may reference these).
GROK_SESSION_START_SCRIPT = GROK_SESSION_START_SCRIPTS[0]
GROK_SESSION_END_SCRIPT = GROK_SESSION_END_SCRIPTS[0]


def grok_hooks_file(home: Path) -> Path:
    return home / ".grok" / "hooks" / "dpf-guards.json"


def _grok_hook_command(hooks_dir: Path, script: str, timeout: int = 15) -> dict[str, Any]:
    return {
        "type": "command",
        "command": f'node "{hooks_dir / script}"',
        "timeout": timeout,
    }


def _grok_command_entry(hooks_dir: Path, script: str, timeout: int = 15) -> dict[str, Any]:
    """Single-script PreToolUse group (legacy shape used by session events)."""
    return {"hooks": [_grok_hook_command(hooks_dir, script, timeout=timeout)]}


def _grok_matched_group(
    hooks_dir: Path,
    matcher: str,
    scripts: tuple[str, ...],
    *,
    dry_run: bool,
    timeout: int = 15,
) -> dict[str, Any] | None:
    hooks = [
        _grok_hook_command(hooks_dir, script, timeout=timeout)
        for script in scripts
        if dry_run or (hooks_dir / script).exists()
    ]
    if not hooks:
        return None
    return {"matcher": matcher, "hooks": hooks}


def build_grok_hooks_payload(managed: Path, dry_run: bool = False) -> dict[str, Any]:
    """Build the global Grok hooks payload (PreToolUse + SessionStart + SessionEnd/Stop)."""
    hooks_dir = managed / "hooks"
    pre_entries: list[dict[str, Any]] = []
    for matcher, scripts in GROK_PRETOOLUSE_GROUPS:
        group = _grok_matched_group(hooks_dir, matcher, scripts, dry_run=dry_run, timeout=15)
        if group:
            pre_entries.append(group)
    payload: dict[str, Any] = {"hooks": {}}
    if pre_entries:
        payload["hooks"]["PreToolUse"] = pre_entries
    start = [
        _grok_command_entry(hooks_dir, script, timeout=30)
        for script in GROK_SESSION_START_SCRIPTS
        if dry_run or (hooks_dir / script).exists()
    ]
    if start:
        payload["hooks"]["SessionStart"] = start
    end = [
        _grok_command_entry(hooks_dir, script, timeout=60)
        for script in GROK_SESSION_END_SCRIPTS
        if dry_run or (hooks_dir / script).exists()
    ]
    if end:
        payload["hooks"]["SessionEnd"] = end
    stop = [
        _grok_command_entry(hooks_dir, script, timeout=60)
        for script in GROK_STOP_SCRIPTS
        if dry_run or (hooks_dir / script).exists()
    ]
    if stop:
        payload["hooks"]["Stop"] = stop
    return payload


def install_grok_hooks(managed: Path, home: Path, dry_run: bool) -> str:
    """Wire plane-1 + session plane into a hook plane Grok actually executes.

    Live probe (BI-883FC2FC, Grok 0.2.87) proved Grok runs PreToolUse blocking
    command-hooks and honors deny, but its hook-execution plane loads ONLY from
    ~/.grok/hooks, ~/.claude/settings.json, and ~/.cursor/hooks — NOT from a
    plugin's bundled hooks.json. This writes a global ~/.grok/hooks/dpf-guards.json
    pointing at the managed guard copies.

    BI-BCA23DBB: SessionStart via grok-session-start.mjs + SessionEnd uncommitted warn.
    Session worktree hygiene: Tier-A reap of THIS worktree on SessionEnd (primary path).
    """
    payload = build_grok_hooks_payload(managed, dry_run=dry_run)
    pre_groups = payload.get("hooks", {}).get("PreToolUse", [])
    pre_count = sum(len(g.get("hooks", [])) for g in pre_groups if isinstance(g, dict))
    pre_matchers = sum(1 for g in pre_groups if isinstance(g, dict) and g.get("matcher"))
    if pre_count == 0 and "SessionStart" not in payload.get("hooks", {}):
        return "skipped: no guard scripts found in managed copy"
    path = grok_hooks_file(home)
    if dry_run:
        return (
            f"dry-run: would write {pre_count} PreToolUse guard(s) "
            f"in {pre_matchers} matcher group(s) + SessionStart/Stop plane to {path}"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    changed = write_json(path, payload)
    session = "SessionStart+Stop" if "SessionStart" in payload.get("hooks", {}) else "no-session"
    return (
        f"wired {pre_count} PreToolUse guard(s) in {pre_matchers} matcher group(s) "
        f"+ {session} -> {path}"
        + ("" if changed else " (unchanged)")
    )


def disable_competitive_grok_plugins(skill_pack: Optional[Path] = None, dry_run: bool = False) -> str:
    """Disable known competitive process plugins on Grok (disable-not-delete).

    Codex already writes enabled=false into config.toml. Grok uses
    `grok plugin disable <name>` against plugins reported by
    `grok plugin list --json`. Only acts when a competitive plugin is installed
    and not already disabled. Never uninstalls or deletes caches.
    """
    grok = resolve_grok_binary()
    if not grok:
        return "skipped: Grok CLI not found"
    plugin_ids = grok_competitive_plugin_ids(skill_pack)
    if not plugin_ids:
        return "skipped: no competitive plugin ids in cleanup policy"
    if dry_run:
        return f"dry-run: would disable competitive plugins {plugin_ids}"

    list_result = subprocess.run(
        [grok, "plugin", "list", "--json"],
        capture_output=True,
        text=True,
    )
    if list_result.returncode != 0:
        return f"failed: grok plugin list exited {list_result.returncode}"
    try:
        installed = json.loads(list_result.stdout or "[]")
    except json.JSONDecodeError:
        return "failed: grok plugin list returned invalid JSON"
    if not isinstance(installed, list):
        return "failed: grok plugin list shape unexpected"

    by_name = {
        str(p.get("name")): p
        for p in installed
        if isinstance(p, dict) and p.get("name")
    }
    disabled: list[str] = []
    already: list[str] = []
    missing: list[str] = []
    failed: list[str] = []
    for plugin_id in dict.fromkeys(plugin_ids):
        if plugin_id == PLUGIN_NAME:
            continue
        entry = by_name.get(plugin_id)
        if entry is None:
            missing.append(plugin_id)
            continue
        if entry.get("enabled") is False or entry.get("status") == "disabled":
            already.append(plugin_id)
            continue
        result = subprocess.run(
            [grok, "plugin", "disable", plugin_id],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            disabled.append(plugin_id)
        else:
            failed.append(plugin_id)
    parts = []
    if disabled:
        parts.append(f"disabled {disabled}")
    if already:
        parts.append(f"already-disabled {already}")
    if missing:
        parts.append(f"not-installed {missing}")
    if failed:
        parts.append(f"failed {failed}")
    return "; ".join(parts) if parts else "no competitive plugins present"


# Bash-scoped blocking guards for Codex's user hook plane (~/.codex/hooks.json).
# decision-routing-guard is wired separately on AskUserQuestion (Gate A).
CODEX_BASH_GUARDS = (
    "lease-guard.mjs",
    "root-clone-guard.mjs",
    "compose-guard.mjs",
    "portal-image-guard.mjs",
    "lease-punt-guard.mjs",
    "pregate-evidence-guard.mjs",
    "pregate-invocation-guard.mjs",
    # BI-0B292D84 - also on CODEX_WRITE_GUARDS; hooks.json wires it on both matchers.
    "workroom-claim-guard.mjs",
)
CODEX_ASK_GUARDS = ("decision-routing-guard.mjs",)
CODEX_WRITE_GUARDS = (
    "root-clone-guard.mjs",
    "plan-backlog-coverage-guard.mjs",
    "workroom-claim-guard.mjs",
)


def codex_hooks_file(home: Path) -> Path:
    return home / ".codex" / "hooks.json"


def _dpf_hook_command(command: str, managed_hooks_dir: Path) -> bool:
    if not command:
        return False
    managed_prefix = str(managed_hooks_dir)
    if managed_prefix in command and ".mjs" in command:
        return True
    return any(name in command for name in (*CODEX_BASH_GUARDS, *CODEX_ASK_GUARDS, *CODEX_WRITE_GUARDS))


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
    write_entries = [
        {"type": "command", "command": f'node "{hooks_dir / guard}"', "timeout": 15}
        for guard in CODEX_WRITE_GUARDS
        if dry_run or (hooks_dir / guard).exists()
    ]
    if write_entries:
        groups.append({"matcher": "Write|Edit|MultiEdit", "hooks": write_entries})
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
        write_count = sum(len(g.get("hooks", [])) for g in dpf_groups if g.get("matcher") == "Write|Edit|MultiEdit")
        return f"dry-run: would merge {bash_count} Bash + {ask_count} AskUserQuestion + {write_count} Write/Edit guard(s) into {path}"
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
    "portal-image-guard.mjs": "blocks hand-building the canonical portal image, which overwrites what the live install runs",
    "lease-punt-guard.mjs": "blocks a runtime-bound gate (prisma migrate / db push) in a source-only worktree",
    "decision-routing-guard.mjs": "blocks asking the operator a platform decision with no kernel consultation",
    "workroom-claim-guard.mjs": "blocks work on a feature branch that no live Workroom claim covers (AGENTS.md 12)",
    "plan-backlog-coverage-guard.mjs": "blocks production source edits until xlarge and independently shippable plan work has live BI coverage",
    "pregate-evidence-guard.mjs": "blocks git push / gh pr create when HEAD has no unexpired local-CI sandbox evidence",
    "pregate-invocation-guard.mjs": "blocks a pregate run shaped so it cannot succeed or cannot be read (piped, backgrounded, chained, timeout-wrapped)",
    "ux-fit-precheck.mjs": "reminds to run a UX-fit review when editing UI surfaces",
    "spec-plan-doc-precheck.mjs": "reminds to attach a spec/plan/doc when writing gated files",
    "design-grounding-precheck.mjs": "reminds to review specs and current code substrate before UX/workflow edits",
    "tool-economy-precheck.mjs": "reminds about tool-economy budget when adding tool surface",
    "worktree-create.mjs": "seeds a new worktree with MCP config on WorktreeCreate",
    "worktree-readiness-banner.mjs": "SessionStart: announces a SOURCE-ONLY worktree and what it forbids, so agents never promise a typecheck they cannot run",
    "process-spine-health-check.mjs": "SessionStart: warns when DPF-native replacement skills are missing or hidden by retired generic skills",
    "governance-freshness-check.mjs": "SessionStart: warns if governance guard wiring is stale",
    "grok-session-start.mjs": "Grok SessionStart: process-spine exposure probe + governance-freshness (global hook plane)",
    "worktree-session-hygiene.mjs": "SessionStart observe worktree sprawl; SessionEnd reaps THIS worktree when Tier-A (merged+clean) — primary reaper, not cron",
    "worktree-session-heartbeat.mjs": "SessionStart/Stop write + SessionEnd remove a gitignored session heartbeat so the janitor never reaps a worktree with a live session (non-destructive)",
    "root-clone-freshness.mjs": "SessionStart: fast-forwards the shared root clone to origin/main (ff-only, on-main+clean) so junctioned worktrees never inherit a stale root",
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
        + "DPF checkouts. Restart Grok to load them; `/hooks` should list 6 PreToolUse guards."
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
    parser.add_argument("--skip-codex-cli-install", action="store_true")
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
    codex_managed = codex_managed_plugin_path(home)
    shared_managed = shared_managed_plugin_path(home)

    print(f"DPF agent toolchain updater")
    print(f"  skill pack : {skill_pack}")
    print(f"  version    : {version}")
    print(f"  home       : {home}")
    print(f"  MCP URL    : {args.mcp_url}")

    copy_skill_pack(skill_pack, codex_managed, args.dry_run)
    copy_skill_pack(skill_pack, shared_managed, args.dry_run)
    print(f"  Codex source : {codex_managed}")
    print(f"  shared source: {shared_managed}")
    process_spine_root = skill_pack if args.dry_run else codex_managed
    if not process_spine_contract_path(process_spine_root).exists():
        process_spine_root = skill_pack
    exposed_skills = exposed_process_spine_skills_from_env()
    process_spine_verdict = assess_process_spine_health(
        process_spine_root,
        exposed_skills=exposed_skills,
    )
    for line in render_process_spine_health(process_spine_verdict):
        print(line)
    for line in render_process_spine_cleanup_policy(load_process_spine_cleanup_policy(process_spine_root)):
        print(line)

    codex_present = resolve_codex_binary() is not None

    if not args.claude_only:
        ensure_codex_marketplace(home, version, args.dry_run)
        ensure_codex_config(home, args.mcp_url, args.dry_run, process_spine_root)
        codex_status = "skipped by flag"
        if not args.skip_codex_cli_install:
            codex_status = install_codex_plugin(home, args.dry_run)
            # Codex currently writes a legacy `[plugins."<name>"]` alias while
            # installing a qualified registry id. Converge again after the CLI
            # mutation so the next process does not warn that `dpf-platform`
            # lacks its `@marketplace` qualifier.
            ensure_codex_config(home, args.mcp_url, args.dry_run, process_spine_root)
        codex_hooks_status = install_codex_hooks(codex_managed, home, args.dry_run)
        print(
            f"  Codex      : marketplace + config converged; plugin {codex_status}; "
            f"hooks {codex_hooks_status}"
        )
        grok_status = "skipped by flag"
        if not args.skip_grok_cli_install:
            grok_status = install_grok_plugin(shared_managed, args.dry_run)
        print(f"  Grok       : plugin install {grok_status}")
        # Grok's hook plane ignores plugin-bundled hooks (BI-883FC2FC), so the
        # blocking guards + session plane are delivered via the always-trusted
        # global hook plane (BI-BCA23DBB).
        grok_hooks_status = install_grok_hooks(shared_managed, home, args.dry_run)
        print(f"  Grok hooks : {grok_hooks_status}")
        grok_competitive_status = "skipped by flag"
        if not args.skip_grok_cli_install:
            grok_competitive_status = disable_competitive_grok_plugins(
                process_spine_root, dry_run=args.dry_run
            )
        print(f"  Grok competitive: {grok_competitive_status}")
        # Antigravity (agy): MCP-config wiring + skill-pack sync.
        antigravity_status = "skipped by flag"
        if not args.skip_antigravity_cli_install:
            mcp_st = ensure_antigravity_mcp_config(home, args.mcp_url, args.dry_run)
            skills_st = ensure_antigravity_skills(skill_pack, home, args.dry_run)
            antigravity_status = f"MCP config {mcp_st}; skills {skills_st}"
        print(f"  Antigravity: {antigravity_status}")

    if not args.codex_only:
        ensure_claude_marketplace(home, version, args.dry_run)
        ensure_claude_repo_mcp_config(
            shared_managed if not args.dry_run else skill_pack,
            args.mcp_url,
            args.dry_run,
        )
        status = "skipped by flag"
        if not args.skip_claude_cli_install:
            status = install_claude_plugin(home, args.dry_run)
        print(f"  Claude     : marketplace converged; plugin install {status}")
        claude_competitive_status = "skipped by flag"
        if not args.skip_claude_cli_install:
            claude_competitive_status = disable_competitive_claude_plugins(
                process_spine_root, dry_run=args.dry_run
            )
        print(f"  Claude competitive: {claude_competitive_status}")

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
