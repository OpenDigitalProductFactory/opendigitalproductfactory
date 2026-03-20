import Link from "next/link";

const DEFAULT_LABELS: Record<string, string> = {
  booking: "Book Now",
  purchase: "Buy",
  inquiry: "Enquire",
  donation: "Donate",
};

export function CtaButton({
  ctaType,
  ctaLabel,
  orgSlug,
  itemId,
}: {
  ctaType: string;
  ctaLabel: string | null;
  orgSlug: string;
  itemId: string;
}) {
  const label = ctaLabel ?? DEFAULT_LABELS[ctaType] ?? "Get in Touch";

  const href =
    ctaType === "booking" ? `/s/${orgSlug}/book/${itemId}`
    : ctaType === "purchase" ? `/s/${orgSlug}/cart?add=${itemId}`
    : ctaType === "donation" ? `/s/${orgSlug}/donate`
    : `/s/${orgSlug}/inquire/${itemId}`;

  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        padding: "8px 20px",
        background: "var(--dpf-accent, #4f46e5)",
        color: "#fff",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
