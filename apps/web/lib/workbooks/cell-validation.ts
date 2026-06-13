// Universal Grid & Workbooks — cell value validation (EP-GRID-WORKBOOKS)
//
// Single source of truth for turning an untyped incoming cell value into a
// validated, storage-ready shape keyed to the WorkbookCell columns. Shared by
// server actions, API routes, and MCP tool handlers so every write path —
// human or agent — enforces the same rules (spec "Cell Write Validation").

import { z } from "zod";
import {
  type CellValue,
  type FieldType,
  type FieldConfig,
  type ReferenceValue,
  TEXT_MAX_LENGTH,
} from "./types";

/** The persisted shape of a cell — mirrors the WorkbookCell scalar columns. */
export interface CellStorage {
  textValue: string | null;
  numberValue: number | null;
  dateValue: Date | null;
  boolValue: boolean | null;
  selectValue: string | null;
  multiSelectValue: string[];
  referenceId: string | null;
  referenceType: string | null;
}

export type CellValidationResult =
  | { ok: true; storage: CellStorage }
  | { ok: false; error: string };

export function emptyStorage(): CellStorage {
  return {
    textValue: null,
    numberValue: null,
    dateValue: null,
    boolValue: null,
    selectValue: null,
    multiSelectValue: [],
    referenceId: null,
    referenceType: null,
  };
}

interface ValidatableColumn {
  name: string;
  fieldType: FieldType;
  required: boolean;
  config?: FieldConfig | null;
}

const emailSchema = z.string().email();

function isEmpty(value: CellValue): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isReferenceValue(value: unknown): value is ReferenceValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "referenceId" in value &&
    typeof (value as ReferenceValue).referenceId === "string"
  );
}

/**
 * Validate one incoming value against a column's field type and return a
 * storage-ready object. Clients never choose the storage column — it is derived
 * here from fieldType. `null`/empty is allowed unless the column is required.
 */
export function validateCell(
  column: ValidatableColumn,
  value: CellValue,
): CellValidationResult {
  const storage = emptyStorage();

  if (isEmpty(value)) {
    if (column.required) {
      return { ok: false, error: `Missing required field: ${column.name}` };
    }
    return { ok: true, storage };
  }

  switch (column.fieldType) {
    case "text":
    case "url":
    case "email": {
      if (typeof value !== "string") {
        return { ok: false, error: `Expected text for ${column.name}` };
      }
      if (value.length > TEXT_MAX_LENGTH) {
        return {
          ok: false,
          error: `${column.name} exceeds ${TEXT_MAX_LENGTH} characters`,
        };
      }
      if (column.fieldType === "url") {
        try {
          // eslint-disable-next-line no-new
          new URL(value);
        } catch {
          return { ok: false, error: `Invalid URL for ${column.name}` };
        }
      }
      if (column.fieldType === "email" && !emailSchema.safeParse(value).success) {
        return { ok: false, error: `Invalid email for ${column.name}` };
      }
      storage.textValue = value;
      return { ok: true, storage };
    }

    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      if (typeof value === "boolean" || Number.isNaN(num)) {
        return {
          ok: false,
          error: `Invalid value for number field ${column.name}: expected numeric`,
        };
      }
      storage.numberValue = num;
      return { ok: true, storage };
    }

    case "date":
    case "datetime": {
      const d =
        value instanceof Date
          ? value
          : new Date(value as string | number);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, error: `Invalid date for ${column.name}` };
      }
      storage.dateValue = d;
      return { ok: true, storage };
    }

    case "checkbox": {
      if (typeof value !== "boolean") {
        return { ok: false, error: `Expected boolean for ${column.name}` };
      }
      storage.boolValue = value;
      return { ok: true, storage };
    }

    case "select": {
      if (typeof value !== "string") {
        return { ok: false, error: `Expected a select key for ${column.name}` };
      }
      const options = column.config?.options ?? [];
      if (options.length > 0 && !options.some((o) => o.key === value)) {
        return { ok: false, error: `Unknown option "${value}" for ${column.name}` };
      }
      storage.selectValue = value;
      return { ok: true, storage };
    }

    case "multi_select": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        return {
          ok: false,
          error: `Expected an array of select keys for ${column.name}`,
        };
      }
      const options = column.config?.options ?? [];
      if (options.length > 0) {
        const valid = new Set(options.map((o) => o.key));
        const bad = value.find((v) => !valid.has(v));
        if (bad !== undefined) {
          return { ok: false, error: `Unknown option "${bad}" for ${column.name}` };
        }
      }
      storage.multiSelectValue = value;
      return { ok: true, storage };
    }

    case "reference": {
      if (!isReferenceValue(value)) {
        return {
          ok: false,
          error: `Expected a reference {referenceId, referenceType} for ${column.name}`,
        };
      }
      const expectedType = column.config?.referenceType;
      const refType = value.referenceType ?? expectedType ?? null;
      if (expectedType && refType !== expectedType) {
        return {
          ok: false,
          error: `${column.name} expects references to ${expectedType}`,
        };
      }
      storage.referenceId = value.referenceId;
      storage.referenceType = refType;
      return { ok: true, storage };
    }

    case "formula":
    case "lookup": {
      // Computed columns are derived on read and never user-written.
      return { ok: false, error: `${column.name} is a computed column and cannot be set` };
    }

    default: {
      // Exhaustiveness guard — a new FieldType must extend this switch.
      const _never: never = column.fieldType;
      return { ok: false, error: `Unsupported field type: ${String(_never)}` };
    }
  }
}

/** Reverse mapping: turn a persisted cell into the grid's CellValue shape. */
export function storageToCellValue(
  fieldType: FieldType,
  cell: Partial<CellStorage> | null | undefined,
): CellValue {
  if (!cell) return null;
  switch (fieldType) {
    case "text":
    case "url":
    case "email":
      return cell.textValue ?? null;
    case "number":
      return cell.numberValue ?? null;
    case "date":
    case "datetime":
      return cell.dateValue ? new Date(cell.dateValue).toISOString() : null;
    case "checkbox":
      return cell.boolValue ?? null;
    case "select":
      return cell.selectValue ?? null;
    case "multi_select":
      return cell.multiSelectValue ?? [];
    case "reference":
      return cell.referenceId
        ? {
            referenceId: cell.referenceId,
            referenceType: cell.referenceType ?? "",
          }
        : null;
    case "formula":
    case "lookup":
      // Computed on read — no stored value.
      return null;
    default:
      return null;
  }
}
