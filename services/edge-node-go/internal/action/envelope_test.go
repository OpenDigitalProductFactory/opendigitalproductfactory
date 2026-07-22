package action

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

var now = time.Date(2026, 7, 22, 2, 30, 0, 0, time.UTC)

func signedFixture(t *testing.T, mutate func(*Envelope)) (SignedEnvelope, ed25519.PublicKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	envelope := Envelope{
		Version: "dpf.edge-action/1", SigningKeyID: "edge-action-signing-v1",
		ActionKey: "RA-1", NodeID: "edge_1", ActionType: "inventory.collect",
		Parameters: json.RawMessage(`{"nested":{"z":2,"a":1},"include":["os","network"]}`),
		Nonce:      "nonce_0123456789abcdef",
		IssuedAt:   now.Add(-30 * time.Second).Format(time.RFC3339Nano),
		ExpiresAt:  now.Add(90 * time.Second).Format(time.RFC3339Nano),
	}
	if mutate != nil {
		mutate(&envelope)
	}
	canonical, err := CanonicalEnvelope(envelope)
	if err != nil {
		t.Fatal(err)
	}
	return SignedEnvelope{Envelope: envelope, Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, canonical))}, pub
}

func TestVerifyEnvelopeAcceptsValidNodeBoundSingleUseAction(t *testing.T) {
	signed, pub := signedFixture(t, nil)
	if err := VerifyEnvelope(signed, pub, "edge_1", now, func(string) bool { return false }); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if err := VerifyEnvelope(signed, pub, "edge_1", now, func(string) bool { return true }); err != ErrNonceConsumed {
		t.Fatalf("got %v want ErrNonceConsumed", err)
	}
}

func TestVerifyEnvelopeRejectsTamperWrongNodeAndExpiry(t *testing.T) {
	signed, pub := signedFixture(t, nil)
	signed.Parameters = json.RawMessage(`{"include":["secrets"]}`)
	if err := VerifyEnvelope(signed, pub, "edge_1", now, nil); err != ErrInvalidSignature {
		t.Fatalf("tamper: %v", err)
	}

	signed, pub = signedFixture(t, nil)
	if err := VerifyEnvelope(signed, pub, "edge_2", now, nil); err != ErrWrongNode {
		t.Fatalf("wrong node: %v", err)
	}

	signed, pub = signedFixture(t, func(e *Envelope) { e.ExpiresAt = now.Add(-time.Second).Format(time.RFC3339Nano) })
	if err := VerifyEnvelope(signed, pub, "edge_1", now, nil); err != ErrExpired {
		t.Fatalf("expired: %v", err)
	}
}

func TestCanonicalEnvelopeMatchesTypeScriptSortedKeys(t *testing.T) {
	signed, _ := signedFixture(t, nil)
	canonical, err := CanonicalEnvelope(signed.Envelope)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"actionKey":"RA-1","actionType":"inventory.collect","expiresAt":"2026-07-22T02:31:30Z","issuedAt":"2026-07-22T02:29:30Z","nodeId":"edge_1","nonce":"nonce_0123456789abcdef","parameters":{"include":["os","network"],"nested":{"a":1,"z":2}},"signingKeyId":"edge-action-signing-v1","version":"dpf.edge-action/1"}`
	if string(canonical) != want {
		t.Fatalf("canonical mismatch\n got: %s\nwant: %s", canonical, want)
	}
}
