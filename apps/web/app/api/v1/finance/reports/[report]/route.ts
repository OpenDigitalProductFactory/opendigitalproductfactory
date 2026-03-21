import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import {
  getProfitAndLoss,
  getCashFlowReport,
  getVatSummary,
  getRevenueByCustomer,
  getOutstandingInvoicesReport,
  exportReportToCsv,
} from "@/lib/actions/reports";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  try {
    await authenticateRequest(request);
    const { report } = await params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    const startStr = url.searchParams.get("start");
    const endStr = url.searchParams.get("end");
    const startDate = startStr ? new Date(startStr) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endDate = endStr ? new Date(endStr) : new Date();

    let data: unknown;
    let csvHeaders: string[] = [];
    let csvRows: string[][] = [];

    switch (report) {
      case "profit-loss": {
        const result = await getProfitAndLoss(startDate, endDate);
        data = result;
        csvHeaders = ["Item", "Amount"];
        csvRows = [
          ["Revenue", result.revenue.toFixed(2)],
          ["Cost of Sales", result.costOfSales.toFixed(2)],
          ["Gross Profit", result.grossProfit.toFixed(2)],
          ["Expenses", result.expenses.toFixed(2)],
          ["Net Profit", result.netProfit.toFixed(2)],
        ];
        break;
      }
      case "cash-flow": {
        const result = await getCashFlowReport(startDate, endDate);
        data = result;
        csvHeaders = ["Item", "Amount"];
        csvRows = [
          ["Money In", result.moneyIn.toFixed(2)],
          ["Money Out", result.moneyOut.toFixed(2)],
          ["Net Cash Flow", result.netCashFlow.toFixed(2)],
          ["Closing Balance", result.closingBalance.toFixed(2)],
        ];
        break;
      }
      case "vat-summary": {
        const result = await getVatSummary(startDate, endDate);
        data = result;
        csvHeaders = ["Item", "Amount"];
        csvRows = [
          ["Output VAT (collected)", result.outputVat.toFixed(2)],
          ["Input VAT (paid)", result.inputVat.toFixed(2)],
          ["Net VAT", result.netVat.toFixed(2)],
        ];
        break;
      }
      case "revenue-by-customer": {
        const result = await getRevenueByCustomer(startDate, endDate);
        data = result;
        csvHeaders = ["Customer", "Invoices", "Revenue", "Paid", "Outstanding"];
        csvRows = result.map(r => [r.name, String(r.invoiceCount), r.totalRevenue.toFixed(2), r.totalPaid.toFixed(2), r.totalOutstanding.toFixed(2)]);
        break;
      }
      case "outstanding": {
        const result = await getOutstandingInvoicesReport();
        data = result;
        csvHeaders = ["Invoice", "Customer", "Amount Due", "Due Date", "Days Overdue", "Status"];
        csvRows = result.map(r => [r.invoiceRef, r.accountName, r.amountDue.toFixed(2), r.dueDate.toISOString().split("T")[0]!, String(r.daysOverdue), r.status]);
        break;
      }
      default:
        return NextResponse.json({ code: "NOT_FOUND", message: `Unknown report: ${report}` }, { status: 404 });
    }

    if (format === "csv") {
      const csv = exportReportToCsv(csvHeaders, csvRows);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${report}-${startDate.toISOString().split("T")[0]}-${endDate.toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    return apiSuccess(data);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
