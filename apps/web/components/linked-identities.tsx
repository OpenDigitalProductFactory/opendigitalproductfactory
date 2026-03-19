"use client";

import { signIn } from "next-auth/react";

type LinkedIdentity = {
  id: string;
  provider: string;
  email: string | null;
  linkedAt: string;
};

type Props = {
  identities: LinkedIdentity[];
  hasPassword: boolean;
};

const providers = [
  { id: "google", name: "Google", icon: "G" },
  { id: "apple", name: "Apple", icon: "" },
];

export function LinkedIdentities({ identities, hasPassword }: Props) {
  const linkedProviders = new Set(identities.map((i) => i.provider));

  return (
    <div>
      <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Linked Sign-In Methods
      </h3>
      <p style={{ color: "#8888a0", fontSize: 12, marginBottom: 16 }}>
        Manage how you sign in to your account
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, border: "1px solid #2a2a40", borderRadius: 6, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📧</span>
          <div>
            <div style={{ fontSize: 13, color: "#e0e0e0" }}>Email & Password</div>
          </div>
        </div>
        <span style={{ color: hasPassword ? "#34d399" : "#8888a0", fontSize: 11, background: hasPassword ? "#0d3320" : "#1a1a2e", padding: "2px 8px", borderRadius: 10 }}>
          {hasPassword ? "Active" : "Not set"}
        </span>
      </div>

      {providers.map((p) => {
        const linked = identities.find((i) => i.provider === p.id);
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, border: "1px solid #2a2a40", borderRadius: 6, marginBottom: 8, opacity: linked ? 1 : 0.7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>{p.icon}</span>
              <div>
                <div style={{ fontSize: 13, color: "#e0e0e0" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#8888a0" }}>
                  {linked ? linked.email ?? "Linked" : "Not linked"}
                </div>
              </div>
            </div>
            {linked ? (
              <span style={{ color: "#34d399", fontSize: 11, background: "#0d3320", padding: "2px 8px", borderRadius: 10 }}>Linked</span>
            ) : (
              <button
                onClick={() => signIn(p.id, { callbackUrl: "/portal/settings" })}
                style={{ fontSize: 11, color: "#60a5fa", background: "#1e293b", border: "1px solid #334155", padding: "4px 12px", borderRadius: 10, cursor: "pointer" }}
              >
                Link
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
