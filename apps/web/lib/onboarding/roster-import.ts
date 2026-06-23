// EP-ONBOARDING-INTAKE P4 — employee-roster ingestion (the "employees entered
// quickly" lane). Pure, deterministic mapping from a parsed CSV/spreadsheet grid
// to proposed EmployeeProfile records the operator confirms before any are
// created. No DB, no AI — header detection is predictable and fully testable so
// a roster import never surprises the operator.
//
// Scope (slice 1): the identity baseline — name, work email, phone, start date.
// Detected title/department are surfaced for confirmation but their FK wiring
// (Position / Department lookup-or-create) is a follow-on; this slice gets the
// people into the system fast, the spine the rest of HR hangs off.

export type RosterRole =
  | "firstName"
  | "lastName"
  | "fullName"
  | "displayName"
  | "workEmail"
  | "phoneWork"
  | "title"
  | "department"
  | "startDate";

export type ProposedEmployee = {
  firstName: string;
  lastName: string;
  displayName: string;
  workEmail: string | null;
  phoneWork: string | null;
  /** Detected, shown for confirmation; FK wiring is a follow-on slice. */
  title: string | null;
  department: string | null;
  /** ISO `YYYY-MM-DD` when parseable, else null. */
  startDate: string | null;
  /** Source data-row index (0-based, header excluded). */
  sourceRow: number;
  /** Non-blocking notes for the operator to review before import. */
  issues: string[];
  /** True when an earlier row in this file already used this work email. */
  duplicateInFile: boolean;
};

export type RosterMapping = Partial<Record<RosterRole, number>>;

export type RosterMappingResult = {
  proposed: ProposedEmployee[];
  mapping: RosterMapping;
  /** Headers that matched no role (informational). */
  unmappedColumns: string[];
  /** Rows excluded because no usable name could be derived. */
  skippedRows: number;
  summary: string;
};

/** Header synonyms per role. First role to claim a normalized header wins. */
const ROLE_SYNONYMS: Record<RosterRole, string[]> = {
  firstName: ["firstname", "fname", "givenname", "first"],
  lastName: ["lastname", "lname", "surname", "familyname", "last"],
  fullName: ["fullname", "name", "employeename", "employee", "fulllegalname"],
  displayName: ["displayname", "preferredname", "nickname", "knownas"],
  workEmail: ["workemail", "email", "emailaddress", "mail", "companyemail"],
  phoneWork: ["phone", "workphone", "phonenumber", "mobile", "cell", "telephone", "tel"],
  title: ["title", "jobtitle", "position", "role", "jobrole", "designation"],
  department: ["department", "dept", "team", "division", "group"],
  startDate: ["startdate", "start", "hiredate", "datehired", "joindate", "joined", "hired"],
};

const ROLE_ORDER: RosterRole[] = [
  "firstName",
  "lastName",
  "displayName",
  "fullName",
  "workEmail",
  "phoneWork",
  "title",
  "department",
  "startDate",
];

const normalizeHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Parse a delimited text grid (CSV or TSV) into header + all rows. Unlike
 * `parseCsv` in file-parsers (which samples 50 rows for previewing), this keeps
 * every row — a roster import must see them all. Delimiter is auto-detected from
 * the header line (tab beats comma when present).
 */
export function parseDelimitedGrid(text: string): { columns: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  const delimiter = lines[0]!.includes("\t") && !lines[0]!.includes(",") ? "\t" : ",";
  const splitLine = (line: string): string[] =>
    line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
  return {
    columns: splitLine(lines[0]!),
    rows: lines.slice(1).map(splitLine),
  };
}

/** Detect which column index supplies each role (first match wins per role). */
export function detectRosterMapping(columns: string[]): {
  mapping: RosterMapping;
  unmappedColumns: string[];
} {
  const mapping: RosterMapping = {};
  const claimed = new Set<number>();
  for (const role of ROLE_ORDER) {
    const syns = ROLE_SYNONYMS[role];
    for (let i = 0; i < columns.length; i++) {
      if (claimed.has(i)) continue;
      if (syns.includes(normalizeHeader(columns[i] ?? ""))) {
        mapping[role] = i;
        claimed.add(i);
        break;
      }
    }
  }
  const unmappedColumns = columns.filter((_, i) => !claimed.has(i));
  return { mapping, unmappedColumns };
}

function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

function normalizeStartDate(raw: string): { iso: string | null; issue: string | null } {
  if (!raw.trim()) return { iso: null, issue: null };
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return { iso: null, issue: `unrecognized start date "${raw}"` };
  return { iso: new Date(t).toISOString().slice(0, 10), issue: null };
}

/**
 * Map a parsed roster grid to proposed employees. Pure + deterministic. Rows
 * with no derivable name are excluded (counted in `skippedRows`); duplicate work
 * emails within the file are flagged, not dropped, so the operator decides.
 */
export function mapRosterToEmployees(columns: string[], rows: string[][]): RosterMappingResult {
  const { mapping, unmappedColumns } = detectRosterMapping(columns);
  const cell = (row: string[], role: RosterRole): string =>
    mapping[role] != null ? (row[mapping[role]!] ?? "").trim() : "";

  const proposed: ProposedEmployee[] = [];
  const seenEmails = new Set<string>();
  let skippedRows = 0;
  let duplicateCount = 0;

  rows.forEach((row, sourceRow) => {
    const issues: string[] = [];
    const full = cell(row, "fullName");
    let firstName = cell(row, "firstName");
    let lastName = cell(row, "lastName");
    if (!firstName && !lastName && full) {
      const parts = splitFullName(full);
      firstName = parts.first;
      lastName = parts.last;
    }
    const displayName =
      cell(row, "displayName") || `${firstName} ${lastName}`.trim() || full.trim();

    // No usable name → can't create an EmployeeProfile; exclude (counted).
    if (!displayName) {
      skippedRows++;
      return;
    }

    const workEmailRaw = cell(row, "workEmail");
    const workEmail = workEmailRaw || null;
    if (workEmail && !EMAIL_RE.test(workEmail)) issues.push(`email looks invalid: "${workEmail}"`);

    let duplicateInFile = false;
    if (workEmail) {
      const key = workEmail.toLowerCase();
      if (seenEmails.has(key)) {
        duplicateInFile = true;
        duplicateCount++;
        issues.push("duplicate work email in this file");
      } else {
        seenEmails.add(key);
      }
    }

    const { iso: startDate, issue: dateIssue } = normalizeStartDate(cell(row, "startDate"));
    if (dateIssue) issues.push(dateIssue);

    proposed.push({
      firstName,
      lastName,
      displayName,
      workEmail,
      phoneWork: cell(row, "phoneWork") || null,
      title: cell(row, "title") || null,
      department: cell(row, "department") || null,
      startDate,
      sourceRow,
      issues,
      duplicateInFile,
    });
  });

  const parts = [`${proposed.length} employee${proposed.length === 1 ? "" : "s"} ready`];
  if (skippedRows > 0) parts.push(`${skippedRows} row${skippedRows === 1 ? "" : "s"} skipped (no name)`);
  if (duplicateCount > 0) parts.push(`${duplicateCount} duplicate email${duplicateCount === 1 ? "" : "s"}`);

  return { proposed, mapping, unmappedColumns, skippedRows, summary: parts.join(", ") };
}
