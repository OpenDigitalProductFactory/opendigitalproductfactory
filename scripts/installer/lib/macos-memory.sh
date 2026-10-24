#!/usr/bin/env bash
# Bash 3.2 installer adapter. Node is checked before this is called.
dpf_converge_macos_memory() {
  [ "$(uname -s)" = "Darwin" ] || return 0
  local rc=0
  if [ "${DPF_ALLOW_DOCKER_RESTART:-0}" = "1" ]; then
    node "$REPO_ROOT/scripts/installer/macos-docker-memory.mjs" --apply --allow-docker-restart
    return $?
  fi
  node "$REPO_ROOT/scripts/installer/macos-docker-memory.mjs" --apply || rc=$?
  [ "$rc" = "75" ] || return "$rc"
  dpf_yes_no "Restart Docker Desktop now? This interrupts all containers and host model runner work." "no"
  if [ "$DPF_REPLY" != "yes" ]; then
    warn "Docker memory setup was declined. Re-run when a Docker restart is acceptable."
    return 75
  fi
  node "$REPO_ROOT/scripts/installer/macos-docker-memory.mjs" --apply --allow-docker-restart
}
