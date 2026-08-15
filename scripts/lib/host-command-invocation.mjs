/**
 * Resolve a host command without enabling shell parsing globally.
 *
 * On Windows, package-manager shims are cmd scripts. Node's direct child
 * process APIs cannot reliably execute those shims (`pnpm` can be ENOENT and
 * `pnpm.cmd` can be EINVAL), so only that executable class is routed through
 * ComSpec. Other commands keep their original executable/argument boundary.
 */
function quoteWindowsCommandToken(token) {
  const value = String(token);
  if (!/[\s"&|<>^()%]/.test(value)) return value;
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

export function resolveHostCommandInvocation(
  command,
  args,
  { platform = process.platform, env = process.env } = {},
) {
  const windowsCommandShim = command === "pnpm" || /\.cmd$/i.test(command);
  if (platform !== "win32" || !windowsCommandShim) {
    return { command, args };
  }
  const commandLine = [command, ...args].map(quoteWindowsCommandToken).join(" ");
  const unresolvedPnpm = command === "pnpm";
  const cmdCommand = unresolvedPnpm ? commandLine : `call ${commandLine}`;
  return {
    command: env.ComSpec || env.COMSPEC || "cmd.exe",
    args: unresolvedPnpm
      ? ["/d", "/s", "/c", cmdCommand]
      : ["/d", "/c", cmdCommand],
  };
}
