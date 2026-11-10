/**
 * One grammar for both consequence refinement and diagnostic execution.
 * Deliberately excludes shell syntax, alternate Compose projects/configs,
 * Git configuration overrides, arbitrary scripts and unknown flags.
 */
export function parseAdminDiagnostic(command: unknown): { file: string; args: string[] } | null {
  if (typeof command !== "string" || command.length > 1000) return null;
  // Newlines, quoting and expansion never belong to this single argv grammar.
  if (!/^[a-zA-Z0-9 ./=_-]+$/.test(command)) return null;
  const normalized = command.trim().replace(/ +/g, " ");
  const patterns = [
    /^docker compose ps(?: (?:--all|--quiet|--services|--format json))*$/,
    /^docker compose logs(?: (?:--no-color|--timestamps|--tail [1-9][0-9]{0,2}|portal|sandbox|postgres|portal-init|browser-use))*$/,
    /^git status(?: (?:--short|--porcelain(?:=v[12])?|--branch))*$/,
    /^git rev-parse (?:HEAD|--show-toplevel|--abbrev-ref HEAD|--is-shallow-repository)$/,
  ];
  if (!patterns.some((pattern) => pattern.test(normalized))) return null;
  const [file, ...args] = normalized.split(" ");
  return { file, args };
}
