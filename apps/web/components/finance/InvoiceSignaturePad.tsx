"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInvoice } from "@/lib/actions/finance";

type Props = {
  token: string;
  /** Prefill the signer email from the invoice contact, if known. */
  defaultEmail?: string | null;
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#6b7280",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  color: "#111",
};

export function InvoiceSignaturePad({ token, defaultEmail }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Size the canvas backing store to its display size for crisp strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111827";
    }
  }, []);

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = pointAt(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }, []);

  const move = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const { x, y } = pointAt(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (!hasDrawn) setHasDrawn(true);
    },
    [hasDrawn],
  );

  const end = useCallback(() => {
    drawingRef.current = false;
  }, []);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }, []);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Please type your full name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!hasDrawn) {
      setError("Please draw your signature in the box above.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    setSubmitting(true);
    try {
      await signInvoice({
        token,
        signedByName: name.trim(),
        signedByEmail: email.trim(),
        signatureDataUrl: canvas.toDataURL("image/png"),
      });
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not record your signature. Please try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        background: "#fafafa",
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#111" }}>
        Signature required
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#6b7280" }}>
        Please sign below to accept this invoice before payment.
      </p>

      <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="sig-name">
            Full name
          </label>
          <input
            id="sig-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="sig-email">
            Email
          </label>
          <input
            id="sig-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={inputStyle}
          />
        </div>
      </div>

      <label style={labelStyle}>Signature</label>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{
          width: "100%",
          height: 160,
          border: "1px dashed #9ca3af",
          borderRadius: 8,
          background: "white",
          touchAction: "none",
          cursor: "crosshair",
          display: "block",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <button
          type="button"
          onClick={clear}
          style={{
            background: "none",
            border: "none",
            color: "#6b7280",
            fontSize: 12,
            cursor: "pointer",
            textDecoration: "underline",
            padding: 0,
          }}
        >
          Clear
        </button>
      </div>

      {error && (
        <p style={{ color: "#dc2626", fontSize: 13, margin: "12px 0 0" }}>{error}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          marginTop: 16,
          width: "100%",
          background: "#22c55e",
          color: "white",
          fontSize: 16,
          fontWeight: 600,
          padding: "14px 24px",
          borderRadius: 8,
          border: "none",
          cursor: submitting ? "default" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Saving…" : "Sign & Continue"}
      </button>
    </div>
  );
}
