"""Grok's own DPF credential (BI-84C1F526, DI-4B843FAF62F9).

Grok authenticates with a client_credentials OAuth client (BI-5BCDB07C,
design 2026-08-26 section 12.4.7). Its config names a bearer_token_file that
the existing refresher (scripts/refresh-grok-mcp-credential.mjs in this pack)
rewrites
before the access token expires. This module is the updater's Grok step:

1. point [mcp_servers.dpf] at bearer_token_file and drop the bearer env var;
2. hand the credentials client to the refresher on standard input, if the
   agent supplied one (from the issue_grok_credentials_client MCP tool);
3. run the refresher's first refresh.

It never writes a personal access token, never puts a secret on a command
line, and never prints one.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Optional

GROK_BEARER_FILE_NAME = "dpf-mcp-token"
GROK_CLIENT_FILE_NAME = "dpf-mcp-client.json"
FALLBACK_MCP_URL = "https://localhost/api/mcp/v1?tier=full"
REFRESHER_NAME = "refresh-grok-mcp-credential.mjs"
MANAGED_KEYS = ("url", "bearer_token_file", "bearer_token_env_var")
REQUEST_HINT = (
    "needs credential: ask DPF for issue_grok_credentials_client and pass its "
    "credentialsClient to this updater with --grok-client-stdin"
)

_DPF_HEADER = re.compile(r"""^\s*\[\s*mcp_servers\s*\.\s*(?:dpf|"dpf"|'dpf')\s*\]\s*(?:#.*)?$""")
_TABLE_START = re.compile(r"^\s*\[")


def grok_config_path(home: Path) -> Path:
    return home / ".grok" / "config.toml"


def find_grok_refresher(skill_pack: Path) -> Optional[Path]:
    """The refresher ships in the skill pack, so a pack-only host has it."""
    candidate = skill_pack / "scripts" / REFRESHER_NAME
    return candidate if candidate.is_file() else None


def validate_client_payload(text: str) -> str:
    """Return the payload unchanged if it is a credentials client. Errors never echo it."""
    try:
        data = json.loads(text)
    except ValueError:
        raise ValueError("the Grok credentials client is not valid JSON") from None
    if isinstance(data, dict) and isinstance(data.get("credentialsClient"), dict):
        data = data["credentialsClient"]
    if not isinstance(data, dict):
        raise ValueError("the Grok credentials client must be a JSON object")
    client_id, secret = data.get("clientId"), data.get("clientSecret")
    if not isinstance(client_id, str) or not client_id.startswith("dpfoc_"):
        raise ValueError("the Grok credential is not a credentials client")
    if not isinstance(secret, str) or not secret.startswith("dpfocs_"):
        raise ValueError("refusing a Grok credential that is not a credentials client secret")
    return json.dumps({"clientId": client_id, "clientSecret": secret})


def _is_dpf_header(line: str) -> bool:
    # Any TOML spelling of mcp_servers.dpf. Grok rewrites its own config as
    # ["mcp_servers"."dpf"], which the header regex alone missed, so a second
    # table was appended and Grok refused to start (BI-E7806C0F).
    if _DPF_HEADER.match(line):
        return True
    from update_agent_toolchain import canonical_toml_table_header

    return canonical_toml_table_header(line) == "mcp_servers.dpf"


def _dpf_table_spans(lines: list[str]) -> list[tuple[int, int]]:
    """The [start, end) span of every table spelling mcp_servers.dpf, in order."""
    spans = []
    index = 0
    while index < len(lines):
        if _is_dpf_header(lines[index]):
            end = index + 1
            while end < len(lines) and not _TABLE_START.match(lines[end]):
                end += 1
            spans.append((index, end))
            index = end
        else:
            index += 1
    return spans


def _dpf_table_span(lines: list[str]) -> Optional[tuple[int, int]]:
    spans = _dpf_table_spans(lines)
    return spans[0] if spans else None


def _bare_key(line: str) -> str:
    """The key of a `key = value` line, unquoted ("url" and url are one key)."""
    key = line.partition("=")[0].strip()
    return key[1:-1] if len(key) >= 2 and key[0] == key[-1] and key[0] in "\"'" else key


def _string_value(line: str) -> Optional[str]:
    _, _, value = line.partition("=")
    match = re.fullmatch(r"""\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?""", value)
    if not match:
        return None
    quoted = match.group(1)
    return json.loads(quoted) if quoted.startswith('"') else quoted[1:-1]


def existing_grok_mcp_url(text: str) -> Optional[str]:
    lines = text.splitlines()
    span = _dpf_table_span(lines)
    if span is None:
        return None
    for line in lines[span[0] + 1:span[1]]:
        if _bare_key(line) == "url":
            return _string_value(line)
    return None


def converged_grok_config(text: str, endpoint: str, token_file: Path) -> str:
    """Set the managed keys of [mcp_servers.dpf]; keep every other line."""
    lines = text.replace("\ufeff", "", 1).splitlines()
    managed = [f"url = {json.dumps(endpoint)}", f"bearer_token_file = {json.dumps(str(token_file))}"]
    spans = _dpf_table_spans(lines)
    if not spans:
        prefix = lines + ([""] if lines and lines[-1].strip() else [])
        return "\n".join([*prefix, "[mcp_servers.dpf]", *managed]) + "\n"
    # A config an earlier converge already doubled is healed here: later copies
    # fold into the first (its header spelling kept), their unmanaged keys
    # carried over unless the first copy already sets them.
    start, end = spans[0]
    first_keys = {_bare_key(line) for line in lines[start + 1:end]}
    carried = [
        line
        for later_start, later_end in spans[1:]
        for line in lines[later_start + 1:later_end]
        if line.strip() and _bare_key(line) not in first_keys
    ]
    dropped = {index for later_start, later_end in spans[1:] for index in range(later_start, later_end)}
    after = [line for index, line in enumerate(lines[end:], start=end) if index not in dropped]
    while after and not after[-1].strip():
        after.pop()
    kept = [line for line in lines[start + 1:end] if _bare_key(line) not in MANAGED_KEYS]
    trailing: list[str] = []
    while kept and not kept[-1].strip():
        trailing.append(kept.pop())
    kept += [line for line in carried if _bare_key(line) not in MANAGED_KEYS]
    return "\n".join([*lines[:start + 1], *managed, *kept, *trailing, *after]) + "\n"


def _run_refresher(
    run: Callable[..., Any], node: str, refresher: Path, args: list[str], payload: Optional[str] = None,
) -> tuple[int, str]:
    done = run([node, str(refresher), *args], input=payload, capture_output=True, text=True)
    return done.returncode, (done.stdout or "").strip()


def converge_grok_credential(
    *,
    home: Path,
    refresher: Optional[Path],
    mcp_url: Optional[str],
    client_payload: Optional[str],
    dry_run: bool,
    default_mcp_url: str = FALLBACK_MCP_URL,
    declare_url: Optional[Callable[[str], str]] = None,
    node: Optional[str] = None,
    run: Callable[..., Any] = subprocess.run,
) -> str:
    config = grok_config_path(home)
    if not config.parent.is_dir():
        return "skipped: Grok home not found"
    try:
        payload = validate_client_payload(client_payload) if client_payload else None
    except ValueError as error:
        return f"failed: {error}"

    text = config.read_text(encoding="utf-8-sig") if config.exists() else ""
    endpoint = mcp_url or existing_grok_mcp_url(text) or default_mcp_url
    # The pack declaration rides the URL (toolchain_convergence's query carrier
    # for Grok); re-declaring replaces any older declaration on the URL.
    if declare_url is not None:
        endpoint = declare_url(endpoint)
    desired = converged_grok_config(text, endpoint, config.parent / GROK_BEARER_FILE_NAME)
    client_stored = (config.parent / GROK_CLIENT_FILE_NAME).exists()
    if dry_run:
        change = "would point [mcp_servers.dpf] at bearer_token_file" if desired != text else "config already current"
        return f"dry-run: {change}; {'would refresh the credential' if payload or client_stored else REQUEST_HINT}"
    if desired != text:
        config.write_text(desired, encoding="utf-8")
    if not payload and not client_stored:
        return REQUEST_HINT

    node = node or shutil.which("node")
    if refresher is None or node is None:
        return "failed: the Grok credential refresher needs node and the skill pack's refresher script"
    if payload:
        code, _ = _run_refresher(run, node, refresher, ["write-client", "--config", str(config)], payload)
        if code != 0:
            return f"failed: storing the Grok credentials client exited {code}"
    code, action = _run_refresher(run, node, refresher, ["refresh", "--mcp-url", endpoint, "--config", str(config)])
    if code != 0:
        return f"failed: Grok credential refresh exited {code}"
    return f"converged: {action or 'refreshed'}"
