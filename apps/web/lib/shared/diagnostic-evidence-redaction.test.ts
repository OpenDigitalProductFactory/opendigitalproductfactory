import {expect,it} from "vitest";
import {redactDiagnosticEvidenceText} from "./diagnostic-evidence-redaction";
it.each([
 "dpfmcp_"+"synthetic_fixture",
 "Bearer fixture-session",
 "bEaReR fixture-session",
 "Basic fixtureBasic",
 "sk-ant-"+"fixturetokenvalue",
 "sk-"+"fixturetokenvalue",
 "eyJfixture.eyJfixture.fixture",
 "echo 'QUJDREVGR0hJSktMTU5PUFFSU1RV' | base64 -d",
 "DATA:IMAGE/PNG;BASE64,ZmFrZXBpeGVscw==",
])("excludes a known diagnostic credential or image pattern",value=>{
 expect(redactDiagnosticEvidenceText(value)).not.toBe(value);
});
it("preserves ordinary diagnostic prose and structured contribution bytes",()=>{
 const value='{"summary":"Review","criteria":["Hierarchy"],"corpusRefs":["professions/ux-design/hierarchy"],"findings":[]}';
 expect(redactDiagnosticEvidenceText(value)).toBe(value);
});
it.each([
 ["password=synthetic-fixture-value", 'password="[redacted-token]"'],
 ["TOKEN: 'synthetic fixture value'", 'TOKEN: "[redacted-token]"'],
 ["https://fixture:synthetic-fixture-value@registry.invalid/path", "https://[redacted-token]@registry.invalid/path"],
 ['"password": "synthetic fixture value"', '"password": "[redacted-token]"'],
 [String.raw`secret="synthetic \"quoted\" fixture value"`, 'secret="[redacted-token]"'],
 ["https://synthetic-user@registry.invalid/path", "https://[redacted-token]@registry.invalid/path"],
])("excludes the complete Docker credential while preserving context", (value, expected) => {
 expect(redactDiagnosticEvidenceText(value, { credentialAssignments: true })).toBe(expected);
});
it("removes complete URL userinfo through its final authority separator", () => {
 const value="https://fixture:synthetic@private-suffix@registry.invalid/path";
 expect(redactDiagnosticEvidenceText(value, { credentialAssignments: true })).toBe("https://[redacted-token]@registry.invalid/path");
});
it("preserves existing callers' assignment-like evidence by default", () => {
 const value="password=labelled-test-prose; https://fixture:labelled@registry.invalid";
 expect(redactDiagnosticEvidenceText(value)).toBe(value);
});
