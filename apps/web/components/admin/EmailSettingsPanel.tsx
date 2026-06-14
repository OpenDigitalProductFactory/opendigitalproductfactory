"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEmailConfig, sendTestEmail } from "@/lib/actions/email-config";

type Props = {
  status: {
    configured: boolean;
    host: string | null;
    port: number;
    user: string | null;
    from: string | null;
    secure: boolean;
    passConfigured: boolean;
    source: "db" | "env" | "none";
  };
};

const inputCls =
  "w-full px-3 py-2 text-xs bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]";
const labelCls = "block text-xs text-[var(--dpf-muted)] mb-1";

export function EmailSettingsPanel({ status }: Props) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [host, setHost] = useState(status.host ?? "");
  const [port, setPort] = useState(String(status.port || 587));
  const [user, setUser] = useState(status.user ?? "");
  const [from, setFrom] = useState(status.from ?? "");
  const [secure, setSecure] = useState(status.secure);
  const [pass, setPass] = useState("");
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const save = () => {
    setMsg(null);
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
    startTest(async () => {
      try {
        await sendTestEmail(testTo.trim());
        setMsg({ kind: "ok", text: `Test email sent to ${testTo.trim()}.` });
      } catch (e) {
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
              ? `Configured${status.source === "env" ? " (env vars)" : ""}`
              : "Not configured"}
          </span>
        </div>

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
      </div>
    </div>
  );
}
