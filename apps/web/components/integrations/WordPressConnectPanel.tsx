"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  checkWordPressConnectionAction,
  connectWordPressAction,
  disconnectWordPressAction,
  setWordPressPublicationPolicyAction,
} from "@/app/(shell)/platform/tools/integrations/wordpress/actions";
import { confirmDialog } from "@/components/ui/Dialog";
import { LocalTime } from "@/components/ui/LocalTime";
import {
  CheckboxField,
  ConsequenceNotice,
  FormStatus,
  SubmitButton,
  TextField,
} from "@/components/ui/form";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import type { ConnectorSetupStatus } from "@/lib/integrations/kernel/setup-state";

export interface WordPressConnectionViewState {
  status: ConnectorSetupStatus;
  siteUrl: string | null;
  username: string | null;
  siteName: string | null;
  origin: string | null;
  supportedResourceKinds: string[];
  supportedTaxonomies: string[];
  unsupportedResourceTypes: string[];
  canCreateDrafts: boolean;
  canPublishLive: boolean;
  canUploadMedia: boolean;
  publicPublicationEnabled: boolean;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
}

type SettledStatus = { error: string | null; success: string | null };

export function WordPressConnectPanel({ initialState }: { initialState: WordPressConnectionViewState }) {
  const router = useRouter();
  const connected = initialState.status === "connected" || initialState.status === "degraded";
  const [pending, startTransition] = useTransition();
  const [settled, setSettled] = useState<SettledStatus>({ error: null, success: null });
  const [siteUrl, setSiteUrl] = useState(initialState.siteUrl ?? "");
  const [username, setUsername] = useState(initialState.username ?? "");
  const [applicationPassword, setApplicationPassword] = useState("");
  const [publicPublicationEnabled, setPublicPublicationEnabled] = useState(initialState.publicPublicationEnabled);
  const [policyConsequenceConfirmed, setPolicyConsequenceConfirmed] = useState(false);

  function submitConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettled({ error: null, success: null });
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await connectWordPressAction(data);
      if (!result.ok) {
        setSettled({ error: result.error, success: null });
        return;
      }
      setApplicationPassword("");
      setSettled({ error: null, success: `Connected to ${result.siteName}.` });
      router.refresh();
    });
  }

  function checkConnection() {
    setSettled({ error: null, success: null });
    startTransition(async () => {
      const result = await checkWordPressConnectionAction();
      if (!result.ok) {
        setSettled({ error: result.error, success: null });
        return;
      }
      setSettled({ error: null, success: `Connection healthy for ${result.siteName}.` });
      router.refresh();
    });
  }

  async function disconnect() {
    const confirmed = await confirmDialog({
      title: "Disconnect WordPress",
      message: "Disconnect WordPress? Scheduled sync and publishing will stop. Existing WordPress content stays in WordPress.",
      tone: "danger",
      confirmLabel: "Disconnect WordPress",
    });
    if (!confirmed) return;
    setSettled({ error: null, success: null });
    startTransition(async () => {
      const result = await disconnectWordPressAction();
      if (!result.ok) {
        setSettled({ error: result.error, success: null });
        return;
      }
      setSettled({ error: null, success: result.revocationInstructions });
      router.refresh();
    });
  }

  function savePublicationPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettled({ error: null, success: null });
    startTransition(async () => {
      const result = await setWordPressPublicationPolicyAction({
        enabled: publicPublicationEnabled,
        consequenceConfirmed: policyConsequenceConfirmed,
      });
      if (!result.ok) {
        setSettled({ error: result.error, success: null });
        return;
      }
      setPolicyConsequenceConfirmed(false);
      setSettled({
        error: null,
        success: result.publicPublicationEnabled
          ? "Approved content may now be made public after per-item confirmation."
          : "WordPress publication remains draft-only.",
      });
      router.refresh();
    });
  }

  if (!connected) {
    return (
      <section data-dpf-lead className="rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-lg shadow-dpf-sm">
        <div className="flex flex-col gap-dpf-sm sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-dpf-title font-dpf-semibold text-dpf-text">Connect your WordPress site</h2>
            <p className="mt-dpf-xs max-w-2xl text-dpf-body text-dpf-muted">
              Use a dedicated WordPress Application Password. DPF connects over HTTPS. This install needs no public URL.
            </p>
          </div>
          <StatusBadge
            intent={initialState.status === "error" ? "danger" : "neutral"}
            label={initialState.status === "error" ? "Needs attention" : "Not connected"}
          />
        </div>
        {initialState.lastErrorMsg ? (
          <div className="mt-dpf-md"><Notice variant="error" title="Connection needs attention">{initialState.lastErrorMsg}</Notice></div>
        ) : null}
        <ConnectionForm
          siteUrl={siteUrl}
          username={username}
          applicationPassword={applicationPassword}
          onSiteUrlChange={setSiteUrl}
          onUsernameChange={setUsername}
          onApplicationPasswordChange={setApplicationPassword}
          onSubmit={submitConnection}
          pending={pending}
          primary
          submitLabel="Connect WordPress"
        />
        <FormStatus error={settled.error} success={settled.success} className="mt-dpf-sm" />
      </section>
    );
  }

  const hostname = hostnameFrom(initialState.origin ?? initialState.siteUrl);
  return (
    <section data-dpf-lead className="rounded-dpf-lg border border-dpf-border bg-dpf-surface-1 p-dpf-lg shadow-dpf-sm">
      <div className="flex flex-col gap-dpf-md lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-dpf-sm">
            <h2 className="text-dpf-title font-dpf-semibold text-dpf-text">{initialState.siteName ?? "WordPress site"}</h2>
            <StatusBadge
              intent={initialState.status === "degraded" ? "warning" : "success"}
              label={initialState.status === "degraded" ? "Needs attention" : "Connected"}
            />
          </div>
          <p className="mt-dpf-xs text-dpf-body text-dpf-muted">{hostname}</p>
          <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">
            Last checked{" "}
            {initialState.lastTestedAt ? (
              <LocalTime value={initialState.lastTestedAt} options={{ year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} />
            ) : "not yet"}
          </p>
        </div>
        <SubmitButton
          type="button"
          pending={pending}
          pendingLabel="Checking connection…"
          onClick={checkConnection}
          data-dpf-primary-action="true"
          data-owner-first-next-action="true"
        >
          Check connection
        </SubmitButton>
      </div>

      <div className="mt-dpf-md grid gap-dpf-sm md:grid-cols-2">
        <div className="rounded-dpf-md border border-dpf-border bg-dpf-surface-2 p-dpf-md">
          <h3 className="text-dpf-body font-dpf-semibold text-dpf-text">{summarizeCapabilities(initialState)}</h3>
          <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">
            {initialState.canCreateDrafts
              ? "Approved DPF content can create or update the same WordPress draft."
              : "This WordPress user cannot create drafts; update its role or reconnect with another user."}
          </p>
        </div>
        <div className="rounded-dpf-md border border-dpf-border bg-dpf-surface-2 p-dpf-md">
          <h3 className="text-dpf-body font-dpf-semibold text-dpf-text">Create WordPress drafts by default</h3>
          <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">
            DPF owns approved content and audit. WordPress owns themes, layout, permalinks, hosting, and public delivery.
          </p>
        </div>
      </div>

      {initialState.lastErrorMsg ? (
        <div className="mt-dpf-md"><Notice variant="warn" title="Last check needs attention">{initialState.lastErrorMsg}</Notice></div>
      ) : null}
      <FormStatus error={settled.error} success={settled.success} className="mt-dpf-sm" />

      <details className="mt-dpf-md rounded-dpf-md border border-dpf-border bg-dpf-surface-2 p-dpf-md">
        <summary className="cursor-pointer text-dpf-body font-dpf-medium text-dpf-text">Connection settings and advanced policy</summary>
        <div className="mt-dpf-md space-y-dpf-lg">
          <div>
            <h3 className="text-dpf-body font-dpf-semibold text-dpf-text">Replace connection settings</h3>
            <ConnectionForm
              siteUrl={siteUrl}
              username={username}
              applicationPassword={applicationPassword}
              onSiteUrlChange={setSiteUrl}
              onUsernameChange={setUsername}
              onApplicationPasswordChange={setApplicationPassword}
              onSubmit={submitConnection}
              pending={pending}
              submitLabel="Replace connection"
            />
          </div>
          {initialState.canPublishLive ? (
            <form onSubmit={savePublicationPolicy} className="space-y-dpf-sm">
              <h3 className="text-dpf-body font-dpf-semibold text-dpf-text">Public publication policy</h3>
              <CheckboxField
                name="publicPublicationEnabled"
                label="Allow approved items to become public after a separate per-item confirmation"
                checked={publicPublicationEnabled}
                onCheckedChange={setPublicPublicationEnabled}
              />
              {publicPublicationEnabled ? (
                <>
                  <ConsequenceNotice
                    summary="This widens the connection from draft-only to public-capable."
                    what="A separately confirmed approved item may be published publicly on the connected WordPress site."
                    who="Visitors to the customer-owned WordPress site may see the content."
                    reversibility="Turn this policy off to return to draft-only. Existing public content remains in WordPress."
                    recovery="Edit, unpublish, or remove the content in WordPress, then review the DPF publication receipt."
                  />
                  <CheckboxField
                    name="policyConsequenceConfirmed"
                    label="I understand this permits public publication after per-item confirmation"
                    checked={policyConsequenceConfirmed}
                    onCheckedChange={setPolicyConsequenceConfirmed}
                  />
                </>
              ) : null}
              <SubmitButton pending={pending} pendingLabel="Saving policy…">Save publication policy</SubmitButton>
            </form>
          ) : null}
          {initialState.unsupportedResourceTypes.length > 0 ? (
            <div>
              <h3 className="text-dpf-body font-dpf-semibold text-dpf-text">Discovered but not managed</h3>
              <p className="mt-dpf-xs text-dpf-caption text-dpf-muted">
                {initialState.unsupportedResourceTypes.join(", ")}. DPF can report these types but does not publish or import them as business truth.
              </p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={disconnect}
            disabled={pending}
            className="dpf-tap-target rounded-dpf-md border border-dpf-border bg-dpf-surface-1 px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-dpf-text hover:border-dpf-accent disabled:opacity-50"
          >
            Disconnect WordPress
          </button>
        </div>
      </details>
    </section>
  );
}

function ConnectionForm({
  siteUrl, username, applicationPassword, onSiteUrlChange, onUsernameChange,
  onApplicationPasswordChange, onSubmit, pending, primary = false,
  submitLabel = "Connect WordPress",
}: {
  siteUrl: string;
  username: string;
  applicationPassword: string;
  onSiteUrlChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onApplicationPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  primary?: boolean;
  submitLabel?: string;
}) {
  return (
    <form onSubmit={onSubmit} className="mt-dpf-md space-y-dpf-md">
      <TextField name="siteUrl" label="WordPress site URL" type="url" value={siteUrl} onValueChange={onSiteUrlChange} autoComplete="url" required placeholder="https://www.example.org" hint="HTTPS address of the WordPress site." />
      <TextField name="username" label="WordPress username" value={username} onValueChange={onUsernameChange} autoComplete="username" required hint="Use a dedicated user. Give it only the access this connection needs." />
      <TextField name="applicationPassword" label="Application Password" type="password" value={applicationPassword} onValueChange={onApplicationPasswordChange} autoComplete="new-password" required hint="Create it in WordPress. Go to Users > Profile > Application Passwords. DPF never shows it again." />
      <SubmitButton
        pending={pending}
        pendingLabel="Checking connection…"
        {...(primary ? { "data-dpf-primary-action": "true", "data-owner-first-next-action": "true" } : {})}
      >
        {submitLabel}
      </SubmitButton>
    </form>
  );
}

function hostnameFrom(value: string | null): string {
  if (!value) return "Site address unavailable";
  try { return new URL(value).hostname; } catch { return "Site address unavailable"; }
}

function summarizeCapabilities(state: WordPressConnectionViewState): string {
  const supported = new Set(state.supportedResourceKinds);
  if (supported.has("post") && supported.has("page") && supported.has("media")) return "Posts, pages, and media";
  const labels = [supported.has("post") ? "Posts" : null, supported.has("page") ? "pages" : null, supported.has("media") ? "media" : null].filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "Read-only discovery";
}
