# Claude Code session transcript recovery — operator guide

**Audience:** DPF operators after an incident (machine crash, volume wipe, agent gone rogue).
**Spec lineage:** BI-C8655C8C in `EP-DR-HARDENING-2026-05-23` (2026-05-23 volume-wipe incident).
**Related:** [`runtime-kernel-commandments.md`](runtime-kernel-commandments.md), the postgres trial-restore mechanism.

## Why this exists

The 2026-05-23 overnight session wiped Docker volumes AND its own Claude Code transcript was lost. Without the transcript we couldn't answer: *what destructive actions ran? why did the agent think that was needed? what state was destroyed?*

This feature copies the active Claude Code session transcript to a durable location OUTSIDE the install root, so a future incident (volume wipe, install-dir rm, ransomware) leaves a forensic trail intact.

## How it works

A Claude Code `PostToolUse` hook fires after every tool call. The hook script (`scripts/safety/transcript-snapshot.ps1`) reads the hook payload, then copies the in-flight transcript file to:

```
$DPF_BACKUPS_HOST_PATH/session-transcripts/<YYYY-MM-DD>/<session-id>.jsonl
```

(`$DPF_BACKUPS_HOST_PATH` defaults to `$DPF_DIR-backups\` per BI-8004BCD8 — a sibling of the install, OUTSIDE the directory that reinstall would wipe.)

A `SessionEnd` hook fires the same script unconditionally on session end (clear, logout, prompt-exit, etc.) so the final state is always captured.

## What's NOT snapshotted

To keep hook overhead negligible:

- **Read-only tool calls** (`Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `TodoWrite`, `TaskList`, `TaskGet`) — they don't change state, so the snapshot wouldn't capture anything new.
- **Bursts of tool calls within 2 minutes of the last snapshot** — throttled. Worst-case data loss is 2 minutes of actions, not the full session.

`SessionEnd` is always honored regardless of throttle, so the final snapshot is guaranteed.

## How to find a snapshot after an incident

```powershell
# Most recent N snapshots across all sessions
Get-ChildItem $env:DPF_DIR-backups\session-transcripts -Recurse -Filter '*.jsonl' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 10 FullName, Length, LastWriteTime
```

Each `.jsonl` is the Claude Code native transcript format (one JSON object per line, each entry is a message / tool call / tool result). Tools like `jq` read it natively:

```bash
# Last 5 tool calls from a specific session
jq -c 'select(.type == "tool_use")' \
   "/d/DPF-backups/session-transcripts/2026-05-24/<session-id>.jsonl" \
   | tail -5
```

## How to retrieve the transcript inside Claude Code

A snapshot file is identical in format to the original. To resume from a snapshot:

```powershell
# Copy back to Claude Code's project dir for the same project
$slug = 'D--DPF'  # for D:\DPF; replace : with --, \ with --
$snapshot = "D:\DPF-backups\session-transcripts\2026-05-24\<session-id>.jsonl"
$dest = "$env:USERPROFILE\.claude\projects\$slug\<session-id>.jsonl"
Copy-Item $snapshot $dest -Force
# Then in Claude Code: /resume <session-id>
```

## Where the audit trail lives

Every snapshot writes one JSON line to `$DPF_BACKUPS_HOST_PATH/session-transcripts/.snapshot.log`:

```json
{"timestamp":"2026-05-24T17:31:42.123Z","session_id":"abc-123","hook_event":"PostToolUse","tool_name":"Bash","snapshot_path":"…","size_bytes":1234,"install_root":"D:\\DPF","backups_root":"D:\\DPF-backups"}
```

Grep this when investigating an incident — gives you the full sequence of snapshots taken across all sessions.

## Retention

- **30 days by default** — older day-dirs pruned automatically on every hook invocation (cheap; only top-level `YYYY-MM-DD` dirs are inspected).
- Pruning runs in the snapshot script itself, so no separate cron is needed.
- To change retention, edit `$retentionDays = 30` in `transcript-snapshot.ps1`.

## How to disable

Edit `.claude/settings.json` and remove the `PostToolUse` + `SessionEnd` entries that reference `transcript-snapshot.ps1`. Restart Claude Code. Re-running `install-dpf.ps1` will re-add them — the installer assumes snapshotting is on by default.

## Known limits

- **Windows-only in slice 1.** A POSIX hook (`transcript-snapshot.sh`) ships alongside the PowerShell version but `.claude/settings.json` only wires the PowerShell command today, matching the existing `WorktreeCreate` hook convention. Cross-platform hook wiring is a follow-up when DPF macOS/Linux installer matures.
- **The hook fires AFTER each tool call.** The snapshot from just BEFORE a destructive action survives; nothing captures the state during the action itself (irrelevant — there's nothing to snapshot at the moment of destruction).
- **The throttle means up to 2 minutes of conversation can be lost** during a crash mid-session-burst. The BI accepts this trade-off — "worst-case data loss is the last N actions, not the entire session" was the explicit ask.
- **Snapshots include conversation contents.** If a session contained secrets / credentials, they will be on disk under `$DPF_BACKUPS_HOST_PATH`. Protect that directory the same way you protect any backup tree.
- **Launcher bounds child lifetime (BI-BDA89375).** Hooks run through `scripts/hooks/run-hook.mjs`, which reads the payload once, pipes it into the target script, and kills the child tree if it exceeds `DPF_HOOK_TIMEOUT_MS` (default 15s). A hung snapshot never blocks the tool call and cannot pile up hundreds of Node/PowerShell processes.

## Composition with other DR-hardening features

- **Snapshots land in `$DPF_BACKUPS_HOST_PATH`** (BI-8004BCD8) — sibling of the install, survives reinstall.
- **Runtime kernel commandments** (BI-43F95F77) protect the backups dir from accidental `Remove-Item -Recurse` or `docker volume rm` patterns.
- **Postgres trial-restore** (BI-31C9FBDF) verifies the backups themselves are restorable; the same volume that hosts the transcript snapshots is implicitly health-checked.
- **Worktree janitor** (BI-E5002629) ensures session-end cleanup doesn't accidentally take the transcript with it (worktree removal does NOT touch `~/.claude/projects/` or `$DPF_BACKUPS_HOST_PATH`).
