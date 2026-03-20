import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

export type InvoiceForPdf = {
  invoiceRef: string;
  type: string;
  status: string;
  issueDate: Date | string;
  dueDate: Date | string;
  currency: string;
  subtotal: number | { toString(): string };
  taxAmount: number | { toString(): string };
  discountAmount: number | { toString(): string };
  totalAmount: number | { toString(): string };
  amountPaid: number | { toString(): string };
  amountDue: number | { toString(): string };
  paymentTerms: string | null;
  notes: string | null;
  account: { name: string };
  contact: { firstName: string | null; lastName: string | null; email: string } | null;
  lineItems: Array<{
    description: string;
    quantity: number | { toString(): string };
    unitPrice: number | { toString(): string };
    taxRate: number | { toString(): string };
    taxAmount: number | { toString(): string };
    lineTotal: number | { toString(): string };
    sortOrder: number;
  }>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(value: number | { toString(): string }): string {
  const n = typeof value === "number" ? value : parseFloat(value.toString());
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function fmtDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function toNum(value: number | { toString(): string }): number {
  return typeof value === "number" ? value : parseFloat(value.toString()) || 0;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 48,
    color: "#111",
  },
  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: "#111",
  },
  headerMeta: {
    alignItems: "flex-end",
  },
  headerMetaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  headerMetaLabel: {
    fontFamily: "Helvetica-Bold",
    marginRight: 4,
    minWidth: 60,
    textAlign: "right",
  },
  headerMetaValue: {
    minWidth: 80,
    textAlign: "right",
  },
  // Bill To
  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    letterSpacing: 1,
    color: "#555",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  billToBlock: {
    marginBottom: 24,
  },
  billToName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 2,
  },
  billToLine: {
    color: "#444",
    marginBottom: 1,
  },
  // Divider
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    marginBottom: 12,
  },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  colDescription: { flex: 4 },
  colQty: { flex: 1, textAlign: "right" },
  colUnitPrice: { flex: 2, textAlign: "right" },
  colTax: { flex: 1, textAlign: "right" },
  colTotal: { flex: 2, textAlign: "right" },
  tableHeaderText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#555",
    letterSpacing: 0.5,
  },
  // Totals
  totalsBlock: {
    marginTop: 16,
    alignItems: "flex-end",
  },
  totalsRow: {
    flexDirection: "row",
    marginBottom: 4,
    minWidth: 200,
    justifyContent: "flex-end",
  },
  totalsLabel: {
    minWidth: 100,
    textAlign: "right",
    marginRight: 12,
    color: "#444",
  },
  totalsValue: {
    minWidth: 70,
    textAlign: "right",
  },
  totalsDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#bbb",
    marginBottom: 4,
    minWidth: 200,
  },
  amountDueRow: {
    flexDirection: "row",
    marginTop: 4,
    minWidth: 200,
    justifyContent: "flex-end",
  },
  amountDueLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    minWidth: 100,
    textAlign: "right",
    marginRight: 12,
  },
  amountDueValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    minWidth: 70,
    textAlign: "right",
  },
  // Footer
  footer: {
    marginTop: 32,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    paddingTop: 12,
  },
  footerLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#555",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  footerText: {
    color: "#444",
    marginBottom: 8,
  },
});

// ─── Document Component ───────────────────────────────────────────────────────

function InvoiceDocument({ invoice }: { invoice: InvoiceForPdf }) {
  const contactName =
    invoice.contact
      ? [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(" ")
      : null;

  const taxNum = toNum(invoice.taxAmount);
  const sortedItems = [...invoice.lineItems].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>INVOICE</Text>
          <View style={styles.headerMeta}>
            <View style={styles.headerMetaRow}>
              <Text style={styles.headerMetaLabel}>Ref:</Text>
              <Text style={styles.headerMetaValue}>{invoice.invoiceRef}</Text>
            </View>
            <View style={styles.headerMetaRow}>
              <Text style={styles.headerMetaLabel}>Issued:</Text>
              <Text style={styles.headerMetaValue}>{fmtDate(invoice.issueDate)}</Text>
            </View>
            <View style={styles.headerMetaRow}>
              <Text style={styles.headerMetaLabel}>Due:</Text>
              <Text style={styles.headerMetaValue}>{fmtDate(invoice.dueDate)}</Text>
            </View>
          </View>
        </View>

        {/* Bill To */}
        <View style={styles.billToBlock}>
          <Text style={styles.sectionLabel}>Bill To</Text>
          <Text style={styles.billToName}>{invoice.account.name}</Text>
          {contactName ? <Text style={styles.billToLine}>{contactName}</Text> : null}
          {invoice.contact?.email ? (
            <Text style={styles.billToLine}>{invoice.contact.email}</Text>
          ) : null}
        </View>

        <View style={styles.divider} />

        {/* Line Items Table */}
        <View style={styles.tableHeader}>
          <Text style={[styles.colDescription, styles.tableHeaderText]}>DESCRIPTION</Text>
          <Text style={[styles.colQty, styles.tableHeaderText]}>QTY</Text>
          <Text style={[styles.colUnitPrice, styles.tableHeaderText]}>UNIT PRICE</Text>
          <Text style={[styles.colTax, styles.tableHeaderText]}>TAX %</Text>
          <Text style={[styles.colTotal, styles.tableHeaderText]}>TOTAL</Text>
        </View>

        {sortedItems.map((item, idx) => (
          <View key={idx} style={styles.tableRow}>
            <Text style={styles.colDescription}>{item.description}</Text>
            <Text style={styles.colQty}>{item.quantity.toString()}</Text>
            <Text style={styles.colUnitPrice}>
              {invoice.currency} {fmt(item.unitPrice)}
            </Text>
            <Text style={styles.colTax}>{item.taxRate.toString()}%</Text>
            <Text style={styles.colTotal}>
              {invoice.currency} {fmt(item.lineTotal)}
            </Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>
              {invoice.currency} {fmt(invoice.subtotal)}
            </Text>
          </View>

          {taxNum > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Tax</Text>
              <Text style={styles.totalsValue}>
                {invoice.currency} {fmt(invoice.taxAmount)}
              </Text>
            </View>
          ) : null}

          {toNum(invoice.discountAmount) > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Discount</Text>
              <Text style={styles.totalsValue}>
                -{invoice.currency} {fmt(invoice.discountAmount)}
              </Text>
            </View>
          ) : null}

          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total</Text>
            <Text style={styles.totalsValue}>
              {invoice.currency} {fmt(invoice.totalAmount)}
            </Text>
          </View>

          {toNum(invoice.amountPaid) > 0 ? (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Amount Paid</Text>
              <Text style={styles.totalsValue}>
                -{invoice.currency} {fmt(invoice.amountPaid)}
              </Text>
            </View>
          ) : null}

          <View style={styles.totalsDivider} />

          <View style={styles.amountDueRow}>
            <Text style={styles.amountDueLabel}>Amount Due</Text>
            <Text style={styles.amountDueValue}>
              {invoice.currency} {fmt(invoice.amountDue)}
            </Text>
          </View>
        </View>

        {/* Footer: Payment Terms + Notes */}
        {(invoice.paymentTerms || invoice.notes) ? (
          <View style={styles.footer}>
            {invoice.paymentTerms ? (
              <>
                <Text style={styles.footerLabel}>PAYMENT TERMS</Text>
                <Text style={styles.footerText}>{invoice.paymentTerms}</Text>
              </>
            ) : null}
            {invoice.notes ? (
              <>
                <Text style={styles.footerLabel}>NOTES</Text>
                <Text style={styles.footerText}>{invoice.notes}</Text>
              </>
            ) : null}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export async function generateInvoicePdf(invoice: InvoiceForPdf): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument invoice={invoice} />);
}

export function getInvoicePdfFilename(invoiceRef: string, accountName: string): string {
  const cleanName = accountName.replace(/[^a-zA-Z0-9]/g, "");
  return `Invoice-${invoiceRef}-${cleanName}.pdf`;
}
