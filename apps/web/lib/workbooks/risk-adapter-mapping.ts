// Universal Grid & Workbooks — RiskAssessment grid mapping (EP-GRID-WORKBOOKS, Phase 1c)
// Pure (no server imports) column schema, row mapping, and update-input builder
// for the Compliance risk grid. The risk update action supports per-field edits,
// so most fields are editable in the grid.

import {
  RISK_LIKELIHOODS,
  RISK_SEVERITIES,
  RISK_LEVELS,
  type RiskAssessmentInput,
} from "@/lib/govern/compliance-types";
import type { ColumnDefinition, GridRow, CellValue } from "./types";
import { toOptions } from "./option-helpers";

export const RISK_ENTITY_TYPE = "risk_assessment";

export const RISK_COLUMNS: ColumnDefinition[] = [
  { columnId: "assessmentId", name: "ID", fieldType: "text", position: 0, required: false, editable: false, width: 120 },
  { columnId: "title", name: "Title", fieldType: "text", position: 1, required: true, editable: true, width: 260 },
  { columnId: "hazard", name: "Hazard", fieldType: "text", position: 2, required: true, editable: true, width: 220 },
  {
    columnId: "likelihood",
    name: "Likelihood",
    fieldType: "select",
    position: 3,
    required: true,
    editable: true,
    width: 140,
    config: { options: toOptions(RISK_LIKELIHOODS) },
  },
  {
    columnId: "severity",
    name: "Severity",
    fieldType: "select",
    position: 4,
    required: true,
    editable: true,
    width: 140,
    config: { options: toOptions(RISK_SEVERITIES) },
  },
  {
    columnId: "inherentRisk",
    name: "Inherent risk",
    fieldType: "select",
    position: 5,
    required: true,
    editable: true,
    width: 130,
    groupable: true,
    config: { options: toOptions(RISK_LEVELS) },
  },
  {
    columnId: "residualRisk",
    name: "Residual risk",
    fieldType: "select",
    position: 6,
    required: false,
    editable: true,
    width: 130,
    config: { options: toOptions(RISK_LEVELS) },
  },
  { columnId: "status", name: "Status", fieldType: "text", position: 7, required: false, editable: false, width: 110 },
  { columnId: "scope", name: "Scope", fieldType: "text", position: 8, required: false, editable: true, width: 200 },
  { columnId: "nextReviewDate", name: "Next review", fieldType: "date", position: 9, required: false, editable: true, width: 140 },
  { columnId: "notes", name: "Notes", fieldType: "text", position: 10, required: false, editable: true, width: 300, config: { multiline: true } },
  { columnId: "assessedAt", name: "Assessed", fieldType: "datetime", position: 11, required: false, editable: false, width: 160 },
];

export interface RiskPlain {
  assessmentId: string;
  title: string;
  hazard: string;
  likelihood: string;
  severity: string;
  inherentRisk: string;
  residualRisk: string | null;
  status: string;
  scope: string | null;
  nextReviewDate: Date | null;
  notes: string | null;
  assessedAt: Date;
}

export function riskToGridRow(item: RiskPlain): GridRow {
  return {
    rowId: item.assessmentId,
    cells: {
      assessmentId: item.assessmentId,
      title: item.title,
      hazard: item.hazard,
      likelihood: item.likelihood,
      severity: item.severity,
      inherentRisk: item.inherentRisk,
      residualRisk: item.residualRisk,
      status: item.status,
      scope: item.scope,
      nextReviewDate: item.nextReviewDate ? item.nextReviewDate.toISOString() : null,
      notes: item.notes,
      assessedAt: item.assessedAt.toISOString(),
    },
  };
}

function str(v: CellValue): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function strOrNull(v: CellValue): string | null {
  const s = str(v).trim();
  return s === "" ? null : s;
}

/**
 * Build a Partial<RiskAssessmentInput> from grid changes (keyed by field name).
 * Only includes fields actually present in `changes` — the update action applies
 * a conditional spread, so undefined fields are left untouched.
 */
export function buildRiskInput(changes: Record<string, CellValue>): Partial<RiskAssessmentInput> {
  const input: Partial<RiskAssessmentInput> = {};
  if ("title" in changes) {
    const t = str(changes.title).trim();
    if (!t) throw new Error("Title cannot be empty");
    input.title = t;
  }
  if ("hazard" in changes) {
    const h = str(changes.hazard).trim();
    if (!h) throw new Error("Hazard cannot be empty");
    input.hazard = h;
  }
  if ("likelihood" in changes) input.likelihood = str(changes.likelihood);
  if ("severity" in changes) input.severity = str(changes.severity);
  if ("inherentRisk" in changes) input.inherentRisk = str(changes.inherentRisk);
  if ("residualRisk" in changes) input.residualRisk = strOrNull(changes.residualRisk);
  if ("scope" in changes) input.scope = strOrNull(changes.scope);
  if ("notes" in changes) input.notes = strOrNull(changes.notes);
  if ("nextReviewDate" in changes) {
    const raw = changes.nextReviewDate;
    if (raw == null || raw === "") {
      input.nextReviewDate = null;
    } else {
      const d = new Date(typeof raw === "string" ? raw : String(raw));
      if (Number.isNaN(d.getTime())) throw new Error("Invalid next review date");
      input.nextReviewDate = d;
    }
  }
  return input;
}
