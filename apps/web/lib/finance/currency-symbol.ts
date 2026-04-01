// Shared currency symbol lookup — used by all finance UI pages.
// Import { getCurrencySymbol } and call with the org's baseCurrency.

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", CAD: "C$", AUD: "A$", NZD: "NZ$",
  CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr", JPY: "¥", SGD: "S$",
  HKD: "HK$", ZAR: "R", AED: "AED", INR: "₹", BRL: "R$", MXN: "MX$",
  PLN: "zł", CZK: "Kč",
};

export function getCurrencySymbol(currencyCode: string): string {
  return CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;
}
