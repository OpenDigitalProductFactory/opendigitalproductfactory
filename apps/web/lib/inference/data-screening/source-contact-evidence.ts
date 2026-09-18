// Addresses that identify a COMMIT AUTHOR or the acting account, not a customer.
// Matched with the surrounding trailer/identifier so a bare address elsewhere in
// the same payload is still classified normally (BI-EBE25715).
const GIT_AUTHORSHIP_EMAIL_PATTERN =
  /(?:signed-off-by|co-authored-by|author|committer|reported-by|reviewed-by|acked-by|createdby(?:id)?|actorid)\s*:?\s*[^\n<]*<?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}>?|<(?:noreply|no-reply|do-not-reply)@[A-Z0-9.-]+\.[A-Z]{2,}>/i;

// Explicit unquoted resource quantities and versioned patch paths supplied by
// a source diff are not phone/email values. Strip only their spans, never the
// surrounding message: adjacent actual contact data must still be detected.
export const SOURCE_CONTACT_EXEMPTION_PATTERN = new RegExp([
  GIT_AUTHORSHIP_EMAIL_PATTERN.source,
  /(?:^|[\n{,])[\t +\-]*["']?(?:memoryBytes|admissionReserveBytes|observedHighWaterBytes|safetyMarginBytes)["']?[\t ]*:[\t ]*\d+(?=[\t ]*(?:[,}\r\n]|$))/.source,
  /\bpatches\/[A-Z0-9._+\-]+@\d+\.\d+\.\d+(?:-[A-Z0-9.\-]+)?\.patch(?![A-Z0-9._@+%/\-])/.source,
].join("|"), "im");

