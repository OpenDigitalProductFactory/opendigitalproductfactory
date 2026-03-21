"use client";

import { useState, useTransition } from "react";
import { savePlatformApiKey } from "@/lib/actions/ai-providers";

type KeyConfig = {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  isSecret: boolean;
};

const GOOGLE_KEYS: KeyConfig[] = [
  {
    key: "google_client_id",
    label: "Google Client ID",
    description: "OAuth 2.0 Client ID from Google Cloud Console.",
    placeholder: "123456789-xxxxxxxxx.apps.googleusercontent.com",
    isSecret: false,
  },
  {
    key: "google_client_secret",
    label: "Google Client Secret",
    description: "OAuth 2.0 Client Secret from Google Cloud Console.",
    placeholder: "GOCSPX-xxxxxxxxxxxxxxxx",
    isSecret: true,
  },
];

const APPLE_KEYS: KeyConfig[] = [
  {
    key: "apple_client_id",
    label: "Apple Services ID",
    description: "The Services ID registered in Apple Developer portal. This is the Client ID for Sign in with Apple.",
    placeholder: "com.yourcompany.signin",
    isSecret: false,
  },
  {
    key: "apple_team_id",
    label: "Apple Team ID",
    description: "Your Apple Developer Team ID (top right of developer portal).",
    placeholder: "ABC1234DEF",
    isSecret: false,
  },
  {
    key: "apple_key_id",
    label: "Apple Key ID",
    description: "The Key ID for your Sign in with Apple key.",
    placeholder: "XYZ9876543",
    isSecret: false,
  },
  {
    key: "apple_client_secret",
    label: "Apple Private Key",
    description: "Contents of the .p8 private key file downloaded from Apple. This file can only be downloaded once — store it safely.",
    placeholder: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
    isSecret: true,
  },
];

type KeyData = { configured: boolean; currentValue: string | null };
type Props = { keyData: Record<string, KeyData> };

function maskSecret(value: string): string {
  if (value.length <= 6) return "\u2022".repeat(value.length);
  return value.slice(0, 4) + "\u2022".repeat(Math.min(value.length - 4, 12));
}

function ProviderSection({
  title,
  keys,
  keyData,
  setupGuide,
}: {
  title: string;
  keys: KeyConfig[];
  keyData: Record<string, KeyData>;
  setupGuide: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [showGuide, setShowGuide] = useState(false);

  const allConfigured = keys.every((k) => !!(savedValues[k.key] ?? keyData[k.key]?.currentValue));

  function handleSave(key: string) {
    const value = values[key];
    if (!value?.trim()) return;
    startTransition(async () => {
      await savePlatformApiKey(key, value.trim());
      setSavedValues((prev) => ({ ...prev, [key]: value.trim() }));
      setValues((prev) => ({ ...prev, [key]: "" }));
    });
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--dpf-text)]">{title}</span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{
              background: allConfigured ? "#4ade8020" : "#fbbf2420",
              color: allConfigured ? "#4ade80" : "#fbbf24",
            }}
          >
            {allConfigured ? "Ready" : "Setup needed"}
          </span>
        </div>
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="text-xs text-[var(--dpf-accent)] hover:underline cursor-pointer"
        >
          {showGuide ? "Hide setup guide" : "Show setup guide"}
        </button>
      </div>

      {showGuide && (
        <div className="mb-4 p-4 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)] leading-relaxed">
          {setupGuide}
        </div>
      )}

      <div className="space-y-3">
        {keys.map((cfg) => {
          const data = keyData[cfg.key];
          const displayValue = savedValues[cfg.key] ?? data?.currentValue ?? null;
          const isConfigured = !!displayValue;
          const statusColor = isConfigured ? "#4ade80" : "#fbbf24";

          return (
            <div
              key={cfg.key}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: statusColor }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-[var(--dpf-text)]">{cfg.label}</span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: `${statusColor}20`, color: statusColor }}
                >
                  {isConfigured ? "Configured" : "Not configured"}
                </span>
              </div>
              <p className="text-xs text-[var(--dpf-muted)] mb-2">{cfg.description}</p>

              {isConfigured && (
                <div className="mb-3 px-3 py-1.5 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
                  <span className="text-[10px] text-[var(--dpf-muted)] mr-2">Current:</span>
                  <span className="text-xs font-mono text-[var(--dpf-text)]">
                    {cfg.isSecret ? maskSecret(displayValue!) : displayValue}
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  value={values[cfg.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [cfg.key]: e.target.value }))}
                  placeholder={isConfigured ? (cfg.isSecret ? "Enter new value to replace" : "Enter new value to replace") : cfg.placeholder}
                  disabled={isPending}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  style={cfg.isSecret ? { WebkitTextSecurity: "disc" } as React.CSSProperties : undefined}
                />
                <button
                  onClick={() => handleSave(cfg.key)}
                  disabled={isPending || !values[cfg.key]?.trim()}
                  className="px-4 py-2 text-xs font-semibold bg-[var(--dpf-accent)] text-white rounded disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isPending ? "..." : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const GoogleSetupGuide = () => (
  <div>
    <p className="font-semibold text-[var(--dpf-text)] mb-2">Google OAuth Setup (free, ~10 minutes)</p>
    <p className="mb-2">You need a Google account (personal is fine — no business account required).</p>
    <ol className="list-decimal list-inside space-y-1.5">
      <li>Go to <span className="text-[var(--dpf-text)] font-mono">console.cloud.google.com</span></li>
      <li>Create a new project (or select an existing one)</li>
      <li>Navigate to <span className="text-[var(--dpf-text)]">APIs &amp; Services &rarr; OAuth consent screen</span></li>
      <li>Configure: User type <span className="text-[var(--dpf-text)]">External</span>, add your app name and domain</li>
      <li>Add scopes: <span className="text-[var(--dpf-text)] font-mono">email</span>, <span className="text-[var(--dpf-text)] font-mono">profile</span>, <span className="text-[var(--dpf-text)] font-mono">openid</span></li>
      <li>Navigate to <span className="text-[var(--dpf-text)]">APIs &amp; Services &rarr; Credentials</span></li>
      <li>Click <span className="text-[var(--dpf-text)]">Create Credentials &rarr; OAuth 2.0 Client IDs</span> &rarr; Web application</li>
      <li>Add authorized redirect URI: <span className="text-[var(--dpf-text)] font-mono">http://localhost:3000/api/auth/callback/google</span> (for local dev)</li>
      <li>For production, add: <span className="text-[var(--dpf-text)] font-mono">https://your-domain/api/auth/callback/google</span></li>
      <li>Copy the <span className="text-[var(--dpf-text)]">Client ID</span> and <span className="text-[var(--dpf-text)]">Client Secret</span> into the fields below</li>
    </ol>
    <div className="mt-3 p-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
      <p className="text-[var(--dpf-text)] text-xs font-semibold mb-1">Good to know:</p>
      <ul className="list-disc list-inside space-y-0.5">
        <li>Localhost works for development — no public domain needed to start</li>
        <li>In &quot;testing&quot; mode you can add up to 100 test users without domain verification</li>
        <li>No credit card required — Google OAuth is part of the free tier</li>
        <li>Your domain does not need public WHOIS — Google verifies via DNS or meta tag</li>
      </ul>
    </div>
  </div>
);

const AppleSetupGuide = () => (
  <div>
    <p className="font-semibold text-[var(--dpf-text)] mb-2">Apple Sign In Setup (~20 minutes, requires Apple Developer account)</p>
    <p className="mb-2">Requires a paid Apple Developer account ($99/year) — personal or organizational.</p>
    <ol className="list-decimal list-inside space-y-1.5">
      <li>Go to <span className="text-[var(--dpf-text)] font-mono">developer.apple.com</span></li>
      <li>Navigate to <span className="text-[var(--dpf-text)]">Certificates, Identifiers &amp; Profiles</span></li>
      <li>Register an <span className="text-[var(--dpf-text)]">App ID</span> with &quot;Sign in with Apple&quot; capability</li>
      <li>Register a <span className="text-[var(--dpf-text)]">Services ID</span> — this becomes your Client ID</li>
      <li>Configure domains and return URL: <span className="text-[var(--dpf-text)] font-mono">https://your-domain/api/auth/callback/apple</span></li>
      <li>Create a <span className="text-[var(--dpf-text)]">Key</span> for Sign in with Apple</li>
      <li>Download the <span className="text-[var(--dpf-text)] font-mono">.p8</span> private key file — it can only be downloaded once, store it safely</li>
      <li>Note your <span className="text-[var(--dpf-text)]">Key ID</span> and <span className="text-[var(--dpf-text)]">Team ID</span> (top right of portal)</li>
      <li>Enter all values in the fields below</li>
    </ol>
    <div className="mt-3 p-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
      <p className="text-[var(--dpf-text)] text-xs font-semibold mb-1">Good to know:</p>
      <ul className="list-disc list-inside space-y-0.5">
        <li>Apple does <span className="text-[var(--dpf-text)]">not</span> support localhost — you need a real domain or a tunnel (e.g., ngrok) for development</li>
        <li>Domain does not need public WHOIS — Apple verifies through its own portal</li>
        <li>The .p8 key file is a one-time download — if lost, you must create a new key</li>
        <li>You can set up Google first and add Apple later — they work independently</li>
      </ul>
    </div>
  </div>
);

export function SocialAuthPanel({ keyData }: Props) {
  const googleReady = GOOGLE_KEYS.every((k) => !!keyData[k.key]?.currentValue);
  const appleReady = APPLE_KEYS.every((k) => !!keyData[k.key]?.currentValue);
  const anyReady = googleReady || appleReady;

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-[var(--dpf-text)] mb-1">Social Sign-In for Customers</h2>
      <p className="text-sm text-[var(--dpf-muted)] mb-2">
        Let customers sign in with Google or Apple instead of email/password. Configure at least one provider to enable social sign-in on the customer portal.
      </p>

      {anyReady && (
        <div className="mb-4 p-3 rounded-lg bg-[#4ade8010] border border-[#4ade8030]">
          <p className="text-xs text-[#4ade80]">
            {googleReady && appleReady
              ? "Both Google and Apple are configured. Social sign-in is active on the customer portal."
              : googleReady
                ? "Google sign-in is active. Apple can be added later."
                : "Apple sign-in is active. Google can be added later."}
          </p>
        </div>
      )}

      {!anyReady && (
        <div className="mb-4 p-3 rounded-lg bg-[#fbbf2410] border border-[#fbbf2430]">
          <p className="text-xs text-[#fbbf24]">
            Social sign-in is not active yet. Configure at least one provider below to enable it. We recommend starting with Google — it&apos;s free and takes about 10 minutes.
          </p>
        </div>
      )}

      <ProviderSection
        title="Google"
        keys={GOOGLE_KEYS}
        keyData={keyData}
        setupGuide={<GoogleSetupGuide />}
      />

      <ProviderSection
        title="Apple"
        keys={APPLE_KEYS}
        keyData={keyData}
        setupGuide={<AppleSetupGuide />}
      />
    </div>
  );
}
