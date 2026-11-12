package action

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os/exec"
	"testing"
	"time"
)

func qualificationParametersFixture(t *testing.T) json.RawMessage {
	t.Helper()
	production := []byte("export const value = 1;\n")
	testSource := []byte("import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from './file.mjs'; test('bound source executes', () => assert.equal(value, 1));\n")
	support := []byte("export const support = true;\n")
	value := map[string]any{
		"version": 2, "backlogItemId": "BI-B3DEC077", "workroomId": "WC-A8C14CBE",
		"repository": "OpenDigitalProductFactory/opendigitalproductfactory",
		"baseSha":    repeatHex("a", 40), "headSha": repeatHex("b", 40),
		"protocolPath": "docs/superpowers/specs/windows-handle-replacement.md", "protocolBlobSha": repeatHex("c", 40),
		"productionBlobs":            []map[string]any{{"path": "scripts/lib/file.mjs", "blobSha": gitBlobSHA(production)}},
		"testBlobs":                  []map[string]any{{"path": "scripts/lib/file.test.mjs", "blobSha": gitBlobSHA(testSource)}},
		"qualificationBindingDigest": repeatHex("f", 64), "procedureId": WindowsHandleReplacementProcedureID,
		"resultSchemaVersion": 2, "maxDurationSeconds": 300, "edgeNodeId": "edge_windows_1",
		"sourceFiles": []map[string]any{
			{"path": "scripts/lib/file.mjs", "blobSha": gitBlobSHA(production), "contentBase64": base64.StdEncoding.EncodeToString(production)},
			{"path": "scripts/lib/file.test.mjs", "blobSha": gitBlobSHA(testSource), "contentBase64": base64.StdEncoding.EncodeToString(testSource)},
			{"path": qualificationSupportPath, "blobSha": gitBlobSHA(support), "contentBase64": base64.StdEncoding.EncodeToString(support)},
		},
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func repeatHex(value string, count int) string {
	result := ""
	for len(result) < count {
		result += value
	}
	return result
}

func TestQualificationParametersRejectWidening(t *testing.T) {
	if _, err := parseQualificationWindowsParameters(qualificationParametersFixture(t)); err != nil {
		t.Fatal(err)
	}
	var widened map[string]any
	if err := json.Unmarshal(qualificationParametersFixture(t), &widened); err != nil {
		t.Fatal(err)
	}
	widened["command"] = "pwsh"
	raw, _ := json.Marshal(widened)
	if _, err := parseQualificationWindowsParameters(raw); !errors.Is(err, ErrInvalidParameters) {
		t.Fatalf("got %v, want ErrInvalidParameters", err)
	}
}

func TestQualificationHandlerUsesOnlyIsolatedFixture(t *testing.T) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node unavailable")
	}
	times := []time.Time{now, now.Add(time.Second)}
	handler := QualificationWindowsHandler{Platform: "win32", StateDirectory: t.TempDir(), NodePath: nodePath, Now: func() time.Time {
		value := times[0]
		if len(times) > 1 {
			times = times[1:]
		}
		return value
	}}
	output, err := handler.Execute(context.Background(), qualificationParametersFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if output.Evidence["procedureId"] != WindowsHandleReplacementProcedureID || output.Evidence["qualificationBindingDigest"] != repeatHex("f", 64) {
		t.Fatalf("unexpected evidence: %#v", output.Evidence)
	}
	if output.Evidence["boundedOutputDigest"] == "" {
		t.Fatalf("missing bounded output digest: %#v", output.Evidence)
	}
	if output.Evidence["exitCode"] != 0 || output.Result["disposition"] != "passed" {
		t.Fatalf("bound test did not pass: result=%#v evidence=%#v", output.Result, output.Evidence)
	}
}

func TestQualificationHandlerRejectsChangedSourceBytes(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal(qualificationParametersFixture(t), &value); err != nil {
		t.Fatal(err)
	}
	files := value["sourceFiles"].([]any)
	files[0].(map[string]any)["contentBase64"] = base64.StdEncoding.EncodeToString([]byte("changed"))
	raw, _ := json.Marshal(value)
	if _, err := parseQualificationWindowsParameters(raw); !errors.Is(err, ErrInvalidParameters) {
		t.Fatalf("got %v, want changed source refusal", err)
	}
}

func TestQualificationHandlerRejectsNonWindows(t *testing.T) {
	handler := QualificationWindowsHandler{Platform: "linux", StateDirectory: t.TempDir()}
	if _, err := handler.Execute(context.Background(), qualificationParametersFixture(t)); !errors.Is(err, errQualificationPlatform) {
		t.Fatalf("got %v, want platform refusal", err)
	}
}
