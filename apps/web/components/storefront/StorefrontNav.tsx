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
      borderBottom: "1px solid #e5e7eb",
      padding: "0 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: 60,
      background: "#fff",
    }}>
      <Link href={`/s/${orgSlug}`} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
        {orgLogoUrl && <img src={orgLogoUrl} alt={orgName} style={{ height: 32, width: "auto" }} />}
        <span style={{ fontWeight: 700, fontSize: 18, color: "#111827" }}>{orgName}</span>
      </Link>
      <div style={{ display: "flex", gap: 8 }}>
        <Link
          href={`/s/${orgSlug}/sign-in`}
          style={{
            fontSize: 13, padding: "6px 14px", borderRadius: 6,
            border: "1px solid #d1d5db", color: "#374151", textDecoration: "none",
          }}
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
