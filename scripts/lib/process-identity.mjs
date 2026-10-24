// Process IDs and command lines are reusable. Cleanup authority belongs to the
// observed process incarnation, never to the number alone.
const validBirth = (value) => typeof value === "string" && /^[1-9]\d*$/.test(value);
export function sameProcessIdentity(left, right) {
  return Boolean(left && right && validBirth(left.birthTime) && validBirth(right.birthTime)
    && left.pid === right.pid && left.birthTime === right.birthTime);
}

export function ancestorPids(pid, rows) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const ancestors = new Set();
  let current = pid;
  while (Number.isInteger(current) && current > 0 && !ancestors.has(current)) {
    ancestors.add(current);
    current = byPid.get(current)?.parentPid;
  }
  return ancestors;
}

export function ownedDescendants(root, rows, excluded) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const children = new Map();
  for (const row of rows) {
    const parent = byPid.get(row.parentPid);
    // A parent must predate its child. Windows retains ParentProcessId after
    // exit, so an older child cannot belong to a newly reused parent PID.
    if (!validBirth(row.birthTime) || !validBirth(parent?.birthTime) || excluded.has(row.pid)
      || BigInt(row.birthTime) < BigInt(parent.birthTime)) continue;
    const siblings = children.get(row.parentPid) ?? [];
    siblings.push(row);
    children.set(row.parentPid, siblings);
  }
  const found = [];
  const seen = new Set([root]);
  const queue = [...(children.get(root) ?? [])];
  for (let index = 0; index < queue.length; index += 1) {
    const row = queue[index];
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    found.push(row);
    queue.push(...(children.get(row.pid) ?? []));
  }
  return found;
}
