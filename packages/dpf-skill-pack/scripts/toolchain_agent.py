"""Keep this host's DPF agent toolchain current with no person in the loop.

BI-65C17737 (S3 of BI-63672FBE; spec
docs/superpowers/specs/2026-10-27-self-converging-agent-toolchain-design.md M2).
The pack changes about eleven times a week. Detection already worked, but
nothing remediated until a person asked an agent to run the updater. This is
the per-user job that does it, outside any client session.

BI-590DD63E: it runs on events, and DPF installs no operating-system
scheduler for it. The platform owns scheduling; the host only executes. A
client session whose SessionStart hook finds a stale copy starts one run,
detached and windowless (hooks/toolchain-freshness.mjs). A completed platform
upgrade, and the platform's own daily safety net, reach the host through the
native edge node (BI-6ABE989B). Earlier packs registered a launchd job, a
systemd user timer or a Windows scheduled task; `retire_schedule` removes it
on every OS, from every updater run and after every agent run.

It adds no new trust and no new update logic. Each run:

1. takes a single-instance lock (a second run exits `busy`);
2. honours `~/.dpf/toolchain-agent/config.json` (`{"enabled": false}` opts out;
   `{"origin": ...}` chooses among several paired portals);
3. reads the signed manifest for the origin and installation this host already
   pinned in `~/.dpf/trusted-installations.json` (a first agent-run update
   writes that pin; a changed identity is refused, never trusted here);
4. runs the same signed updater (`--from-portal ... --expect-installation ...`)
   only when something changed: a new release, a changed client binary, a
   retry after failure once its backoff elapsed, or a daily re-verification;
5. leaves alone a copy a contributor's source checkout delivered when that
   checkout contains the served release (spec row X15: `ahead-of-portal`);
6. writes `~/.dpf/toolchain-agent/state.json` atomically. That file is this
   job's own: the bootstrap's readiness record (`agent-toolchain-state.json`)
   has a different writer and is never touched here.

Standard library only, Python 3.9+, so it runs on the system python3 of every
supported OS. It handles no credentials: the manifest and archive are public
and the signature pin is the trust anchor.

Usage: toolchain_agent.py run | install | uninstall | status
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

HOUR = 3600.0
DAY = 24 * HOUR
LOCK_STALE_SECONDS = 30 * 60
AGENT_ENV = "DPF_TOOLCHAIN_AGENT"
# Set by whichever process holds the run lock, so the updater processes it
# starts (portal_source's verified child, the agent's run) do not wait on it.
LOCK_HELD_ENV = "DPF_TOOLCHAIN_LOCK_HELD"
# EX_TEMPFAIL: another convergence on this host owns the run; try later.
EXIT_BUSY = 75
# Names of the OS registrations earlier packs created. Kept only so they can be removed.
LAUNCHD_LABEL = "local.dpf.toolchain-agent"
SYSTEMD_UNIT = "dpf-toolchain-agent"
WINDOWS_TASK = "DPF Toolchain Agent"
# CREATE_NO_WINDOW: a console child of a windowless process must not open a window.
WINDOWS_CREATE_NO_WINDOW = 0x08000000
LOG_LIMIT_BYTES = 1_000_000


# Set on the windowless relaunch so it never relaunches again.
HIDDEN_CONSOLE_ENV = "DPF_TOOLCHAIN_AGENT_HIDDEN_CONSOLE"


def quiet_kwargs(platform: Optional[str] = None) -> dict[str, Any]:
    """subprocess keyword arguments that keep a child windowless on Windows."""
    return {"creationflags": WINDOWS_CREATE_NO_WINDOW} if (platform or sys.platform) == "win32" else {}


def _has_console() -> bool:
    try:
        import ctypes

        return bool(ctypes.windll.kernel32.GetConsoleWindow())  # type: ignore[attr-defined]
    except Exception:
        return True


def relaunch_windowless(
    env: Mapping[str, str],
    platform: Optional[str] = None,
    has_console: Callable[[], bool] = _has_console,
    popen: Callable[..., Any] = subprocess.Popen,
) -> bool:
    """On Windows, re-run in a hidden console when started without one. True when relaunched.

    The SessionStart hook starts the agent detached, so it has no console.
    Every console program it then runs (client --version probes, the updater
    and its git and CLI children) would open a window of its own. One hop
    into a console created with CREATE_NO_WINDOW gives the whole tree a
    console nobody sees.
    """
    if (platform or sys.platform) != "win32" or env.get(HIDDEN_CONSOLE_ENV) == "1" or has_console():
        return False
    popen([sys.executable, str(Path(__file__).resolve()), "run"], env={**env, HIDDEN_CONSOLE_ENV: "1"},
          stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
          close_fds=True, creationflags=WINDOWS_CREATE_NO_WINDOW)
    return True


# ---------------------------------------------------------------- paths


def agent_dir(home: Path) -> Path:
    return home / ".dpf" / "toolchain-agent"


def state_path(home: Path) -> Path:
    return agent_dir(home) / "state.json"


def config_path(home: Path) -> Path:
    return agent_dir(home) / "config.json"


def lock_path(home: Path) -> Path:
    return agent_dir(home) / "run.lock"


def report_path(home: Path) -> Path:
    return agent_dir(home) / "last-report.json"


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    staged.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(staged, path)


def _log(home: Path, now: float, line: str) -> None:
    path = agent_dir(home) / "agent.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size > LOG_LIMIT_BYTES:
            os.replace(path, path.with_suffix(".log.1"))
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now))} {line}\n")
    except OSError:
        # The log is a convenience; a full disk or unwritable folder must never fail a run.
        pass


def load_config(home: Path) -> dict[str, Any]:
    data = _read_json(config_path(home))
    return data if isinstance(data, dict) else {}


def load_state(home: Path) -> dict[str, Any]:
    data = _read_json(state_path(home))
    return data if isinstance(data, dict) else {}


# ---------------------------------------------------------------- lock


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        completed = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, **quiet_kwargs())
        return str(pid) in (completed.stdout or "")
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def acquire_lock(home: Path, now: float, pid: Optional[int] = None) -> bool:
    """Take the run lock; take over one held by a dead process or older than 30 minutes."""
    path = lock_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    holder = {"pid": pid if pid is not None else os.getpid(), "at": now}
    for _ in range(2):
        try:
            descriptor = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            existing = _read_json(path)
            stale = (not isinstance(existing, dict)
                     or not _pid_alive(int(existing.get("pid") or 0))
                     or now - float(existing.get("at") or 0) > LOCK_STALE_SECONDS)
            if not stale:
                return False
            try:
                path.unlink()
            except FileNotFoundError:
                # Another run removed the stale lock first; retry the exclusive create.
                pass
            continue
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(holder))
        return True
    return False


def release_lock(home: Path) -> None:
    try:
        lock_path(home).unlink()
    except FileNotFoundError:
        # Already released (or removed by a stale-lock takeover): release is idempotent.
        pass


# ---------------------------------------------------------------- decisions


def backoff_seconds(failures: int) -> float:
    """1h, 2h, 4h ... capped at a day."""
    return min(DAY, HOUR * (2 ** max(0, failures - 1)))


def select_target(home: Path, config: Mapping[str, Any]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(origin, pinned device id, problem code). Only an already-pinned pair is ever used."""
    import portal_source

    pins = portal_source.read_pins(home)
    chosen = config.get("origin")
    if isinstance(chosen, str) and chosen:
        try:
            chosen = portal_source.normalize_origin(chosen)
        except Exception:
            return None, None, "invalid-origin"
        return (chosen, pins[chosen], None) if chosen in pins else (None, None, "not-paired")
    if not pins:
        return None, None, "not-paired"
    # BI-C20AD3F0: several origins pinned to one device id are one installation
    # reached by more than one address (https://localhost and the plain-http
    # loopback on a dev host). Prefer https, then the lowest origin, so the
    # choice is stable. Different device ids are a real choice for the operator.
    if len(set(pins.values())) > 1:
        return None, None, "ambiguous-origin"
    origin = min(pins, key=lambda candidate: (not candidate.startswith("https://"), candidate))
    return origin, pins[origin], None


def decide(state: Mapping[str, Any], digest: str, versions: Mapping[str, Any], now: float) -> Optional[str]:
    """Why to run the updater now, or None when this host is already current."""
    if not state.get("lastAttemptAt"):
        return "first-run"
    # A new release or a changed client is new information: it runs even
    # inside a failure's backoff window.
    if state.get("manifestDigest") != digest:
        return "new-release"
    if dict(state.get("cliVersions") or {}) != dict(versions):
        return "client-changed"
    if state.get("status") in ("failed", "needs-operator"):
        until = state.get("backoffUntil")
        return "retry" if until is None or now >= float(until) else None
    last_success = state.get("lastSuccessAt")
    if last_success is None or now - float(last_success) >= DAY:
        return "periodic-verify"
    return None


def _fetch_manifest(origin: str, expected: str, home: Path, env: Mapping[str, str]) -> dict[str, Any]:
    import portal_source

    raw = portal_source.fetch(origin + portal_source.MANIFEST_PATH, portal_source.MAX_MANIFEST_BYTES, home, env)
    manifest = json.loads(raw.decode("utf-8"))
    portal_source.verify_manifest(manifest, expected)
    return manifest


def _git_is_ancestor(root: str, older: str, newer: str) -> Optional[bool]:
    """True when `older` is contained in `newer` in the checkout at `root`; None when git cannot tell."""
    try:
        completed = subprocess.run(["git", "-C", root, "merge-base", "--is-ancestor", older, newer],
                                   capture_output=True, text=True, timeout=15, **quiet_kwargs())
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode == 0:
        return True
    if completed.returncode == 1:
        return False
    return None  # 128: an unknown commit, or not a repository


def _base_key(version: Any) -> Optional[tuple[int, ...]]:
    try:
        return tuple(int(part) for part in str(version).split("+", 1)[0].split("-", 1)[0].split("."))
    except ValueError:
        return None


def checkout_precedence(home: Path, manifest: Mapping[str, Any],
                        is_ancestor: Callable[[str, str, str], Optional[bool]]) -> Optional[str]:
    """Spec row X15: why a checkout-delivered copy must be left alone, or None to follow the portal.

    A contributor host's session bootstrap installs the pack from its source
    checkout. Reinstalling an older portal pack over it every hour would fight
    that writer, so a checkout that contains the served release wins.
    """
    import update_agent_toolchain as updater

    shared = updater.shared_managed_plugin_path(home)
    record = _read_json(shared / ".dpf-delivery.json")
    if not isinstance(record, dict) or record.get("source") != "checkout":
        return None
    release, commit, root = manifest.get("releaseId"), record.get("commit"), record.get("root")
    if isinstance(release, str) and isinstance(commit, str) and isinstance(root, str):
        verdict = is_ancestor(root, release, commit)
        if verdict is True:
            return "checkout contains the served release"
        if verdict is False:
            return None
    manifest_version = _read_json(shared / ".claude-plugin" / "plugin.json")
    installed = _base_key(manifest_version.get("version") if isinstance(manifest_version, dict) else None)
    served = _base_key(manifest.get("packVersion"))
    if installed is None or served is None:
        return None
    if installed > served:
        return "checkout base version is ahead of the served release"
    if installed == served:
        return "checkout order unverified at the same base version; the checkout keeps precedence"
    return None


def _client_versions() -> dict[str, Optional[str]]:
    import toolchain_convergence

    return toolchain_convergence.cli_versions()


def _summarize(report: Any) -> tuple[str, str]:
    """(result, one-line detail) from the updater's --report-json."""
    if not isinstance(report, dict):
        return "failed", "the updater wrote no report"
    result = str(report.get("result") or "failed")
    failed = [entry for entry in report.get("clients") or []
              if isinstance(entry, dict) and entry.get("action") in ("failed", "unrun")]
    names = sorted({f"{entry.get('client')} {entry.get('scope')}".strip() for entry in failed})
    detail = "; ".join(names[:6]) + (f" (+{len(names) - 6} more)" if len(names) > 6 else "")
    if failed:
        first = str(failed[0].get("detail") or "")[:200]
        detail = f"{detail}: {first}" if first else detail
    return result, detail


_VERSION_IN = re.compile(r"\d+(?:\.\d+)+[0-9a-z.-]*")


def unproven_code(client: str, version: Optional[str]) -> str:
    """`unproven.<client>.<version>` within the converge-token code vocabulary (spec M7)."""
    match = _VERSION_IN.search(str(version or "").lower())
    return f"unproven.{client}.{match.group(0) if match else 'unknown'}"[:48]


def canary(state: dict[str, Any], versions: Mapping[str, Any], report: Any, now: float) -> Optional[str]:
    """Record which client versions passed read-back; name a new version that broke it (M7).

    A client whose rows all pass at its current version becomes the verified
    reference. One that fails at a version other than the last verified one
    is `unproven` at that version, with the failing read-back as its probe.
    Returns the converge code for the first unproven client, if any.
    """
    rows = [row for row in (report.get("clients") or []) if isinstance(row, dict)] if isinstance(report, dict) else []
    verified: dict[str, Any] = dict(state.get("verifiedVersions") or {})
    unproven: dict[str, Any] = dict(state.get("unproven") or {})
    for client, version in versions.items():
        mine = [row for row in rows if row.get("client") == client]
        if not version or not mine:
            continue
        failed = [row for row in mine if row.get("action") == "failed"]
        if not failed:
            verified[client] = version
            unproven.pop(client, None)
        elif verified.get(client) not in (None, version):
            previous = unproven.get(client) or {}
            unproven[client] = {"version": version, "detail": str(failed[0].get("detail") or "")[:200],
                                "since": previous.get("since") if previous.get("version") == version else now}
    state["verifiedVersions"] = verified
    state["unproven"] = unproven
    first = next(iter(sorted(unproven)), None)
    return unproven_code(first, unproven[first]["version"]) if first else None


# ---------------------------------------------------------------- one run


def run_once(
    home: Path,
    env: Mapping[str, str],
    now: Optional[float] = None,
    fetch_manifest: Callable[..., dict[str, Any]] = _fetch_manifest,
    runner: Callable[..., Any] = subprocess.run,
    client_versions: Callable[[], dict[str, Optional[str]]] = _client_versions,
    is_ancestor: Callable[[str, str, str], Optional[bool]] = _git_is_ancestor,
) -> dict[str, Any]:
    """One convergence pass. Returns, and persists, this host's state."""
    import update_agent_toolchain as updater

    now = time.time() if now is None else now
    state: dict[str, Any] = {"schemaVersion": 1, **load_state(home)}
    state.setdefault("failureSince", None)
    state.setdefault("backoffUntil", None)
    state.setdefault("failures", 0)
    state["lastCheckAt"] = now
    state["python"] = sys.executable

    def finish(status: str, code: Optional[str] = None, detail: str = "", decision: Optional[str] = None) -> dict[str, Any]:
        state.update({"status": status, "code": code, "detail": detail, "lastDecision": decision})
        _write_json_atomic(state_path(home), state)
        _log(home, now, f"{status}{':' + code if code else ''} {decision or ''} {detail}".strip())
        return state

    config = load_config(home)
    if config.get("enabled") is False:
        return finish("opted-out")
    if not acquire_lock(home, now):
        # Another run owns the state file; report without writing over it.
        return {**state, "status": "busy"}
    try:
        origin, device_id, problem = select_target(home, config)
        if problem:
            return finish("needs-operator", problem)
        script = updater.shared_managed_plugin_path(home) / "scripts" / "update_agent_toolchain.py"
        if not script.is_file():
            return finish("needs-operator", "not-bootstrapped")
        try:
            manifest = fetch_manifest(origin, device_id, home, env)
        except OSError as error:
            return finish("offline", None, str(error)[:200])
        except Exception as error:  # PortalRefusal and malformed manifests
            code = getattr(error, "code", "manifest-refused")
            if code == "unreachable":
                # portal_source reports a network failure as a refusal coded
                # "unreachable". A portal restarting for an upgrade is that, and
                # it needs no person: the next event or the daily run retries.
                return finish("offline", None, str(getattr(error, "message", error))[:200])
            return finish("needs-operator", str(code), str(getattr(error, "message", error))[:200])
        ahead = checkout_precedence(home, manifest, is_ancestor)
        if ahead:
            return finish("ahead-of-portal", None, ahead, "checkout-precedence")
        digest = str(manifest.get("packDigest") or "")
        versions = client_versions()
        decision = decide(state, digest, versions, now)
        if decision is None:
            return finish(state.get("status") or "ok", state.get("code"), state.get("detail") or "", "current")
        report = report_path(home)
        try:
            report.unlink()
        except FileNotFoundError:
            # No report from a previous run: nothing to clear.
            pass
        command = [sys.executable, str(script), "--from-portal", str(origin),
                   "--expect-installation", str(device_id), "--report-json", str(report)]
        state["lastAttemptAt"] = now
        completed = runner(command, env={**env, AGENT_ENV: "1", LOCK_HELD_ENV: "1"}, capture_output=True, text=True,
                           **quiet_kwargs())
        code_out = int(getattr(completed, "returncode", 1))
        parsed = _read_json(report)
        result, detail = _summarize(parsed)
        state["manifestDigest"] = digest
        state["deliveredVersion"] = manifest.get("deliveredVersion")
        state["cliVersions"] = versions
        unproven = canary(state, versions, parsed, now)
        if code_out == 0 and result == "converged":
            state.update({"lastSuccessAt": now, "failureSince": None, "backoffUntil": None, "failures": 0})
            return finish("ok", None, "", decision)
        state["failures"] = int(state.get("failures") or 0) + 1
        state["failureSince"] = state.get("failureSince") or now
        state["backoffUntil"] = now + backoff_seconds(state["failures"])
        refusal = parsed.get("refusal") if isinstance(parsed, dict) else None
        if result == "refused" or isinstance(refusal, dict):
            refusal_code = refusal.get("code") if isinstance(refusal, dict) else None
            return finish("needs-operator", str(refusal_code or "refused"), detail, decision)
        return finish("failed", unproven or (f"exit-{code_out}" if code_out else result), detail, decision)
    finally:
        release_lock(home)


# ---------------------------------------------------------------- no OS schedule


def _legacy_registration(home: Path, platform: str, runner: Callable[..., Any]) -> Optional[str]:
    """Name the OS registration an earlier pack left on this host, or None."""
    if platform == "darwin":
        plist = home / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
        return f"launchd {LAUNCHD_LABEL}" if plist.exists() else None
    if platform.startswith("linux"):
        unit_dir = home / ".config" / "systemd" / "user"
        present = any((unit_dir / f"{SYSTEMD_UNIT}{suffix}").exists() for suffix in (".timer", ".service"))
        return f"systemd user timer {SYSTEMD_UNIT}.timer" if present else None
    if platform == "win32":
        if (agent_dir(home) / "schedule.json").exists():
            return f"scheduled task {WINDOWS_TASK}"
        # The marker can be lost while the task survives; ask Task Scheduler.
        completed = runner(["schtasks", "/Query", "/TN", WINDOWS_TASK], capture_output=True, text=True,
                           **quiet_kwargs(platform))
        return f"scheduled task {WINDOWS_TASK}" if int(getattr(completed, "returncode", 1)) == 0 else None
    return None


def retire_schedule(
    home: Path,
    env: Mapping[str, str],
    platform: Optional[str] = None,
    runner: Callable[..., Any] = subprocess.run,
    uid: Optional[int] = None,
) -> str:
    """Remove the OS scheduler entry an earlier pack registered. Idempotent; registers nothing.

    BI-590DD63E: DPF installs no operating-system scheduler. The platform owns
    scheduling and reaches the host through events (a client session start,
    or a platform upgrade dispatched to the edge node).
    """
    platform = platform or sys.platform
    uid = os.getuid() if uid is None and hasattr(os, "getuid") else (uid or 0)
    if env.get(AGENT_ENV) == "1":
        # An updater the agent started must not boot out the job running it;
        # the agent retires its own registration after its run.
        return "skipped: running under the toolchain agent"
    found = _legacy_registration(home, platform, runner)
    if found is None:
        return "none: no OS schedule (BI-590DD63E)"
    if platform == "darwin":
        # Delete the file first: bootout of a running job terminates it.
        plist = home / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
        plist.unlink(missing_ok=True)
        runner(["launchctl", "bootout", f"gui/{uid}/{LAUNCHD_LABEL}"], capture_output=True, text=True)
    elif platform.startswith("linux"):
        runner(["systemctl", "--user", "disable", "--now", f"{SYSTEMD_UNIT}.timer"], capture_output=True, text=True)
        for suffix in (".timer", ".service"):
            (home / ".config" / "systemd" / "user" / f"{SYSTEMD_UNIT}{suffix}").unlink(missing_ok=True)
        runner(["systemctl", "--user", "daemon-reload"], capture_output=True, text=True)
    elif platform == "win32":
        runner(["schtasks", "/Delete", "/F", "/TN", WINDOWS_TASK], capture_output=True, text=True,
               **quiet_kwargs(platform))
        (agent_dir(home) / "schedule.json").unlink(missing_ok=True)
    return f"removed: {found} (DPF installs no OS schedule; BI-590DD63E)"


def main(argv: Optional[list[str]] = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    command = argv[0] if argv else "run"
    import update_agent_toolchain as updater

    home = updater.home_dir()
    if command == "run":
        if relaunch_windowless(os.environ):
            return 0
        state = run_once(home, os.environ)
        print(json.dumps({key: state.get(key) for key in ("status", "code", "lastDecision", "detail")}))
        # Last, after the state is written and the lock released: on macOS
        # removing the old launch agent ends this process.
        retire_schedule(home, os.environ)
        return 0 if state.get("status") in ("ok", "busy", "opted-out", "offline", "ahead-of-portal") else 1
    if command in ("install", "uninstall"):
        # `install` is kept for callers of earlier packs; it registers nothing.
        print(retire_schedule(home, os.environ))
        return 0
    if command == "status":
        print(_legacy_registration(home, sys.platform, subprocess.run) or "no OS schedule (BI-590DD63E)")
        print(json.dumps(load_state(home), indent=2, sort_keys=True))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
