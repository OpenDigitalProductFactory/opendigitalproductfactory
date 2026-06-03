import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readEmailPostmarkConnectionState } from "@/lib/marketing/channels/email-postmark/config";
import { EmailPostmarkConnectPanel } from "@/components/integrations/EmailPostmarkConnectPanel";

export default async function EmailPostmarkIntegrationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    redirect("/platform/tools");
  }

  const state = await readEmailPostmarkConnectionState();
  const defaultInboundWebhookUrl = computeWebhookUrl();

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
          <a href="/platform/tools" className="hover:underline">
            Tools
          </a>
          <span>/</span>
          <span>Enterprise Integrations</span>
          <span>/</span>
          <span>Email (Postmark)</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">Email (Postmark)</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
          Send approved marketing emails through your own Postmark account, and route inbound
          replies through the marketing approval queue. DPF stores the server token + signing
          secret encrypted; you own the Postmark server and the domain reputation.
        </p>
      </div>

      <EmailPostmarkConnectPanel
        initialState={state}
        defaultInboundWebhookUrl={defaultInboundWebhookUrl}
      />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Sends approved <code className="text-[var(--dpf-text)]">email</code> drafts from the marketing approval queue.</li>
          <li>Accepts inbound replies via Postmark's inbound webhook with HMAC-SHA256 signature verification.</li>
          <li>Classifies each inbound message as qualified-inquiry / support / spam / other.</li>
          <li>Drafts a holding-pattern reply for qualified inquiries and routes it back through the approval queue.</li>
          <li>Links qualified inquiries to the CRM Engagement model for sales follow-up.</li>
        </ul>
      </aside>

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">One-time setup</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Create a Postmark account at <code className="text-[var(--dpf-text)]">https://postmarkapp.com</code> (sandbox is fine for verification).</li>
          <li>Create a Server, copy the <em>Server API Token</em> from the API Tokens tab.</li>
          <li>Verify a sender signature for your From address (Sender Signatures → Add Domain).</li>
          <li>Configure the Inbound webhook URL under your Server's Inbound stream:
            <code className="ml-1 text-[var(--dpf-text)]">{defaultInboundWebhookUrl}</code>.</li>
          <li>Copy the Inbound webhook signing secret (Server → Inbound → Webhook signing secret).</li>
          <li>Paste server token, signing secret, and From address into the form above.</li>
        </ol>
      </aside>
    </div>
  );
}

function computeWebhookUrl(): string {
  const base = process.env.AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/integrations/email-postmark/inbound`;
}
