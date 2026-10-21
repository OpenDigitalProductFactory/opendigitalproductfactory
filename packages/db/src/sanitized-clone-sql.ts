// SQL value preparation shared by the sanitized clone's bounded insert writer.

export type ColumnTypeInfo = {
  dataType: string;
  udtName: string;
};

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function prepareInsertParameter(
  value: unknown,
  columnType: ColumnTypeInfo | undefined,
  paramIdx: number,
): { placeholder: string; value: unknown } {
  const placeholder = `$${paramIdx}`;

  if (value === null || value === undefined) {
    return { placeholder, value: null };
  }

  if (columnType?.dataType === "json" || columnType?.dataType === "jsonb") {
    return {
      placeholder: `${placeholder}::${columnType.dataType}`,
      value: JSON.stringify(value),
    };
  }

  if (columnType?.dataType === "ARRAY" && Array.isArray(value)) {
    return {
      placeholder: `${placeholder}::${arrayElementTypeCast(columnType.udtName)}`,
      value: toPostgresTextArrayLiteral(value),
    };
  }

  if (
    columnType &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    const toString = (value as { toString?: () => string }).toString;
    if (typeof toString === "function" && toString !== Object.prototype.toString) {
      return { placeholder, value: toString.call(value) };
    }
    return { placeholder, value };
  }

  if (typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    if (Array.isArray(value)) {
      // PostgreSQL array columns need an array literal. JSON/JSONB arrays are
      // handled above from catalog type information.
      return {
        placeholder: `${placeholder}::text[]`,
        value: toPostgresTextArrayLiteral(value),
      };
    }

    return {
      placeholder: `${placeholder}::jsonb`,
      value: JSON.stringify(value),
    };
  }

  return { placeholder, value };
}

function toPostgresTextArrayLiteral(value: unknown[]): string {
  return `{${value.map((item: unknown) => `"${String(item).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

function arrayElementTypeCast(arrayUdtName: string): string {
  if (!arrayUdtName.startsWith("_") || arrayUdtName.length === 1) {
    throw new Error(`Unexpected PostgreSQL array UDT name: ${arrayUdtName}`);
  }

  // PostgreSQL exposes array UDTs as _<element-type>. Quote the catalog-owned
  // identifier so built-ins (int4/text) and case-sensitive custom enums both
  // resolve without treating any part of the name as SQL syntax.
  const elementType = arrayUdtName.slice(1).replaceAll('"', '""');
  return `"${elementType}"[]`;
}

export type SanitizedInsertPolicy = {
  maxRows: number;
  maxParameters: number;
  maxPayloadBytes: number;
};

export type SanitizedInsertStatement = { sql: string; values: unknown[] };

const DEFAULT_INSERT_POLICY: Readonly<SanitizedInsertPolicy> = Object.freeze({
  maxRows: 50,
  maxParameters: 65_535,
  maxPayloadBytes: 1_048_576,
});

function insertPolicy(policy: Partial<SanitizedInsertPolicy>): SanitizedInsertPolicy {
  const limits = { ...DEFAULT_INSERT_POLICY, ...policy };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid sanitized insert policy ${name}: expected a positive safe integer`);
    }
  }
  if (limits.maxRows > 500 || limits.maxParameters > 65_535) {
    throw new Error("Sanitized insert policy exceeds the row or PostgreSQL parameter bound");
  }
  return limits;
}

/**
 * Prepared parameter payload target, not a wire-packet size. Strings use UTF-8,
 * buffers their raw length, and remaining objects pg's JSON serialization.
 * Date's display string is conservative for pg's timestamp representation.
 * SQL text/protocol framing are outside this target; the parameter limit is hard.
 */
function preparedPayloadBytes(value: unknown): number {
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (value instanceof Date) return Buffer.byteLength(String(value), "utf8");
  if (value !== null && typeof value === "object") {
    return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
  }
  return Buffer.byteLength(String(value), "utf8");
}

/**
 * Lazily retain one bounded statement and the current prepared row. Only
 * contiguous rows with identical ordered keys share a statement: an absent
 * column keeps its database default, and conflict winners retain input order.
 * A single payload-oversized row remains executable alone; a row over the
 * parameter bound is refused before it can produce an invalid statement.
 */
export function* buildSanitizedInsertStatements(
  tableName: string,
  rows: readonly Record<string, unknown>[],
  columnTypes: ReadonlyMap<string, ColumnTypeInfo>,
  policy: Partial<SanitizedInsertPolicy> = {},
): Generator<SanitizedInsertStatement> {
  const limits = insertPolicy(policy);
  let columns: string[] = [];
  let tuples: string[] = [];
  let values: unknown[] = [];
  let payloadBytes = 0;
  const statement = (): SanitizedInsertStatement => ({
    sql: `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")}) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`,
    values,
  });
  const reset = () => { columns = []; tuples = []; values = []; payloadBytes = 0; };

  for (const row of rows) {
    const rowColumns = Object.keys(row);
    if (rowColumns.length > limits.maxParameters) {
      throw new Error(`Sanitized insert row has ${rowColumns.length} parameters; maximum is ${limits.maxParameters}`);
    }
    const sameColumns = columns.length === rowColumns.length && columns.every((column, index) => column === rowColumns[index]);
    if (tuples.length && (!sameColumns || values.length + rowColumns.length > limits.maxParameters)) {
      yield statement();
      reset();
    }

    const prepared = rowColumns.map((column, index) => prepareInsertParameter(row[column], columnTypes.get(column), index + 1));
    const rowBytes = prepared.reduce((total, parameter) => total + preparedPayloadBytes(parameter.value), 0);
    if (tuples.length && payloadBytes + rowBytes > limits.maxPayloadBytes) {
      yield statement();
      reset();
    }
    columns = rowColumns;
    const offset = values.length;
    tuples.push(`(${prepared.map((parameter, index) => {
      const parameterIndex = offset + index + 1;
      return parameter.placeholder.replace(/^\$\d+/, `$${parameterIndex}`);
    }).join(", ")})`);
    for (const parameter of prepared) values.push(parameter.value);
    payloadBytes += rowBytes;
    if (tuples.length >= limits.maxRows || values.length >= limits.maxParameters || payloadBytes >= limits.maxPayloadBytes) {
      yield statement();
      reset();
    }
  }
  if (tuples.length) yield statement();
}
