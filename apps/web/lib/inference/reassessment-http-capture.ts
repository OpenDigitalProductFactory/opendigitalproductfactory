/** Preserve the exact response-body bytes exposed by Fetch. Authentication
 * headers remain outside prospective capture; adapters do not consume them. */
export async function captureReassessmentHttpResponse(response: Response) {
  const secret = /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|credential|credentials)$/i;
  return { status: response.status, statusText: response.statusText,
    headers: Object.fromEntries([...response.headers].filter(([name]) => !secret.test(name))),
    bodyEncoding: "base64" as const,
    bodyBase64: Buffer.from(await response.clone().arrayBuffer()).toString("base64") };
}
