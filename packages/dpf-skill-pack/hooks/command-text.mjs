// packages/dpf-skill-pack/hooks/command-text.mjs
//
// Shared helper for Bash-command guards (lease-guard, lease-punt-guard):
// reduce a shell command to the text that can actually EXECUTE, so block/deny
// patterns stop firing on quoted DATA. Observed live 2026-07-06: recording an
// MCP evidence record whose JSON summary contained the words "prisma migrate
// deploy" was denied by lease-punt-guard — and filing the bug about it was
// blocked too, because the BI body quoted the same words.
//
// What is removed before pattern matching:
//   - single-quoted segments (POSIX: no escapes inside)
//   - double-quoted segments (backslash escapes respected)
//   - heredoc bodies (<<EOF / <<-EOF / <<'EOF' … EOF)
// What is added back:
//   - the payload of `sh|bash|zsh|dash [-flags] -c '<payload>'` — a quoted
//     -c payload IS a command, so it is unquoted and re-scanned (one level).
//
// Direction of error is deliberate: an unmatched quote strips to end-of-string
// and a command smuggled inside a heredoc piped to a shell is missed — both
// fail OPEN (allow), matching the guards' never-wedge-the-session contract.
// Allow-direction markers (GOVERNED_MARKERS) should keep matching the RAW text.

const SHELL_C_PAYLOAD_RE =
  /\b(?:sh|bash|zsh|dash)\b(?:\s+-{1,2}[\w=-]*)*?\s+-\w*c\w*\s+('(?:[^'])*'|"(?:[^"\\]|\\.)*")/g;

function unquote(quoted) {
  const q = quoted[0];
  const body = quoted.slice(1, -1);
  return q === '"' ? body.replace(/\\(.)/g, "$1") : body;
}

function stripHeredocBodies(command) {
  const lines = command.split("\n");
  const out = [];
  let terminator = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    const heredoc = /<<-?\s*(?:'(\w+)'|"(\w+)"|(\w+))/.exec(line);
    out.push(line);
    if (heredoc) terminator = heredoc[1] ?? heredoc[2] ?? heredoc[3];
  }
  return out.join("\n");
}

function stripQuotedSegments(command) {
  let out = "";
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      if (close === -1) break; // unmatched — strip to end (fail open)
      i = close + 1;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < command.length && (command[j] !== '"' || command[j - 1] === "\\")) j++;
      if (j >= command.length) break; // unmatched — strip to end (fail open)
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * The command's executable text: quoted data and heredoc bodies removed,
 * shell `-c` payloads unquoted and appended for re-scanning.
 * @param {string} command
 * @param {number} depth internal recursion bound for nested `sh -c`
 * @returns {string}
 */
export function executableCommandText(command, depth = 0) {
  if (typeof command !== "string" || command === "") return "";
  const payloads = [];
  if (depth < 2) {
    for (const match of command.matchAll(SHELL_C_PAYLOAD_RE)) {
      payloads.push(executableCommandText(unquote(match[1]), depth + 1));
    }
  }
  const stripped = stripQuotedSegments(stripHeredocBodies(command));
  return payloads.length ? `${stripped}\n${payloads.join("\n")}` : stripped;
}
