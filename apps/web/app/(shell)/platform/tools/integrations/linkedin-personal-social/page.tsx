import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readLinkedInConnectionState } from "@/lib/marketing/channels/linkedin-personal-social/oauth";
import { LinkedInConnectPanel } from "@/components/integrations/LinkedInConnectPanel";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function LinkedInPersonalSocialIntegrationPage({
  searchParams,
}: {
  searchParams: Search;
}) {
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

  const params = await searchParams;
  const flashOk = params["oauth"] === "success";
  const flashError = params["oauth"] === "error" ? String(params["reason"] ?? "unknown_error") : null;

  const state = await readLinkedInConnectionState();
  const defaultRedirectUri = computeDefaultRedirectUri();

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
          <span>LinkedIn (personal publishing)</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">
          LinkedIn (personal publishing)
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
          Publish approved marketing drafts to your own LinkedIn feed. You bring your own
          LinkedIn developer app and OAuth credentials; DPF stores the refresh token
          encrypted in this install and never proxies traffic through a DPF-owned account.
        </p>
      </div>

      {flashOk && (
        <div className="rounded-lg border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-3 text-sm text-[var(--dpf-text)]">
          Connected. Your LinkedIn account is ready to receive approved drafts.
        </div>
      )}
      {flashError && (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 text-sm text-[var(--dpf-text)]">
          OAuth failed: <span className="font-medium">{flashError}</span>. Re-check the
          client id, client secret, and redirect URI in the LinkedIn developer console,
          then try again.
        </div>
      )}

      <LinkedInConnectPanel initialState={state} defaultRedirectUri={defaultRedirectUri} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>
            Publishes an <span className="font-medium text-[var(--dpf-text)]">approved</span>{" "}
            LinkedIn draft from the marketing approval queue to your member feed.
          </li>
          <li>
            Scopes requested: <code className="text-[var(--dpf-text)]">openid profile email</code> and{" "}
            <code className="text-[var(--dpf-text)]">w_member_social</code>. No company-page write,
            no ads access, no analytics scope.
          </li>
          <li>
            DPF is a conduit, not a broker — every publish call uses{" "}
            <span className="font-medium text-[var(--dpf-text)]">your</span> LinkedIn
            developer app and{" "}
            <span className="font-medium text-[var(--dpf-text)]">your</span> member token,
            stored encrypted in this install with{" "}
            <code className="text-[var(--dpf-text)]">CREDENTIAL_ENCRYPTION_KEY</code>.
          </li>
        </ul>
      </aside>

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">One-time setup</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>
            Create a LinkedIn developer app at{" "}
            <code className="text-[var(--dpf-text)]">https://www.linkedin.com/developers/apps</code>.
          </li>
          <li>
            Add products: <em>Sign In with LinkedIn using OpenID Connect</em> and{" "}
            <em>Share on LinkedIn</em>.
          </li>
          <li>
            Configure the OAuth redirect URL as the one shown below.
          </li>
          <li>Copy your client id and client secret into the form below.</li>
          <li>Click Connect and complete authorization on LinkedIn.</li>
        </ol>
      </aside>
    </div>
  );
}

function computeDefaultRedirectUri(): string {
  const base = process.env.AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/integrations/linkedin-personal-social/callback`;
}
