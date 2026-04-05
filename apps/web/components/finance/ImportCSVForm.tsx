"use client";

// apps/web/components/finance/ImportCSVForm.tsx

import { useState, useRef } from "react";
import Link from "next/link";

interface ImportError {
  row: number;
  message: string;
}

interface ImportResult {
  imported: number;
  errors: ImportError[];
  batchId: string;
}

interface Props {
  bankAccountId: string;
  accountName: string;
}

export function ImportCSVForm({ bankAccountId, accountName }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [detectedFormat, setDetectedFormat] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  function detectFormat(header: string): string {
    const h = header.toLowerCase();
    if (h.includes("transaction date") && h.includes("debit amount")) return "Barclays";
    if (h.includes("transaction_date") && h.includes("sort code")) return "HSBC";
    if (h.includes("date") && h.includes("description") && h.includes("amount"))
      return "Generic";
    return "Unknown";
  }

  function parsePreview(content: string) {
    const lines = content.trim().split(/\r?\n/);
    const dataLines = lines.filter((l) => l.trim().length > 0);

    // Parse first 6 lines (header + 5 data rows)
    const parsed = dataLines.slice(0, 6).map((line) => {
      // Simple CSV split (handles quoted fields)
      const cols: string[] = [];
      let current = "";
      let inQuote = false;
      for (const char of line) {
        if (char === '"') {
          inQuote = !inQuote;
        } else if (char === "," && !inQuote) {
          cols.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      cols.push(current.trim());
      return cols;
    });

    const headerLine = dataLines[0] ?? "";
    const format = detectFormat(headerLine);

    // Count total data rows (excluding header)
    const rowCount = Math.max(0, dataLines.length - 1);

    setPreviewRows(parsed);
    setTotalRows(rowCount);
    setDetectedFormat(format);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setResult(null);
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setCsvContent(content);
      parsePreview(content);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!csvContent) return;

    setLoading(true);
    setErrorMsg(null);
    setResult(null);

    try {
      const response = await fetch(
        `/api/v1/finance/bank-accounts/${bankAccountId}/transactions`,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: csvContent,
        },
      );

      const json = await response.json();

      if (!response.ok) {
        setErrorMsg(json.message ?? "Import failed. Please check the file format.");
        return;
      }

      setResult(json.data ?? json);
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const headerRow = previewRows[0] ?? [];
  const dataPreviewRows = previewRows.slice(1);

  return (
    <div className="max-w-3xl">
      {/* File upload area */}
      {!result && (
        <div
          className="p-8 rounded-lg border-2 border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center mb-6 cursor-pointer hover:border-[var(--dpf-accent)] transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
          />
          {fileName ? (
            <div>
              <p className="text-sm font-medium text-[var(--dpf-text)] mb-1">{fileName}</p>
              <p className="text-xs text-[var(--dpf-muted)]">Click to choose a different file</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-[var(--dpf-text)] mb-1">
                Click to select a CSV file
              </p>
              <p className="text-xs text-[var(--dpf-muted)]">
                Supports Barclays, HSBC, and generic bank statement formats
              </p>
            </div>
          )}
        </div>
      )}

      {/* Preview */}
      {csvContent && !result && previewRows.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                Preview
              </h2>
              {detectedFormat && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ color: "var(--dpf-info)", backgroundColor: "color-mix(in srgb, var(--dpf-info) 12%, transparent)" }}
                >
                  {detectedFormat} format
                </span>
              )}
            </div>
            <p className="text-[10px] text-[var(--dpf-muted)]">
              {totalRows} row{totalRows !== 1 ? "s" : ""} total
            </p>
          </div>

          <div className="rounded-lg border border-[var(--dpf-border)] overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  {headerRow.map((col, i) => (
                    <th
                      key={i}
                      className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataPreviewRows.map((row, ri) => (
                  <tr
                    key={ri}
                    className="border-b border-[var(--dpf-border)] last:border-0"
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-4 py-2 text-[var(--dpf-muted)] whitespace-nowrap max-w-[180px] truncate"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalRows > 5 && (
            <p className="text-[10px] text-[var(--dpf-muted)] mt-2 text-right">
              Showing first 5 of {totalRows} rows
            </p>
          )}
        </div>
      )}

      {/* Error message */}
      {errorMsg && (
        <div
          className="mb-4 p-3 rounded-lg border text-xs"
          style={{ borderColor: "var(--dpf-error)", color: "var(--dpf-error)", backgroundColor: "color-mix(in srgb, var(--dpf-error) 6%, transparent)" }}
        >
          {errorMsg}
        </div>
      )}

      {/* Import button */}
      {csvContent && !result && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleImport}
            disabled={loading}
            className="px-4 py-2 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Importing…" : `Import ${totalRows} transaction${totalRows !== 1 ? "s" : ""}`}
          </button>
          <button
            onClick={() => {
              setCsvContent(null);
              setFileName(null);
              setPreviewRows([]);
              setDetectedFormat(null);
              setErrorMsg(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Success result */}
      {result && (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p
                className="text-sm font-semibold mb-1"
                style={{ color: "var(--dpf-success)" }}
              >
                Import complete
              </p>
              <p className="text-xs text-[var(--dpf-muted)]">
                Imported{" "}
                <span className="text-[var(--dpf-text)]">{result.imported}</span>{" "}
                transaction{result.imported !== 1 ? "s" : ""}
                {result.errors.length > 0 && (
                  <>
                    {" "}
                    with{" "}
                    <span style={{ color: "var(--dpf-error)" }}>{result.errors.length}</span>{" "}
                    error{result.errors.length !== 1 ? "s" : ""}
                  </>
                )}
              </p>
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mt-1">
                Batch: {result.batchId}
              </p>
            </div>
            <Link
              href={`/finance/banking/${bankAccountId}`}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
            >
              View Account
            </Link>
          </div>

          {result.errors.length > 0 && (
            <div>
              <button
                onClick={() => setShowErrors((v) => !v)}
                className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors mb-2"
              >
                {showErrors ? "Hide" : "Show"} {result.errors.length} error
                {result.errors.length !== 1 ? "s" : ""}
              </button>
              {showErrors && (
                <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--dpf-border)]">
                        <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                          Row
                        </th>
                        <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                          Error
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((err, i) => (
                        <tr
                          key={i}
                          className="border-b border-[var(--dpf-border)] last:border-0"
                        >
                          <td className="px-4 py-2 font-mono text-[var(--dpf-muted)]">
                            {err.row}
                          </td>
                          <td className="px-4 py-2" style={{ color: "var(--dpf-error)" }}>
                            {err.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
