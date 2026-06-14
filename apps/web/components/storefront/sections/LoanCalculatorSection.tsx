"use client";

import { useState, useEffect, useCallback } from "react";

const TERMS = [5, 10, 15, 20, 25, 30];

interface CalcContent {
  defaultRatePercent?: number;
  defaultTermYears?: number;
  showDownPayment?: boolean;
  disclaimer?: string;
}

// Standard amortisation: P × r(1+r)^n / ((1+r)^n − 1)
function monthlyPayment(principal: number, annualRatePercent: number, termYears: number): number {
  if (principal <= 0 || annualRatePercent <= 0 || termYears <= 0) return 0;
  const r = annualRatePercent / 100 / 12;
  const n = termYears * 12;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

interface AmortRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
}

function buildSchedule(loanAmount: number, annualRatePercent: number, termYears: number): AmortRow[] {
  const r = annualRatePercent / 100 / 12;
  const n = termYears * 12;
  const pmt = monthlyPayment(loanAmount, annualRatePercent, termYears);
  const rows: AmortRow[] = [];
  let balance = loanAmount;
  for (let month = 1; month <= n; month++) {
    const interest = balance * r;
    const principal = pmt - interest;
    balance = Math.max(0, balance - principal);
    rows.push({ month, payment: pmt, principal, interest, balance });
  }
  return rows;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--dpf-border)",
  borderRadius: 6,
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--dpf-text)",
  marginBottom: 4,
  display: "block",
};

export function LoanCalculatorSection({ content }: { content: Record<string, unknown> }) {
  const cfg = content as CalcContent;
  const defaultRate = typeof cfg.defaultRatePercent === "number" ? cfg.defaultRatePercent : 6.5;
  const defaultTerm = typeof cfg.defaultTermYears === "number" ? cfg.defaultTermYears : 30;
  const showDown = cfg.showDownPayment !== false;
  const disclaimer =
    typeof cfg.disclaimer === "string"
      ? cfg.disclaimer
      : "For illustrative purposes only. Not a loan offer or commitment to lend.";

  const [price, setPrice] = useState(400000);
  const [downPayment, setDownPayment] = useState(80000);
  const [rate, setRate] = useState(defaultRate);
  const [term, setTerm] = useState(defaultTerm);
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedPage, setSchedPage] = useState(0);

  const loanAmount = Math.max(0, price - (showDown ? downPayment : 0));
  const pmt = monthlyPayment(loanAmount, rate, term);
  const totalPaid = pmt * term * 12;
  const totalInterest = totalPaid - loanAmount;

  // Persist calculator snapshot to sessionStorage so the enquiry form can
  // include it in the formData payload without a cross-page prop chain.
  const writeSnapshot = useCallback(() => {
    if (typeof window === "undefined") return;
    const snapshot = {
      loanAmount: Math.round(loanAmount),
      ratePercent: rate,
      termYears: term,
      monthlyPayment: Math.round(pmt * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
    };
    sessionStorage.setItem("dpf_calc_snapshot", JSON.stringify(snapshot));
  }, [loanAmount, rate, term, pmt, totalInterest]);

  useEffect(() => { writeSnapshot(); }, [writeSnapshot]);

  const schedule = showSchedule ? buildSchedule(loanAmount, rate, term) : [];
  const PAGE_SIZE = 24;
  const pageCount = Math.ceil(schedule.length / PAGE_SIZE);
  const pageRows = schedule.slice(schedPage * PAGE_SIZE, (schedPage + 1) * PAGE_SIZE);

  return (
    <div style={{ padding: "40px 0", borderTop: "1px solid var(--dpf-border)" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)", marginBottom: 24 }}>
        Loan Calculator
      </h2>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>Property / Loan Price ($)</label>
          <input
            type="number" min={0} step={1000}
            value={price}
            onChange={(e) => { setPrice(Number(e.target.value)); setSchedPage(0); }}
            style={inputStyle}
          />
        </div>
        {showDown && (
          <div>
            <label style={labelStyle}>Down Payment ($)</label>
            <input
              type="number" min={0} step={1000}
              value={downPayment}
              onChange={(e) => { setDownPayment(Number(e.target.value)); setSchedPage(0); }}
              style={inputStyle}
            />
          </div>
        )}
        <div>
          <label style={labelStyle}>Annual Interest Rate (%)</label>
          <input
            type="number" min={0.1} max={30} step={0.05}
            value={rate}
            onChange={(e) => { setRate(Number(e.target.value)); setSchedPage(0); }}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Loan Term (years)</label>
          <select
            value={term}
            onChange={(e) => { setTerm(Number(e.target.value)); setSchedPage(0); }}
            style={inputStyle}
          >
            {TERMS.map((t) => <option key={t} value={t}>{t} years</option>)}
          </select>
        </div>
      </div>

      {/* Summary output */}
      {loanAmount > 0 && pmt > 0 ? (
        <div style={{
          background: "var(--dpf-surface, #f9fafb)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: "20px 24px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 16,
        }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 4 }}>Loan Amount</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)" }}>{fmt(loanAmount)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 4 }}>Monthly Payment</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-accent, #4f46e5)" }}>{fmt(pmt)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 4 }}>Total Interest</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)" }}>{fmt(totalInterest)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 4 }}>Total Repaid</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--dpf-text)" }}>{fmt(totalPaid)}</div>
          </div>
        </div>
      ) : (
        <p style={{ color: "var(--dpf-muted)", fontSize: 14, marginBottom: 16 }}>
          Enter a loan amount to see your estimated payment.
        </p>
      )}

      {/* Amortisation schedule toggle */}
      {loanAmount > 0 && pmt > 0 && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => { setShowSchedule(!showSchedule); setSchedPage(0); }}
            style={{
              fontSize: 13, color: "var(--dpf-accent, #4f46e5)", background: "none",
              border: "none", cursor: "pointer", padding: 0, textDecoration: "underline",
            }}
          >
            {showSchedule ? "Hide" : "Show"} full payment schedule ({term * 12} months)
          </button>

          {showSchedule && (
            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--dpf-border)" }}>
                    {["Month", "Payment", "Principal", "Interest", "Balance"].map((h) => (
                      <th key={h} style={{ textAlign: "right", padding: "4px 8px", color: "var(--dpf-muted)", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.month} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "var(--dpf-muted)" }}>{row.month}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(row.payment)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(row.principal)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(row.interest)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right" }}>{fmt(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pageCount > 1 && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                  <button type="button" disabled={schedPage === 0}
                    onClick={() => setSchedPage(schedPage - 1)}
                    style={{ fontSize: 12, padding: "4px 10px", cursor: schedPage === 0 ? "default" : "pointer" }}>
                    ← Prev
                  </button>
                  <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>
                    Months {schedPage * PAGE_SIZE + 1}–{Math.min((schedPage + 1) * PAGE_SIZE, schedule.length)} of {schedule.length}
                  </span>
                  <button type="button" disabled={schedPage >= pageCount - 1}
                    onClick={() => setSchedPage(schedPage + 1)}
                    style={{ fontSize: 12, padding: "4px 10px", cursor: schedPage >= pageCount - 1 ? "default" : "pointer" }}>
                    Next →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Compliance disclaimer */}
      <p style={{ fontSize: 11, color: "var(--dpf-muted)", lineHeight: 1.6, marginTop: 8 }}>
        {disclaimer}
      </p>
    </div>
  );
}
