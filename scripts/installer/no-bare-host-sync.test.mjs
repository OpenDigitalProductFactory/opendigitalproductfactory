// BI-0FC727BB: a bare `sync` flushes every filesystem and wedges a FUSE-mounted
// Docker Desktop worktree. Flag a command whose argv is only sync (`sync`,
// `sync;`). Do not flag comments, `sync FILE`, or method calls like file.sync().
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const INSTALLER = join(dirname(fileURLToPath(import.meta.url)));
const INTRODUCERS = new Set(["else", "then", "do", "elif", "if", "while", "until", "!"]);
const CLOSERS = new Set(["fi", "done", "esac"]);
const WRAPPERS = new Set(["command", "exec", "builtin"]);

function kindFor(rel) {
  if (rel.endsWith(".sh")) return "shell";
  if (rel.endsWith(".ps1")) return "ps1";
  if (/\.(mjs|cjs|js)$/.test(rel)) return "js";
  return "data";
}

function shellLike(kind) {
  return kind === "shell" || kind === "ps1" || kind === "data";
}

/** @returns {{ line: number, text: string }[]} */
export function findBareSyncInvocations(text, kind) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  let source = text;
  if (kind === "js") {
    const extracted = extractJsTemplates(text);
    source = extracted.masked;
    for (const inner of extracted.inners) {
      for (const hit of findBareSyncInvocations(inner.text, "shell")) {
        hits.push(hit.line + inner.line - 1);
      }
    }
  }
  for (const line of commandLines(source, kind)) hits.push(line);
  return [...new Set(hits)].sort((a, b) => a - b).map((line) => ({ line, text: (lines[line - 1] ?? "").trim() }));
}

function extractJsTemplates(text) {
  let masked = "";
  const inners = [];
  let i = 0;
  let line = 1;
  let state = "code";
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (state === "line") {
      masked += c === "\n" ? "\n" : " ";
      if (c === "\n") { line += 1; state = "code"; }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") { masked += "  "; state = "code"; i += 2; continue; }
      masked += c === "\n" ? "\n" : " ";
      if (c === "\n") line += 1;
      i += 1;
      continue;
    }
    if (state === "sq" || state === "dq") {
      const quote = state === "sq" ? "'" : "\"";
      masked += c;
      if (c === "\\") { masked += n ?? ""; if (n === "\n") line += 1; i += 2; continue; }
      if (c === "\n") line += 1;
      if (c === quote) state = "code";
      i += 1;
      continue;
    }
    if (c === "/" && n === "/") { state = "line"; masked += "  "; i += 2; continue; }
    if (c === "/" && n === "*") { state = "block"; masked += "  "; i += 2; continue; }
    if (c === "'") { state = "sq"; masked += c; i += 1; continue; }
    if (c === "\"") { state = "dq"; masked += c; i += 1; continue; }
    if (c === "`") {
      const startLine = line;
      let j = i + 1;
      let inner = "";
      while (j < text.length && text[j] !== "`") {
        if (text[j] === "\\") { inner += text[j] + (text[j + 1] ?? ""); j += 2; continue; }
        inner += text[j];
        j += 1;
      }
      inners.push({ line: startLine, text: inner });
      masked += "`";
      for (const ch of inner) {
        masked += ch === "\n" ? "\n" : " ";
        if (ch === "\n") line += 1;
      }
      if (j < text.length) masked += "`";
      i = j < text.length ? j + 1 : j;
      continue;
    }
    if (c === "\n") line += 1;
    masked += c;
    i += 1;
  }
  return { masked, inners };
}

function commandLines(text, kind) {
  const hits = [];
  const tokens = tokenize(text, kind);
  let expecting = true;
  let name = null;
  let operands = 0;
  let nameLine = 1;
  let mode = "normal";
  const flush = () => {
    if (name === "sync" && operands === 0) hits.push(nameLine);
    name = null;
    operands = 0;
    expecting = true;
  };
  for (const token of tokens) {
    if (mode === "for-name") {
      if (token.type === "newline" || token.type === "sep") { mode = "normal"; expecting = true; }
      else if (token.type === "word" && token.value === "in") mode = "for-list";
      else if (token.type === "word" && token.value === "do") { mode = "normal"; expecting = true; }
      continue;
    }
    if (mode === "for-list") {
      if (token.type === "newline" || token.type === "sep" || (token.type === "word" && token.value === "do")) {
        mode = "normal";
        expecting = true;
      }
      continue;
    }
    if (token.type === "newline" || token.type === "sep" || token.type === "rparen" || token.type === "rbrace") {
      flush();
      continue;
    }
    if (token.type === "subst" || token.type === "lbrace") {
      flush();
      expecting = true;
      continue;
    }
    if (token.type === "lparen") continue;
    if (token.type === "redirect" || token.type === "target") continue;
    if (token.type !== "word") continue;
    if (expecting && token.value === "for" && shellLike(kind)) {
      mode = "for-name";
      continue;
    }
    if (expecting && shellLike(kind) && (INTRODUCERS.has(token.value) || CLOSERS.has(token.value))) {
      if (CLOSERS.has(token.value)) flush();
      expecting = true;
      continue;
    }
    if (expecting) {
      name = token.value;
      nameLine = token.line;
      expecting = false;
      continue;
    }
    if (operands === 0 && shellLike(kind) && WRAPPERS.has(name) && token.value === "sync") {
      name = "sync";
      nameLine = token.line;
      continue;
    }
    operands += 1;
  }
  flush();
  return hits;
}

function tokenize(text, kind) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  const push = (type, value) => tokens.push({ type, value, line });
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === " " || c === "\t") { i += 1; continue; }
    if (c === "\r") { i += 1; continue; }
    if (c === "\n") { push("newline", "\n"); line += 1; i += 1; continue; }
    if (shellLike(kind) && c === "\\" && (next === "\n" || (next === "\r" && text[i + 2] === "\n"))) {
      line += 1;
      i += next === "\r" ? 3 : 2;
      continue;
    }
    if ((kind === "shell" || kind === "ps1" || kind === "data") && c === "#" && hashStartsComment(text, i)) {
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }
    if (kind === "ps1" && c === "<" && next === "#") {
      i += 2;
      while (i < n && !(text[i] === "#" && text[i + 1] === ">")) {
        if (text[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (kind === "data" && text.startsWith("<!--", i)) {
      i += 4;
      while (i < n && !text.startsWith("-->", i)) {
        if (text[i] === "\n") line += 1;
        i += 1;
      }
      i += 3;
      continue;
    }
    if (kind === "js" && c === "/" && next === "/") {
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }
    if (kind === "js" && c === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === "\"") {
      const quote = c;
      const start = i;
      i += 1;
      if (shellLike(kind) && quote === "'") {
        while (i < n && text[i] !== "'") {
          if (text[i] === "\n") line += 1;
          i += 1;
        }
      } else {
        while (i < n && text[i] !== quote) {
          if (text[i] === "\\") {
            if (text[i + 1] === "\n") line += 1;
            i += 2;
            continue;
          }
          if (text[i] === "\n") line += 1;
          i += 1;
        }
      }
      if (i < n) i += 1;
      push("word", text.slice(start, i));
      continue;
    }
    if (shellLike(kind) && c === "`") { push("subst", "`"); i += 1; continue; }
    if (shellLike(kind) && c === "$" && next === "(") { push("subst", "$("); i += 2; continue; }
    if (c === "&" && next === "&") { push("sep", "&&"); i += 2; continue; }
    if (c === "|" && next === "|") { push("sep", "||"); i += 2; continue; }
    if (c === ";" || c === "|" || c === "&") { push("sep", c); i += 1; continue; }
    if (c === "(") { push("lparen", c); i += 1; continue; }
    if (c === ")") { push("rparen", c); i += 1; continue; }
    if (c === "{") { push("lbrace", c); i += 1; continue; }
    if (c === "}") { push("rbrace", c); i += 1; continue; }
    if (shellLike(kind) && kind !== "data") {
      const redirect = readRedirect(text, i);
      if (redirect) {
        push("redirect", text.slice(i, redirect.end));
        i = redirect.end;
        if (redirect.needsTarget) {
          while (i < n && (text[i] === " " || text[i] === "\t")) i += 1;
          if (i < n && text[i] !== "\n" && text[i] !== "'" && text[i] !== "\"") {
            const start = i;
            while (i < n && !isBareBoundary(text[i], kind)) i += 1;
            push("target", text.slice(start, i));
          }
        }
        continue;
      }
    }
    const start = i;
    while (i < n && !isBareBoundary(text[i], kind)) i += 1;
    if (i === start) { i += 1; continue; }
    push("word", text.slice(start, i));
  }
  return tokens;
}

function hashStartsComment(text, index) {
  if (index === 0) return true;
  const prev = text[index - 1];
  if (prev === "$" || prev === "{" || prev === "\\") return false;
  return /[\s;&|(]/.test(prev) || prev === "`";
}

function isBareBoundary(ch, kind) {
  if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return true;
  if (";&|(){}".includes(ch) || ch === "'" || ch === "\"" || ch === "`") return true;
  if (shellLike(kind) && kind !== "data" && (ch === "<" || ch === ">")) return true;
  return false;
}

function readRedirect(text, index) {
  let j = index;
  while (j < text.length && text[j] >= "0" && text[j] <= "9") j += 1;
  const ops = [">>", ">&", ">|", "<>", "<<", "<&", ">", "<"];
  const op = ops.find((candidate) => text.startsWith(candidate, j));
  if (!op) return null;
  let end = j + op.length;
  if (op === ">&" || op === "<&") {
    if (text[end] === "-" || (text[end] >= "0" && text[end] <= "9")) end += 1;
    return { end, needsTarget: false };
  }
  return { end, needsTarget: true };
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const shellLines = (text) => findBareSyncInvocations(text, "shell").map((hit) => hit.line);
const jsLines = (text) => findBareSyncInvocations(text, "js").map((hit) => hit.line);

test("flags a bare sync command, including sync; and a command with no path", () => {
  assert.deepEqual(shellLines("sync\n"), [1]);
  assert.deepEqual(shellLines("sync;\n"), [1]);
  assert.deepEqual(shellLines("echo hi; sync; echo bye\n"), [1]);
  assert.deepEqual(shellLines("else sync; fi\n"), [1]);
  assert.deepEqual(shellLines("then sync\n"), [1]);
  assert.deepEqual(shellLines("sync && true\n"), [1]);
  assert.deepEqual(shellLines("sync || true\n"), [1]);
  assert.deepEqual(shellLines("(sync)\n"), [1]);
  assert.deepEqual(shellLines("$(sync)\n"), [1]);
  assert.deepEqual(shellLines("`sync`\n"), [1]);
  assert.deepEqual(shellLines("sync # not a path\n"), [1]);
  assert.deepEqual(shellLines("sync 2>/dev/null\n"), [1]);
  assert.deepEqual(shellLines("{ sync; }\n"), [1]);
  assert.deepEqual(shellLines("command sync\n"), [1]);
  assert.deepEqual(shellLines("for name in a; do sync; done\n"), [1]);
});

test("does not flag comments, sync FILE, or lookalikes", () => {
  assert.deepEqual(shellLines("sync FILE\n"), []);
  assert.deepEqual(shellLines("sync \"$1\"\n"), []);
  assert.deepEqual(shellLines("sync /tmp/state.json\n"), []);
  assert.deepEqual(shellLines("# sync\n"), []);
  assert.deepEqual(shellLines("# sync;\n"), []);
  assert.deepEqual(shellLines("# a bare sync wedges FUSE\n"), []);
  assert.deepEqual(shellLines("echo \"else sync;\"\n"), []);
  assert.deepEqual(shellLines("python3 -c 'import os; os.fsync(1)'\n"), []);
  assert.deepEqual(shellLines("Keep in sync with state.sh\n"), []);
  assert.deepEqual(shellLines("for sync in a; do echo x; done\n"), []);
  assert.deepEqual(shellLines("file.sync()\n"), []);
  assert.deepEqual(shellLines("fsyncSync(fd)\n"), []);
  assert.deepEqual(shellLines("git sync; npm run build\n"), []);
  assert.deepEqual(shellLines("command sync FILE\n"), []);
});

test("javascript method calls and comments are not a host sync", () => {
  assert.deepEqual(jsLines("await file.sync();\n"), []);
  assert.deepEqual(jsLines("handle.sync = async () => {};\n"), []);
  assert.deepEqual(jsLines("await directory.sync();\n"), []);
  assert.deepEqual(jsLines("// sync\n"), []);
  assert.deepEqual(jsLines("/*\nsync\n*/\n"), []);
  assert.deepEqual(jsLines("const note = \"else sync;\";\n"), []);
  assert.deepEqual(jsLines("const note = `else sync; fi`;\n"), [1]);
  assert.deepEqual(jsLines("sync;\n"), [1]);
  assert.deepEqual(jsLines("import { syncBuiltinESMExports } from \"node:module\";\n"), []);
});

test("scripts/installer has no bare host sync and flushes one file with node", () => {
  const hits = [];
  for (const file of walk(INSTALLER)) {
    const rel = relative(INSTALLER, file).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    for (const hit of findBareSyncInvocations(text, kindFor(rel))) {
      hits.push(`${rel}:${hit.line}: ${hit.text}`);
    }
  }
  assert.deepEqual(hits, []);
  const state = readFileSync(join(INSTALLER, "lib", "state.sh"), "utf8");
  const fn = state.slice(state.indexOf("dpf_state_flush_file()"), state.indexOf("dpf_state_commit_candidate"));
  assert.match(fn, /fs\.openSync\(process\.argv\[1\],"r\+"\)/);
  assert.match(fn, /fs\.fsyncSync\(fd\)/);
  assert.match(fn, /fs\.closeSync\(fd\)/);
  assert.equal(findBareSyncInvocations(fn, "shell").length, 0);
});
