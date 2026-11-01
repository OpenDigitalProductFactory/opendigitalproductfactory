// Shared Docker stage graph; install snapshots preserve instruction ordering.
export function parseStages(dockerfileText) {
  const stages = [];
  let current = null;
  // Join line continuations so a wrapped COPY/RUN is seen whole.
  const text = dockerfileText.replace(/\\\r?\n\s*/g, " ");

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const from = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      current = {
        name: from[2] ?? `#${stages.length}`,
        parent: from[1],
        workdir: null,
        copies: [],
        runsPnpmInstall: false,
        installs: [],
      };
      stages.push(current);
      continue;
    }
    if (!current) continue;

    const workdir = line.match(/^WORKDIR\s+(\S+)/i);
    if (workdir) {
      current.workdir = workdir[1];
      continue;
    }

    const copy = line.match(/^COPY\s+(.*)$/i);
    if (copy) {
      const parts = copy[1].split(/\s+/).filter(Boolean);
      const flags = parts.filter((p) => p.startsWith("--"));
      const operands = parts.filter((p) => !p.startsWith("--"));
      if (operands.length >= 2) {
        current.copies.push({
          sources: operands.slice(0, -1),
          workdir: current.workdir,
          dest: operands[operands.length - 1],
          fromStage:
            flags
              .find((f) => f.toLowerCase().startsWith("--from="))
              ?.slice("--from=".length) ?? null,
        });
      }
      continue;
    }

    if (/^RUN\b/i.test(line) && /\bpnpm\s+install\b/.test(line)) {
      current.runsPnpmInstall = true;
      current.installs.push({ workdir: current.workdir, copies: [...current.copies] });
    }
  }
  return stages;
}


export function isDockerignored(patchPath, dockerignoreText) {
  let excluded = false;
  for (const raw of dockerignoreText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const pattern = (negated ? line.slice(1) : line).replace(/\/+$/, "");
    if (pattern === "") continue;

    const regex = new RegExp(
      `^${pattern
        .split("/")
        .map((seg) =>
          seg === "**"
            ? ".*"
            : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
        )
        .join("/")}(/.*)?$`,
    );
    if (regex.test(patchPath)) excluded = !negated;
  }
  return excluded;
}
