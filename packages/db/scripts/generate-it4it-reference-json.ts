// packages/db/scripts/generate-it4it-reference-json.ts
// Dev time: pnpm --filter @dpf/db exec tsx scripts/generate-it4it-reference-json.ts
//
// Regenerates data/it4it_functional_criteria_taxonomy.json from the LFS-tracked
// docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx (BI-B470264D). Run it
// whenever the workbook changes; scripts/lib/it4it-reference-document.test.ts
// fails until you do.

import { writeFileSync } from "fs";

import { IT4IT_REFERENCE_JSON_PATH } from "../src/it4it-reference-data";
import { buildIt4itReferenceDocument } from "./lib/it4it-reference-document";

async function main() {
  const doc = await buildIt4itReferenceDocument();
  writeFileSync(IT4IT_REFERENCE_JSON_PATH, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  console.log(
    `Wrote ${IT4IT_REFERENCE_JSON_PATH}: ${doc.functionalRows.length} functional, ` +
      `${doc.valueStreamRows.length} value-stream, ${doc.participationRows.length} participation rows ` +
      `(source sha256 ${doc.source.sha256}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
