#!/usr/bin/env python3
"""Warn at session start when an installed dpf-platform copy has drifted.

BI-16EAAB62. The SessionStart checks read the repository: mcp-health probes the
descriptor the repo intends, and governance-freshness compares working-tree hook
wiring with origin/main. Neither reads a copy a client actually loaded, so on
2026-10-01 a shared managed copy left at 0.2.5 with the old plain-http bearer
descriptor went unnoticed while the desktop app refused sign-in. BI-F4BE47B5
was the same class: a plugin-cache copy at the current version whose hook code
predated two merges.

This compares every copy update_agent_toolchain.installed_plugin_copies() names
against the reference pack -- the root clone's, which root-clone-freshness keeps
on main -- by version, by delivered content at an equal version, and, for the
copies a Claude client reads its connector from, by the dpf endpoint and auth
mode the updater's own policy would write for this environment. A copy newer
than the reference is not called stale: the reference is behind, not the copy.

Advisory only: prints one WARN line per stale copy, naming it and the repair,
and exits 0 on every path. Never writes. Dependency-free; runs on the stock
macOS python3 (3.9). DPF_SKIP_PLUGIN_COPY_CHECK=1 silences it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_agent_toolchain as updater  # noqa: E402

BACKLOG_ID = "BI-16EAAB62"
SKIP_ENV_VAR = "DPF_SKIP_PLUGIN_COPY_CHECK"
_TEMPLATE = re.compile(r"^\$\{DPF_MCP_URL:-([^}]+)\}$")
# Written per install, so they legitimately differ between copies: the updater
# regenerates the root descriptors for this host's endpoint, rewrites the Codex
# manifest with a content version, and Claude Code keeps one marker file per
# loading process under .in_use/ in a cache dir. The connector the client loads
# is compared on its own, below.
_PER_INSTALL = {Path(".codex-plugin") / "plugin.json"}
_PER_INSTALL_DIRS = {".in_use"}


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None


def pack_version(pack: Path) -> Optional[str]:
    for manifest in (pack / ".claude-plugin" / "plugin.json", pack / ".codex-plugin" / "plugin.json"):
        data = _read_json(manifest)
        if isinstance(data, dict) and data.get("version"):
            return str(data["version"]).split("+", 1)[0]
    return None


def _version_key(version: str) -> Optional[tuple[int, ...]]:
    try:
        return tuple(int(part) for part in version.split("."))
    except ValueError:
        return None


def delivered_digest(pack: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(pack.rglob("*")):
        relative = path.relative_to(pack)
        if not path.is_file() or updater.is_build_debris(relative) or relative in _PER_INSTALL:
            continue
        if relative.parts[0] in _PER_INSTALL_DIRS:
            continue
        if len(relative.parts) == 1 and relative.name.endswith(".mcp.json"):
            continue
        digest.update(relative.as_posix().encode("utf-8") + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _endpoint(url: str) -> tuple[str, str, Optional[int], str]:
    parts = urlsplit(url)
    port = parts.port or {"https": 443, "http": 80}.get(parts.scheme)
    return (parts.scheme, (parts.hostname or "").lower(), port, parts.path.rstrip("/"))


def _display(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"


def expected_connector(env: Mapping[str, str]) -> tuple[str, bool]:
    """The endpoint and bearer-ness the updater would write for this environment."""
    url = updater.with_mcp_catalog_tier(env.get("DPF_MCP_URL") or updater.DEFAULT_MCP_URL, "full")
    try:
        bearer = updater.mcp_client_bearer_header_required(url, "claude", env.get("DPF_MCP_AUTH_MODE") or "oauth")
    except ValueError:
        bearer = updater.mcp_client_bearer_header_required(url, "claude", "oauth")
    return url, bearer


def installed_connector(copy: Path, env: Mapping[str, str]) -> Optional[tuple[str, bool]]:
    data = _read_json(copy / "claude.mcp.json")
    server = data.get("mcpServers", {}).get("dpf") if isinstance(data, dict) else None
    if not isinstance(server, dict) or not isinstance(server.get("url"), str):
        return None
    url = server["url"]
    template = _TEMPLATE.match(url)
    if template:
        url = env.get("DPF_MCP_URL") or template.group(1)
    headers = server.get("headers")
    bearer = isinstance(headers, dict) and any(str(k).lower() == "authorization" for k in headers)
    return url, bearer


def _auth_name(bearer: bool) -> str:
    return "a bearer header" if bearer else "OAuth"


def assess_installed_copies(
    reference: Path, home: Path, project_dir: Optional[Path], env: Mapping[str, str]
) -> list[dict[str, Any]]:
    want = pack_version(reference)
    if want is None:
        return []
    want_digest: Optional[str] = None
    expected = expected_connector(env)
    findings: list[dict[str, Any]] = []
    for copy in updater.installed_plugin_copies(home, project_dir):
        path: Path = copy["path"]
        if not path.is_dir() or path.resolve() == reference.resolve():
            continue
        have = pack_version(path)
        if have is None:
            continue
        have_key, want_key = _version_key(have), _version_key(want)
        if have_key is not None and want_key is not None and have_key > want_key:
            continue
        reasons: list[str] = []
        if have != want:
            reasons.append(f"version {have}, the reference pack is {want}")
        else:
            if want_digest is None:
                want_digest = delivered_digest(reference)
            if delivered_digest(path) != want_digest:
                reasons.append(f"content differs from the reference pack at the same version {want}")
        if copy["connector"]:
            loaded = installed_connector(path, env)
            if loaded is not None and (_endpoint(loaded[0]) != _endpoint(expected[0]) or loaded[1] != expected[1]):
                reasons.append(
                    f"connector {_display(loaded[0])} with {_auth_name(loaded[1])}, "
                    f"expected {_display(expected[0])} with {_auth_name(expected[1])}"
                )
        if reasons:
            findings.append({"label": copy["label"], "path": path, "reasons": reasons})
    return findings


def repair_command(reference: Path) -> str:
    script = reference / "scripts" / "update_agent_toolchain.py"
    return f'{"python" if os.name == "nt" else "python3"} "{script}"'


def render_findings(findings: list[dict[str, Any]], reference: Path) -> list[str]:
    repair = repair_command(reference)
    return [
        f"WARN: stale DPF plugin copy -- {f['label']} at {f['path']}: {'; '.join(f['reasons'])}. "
        "A client that loads it runs old skills and hooks, and a connector that differs makes the "
        f"desktop app see two dpf servers and refuse sign-in. Repair: run {repair}, then restart "
        f"the client. ({BACKLOG_ID}; silence: {SKIP_ENV_VAR}=1)"
        for f in findings
    ]


def resolve_reference_skill_pack(project_dir: Path) -> Path:
    """The root clone's pack when the checkout is a linked worktree, else its own."""
    own = project_dir / "packages" / "dpf-skill-pack"
    try:
        result = subprocess.run(
            ["git", "-C", str(project_dir), "rev-parse", "--git-common-dir"],
            capture_output=True, text=True, timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return own
    if result.returncode != 0 or not result.stdout.strip():
        return own
    common = Path(result.stdout.strip())
    if not common.is_absolute():
        common = project_dir / common
    if common.name != ".git":
        return own
    root_pack = common.resolve().parent / "packages" / "dpf-skill-pack"
    return root_pack if (root_pack / ".claude-plugin" / "plugin.json").is_file() else own


def main(argv: list[str]) -> int:
    try:
        if os.environ.get(SKIP_ENV_VAR) == "1":
            return 0
        parser = argparse.ArgumentParser(description="Warn when an installed dpf-platform copy has drifted.")
        parser.add_argument("--project-dir", default=os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
        parser.add_argument("--skill-pack-path", default=None)
        args = parser.parse_args(argv)
        project_dir = Path(args.project_dir).expanduser().resolve()
        reference = (
            Path(args.skill_pack_path).expanduser().resolve()
            if args.skill_pack_path
            else resolve_reference_skill_pack(project_dir)
        )
        findings = assess_installed_copies(reference, updater.home_dir(), project_dir, os.environ)
        for line in render_findings(findings, reference):
            print(line)
    except (Exception, SystemExit):  # noqa: BLE001 -- an advisory never fails a session
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
