"""Current Codex hook trust, read through its supported inventory (BI-C2BFB566).

No hook commands, model turns, trust writes or bypass flags are used here.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
from typing import Any, Optional

PLUGIN_ID = "dpf-platform@personal"
# WorktreeCreate belongs to other clients and has no Codex lifecycle inventory.
UNSUPPORTED_EVENTS = {"WorktreeCreate"}


class InventoryUnavailable(RuntimeError):
    pass


def read_inventory(binary: str, home: Path, cwd: Path, timeout: float = 20.0) -> dict[str, Any]:
    """Bounded metadata-only app-server session using the selected user config."""
    proc = subprocess.Popen([binary, "app-server", "--stdio"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                            env={**os.environ, "CODEX_HOME": str(home / ".codex")}, cwd=str(cwd),
                            bufsize=1)
    messages: queue.Queue = queue.Queue()
    def collect() -> None:
        try:
            for line in proc.stdout:
                messages.put(line)
        finally:
            messages.put(None)
    threading.Thread(target=collect, daemon=True).start()
    deadline = time.monotonic() + timeout
    def send(value: dict) -> None:
        proc.stdin.write(json.dumps(value) + "\n")
        proc.stdin.flush()
    def request(number: int, method: str, params: dict) -> dict:
        send({"id": number, "method": method, "params": params})
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise InventoryUnavailable("Hook inventory timed out")
            try:
                line = messages.get(timeout=remaining)
            except queue.Empty:
                raise InventoryUnavailable("Hook inventory timed out") from None
            if line is None:
                raise InventoryUnavailable("Hook inventory server exited")
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict) and value.get("id") == number:
                if "error" in value or not isinstance(value.get("result"), dict):
                    raise InventoryUnavailable("Hook inventory unsupported or unavailable")
                return value["result"]
    try:
        request(1, "initialize", {"clientInfo": {"name": "dpf-hook-trust-audit", "version": "1"},
                                  "capabilities": {"experimentalApi": True}})
        send({"method": "initialized"})
        return request(2, "hooks/list", {"cwds": [str(cwd)]})
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        proc.stdin.close()
        proc.stdout.close()


def _path(value: str) -> str:
    return os.path.normcase(os.path.realpath(value))


def expected_keys(hooks_path: Path, plugin_plane: bool, required_names: set[str]) -> set[str]:
    payload = json.loads(hooks_path.read_text(encoding="utf-8-sig"))
    events = payload["hooks"]
    if not isinstance(events, dict):
        raise ValueError("Invalid hook roster")
    prefix = f"{PLUGIN_ID}:hooks/hooks.json" if plugin_plane else str(hooks_path)
    expected = set()
    found_names = set()
    for event, groups in events.items():
        if event in UNSUPPORTED_EVENTS:
            continue
        if not isinstance(event, str) or not isinstance(groups, list):
            raise ValueError("Invalid hook roster")
        event_key = re.sub(r"(?<!^)(?=[A-Z])", "_", event).lower()
        for group_index, group in enumerate(groups):
            if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
                raise ValueError("Invalid hook roster")
            for handler_index, handler in enumerate(group["hooks"]):
                if not isinstance(handler, dict):
                    raise ValueError("Invalid hook roster")
                # A fallback user file can contain unrelated user-owned hooks.
                if not plugin_plane and not any(
                    re.search(r"(?:^|[/\\])" + re.escape(name) + r'(?:["\s]|$)', handler.get("command", ""))
                    for name in required_names
                ):
                    continue
                found_names.update(name for name in required_names if name in handler.get("command", ""))
                expected.add(f"{prefix}:{event_key}:{group_index}:{handler_index}")
    if not required_names <= found_names:
        raise ValueError("Required guard missing from delivered roster")
    return expected


def assess(payload: dict, hooks_path: Path, plugin_plane: bool, required_names: set[str], cwd: Path, roster_path: Optional[Path] = None) -> dict:
    expected = expected_keys(roster_path or hooks_path, plugin_plane, required_names)
    if not expected:
        raise ValueError("Required hook roster unavailable")
    data = payload["data"]
    entries = [entry for entry in data if _path(entry["cwd"]) == _path(str(cwd))]
    if len(entries) != 1 or entries[0].get("errors") or entries[0].get("warnings"):
        raise ValueError("Hook inventory incomplete")
    rows = entries[0]["hooks"]
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Invalid hook inventory")
    pending = []
    for key in sorted(expected):
        matches = [row for row in rows if row.get("key") == key]
        valid = len(matches) == 1 and matches[0].get("enabled") is True and matches[0].get("trustStatus") == "trusted"
        if valid:
            row = matches[0]
            valid = (_path(row.get("sourcePath", "")) == _path(str(hooks_path))
                     and (row.get("pluginId") == PLUGIN_ID if plugin_plane else row.get("source") == "user"))
        if not valid:
            pending.append(key)
    return {"healthy": not pending, "checked": len(expected), "pending": pending,
            "reason": "current hooks trusted" if not pending else "required hooks need review or are missing/disabled"}


def audit(binary: Optional[str], home: Path, hooks_path: Optional[Path], plugin_plane: bool,
          required_names: set[str], cwd: Path, roster_path: Optional[Path] = None) -> dict:
    try:
        if not binary or hooks_path is None:
            raise ValueError("Hook inventory unavailable")
        expected_keys(roster_path or hooks_path, plugin_plane, required_names)
        return assess(read_inventory(binary, home, cwd), hooks_path, plugin_plane, required_names, cwd, roster_path)
    except (OSError, ValueError, TypeError, KeyError, InventoryUnavailable, subprocess.SubprocessError):
        return {"healthy": False, "checked": 0, "pending": [], "reason": "current hook trust unverified; inventory or roster unavailable"}
