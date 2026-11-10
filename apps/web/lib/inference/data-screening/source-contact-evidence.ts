// Addresses that identify a COMMIT AUTHOR or the acting account, not a customer.
// Matched with the surrounding trailer/identifier so a bare address elsewhere in
// the same payload is still classified normally (BI-EBE25715).
const GIT_AUTHORSHIP_EMAIL_PATTERN =
  /(?:signed-off-by|co-authored-by|author|committer|reported-by|reviewed-by|acked-by|createdby(?:id)?|actorid)\s*:?\s*[^\n<]*<?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}>?|<(?:noreply|no-reply|do-not-reply)@[A-Z0-9.-]+\.[A-Z]{2,}>/i;

// This exact synthetic Git argument creates temporary commits in tests.
// RFC 2606 reserves .invalid, but arbitrary local parts may still identify a
// person. Recognize only the placeholder, including matching quote boundaries;
// retain bare addresses, personal names, suffixes and adjacent contact data.
const SYNTHETIC_GIT_EMAIL_ARGUMENT_PATTERN =
  /"user\.email=test@example\.invalid"|'user\.email=test@example\.invalid'/i;

// Narrowing amendment to the 2026-10-08 design (BI-9F620FE1 follow-up): an
// address on a reserved domain (RFC 2606/6761: .invalid, .test, .example,
// .localhost, example.com/.net/.org, including their subdomains) cannot be
// delivered to, and when its local part is a role or placeholder token it
// names no person either. `.local` is not reserved that way: organisations
// run real internal mail on it (corp.local), so only the platform's own
// fixture domain dpf.local is exempt. Fixture accounts such as admin@dpf.local
// clamped whole review diffs to local inference. A person-shaped local part
// (jane@, first.last@), a suffix after the domain, or a customer/contact
// context, including a two-word label such as "contact email:", still counts.
const PLACEHOLDER_LOCAL_PART =
  "(?:admin|administrator|automation|agent|bot|ci|demo|dev|example|fixture|nobody|noreply|no-reply|operator|owner|root|sample|service|system|test|tester|user|walk)(?:[-_.]?\\d{1,3})?";
const RESERVED_DOMAIN = "(?:(?:[A-Z0-9-]+\\.)*(?:invalid|test|example|localhost|example\\.(?:com|net|org))|dpf\\.local)";
const CUSTOMER_CONTEXT = "\\b(?:customer|client|contact|patient|member|subscriber|lead|guardian|donor|adopter)[\\w.-]*(?:\\s+[\\w.-]+)?\\s*[:=]\\s*[\"']?";
const RESERVED_PLACEHOLDER_EMAIL_PATTERN = new RegExp(
  `(?<!${CUSTOMER_CONTEXT})(?<![A-Z0-9._%+-])${PLACEHOLDER_LOCAL_PART}@${RESERVED_DOMAIN}(?![A-Z0-9.@+%_-])`, "i");

// Explicit unquoted resource quantities and versioned patch paths supplied by
// a source diff are not phone/email values. Strip only their spans, never the
// surrounding message: adjacent actual contact data must still be detected.
export const SOURCE_CONTACT_EXEMPTION_PATTERN = new RegExp([
  GIT_AUTHORSHIP_EMAIL_PATTERN.source,
  SYNTHETIC_GIT_EMAIL_ARGUMENT_PATTERN.source,
  RESERVED_PLACEHOLDER_EMAIL_PATTERN.source,
  /(?:^|[\n{,])[\t +\-]*["']?(?:memoryBytes|admissionReserveBytes|observedHighWaterBytes|safetyMarginBytes)["']?[\t ]*:[\t ]*\d+(?=[\t ]*(?:[,}\r\n]|$))/.source,
  /\bpatches\/[A-Z0-9._+\-]+@\d+\.\d+\.\d+(?:-[A-Z0-9.\-]+)?\.patch(?![A-Z0-9._@+%/\-])/.source,
].join("|"), "im");
