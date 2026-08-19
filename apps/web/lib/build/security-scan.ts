/**
 * Security Scan — EP-BUILD-HANDOFF-002 Phase 2e
 *
 * Static analysis of a git diff for common security issues:
 *   - SQL injection patterns
 *   - XSS / HTML injection
 *   - Command injection
 *   - Hardcoded secrets (API keys, passwords, tokens)
 *   - Dependency additions (new packages)
 *   - Destructive schema operations
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ScanSeverity = "info" | "warning" | "critical";

export interface ScanFinding {
  severity: ScanSeverity;
  category: string;
  file: string;
  line: number;
  message: string;
  evidence: string;
}

export interface SecurityScanResult {
  passed: boolean;
  findings: ScanFinding[];
  summary: string;
  scannedFiles: number;
  criticalCount: number;
  warningCount: number;
}

// ─── Pattern Definitions ────────────────────────────────────────────────────

interface ScanPattern {
  category: string;
  severity: ScanSeverity;
  pattern: RegExp;
  message: string;
  fileFilter?: RegExp;
}

const SCAN_PATTERNS: ScanPattern[] = [
  // SQL Injection
  {
    category: "sql-injection",
    severity: "critical",
    pattern: /\$\{[^}]+\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i,
    message: "Possible SQL injection via template literal interpolation",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "sql-injection",
    severity: "critical",
    pattern: /\+\s*['"`]?\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|WHERE)\b/i,
    message: "Possible SQL injection via string concatenation",
    fileFilter: /\.tsx?$/,
  },

  // XSS / HTML Injection
  {
    category: "xss",
    severity: "critical",
    pattern: /dangerouslySetInnerHTML/,
    message: "dangerouslySetInnerHTML usage — ensure input is sanitized",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "xss",
    severity: "warning",
    pattern: /innerHTML\s*=/,
    message: "Direct innerHTML assignment — potential XSS vector",
    fileFilter: /\.tsx?$/,
  },

  // Command Injection
  {
    category: "command-injection",
    severity: "critical",
    pattern: /(?:exec|execSync|spawn|spawnSync)\([^)]*\$\{/,
    message: "Possible command injection via template literal in exec/spawn",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "command-injection",
    severity: "warning",
    pattern: /(?:exec|execSync)\([^)]*\+/,
    message: "String concatenation in exec call — potential command injection",
    fileFilter: /\.tsx?$/,
  },

  // Hardcoded Secrets
  {
    category: "secrets",
    severity: "critical",
    pattern: /(?:api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{16,}/i,
    message: "Possible hardcoded API key or secret",
  },
  {
    category: "secrets",
    severity: "critical",
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}/i,
    message: "Possible hardcoded password",
  },
  {
    category: "secrets",
    severity: "warning",
    pattern: /(?:sk-|pk_live_|pk_test_|ghp_|gho_|github_pat_|xoxb-|xoxp-)[A-Za-z0-9_-]{10,}/,
    message: "Possible API token detected (Stripe, GitHub, Slack prefix)",
  },

  // Destructive Schema Operations
  {
    category: "schema-destructive",
    severity: "critical",
    pattern: /\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i,
    message: "Destructive schema operation — requires explicit acknowledgment",
    fileFilter: /\.(sql|prisma)$/,
  },

  // Dependency additions
  {
    category: "dependency",
    severity: "info",
    pattern: /^\+\s*"[^"]+"\s*:\s*"[~^]?\d/,
    message: "New dependency added — verify it is vetted",
    fileFilter: /package\.json$/,
  },

  // Eval usage
  {
    category: "eval",
    severity: "critical",
    pattern: /\beval\s*\(/,
    message: "eval() usage — significant security risk",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "eval",
    severity: "warning",
    pattern: /new\s+Function\s*\(/,
    message: "new Function() — dynamic code execution",
    fileFilter: /\.tsx?$/,
  },

  // ─── Backdoor Detection (Phase 2) ────────────────────────────────────────

  // Obfuscated code patterns
  {
    category: "backdoor",
    severity: "critical",
    pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){3,}/,
    message: "Hex-escaped string sequence — possible obfuscated code",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "backdoor",
    severity: "critical",
    pattern: /atob\s*\(\s*['"][A-Za-z0-9+/=]{20,}/,
    message: "Base64 decode of long string — possible obfuscated payload",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "backdoor",
    severity: "critical",
    pattern: /Buffer\.from\s*\(\s*['"][A-Za-z0-9+/=]{40,}['"],\s*['"]base64['"]\)/,
    message: "Buffer.from base64 with long payload — possible obfuscated code",
    fileFilter: /\.tsx?$/,
  },

  // Unexpected network calls
  {
    category: "backdoor",
    severity: "critical",
    pattern: /fetch\s*\(\s*['"]https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|api\.github\.com)/,
    message: "Outbound fetch to non-platform URL — verify this is intended",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "backdoor",
    severity: "warning",
    pattern: /(?:net|dgram|http|https)\.(?:createServer|createConnection|connect|request)\s*\(/,
    message: "Direct network server/connection — should use platform abstractions",
    fileFilter: /\.tsx?$/,
  },

  // Crypto mining / data exfiltration
  {
    category: "backdoor",
    severity: "critical",
    pattern: /(?:crypto(?:night|miner)|stratum\+tcp|coinhive|minergate)/i,
    message: "Crypto mining pattern detected",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "backdoor",
    severity: "critical",
    pattern: /(?:document\.cookie|localStorage|sessionStorage).*(?:fetch|XMLHttpRequest|sendBeacon)/,
    message: "Possible data exfiltration — reading storage and sending data",
    fileFilter: /\.tsx?$/,
  },

  // ─── Architecture Compliance (Phase 2) ────────────────────────────────────

  // Raw SQL in app code (should use Prisma)
  {
    category: "architecture",
    severity: "warning",
    pattern: /\$queryRaw|\.query\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE)\b/i,
    message: "Raw SQL in app code — use Prisma client for database access",
    fileFilter: /\.tsx?$/,
  },

  // Direct API calls bypassing routing (should go through ai-inference.ts)
  {
    category: "architecture",
    severity: "warning",
    pattern: /fetch\s*\(\s*['"]https?:\/\/api\.openai\.com/,
    message: "Direct OpenAI API call — use the platform inference pipeline instead",
    fileFilter: /\.tsx?$/,
  },
  {
    category: "architecture",
    severity: "warning",
    pattern: /fetch\s*\(\s*['"]https?:\/\/api\.anthropic\.com/,
    message: "Direct Anthropic API call — use the platform inference pipeline instead",
    fileFilter: /\.tsx?$/,
  },
];

// ─── Diff Parsing ───────────────────────────────────────────────────────────

interface DiffHunk {
  file: string;
  lineNumber: number;
  content: string;
}

/**
 * Extract added lines from a unified diff with file path and line number context.
 */
function extractAddedLines(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split("\n");

  let currentFile = "";
  let lineNumber = 0;

  for (const line of lines) {
    // Track current file
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (fileMatch) {
      currentFile = fileMatch[2];
      continue;
    }

    // Track line numbers from hunk headers
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      lineNumber = parseInt(hunkMatch[1], 10);
      continue;
    }

    // Only scan added lines (lines starting with +, excluding the +++ header)
    if (line.startsWith("+") && !line.startsWith("+++")) {
      hunks.push({
        file: currentFile,
        lineNumber,
        content: line.slice(1), // Remove the leading +
      });
      lineNumber++;
    } else if (!line.startsWith("-")) {
      // Context line — increment line counter
      lineNumber++;
    }
  }

  return hunks;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Scan a unified diff for security issues. Returns structured findings.
 */
export function scanDiffForSecurityIssues(diff: string): SecurityScanResult {
  const addedLines = extractAddedLines(diff);
  const findings: ScanFinding[] = [];
  const scannedFiles = new Set<string>();

  for (const hunk of addedLines) {
    scannedFiles.add(hunk.file);

    for (const scanPattern of SCAN_PATTERNS) {
      // Apply file filter if specified
      if (scanPattern.fileFilter && !scanPattern.fileFilter.test(hunk.file)) continue;

      if (scanPattern.pattern.test(hunk.content)) {
        findings.push({
          severity: scanPattern.severity,
          category: scanPattern.category,
          file: hunk.file,
          line: hunk.lineNumber,
          message: scanPattern.message,
          evidence: hunk.content.trim().slice(0, 200),
        });
      }
    }
  }

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const passed = criticalCount === 0;

  const summaryParts: string[] = [];
  if (passed) {
    summaryParts.push("Security scan passed.");
  } else {
    summaryParts.push(`Security scan FAILED: ${criticalCount} critical finding(s).`);
  }
  if (warningCount > 0) {
    summaryParts.push(`${warningCount} warning(s).`);
  }
  summaryParts.push(`Scanned ${scannedFiles.size} file(s).`);

  return {
    passed,
    findings,
    summary: summaryParts.join(" "),
    scannedFiles: scannedFiles.size,
    criticalCount,
    warningCount,
  };
}

/**
 * Format security scan results for display in a PR body or AI Coworker chat.
 */
export function formatScanForDisplay(result: SecurityScanResult): string {
  const lines: string[] = [];

  if (result.passed) {
    lines.push("**Security Scan: PASSED**");
  } else {
    lines.push("**Security Scan: FAILED**");
  }

  lines.push(`- ${result.scannedFiles} files scanned`);
  lines.push(`- ${result.criticalCount} critical, ${result.warningCount} warnings`);

  if (result.findings.length > 0) {
    lines.push("");
    lines.push("| Severity | Category | File | Message |");
    lines.push("|----------|----------|------|---------|");
    for (const f of result.findings.slice(0, 20)) {
      lines.push(`| ${f.severity} | ${f.category} | ${f.file}:${f.line} | ${f.message} |`);
    }
    if (result.findings.length > 20) {
      lines.push(`| ... | ... | ... | ${result.findings.length - 20} more findings |`);
    }
  }

  return lines.join("\n");
}
