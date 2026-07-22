import Link from "next/link";

export function StorefrontNav({
  orgName,
  orgLogoUrl,
  orgSlug,
}: {
  orgName: string;
  orgLogoUrl: string | null;
  orgSlug: string;
}) {
  return (
    <header style={{
      borderBottom: "1px solid var(--dpf-border)",
      padding: "8px 16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 60,
      background: "var(--dpf-surface-1)",
    }}>
      <Link
        href={`/s/${orgSlug}`}
        style={{
          display: "flex", alignItems: "center", gap: 8, minWidth: 0,
          minHeight: 44, textDecoration: "none",
        }}
      >
        {orgLogoUrl && <img src={orgLogoUrl} alt={orgName} style={{ height: 32, width: "auto" }} />}
        <span style={{
          fontWeight: 700, fontSize: 18, color: "var(--dpf-text)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{orgName}</span>
      </Link>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <Link
          href={`/s/${orgSlug}/sign-in`}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, padding: "8px 16px", minHeight: 44, borderRadius: 6,
            border: "1px solid var(--dpf-border)", color: "var(--dpf-text)", textDecoration: "none",
          }}
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
