// Stdout evidence is emitted only after the read-only verifier succeeds.
// Stdin is one JSON row per line from the temporary Postgres trial database.
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyUploadsTrial } from "./restore-uploads.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const MAX_LINE = 64 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

async function* rowsFromTrial(input) {
  let previous = Buffer.alloc(0);
  for await (const raw of input) {
    const chunk = Buffer.from(raw);
    let start = 0;
    for (let end; (end = chunk.indexOf(0x0a, start)) !== -1; start = end + 1) {
      if (previous.length + end - start > MAX_LINE) throw new Error("trial database row exceeds the input bound");
      const complete = Buffer.concat([previous, chunk.subarray(start, end)]);
      yield JSON.parse(decoder.decode(complete));
      previous = Buffer.alloc(0);
    }
    if (previous.length + chunk.length - start > MAX_LINE) throw new Error("trial database row exceeds the input bound");
    previous = Buffer.concat([previous, chunk.subarray(start)]);
  }
  if (previous.length) throw new Error("trial database row output ended without a final newline");
}

export async function verifyCapturedUploadsTrial(env, input) {
  const runDir = env.DPF_PAIRED_TRIAL_UPLOADS_DIR;
  const uploadsRunId = env.DPF_PAIRED_TRIAL_UPLOADS_RUN_ID;
  const postgresRunId = env.DPF_PAIRED_TRIAL_POSTGRES_RUN_ID;
  const expected = {
    pairedPostgresRunId: postgresRunId,
    pairedPostgresSha256: env.DPF_PAIRED_TRIAL_POSTGRES_SHA256,
    archiveSha256: env.DPF_PAIRED_TRIAL_UPLOADS_SHA256,
    manifestSha256: env.DPF_PAIRED_TRIAL_MANIFEST_SHA256,
  };
  if (typeof runDir !== "string" || !isAbsolute(runDir) || !ID.test(uploadsRunId ?? "") || !ID.test(postgresRunId ?? "")
    || !SHA.test(expected.pairedPostgresSha256 ?? "") || !SHA.test(expected.archiveSha256 ?? "") || !SHA.test(expected.manifestSha256 ?? "")) {
    throw new Error("exact paired trial capture evidence is required");
  }
  const result = await verifyUploadsTrial({ runDir, expected, rows: rowsFromTrial(input) });
  return { postgresRunId, uploadsRunId, ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = await verifyCapturedUploadsTrial(process.env, process.stdin);
    process.stdout.write(`UPLOADS_TRIAL ${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(`UPLOADS_TRIAL_FAILED ${JSON.stringify(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}
