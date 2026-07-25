package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClaimAndReportActionsUseBearerAuthenticatedActionEndpoints(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer dpfedge_test" {
			t.Fatalf("missing bearer auth")
		}
		switch r.URL.Path {
		case "/api/v1/edge/actions/claim":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "claimed": []any{map[string]any{
				"version": "dpf.edge-action/1", "signingKeyId": "key-1", "actionKey": "RA-1",
				"nodeId": "edge_1", "actionType": "inventory.collect", "parameters": map[string]any{},
				"nonce": "nonce-1", "issuedAt": "2026-07-22T02:29:30Z", "expiresAt": "2026-07-22T02:31:30Z", "signature": "sig",
			}}})
		case "/api/v1/edge/actions/result":
			var body ActionResultRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body.ActionKey != "RA-1" || body.Outcome != "succeeded" {
				t.Fatalf("unexpected report: %#v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, err := New(Options{AuthorityURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}

	claimed, err := client.ClaimActions(context.Background(), "dpfedge_test", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed) != 1 || claimed[0].ActionType != "inventory.collect" {
		t.Fatalf("unexpected claim: %#v", claimed)
	}
	if err := client.ReportAction(context.Background(), "dpfedge_test", ActionResultRequest{ActionKey: "RA-1", Outcome: "succeeded", Evidence: map[string]any{"source": "native"}}); err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatalf("requests=%d want 2", requests)
	}
}

func TestRegisterActionCertificateUsesMachineAuthenticatedEndpoint(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/api/v1/edge/actions/certificates/register" || r.Header.Get("Authorization") != "Bearer dpfedge_test" {
			t.Fatalf("unexpected request %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer server.Close()
	client, _ := New(Options{AuthorityURL: server.URL})
	if err := client.RegisterActionCertificate(context.Background(), "dpfedge_test"); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("register endpoint was not called")
	}
}
