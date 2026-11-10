"""Parse TOML on any supported Python, with Codex's own parser as the fallback.

BI-90C9478D (S5 of BI-63672FBE; spec
docs/superpowers/specs/2026-10-27-self-converging-agent-toolchain-design.md M4, M5;
DI-7591BDF26023). Stock macOS ships Python 3.9, which has no `tomllib`. Since
#6623 the updater refused every Codex settings change there instead of risking
a corrupt file, so Codex never converged on those hosts.

Codex's app server reads its own configuration (`config/read`), and its
per-layer view is exactly the parsed `config.toml`. Writing the candidate into
a private, throw-away CODEX_HOME and asking Codex to read it gives the parser
Codex itself will use, with no added dependency (absorb, don't adopt).

Order: `tomllib` (3.11+), then `tomli`, then the Codex CLI. A TOML date-time is
refused on the Codex path, because its JSON answer turns it into a string and a
rewrite would silently change the value's type.

Standard library only, Python 3.9+.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Optional

DEFAULT_TIMEOUT = 20.0
# An unquoted value that starts like an RFC 3339 date or time: `= 1979-05-27`, `= 07:32:00`.
_DATE_TIME_VALUE = re.compile(r'^[^"#\n]*=\s*(\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2})', re.MULTILINE)
_INVALID = "Invalid configuration"


class CodexTomlUnavailable(RuntimeError):
    """No parser could run: no tomllib, no tomli and no working Codex CLI."""


class UnsupportedToml(ValueError):
    """Valid TOML this path cannot round-trip faithfully; the caller must not rewrite it."""


def _stdlib_parser() -> Any:
    try:
        import tomllib  # type: ignore[import-not-found]

        return tomllib
    except ImportError:
        try:
            import tomli  # type: ignore[import-not-found]

            return tomli
        except ImportError:
            return None


def _codex_binary() -> Optional[str]:
    import update_agent_toolchain as updater

    return updater.resolve_codex_binary()


def available() -> bool:
    return _stdlib_parser() is not None or _codex_binary() is not None


def _strip_strings(text: str) -> str:
    """Remove string contents so a date written as text is not mistaken for a date value."""
    return re.sub(r'"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'|"(?:\\.|[^"\\\n])*"|\'[^\'\n]*\'', '""', text)


_CACHE: dict[tuple[str, str, tuple[tuple[str, str], ...]], dict[str, Any]] = {}


def _context_key(context_dir: Optional[Path]) -> tuple[tuple[str, str], ...]:
    if context_dir is None or not context_dir.is_dir():
        return ()
    import hashlib

    return tuple(sorted((sibling.name, hashlib.sha256(sibling.read_bytes()).hexdigest())
                        for sibling in context_dir.glob("*.config.toml") if sibling.is_file()))


def loads(text: str, binary: Optional[str] = None, timeout: float = DEFAULT_TIMEOUT,
          context_dir: Optional[Path] = None) -> dict[str, Any]:
    """Parse with Codex, memoized per process: one updater run re-reads the same text often."""
    binary = binary or _codex_binary()
    if not binary:
        raise CodexTomlUnavailable("no Codex CLI to parse TOML with")
    key = (binary, text, _context_key(context_dir))
    if key not in _CACHE:
        _CACHE[key] = _loads_uncached(text, binary, timeout, context_dir)
    return json.loads(json.dumps(_CACHE[key]))


def _loads_uncached(text: str, binary: Optional[str] = None, timeout: float = DEFAULT_TIMEOUT,
                    context_dir: Optional[Path] = None) -> dict[str, Any]:
    """Parse `text` with the Codex CLI's own parser.

    Codex validates meaning as well as syntax: an unknown enum value, or a
    `profile` whose `<name>.config.toml` is missing, makes the file invalid for
    Codex, which then ignores it. `context_dir`, the folder the real file lives
    in, supplies those sibling profile files so they are judged as Codex would.
    """
    binary = binary or _codex_binary()
    if not binary:
        raise CodexTomlUnavailable("no Codex CLI to parse TOML with")
    if _DATE_TIME_VALUE.search(_strip_strings(text)):
        raise UnsupportedToml("TOML date-time values cannot be round-tripped without Python 3.11+ or tomli; configuration unchanged")
    home = Path(tempfile.mkdtemp(prefix="dpf-codex-toml-"))
    try:
        (home / "config.toml").write_text(text, encoding="utf-8")
        if context_dir is not None and context_dir.is_dir():
            for sibling in context_dir.glob("*.config.toml"):
                if sibling.is_file() and not sibling.is_symlink():
                    shutil.copyfile(sibling, home / sibling.name)
        env = {**os.environ, "CODEX_HOME": str(home)}
        try:
            proc = subprocess.Popen([binary, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, text=True, env=env, bufsize=1)
        except OSError as error:
            raise CodexTomlUnavailable(f"the Codex CLI could not start ({error.__class__.__name__})") from None
        lines: "queue.Queue[str]" = queue.Queue()
        reader = threading.Thread(target=lambda: [lines.put(line) for line in proc.stdout], daemon=True)  # type: ignore[union-attr]
        reader.start()
        deadline = time.monotonic() + timeout
        warnings: list[dict[str, Any]] = []

        def send(message: dict[str, Any]) -> None:
            assert proc.stdin is not None
            proc.stdin.write(json.dumps(message) + "\n")
            proc.stdin.flush()

        def wait_for(request_id: int) -> dict[str, Any]:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CodexTomlUnavailable("the Codex CLI did not answer in time")
                try:
                    message = json.loads(lines.get(timeout=remaining))
                except queue.Empty:
                    raise CodexTomlUnavailable("the Codex CLI did not answer in time") from None
                except ValueError:
                    continue
                if message.get("id") == request_id:
                    return message
                if message.get("method") == "configWarning":
                    warnings.append(message.get("params") or {})

        try:
            send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"clientInfo": {"name": "dpf-updater", "version": "1"}}})
            wait_for(1)
            send({"jsonrpc": "2.0", "method": "initialized"})
            send({"jsonrpc": "2.0", "id": 2, "method": "config/read", "params": {"includeLayers": True}})
            answer = wait_for(2)
        except (BrokenPipeError, OSError):
            raise CodexTomlUnavailable("the Codex CLI exited before answering") from None
        finally:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                proc.kill()
        for warning in warnings:
            if _INVALID in str(warning.get("summary", "")):
                # Codex's detail ("<home>/config.toml:2:8: unclosed table") names a
                # location and the expected shape, never the file's values.
                detail = str(warning.get("details") or warning.get("summary") or "")
                detail = detail.replace(str(home) + os.sep, "").replace(str(home), "")
                raise ValueError(f"Invalid TOML for Codex: {detail.strip()[:240]}")
        if answer.get("error"):
            raise CodexTomlUnavailable(f"the Codex CLI refused config/read ({answer['error'].get('code')})")
        layers = (answer.get("result") or {}).get("layers") or []
        user = [layer for layer in layers if isinstance(layer, dict) and (layer.get("name") or {}).get("type") == "user"]
        if not user:
            return {}
        config = user[0].get("config")
        if not isinstance(config, dict):
            raise CodexTomlUnavailable("the Codex CLI returned no user configuration")
        return config
    finally:
        shutil.rmtree(home, ignore_errors=True)


def loads_any(text: str, context_dir: Optional[Path] = None) -> dict[str, Any]:
    """Parse TOML with tomllib, tomli, or the Codex CLI, in that order."""
    parser = _stdlib_parser()
    if parser is not None:
        return parser.loads(text)
    return loads(text, context_dir=context_dir)
