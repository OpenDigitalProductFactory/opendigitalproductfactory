import { describe, expect, it } from "vitest";

import {
  federalWithholdingWorksheet1A,
  type FederalWithholdingTables,
  type W4Election,
} from "./federal-withholding";

// Fixture figures transcribed from IRS Publication 15-T (2026), Annual
// Percentage Method Tables (STANDARD schedules) and Worksheet 1A line 1g. They
// exist to pin the arithmetic; on an install the figures come only from
// person-confirmed PayrollTaxRule rows. Each expected value below is worked by
// hand in the comment beside it, line by line from the worksheet.
const TABLES: FederalWithholdingTables = {
  line1g: { married_jointly: 12_900, other: 8_600 },
  schedules: {
    married_jointly: {
      standard: [
        { over: 0, rate: 0 }, { over: 19_300, rate: 0.1 }, { over: 44_100, rate: 0.12 },
        { over: 120_100, rate: 0.22 }, { over: 230_700, rate: 0.24 }, { over: 422_850, rate: 0.32 },
        { over: 531_750, rate: 0.35 }, { over: 788_000, rate: 0.37 },
      ],
      step2: [{ over: 0, rate: 0 }, { over: 16_100, rate: 0.1 }],
    },
    single: {
      standard: [
        { over: 0, rate: 0 }, { over: 7_500, rate: 0.1 }, { over: 19_900, rate: 0.12 },
        { over: 57_900, rate: 0.22 }, { over: 113_200, rate: 0.24 }, { over: 209_275, rate: 0.32 },
        { over: 263_725, rate: 0.35 }, { over: 648_100, rate: 0.37 },
      ],
      step2: [{ over: 0, rate: 0 }, { over: 3_750, rate: 0.1 }],
    },
    head_of_household: {
      standard: [
        { over: 0, rate: 0 }, { over: 15_550, rate: 0.1 }, { over: 33_250, rate: 0.12 },
        { over: 83_000, rate: 0.22 }, { over: 121_250, rate: 0.24 }, { over: 217_300, rate: 0.32 },
        { over: 271_750, rate: 0.35 }, { over: 656_150, rate: 0.37 },
      ],
      step2: [{ over: 0, rate: 0 }, { over: 7_775, rate: 0.1 }],
    },
  },
};

const plain: W4Election = {
  filingStatus: "single", step2Checked: false, step3Credits: 0,
  step4aOtherIncome: 0, step4bDeductions: 0, step4cExtraWithholding: 0, exempt: false,
};

describe("federalWithholdingWorksheet1A", () => {
  it("single, biweekly $2,000, nothing else on the W-4", () => {
    // 1c 2,000 x 26 = 52,000; 1g 8,600; 1i 43,400.
    // 10% of (19,900 - 7,500) = 1,240; 12% of (43,400 - 19,900) = 2,820; 2g 4,060.
    // 2h 4,060 / 26 = 156.15; no credits, no extra.
    expect(federalWithholdingWorksheet1A({ periodWages: 2_000, periodsPerYear: 26, w4: plain }, TABLES)).toBe(156.15);
  });

  it("married filing jointly, monthly $8,000, $4,000 Step 3 credits, $50 extra", () => {
    // 1c 96,000; 1g 12,900; 1i 83,100.
    // 10% of (44,100 - 19,300) = 2,480; 12% of (83,100 - 44,100) = 4,680; 2g 7,160.
    // 2h 7,160 / 12 = 596.667; 3b 4,000 / 12 = 333.333; 3c 263.333; 4a + 50 = 313.33.
    const w4: W4Election = { ...plain, filingStatus: "married_jointly", step3Credits: 4_000, step4cExtraWithholding: 50 };
    expect(federalWithholdingWorksheet1A({ periodWages: 8_000, periodsPerYear: 12, w4 }, TABLES)).toBe(313.33);
  });

  it("Step 2 checked: no line 1g amount and the Step 2 schedule", () => {
    // Single, weekly $500: 1c 26,000; 1g 0 (box checked); 1i 26,000.
    // Step-2 fixture: 10% of (26,000 - 3,750) = 2,225; 2h 2,225 / 52 = 42.79.
    const w4: W4Election = { ...plain, step2Checked: true };
    expect(federalWithholdingWorksheet1A({ periodWages: 500, periodsPerYear: 52, w4 }, TABLES)).toBe(42.79);
  });

  it("Step 4(a) adds other income and 4(b) subtracts deductions before the table", () => {
    // Head of household, semimonthly $3,000: 1c 72,000; 1d 4(a) 6,000; 1e 78,000;
    // 1f 4(b) 10,000; 1g 8,600; 1h 18,600; 1i 59,400.
    // 10% of (33,250 - 15,550) = 1,770; 12% of (59,400 - 33,250) = 3,138; 2g 4,908.
    // 2h 4,908 / 24 = 204.50.
    const w4: W4Election = { ...plain, filingStatus: "head_of_household", step4aOtherIncome: 6_000, step4bDeductions: 10_000 };
    expect(federalWithholdingWorksheet1A({ periodWages: 3_000, periodsPerYear: 24, w4 }, TABLES)).toBe(204.5);
  });

  it("credits larger than the tentative amount withhold nothing, never a negative", () => {
    // Single biweekly $2,000 tentative 156.15; credits 6,000 / 26 = 230.77 > 156.15 -> 0.
    const w4: W4Election = { ...plain, step3Credits: 6_000 };
    expect(federalWithholdingWorksheet1A({ periodWages: 2_000, periodsPerYear: 26, w4 }, TABLES)).toBe(0);
  });

  it("an adjusted annual wage below line 1g withholds nothing", () => {
    // Single biweekly $300: 1c 7,800; 1i max(7,800 - 8,600, 0) = 0.
    expect(federalWithholdingWorksheet1A({ periodWages: 300, periodsPerYear: 26, w4: plain }, TABLES)).toBe(0);
  });

  it("an exempt W-4 withholds nothing, even with extra withholding entered", () => {
    const w4: W4Election = { ...plain, exempt: true, step4cExtraWithholding: 25 };
    expect(federalWithholdingWorksheet1A({ periodWages: 2_000, periodsPerYear: 26, w4 }, TABLES)).toBe(0);
  });

  it("a top bracket applies above its threshold", () => {
    // Single annual-equivalent: weekly $15,000 -> 1c 780,000; 1i 771,400.
    // 1,240 + 12% x 38,000 (4,560) + 22% x 55,300 (12,166) + 24% x 96,075 (23,058)
    // + 32% x 54,450 (17,424) + 35% x 384,375 (134,531.25) + 37% x 123,300 (45,621)
    // = 238,600.25; / 52 = 4,588.4663 -> 4,588.47.
    expect(federalWithholdingWorksheet1A({ periodWages: 15_000, periodsPerYear: 52, w4: plain }, TABLES)).toBe(4_588.47);
  });
});
