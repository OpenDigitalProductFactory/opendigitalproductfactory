/**
 * Shell step that allows `quotedValue` as a global git `safe.directory` at
 * most once. `git config --global --add` appends a new line on every call, so
 * an unguarded step run per exec or per test grows the global config without
 * bound and every rewrite races concurrent git readers (BI-249EEA02).
 *
 * `quotedValue` must already be shell-quoted (e.g. `'*'` or `"/workspace"`).
 */
export function ensureGlobalSafeDirectoryCommand(quotedValue: string): string {
  return `git config --global --get-all safe.directory 2>/dev/null | grep -qxF ${quotedValue} || git config --global --add safe.directory ${quotedValue} >/dev/null 2>&1 || true`;
}
