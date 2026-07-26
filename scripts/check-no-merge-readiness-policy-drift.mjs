#!/usr/bin/env node

import { runLocalAudit } from "./merge-readiness-policy.mjs";

const errors = runLocalAudit();
if (errors.length) {
  for (const error of errors) console.error(`[merge-readiness-policy] ${error}`);
  process.exit(1);
}
console.log("[merge-readiness-policy] OK");
