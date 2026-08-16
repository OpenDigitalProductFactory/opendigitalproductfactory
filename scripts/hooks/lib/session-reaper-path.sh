#!/bin/sh

# Return success only when a process command line names the exact worktree or a
# true descendant. A raw substring check lets `/dpf` capture `/dpf-worktrees`.
dpf_process_line_matches_worktree() {
  _dpf_line=$1
  _dpf_worktree=$2
  case "$_dpf_line" in
    *"$_dpf_worktree"|*"$_dpf_worktree/"*|*"$_dpf_worktree "*) return 0 ;;
    *) return 1 ;;
  esac
}
