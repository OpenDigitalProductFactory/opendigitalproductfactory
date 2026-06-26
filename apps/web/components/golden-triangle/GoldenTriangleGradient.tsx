"use client";
// EP-GOLDEN-TRIANGLE — the colour-graded triangle fill. A canvas Gouraud-shades
// the triangle from each vertex's health colour (red→yellow→green per axis
// weight): a dominant corner reads green, the low-weight corners red, dead-centre
// pure yellow, an edge yellow-near / red-far. Decorative (aria-hidden) — the SVG
// thumb + the numeric inputs carry the accessible control. Geometry matches the
// SVG triangle (INSET 12 / SPAN 76 of a 100-unit box): Quality top-centre, Cost
// bottom-left, Time bottom-right.
import { useEffect, useRef } from "react";

import { postureAxisColor } from "./posture-display";

const RES = 220;
const Q: [number, number] = [0.5, 0.12];
const C: [number, number] = [0.12, 0.88];
const T: [number, number] = [0.88, 0.88];

export function GoldenTriangleGradient({
  qualityWeight,
  costWeight,
  timeWeight,
  className = "",
}: {
  qualityWeight: number;
  costWeight: number;
  timeWeight: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return; // jsdom / unsupported — render nothing, no crash

    const W = RES, H = RES;
    const qx = Q[0] * W, qy = Q[1] * H, cx = C[0] * W, cy = C[1] * H, tx = T[0] * W, ty = T[1] * H;
    const det = (cy - ty) * (qx - tx) + (tx - cx) * (qy - ty);
    if (!det) return;
    const Vq = postureAxisColor(qualityWeight), Vc = postureAxisColor(costWeight), Vt = postureAxisColor(timeWeight);

    const img = ctx.createImageData(W, H);
    const d = img.data;
    const minX = Math.floor(Math.min(qx, cx, tx)), maxX = Math.ceil(Math.max(qx, cx, tx));
    const minY = Math.floor(Math.min(qy, cy, ty)), maxY = Math.ceil(Math.max(qy, cy, ty));
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const a = ((cy - ty) * (x - tx) + (tx - cx) * (y - ty)) / det;
        const b = ((ty - qy) * (x - tx) + (qx - tx) * (y - ty)) / det;
        const g = 1 - a - b;
        if (a < -0.004 || b < -0.004 || g < -0.004) continue;
        const i = (y * W + x) * 4;
        d[i] = a * Vq[0] + b * Vc[0] + g * Vt[0];
        d[i + 1] = a * Vq[1] + b * Vc[1] + g * Vt[1];
        d[i + 2] = a * Vq[2] + b * Vc[2] + g * Vt[2];
        d[i + 3] = 236;
      }
    }
    ctx.clearRect(0, 0, W, H);
    ctx.putImageData(img, 0, 0);
  }, [qualityWeight, costWeight, timeWeight]);

  return (
    <canvas
      ref={ref}
      width={RES}
      height={RES}
      aria-hidden="true"
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
