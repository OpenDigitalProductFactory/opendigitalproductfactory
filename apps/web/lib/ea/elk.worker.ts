/// <reference lib="webworker" />
// Web Worker that runs ELK layout OFF the main thread (BI-7060F7C5).
//
// `elk.bundled.js` runs the GWT-compiled layout algorithm synchronously in whatever thread
// calls it. On the main thread that froze the UI for the large EA views (Application Routes
// 619n, Data Model 424n, …) during "auto layout". Importing it HERE runs that same compute
// in this worker thread instead, leaving the UI responsive.
//
// Protocol (matched in canvas-layout.ts `elkLayout`): the main thread posts `{ id, graph }`;
// we reply `{ id, result }` on success or `{ id, error }` on failure. ELK graphs and results
// are plain JSON-able objects, so they structured-clone across the worker boundary cleanly.
import ELK from "elkjs/lib/elk.bundled.js";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const elk = new ELK();
const ctx = self as unknown as Worker;

ctx.onmessage = async (event: MessageEvent) => {
  const { id, graph } = event.data as { id: number; graph: unknown };
  try {
    const result = await elk.layout(graph as Parameters<typeof elk.layout>[0]);
    ctx.postMessage({ id, result });
  } catch (err) {
    ctx.postMessage({ id, error: getErrorMessage(err) });
  }
};
