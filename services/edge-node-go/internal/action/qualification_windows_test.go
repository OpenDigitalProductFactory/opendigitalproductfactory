package action

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func qualificationParametersFixture(t *testing.T) json.RawMessage {
	t.Helper()
	value := map[string]any{
		"version": 1, "backlogItemId": "BI-B3DEC077", "workroomId": "WC-A8C14CBE",
		"repository": "OpenDigitalProductFactory/opendigitalproductfactory",
		"baseSha":    repeatHex("a", 40), "headSha": repeatHex("b", 40),
		"protocolPath": "docs/superpowers/specs/windows-handle-replacement.md", "protocolBlobSha": repeatHex("c", 40),
		"productionBlobs":            []map[string]any{{"path": "apps/web/lib/file.ts", "blobSha": repeatHex("d", 40)}},
		"testBlobs":                  []map[string]any{{"path": "apps/web/lib/file.test.ts", "blobSha": repeatHex("e", 40)}},
		"qualificationBindingDigest": repeatHex("f", 64), "procedureId": WindowsHandleReplacementProcedureID,
		"resultSchemaVersion": 1, "maxDurationSeconds": 300, "edgeNodeId": "edge_windows_1",
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
	times := []time.Time{now, now.Add(time.Second)}
	handler := QualificationWindowsHandler{Platform: "win32", StateDirectory: t.TempDir(), Now: func() time.Time {
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
	observations := output.Evidence["observations"].(map[string]any)
	if observations["secondReplacement"] != "replaced" || observations["cleanup"] != "removed" {
		t.Fatalf("fixture did not settle cleanly: %#v", observations)
	}
}

func TestQualificationHandlerRejectsNonWindows(t *testing.T) {
	handler := QualificationWindowsHandler{Platform: "linux", StateDirectory: t.TempDir()}
	if _, err := handler.Execute(context.Background(), qualificationParametersFixture(t)); !errors.Is(err, errQualificationPlatform) {
		t.Fatalf("got %v, want platform refusal", err)
	}
}
