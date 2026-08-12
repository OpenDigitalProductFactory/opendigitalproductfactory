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
  if (platform !== "win32" || command !== "pnpm") {
    return { command, args };
  }
  return {
    command: env.ComSpec || env.COMSPEC || "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      [command, ...args].map(quoteWindowsCommandToken).join(" "),
    ],
  };
}
