/** One diagnostic policy for functional failures and retained unvalidated output.
 * This is pattern-based exclusion, not a claim to detect arbitrary secrets.
 */
const patterns = [
  /\bdpfmcp_[A-Za-z0-9_-]+/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\b(?:sk-|sk_live_)[A-Za-z0-9_-]{12,}/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /echo '[A-Za-z0-9+\/=]{20,}'(?=\s*\|\s*base64\s+-d)/g,
  /data:image\/[^;,\s]+;base64,[A-Za-z0-9+/=_-]+/gi,
];
export function redactDiagnosticEvidenceText(text:string, options: { credentialAssignments?: boolean } = {}):string {
  const redacted = patterns.reduce((value,pattern)=>value.replace(pattern,"[redacted-token]"),text);
  // Docker output can include ordinary credential assignments and URL userinfo.
  // Opt in at that capture boundary; preserve existing structured readers' policy.
  if (!options.credentialAssignments) return redacted;
  return redacted
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted-token]@")
    .replace(/\b(?:token|secret|password|authorization)\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, "[redacted-token]");
}
