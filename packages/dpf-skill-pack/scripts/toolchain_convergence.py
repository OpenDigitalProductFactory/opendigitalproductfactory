"""Declaration, per-scope report and Claude scope repairs for the updater.

BI-DE1E6485 (design docs/superpowers/specs/2026-10-07-agent-toolchain-release-delivery-design.md
§5.2 and §5.3). update_agent_toolchain.py calls into this module; it holds no
convergence policy of its own beyond what is named here.

- **Declaration.** Each client's connector carries the pack it loaded
  (`pack`, the first 16 hex of the delivered `digest`, and `client`) so the
  server can tell a current copy from a stale one. The carrier per client is
  the manifest's `clients[kind].declarationCarrier`; without a manifest it is
  DEFAULT_CARRIERS, which mirrors DECLARATION_CARRIERS in
  apps/web/lib/agent-toolchain/toolchain-manifest.ts. The header carrier
  leaves the connector URL, and so the OAuth resource and the desktop app's
  URL check, unchanged. The query carrier is used only on a literal URL.
- **Report.** `--report-json` records, per client and scope, the version,
  digest and auth mode before and after, the action taken, any backup, and
  whether a restart is needed, plus each client CLI's own `--version`.
- **Claude scopes.** A `dpf` server in a project's local-scope settings that
  duplicates the plugin connector is backed up and removed through
  `claude mcp remove dpf -s local`. The cached descriptor of every project
  and local record gets a literal endpoint, as
  scripts/hooks/lib/pin-plugin-mcp-url.mjs does for the source repo.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

DECLARATION_HEADER = "X-DPF-Toolchain"
DECLARATION_QUERY_KEYS = ("dpf_pack", "dpf_digest", "dpf_client")
DEFAULT_CARRIERS = {"claude-code": "header", "codex": "header", "grok": "query", "antigravity": "header"}
CANONICAL_MCP_URL = "https://localhost/api/mcp/v1?tier=full"
# Current copies template DPF_CLAUDE_MCP_URL, legacy ones DPF_MCP_URL (BI-D6A6462A).
_TEMPLATE = re.compile(r"^\$\{DPF_(?:CLAUDE_)?MCP_URL:-([^}]+)\}$")
_SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
RESTART_ACTIONS = ("updated", "retired")


def _updater():
    import update_agent_toolchain as updater

    return updater


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------- declaration


def pack_version(skill_pack: Path) -> Optional[str]:
    source = _read_json(skill_pack / "toolchain-version.json")
    if isinstance(source, dict) and isinstance(source.get("packVersion"), str):
        return source["packVersion"]
    from installed_copy_freshness import pack_version as manifest_version

    return manifest_version(skill_pack)


class Declarations:
    """What each client declares for one pack, and how it carries it."""

    def __init__(self, skill_pack: Path, manifest: Optional[Mapping[str, Any]] = None) -> None:
        from installed_copy_freshness import delivered_digest

        version = pack_version(skill_pack) or "0.0.0"
        self.pack = version.split("+", 1)[0]
        self.digest = delivered_digest(skill_pack)
        self.manifest = manifest or {}

    def enabled(self) -> bool:
        return bool(_SEMVER.match(self.pack))

    def carrier(self, client: str) -> str:
        shape = (self.manifest.get("clients") or {}).get(client) if isinstance(self.manifest, Mapping) else None
        chosen = shape.get("declarationCarrier") if isinstance(shape, Mapping) else None
        return chosen if chosen in ("query", "header") else DEFAULT_CARRIERS.get(client, "header")

    def header_value(self, client: str) -> str:
        return f"pack={self.pack};digest={self.digest[:16]};client={client}"

    def query_url(self, url: str, client: str) -> str:
        parts = urlsplit(url)
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in DECLARATION_QUERY_KEYS]
        query += [("dpf_pack", self.pack), ("dpf_digest", self.digest[:16]), ("dpf_client", client)]
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

    def declare_server(self, server: dict[str, Any], client: str) -> dict[str, Any]:
        """A JSON connector entry carrying this declaration (a new dict)."""
        declared = dict(server)
        url = declared.get("url")
        if self.carrier(client) == "query" and isinstance(url, str) and not _TEMPLATE.match(url):
            declared["url"] = self.query_url(url, client)
            return declared
        # A templated URL cannot take a query outside the expansion: an
        # override without a query of its own would end in `/v1&dpf_pack=`.
        headers = {k: v for k, v in (declared.get("headers") or {}).items() if k.lower() != DECLARATION_HEADER.lower()}
        headers[DECLARATION_HEADER] = self.header_value(client)
        declared["headers"] = headers
        return declared


def declare_grok_descriptor(managed: Path, declarations: Declarations, dry_run: bool) -> bool:
    """Write the declaration into the shared copy's grok.mcp.json, keeping its endpoint."""
    path = managed / "grok.mcp.json"
    data = _read_json(path)
    server = ((data or {}).get("mcp_servers") or {}).get("dpf") if isinstance(data, dict) else None
    if not isinstance(server, dict) or dry_run:
        return False
    data["mcp_servers"]["dpf"] = declarations.declare_server(server, "grok")
    return _updater().write_json(path, data)


# ---------------------------------------------------------------- Claude scopes


def _backup_path(directory: Path, stem: str) -> Path:
    backup = directory / f"{stem}.legacy-bak.json"
    suffix = 1
    while backup.exists():
        backup = directory / f"{stem}.legacy-bak.{suffix}.json"
        suffix += 1
    return backup


def retire_local_scope_dpf_servers(home: Path, dry_run: bool) -> list[dict[str, Any]]:
    """Remove each project's local-scope `dpf` server that duplicates the plugin connector.

    Claude Code keeps local-scope servers per project in ~/.claude.json
    (`projects[<path>].mcpServers`). A `dpf` entry there on /api/mcp/v1 loads
    beside the plugin's `dpf` in that folder, like the user-scope duplicate
    BI-81B0A3BE retires. Each definition is backed up first and removed through
    the CLI, which owns the file.
    """
    updater = _updater()
    if not updater.claude_plugin_records(home):
        return []
    data = _read_json(home / ".claude.json")
    projects = data.get("projects") if isinstance(data, dict) else None
    if not isinstance(projects, dict):
        return []
    results: list[dict[str, Any]] = []
    claude = None if dry_run else updater.resolve_claude_binary()
    for project, settings in sorted(projects.items()):
        server = ((settings or {}).get("mcpServers") or {}).get("dpf") if isinstance(settings, dict) else None
        if not isinstance(server, dict) or updater._dpf_endpoint_path(server.get("url")) != "/api/mcp/v1":
            continue
        if not Path(project).is_dir():
            results.append({"project": project, "action": "prunable"})
            continue
        backup = _backup_path(home / ".claude", "dpf-local-mcp")
        if dry_run:
            results.append({"project": project, "action": "retired", "backupPath": str(backup), "dryRun": True})
            continue
        if not claude:
            results.append({"project": project, "action": "failed", "reason": "Claude CLI not found"})
            continue
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_text(json.dumps({"projectPath": project, "mcpServers": {"dpf": server}}, indent=2) + "\n",
                          encoding="utf-8")
        completed = subprocess.run([claude, "mcp", "remove", "dpf", "-s", "local"], cwd=project,
                                   capture_output=True, text=True)
        action = "retired" if completed.returncode == 0 else "failed"
        results.append({"project": project, "action": action, "backupPath": str(backup)})
    return results


def _https_literal(value: object) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parts = urlsplit(value.strip())
    except ValueError:
        return None
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.netloc.startswith("["):
        return None
    return urlunsplit(parts)


def resolve_pin_target(current: object, mcp_url: Optional[str], env: Mapping[str, str]) -> Optional[str]:
    """The literal endpoint a cached descriptor should carry (mirrors resolvePinTarget)."""
    literal = _https_literal(env.get(_updater().CLAUDE_MCP_URL_ENV_VAR))
    if literal:
        return literal
    literal = _https_literal(mcp_url)
    if literal:
        return _updater().with_mcp_catalog_tier(literal, "full")
    template = _TEMPLATE.match(current) if isinstance(current, str) else None
    if template:
        return _https_literal(template.group(1))
    if isinstance(current, str) and current.strip().lower().startswith("http://"):
        return CANONICAL_MCP_URL
    return None


def preserve_query(target: str, current: object) -> str:
    """Keep query parameters the current URL carries that the target does not set."""
    template = _TEMPLATE.match(current) if isinstance(current, str) else None
    source = template.group(1) if template else current
    if not isinstance(source, str):
        return target
    try:
        kept = parse_qsl(urlsplit(source).query, keep_blank_values=True)
        parts = urlsplit(target)
    except ValueError:
        return target
    query = parse_qsl(parts.query, keep_blank_values=True)
    names = {key for key, _ in query}
    query += [(key, value) for key, value in kept if key not in names]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def pin_record_descriptors(home: Path, mcp_url: Optional[str], env: Mapping[str, str], dry_run: bool) -> list[dict[str, Any]]:
    """Give every existing project and local record's cached descriptor a literal URL."""
    results: list[dict[str, Any]] = []
    for entry in _updater().claude_plugin_records(home):
        project, install = entry.get("projectPath"), entry.get("installPath")
        if entry.get("scope") not in ("project", "local") or not isinstance(project, str) or not isinstance(install, str):
            continue
        if not Path(project).is_dir():
            continue
        path = Path(install) / "claude.mcp.json"
        data = _read_json(path)
        server = ((data or {}).get("mcpServers") or {}).get("dpf") if isinstance(data, dict) else None
        if not isinstance(server, dict):
            continue
        headers = server.get("headers") or {}
        if any(str(key).lower() == "authorization" for key in headers):
            results.append({"project": project, "action": "unchanged", "reason": "bearer descriptor left alone"})
            continue
        target = resolve_pin_target(server.get("url"), mcp_url, env)
        if not target:
            continue
        target = preserve_query(target, server.get("url"))
        if server.get("url") == target:
            results.append({"project": project, "action": "unchanged"})
            continue
        if not dry_run:
            server["url"] = target
            tmp = path.with_name(f"{path.name}.tmp{os.getpid()}")
            tmp.write_bytes((json.dumps(data, indent=2) + "\n").encode("utf-8"))
            os.replace(tmp, path)
        results.append({"project": project, "action": "updated", "url": target})
    return results


# ---------------------------------------------------------------- report


def _auth_from_json_server(server: Any) -> Optional[str]:
    if not isinstance(server, dict):
        return None
    headers = server.get("headers") or {}
    if any(str(key).lower() == "authorization" for key in headers) or server.get("bearer_token_file"):
        return "bearer"
    return "oauth"


def _descriptor_auth(copy: Path) -> Optional[str]:
    data = _read_json(copy / "claude.mcp.json")
    return _auth_from_json_server(((data or {}).get("mcpServers") or {}).get("dpf") if isinstance(data, dict) else None)


def _codex_auth(home: Path) -> Optional[str]:
    path = _updater().codex_config_path(home)
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return None
    if "[mcp_servers.dpf]" not in text:
        return None
    section = text.split("[mcp_servers.dpf]", 1)[1].split("\n[", 1)[0]
    return "bearer" if re.search(r"^\s*bearer_token(_env_var)?\s*=", section, re.M) else "oauth"


def copy_state(copy: Path, auth: Optional[str]) -> dict[str, Optional[str]]:
    from installed_copy_freshness import delivered_digest, pack_version as manifest_version

    if not copy.is_dir():
        return {"version": None, "digest": None, "authMode": auth}
    return {"version": manifest_version(copy), "digest": delivered_digest(copy), "authMode": auth}


def snapshot(home: Path) -> dict[tuple[str, str], dict[str, Optional[str]]]:
    """The installed state of every client copy and scope on this host."""
    updater = _updater()
    shared = updater.shared_managed_plugin_path(home)
    antigravity = _read_json(updater.antigravity_mcp_config_path(home))
    states: dict[tuple[str, str], dict[str, Optional[str]]] = {
        ("shared", "copy"): copy_state(shared, _descriptor_auth(shared)),
        ("codex", "user"): copy_state(updater.codex_managed_plugin_path(home), _codex_auth(home)),
        ("grok", "user"): copy_state(shared, "bearer"),
        ("antigravity", "user"): copy_state(shared, _auth_from_json_server(
            ((antigravity or {}).get("mcpServers") or {}).get("dpf") if isinstance(antigravity, dict) else None)),
    }
    for entry in updater.claude_plugin_records(home):
        install = entry.get("installPath")
        if not isinstance(install, str):
            continue
        scope = entry.get("scope") or "unknown"
        key = scope if scope in ("user",) or not isinstance(entry.get("projectPath"), str) else f"{scope}:{entry['projectPath']}"
        states[("claude-code", key)] = copy_state(Path(install), _descriptor_auth(Path(install)))
    return states


_CLI_COMMANDS = {"claude-code": "resolve_claude_binary", "codex": "resolve_codex_binary",
                 "grok": "resolve_grok_binary", "antigravity": "resolve_antigravity_binary"}


def cli_versions() -> dict[str, Optional[str]]:
    """Each client CLI's own `--version` first line, or None when absent."""
    updater = _updater()
    versions: dict[str, Optional[str]] = {}
    for client, resolver in _CLI_COMMANDS.items():
        binary = getattr(updater, resolver)()
        if not binary:
            versions[client] = None
            continue
        try:
            completed = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=15)
            line = (completed.stdout or completed.stderr or "").strip().splitlines()
            versions[client] = line[0] if completed.returncode == 0 and line else None
        except (OSError, subprocess.SubprocessError):
            versions[client] = None
    return versions


class ConvergenceReport:
    """Collects one entry per client and scope; written by `--report-json`."""

    def __init__(self, home: Path, declarations: Declarations, manifest: Optional[Mapping[str, Any]]) -> None:
        self.home = home
        self.declarations = declarations
        self.manifest = manifest or {}
        self.before = snapshot(home)
        self.entries: list[dict[str, Any]] = []

    def add(self, client: str, scope: str, status: str = "", action: Optional[str] = None,
            backup_path: Optional[str] = None, detail: Optional[str] = None) -> None:
        self.entries.append({"client": client, "scope": scope, "status": status, "action": action,
                             "backupPath": backup_path, "detail": detail})

    def finish(self, dry_run: bool) -> dict[str, Any]:
        after = snapshot(self.home)
        versions = cli_versions()
        clients: list[dict[str, Any]] = []
        for entry in self.entries:
            key = (entry["client"], entry["scope"])
            before = self.before.get(key) or {"version": None, "digest": None, "authMode": None}
            now = after.get(key) or before
            action = entry["action"] or _derive_action(entry["status"], before, now)
            row: dict[str, Any] = {
                "client": entry["client"], "scope": entry["scope"],
                "before": before, "after": now, "action": action,
                "restartRequired": action in RESTART_ACTIONS and not dry_run,
                "cliVersion": versions.get(entry["client"]),
            }
            if entry["backupPath"]:
                row["backupPath"] = entry["backupPath"]
            if entry["detail"] or entry["status"]:
                row["detail"] = entry["detail"] or entry["status"]
            clients.append(row)
        source: dict[str, Any] = {"kind": "portal" if self.manifest else "local"}
        if self.manifest:
            source.update({"deviceId": self.manifest.get("deviceId"), "mcpEndpoint": self.manifest.get("mcpEndpoint"),
                           "releaseId": self.manifest.get("releaseId")})
        return {
            "schemaVersion": 1,
            "result": "failed" if any(row["action"] == "failed" for row in clients) else "converged",
            "dryRun": dry_run,
            "source": source,
            "packVersion": self.declarations.pack,
            "packDigest": self.declarations.digest,
            "clientVersions": versions,
            "clients": clients,
        }

    def write(self, path: str, dry_run: bool) -> dict[str, Any]:
        payload = self.finish(dry_run)
        Path(path).write_bytes((json.dumps(payload, indent=2) + "\n").encode("utf-8"))
        return payload


def _derive_action(status: str, before: Mapping[str, Any], after: Mapping[str, Any]) -> str:
    if status.startswith("failed"):
        return "failed"
    return "unchanged" if dict(before) == dict(after) else "updated"


_BACKUP_IN_STATUS = re.compile(r"\(backup ([^)]+)\)")


def backup_from_status(status: Optional[str]) -> Optional[str]:
    match = _BACKUP_IN_STATUS.search(status or "")
    return match.group(1) if match else None


_PROJECT_ACTIONS = {"updated": "updated", "current": "unchanged", "pruned": "prunable", "failed": "failed"}


def record_claude_scopes(
    report: ConvergenceReport,
    home: Path,
    local_status: str,
    project_outcome: Mapping[str, Any],
    user_status: Optional[str],
    local_scope: list[dict[str, Any]],
) -> None:
    """Add one report entry per Claude scope the updater touched or found."""
    for entry in _updater().claude_plugin_records(home):
        if entry.get("scope") == "local" and isinstance(entry.get("projectPath"), str):
            report.add("claude-code", f"local:{entry['projectPath']}", local_status)
    for bucket, projects in (project_outcome.get("plugins") or {}).items():
        for project in projects:
            report.add("claude-code", f"project:{project}", action=_PROJECT_ACTIONS.get(bucket, "failed"))
    for project, backup in project_outcome.get("retired") or []:
        report.add("claude-code", f"project-mcp-json:{project}", action="retired", backup_path=str(backup),
                   detail="duplicate project .mcp.json dpf connector disabled")
    if user_status:
        action = "failed" if user_status.startswith("failed") else "retired"
        report.add("claude-code", "user-mcp", user_status, action=action, backup_path=backup_from_status(user_status))
    for row in local_scope:
        report.add("claude-code", f"local-mcp:{row['project']}", action=row["action"],
                   backup_path=row.get("backupPath"), detail=row.get("reason"))
