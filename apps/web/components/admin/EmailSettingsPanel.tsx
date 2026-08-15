"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveEmailConfig,
  sendTestEmail,
  suggestEmailProvider,
} from "@/lib/actions/email-config";
import type { EmailProviderSuggestion } from "@/lib/shared/email-config-core";

type Props = {
  status: {
    configured: boolean;
    host: string | null;
    port: number;
    user: string | null;
    from: string | null;
    secure: boolean;
    passConfigured: boolean;
    source: "db" | "env" | "relay" | "none";
  };
};

const inputCls =
  "w-full px-3 py-2 text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]";
const labelCls = "block text-xs text-[var(--dpf-muted)] mb-1";

export function EmailSettingsPanel({ status }: Props) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [detecting, startDetect] = useTransition();
  const [host, setHost] = useState(status.host ?? "");
  const [port, setPort] = useState(String(status.port || 587));
  const [user, setUser] = useState(status.user ?? "");
  const [from, setFrom] = useState(status.from ?? "");
  const [secure, setSecure] = useState(status.secure);
  const [pass, setPass] = useState("");
  const [testTo, setTestTo] = useState("");
  const [hint, setHint] = useState<EmailProviderSuggestion | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Structured detail from a failed test-send (response code, raw SMTP message,
  // remediation link) — rendered inline so an operator can self-diagnose.
  const [testError, setTestError] = useState<{
    responseCode?: number;
    command?: string;
    serverResponse?: string;
    remediationUrl?: string;
  } | null>(null);

  // AI-assisted setup: detect the operator's own provider from the org domain
  // and pre-fill host/port/secure so they only have to paste one credential.
  const detect = () => {
    setMsg(null);
    setTestError(null);
    startDetect(async () => {
      try {
        const s = await suggestEmailProvider();
        setHint(s);
        if (s.found && s.preset) {
          setHost(s.preset.host);
          setPort(String(s.preset.port));
          setSecure(s.preset.secure);
          setMsg({
            kind: "ok",
            text: `Detected ${s.preset.label}${s.domain ? ` for ${s.domain}` : ""}. Host filled in — add your username + password below.`,
          });
        } else {
          setMsg({
            kind: "err",
            text: s.domain
              ? `Couldn't match a known provider for ${s.domain}. Enter your SMTP settings below, or check your email provider's docs.`
              : "No organization domain on file to detect from. Enter your SMTP settings below.",
          });
        }
      } catch (e) {
        setMsg({ kind: "err", text: e instanceof Error ? e.message : "Detection failed." });
      }
    });
  };

  const save = () => {
    setMsg(null);
    setTestError(null);
    startSave(async () => {
      try {
        await saveEmailConfig({
          host: host.trim(),
          port: Number.parseInt(port, 10) || 587,
          user: user.trim(),
          from: from.trim(),
          secure,
          ...(pass ? { pass } : {}),
        });
        setPass("");
        setMsg({ kind: "ok", text: "Email settings saved." });
        router.refresh();
      } catch (e) {
        setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to save." });
      }
    });
  };

  const test = () => {
    setMsg(null);
    setTestError(null);
    startTest(async () => {
      try {
        const result = await sendTestEmail(testTo.trim());
        if (result.ok) {
          setMsg({ kind: "ok", text: `Test email sent to ${testTo.trim()}.` });
        } else {
          // The action returns SMTP failures as data (not a thrown error) so the
          // real message survives production redaction — surface it inline.
          setMsg({ kind: "err", text: result.message });
          setTestError({
            responseCode: result.responseCode,
            command: result.command,
            serverResponse: result.serverResponse,
            remediationUrl: result.remediationUrl,
          });
        }
      } catch (e) {
        // Only authorization/validation errors still throw here.
        setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to send test email." });
      }
    });
  };

  const statusColor = status.configured ? "var(--dpf-success)" : "var(--dpf-warning)";

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Email (SMTP)</h2>
      <p className="text-sm text-[var(--dpf-muted)] mb-4">
        Outbound email for invoices, payment links, dunning, and approvals. Without this,
        &ldquo;Send Invoice&rdquo; and signed-confirmation emails cannot be delivered.
      </p>

      <div
        className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
        style={{ borderLeftColor: statusColor }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-[var(--dpf-text)]">SMTP server</span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{
              background: `color-mix(in srgb, ${statusColor} 13%, transparent)`,
              color: statusColor,
            }}
          >
            {status.configured
              ? `Configured${status.source === "env" ? " (env vars)" : status.source === "relay" ? " (bundled relay)" : ""}`
              : "Not configured"}
          </span>
        </div>

        {status.source === "relay" && (
          <p className="text-xs text-[var(--dpf-muted)] mb-3">
            Outbound email is currently sent through the platform-bundled relay. Configure your own
            SMTP below to send from your own domain (recommended for deliverability).
          </p>
        )}

        {/* AI-assisted setup: detect the operator's own provider from their domain. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            onClick={detect}
            disabled={detecting}
            className="px-3 py-1.5 text-xs font-semibold border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed hover:border-[var(--dpf-accent)]"
          >
            {detecting ? "Detecting…" : "Detect my email provider"}
          </button>
          <span className="text-[11px] text-[var(--dpf-muted)]">
            Fills in the server settings for your domain&mdash;you just add your password.
          </span>
        </div>

        {hint?.found && hint.preset && (
          <div className="mb-4 p-3 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
            <p className="text-xs font-semibold text-[var(--dpf-text)] mb-1">
              {hint.preset.label}
            </p>
            <p className="text-[11px] text-[var(--dpf-muted)]">{hint.preset.credentialHint}</p>
            {hint.preset.sharedRelay && (
              <p className="text-[11px] text-[var(--dpf-muted)] mt-1">
                This is a transactional email service&mdash;verify your sending domain (SPF/DKIM)
                in its dashboard so messages reach the inbox.
              </p>
            )}
            {hint.preset.docsUrl && (
              <a
                href={hint.preset.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[var(--dpf-accent)] underline mt-1 inline-block"
              >
                How to get the credential →
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>Host *</label>
            <input
              className={inputCls}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.example.com"
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelCls}>Port</label>
            <input
              className={inputCls}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="587"
              inputMode="numeric"
            />
          </div>
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--dpf-text)]">
              <input
                type="checkbox"
                checked={secure}
                onChange={(e) => setSecure(e.target.checked)}
                className="accent-[var(--dpf-accent)]"
              />
              Use TLS/SSL (implicit, port 465)
            </label>
          </div>
          <div>
            <label className={labelCls}>Username</label>
            <input
              className={inputCls}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="apikey / user@example.com"
              autoComplete="off"
            />
          </div>
          <div>
            <label className={labelCls}>Password</label>
            <input
              className={inputCls}
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={status.passConfigured ? "•••••• (leave blank to keep)" : "SMTP password / API key"}
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>From address</label>
            <input
              className={inputCls}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="billing@yourbusiness.com"
            />
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={save}
            disabled={saving || !host.trim()}
            className="px-4 py-2 text-xs font-semibold bg-[var(--dpf-accent)] text-white rounded disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {/* Send test email */}
        <div className="mt-4 pt-4 border-t border-[var(--dpf-border)]">
          <label className={labelCls}>Send a test email to</label>
          <div className="flex gap-2">
            <input
              className={`${inputCls} flex-1`}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              type="email"
            />
            <button
              onClick={test}
              disabled={testing || !testTo.trim()}
              className="px-4 py-2 text-xs font-semibold border border-[var(--dpf-border)] text-[var(--dpf-text)] rounded disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed hover:border-[var(--dpf-accent)]"
            >
              {testing ? "Sending…" : "Send test"}
            </button>
          </div>
        </div>

        {msg && (
          <p
            className="mt-3 text-xs"
            style={{ color: msg.kind === "ok" ? "var(--dpf-success)" : "var(--dpf-error)" }}
          >
            {msg.text}
          </p>
        )}

        {/* Structured SMTP failure detail — response code, the server's own
            message, and a remediation link — so the operator can self-diagnose
            without digging through server logs. */}
        {testError &&
          (testError.responseCode ||
            testError.serverResponse ||
            testError.remediationUrl) && (
            <div className="mt-2 p-3 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-dpf-caption text-[var(--dpf-muted)] space-y-1">
              {(testError.responseCode || testError.command) && (
                <p>
                  {testError.responseCode && (
                    <span>
                      Server response code:{" "}
                      <span className="font-mono text-[var(--dpf-text)]">
                        {testError.responseCode}
                      </span>
                    </span>
                  )}
                  {testError.responseCode && testError.command && " · "}
                  {testError.command && (
                    <span>
                      at{" "}
                      <span className="font-mono text-[var(--dpf-text)]">
                        {testError.command}
                      </span>
                    </span>
                  )}
                </p>
              )}
              {testError.serverResponse && (
                <p className="font-mono text-[var(--dpf-text)] break-words">
                  {testError.serverResponse}
                </p>
              )}
              {testError.remediationUrl && (
                <a
                  href={testError.remediationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--dpf-accent)] underline inline-block"
                >
                  How to fix this →
                </a>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
