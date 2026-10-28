package action

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func nativeHash(value []byte) string { sum := sha256.Sum256(value); return hex.EncodeToString(sum[:]) }
func nativeSign(t *testing.T, value Envelope, key ed25519.PrivateKey) SignedEnvelope {
	t.Helper()
	bytes, err := CanonicalEnvelope(value)
	if err != nil {
		t.Fatal(err)
	}
	return SignedEnvelope{Envelope: value, Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, bytes))}
}

func nativeHandlerFixture(t *testing.T) (*NativeManagedInferenceHandler, SignedEnvelope, string, *bool) {
	t.Helper()
	if runtime.GOOS != "darwin" || runtime.GOARCH != "arm64" {
		t.Skip("native execution is qualified on the physical Apple Silicon host only")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	source := strings.Repeat("a", 40)
	controller := filepath.Join(root, "native-inference-controller", source)
	entry := filepath.Join(controller, "tools", "mac-inference", "runtime-controller.mjs")
	if err := os.MkdirAll(filepath.Dir(entry), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte("fixture controller"), 0400); err != nil {
		t.Fatal(err)
	}
	node := filepath.Join(root, "fixture-node")
	if err := os.WriteFile(node, []byte("fixture node executable"), 0700); err != nil {
		t.Fatal(err)
	}
	edgeState := filepath.Join(root, "edge-node")
	if err := os.Mkdir(edgeState, 0700); err != nil {
		t.Fatal(err)
	}
	manifest := map[string]any{"schemaVersion": 1, "packageName": "dpf-native-inference-controller", "version": "1", "sourceSha": source,
		"entrypoint": "tools/mac-inference/runtime-controller.mjs", "activationAuthorized": false,
		"node":     map[string]any{"path": node, "version": "v26.5.0", "sha256": nativeHash([]byte("fixture node executable"))},
		"contract": map[string]any{"schemaVersion": 1, "version": "1", "actionType": ManagedInferenceActionType, "operations": []string{"activate", "rollback"}, "platform": "darwin", "architecture": "arm64", "minimumNode": "22.18.0"},
		"files":    []map[string]any{{"path": "tools/mac-inference/runtime-controller.mjs", "sizeBytes": 18, "sha256": nativeHash([]byte("fixture controller"))}}}
	raw, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(controller, "controller-manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	clock := time.Now().UTC()
	original := nativeSign(t, Envelope{Version: Version, SigningKeyID: "fixture", ActionKey: "RA-NATIVE", NodeID: "edge_1", ActionType: ManagedInferenceActionType,
		Nonce: "nonce-native", IssuedAt: clock.Format(time.RFC3339Nano), ExpiresAt: clock.Add(4 * time.Minute).Format(time.RFC3339Nano), Parameters: managedParameters(t, nil)}, key)
	canonical, _ := CanonicalEnvelope(original.Envelope)
	admissionParameters, _ := json.Marshal(map[string]any{"schemaVersion": 1, "ready": true, "requestDigest": nativeHash(canonical), "leaseId": "NPEL-A123456789",
		"ownerSessionId": "fixture-owner", "branchName": "codex/mac-inference-activation", "quiescenceRunId": "QR-fixture", "approvedChangeRequestId": "CR-fixture"})
	proof := nativeSign(t, Envelope{Version: Version, SigningKeyID: "fixture", ActionKey: original.ActionKey, NodeID: original.NodeID, ActionType: "inference.runtime.admission",
		Nonce: "nonce-admission", IssuedAt: clock.Format(time.RFC3339Nano), ExpiresAt: clock.Add(25 * time.Second).Format(time.RFC3339Nano), Parameters: admissionParameters}, key)
	called := false
	h := &NativeManagedInferenceHandler{Config: NativeInferenceConfig{StateDirectory: root, EdgeStateDirectory: edgeState, ControllerRoot: controller,
		ControllerManifestSHA256: nativeHash(raw), ControllerSourceSHA: source, PublicKeyFile: filepath.Join(root, "public.pem"), BaselineEngine: filepath.Join(root, "baseline")},
		NodeID: original.NodeID, PublicKey: pub, Now: func() time.Time { return clock },
		Admission: func(context.Context, SignedEnvelope) (SignedEnvelope, error) { return proof, nil },
		Run: func(_ context.Context, command NativeInferenceCommand) ([]byte, error) {
			called = true
			if command.Program != node || command.Args[0] != entry {
				t.Fatal("caller chose a native executable")
			}
			for _, value := range command.Env {
				if strings.HasPrefix(value, "NODE_OPTIONS=") || strings.HasPrefix(value, "NODE_PATH=") {
					t.Fatal("injected Node environment forwarded")
				}
			}
			if !strings.Contains(string(command.Input), original.Signature) {
				t.Fatal("original signed envelope missing")
			}
			return json.Marshal(map[string]any{"ok": true, "result": map[string]any{"status": "active", "settlement": "confirmed"},
				"evidence": map[string]any{"schemaVersion": 1, "nativeStatus": "active", "settlement": "confirmed", "actionKey": original.ActionKey, "requestDigest": nativeHash(canonical), "sourceSha": source}})
		}}
	return h, original, entry, &called
}

func TestNativeManagedHandlerUsesOnlyVerifiedSourceAndOriginalSignedRequest(t *testing.T) {
	h, original, _, called := nativeHandlerFixture(t)
	t.Setenv("NODE_OPTIONS", "--require /untrusted-module.js")
	output, err := h.Execute(context.Background(), original)
	if err != nil || !*called || output.Evidence["nativeStatus"] != "active" {
		t.Fatalf("native source entry did not run: %v %+v", err, output)
	}
}

func TestNativeManagedHandlerRefusesChangedSourceBeforeSubprocess(t *testing.T) {
	h, original, entry, called := nativeHandlerFixture(t)
	if err := os.Chmod(entry, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte("modified controller"), 0600); err != nil {
		t.Fatal(err)
	}
	output, err := h.Execute(context.Background(), original)
	if err == nil || *called || output.Evidence["nativeStatus"] != "not-started" {
		t.Fatalf("changed source admitted: %v %+v", err, output)
	}
}

func TestNativeManagedHandlerRefusesUnsignedAdmissionBeforeSubprocess(t *testing.T) {
	h, original, _, called := nativeHandlerFixture(t)
	h.Admission = func(context.Context, SignedEnvelope) (SignedEnvelope, error) { return SignedEnvelope{}, nil }
	output, err := h.Execute(context.Background(), original)
	if err == nil || *called || output.Evidence["nativeStatus"] != "not-started" {
		t.Fatalf("unsigned admission admitted: %v %+v", err, output)
	}
}

func TestNativeSourceMismatchRetainsOriginalReceiptBinding(t *testing.T) {
	h, original, _, called := nativeHandlerFixture(t)
	h.Config.ControllerSourceSHA = strings.Repeat("b", 40)
	output, err := h.Execute(context.Background(), original)
	canonical, canonicalErr := CanonicalEnvelope(original.Envelope)
	if canonicalErr != nil {
		t.Fatal(canonicalErr)
	}
	if err == nil || *called || output.Evidence["nativeStatus"] != "not-started" || output.Evidence["requestDigest"] != nativeHash(canonical) || output.Evidence["sourceSha"] != strings.Repeat("a", 40) {
		t.Fatalf("known nonexecution lost its original signed receipt binding: %v %+v", err, output)
	}
}

func TestNativeExpiryAfterExecutorAdmissionRetainsBoundNonexecutionAndConsumedNonce(t *testing.T) {
	h, original, _, called := nativeHandlerFixture(t)
	expiry, err := time.Parse(time.RFC3339Nano, original.ExpiresAt)
	if err != nil {
		t.Fatal(err)
	}
	admittedAt := expiry.Add(-time.Millisecond)
	journal, err := OpenReplayJournal(t.TempDir(), admittedAt)
	if err != nil {
		t.Fatal(err)
	}
	h.Now = func() time.Time { return expiry }
	admissions := 0
	prior := h.Admission
	h.Admission = func(ctx context.Context, signed SignedEnvelope) (SignedEnvelope, error) {
		admissions++
		return prior(ctx, signed)
	}
	executor := Executor{NodeID: h.NodeID, PublicKey: h.PublicKey, Journal: journal, Now: func() time.Time { return admittedAt }, ManagedInference: h}
	output, err := executor.Execute(context.Background(), original)
	canonical, _ := CanonicalEnvelope(original.Envelope)
	if err == nil || *called || admissions != 0 || !journal.Has(original.Nonce, admittedAt) || output.Evidence["requestDigest"] != nativeHash(canonical) || output.Evidence["sourceSha"] != strings.Repeat("a", 40) || output.Evidence["nativeStatus"] != "not-started" || output.Evidence["settlement"] != "confirmed" {
		t.Fatalf("expired known nonexecution lost binding or executed: %v admissions=%d output=%+v", err, admissions, output)
	}
	if _, err = executor.Execute(context.Background(), original); err != ErrNonceConsumed {
		t.Fatalf("expiry refusal permitted replay: %v", err)
	}
}

func TestNativeExpiredInvalidAuthorityCannotProduceBoundReceipt(t *testing.T) {
	for _, kind := range []string{"signature", "node"} {
		t.Run(kind, func(t *testing.T) {
			h, original, _, called := nativeHandlerFixture(t)
			expiry, _ := time.Parse(time.RFC3339Nano, original.ExpiresAt)
			h.Now = func() time.Time { return expiry }
			if kind == "signature" {
				original.Signature = strings.Repeat("A", 86)
			} else {
				h.NodeID = "another-node"
			}
			output, err := h.Execute(context.Background(), original)
			if err == nil || *called || output.Evidence["requestDigest"] != nil {
				t.Fatalf("unverified expiry produced binding: %v %+v", err, output)
			}
		})
	}
}
