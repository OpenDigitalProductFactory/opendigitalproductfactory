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
  Success is the client's own read-back (BI-1DCF9F23, spec M3): each row is
  checked against what that client actually holds, never against an exit
  code. A client whose CLI is missing is `absent`; a dry run is a `preview`.
- **Claude scopes.** A `dpf` server in a project's local-scope settings that
  duplicates the plugin connector is backed up and removed through
  `claude mcp remove dpf -s local`. The cached descriptor of every project
  and local record gets a literal endpoint, as
  scripts/hooks/lib/pin-plugin-mcp-url.mjs does for the source repo.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

DECLARATION_HEADER = "X-DPF-Toolchain"
DECLARATION_QUERY_KEYS = ("dpf_pack", "dpf_digest", "dpf_client", "dpf_converge")
DEFAULT_CARRIERS = {"claude-code": "header", "codex": "header", "grok": "query", "antigravity": "header"}
CANONICAL_MCP_URL = "https://localhost/api/mcp/v1?tier=full"
# Current copies template DPF_CLAUDE_MCP_URL, legacy ones DPF_MCP_URL (BI-D6A6462A).
_TEMPLATE = re.compile(r"^\$\{DPF_(?:CLAUDE_)?MCP_URL:-([^}]+)\}$")
_SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
RESTART_ACTIONS = ("updated", "retired")
# Rows with nothing of the client's own to read back.
_NO_READBACK = ("absent", "skipped", "failed", "prunable", "pruned", "retired", "unrun", "unproven", "preview")
_ABSENT = re.compile(r"^(absent:|skipped: .*\bnot found\b)")


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
        #: The pack's own skills and their digest: what Antigravity's skills directory must hold.
        self.skill_names: Optional[list[str]] = pack_skill_names(skill_pack)
        self.skills_digest = skills_digest(skill_pack / "skills", self.skill_names)

    @property
    def delivered(self) -> str:
        """The version a delivery stamps into client manifests (BI-4F9E3221).

        Connectors still declare the base `pack`: the floor compares it.
        """
        return f"{self.pack}+c.{self.digest[:12]}"

    @classmethod
    def of(cls, pack: str, digest: str, manifest: Optional[Mapping[str, Any]] = None) -> "Declarations":
        """A declaration for a known pack version and digest, without reading a pack tree."""
        declared = cls.__new__(cls)
        declared.pack = pack.split("+", 1)[0]
        declared.digest = digest
        declared.manifest = manifest or {}
        declared.skill_names = None
        declared.skills_digest = None
        return declared

    def enabled(self) -> bool:
        return bool(_SEMVER.match(self.pack))

    def carrier(self, client: str) -> str:
        shape = (self.manifest.get("clients") or {}).get(client) if isinstance(self.manifest, Mapping) else None
        chosen = shape.get("declarationCarrier") if isinstance(shape, Mapping) else None
        return chosen if chosen in ("query", "header") else DEFAULT_CARRIERS.get(client, "header")

    #: `status[:code][@epochSeconds]` from the host agent's state (BI-3E66F76F), or None.
    converge: Optional[str] = None

    def header_value(self, client: str) -> str:
        value = f"pack={self.pack};digest={self.digest[:16]};client={client}"
        return f"{value};converge={self.converge}" if self.converge else value

    def query_url(self, url: str, client: str) -> str:
        parts = urlsplit(url)
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in DECLARATION_QUERY_KEYS]
        query += [("dpf_pack", self.pack), ("dpf_digest", self.digest[:16]), ("dpf_client", client)]
        if self.converge:
            query.append(("dpf_converge", self.converge))
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


_CONVERGE_STATUSES = {"ok", "failed", "needs-operator", "opted-out", "offline", "ahead-of-portal", "busy"}
_CONVERGE_CODE = re.compile(r"^[a-z0-9_.-]{1,48}$")


def agent_converge_token(home: Path) -> Optional[str]:
    """How the host agent last fared, as `status[:code][@epochSeconds]` (BI-3E66F76F).

    Read from ~/.dpf/toolchain-agent/state.json, the agent's own file. Each
    connector carries it so the portal can show why a client is behind and
    escalate a host that has failed for a day. It reflects the agent's last
    completed run, so it lags one run behind the current one by design.
    """
    state = _read_json(home / ".dpf" / "toolchain-agent" / "state.json")
    if not isinstance(state, dict) or state.get("status") not in _CONVERGE_STATUSES:
        return None
    token = str(state["status"])
    code = state.get("code")
    if isinstance(code, str) and _CONVERGE_CODE.match(code):
        token += f":{code}"
    since = state.get("failureSince")
    if token.split(":", 1)[0] in ("failed", "needs-operator") and isinstance(since, (int, float)) and since > 0:
        token += f"@{int(since)}"
    return token


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
    from installed_copy_freshness import delivered_digest, installed_version, pack_version as manifest_version

    if not copy.is_dir():
        return {"version": None, "digest": None, "authMode": auth}
    # The exact string, `+c.<digest>` stamp included: the Claude read-back
    # compares it with the delivered version (BI-4F9E3221), so the base
    # version alone failed every converged project and local row.
    return {"version": installed_version(copy) or manifest_version(copy), "digest": delivered_digest(copy), "authMode": auth}


def grok_installed_copy() -> Optional[Path]:
    """The copy Grok itself loads, as `grok plugin list --json` reports it."""
    updater = _updater()
    grok = updater.resolve_grok_binary()
    if not grok:
        return None
    try:
        listed = subprocess.run([grok, "plugin", "list", "--json"], capture_output=True, text=True, timeout=30)
        plugins = json.loads(listed.stdout or "[]") if listed.returncode == 0 else []
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    for plugin in plugins if isinstance(plugins, list) else []:
        if isinstance(plugin, dict) and plugin.get("name") == updater.PLUGIN_NAME and isinstance(plugin.get("path"), str):
            return Path(plugin["path"])
    return None


def pack_skill_names(pack: Path) -> list[str]:
    """The skill directories a pack ships; an operator's own skills are not among them."""
    root = pack / "skills"
    if not root.is_dir():
        return []
    return sorted(entry.name for entry in root.iterdir() if (entry / "SKILL.md").is_file())


def skills_digest(root: Path, names: list[str]) -> Optional[str]:
    """One digest over the named skill directories under `root`, or None when there are none."""
    from installed_copy_freshness import delivered_digest

    if not names:
        return None
    digest = hashlib.sha256()
    for name in names:
        skill = root / name
        digest.update(name.encode("utf-8") + b"\0")
        digest.update((delivered_digest(skill) if skill.is_dir() else "missing").encode("ascii"))
    return digest.hexdigest()


def antigravity_skills_path(home: Path) -> Path:
    return home / ".gemini" / "antigravity" / "skills"


def _antigravity_state(home: Path, names: list[str]) -> dict[str, Optional[str]]:
    config = _read_json(_updater().antigravity_mcp_config_path(home))
    server = ((config or {}).get("mcpServers") or {}).get("dpf") if isinstance(config, dict) else None
    url = server.get("serverUrl") if isinstance(server, dict) else None
    return {"version": None, "digest": skills_digest(antigravity_skills_path(home), names),
            "authMode": _auth_from_json_server(server) if server is not None else None,
            "endpoint": url if isinstance(url, str) else None}


def snapshot(home: Path, skill_names: Optional[list[str]] = None) -> dict[tuple[str, str], dict[str, Optional[str]]]:
    """The installed state of every client copy and scope on this host, as each client holds it."""
    updater = _updater()
    shared = updater.shared_managed_plugin_path(home)
    grok = grok_installed_copy()
    states: dict[tuple[str, str], dict[str, Optional[str]]] = {
        ("shared", "copy"): copy_state(shared, _descriptor_auth(shared)),
        ("codex", "user"): copy_state(updater.codex_managed_plugin_path(home), _codex_auth(home)),
        # Grok's own plugin store and Antigravity's own skills and MCP config,
        # never the shared copy they are installed from (spec M3).
        ("grok", "user"): copy_state(grok, "bearer") if grok else {"version": None, "digest": None, "authMode": None},
        ("antigravity", "user"): _antigravity_state(home, skill_names if skill_names is not None else pack_skill_names(shared)),
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


#: How each client shows it is installed (spec M6): a binary, or an app bundle
#: under an applications folder. A config folder alone is leftover evidence of
#: an uninstalled client, not an install. Clients in DEFAULT_CARRIERS have an
#: adapter; any other client found here is reported `unproven`.
DISCOVERY: dict[str, dict[str, tuple[str, ...]]] = {
    "claude-code": {"binaries": ("claude",), "apps": ("Claude.app",)},
    "codex": {"binaries": ("codex",), "apps": ("Codex.app",)},
    "grok": {"binaries": ("grok",), "apps": ()},
    "antigravity": {"binaries": ("agy",), "apps": ("Antigravity.app",)},
    "vscode": {"binaries": ("code",), "apps": ("Visual Studio Code.app", "Microsoft VS Code/Code.exe")},
    "cursor": {"binaries": ("cursor",), "apps": ("Cursor.app", "cursor/Cursor.exe")},
    "gemini-cli": {"binaries": ("gemini",), "apps": ()},
    "opencode": {"binaries": ("opencode",), "apps": ()},
}


def _relocated_home() -> bool:
    return bool(os.environ.get("DPF_AGENT_TOOLCHAIN_HOME"))


def default_app_roots(home: Path) -> list[Path]:
    # A fixture or relocated home is searched only within itself, so a test
    # never reports this host's own clients.
    if _relocated_home():
        return [home / "Applications"]
    if sys.platform == "darwin":
        return [Path("/Applications"), home / "Applications"]
    if sys.platform.startswith("win") and os.environ.get("LOCALAPPDATA"):
        return [Path(os.environ["LOCALAPPDATA"]) / "Programs"]
    return []


def discover_clients(home: Path, which: Any = None, app_roots: Optional[list[Path]] = None) -> dict[str, list[str]]:
    """Every client installed on this host and the evidence for it, found on every run (spec M6)."""
    updater = _updater()
    roots = default_app_roots(home) if app_roots is None else app_roots
    if which is None:
        local = str(home / ".local" / "bin")
        which = (lambda name: shutil.which(name, path=local)) if _relocated_home() else shutil.which
    found: dict[str, list[str]] = {}
    for client, shape in DISCOVERY.items():
        resolver = _CLI_COMMANDS.get(client)
        binary = getattr(updater, resolver)() if resolver else None
        for name in () if binary else shape["binaries"]:
            binary = which(name)
            if binary:
                break
        evidence = [binary] if binary else []
        evidence += [str(root / app) for root in roots for app in shape["apps"] if (root / app).exists()]
        if evidence:
            found[client] = evidence
    return found


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

    def __init__(self, home: Path, declarations: Declarations, manifest: Optional[Mapping[str, Any]],
                 endpoint: Optional[str] = None) -> None:
        self.home = home
        self.declarations = declarations
        self.manifest = manifest or {}
        #: The MCP endpoint the updater wrote; connectors are read back against it.
        self.endpoint = endpoint
        self.before = snapshot(home, declarations.skill_names)
        self.entries: list[dict[str, Any]] = []
        self.discovered: dict[str, list[str]] = {}
        self.permission_entries: list[dict[str, Any]] = []

    def add(self, client: str, scope: str, status: str = "", action: Optional[str] = None,
            backup_path: Optional[str] = None, detail: Optional[str] = None) -> None:
        self.entries.append({"client": client, "scope": scope, "status": status, "action": action,
                             "backupPath": backup_path, "detail": detail})

    def add_discovery(self, found: Mapping[str, list[str]]) -> None:
        """Report every installed client DPF cannot converge, never skipping one silently (spec M6)."""
        self.discovered = dict(found)
        for client, evidence in found.items():
            if client not in DEFAULT_CARRIERS:
                self.add(client, "discovery", action="unproven",
                         detail=f"installed ({', '.join(evidence)}); DPF has no adapter for it yet, so its DPF tools are "
                                "not managed. See \"Adding a client\" in docs/architecture/agent-client-capability-parity.md.")

    def add_permissions(self, entries: list[dict[str, Any]]) -> None:
        """Sanitized permission metadata is distinct from installed pack proof."""
        self.permission_entries.extend(entries)

    def readback_failure(self, client: str, scope: str, now: Mapping[str, Any]) -> Optional[str]:
        """Why this client's own view is not the delivered pack, or None when it is (spec M3)."""
        declared = self.declarations
        if client == "claude-code" and scope.startswith(("project:", "local:")):
            if now.get("digest") != declared.digest or now.get("version") != declared.delivered:
                return ("read-back: installed content does not match the expected pack; supported update "
                        "remains unverified, client-owned cache retained.")
            return None
        if client in ("shared", "codex", "grok"):
            if now.get("digest") != declared.digest:
                where = {"shared": "the shared copy", "codex": "Codex's plugin source", "grok": "Grok's plugin store"}[client]
                return f"read-back: {where} does not hold the delivered pack."
            if client == "shared":
                return self._endpoint_failure(_descriptor_url(self.home), "the Claude desktop connector descriptor")
            return None
        if client == "antigravity":
            if declared.skill_names is None:
                return None
            if now.get("digest") != declared.skills_digest:
                return "read-back: Antigravity's skills directory does not hold the delivered skills."
            return self._endpoint_failure(now.get("endpoint"), "Antigravity's MCP config")
        return None

    def _endpoint_failure(self, found: Optional[str], where: str) -> Optional[str]:
        from installed_copy_freshness import _endpoint

        if not self.endpoint or not found:
            return None if not self.endpoint else f"read-back: {where} names no dpf endpoint."
        if _endpoint(found) != _endpoint(self.endpoint):
            return f"read-back: {where} names a different endpoint than the one written."
        return None

    def finish(self, dry_run: bool) -> dict[str, Any]:
        after = snapshot(self.home, self.declarations.skill_names)
        versions = cli_versions()
        clients: list[dict[str, Any]] = []
        for entry in self.entries:
            key = (entry["client"], entry["scope"])
            before = self.before.get(key) or {"version": None, "digest": None, "authMode": None}
            now = after.get(key) or {"version": None, "digest": None, "authMode": None}
            action = entry["action"] or _derive_action(entry["status"], before, now)
            failure = None
            apps = [path for path in self.discovered.get(entry["client"], []) if path.endswith((".app", ".exe"))]
            if action == "absent" and apps:
                # Installed, but without the CLI DPF converges it through (spec M6).
                action = "unproven"
                entry = {**entry, "detail": f"{', '.join(apps)} is installed, but its CLI is not, so DPF cannot update "
                                            f"its tools ({entry['status']})"}
            if dry_run:
                # A dry run writes nothing, so nothing is converged or written (BI-81AB897A E3).
                action = action if action in ("absent", "failed", "unproven", "prunable") else "preview"
            elif action not in _NO_READBACK:
                failure = self.readback_failure(entry["client"], entry["scope"], now)
                if failure:
                    action = "failed"
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
            if failure:
                row["detail"] = failure
            clients.append(row)
        for entry in self.permission_entries:
            clients.append({**entry, "cliVersion": versions.get(entry["client"])})
        source: dict[str, Any] = {"kind": "portal" if self.manifest else "local"}
        if self.manifest:
            source.update({"deviceId": self.manifest.get("deviceId"), "mcpEndpoint": self.manifest.get("mcpEndpoint"),
                           "releaseId": self.manifest.get("releaseId")})
        actions = [row["action"] for row in clients]
        result = ("failed" if "failed" in actions else "preview" if dry_run
                  else "unverified" if "unrun" in actions else "converged")
        return {
            "schemaVersion": 1,
            "result": result,
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


def _descriptor_url(home: Path) -> Optional[str]:
    """The endpoint the shared copy's Claude descriptor names, its template default resolved."""
    from installed_copy_freshness import installed_connector

    found = installed_connector(_updater().shared_managed_plugin_path(home), {})
    return found[0] if found else None


def _derive_action(status: str, before: Mapping[str, Any], after: Mapping[str, Any]) -> str:
    if status.startswith("failed"):
        return "failed"
    if _ABSENT.match(status):
        return "absent"
    if status == "skipped by flag":
        return "skipped"
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
    local_record_found = False
    for entry in _updater().claude_plugin_records(home):
        if entry.get("scope") == "local" and isinstance(entry.get("projectPath"), str):
            local_record_found = True
            report.add("claude-code", f"local:{entry['projectPath']}", local_status)
    if not local_record_found and local_status.startswith("failed:"):
        report.add("claude-code", "local", local_status)
    for bucket, projects in (project_outcome.get("plugins") or {}).items():
        if bucket == "pruned" and "prune" in project_outcome:
            continue  # reported below, from what pruning did (spec M10)
        for project in projects:
            report.add("claude-code", f"project:{project}", action=_PROJECT_ACTIONS.get(bucket, "failed"))
    for row in project_outcome.get("prune") or []:
        report.add("claude-code", f"project:{row['project']}", action=row["action"],
                   backup_path=row.get("backupPath"), detail=row.get("detail"))
    for project, backup in project_outcome.get("retired") or []:
        report.add("claude-code", f"project-mcp-json:{project}", action="retired", backup_path=str(backup),
                   detail="duplicate project .mcp.json dpf connector disabled")
    if user_status:
        action = "failed" if user_status.startswith("failed") else "retired"
        report.add("claude-code", "user-mcp", user_status, action=action, backup_path=backup_from_status(user_status))
    for row in local_scope:
        report.add("claude-code", f"local-mcp:{row['project']}", action=row["action"],
                   backup_path=row.get("backupPath"), detail=row.get("reason"))
