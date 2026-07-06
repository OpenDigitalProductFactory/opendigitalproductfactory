// apps/web/app/(storefront)/s/quote/[token]/page.tsx
// PUBLIC — no auth; possession of the accept token authorizes viewing/accepting,
// mirroring the invoice payment portal at /s/pay/[token].

import { notFound } from "next/navigation";
import { getQuoteByAcceptToken } from "@/lib/actions/quote-accept-public";
import { AcceptQuoteForm } from "@/components/customer/AcceptQuoteForm";

type Props = { params: Promise<{ token: string }> };

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;
  const quote = await getQuoteByAcceptToken(token);
  if (!quote) notFound();

  const total = Number(quote.totalAmount);
  const accepted = quote.status === "accepted";
  const expired =
    !accepted && quote.validUntil != null && quote.validUntil.getTime() < Date.now();
  const money = (n: number) =>
    `${quote.currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="rounded-xl bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-2xl font-bold text-gray-900">{quote.quoteNumber}</h1>
          <p className="mb-6 text-sm text-gray-500">
            Quote for {quote.account.name}
            {quote.opportunity ? ` — ${quote.opportunity.title}` : ""}
          </p>

          <table className="mb-6 w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-gray-100 text-gray-700">
                  <td className="py-2">{li.description}</td>
                  <td className="py-2 text-right">{Number(li.quantity)}</td>
                  <td className="py-2 text-right">{money(Number(li.unitPrice))}</td>
                  <td className="py-2 text-right">{money(Number(li.lineTotal))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mb-6 flex items-center justify-between rounded-lg bg-gray-100 px-5 py-4">
            <span className="text-sm font-medium text-gray-600">Total</span>
            <span className="text-xl font-bold text-gray-900">{money(total)}</span>
          </div>

          {accepted ? (
            <div className="rounded-lg bg-green-50 px-5 py-4 text-sm font-medium text-green-700">
              This quote has been accepted{quote.salesOrder ? ` — order ${quote.salesOrder.orderRef} confirmed` : ""}. Thank you!
            </div>
          ) : expired ? (
            <div className="rounded-lg bg-amber-50 px-5 py-4 text-sm font-medium text-amber-700">
              This quote has expired. Please contact us for a refreshed quote.
            </div>
          ) : (
            <AcceptQuoteForm token={token} />
          )}

          {quote.validUntil && !accepted && !expired && (
            <p className="mt-4 text-xs text-gray-400">
              Valid until {quote.validUntil.toLocaleDateString("en-GB")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
