"use client";

type Props = {
  onClick: () => void;
};

export function AgentFAB({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open AI Co-worker"
      style={{
        position: "fixed",
        right: 16,
        top: "50%",
        transform: "translateY(-50%)",
        padding: "8px 16px",
        borderRadius: 20,
        background: "rgba(124, 140, 248, 0.7)",
        backdropFilter: "blur(4px)",
        border: "1px solid rgba(124, 140, 248, 0.3)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        zIndex: 50,
        transition: "transform 0.15s, opacity 0.15s",
        color: "#ffffff",
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-50%) scale(1.05)";
        e.currentTarget.style.opacity = "0.9";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(-50%)";
        e.currentTarget.style.opacity = "1";
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-green-400"
        style={{ boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)" }}
      />
      AI Coworker
    </button>
  );
}
