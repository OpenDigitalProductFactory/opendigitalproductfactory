// Universal Grid & Workbooks — RiskAssessmentAdapter (EP-GRID-WORKBOOKS, Phase 1c)
// Compliance risk assessments as an editable grid. Edits route through the
// canonical updateRiskAssessment action (enforces manage_compliance + audit log).
// No raw prisma writes.

import { prisma } from "@dpf/db";
import { updateRiskAssessment } from "@/lib/actions/compliance";
import {
  gridRegistry,
  type DataSourceAdapter,
  type AdapterContext,
} from "./adapter";
import {
  RISK_ENTITY_TYPE,
  RISK_COLUMNS,
  riskToGridRow,
  buildRiskInput,
  type RiskPlain,
} from "./risk-adapter-mapping";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type DataSourceFilter,
  type SortSpec,
  type Pagination,
  type PagedRows,
  type GridCapabilities,
} from "./types";
import { applyFilters, applySort, paginate } from "./grid-query";

const RISK_SELECT = {
  assessmentId: true,
  title: true,
  hazard: true,
  likelihood: true,
  severity: true,
  inherentRisk: true,
  residualRisk: true,
  status: true,
  scope: true,
  nextReviewDate: true,
  notes: true,
  assessedAt: true,
} as const;

function toPlain(r: {
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
}): RiskPlain {
  return { ...r };
}

class RiskAssessmentAdapter implements DataSourceAdapter {
  readonly entityType = RISK_ENTITY_TYPE;

  async getColumns(): Promise<ColumnDefinition[]> {
    return RISK_COLUMNS;
  }

  async queryRows(
    _entityType: string,
    opts: { filters: DataSourceFilter; sort: SortSpec[]; pagination: Pagination },
  ): Promise<PagedRows> {
    const risks = await prisma.riskAssessment.findMany({
      orderBy: { createdAt: "desc" },
      select: RISK_SELECT,
    });
    const rows = risks.map((r) => riskToGridRow(toPlain(r)));
    const filtered = applyFilters(rows, opts.filters);
    const sorted = applySort(filtered, opts.sort);
    return paginate(sorted, opts.pagination.cursor, opts.pagination.limit);
  }

  async getRow(_entityType: string, rowId: string): Promise<GridRow | null> {
    const r = await prisma.riskAssessment.findUnique({ where: { assessmentId: rowId }, select: RISK_SELECT });
    return r ? riskToGridRow(toPlain(r)) : null;
  }

  async updateCells(
    _entityType: string,
    rowId: string,
    changes: Record<string, CellValue>,
    _ctx: AdapterContext,
  ): Promise<GridRow> {
    const existing = await prisma.riskAssessment.findUnique({
      where: { assessmentId: rowId },
      select: { id: true },
    });
    if (!existing) throw new Error("Risk assessment not found");

    const input = buildRiskInput(changes);
    const res = await updateRiskAssessment(existing.id, input);
    if (!res.ok) throw new Error(res.message);

    const updated = await this.getRow(_entityType, rowId);
    if (!updated) throw new Error("Risk assessment updated but could not be read back");
    return updated;
  }

  getCapabilities(ctx: AdapterContext): GridCapabilities {
    return {
      canAddRow: false,
      canAddColumn: false,
      canEditCell: ctx.canManage === true,
      canDeleteRow: false,
    };
  }
}

export const riskAssessmentAdapter = new RiskAssessmentAdapter();
gridRegistry.register(riskAssessmentAdapter);
