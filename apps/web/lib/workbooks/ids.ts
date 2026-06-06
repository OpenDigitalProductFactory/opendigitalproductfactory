// Universal Grid & Workbooks — semantic id generation (EP-GRID-WORKBOOKS)
// Produces human-readable secondary ids (WB-/TBL-/COL-/ROW-/VW-) following the
// platform convention of a meaningful prefix + cuid-like suffix.

import { randomUUID } from "node:crypto";

function cuidLike(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24).toLowerCase();
}

export function genSemanticId(prefix: "WB" | "TBL" | "COL" | "ROW" | "VW"): string {
  return `${prefix}-${cuidLike()}`;
}
