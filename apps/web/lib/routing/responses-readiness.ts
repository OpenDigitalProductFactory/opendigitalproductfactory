/** Readiness needs completion evidence; partial streaming output is insufficient. */
export function assertResponsesCompleted(raw: string, streaming: boolean): void {
  if (!streaming) {
    const response = JSON.parse(raw) as { status?: string };
    if (response.status === "completed") return;
  } else {
    let completed = false;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let event: { type?: string; response?: { status?: string } };
      try { event = JSON.parse(data); } catch { continue; }
      if (["error", "response.failed", "response.incomplete", "response.cancelled"].includes(event.type ?? "")) {
        throw new Error("Readiness inference failed before completion");
      }
      if (event.type === "response.completed" && event.response?.status === "completed") completed = true;
    }
    if (completed) return;
  }
  throw new Error("Readiness inference did not complete");
}
