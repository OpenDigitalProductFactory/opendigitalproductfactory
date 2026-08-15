package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestFetchAdapters_usesAuthenticatedGetAndDecodesTLSAndClientPolicy(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/api/v1/edge/adapters" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer dpfedge_NODE" {
			t.Errorf("authorization = %q", got)
		}
		_ = json.NewEncoder(w).Encode(AdaptersResponse{
			OK: true,
			Adapters: []AdapterConfig{{
				ID:            "conn-1",
				ConnectionKey: "unifi:192.168.0.1",
				Name:          "Cloud Gateway",
				CollectorType: "unifi",
				EndpointURL:   "https://192.168.0.1",
				APIKey:        "secret",
				Configuration: AdapterConfiguration{
					Site:            "default",
					DiscoverClients: true,
					TLSInsecure:     true,
				},
			}},
		})
	})

	got, err := c.FetchAdapters(context.Background(), "dpfedge_NODE")
	if err != nil {
		t.Fatalf("FetchAdapters: %v", err)
	}
	if len(got.Adapters) != 1 {
		t.Fatalf("adapter count = %d", len(got.Adapters))
	}
	adapter := got.Adapters[0]
	if !adapter.Configuration.TLSInsecure || !adapter.Configuration.DiscoverClients {
		t.Fatalf("configuration lost: %+v", adapter.Configuration)
	}
}

func TestFetchAdapters_preservesStructuredHTTPError(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(AuthorityErrorBody{
			Error:   "scope_disallowed",
			Message: "trusted edge required",
		})
	})

	_, err := c.FetchAdapters(context.Background(), "dpfedge_PENDING")
	if err == nil {
		t.Fatal("expected error")
	}
	if got := err.Error(); got == "" || got == "trusted edge required" {
		t.Fatalf("expected structured HTTP context, got %q", got)
	}
}
