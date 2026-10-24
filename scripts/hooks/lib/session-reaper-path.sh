#!/bin/sh

# Return success only when a process command line names the exact worktree or a
# true descendant. A raw substring check lets `/dpf` capture `/dpf-worktrees`.
#
# Two refinements (BI-B0122A22 follow-up, 2026-09-06):
#
# 1. A worktree's node_modules is a junction into the ROOT clone, so every
#    worktree's vitest / next / tsc process carries `<root>/node_modules/...` in
#    its argv. Those tokens prove nothing about which worktree the process serves,
#    so they are stripped before matching. Three local-CI gate runs in sibling
#    worktrees died by SIGTERM because a root-clone session's end matched them.
# 2. The Git common dir lives under the ROOT clone (`<root>/.git/worktrees/<wt>/…`)
#    and every worktree's local-CI runner is handed paths inside it
#    (`--metadata-out <root>/.git/worktrees/<wt>/dpf-local-ci-metadata.json`), so
#    those tokens are stripped too. Observed 2026-09-06: a root-clone session's end
#    matched a sibling worktree's `local-integration-ci.mjs` on exactly that token.
# 3. After stripping, a line that still names a DIFFERENT worktree (any
#    `-worktrees/<name>` path that is not this one) belongs to that worktree, not
#    to the ending session, even if it also references this path.
dpf_process_line_matches_worktree() {
  _dpf_line=$1
  _dpf_worktree=$2
  # Strip shared tokens: "<worktree>/node_modules/…" and "<worktree>/.git/…".
  _dpf_stripped=$(printf '%s' "$_dpf_line" \
    | sed "s#${_dpf_worktree}/node_modules/[^ ]*##g; s#${_dpf_worktree}/\.git[^ ]*##g")
  case "$_dpf_stripped" in
    *"$_dpf_worktree"|*"$_dpf_worktree/"*|*"$_dpf_worktree "*) ;;
    *) return 1 ;;
  esac
  # A sibling worktree path that is not ours means the process is theirs.
  _dpf_other=$(printf '%s' "$_dpf_stripped" \
    | tr ' ' '\n' \
    | grep -E -- '-worktrees/[^/ ]+' \
    | sed -E 's#^(.*-worktrees/[^/ ]+).*$#\1#' \
    | grep -v -x -- "$_dpf_worktree" \
    | grep -v -- "^$_dpf_worktree/" \
    | head -n 1)
  [ -n "$_dpf_other" ] && return 1
  return 0
}
