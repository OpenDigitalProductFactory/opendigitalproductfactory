package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// newTestClient returns a Client wired to a freshly-built httptest.Server.
// The handler does the response shaping; this keeps each test focused on
// one round-trip without macro-mocking.
func newTestClient(t *testing.T, handler http.HandlerFunc) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c, err := New(Options{AuthorityURL: srv.URL, HTTPClient: srv.Client()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c, srv
}

func TestNew_rejectsEmptyURL(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Fatal("expected error for empty AuthorityURL")
	}
}

func TestNew_trimsTrailingSlashes(t *testing.T) {
	c, err := New(Options{AuthorityURL: "http://example.com////"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if c.base != "http://example.com" {
		t.Fatalf("base = %q, want http://example.com", c.base)
	}
}

func TestEnroll_happyPath(t *testing.T) {
	var receivedAuth, receivedCT, receivedAccept, receivedPath string
	var receivedBody EnrollRequest

	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		receivedCT = r.Header.Get("Content-Type")
		receivedAccept = r.Header.Get("Accept")
		receivedPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &receivedBody); err != nil {
			t.Errorf("server-side decode: %v", err)
		}
		metricsSec := 30
		_ = json.NewEncoder(w).Encode(EnrollResponse{
			OK:                   true,
			NodeID:               "edge_abc123",
			NodeToken:            "dpfedge_t0k3n",
			TrustState:           "trusted",
			HeartbeatIntervalSec: 60,
			SweepIntervalSec:     300,
			MetricsIntervalSec:   &metricsSec,
			AcceptedCapabilities: []string{"discovery.network"},
		})
	})

	resp, err := c.Enroll(context.Background(), "dpfboot_BOOT", EnrollRequest{
		DisplayName:            "test-host",
		Platform:               "linux",
		InstallMode:            "container-host",
		Version:                "0.1.0-test",
		AdvertisedCapabilities: []string{"discovery.network"},
	})
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}

	if got, want := receivedPath, "/api/v1/edge/enroll"; got != want {
		t.Errorf("path %q, want %q", got, want)
	}
	if got, want := receivedAuth, "Bearer dpfboot_BOOT"; got != want {
		t.Errorf("auth %q, want %q", got, want)
	}
	if !strings.HasPrefix(receivedCT, "application/json") {
		t.Errorf("content-type %q, want application/json", receivedCT)
	}
	if !strings.Contains(receivedAccept, "application/json") {
		t.Errorf("accept %q, want application/json", receivedAccept)
	}
	if receivedBody.DisplayName != "test-host" {
		t.Errorf("displayName: %q", receivedBody.DisplayName)
	}
	if resp.NodeID != "edge_abc123" || resp.NodeToken != "dpfedge_t0k3n" {
		t.Errorf("response decoded incorrectly: %+v", resp)
	}
	if resp.MetricsIntervalSec == nil || *resp.MetricsIntervalSec != 30 {
		t.Errorf("metricsIntervalSec lost in round-trip: %+v", resp.MetricsIntervalSec)
	}
}

func TestEnroll_returnsHTTPErrorWithStructuredCode(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusGone)
		_ = json.NewEncoder(w).Encode(AuthorityErrorBody{
			Error:   "bootstrap_token_consumed",
			Message: "this token has already been used",
		})
	})

	_, err := c.Enroll(context.Background(), "dpfboot_USED", EnrollRequest{})
	if err == nil {
		t.Fatal("expected error")
	}
	var herr *HTTPError
	if !errors.As(err, &herr) {
		t.Fatalf("error is not *HTTPError: %T", err)
	}
	if herr.Status != http.StatusGone {
		t.Errorf("status %d, want 410", herr.Status)
	}
	if herr.ErrorCode != "bootstrap_token_consumed" {
		t.Errorf("errorCode %q, want bootstrap_token_consumed", herr.ErrorCode)
	}
	if !strings.Contains(herr.Message, "already been used") {
		t.Errorf("message %q lost the structured detail", herr.Message)
	}
}

func TestHeartbeat_happyPath(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/edge/heartbeat" {
			t.Errorf("path %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer dpfedge_NODE" {
			t.Errorf("auth %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(HeartbeatResponse{
			OK:                   true,
			HeartbeatIntervalSec: 60,
			SweepIntervalSec:     300,
			AcceptedCapabilities: []string{"discovery.network"},
			TrustState:           "trusted",
		})
	})

	resp, err := c.Heartbeat(context.Background(), "dpfedge_NODE", HeartbeatRequest{})
	if err != nil {
		t.Fatalf("Heartbeat: %v", err)
	}
	if resp.TrustState != "trusted" {
		t.Errorf("trustState %q", resp.TrustState)
	}
}

func TestHeartbeat_propagatesNodeRevokedAsTerminal(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(AuthorityErrorBody{
			Error:   "node_revoked",
			Message: "this node was revoked by an operator",
		})
	})

	_, err := c.Heartbeat(context.Background(), "dpfedge_OLD", HeartbeatRequest{})
	if err == nil {
		t.Fatal("expected error")
	}
	if !IsRevoked(err) {
		t.Fatalf("IsRevoked(%v) = false, want true", err)
	}
}

func TestSubmitDiscoveryRun_passesEnvelopeThrough(t *testing.T) {
	var receivedEnvelope map[string]any

	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/edge/discovery-runs" {
			t.Errorf("path %q", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &receivedEnvelope)
		_, _ = w.Write([]byte(`{"ok":true,"runKey":"abc"}`))
	})

	envelope := map[string]any{
		"runKey":        "run_test_1",
		"agentMode":     "native",
		"agentVersion":  "0.1.0-go",
		"items":         []any{},
		"relationships": []any{},
	}
	resp, err := c.SubmitDiscoveryRun(context.Background(), "dpfedge_NODE", envelope)
	if err != nil {
		t.Fatalf("SubmitDiscoveryRun: %v", err)
	}
	if receivedEnvelope["runKey"] != "run_test_1" {
		t.Errorf("envelope round-trip lost runKey: %v", receivedEnvelope)
	}
	if resp["ok"] != true {
		t.Errorf("response decoded incorrectly: %v", resp)
	}
}

func TestSubmitFederationCandidates_usesAuthenticatedCandidateRoute(t *testing.T) {
	var received map[string]any
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/edge/federation-candidates" {
			t.Errorf("path %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer dpfedge_NODE" {
			t.Errorf("authorization %q", got)
		}
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	err := c.SubmitFederationCandidates(context.Background(), "dpfedge_NODE", FederationCandidateSnapshot{
		ObservedAt: "2026-07-20T03:00:00Z",
		Candidates: []any{map[string]any{"discoveryId": "ephemeral-1"}},
	})
	if err != nil {
		t.Fatalf("SubmitFederationCandidates: %v", err)
	}
	if received["observedAt"] != "2026-07-20T03:00:00Z" {
		t.Fatalf("snapshot round-trip failed: %#v", received)
	}
}

func TestPost_respectsContextTimeout(t *testing.T) {
	// Server that sleeps longer than the client timeout.
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	})
	c.timeout = 50 * time.Millisecond

	_, err := c.Heartbeat(context.Background(), "dpfedge_X", HeartbeatRequest{})
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestPost_unmarshalsServerErrorBodyAsRawMessage_whenNotJSON(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upstream timeout"))
	})

	_, err := c.Heartbeat(context.Background(), "dpfedge_X", HeartbeatRequest{})
	if err == nil {
		t.Fatal("expected error")
	}
	var herr *HTTPError
	if !errors.As(err, &herr) {
		t.Fatalf("not HTTPError: %T", err)
	}
	if herr.Status != http.StatusBadGateway {
		t.Errorf("status %d", herr.Status)
	}
	if !strings.Contains(herr.Message, "upstream timeout") {
		t.Errorf("raw body lost: %q", herr.Message)
	}
}
