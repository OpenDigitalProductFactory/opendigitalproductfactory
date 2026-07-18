#!/usr/bin/env node
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const [operation, transitionId] = process.argv.slice(2);
if (!['reserve', 'release'].includes(operation) || !/^RCT-[A-Za-z0-9-]{1,48}$/.test(transitionId ?? '')) {
  process.stderr.write("invalid_runtime_transition_authority_request\n");
  process.exit(64);
}
const stateDir = resolve(process.env.DPF_STATE_DIR ?? ".");
const marker = join(stateDir, "runtime-transition-authority.json");
await mkdir(stateDir, { recursive: true, mode: 0o700 });

const owner = async () => {
  try { return JSON.parse(await readFile(marker, "utf8")).transitionId; }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

if (operation === "reserve") {
  try {
    const file = await open(marker, "wx", 0o600);
    await file.writeFile(`${JSON.stringify({ transitionId })}\n`);
    await file.close();
  } catch (error) {
    if (error.code !== "EEXIST" || await owner() !== transitionId) {
      process.stderr.write("transition_authority_in_use\n");
      process.exit(75);
    }
  }
} else {
  if (await owner() !== transitionId) {
    process.stderr.write("transition_authority_not_owned\n");
    process.exit(75);
  }
  await rm(marker);
}
process.stdout.write(`${JSON.stringify({ status: operation === "reserve" ? "reserved" : "released", transitionId })}\n`);
