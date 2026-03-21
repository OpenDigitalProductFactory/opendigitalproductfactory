import nodemailer from "nodemailer";

type EmailOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
};

type InvoiceEmailParams = {
  to: string;
  invoiceRef: string;
  accountName: string;
  totalAmount: string;
  currency: string;
  dueDate: string;
  payUrl: string;
};

export function composeInvoiceEmail(params: InvoiceEmailParams) {
  const { to, invoiceRef, accountName, totalAmount, currency, dueDate, payUrl } = params;

  const subject = `Invoice ${invoiceRef} from your provider`;

  const text = [
    `Invoice ${invoiceRef}`,
    `Amount: ${currency} ${totalAmount}`,
    `Due: ${dueDate}`,
    ``,
    `Pay online: ${payUrl}`,
    ``,
    `Thank you for your business.`,
  ].join("\n");

  // Professional HTML email with large Pay Now button (Decision 1.2: Pay Now is the hero)
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:white;border-radius:8px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="margin:0 0 8px;font-size:24px;color:#111;">Invoice ${invoiceRef}</h1>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">For ${accountName}</p>

      <div style="background:#f3f4f6;border-radius:8px;padding:20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="color:#6b7280;font-size:14px;">Amount Due</span>
          <span style="font-size:24px;font-weight:700;color:#111;">${currency} ${totalAmount}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#6b7280;font-size:14px;">Due Date</span>
          <span style="font-size:14px;color:#111;">${dueDate}</span>
        </div>
      </div>

      <div style="text-align:center;margin-bottom:24px;">
        <a href="${payUrl}" style="display:inline-block;background:#22c55e;color:white;font-size:18px;font-weight:600;padding:16px 48px;border-radius:8px;text-decoration:none;">Pay Now</a>
      </div>

      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        A PDF copy of this invoice is attached to this email.
      </p>
    </div>
  </div>
</body>
</html>`;

  return { to, subject, text, html };
}

type ApprovalEmailParams = {
  to: string;
  billRef: string;
  supplierName: string;
  totalAmount: string;
  currency: string;
  approveUrl: string;
};

export function composeApprovalEmail(params: ApprovalEmailParams) {
  const { to, billRef, supplierName, totalAmount, currency, approveUrl } = params;

  const subject = `Bill ${billRef} from ${supplierName} needs your approval`;

  const text = [
    `Bill Approval Required`,
    ``,
    `Bill: ${billRef}`,
    `Supplier: ${supplierName}`,
    `Amount: ${currency} ${totalAmount}`,
    ``,
    `Review and respond: ${approveUrl}`,
    ``,
    `Please approve or reject this bill at the link above.`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:white;border-radius:8px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="margin:0 0 8px;font-size:24px;color:#111;">Bill Approval Required</h1>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">From supplier: ${supplierName}</p>

      <div style="background:#f3f4f6;border-radius:8px;padding:20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="color:#6b7280;font-size:14px;">Bill Reference</span>
          <span style="font-size:16px;font-weight:600;color:#111;">${billRef}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#6b7280;font-size:14px;">Total Amount</span>
          <span style="font-size:24px;font-weight:700;color:#111;">${currency} ${totalAmount}</span>
        </div>
      </div>

      <div style="text-align:center;margin-bottom:16px;">
        <a href="${approveUrl}?response=approve" style="display:inline-block;background:#22c55e;color:white;font-size:16px;font-weight:600;padding:14px 36px;border-radius:8px;text-decoration:none;margin-right:12px;">Approve</a>
        <a href="${approveUrl}?response=reject" style="display:inline-block;background:#ef4444;color:white;font-size:16px;font-weight:600;padding:14px 36px;border-radius:8px;text-decoration:none;">Reject</a>
      </div>

      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
        You are receiving this because you are an approver for bills of this amount.
      </p>
    </div>
  </div>
</body>
</html>`;

  return { to, subject, text, html };
}

export async function sendEmail(options: EmailOptions): Promise<{ messageId: string }> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || "noreply@example.com";

  // In dev without SMTP config, log to console
  if (!host) {
    console.log("[email] No SMTP configured. Would send:", {
      to: options.to,
      subject: options.subject,
      attachments: options.attachments?.map((a) => a.filename),
    });
    return { messageId: `dev-${Date.now()}` };
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });

  const result = await transport.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments: options.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });

  return { messageId: result.messageId };
}
