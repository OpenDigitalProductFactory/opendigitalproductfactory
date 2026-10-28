#!/usr/bin/env python3
"""Install or update the DPF agent toolchain without a full DPF install.

This script is intentionally dependency-free. It lets a contributor install the
DPF platform plugin from a standalone `packages/dpf-skill-pack` checkout or
artifact, without Docker, pnpm, Prisma, or the portal runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grok_credential import converge_grok_credential, find_grok_refresher  # noqa: E402


PLUGIN_NAME = "dpf-platform"
CODEX_PLUGIN_ID = f"{PLUGIN_NAME}@personal"
MARKETPLACE_NAME = "dpf-platform-local"
CODEX_LEGACY_PLUGIN_IDS = (f"{PLUGIN_NAME}@{MARKETPLACE_NAME}",)
CLAUDE_PLUGIN_ID = f"{PLUGIN_NAME}@{MARKETPLACE_NAME}"
TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN"
# The install's canonical origin when nothing names another (design 12.4.1):
# setup persists DPF_MCP_URL = <PUBLIC_URL>/api/mcp/v1?tier=full (12.4.3), and
# this loopback https default is what an install without a DNS name serves.
# The shipped plugin descriptors are generated from it, so a client with no
# DPF_MCP_URL still lands on the one origin OAuth tokens are issued for.
DEFAULT_MCP_URL = "https://localhost/api/mcp/v1"


def normalize_mcp_endpoint(endpoint: str) -> str:
    """Treat an explicit portal origin as the canonical MCP path, never a root resource."""
    try:
        parsed = urlsplit(endpoint)
        credential_keys = {"access_token", "accesstoken", "refresh_token", "refreshtoken", "token", "api_key", "apikey", "key",
                           "authorization", "client_secret", "clientsecret", "secret", "password"}
        if (parsed.scheme not in ("http", "https") or not parsed.hostname or "\\" in endpoint
                or parsed.username or parsed.password or any(char.isspace() for char in endpoint)
                or any(key.lower().replace("-", "_") in credential_keys for key, _ in parse_qsl(parsed.query))):
            raise ValueError("Unsafe endpoint")
        _ = parsed.port  # Validate the port before any configuration is written.
        if parsed.path in ("", "/"):
            return urlunsplit((parsed.scheme, parsed.netloc, "/api/mcp/v1", parsed.query, parsed.fragment))
        return endpoint
    except ValueError:
        # Never include an input that may contain credentials in diagnostics.
        raise ValueError("MCP endpoint must be a credential-free HTTP(S) URL") from None


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


def validate_toml(content: str, context_dir: Optional[Path] = None) -> None:
    """Refuse an unparseable candidate before touching any client configuration.

    tomllib, tomli or, on stock Python 3.9, Codex's own parser (BI-90C9478D).
    """
    import codex_toml

    try:
        codex_toml.loads_any(content, context_dir=context_dir)
    except codex_toml.CodexTomlUnavailable:
        raise ValueError("TOML updates require Python 3.11+, tomli or the Codex CLI; configuration unchanged") from None
    except codex_toml.UnsupportedToml as error:
        raise ValueError(str(error)) from None
    except ValueError:
        # Parser diagnostics can echo operator credentials. Keep this bounded.
        raise ValueError("Invalid TOML candidate; configuration unchanged") from None


def write_text_if_changed(path: Path, content: str) -> bool:
    if path.suffix == ".toml":
        validate_toml(content, context_dir=path.parent)
        before = path.read_bytes() if path.exists() else None
        after = content.encode("utf-8")
        if before == after:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        # Same-directory replacement leaves the previous file intact if staging
        # fails. Never truncate the only working client configuration.
        descriptor, staged = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
        temporary = Path(staged)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(after)
                stream.flush()
                os.fsync(stream.fileno())
            if before is not None:
                shutil.copymode(path, temporary)
            current = path.read_bytes() if path.exists() else None
            if current != before:
                raise ValueError("Concurrent TOML edit; configuration unchanged, retry from current state")
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    # Write bytes so LF endings survive on Python 3.9 and every platform.
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


def is_build_debris(relative: Path) -> bool:
    """Files no copy of the pack delivers: the copier and digests skip them."""
    return "__pycache__" in relative.parts or relative.suffix == ".pyc" or relative.name == ".DS_Store"


def codex_content_version(skill_pack: Path) -> str:
    """Invalidate Codex's versioned cache when delivered bytes change."""
    manifest_path = skill_pack / ".codex-plugin" / "plugin.json"
    manifest = read_json(manifest_path, {})
    base_version = str(manifest.get("version", "0.0.0")).split("+", 1)[0]
    digest = hashlib.sha256()
    for path in sorted(skill_pack.rglob("*")):
        relative = path.relative_to(skill_pack)
        if not path.is_file() or is_build_debris(relative):
            continue
        content = path.read_bytes()
        if path == manifest_path:
            # The cache suffix itself must not change the next run's digest.
            content = json.dumps({**manifest, "version": base_version}, sort_keys=True).encode("utf-8")
        digest.update(relative.as_posix().encode("utf-8") + b"\0")
        digest.update(hashlib.sha256(content).digest())
    return f"{base_version}+codex.{digest.hexdigest()[:24]}"


def stamp_delivered_version(pack: Path, version: str) -> None:
    """Write the delivered version into every stamped client manifest of a copy.

    BI-4F9E3221: Claude Code keys its plugin cache by version string and never
    refreshes a cache whose version is unchanged, so content merged without a
    manual bump stayed stale. Only the version value is replaced; every other
    byte is preserved, which is what lets `delivered_digest` hash it blank.
    """
    from installed_copy_freshness import STAMPED_MANIFESTS, _VERSION_VALUE

    replacement = version.encode("utf-8")
    for relative in sorted(STAMPED_MANIFESTS):
        path = pack / relative
        if not path.is_file():
            continue
        content = path.read_bytes()
        stamped = _VERSION_VALUE.sub(lambda match: match.group(1) + replacement + match.group(2), content, count=1)
        if stamped != content:
            path.write_bytes(stamped)


def write_delivery_provenance(pack: Path, delivered: str, manifest: Optional[Mapping[str, Any]],
                              source_checkout: Optional[Mapping[str, str]], now: float) -> None:
    """Record where this copy came from (spec row X15), beside the stamp.

    The host agent must not reinstall an older portal pack over copies a
    contributor's source checkout delivered. `.dpf-delivery.json` is per
    install and excluded from `delivered_digest`.
    """
    from urllib.parse import urlsplit

    record: dict[str, Any] = {"deliveredVersion": delivered, "at": now}
    if manifest is not None:
        endpoint = urlsplit(str(manifest.get("mcpEndpoint") or ""))
        record.update({
            "source": "portal",
            "releaseId": manifest.get("releaseId"),
            "origin": f"{endpoint.scheme}://{endpoint.netloc}" if endpoint.scheme and endpoint.netloc else None,
        })
    else:
        record.update({"source": "checkout", "root": (source_checkout or {}).get("root"),
                       "commit": (source_checkout or {}).get("commit")})
    write_json(pack / ".dpf-delivery.json", record)


def source_checkout_of(skill_pack: Path) -> Optional[dict[str, str]]:
    """The git checkout and commit a local skill pack was delivered from, if any."""
    try:
        root = subprocess.run(["git", "-C", str(skill_pack), "rev-parse", "--show-toplevel"],
                              capture_output=True, text=True, timeout=10)
        commit = subprocess.run(["git", "-C", str(skill_pack), "rev-parse", "HEAD"],
                                capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if root.returncode != 0 or commit.returncode != 0:
        return None
    return {"root": root.stdout.strip(), "commit": commit.stdout.strip()}


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


def claude_installed_plugins_path(home: Path) -> Path:
    """Claude Code's record of which cache directory each install loads."""
    return home / ".claude" / "plugins" / "installed_plugins.json"


def installed_plugin_copies(home: Path, project_dir: Optional[Path] = None) -> list[dict[str, Any]]:
    """Every installed copy of this pack a client on this machine may load.

    The one list of copy locations (BI-16EAAB62): the copier above writes the
    first two, and Claude Code materializes the third from a marketplace into
    its plugin cache. `connector` marks the copies whose claude.mcp.json a
    Claude client reads as its dpf server; Codex reads its connector from
    config.toml, so its copy's descriptor is never loaded. Of the Claude cache
    records, only user-scope ones and the one for `project_dir` load in a
    session opened there; records for other checkouts are theirs.
    """
    copies: list[dict[str, Any]] = [
        {"label": "shared managed copy (Claude desktop, Grok, global hooks)",
         "path": shared_managed_plugin_path(home), "connector": True},
        {"label": "Codex managed copy", "path": codex_managed_plugin_path(home), "connector": False},
    ]
    wanted = os.path.normcase(os.path.realpath(project_dir)) if project_dir else None
    seen: set[str] = set()
    for entry in claude_plugin_records(home):
        if not isinstance(entry.get("installPath"), str):
            continue
        project = entry.get("projectPath")
        loads_here = entry.get("scope") == "user" or (
            wanted is not None and isinstance(project, str)
            and os.path.normcase(os.path.realpath(project)) == wanted
        )
        if not loads_here or entry["installPath"] in seen:
            continue
        seen.add(entry["installPath"])
        copies.append({"label": f"Claude plugin cache ({entry.get('scope', 'unknown')} scope)",
                       "path": Path(entry["installPath"]), "connector": True})
    return copies


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
    """Decode TOML bare, basic-quoted and literal-quoted key components."""
    parts: list[str] = []
    token = re.compile(r"\s*(\"(?:[^\"\\]|\\.)*\"|'[^']*'|[A-Za-z0-9_-]+)\s*")
    remaining = key.strip()
    while remaining:
        match = token.match(remaining)
        if not match:
            return None
        spelling = match.group(1)
        try:
            part = json.loads(spelling) if spelling.startswith('"') else spelling[1:-1] if spelling.startswith("'") else spelling
        except ValueError:
            return None
        parts.append(part)
        remaining = remaining[match.end():]
        if not remaining:
            return parts
        if not remaining.startswith("."):
            return None
        remaining = remaining[1:].lstrip()
        if not remaining:
            return None
    return None


def toml_assignment(line: str) -> tuple[str | None, str]:
    """Recognize one scalar key without confusing quoted spelling with identity."""
    match = re.match(r"^\s*(\"(?:[^\"\\]|\\.)*\"|'[^']*'|[A-Za-z0-9_-]+)\s*=(.*)$", line)
    if not match:
        return None, ""
    parts = split_toml_dotted_key(match.group(1))
    return (parts[0] if parts and len(parts) == 1 else None), match.group(2)


def canonical_toml_table_header(line: str) -> str | None:
    match = re.fullmatch(r"\s*\[(?!\[)(.+)\]\s*(?:#.*)?", line)
    if not match:
        return None
    parts = split_toml_dotted_key(match.group(1))
    return ".".join(parts) if parts is not None else None


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
            key, value = toml_assignment(lines[end])
            match = re.fullmatch(r"\s*(true|false)\s*(?:#.*)?", value) if key == "enabled" else None
            if match:
                return match.group(1).lower() == "true"
            end += 1
    return None


def set_codex_plugin_enabled(text: str, plugin_id: str, enabled: bool) -> str:
    """Change only the managed toggle; plugin options and hook trust stay intact."""
    retained: list[str] = []
    active = False
    seen = False
    for line in text.splitlines():
        if _is_table_boundary(line):
            active = not seen and canonical_toml_table_header(line) == f"plugins.{plugin_id}"
            seen = seen or active
        elif active and toml_assignment(line)[0] != "enabled":
            retained.append(line)
    while retained and not retained[-1].strip():
        retained.pop()
    return upsert_toml_table(text, f'[plugins."{plugin_id}"]',
                             [f"enabled = {'true' if enabled else 'false'}", *retained])


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


def existing_codex_mcp_endpoint(text: str) -> Optional[str]:
    """Read only the first DPF URL; an unreadable choice is never a default."""
    active = False
    for line in text.splitlines():
        if _is_table_boundary(line):
            if active:
                return None
            active = canonical_toml_table_header(line) == "mcp_servers.dpf"
            continue
        key, value = toml_assignment(line)
        if not active or key != "url":
            continue
        match = re.fullmatch(r'''\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?''', value)
        if not match:
            raise ValueError("Cannot preserve saved Codex URL; select an explicit MCP endpoint to repair it")
        quoted = match.group(1)
        try:
            endpoint = json.loads(quoted) if quoted.startswith('"') else quoted[1:-1]
            normalize_mcp_endpoint(endpoint)
            return endpoint
        except ValueError as error:
            raise ValueError("Cannot preserve saved Codex URL; select an explicit MCP endpoint to repair it") from error
    return None


def codex_mcp_body(text: str, endpoint: Optional[str], declaration_header: Optional[str] = None) -> list[str]:
    """Change managed keys only; retain operator-owned options and credentials."""
    retained: list[str] = []
    active = False
    seen = False
    custom_bearer = False
    # An operator's [mcp_servers.dpf.http_headers] table would clash with an
    # inline http_headers key, so the declaration is then left out.
    custom_headers = any(canonical_toml_table_header(line) == "mcp_servers.dpf.http_headers" for line in text.splitlines())
    existing_endpoint = existing_codex_mcp_endpoint(text) if not endpoint else None
    for line in text.splitlines():
        if _is_table_boundary(line):
            active = not seen and canonical_toml_table_header(line) == "mcp_servers.dpf"
            if active:
                seen = True
            continue
        if not active:
            continue
        key, value = toml_assignment(line)
        if key in ("url", "enabled"):
            continue
        if key == "bearer_token_env_var":
            if value.strip().strip('"').strip("'") == TOKEN_ENV_VAR:
                continue
            custom_bearer = True
        if key == "http_headers":
            # The toolchain declaration (BI-DE1E6485) is the one header line
            # the updater owns; an operator's own headers table is kept as is.
            if "X-DPF-Toolchain" in value:
                continue
            custom_headers = True
        if line.strip():
            retained.append(line)
    # An implicit plugin refresh must not change the resource an OAuth login
    # names. Only an explicitly supplied CLI/environment URL replaces it.
    endpoint = with_mcp_catalog_tier(normalize_mcp_endpoint(endpoint) if endpoint else existing_endpoint or DEFAULT_MCP_URL, "full")
    body = [f'url = {json.dumps(endpoint)}', "enabled = true", *retained]
    if not custom_bearer and mcp_client_bearer_header_required(endpoint, "codex"):
        body.append(f'bearer_token_env_var = "{TOKEN_ENV_VAR}"')
    if declaration_header and not custom_headers:
        body.append(f'http_headers = {{ "X-DPF-Toolchain" = {json.dumps(declaration_header)} }}')
    return body


def desired_codex_plugin_enabled(text: str) -> bool:
    for plugin_id in (CODEX_PLUGIN_ID, PLUGIN_NAME, *CODEX_LEGACY_PLUGIN_IDS):
        choice = toml_table_enabled(text, f"plugins.{plugin_id}")
        if choice is not None:
            return choice
    return True


def ensure_codex_config(
    home: Path,
    mcp_url: Optional[str],
    dry_run: bool,
    skill_pack: Optional[Path] = None,
    declaration_header: Optional[str] = None,
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
    desired_enabled = desired_codex_plugin_enabled(text)
    # Pre-plugin-registry DPF installers wrote the bare key. Current Codex
    # requires <plugin>@<marketplace> and logs the bare key as invalid.
    text = remove_toml_table(text, f"plugins.{PLUGIN_NAME}")
    text = set_codex_plugin_enabled(text, CODEX_PLUGIN_ID, desired_enabled is not False)
    text = disable_competitive_codex_plugins(text, codex_competitive_plugin_ids(skill_pack))
    text = upsert_toml_table(
        text,
        "[mcp_servers.dpf]",
        codex_mcp_body(text, mcp_url, declaration_header),
    )
    validate_toml(text)
    if dry_run:
        return True
    return write_text_if_changed(path, text)


def converge_codex_project_config(project_root: Path, mcp_url: str, dry_run: bool) -> str:
    """Run the optional project-override repair; a refusal is a status, not an abort.

    BI-CEDE5B55: ensure_codex_project_config refuses (ValueError) whenever it
    cannot validate the TOML, including on stock macOS python3 3.9 with no
    tomli. Uncaught, that refusal ended main() before Grok, Claude and the
    shared copy converged, leaving every client stale. The file is already
    left unchanged on refusal, so report it and carry on.
    """
    try:
        changed = ensure_codex_project_config(project_root, mcp_url, dry_run)
    except ValueError as error:
        return f"unchanged ({error})"
    return "converged" if changed else "current"


def ensure_codex_project_config(project_root: Path, mcp_url: str, dry_run: bool) -> bool:
    """Repair an explicitly scoped override, validating all preserved TOML data."""
    path = project_root / ".codex" / "config.toml"
    if not path.exists():
        return False
    import codex_toml

    text = path.read_text(encoding="utf-8-sig")
    try:
        parsed = codex_toml.loads_any(text, context_dir=path.parent)
    except codex_toml.CodexTomlUnavailable:
        raise ValueError("Project Codex TOML requires Python 3.11+, tomli or the Codex CLI; configuration unchanged") from None
    except codex_toml.UnsupportedToml as error:
        raise ValueError(str(error)) from None
    except ValueError:
        raise ValueError("Invalid project Codex TOML; configuration unchanged") from None
    servers = parsed.get("mcp_servers", {})
    if not isinstance(servers, dict) or "dpf" not in servers:
        return False
    existing = servers["dpf"]
    if not isinstance(existing, dict):
        raise ValueError("Invalid project Codex TOML DPF table; configuration unchanged")
    expected = dict(existing)
    expected["url"] = with_mcp_catalog_tier(mcp_url, "full")
    if mcp_client_bearer_header_required(mcp_url, "codex"):
        expected.setdefault("bearer_token_env_var", TOKEN_ENV_VAR)
    elif expected.get("bearer_token_env_var") == TOKEN_ENV_VAR:
        del expected["bearer_token_env_var"]
    if existing == expected:
        return False
    # Reuse the standalone writer, then verify its whole semantic result.
    # Unusual TOML spellings it cannot preserve are refused, never clobbered.
    body = codex_mcp_body(text, mcp_url)
    body = [line for line in body if not re.match(r"^enabled\s*=", line)]
    if "enabled" in existing:
        body.append("enabled = " + json.dumps(existing["enabled"]))
    updated = upsert_toml_table(text, "[mcp_servers.dpf]", body)
    servers["dpf"] = expected
    try:
        verified = codex_toml.loads_any(updated, context_dir=path.parent) == parsed
    except ValueError:
        verified = False
    if not verified:
        raise ValueError("Cannot safely preserve project Codex TOML; configuration unchanged")
    return True if dry_run else write_text_if_changed(path, updated)


def mcp_client_bearer_header_required(endpoint: str, client: str = "claude", auth_mode: str | None = None) -> bool:
    """Mirror the shared TypeScript policy; shared fixtures guard agreement."""
    mode = auth_mode or os.environ.get("DPF_MCP_AUTH_MODE", "oauth")
    if mode not in ("oauth", "legacy"):
        raise ValueError("DPF_MCP_AUTH_MODE must be oauth or legacy")
    if mode == "legacy" or client == "grok":
        return True
    try:
        parsed = urlparse(endpoint)
        if not parsed.hostname or parsed.username or parsed.password:
            return True
        if parsed.scheme == "https":
            return False
        return not (client == "codex" and parsed.scheme == "http"
                    and parsed.hostname in ("localhost", "127.0.0.1", "::1"))
    except ValueError:
        return True


# Python mirror of MCP_CLIENT_OAUTH_SCOPE_PIN in
# packages/integration-shared/src/mcp-client-credential-policy.ts (BI-3D2FD68C).
# Over https Claude Code authorizes by OAuth; the pin names the development
# scopes explicitly so the consent grants them even if the portal's advertised
# set (apps/web/lib/auth/oauth-scope-map.ts ADVERTISED_SCOPES) ever narrows.
# Keep the two in lockstep, like the predicate above.
MCP_CLIENT_OAUTH_SCOPE_PIN = "dpf.read dpf.work dpf.build"

# Claude's connector reads its own variable, never the shared DPF_MCP_URL that
# Codex, Grok, gates and scripts read: any of those (and a test in stale
# checkouts) could set the shared one to an address Claude's OAuth client
# refuses (BI-D6A6462A). Only scripts/installer/lib/mcp-client-env.{sh,ps1}
# write it, and only for https.
CLAUDE_MCP_URL_ENV_VAR = "DPF_CLAUDE_MCP_URL"


def ensure_claude_repo_mcp_config(skill_pack_path: Path, mcp_url: str, dry_run: bool, declarations: Any = None) -> bool:
    """Keep the packaged Claude MCP descriptor current for standalone installs.

    The plugin descriptor is the one dpf connector a Claude session loads
    (BI-5201141C, design 12.4.4); no project .mcp.json is written beside it.
    The checked-in copy is this function's output for DEFAULT_MCP_URL.

    Scheme-aware since BI-FA2C46D7. This generator previously pinned the bearer
    header unconditionally, which is correct for today's http install and would
    have been wrong the moment the endpoint moved to https: the next bootstrap
    run would have re-pinned a header that disables the OAuth the move exists to
    enable, and silently undone the transition.
    """
    lazy_host_mcp_url = with_mcp_catalog_tier(mcp_url, "full")
    server: dict[str, object] = {
        "type": "http",
        "url": "${" + CLAUDE_MCP_URL_ENV_VAR + ":-" + lazy_host_mcp_url + "}",
    }
    if mcp_client_bearer_header_required(lazy_host_mcp_url):
        server["headers"] = {"Authorization": "Bearer ${DPF_MCP_BEARER_TOKEN:-}"}
    else:
        # BI-3D2FD68C: the OAuth path needs the scope pin or the consent grants
        # read only and every write tool stays out of reach.
        server["oauth"] = {"scopes": MCP_CLIENT_OAUTH_SCOPE_PIN}
    if declarations is not None:
        server = declarations.declare_server(server, "claude-code")
    content = json.dumps({"mcpServers": {"dpf": server}}, indent=2) + "\n"
    if dry_run:
        return True
    return write_text_if_changed(skill_pack_path / "claude.mcp.json", content)


def ensure_antigravity_plugin_descriptor(skill_pack_path: Path, mcp_url: str, dry_run: bool, declarations: Any = None) -> bool:
    """Keep the packaged Antigravity MCP descriptor current (BI-5201141C).

    Same rule as the Claude descriptor: URL-only with the DPF_MCP_URL override,
    and the bearer header only where the client cannot authorize by OAuth
    (plain http, or explicit legacy mode). Antigravity has no scope-pin field.
    The checked-in copy is this function's output for DEFAULT_MCP_URL.
    """
    server: dict[str, object] = {
        "type": "http",
        "url": "${DPF_MCP_URL:-" + mcp_url + "}",
    }
    if mcp_client_bearer_header_required(mcp_url, "antigravity"):
        server["headers"] = {"Authorization": "Bearer ${DPF_MCP_BEARER_TOKEN:-}"}
    if declarations is not None:
        server = declarations.declare_server(server, "antigravity")
    content = json.dumps({"mcpServers": {"dpf": server}}, indent=2) + "\n"
    if dry_run:
        return True
    return write_text_if_changed(skill_pack_path / "antigravity.mcp.json", content)


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
    records = [entry for entry in claude_plugin_records(home) if entry.get("scope") == "local"]
    if not records or not all(claude_record_content_matches(home, entry) for entry in records):
        return "failed: Claude local cache content remains unverified after supported update; client-owned cache retained"
    return "installed and refreshed"


def claude_plugin_records(home: Path) -> list[dict[str, Any]]:
    """Every installed_plugins.json record of the dpf-platform plugin."""
    try:
        records = json.loads(claude_installed_plugins_path(home).read_text(encoding="utf-8-sig"))
        entries = records.get("plugins", {}).get(CLAUDE_PLUGIN_ID, [])
    except (OSError, ValueError, AttributeError):
        return []
    return [entry for entry in entries if isinstance(entry, dict)] if isinstance(entries, list) else []


def claude_record_content_matches(home: Path, entry: dict[str, Any]) -> bool:
    """Verify installed bytes with the existing delivered-content comparator."""
    from installed_copy_freshness import delivered_digest, installed_version

    install = entry.get("installPath")
    source = shared_managed_plugin_path(home)
    if not isinstance(install, str) or not source.is_dir() or not Path(install).is_dir():
        return False
    try:
        # The full string, stamp included (BI-4F9E3221): Claude Code keys the
        # cache by it, so an unstamped record at the same base is stale.
        expected_version = installed_version(source)
        return bool(expected_version and entry.get("version") == expected_version
                    and installed_version(Path(install)) == expected_version
                    and delivered_digest(Path(install)) == delivered_digest(source))
    except (OSError, ValueError):
        return False


def converge_claude_project_plugins(home: Path, version: str, dry_run: bool) -> dict[str, list[str]]:
    """Update project records whose version or delivered content is stale.

    `install_claude_plugin` refreshes only the local-scope record. Claude Code
    keeps one project-scope record per checkout the plugin was ever installed
    from, and each keeps loading its own cached version: on 2026-10-07 the
    D:\\DPF record still loaded 0.2.5's bearer descriptor beside the 0.2.8 OAuth
    one (BI-B9F359AC). `claude plugin update --scope project` acts on the
    record for its working directory, so it runs once per existing project.
    A record whose projectPath is gone is reported as prunable and left alone:
    Claude Code owns the file and drops it on its own uninstall.
    """
    from installed_copy_freshness import installed_version

    result: dict[str, list[str]] = {"updated": [], "current": [], "pruned": [], "failed": []}
    # Claude Code records the version from the plugin manifest, which the
    # delivery stamps with `+c.<digest>` (BI-4F9E3221). The shared copy is what
    # `plugin update` installs, so its manifest is the expected version; a
    # `+codex.<stamp>` on the argument is Codex's and is dropped.
    version = installed_version(shared_managed_plugin_path(home)) or version.split("+", 1)[0]
    claude = resolve_claude_binary()
    for entry in claude_plugin_records(home):
        project = entry.get("projectPath")
        if entry.get("scope") != "project" or not isinstance(project, str):
            continue
        if not Path(project).is_dir():
            result["pruned"].append(project)
            continue
        if entry.get("version") == version and claude_record_content_matches(home, entry):
            result["current"].append(project)
            continue
        if dry_run:
            result["updated"].append(project)
            continue
        if not claude:
            result["failed"].append(project)
            continue
        command = [claude, "plugin", "update", CLAUDE_PLUGIN_ID, "--scope", "project"]
        completed = subprocess.run(command, cwd=project, capture_output=True, text=True)
        refreshed = [record for record in claude_plugin_records(home)
                     if record.get("scope") == "project" and record.get("projectPath") == project]
        verified = (completed.returncode == 0 and len(refreshed) == 1
                    and refreshed[0].get("version") == version
                    and claude_record_content_matches(home, refreshed[0]))
        result["updated" if verified else "failed"].append(project)
    return result


def _remove_if_only_cli_settings(directory: Path) -> bool:
    """Remove a directory the updater recreated, if it holds only what the CLI wrote."""
    settings = directory / ".claude" / "settings.json"
    entries = {path.relative_to(directory).as_posix() for path in directory.rglob("*")}
    if not entries <= {".claude", ".claude/settings.json"}:
        return False
    if settings.exists():
        try:
            if json.loads(settings.read_text(encoding="utf-8")) not in ({}, {"enabledPlugins": {}}):
                return False
        except ValueError:
            return False
        settings.unlink()
    if (directory / ".claude").exists():
        (directory / ".claude").rmdir()
    directory.rmdir()
    return True


def prune_claude_project_records(home: Path, projects: list[str], dry_run: bool,
                                 claude: Optional[str] = None, runner: Any = None) -> list[dict[str, Any]]:
    """Remove project records whose directory is gone, through the Claude CLI (spec M10).

    `claude plugin uninstall --scope project` acts only on the record for the
    directory it runs in, so the gone directory is recreated empty for the
    call and removed again afterwards; its parent must still exist. Claude
    Code's record file is backed up first, and success is the record gone on
    read-back. A record whose parent is gone too is left for Claude Code.
    """
    results: list[dict[str, Any]] = []
    if not projects:
        return results
    backup: Optional[Path] = None
    run = runner or subprocess.run
    for project in projects:
        target = Path(project)
        if not target.parent.is_dir():
            results.append({"project": project, "action": "prunable",
                            "detail": "the project folder and its parent are gone; left for Claude Code to drop"})
            continue
        if dry_run:
            results.append({"project": project, "action": "preview", "detail": "would remove this record through the Claude CLI"})
            continue
        if not claude:
            results.append({"project": project, "action": "prunable", "detail": "no Claude CLI to remove the record with"})
            continue
        if backup is None:
            source = claude_installed_plugins_path(home)
            backup = source.with_name("installed_plugins.dpf-prune-bak.json")
            suffix = 1
            while backup.exists():
                backup = source.with_name(f"installed_plugins.dpf-prune-bak.{suffix}.json")
                suffix += 1
            shutil.copy2(source, backup)
        target.mkdir()
        try:
            completed = run([claude, "plugin", "uninstall", CLAUDE_PLUGIN_ID, "--scope", "project", "--keep-data"],
                            cwd=str(target), capture_output=True, text=True, timeout=120)
            returncode = completed.returncode
        except (OSError, subprocess.SubprocessError):
            returncode = None
        finally:
            removed = _remove_if_only_cli_settings(target)
        remaining = any(r.get("scope") == "project" and r.get("projectPath") == project for r in claude_plugin_records(home))
        row: dict[str, Any] = {"project": project, "backupPath": str(backup)}
        if remaining:
            ran = "could not run" if returncode is None else f"exited {returncode}"
            row.update(action="failed", detail="the Claude CLI left the record in place" if returncode == 0
                       else f"claude plugin uninstall {ran}; the record is still present")
        else:
            row.update(action="pruned", detail="record removed through the Claude CLI")
        if not removed:
            row["detail"] += f"; {project} now holds other files, so it was left in place"
        results.append(row)
    return results


_MCP_URL_TEMPLATE = re.compile(r"^\$\{DPF_(?:CLAUDE_)?MCP_URL:-([^}]+)\}$")


def _dpf_endpoint_path(url: object) -> Optional[str]:
    if not isinstance(url, str):
        return None
    match = _MCP_URL_TEMPLATE.match(url)
    try:
        return urlsplit(match.group(1) if match else url).path.rstrip("/")
    except ValueError:
        return None


def retire_duplicate_project_mcp_json(project: Path, dry_run: bool) -> Optional[str]:
    """Disable a project .mcp.json `dpf` server that duplicates the plugin's.

    The plugin descriptor is the one dpf connector (BI-5201141C); a leftover
    project .mcp.json naming `dpf` on the same /api/mcp/v1 endpoint loads as a
    second `dpf` connector (BI-B9F359AC). Disable-not-delete: the original is
    kept as .mcp.json.legacy-bak. A file with only that server is renamed; a
    file with other servers keeps them and loses only the duplicate entry.
    Returns the backup path when it acted (or would act, in dry run).
    """
    path = project / ".mcp.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        servers = data["mcpServers"]
        dpf = servers["dpf"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if not isinstance(dpf, dict) or _dpf_endpoint_path(dpf.get("url")) != "/api/mcp/v1":
        return None
    backup = project / ".mcp.json.legacy-bak"
    suffix = 1
    while backup.exists():
        backup = project / f".mcp.json.legacy-bak.{suffix}"
        suffix += 1
    if dry_run:
        return str(backup)
    remaining = {name: server for name, server in servers.items() if name != "dpf"}
    if not remaining:
        path.rename(backup)
        return str(backup)
    shutil.copy2(path, backup)
    path.write_text(json.dumps({**data, "mcpServers": remaining}, indent=2) + "\n", encoding="utf-8")
    return str(backup)


def retire_user_scope_dpf_server(home: Path, dry_run: bool) -> Optional[str]:
    """Remove a user-scope `dpf` server that duplicates the plugin connector.

    A user-scope server in ~/.claude.json loads in every folder, so a legacy
    `dpf` entry there (the bearer-header registration the old token rotation
    wrote) shows beside the plugin's `dpf` in every session (BI-81B0A3BE).
    Acts only while the plugin connector is installed, and only on a `dpf`
    server on the /api/mcp/v1 endpoint. Disable-not-delete: the entry is copied
    to ~/.claude/dpf-user-mcp.legacy-bak.json first; the Claude CLI owns
    ~/.claude.json, so the removal goes through `claude mcp remove`.
    Returns None when there is nothing to do, else a status line.
    """
    if not claude_plugin_records(home):
        return None
    try:
        server = json.loads((home / ".claude.json").read_text(encoding="utf-8-sig"))["mcpServers"]["dpf"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if not isinstance(server, dict) or _dpf_endpoint_path(server.get("url")) != "/api/mcp/v1":
        return None
    backup = home / ".claude" / "dpf-user-mcp.legacy-bak.json"
    suffix = 1
    while backup.exists():
        backup = home / ".claude" / f"dpf-user-mcp.legacy-bak.{suffix}.json"
        suffix += 1
    if dry_run:
        return f"would remove (backup {backup})"
    claude = resolve_claude_binary()
    if not claude:
        return "failed: Claude CLI not found"
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_text(json.dumps({"mcpServers": {"dpf": server}}, indent=2) + "\n", encoding="utf-8")
    completed = subprocess.run(
        [claude, "mcp", "remove", "dpf", "-s", "user"], cwd=str(home), capture_output=True, text=True
    )
    if completed.returncode != 0:
        return f"failed: claude mcp remove exited {completed.returncode} (backup {backup})"
    return f"removed (backup {backup})"


def converge_claude_project_connectors(
    home: Path, version: str, dry_run: bool, outcome: Optional[dict[str, Any]] = None
) -> list[str]:
    """Converge stale project-scope plugin pins and duplicate project connectors.

    `outcome`, when given, receives the structured result for --report-json.
    """
    from installed_copy_freshness import installed_version

    version = installed_version(shared_managed_plugin_path(home)) or version.split("+", 1)[0]
    plugins = converge_claude_project_plugins(home, version, dry_run)
    pruned = prune_claude_project_records(home, plugins["pruned"], dry_run, claude=resolve_claude_binary())
    if outcome is not None:
        outcome["plugins"] = plugins
        outcome["retired"] = []
        outcome["prune"] = pruned
    verb = "would update" if dry_run else "updated"
    lines = [f"  Claude project scope: {verb} {len(plugins['updated'])}, "
             f"current {len(plugins['current'])}, failed {len(plugins['failed'])}, "
             f"gone {len(plugins['pruned'])}"]
    lines += [f"    {verb} to {version}: {project}" for project in plugins["updated"]]
    lines += [f"    FAILED to verify updated content: {project}; supported update did not establish the expected digest; client-owned cache retained"
              for project in plugins["failed"]]
    lines += [f"    {row['action']} (projectPath gone): {row['project']}; {row['detail']}" for row in pruned]
    projects = {
        entry["projectPath"]
        for entry in claude_plugin_records(home)
        if entry.get("scope") in ("project", "local") and isinstance(entry.get("projectPath"), str)
    }
    for project in sorted(projects):
        if not Path(project).is_dir():
            continue
        backup = retire_duplicate_project_mcp_json(Path(project), dry_run)
        if backup and outcome is not None:
            outcome["retired"].append((project, backup))
        if backup:
            action = "would disable" if dry_run else "disabled"
            lines.append(f"    {action} duplicate dpf connector in {Path(project) / '.mcp.json'} (backup {backup})")
    return lines


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


# macOS app folders that may bundle a Codex CLI (BI-90C9478D): the ChatGPT app
# ships one at Contents/Resources/codex-cli/bin/codex, and a host with only the
# app has no `codex` on PATH, so the updater used to report Codex as absent.
MACOS_APP_DIRS = (Path("/Applications"), Path.home() / "Applications")


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
        if platform.system() == "Darwin":
            candidates.extend(str(folder / "ChatGPT.app" / "Contents" / "Resources" / "codex-cli" / "bin" / "codex")
                              for folder in MACOS_APP_DIRS)
    found = shutil.which("codex")
    if found:
        candidates.append(found)
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def is_dpf_registration(row: dict) -> bool:
    return row.get("name") == PLUGIN_NAME or str(row.get("pluginId", "")).startswith(PLUGIN_NAME + "@")


def read_codex_plugin_inventory(codex: str, home: Path) -> tuple[list[dict], str | None]:
    """Read all marketplaces: a personal-only query hides the migrated install."""
    try:
        listed = subprocess.run([codex, "plugin", "list", "--json"], cwd=str(home),
                                capture_output=True, text=True)
        if listed.returncode != 0:
            return [], f"codex plugin list exited {listed.returncode}"
        inventory = json.loads(listed.stdout or "{}")
        rows = inventory.get("installed") if isinstance(inventory, dict) else None
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            return [], "Codex plugin list returned an invalid inventory"
        for row in rows:
            if is_dpf_registration(row):
                if not isinstance(row.get("pluginId"), str) or type(row.get("installed")) is not bool or type(row.get("enabled")) is not bool:
                    return [], "Codex plugin list returned an invalid DPF registration"
        return rows, None
    except (OSError, ValueError) as exc:
        return [], f"Codex inventory unavailable ({exc.__class__.__name__})"


def install_codex_plugin(home: Path, dry_run: bool) -> str:
    """Install and verify the DPF plugin through Codex's own registry."""
    codex = resolve_codex_binary()
    if not codex:
        return "skipped: Codex CLI not found"
    selector = f"{PLUGIN_NAME}@personal"
    if dry_run:
        return f"dry-run: would install and verify {selector}, then disable verified legacy DPF registrations"
    config = codex_config_path(home)
    before = config.read_text(encoding="utf-8-sig") if config.exists() else ""
    desired_enabled = desired_codex_plugin_enabled(before)
    try:
        installed = subprocess.run(
            [codex, "plugin", "add", selector, "--json"],
            cwd=str(home),
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        return f"failed: Codex CLI could not start ({exc.__class__.__name__})"
    # Even a failed native add can have changed configuration. Restore an
    # explicit disabled choice before any failure return or cache validation.
    if not desired_enabled and config.exists():
        current = config.read_text(encoding="utf-8-sig")
        if toml_table_enabled(current, f"plugins.{CODEX_PLUGIN_ID}") is not False:
            write_text_if_changed(config, set_codex_plugin_enabled(current, CODEX_PLUGIN_ID, False))
    if installed.returncode != 0:
        return f"failed: codex plugin add exited {installed.returncode}"
    try:
        installed_path = Path(json.loads(installed.stdout or "{}")["installedPath"])
    except (ValueError, KeyError, TypeError):
        return "failed: Codex did not return an installed plugin path"
    managed = codex_managed_plugin_path(home)
    if not installed_path.is_dir() or codex_content_version(installed_path) != codex_content_version(managed):
        return "failed: Codex plugin cache does not match the delivered skill pack"
    # Native add may write the obsolete bare alias. Restore the operator's
    # qualified choice before reading back, without touching hook trust.
    if config.exists():
        text = remove_toml_table(config.read_text(encoding="utf-8-sig"), f"plugins.{PLUGIN_NAME}")
        write_text_if_changed(config, set_codex_plugin_enabled(text, CODEX_PLUGIN_ID, desired_enabled))
    inventory, error = read_codex_plugin_inventory(codex, home)
    if error:
        return f"failed: {error}"
    matches = [
        plugin
        for plugin in inventory
        if isinstance(plugin, dict) and plugin.get("pluginId") == selector
    ]
    if len(matches) != 1 or matches[0].get("installed") is not True or matches[0].get("enabled") is not desired_enabled:
        return "failed: Codex did not report dpf-platform installed with the requested enabled state"
    if not desired_enabled:
        return "installed, disabled by operator, and verified; legacy registrations unchanged"
    active = [p for p in inventory if p.get("installed") and p.get("enabled")
              and is_dpf_registration(p)]
    if any(p["pluginId"] not in (CODEX_PLUGIN_ID, *CODEX_LEGACY_PLUGIN_IDS) for p in active):
        return "failed: unknown active DPF registration; legacy registrations unchanged"
    aliases = [p["pluginId"] for p in active if p["pluginId"] in CODEX_LEGACY_PLUGIN_IDS]
    if aliases:
        text = config.read_text(encoding="utf-8-sig") if config.exists() else ""
        for alias in aliases:
            text = set_codex_plugin_enabled(text, alias, False)
        write_text_if_changed(config, text)
        final, error = read_codex_plugin_inventory(codex, home)
        enabled_dpf = [p["pluginId"] for p in final if p.get("installed") and p.get("enabled")
                       and is_dpf_registration(p)]
        if error or enabled_dpf != [CODEX_PLUGIN_ID]:
            # A failed readback cannot prove convergence. Restore only the
            # toggles this migration changed, retaining all caches and options.
            text = config.read_text(encoding="utf-8-sig")
            for alias in aliases:
                text = set_codex_plugin_enabled(text, alias, True)
            write_text_if_changed(config, text)
            return f"failed: {error or 'Codex registration convergence was not verified'}; legacy registrations restored"
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
    # The file the `agy` CLI and Antigravity.app both read (BI-4CB3C923).
    # Pinned on 2026-10-20 against agy 1.4.3: `agy mcp add` writes here, and
    # both binaries name only this path. The earlier ~/.antigravity/
    # mcp_config.json guess is read by neither; a copy there is left in place.
    return home / ".gemini" / "config" / "mcp_config.json"


def _agy_entry(server: Any) -> Optional[dict[str, Any]]:
    """The fields of an agy `dpf` entry the updater converges."""
    if not isinstance(server, dict):
        return None
    headers = server.get("headers")
    return {"serverUrl": server.get("serverUrl"), "disabled": server.get("disabled") is True,
            "headers": dict(headers) if isinstance(headers, dict) else {}}


def _read_agy_servers(path: Path) -> dict[str, Any]:
    # agy leaves a 0-byte file behind when no server is configured; that is an
    # empty config. Unparseable content raises ValueError for the caller.
    raw = path.read_text(encoding="utf-8-sig") if path.exists() else ""
    data = json.loads(raw) if raw.strip() else {}
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    return servers if isinstance(servers, dict) else {}


def ensure_antigravity_mcp_config(home: Path, mcp_url: str, dry_run: bool, declarations: Any = None,
                                  runner: Any = None) -> str:
    """Converge agy's `dpf` MCP server through agy's own CLI, then read it back.

    `agy mcp add` covers the URL and headers, so it is the only writer of
    agy's config (BI-1DCF9F23, spec M4); `agy mcp disable` keeps an operator's
    disabled choice, since add resets it. Env-backed (no secret written): the
    CLI reads the token from DPF_MCP_BEARER_TOKEN at runtime. Success is the
    entry agy recorded, never the exit code (spec M3).
    """
    agy = resolve_antigravity_binary()
    if agy is None:
        return "absent: Antigravity CLI (agy) not found"
    path = antigravity_mcp_config_path(home)
    # Unparseable content is the operator's: leave it, and keep the rest of
    # the update running instead of exiting.
    try:
        servers = _read_agy_servers(path)
    except (OSError, ValueError):
        return f"skipped: cannot parse {path}; fix or empty it, then rerun"
    previous = _agy_entry(servers.get("dpf"))
    desired: dict[str, Any] = {"serverUrl": mcp_url, "disabled": bool(previous and previous["disabled"])}
    if mcp_client_bearer_header_required(mcp_url, "antigravity"):
        desired["headers"] = {"Authorization": f"Bearer ${{{TOKEN_ENV_VAR}}}"}
    if declarations is not None:
        desired = declarations.declare_server(desired, "antigravity")
    desired = _agy_entry(desired) or {}
    if previous == desired:
        return "already current"
    if dry_run:
        return f"dry-run: would run agy mcp add dpf {mcp_url}"
    command = [agy, "mcp", "add"]
    for name, value in desired["headers"].items():
        command += ["--header", f"{name}: {value}"]
    command += ["dpf", mcp_url]
    commands = [command] + ([[agy, "mcp", "disable", "dpf"]] if desired["disabled"] else [])
    # agy edits the config under HOME; point it at the home this run converges.
    env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home)}
    run = runner or subprocess.run
    for step in commands:
        try:
            completed = run(step, capture_output=True, text=True, env=env, timeout=60)
        except (OSError, subprocess.SubprocessError) as exc:
            return f"failed: agy {' '.join(step[1:3])} could not run ({exc.__class__.__name__})"
        if completed.returncode != 0:
            return f"failed: agy {' '.join(step[1:3])} exited {completed.returncode}"
    try:
        recorded = _agy_entry(_read_agy_servers(path).get("dpf"))
    except (OSError, ValueError):
        recorded = None
    if recorded != desired:
        return "failed: agy did not record the dpf server as requested"
    return "converged"


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
    "raw-tool-guard.mjs",
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

# PostToolUse (BI-AB4EA033, BI-C3D3762B): re-cache the claim guard's marker from
# each dpf claim/heartbeat answer, so a lease renewed over MCP stops the guard
# denying edits. Non-blocking. The matcher mirrors hooks.json (drift-tested).
CLAIM_REFRESH_SCRIPT = "workroom-claim-refresh.mjs"
CLAIM_REFRESH_MATCHER = (
    "^mcp__.+__(adopt_worktree|heartbeat_workroom|claim_workroom_scope"
    "|claim_backlog_item_for_work|create_workroom)$"
)


def grok_hooks_file(home: Path) -> Path:
    return home / ".grok" / "hooks" / "dpf-guards.json"


def _managed_hook_command(hooks_dir: Path, script: str, timeout: int = 15, event: str = "PreToolUse") -> dict[str, Any]:
    result = {
        "type": "command",
        "command": f'node "{hooks_dir / script}"',
        "timeout": timeout,
    }
    purpose = hook_purposes(hooks_dir.parent, event).get(script)
    if purpose:
        result["statusMessage"] = purpose
    return result


def _grok_command_entry(hooks_dir: Path, script: str, timeout: int = 15, event: str = "PreToolUse") -> dict[str, Any]:
    """Single-script PreToolUse group (legacy shape used by session events)."""
    return {"hooks": [_managed_hook_command(hooks_dir, script, timeout=timeout, event=event)]}


def _grok_matched_group(
    hooks_dir: Path,
    matcher: str,
    scripts: tuple[str, ...],
    *,
    dry_run: bool,
    timeout: int = 15,
) -> dict[str, Any] | None:
    hooks = [
        _managed_hook_command(hooks_dir, script, timeout=timeout)
        for script in scripts
        if dry_run or (hooks_dir / script).exists()
    ]
    if not hooks:
        return None
    return {"matcher": matcher, "hooks": hooks}


def claim_refresh_post_tool_use_groups(hooks_dir: Path, *, dry_run: bool) -> list[dict[str, Any]]:
    """The PostToolUse group that re-caches the Workroom claim marker, or none."""
    if not (dry_run or (hooks_dir / CLAIM_REFRESH_SCRIPT).exists()):
        return []
    return [{
        "matcher": CLAIM_REFRESH_MATCHER,
        "hooks": [_managed_hook_command(hooks_dir, CLAIM_REFRESH_SCRIPT, timeout=15, event="PostToolUse")],
    }]


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
    post_entries = claim_refresh_post_tool_use_groups(hooks_dir, dry_run=dry_run)
    if post_entries:
        payload["hooks"]["PostToolUse"] = post_entries
    start = [
        _grok_command_entry(hooks_dir, script, timeout=30, event="SessionStart")
        for script in GROK_SESSION_START_SCRIPTS
        if dry_run or (hooks_dir / script).exists()
    ]
    if start:
        payload["hooks"]["SessionStart"] = start
    end = [
        _grok_command_entry(hooks_dir, script, timeout=60, event="SessionEnd")
        for script in GROK_SESSION_END_SCRIPTS
        if dry_run or (hooks_dir / script).exists()
    ]
    if end:
        payload["hooks"]["SessionEnd"] = end
    stop = [
        _grok_command_entry(hooks_dir, script, timeout=60, event="Stop")
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


# Blocking guards Codex must run on each PreToolUse matcher. They serve two
# purposes (BI-2B634E68): proving the installed plugin cache wires every guard
# (codex_plugin_hooks_active), and recognising DPF-owned entries in
# ~/.codex/hooks.json. Only when the plugin plane cannot be proven are they
# written there as the fallback copy. decision-routing-guard is Gate A.
CODEX_BASH_GUARDS = (
    "lease-guard.mjs",
    "root-clone-guard.mjs",
    "compose-guard.mjs",
    # BI-F87BD9BF: raw tsc / root-level vitest / npx refused with the routine named.
    "raw-tool-guard.mjs",
    "portal-image-guard.mjs",
    "lease-punt-guard.mjs",
    "pregate-evidence-guard.mjs",
    "pregate-invocation-guard.mjs",
    # BI-0B292D84 - also on CODEX_WRITE_GUARDS; hooks.json wires it on both matchers.
    "workroom-claim-guard.mjs",
)
CODEX_ASK_GUARDS = ("decision-routing-guard.mjs",)
# Tool events whose DPF-owned entries the fallback copy writes and prunes.
CODEX_DPF_TOOL_EVENTS = ("PreToolUse", "PostToolUse")
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
    return any(name in command for name in (*CODEX_BASH_GUARDS, *CODEX_ASK_GUARDS, *CODEX_WRITE_GUARDS, CLAIM_REFRESH_SCRIPT))


def _build_codex_pre_tool_use_groups(managed: Path, *, dry_run: bool) -> list[dict[str, Any]]:
    hooks_dir = managed / "hooks"
    groups: list[dict[str, Any]] = []
    bash_entries = [
        _managed_hook_command(hooks_dir, guard)
        for guard in CODEX_BASH_GUARDS
        if dry_run or (hooks_dir / guard).exists()
    ]
    if bash_entries:
        groups.append({"matcher": "Bash", "hooks": bash_entries})
    ask_entries = [
        _managed_hook_command(hooks_dir, guard)
        for guard in CODEX_ASK_GUARDS
        if dry_run or (hooks_dir / guard).exists()
    ]
    if ask_entries:
        groups.append({"matcher": "AskUserQuestion", "hooks": ask_entries})
    write_entries = [
        _managed_hook_command(hooks_dir, guard)
        for guard in CODEX_WRITE_GUARDS
        if dry_run or (hooks_dir / guard).exists()
    ]
    if write_entries:
        groups.append({"matcher": "Write|Edit|MultiEdit", "hooks": write_entries})
    return groups


def prune_codex_hooks_payload(existing: dict[str, Any], hooks_dir: Path) -> dict[str, Any]:
    """Drop DPF-owned PreToolUse/PostToolUse entries; keep foreign hooks, drop emptied groups."""
    payload = dict(existing) if isinstance(existing, dict) else {}
    events = payload.get("hooks")
    events = dict(events) if isinstance(events, dict) else {}
    payload["hooks"] = events
    for event in CODEX_DPF_TOOL_EVENTS:
        groups = events.get(event)
        if not isinstance(groups, list):
            groups = []
        cleaned: list[Any] = []
        for group in groups:
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
        if cleaned:
            events[event] = cleaned
        else:
            events.pop(event, None)
    return payload


def _upsert_dpf_groups(cleaned: list[Any], dpf_groups: list[dict[str, Any]]) -> list[Any]:
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
    return cleaned


def merge_codex_hooks_payload(existing: dict[str, Any], managed: Path, *, dry_run: bool) -> dict[str, Any]:
    """Fallback: upsert DPF guards into ~/.codex/hooks.json without clobbering other hooks."""
    payload = prune_codex_hooks_payload(existing, managed / "hooks")
    events = payload["hooks"]
    events["PreToolUse"] = _upsert_dpf_groups(
        list(events.get("PreToolUse", [])), _build_codex_pre_tool_use_groups(managed, dry_run=dry_run)
    )
    post = _upsert_dpf_groups(
        list(events.get("PostToolUse", [])),
        claim_refresh_post_tool_use_groups(managed / "hooks", dry_run=dry_run),
    )
    if post:
        events["PostToolUse"] = post
    return payload


def codex_plugin_cache_hooks_path(managed: Path, home: Path) -> Optional[Path]:
    """hooks/hooks.json in the Codex plugin cache for the delivered version.

    Codex installs `dpf-platform@personal` into
    ~/.codex/plugins/cache/personal/dpf-platform/<version>/, keyed by the
    version this script writes into the managed .codex-plugin/plugin.json
    (codex_content_version; install_codex_plugin verifies the match).
    """
    version = read_json(managed / ".codex-plugin" / "plugin.json", {}).get("version")
    if not isinstance(version, str) or not version.strip():
        return None
    return home / ".codex" / "plugins" / "cache" / "personal" / PLUGIN_NAME / version / "hooks" / "hooks.json"


def codex_plugin_hooks_active(managed: Path, home: Path) -> bool:
    """True when Codex's installed, enabled DPF plugin wires every blocking guard.

    Codex loads plugin-bundled hooks (only Grok ignores them, BI-883FC2FC), so
    a user-file copy would run each guard twice and need trust twice
    (BI-2B634E68). Anything short of proof -- plugin not enabled, no cache for
    the delivered version, a cache missing a guard on its matcher -- is False
    and keeps the ~/.codex/hooks.json fallback.
    """
    config = codex_config_path(home)
    try:
        text = config.read_text(encoding="utf-8-sig") if config.exists() else ""
    except OSError:
        return False
    if toml_table_enabled(text, f"plugins.{CODEX_PLUGIN_ID}") is not True:
        return False
    cache_hooks = codex_plugin_cache_hooks_path(managed, home)
    if cache_hooks is None:
        return False
    try:
        data = json.loads(cache_hooks.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    groups = data.get("hooks", {}).get("PreToolUse") if isinstance(data, dict) else None
    if not isinstance(groups, list):
        return False
    wired: dict[str, set[str]] = {}
    for group in groups:
        if not isinstance(group, dict):
            continue
        names = wired.setdefault(str(group.get("matcher", "")), set())
        for hook in group.get("hooks", []):
            if isinstance(hook, dict):
                base = hook_script_basename(str(hook.get("command", "")))
                if base:
                    names.add(base)
    required = {
        "Bash": CODEX_BASH_GUARDS,
        "AskUserQuestion": CODEX_ASK_GUARDS,
        "Write|Edit|MultiEdit": CODEX_WRITE_GUARDS,
    }
    return all(set(guards) <= wired.get(matcher, set()) for matcher, guards in required.items())


def install_codex_hooks(managed: Path, home: Path, dry_run: bool) -> str:
    """Converge Codex on ONE active copy of the plane-1 guards (BI-2B634E68).

    Codex loads the plugin-bundled hooks/hooks.json from its plugin cache. When
    the enabled plugin's cache wires every guard, DPF-owned entries are PRUNED
    from ~/.codex/hooks.json (foreign hooks kept, emptied groups dropped) so each
    guard runs once and is trusted once, on the plugin hooks. Otherwise the
    guards are merged into ~/.codex/hooks.json as a fallback. Either plane still
    needs interactive HOOK TRUST (BI-66EBEA06); we never forge trusted_hash
    entries (openai/codex#21615).
    """
    path = codex_hooks_file(home)
    if codex_plugin_hooks_active(managed, home):
        if not path.exists():
            return "served by the dpf-platform plugin hooks (no user hook copy)"
        existing = read_json(path, {"hooks": {}})
        payload = prune_codex_hooks_payload(existing, managed / "hooks")
        if dry_run:
            return f"dry-run: would prune DPF guards from {path}; the dpf-platform plugin hooks carry them"
        changed = write_json(path, payload)
        return (
            f"pruned DPF guards from {path}; the dpf-platform plugin hooks carry them"
            + ("" if changed else " (unchanged)")
        )
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
    return f"merged guards into {path} (plugin hooks not proven active)" + ("" if changed else " (unchanged)")


def codex_hook_trust_established(home: Path, *, plugin_plane: bool = False) -> bool:
    """True when Codex has persisted hook-trust for the plane DPF relies on.

    Live-probed (BI-883FC2FC): absent `hooks.state` / `[hooks.state.*] trusted_hash`
    means every plugin + user hook is silently fail-open until the operator
    reviews `/hooks` and trusts. On the user-file fallback we treat ANY persisted
    trust as "operator has completed the flow at least once" -- a coarse but
    non-forged signal. On the plugin plane (BI-2B634E68) only trust recorded for
    the dpf-platform plugin hooks counts, so trust left over from the retired
    ~/.codex/hooks.json copy cannot mask untrusted plugin guards.
    """
    plugin_key = re.compile(
        r"hooks\.state\.[\"']" + re.escape(f"{CODEX_PLUGIN_ID}:hooks/hooks.json:")
        + r"[^\n]*\]\s*\n(?:[^\[\n][^\n]*\n|\s*\n)*?\s*trusted_hash\s*="
    )
    config = codex_config_path(home)
    if config.exists():
        text = config.read_text(encoding="utf-8")
        if plugin_plane:
            if plugin_key.search(text):
                return True
        elif "hooks.state" in text and "trusted_hash" in text:
            return True
    for name in ("hooks.state", "hooks.state.toml"):
        state_path = home / ".codex" / name
        if not state_path.exists() or state_path.stat().st_size == 0:
            continue
        if not plugin_plane:
            return True
        if plugin_key.search(state_path.read_text(encoding="utf-8", errors="replace")):
            return True
    return False


def codex_hook_trust_pending(home: Path, *, codex_present: bool, plugin_plane: bool = False) -> bool:
    if not codex_present:
        return False
    return not codex_hook_trust_established(home, plugin_plane=plugin_plane)


def codex_hook_trust_blocking_notice(*, plugin_plane: bool = False) -> list[str]:
    if plugin_plane:
        where = [
            "The guards run from the dpf-platform plugin's own hooks, once each. Trust is",
            "granted once, on those plugin hooks (source dpf-platform@personal); DPF no",
            "longer installs a second copy into ~/.codex/hooks.json (BI-2B634E68).",
        ]
    else:
        where = [
            "The plugin hooks could not be proven active, so the guards are installed in",
            "~/.codex/hooks.json as a fallback. Trust them there, once.",
        ]
    return [
        "",
        "ACTION REQUIRED — Codex hook trust not granted (BI-66EBEA06)",
        "Plane-1 governance guards are installed but will NOT run until you trust them.",
        *where,
        "  1. Start Codex in this repo:  codex",
        "  2. Run:  /hooks",
        "  3. Review the hook roster below and choose 'Trust all and continue'",
        "  4. Start a new Codex session — guards should then DENY unsafe commands",
        "",
        "Upstream: https://github.com/openai/codex/issues/21615 (no non-interactive trust API).",
        "Per-invocation bypass only: codex exec --dangerously-bypass-hook-trust ...",
        "",
    ]


# Purpose metadata lives with each canonical handler (BI-26DC98EE).
# Existing installer and client adapters consume it; there is no second roster.
def hook_purposes(skill_pack: Path, event: str) -> dict[str, str]:
    try:
        data = json.loads((skill_pack / "hooks" / "hooks.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    purposes = {}
    for key, groups in data.get("hooks", {}).items():
        if key != event:
            continue
        for group in groups:
            for hook in group.get("hooks", []):
                base = hook_script_basename(hook.get("command", ""))
                purpose = hook.get("statusMessage")
                if base and isinstance(purpose, str) and purpose.strip():
                    purposes.setdefault(base, purpose)
    return purposes


def hook_script_basename(command: str) -> str | None:
    """Extract the `*.mjs` script name from a hook `command` string."""
    match = re.search(r"([A-Za-z0-9_.-]+\.mjs)", command or "")
    return match.group(1) if match else None


def hook_roster(skill_pack: Path) -> list[str]:
    """Human-readable roster of the plugin's hooks (name + purpose), grouped by event.

    Printed so an operator granting hook-trust on Codex/Grok knows what each numbered
    "Hook N" actually is (BI-276EC984). Order follows hooks.json; clients may
    reorder it, so confirm the event and command before trusting a definition.
    On Codex this roster IS what the operator trusts: once the plugin hooks are
    proven active, DPF no longer installs a second ~/.codex/hooks.json copy with
    its own numbering (BI-2B634E68). The "Hook N" label itself is upstream
    (openai/codex#31469).
    """
    hooks_json = skill_pack / "hooks" / "hooks.json"
    try:
        data = json.loads(hooks_json.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    events = data.get("hooks", {})
    if not isinstance(events, dict):
        return []
    lines = ["Plugin hooks — purposes in definition order; confirm event and command in the trust UI:"]
    for event, groups in events.items():
        entry_lines = []
        n = 0
        for group in groups if isinstance(groups, list) else []:
            matcher = group.get("matcher") if isinstance(group, dict) else None
            for hook in group.get("hooks", []) if isinstance(group, dict) else []:
                n += 1
                base = hook_script_basename(hook.get("command", "")) or "?"
                purpose = hook.get("statusMessage") or "(purpose unavailable in this definition)"
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
        "  Codex : guards run from the dpf-platform plugin's hooks, once each, and DENY correctly "
        + "once trusted; ~/.codex/hooks.json carries them only as a fallback when the plugin "
        + "hooks cannot be proven active (BI-2B634E68). Codex gates every non-managed hook "
        + "behind interactive HOOK TRUST. Until you open a Codex TUI session and choose "
        + "'Trust all and continue' in /hooks, every guard is silently fail-open. There is no "
        + "non-interactive trust API (openai/codex#21615); '--dangerously-bypass-hook-trust' "
        + "is per-invocation only."
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


def hook_reference(skill_pack: Path) -> str:
    """Render the existing roster as a shipped reference, without reading trust state."""
    hooks_dir = (skill_pack / "hooks").resolve()
    data = json.loads((hooks_dir / "hooks.json").read_text(encoding="utf-8"))
    for groups in data["hooks"].values():
        for group in groups:
            for hook in group["hooks"]:
                base = hook_script_basename(hook.get("command", ""))
                source = (hooks_dir / (base or "")).resolve()
                if not base or hooks_dir not in source.parents or not source.is_file():
                    raise ValueError(f"Hook source is unavailable: {base}")
                if not isinstance(hook.get("statusMessage"), str) or not hook["statusMessage"].strip():
                    raise ValueError(f"Hook purpose is missing: {base}")
    lines = [
        "# DPF hook purposes", "",
        "Generated from [hooks.json](hooks.json). Do not edit this reference by hand.", "",
        "Before enabling a hook, match its event and command with the entries below.",
        "Numbers follow definition order; your client may order entries differently.",
        "The client owns the current trust state. This reference does not grant trust.", "",
        "Purpose text is stored as `statusMessage`, which clients may show while a hook runs.",
        "Friendly names in approval rows remain a [Codex client request](https://github.com/openai/codex/issues/31469).",
        "A purpose in this file is not proof that an approval row displays it.", "",
    ]
    for line in hook_roster(skill_pack)[1:]:
        if line.startswith("    "):
            entry = line.strip().replace("|", "\\|").replace("<", "&lt;").replace(">", "&gt;")
            entry = re.sub(r"([A-Za-z0-9_.-]+\.mjs)", r"[\1](\1)", entry, count=1)
            lines.append(f"- {entry}")
        else:
            lines.extend(["", f"## {line.strip().rstrip(':')}", ""])
    lines.extend(["", "Regenerate with `python scripts/update_agent_toolchain.py --write-hook-reference` from the skill-pack directory.", ""])
    return "\n".join(lines)


def register_toolchain_agent(home: Path, portal_sourced: bool, dry_run: bool, env: Mapping[str, str]) -> Optional[str]:
    """Schedule the host convergence agent after a portal-sourced run (BI-65C17737).

    A portal run is what pins the installation, so only then can the host keep
    itself current. The agent runs from the shared copy this run refreshed, so
    it is updated by the same delivery it performs.
    """
    if not portal_sourced or dry_run:
        return None
    import toolchain_agent

    script = shared_managed_plugin_path(home) / "scripts" / "toolchain_agent.py"
    if not script.is_file():
        return "skipped: the shared copy has no toolchain_agent.py"
    return toolchain_agent.ensure_schedule(home, sys.executable, str(script), env)


def main(argv: list[str]) -> int:
    """Run under the host's single convergence lock (BI-65C17737, spec row X3).

    The hourly agent and an agent-run update must never converge at once. The
    holder exports the lock to the updater processes it starts.
    """
    import time as _time

    import toolchain_agent

    # Read-only and repo-maintenance modes converge nothing, so they never wait
    # on, or take, the host lock.
    lock_free = {"--dry-run", "--check-hook-reference", "--write-hook-reference",
                 "--print-existing-codex-mcp-url", "-h", "--help"}
    if lock_free.intersection(argv) or os.environ.get(toolchain_agent.LOCK_HELD_ENV) == "1":
        return _main(argv)
    home = home_dir()
    if not toolchain_agent.acquire_lock(home, _time.time()):
        print("Another DPF toolchain convergence is running on this host and will finish the update. (busy)",
              file=sys.stderr)
        return toolchain_agent.EXIT_BUSY
    os.environ[toolchain_agent.LOCK_HELD_ENV] = "1"
    try:
        return _main(argv)
    finally:
        os.environ.pop(toolchain_agent.LOCK_HELD_ENV, None)
        toolchain_agent.release_lock(home)


def _main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Update DPF Codex/Claude/Grok/Antigravity agent skills and MCP wiring.")
    parser.add_argument("--skill-pack-path", default=str(default_skill_pack_path()))
    parser.add_argument("--project-root", type=Path, help="Explicit DPF source project for client configuration")
    parser.add_argument("--permissions-only", action="store_true",
                        help="Converge only routine native permissions for --project-root; no plugin, credential or connector refresh.")
    parser.add_argument("--mcp-url", default=os.environ.get("DPF_MCP_URL") or None)
    parser.add_argument("--auth-mode", choices=("oauth", "legacy"), default=os.environ.get("DPF_MCP_AUTH_MODE", "oauth"))
    parser.add_argument("--codex-only", action="store_true")
    parser.add_argument("--codex-plugin-only", action="store_true",
                        help="Refresh only Codex plugin files and registration; the repository planner owns connector configuration.")
    parser.add_argument("--print-existing-codex-mcp-url", action="store_true",
                        help="Read the saved Codex DPF endpoint without changing configuration or plugins.")
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
    parser.add_argument(
        "--grok-client-stdin",
        action="store_true",
        help="Read Grok's credentials client (from issue_grok_credentials_client) as JSON on stdin (BI-84C1F526).",
    )
    parser.add_argument("--dry-run", action="store_true")
    # BI-DE1E6485 (design 2026-10-07 §5.3): pull the pack from the portal,
    # verified by the installation's signature, instead of a local directory.
    parser.add_argument("--from-portal", metavar="ORIGIN",
                        help="Converge from this DPF portal origin (https or loopback); see portal_source.py.")
    parser.add_argument("--expect-installation", metavar="DID",
                        help="Device id (did_...) from this session's authenticated DPF connection.")
    parser.add_argument("--approve-identity-change", action="store_true",
                        help="The user approved a portal whose identity differs from this host's pin.")
    parser.add_argument("--report-json", metavar="PATH",
                        help="Write the per-client, per-scope convergence report as JSON.")
    parser.add_argument("--portal-manifest", help=argparse.SUPPRESS)
    reference_mode = parser.add_mutually_exclusive_group()
    reference_mode.add_argument("--write-hook-reference", action="store_true")
    reference_mode.add_argument("--check-hook-reference", action="store_true")
    args = parser.parse_args(argv)
    if args.print_existing_codex_mcp_url:
        path = codex_config_path(home_dir())
        text = path.read_text(encoding="utf-8-sig") if path.exists() else ""
        print(existing_codex_mcp_endpoint(text) or "")
        return 0
    if args.mcp_url:
        args.mcp_url = normalize_mcp_endpoint(args.mcp_url)
    if args.from_portal:
        import portal_source

        return portal_source.run_from_portal(args, argv, home_dir(), os.environ)
    mcp_url = args.mcp_url or DEFAULT_MCP_URL
    os.environ["DPF_MCP_AUTH_MODE"] = args.auth_mode

    if args.write_hook_reference or args.check_hook_reference:
        root = Path(args.skill_pack_path).expanduser().resolve()
        reference = hook_reference(root)
        path = root / "hooks" / "README.md"
        if args.write_hook_reference:
            path.write_text(reference, encoding="utf-8")
            return 0
        if not path.exists() or path.read_text(encoding="utf-8") != reference:
            print("Hook reference is stale; regenerate it from hooks.json.", file=sys.stderr)
            return 1
        return 0

    if args.codex_only and args.claude_only:
        raise SystemExit("--codex-only and --claude-only cannot be combined")

    skill_pack = Path(args.skill_pack_path).expanduser().resolve()
    manifest = validate_skill_pack(skill_pack)
    version = str(manifest.get("version", "0.0.0"))
    home = home_dir()
    codex_managed = codex_managed_plugin_path(home)
    shared_managed = shared_managed_plugin_path(home)
    permission_runtime_unavailable = False
    if args.project_root and (args.project_root / 'packages/dpf-skill-pack').is_dir():
        import routine_permissions
        permission_runtime_unavailable = routine_permissions.tomllib is None
        if permission_runtime_unavailable:
            print('Routine permissions UNRUN: Python 3.11+ or tomli is required; no permission configuration changed.')
    selected_permission_clients = ('codex','grok') if args.codex_only else ('claude-code',) if args.claude_only else ('codex','claude-code','grok')
    unrun_permission_rows = [{'client': client, 'scope': 'permissions:' + str(args.project_root.resolve()),
        'action': 'unrun', 'sessionVerified': False, 'restartRequired': False,
        'detail': 'TOML parser unavailable; existing permissions retained. Use a supported Python runtime.'}
        for client in selected_permission_clients] if permission_runtime_unavailable else []
    if args.permissions_only:
        if permission_runtime_unavailable:
            if args.report_json:
                import toolchain_convergence as convergence
                portal_manifest = read_json(Path(args.portal_manifest), {}) if args.portal_manifest else None
                report = convergence.ConvergenceReport(home, convergence.Declarations(skill_pack, portal_manifest), portal_manifest)
                report.add_permissions(unrun_permission_rows)
                report.write(args.report_json, args.dry_run)
            return 2
        if not args.project_root or args.codex_plugin_only or args.grok_client_stdin or args.codex_only or args.claude_only:
            parser.error("--permissions-only requires --project-root and cannot refresh plugins or credentials")
        import routine_permissions
        import toolchain_convergence as convergence
        try:
            plan = routine_permissions.plan_permissions(args.project_root, home, skill_pack)
            rows = routine_permissions.apply_permissions(plan, args.dry_run, native=True)
        except (OSError, routine_permissions.PermissionPlanError) as error:
            print(f"Permission convergence failed: {error}", file=sys.stderr)
            return 1
        for row in rows:
            print(f"  {row['client']}: {row['action']} routine permissions; session verification pending")
        if args.report_json:
            portal_manifest = read_json(Path(args.portal_manifest), {}) if args.portal_manifest else None
            report = convergence.ConvergenceReport(home, convergence.Declarations(skill_pack, portal_manifest), portal_manifest)
            report.add_permissions(rows)
            report.write(args.report_json, args.dry_run)
        return 1 if any(row['action'] == 'failed' for row in rows) else 0

    if args.codex_plugin_only:
        if args.claude_only or args.codex_only or args.skip_codex_cli_install:
            parser.error("--codex-plugin-only cannot be combined with client selection or skip-install flags")
        if resolve_codex_binary() is None:
            print("Codex plugin refresh skipped: Codex CLI not found")
            return 0
        copy_skill_pack(skill_pack, codex_managed, args.dry_run)
        codex_version = codex_content_version(skill_pack)
        if not args.dry_run:
            write_json(codex_managed / ".codex-plugin" / "plugin.json", {**manifest, "version": codex_version})
        ensure_codex_marketplace(home, codex_version, args.dry_run)
        status = install_codex_plugin(home, args.dry_run)
        print(f"Codex plugin refresh: {status}")
        return 1 if status.startswith("failed:") else 0

    print(f"DPF agent toolchain updater")
    print(f"  skill pack : {skill_pack}")
    print(f"  version    : {version}")
    print(f"  home       : {home}")
    print(f"  MCP URL    : {args.mcp_url or 'preserve existing Codex endpoint; new clients use ' + mcp_url}")

    # BI-DE1E6485: the declaration each connector carries, and the report's
    # "before" state, which must be read before anything is copied.
    import toolchain_convergence as convergence

    portal_manifest = read_json(Path(args.portal_manifest), {}) if args.portal_manifest else None
    pack_identity = convergence.Declarations(skill_pack, portal_manifest)
    pack_identity.converge = convergence.agent_converge_token(home)
    # A connector declares only a well-formed pack version (design §5.2).
    declarations = pack_identity if pack_identity.enabled() else None
    report = (convergence.ConvergenceReport(home, pack_identity, portal_manifest, endpoint=mcp_url)
              if args.report_json else None)
    codex_header = declarations.header_value("codex") if declarations and declarations.carrier("codex") == "header" else None

    copy_skill_pack(skill_pack, codex_managed, args.dry_run)
    copy_skill_pack(skill_pack, shared_managed, args.dry_run)
    from installed_copy_freshness import delivered_version as _delivered_version

    delivered = _delivered_version(skill_pack) or version
    if not args.dry_run:
        stamp_delivered_version(shared_managed, delivered)
        import time as _time

        write_delivery_provenance(shared_managed, delivered, portal_manifest,
                                  None if portal_manifest is not None else source_checkout_of(skill_pack), _time.time())
    codex_version = codex_content_version(skill_pack)
    if not args.dry_run:
        write_json(codex_managed / ".codex-plugin" / "plugin.json", {**manifest, "version": codex_version})
    print(f"  Codex source : {codex_managed}")
    print(f"  shared source: {shared_managed}")
    if declarations is not None:
        convergence.declare_grok_descriptor(shared_managed, declarations, args.dry_run)
        print(f"  declares   : pack {declarations.pack}, digest {declarations.digest[:16]}")
    if report:
        report.add("shared", "copy", "copied")
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
    codex_install_failed = False

    if not args.claude_only:
        ensure_codex_marketplace(home, codex_version, args.dry_run)
        codex_status = "skipped by flag"
        try:
            ensure_codex_config(home, args.mcp_url, args.dry_run, process_spine_root, codex_header)
            codex_status = "skipped by flag"
            if not args.skip_codex_cli_install:
                codex_status = install_codex_plugin(home, args.dry_run)
                codex_install_failed = codex_status.startswith("failed:")
                # Codex currently writes a legacy `[plugins."<name>"]` alias while
                # installing a qualified registry id. Converge again after the CLI
                # mutation so the next process does not warn that `dpf-platform`
                # lacks its `@marketplace` qualifier.
                ensure_codex_config(home, args.mcp_url, args.dry_run, process_spine_root, codex_header)
            if args.project_root and args.project_root.resolve() != home.resolve():
                global_config = codex_config_path(home)
                saved = global_config.read_text(encoding="utf-8-sig") if global_config.exists() else ""
                endpoint = args.mcp_url or existing_codex_mcp_endpoint(saved) or DEFAULT_MCP_URL
                project_status = converge_codex_project_config(args.project_root, endpoint, args.dry_run)
                print(f"  Codex project override : {project_status}")
            codex_hooks_status = install_codex_hooks(codex_managed, home, args.dry_run)
            print(
                f"  Codex      : marketplace + config converged; plugin {codex_status}; "
                f"hooks {codex_hooks_status}"
            )
        except ValueError as error:
            if not codex_present and "require Python 3.11+, tomli or the Codex CLI" in str(error):
                # No Codex binary and no TOML parser: nothing on this host reads
                # Codex settings, so leaving them unchanged is not a failure
                # (BI-90C9478D, spec row X11).
                codex_status = "absent: no Codex CLI found and no TOML parser; Codex settings left unchanged"
            else:
                codex_status = f"failed: {error}"
                codex_install_failed = True
            print(f"  Codex      : {codex_status}")
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
        # Grok's own OAuth credentials client, refreshed into bearer_token_file
        # (BI-84C1F526, DI-4B843FAF62F9). The secret arrives on stdin only.
        grok_credential_status = converge_grok_credential(
            home=home, refresher=find_grok_refresher(skill_pack), mcp_url=args.mcp_url,
            client_payload=sys.stdin.read() if args.grok_client_stdin else None,
            dry_run=args.dry_run, default_mcp_url=mcp_url,
            # The query carrier declare_grok_descriptor writes into grok.mcp.json, so the
            # config.toml connector declares the pack too (design §5.2).
            declare_url=(lambda url: declarations.query_url(url, "grok"))
            if declarations is not None and declarations.carrier("grok") == "query" else None,
        )
        print(f"  Grok credential: {grok_credential_status}")
        if report:
            report.add("codex", "user", codex_status)
            report.add("grok", "user", grok_status)
        # Antigravity (agy): MCP-config wiring + skill-pack sync.
        antigravity_status = "skipped by flag"
        if not args.skip_antigravity_cli_install:
            ensure_antigravity_plugin_descriptor(
                shared_managed if not args.dry_run else skill_pack,
                mcp_url,
                args.dry_run,
                declarations,
            )
            mcp_st = ensure_antigravity_mcp_config(home, mcp_url, args.dry_run, declarations)
            skills_st = ensure_antigravity_skills(skill_pack, home, args.dry_run)
            # Lead with an absent CLI or a failure so the report classifies the row (spec M3).
            lead, _, rest = mcp_st.partition(": ")
            antigravity_status = (f"{lead}: MCP config {rest}; skills {skills_st}" if lead in ("absent", "failed") and rest
                                  else f"MCP config {mcp_st}; skills {skills_st}")
        print(f"  Antigravity: {antigravity_status}")
        if report:
            report.add("antigravity", "user", antigravity_status)
    # Every run looks for installed clients, so one added since bootstrap is
    # seen, and one DPF cannot converge is reported rather than skipped (spec M6).
    discovered = convergence.discover_clients(home)
    unadapted = sorted(client for client in discovered if client not in convergence.DEFAULT_CARRIERS)
    if unadapted:
        print(f"  Also found : {', '.join(unadapted)} (no DPF adapter yet; reported as unproven)")
    if report:
        report.add_discovery(discovered)

    claude_install_failed = False
    if not args.codex_only:
        ensure_claude_marketplace(home, delivered, args.dry_run)
        ensure_claude_repo_mcp_config(
            shared_managed if not args.dry_run else skill_pack,
            mcp_url,
            args.dry_run,
            declarations,
        )
        status = "skipped by flag"
        if not args.skip_claude_cli_install:
            status = install_claude_plugin(home, args.dry_run)
            claude_install_failed = status.startswith("failed:")
        print(f"  Claude     : marketplace {'would converge' if args.dry_run else 'converged'}; plugin install {status}")
        if not args.skip_claude_cli_install:
            project_outcome: dict[str, Any] = {}
            for line in converge_claude_project_connectors(home, version, args.dry_run, project_outcome):
                print(line)
            claude_install_failed = claude_install_failed or bool((project_outcome.get("plugins") or {}).get("failed"))
            user_scope_status = retire_user_scope_dpf_server(home, args.dry_run)
            if user_scope_status:
                print(f"  Claude user-scope dpf duplicate: {user_scope_status}")
            local_scope = convergence.retire_local_scope_dpf_servers(home, args.dry_run)
            for row in local_scope:
                print(f"  Claude local-scope dpf duplicate in {row['project']}: {row['action']}"
                      + (f" (backup {row['backupPath']})" if row.get("backupPath") else ""))
            # Until every client parses the shipped descriptor, each converged
            # record's cached copy gets a literal endpoint (design §5.4).
            pins = convergence.pin_record_descriptors(home, mcp_url, os.environ, args.dry_run)
            pinned = [row["project"] for row in pins if row["action"] == "updated"]
            if pinned:
                print(f"  Claude connector URL pinned for {len(pinned)} project record(s)")
            if report:
                convergence.record_claude_scopes(
                    report, home, status, project_outcome, user_scope_status, local_scope)
        claude_competitive_status = "skipped by flag"
        if not args.skip_claude_cli_install:
            claude_competitive_status = disable_competitive_claude_plugins(
                process_spine_root, dry_run=args.dry_run
            )
        print(f"  Claude competitive: {claude_competitive_status}")

    permission_failed = False
    if args.project_root and (args.project_root / 'packages/dpf-skill-pack').is_dir() and not permission_runtime_unavailable:
        import routine_permissions
        try:
            permission_rows = routine_permissions.apply_permissions(
                routine_permissions.plan_permissions(args.project_root, home, skill_pack,
                    clients=('codex','grok') if args.codex_only else ('claude-code',) if args.claude_only else ('codex','claude-code','grok')),
                args.dry_run, native=True)
            permission_failed = any(row['action'] == 'failed' for row in permission_rows)
            if report:
                report.add_permissions(permission_rows)
        except (OSError, routine_permissions.PermissionPlanError) as error:
            permission_failed = True
            print(f"Permission convergence failed: {error}", file=sys.stderr)
    if permission_runtime_unavailable and report:
        report.add_permissions(unrun_permission_rows)
    token_present = bool(os.environ.get(TOKEN_ENV_VAR))
    written_word = "would be written" if args.dry_run else "written"
    print(f"  MCP auth   : OAuth configuration {written_word}; sign in and verify through the client. Unverified clients/transports require explicit legacy compatibility." if args.auth_mode == "oauth" else "  MCP auth   : explicit legacy compatibility")
    print(f"  MCP token  : {'present' if token_present else 'missing'} ({TOKEN_ENV_VAR})")
    for line in guard_liveness_advisory():
        print(line)

    exit_code = 1 if codex_install_failed or claude_install_failed or permission_failed else 0
    roster_printed = False
    plugin_plane = codex_plugin_hooks_active(codex_managed, home)
    trust_pending = codex_hook_trust_pending(home, codex_present=codex_present, plugin_plane=plugin_plane)
    if trust_pending:
        for line in codex_hook_trust_blocking_notice(plugin_plane=plugin_plane):
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

    agent_status = register_toolchain_agent(home, portal_manifest is not None, args.dry_run, os.environ)
    if agent_status:
        print(f"  Toolchain agent: {agent_status}")
    if report:
        written = report.write(args.report_json, args.dry_run)
        print(f"  Report     : {args.report_json} ({written['result']})")
        if written["result"] == "failed" and not args.dry_run:
            exit_code = exit_code or 1
    if exit_code:
        print("Incomplete: toolchain convergence is unverified; resolve the reported failure before restarting a client.")
    elif args.dry_run:
        # A preview writes nothing; it never reports converged or done (BI-81AB897A E3).
        print("Preview only: nothing was written. These are the changes an update would make.")
    elif permission_runtime_unavailable:
        print("Skills and connectors converged; routine permissions remain UNRUN because the Python TOML parser is unavailable.")
    else:
        print("Done. Start a new Codex/Claude/Grok session to load updated skills.")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
