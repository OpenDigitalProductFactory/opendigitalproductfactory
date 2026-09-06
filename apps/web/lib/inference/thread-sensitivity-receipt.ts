// apps/web/lib/inference/thread-sensitivity-receipt.ts
//
// BI-706530B2 — narrow a persisted screen receipt (an opaque `Json` column,
// written by whatever version of the screener was live at the time) into the
// shape the notice needs.
//
// This is the version boundary. Receipts predating `currentTurnStartIndex` or
// `matchProvenance` exist in every install's history and must not produce a
// half-formed notice; they return null and the panel stays quiet, which is what
// it does today.

import type {
  InferenceDataClass,
  InferenceDataScreenReceipt,
  InferenceMatchProvenance,
} from "./data-screening/types";
import { isRecord } from "@/lib/shared/coerce";

export type ThreadSensitivityReceipt = Pick<
  InferenceDataScreenReceipt,
  "routeEffect" | "classifiedDataClasses" | "matchProvenance"
> & { currentTurnStartIndex: number };

function readProvenance(value: unknown): InferenceMatchProvenance[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter(isRecord).flatMap((row) => {
    const { dataClass, path, reason, confidence, origin } = row;
    if (typeof dataClass !== "string" || typeof path !== "string") return [];
    if (typeof reason !== "string" || typeof confidence !== "string") return [];
    return [
      {
        dataClass: dataClass as InferenceDataClass,
        path,
        reason,
        confidence: confidence as InferenceMatchProvenance["confidence"],
        ...(typeof origin === "string"
          ? { origin: origin as InferenceMatchProvenance["origin"] }
          : {}),
      },
    ];
  });
  return rows;
}

export function readThreadSensitivityReceipt(value: unknown): ThreadSensitivityReceipt | null {
  if (!isRecord(value)) return null;

  const routeEffect = value.routeEffect;
  if (routeEffect !== "allow" && routeEffect !== "local-only" && routeEffect !== "block") {
    return null;
  }

  // Absent on pre-BI-706530B2 receipts. Without the anchor there is nothing to
  // compare provenance indices against, so history and the current turn are
  // indistinguishable and no honest notice can be built.
  const currentTurnStartIndex = value.currentTurnStartIndex;
  if (typeof currentTurnStartIndex !== "number" || !Number.isInteger(currentTurnStartIndex)) {
    return null;
  }

  const classes = Array.isArray(value.classifiedDataClasses)
    ? value.classifiedDataClasses.filter(
        (entry): entry is InferenceDataClass => typeof entry === "string",
      )
    : [];

  return {
    routeEffect,
    classifiedDataClasses: classes,
    matchProvenance: readProvenance(value.matchProvenance),
    currentTurnStartIndex,
  };
}
