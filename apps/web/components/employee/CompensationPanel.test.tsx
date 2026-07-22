// @vitest-environment jsdom
//
// Route-level accessible-submit-contract coverage for /employee HR/pay
// (renders <CompensationPanel />). BI-8E74C749.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EmployeeCompensationRow } from "@/lib/hr/compensation-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/workforce", () => ({ setEmployeeCompensation: vi.fn() }));

import { CompensationPanel } from "./CompensationPanel";

const employees: EmployeeCompensationRow[] = [
  {
    employeeProfileId: "ep-1",
    displayName: "Dana Rivera",
    employeeId: "E-1",
    payType: "hourly",
    hourlyRate: 25,
    annualSalary: null,
    standardAnnualHours: null,
  },
];

afterEach(() => cleanup());

describe("CompensationPanel accessible contract", () => {
  it("labels the employee picker and the pay-type choice", () => {
    render(<CompensationPanel employees={employees} currency="GBP" />);
    expect(screen.getByLabelText(/employee/i)).toBeInTheDocument();
    // Pay-type radios live in a labelled fieldset.
    expect(screen.getByRole("group", { name: /how is this person paid/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/paid hourly/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/salaried/i)).toBeInTheDocument();
  });

  it("labels the hourly rate field and marks it required", () => {
    render(<CompensationPanel employees={employees} currency="GBP" />);
    const rate = screen.getByLabelText(/hourly pay rate/i);
    expect(rate).toHaveAttribute("name", "hourly-rate");
    expect(rate).toHaveAttribute("type", "number");
    expect(rate).toBeRequired();
  });

  it("swaps to the salary field with an optional advanced hours control", () => {
    render(<CompensationPanel employees={employees} currency="GBP" />);
    fireEvent.click(screen.getByLabelText(/salaried/i));
    const salary = screen.getByLabelText(/annual salary/i);
    expect(salary).toBeRequired();
    // Standard hours is an optional field disclosed under "Advanced".
    expect(screen.getByLabelText(/standard hours per year/i)).not.toBeRequired();
  });

  it("renders the save action", () => {
    render(<CompensationPanel employees={employees} currency="GBP" />);
    expect(screen.getByRole("button", { name: /save pay/i })).toBeInTheDocument();
  });
});
