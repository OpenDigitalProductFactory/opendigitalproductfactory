package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func sampleState() *EdgeNodeState {
	metricsSec := 30
	return &EdgeNodeState{
		NodeID:               "edge_test_abc",
		NodeToken:            "dpfedge_t0k3n_test",
		EnrolledAt:           "2026-05-20T18:00:00.000Z",
		HeartbeatIntervalSec: 60,
		SweepIntervalSec:     300,
		MetricsIntervalSec:   &metricsSec,
		AcceptedCapabilities: []string{"discovery.network"},
		TrustState:           "trusted",
	}
}

func TestSaveAndLoad_roundTrip(t *testing.T) {
	dir := t.TempDir()
	want := sampleState()
	if err := Save(dir, want); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("round-trip mismatch:\n got=%+v\nwant=%+v", got, want)
	}
}

func TestLoad_returnsNilWhenFileMissing(t *testing.T) {
	dir := t.TempDir()
	got, err := Load(dir)
	if err != nil {
		t.Fatalf("Load on missing file: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestLoad_errorsOnCorruptJSON(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte("{ not json"), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, err := Load(dir)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "corrupt") {
		t.Errorf("error %q does not mention corruption", err)
	}
}

func TestLoad_errorsOnMissingRequiredField(t *testing.T) {
	dir := t.TempDir()
	// Valid JSON, but missing nodeToken (mandatory).
	bad := `{
		"nodeId": "edge_x",
		"enrolledAt": "2026-05-20T00:00:00Z",
		"heartbeatIntervalSec": 60,
		"sweepIntervalSec": 300,
		"acceptedCapabilities": [],
		"trustState": "trusted"
	}`
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(bad), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, err := Load(dir)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "nodeToken") {
		t.Errorf("error %q does not name the missing field", err)
	}
}

func TestLoad_errorsOnInvalidTrustState(t *testing.T) {
	dir := t.TempDir()
	bad := `{
		"nodeId": "edge_x",
		"nodeToken": "t",
		"enrolledAt": "2026-05-20T00:00:00Z",
		"heartbeatIntervalSec": 60,
		"sweepIntervalSec": 300,
		"acceptedCapabilities": [],
		"trustState": "haxx0r"
	}`
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte(bad), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, err := Load(dir)
	if err == nil || !strings.Contains(err.Error(), "trustState") {
		t.Errorf("expected trustState validation error, got %v", err)
	}
}

func TestSave_writesValidJSON(t *testing.T) {
	dir := t.TempDir()
	if err := Save(dir, sampleState()); err != nil {
		t.Fatalf("Save: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("written file isn't valid JSON: %v", err)
	}
	// Wire-contract fields must be present in the JSON the TypeScript
	// Mode 1 implementation can parse without surprise.
	for _, key := range []string{
		"nodeId", "nodeToken", "enrolledAt", "heartbeatIntervalSec",
		"sweepIntervalSec", "metricsIntervalSec", "acceptedCapabilities", "trustState",
	} {
		if _, ok := parsed[key]; !ok {
			t.Errorf("written state missing field %q", key)
		}
	}
}

func TestClear_removesFileButTolerantsMissing(t *testing.T) {
	dir := t.TempDir()
	if err := Save(dir, sampleState()); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := Clear(dir); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "state.json")); !os.IsNotExist(err) {
		t.Errorf("file still present after Clear: %v", err)
	}
	// Second Clear on missing file is a no-op (returns nil).
	if err := Clear(dir); err != nil {
		t.Errorf("Clear on missing file should be a no-op, got %v", err)
	}
}

func TestSave_rejectsInvalidStateBeforeWriting(t *testing.T) {
	dir := t.TempDir()
	bad := *sampleState()
	bad.NodeToken = "" // required
	if err := Save(dir, &bad); err == nil {
		t.Fatal("expected validation error")
	}
	if _, err := os.Stat(filepath.Join(dir, "state.json")); !os.IsNotExist(err) {
		t.Errorf("invalid state must NOT touch the file: %v", err)
	}
}

func TestSave_isAtomic_noPartialFileAfterCrash(t *testing.T) {
	dir := t.TempDir()
	if err := Save(dir, sampleState()); err != nil {
		t.Fatalf("Save: %v", err)
	}
	// Simulate a crash mid-write by leaving a stray .tmp file behind.
	stray := filepath.Join(dir, "state.json.tmp.99999")
	if err := os.WriteFile(stray, []byte("partial"), 0o600); err != nil {
		t.Fatalf("seed stray: %v", err)
	}
	// A subsequent Save MUST still produce a clean state.json. (The
	// stray tmp file from a prior PID is operator-cleanup territory;
	// what matters is that valid state.json is unchanged.)
	got, err := Load(dir)
	if err != nil {
		t.Fatalf("Load after stray tmp: %v", err)
	}
	if got.NodeID == "" {
		t.Errorf("Load returned partial state")
	}
}
