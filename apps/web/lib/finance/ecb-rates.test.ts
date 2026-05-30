import { describe, expect, it } from "vitest";
import { deriveCrossRatesFromEcbXml } from "./ecb-rates";

// A trimmed sample of the real ECB daily feed shape.
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
  <Cube>
    <Cube time='2026-05-29'>
      <Cube currency='USD' rate='1.0800'/>
      <Cube currency='JPY' rate='168.50'/>
      <Cube currency='GBP' rate='0.8500'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("deriveCrossRatesFromEcbXml", () => {
  it("derives the full GBP/EUR/USD cross-rate matrix from EUR-base quotes", () => {
    const rates = deriveCrossRatesFromEcbXml(SAMPLE_XML);
    const lookup = (base: string, target: string) =>
      rates.find((r) => r.base === base && r.target === target)?.rate;

    // 6 ordered pairs across {EUR, USD, GBP}
    expect(rates).toHaveLength(6);
    // EUR base comes straight from the feed
    expect(lookup("EUR", "USD")).toBe(1.08);
    expect(lookup("EUR", "GBP")).toBe(0.85);
    // Cross rates: GBP->USD = perEur[USD]/perEur[GBP] = 1.08/0.85
    expect(lookup("GBP", "USD")).toBeCloseTo(1.270588, 5);
    expect(lookup("USD", "GBP")).toBeCloseTo(0.787037, 5);
    // Inverses are consistent
    expect(lookup("USD", "EUR")).toBeCloseTo(1 / 1.08, 5);
    expect(lookup("GBP", "EUR")).toBeCloseTo(1 / 0.85, 5);
  });

  it("throws when a required currency is missing from the feed", () => {
    const missingGbp = `<Cube currency='USD' rate='1.08'/>`;
    expect(() => deriveCrossRatesFromEcbXml(missingGbp)).toThrow(/GBP/);
  });
});
