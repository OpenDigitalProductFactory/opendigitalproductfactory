package collect

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCollectUnifiOfficial_buildsPhysicalHierarchyAndClients(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/proxy/network/integration/v1/sites", func(w http.ResponseWriter, r *http.Request) {
		assertAPIKey(t, r)
		writeJSON(t, w, map[string]any{
			"offset": 0, "limit": 100, "count": 1, "totalCount": 1,
			"data": []any{map[string]any{"id": "site-uuid", "internalReference": "default", "name": "Default"}},
		})
	})
	mux.HandleFunc("/proxy/network/integration/v1/sites/site-uuid/devices", func(w http.ResponseWriter, r *http.Request) {
		assertAPIKey(t, r)
		writeJSON(t, w, map[string]any{
			"offset": 0, "limit": 100, "count": 3, "totalCount": 3,
			"data": []any{
				map[string]any{"id": "gw", "macAddress": "9c:05:d6:de:8d:3f", "ipAddress": "192.168.0.1", "name": "Cloud Gateway Ultra", "model": "UCG-Ultra", "state": "ONLINE", "features": []string{"routing"}},
				map[string]any{"id": "sw", "macAddress": "d0:21:f9:df:56:92", "ipAddress": "192.168.0.2", "name": "US 8 PoE 150W", "model": "US-8-150W", "state": "ONLINE", "features": []string{"switching"}},
				map[string]any{"id": "ap", "macAddress": "fc:ec:da:bc:a5:49", "ipAddress": "192.168.0.3", "name": "U7 Pro", "model": "U7-Pro", "state": "ONLINE", "features": []string{"accessPoint"}},
			},
		})
	})
	for id, parent := range map[string]string{"gw": "", "sw": "gw", "ap": "sw"} {
		id, parent := id, parent
		mux.HandleFunc("/proxy/network/integration/v1/sites/site-uuid/devices/"+id, func(w http.ResponseWriter, r *http.Request) {
			assertAPIKey(t, r)
			body := map[string]any{"id": id, "uplink": nil, "interfaces": map[string]any{"ports": []any{}}}
			if parent != "" {
				body["uplink"] = map[string]any{"deviceId": parent}
			}
			writeJSON(t, w, body)
		})
	}
	mux.HandleFunc("/proxy/network/integration/v1/sites/site-uuid/clients", func(w http.ResponseWriter, r *http.Request) {
		assertAPIKey(t, r)
		writeJSON(t, w, map[string]any{
			"offset": 0, "limit": 100, "count": 1, "totalCount": 1,
			"data": []any{map[string]any{
				"id": "client-1", "macAddress": "00:11:22:33:44:55", "ipAddress": "192.168.0.40",
				"name": "LG Smart Dryer", "type": "WIRED", "access": map[string]any{"deviceId": "sw", "port": 4, "type": "WIRED"},
			}},
		})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	result := CollectUnifi(context.Background(), []UnifiConfig{{
		ConnectionID: "conn-1", ControllerURL: server.URL, APIKey: "secret", Site: "default", DiscoverClients: true,
	}})

	if len(result.Warnings) != 0 {
		t.Fatalf("warnings = %v", result.Warnings)
	}
	assertItem(t, result.Items, "unifi:9c:05:d6:de:8d:3f", "gateway")
	assertItem(t, result.Items, "unifi:d0:21:f9:df:56:92", "switch")
	assertItem(t, result.Items, "unifi:fc:ec:da:bc:a5:49", "access_point")
	assertItem(t, result.Items, "unifi-client:00:11:22:33:44:55", "network_client")
	assertRelationship(t, result.Relationships, "unifi:9c:05:d6:de:8d:3f", "unifi:d0:21:f9:df:56:92", "HOSTS")
	assertRelationship(t, result.Relationships, "unifi:d0:21:f9:df:56:92", "unifi:fc:ec:da:bc:a5:49", "HOSTS")
	assertRelationship(t, result.Relationships, "unifi-client:00:11:22:33:44:55", "unifi:d0:21:f9:df:56:92", "CONNECTS_TO")
}

func TestCollectUnifiOfficial_zeroDevicesIsDegraded(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/proxy/network/integration/v1/sites", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]any{"offset": 0, "limit": 100, "count": 1, "totalCount": 1, "data": []any{map[string]any{"id": "site-uuid", "internalReference": "default", "name": "Default"}}})
	})
	mux.HandleFunc("/proxy/network/integration/v1/sites/site-uuid/devices", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]any{"offset": 0, "limit": 100, "count": 0, "totalCount": 0, "data": []any{}})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	result := CollectUnifi(context.Background(), []UnifiConfig{{ControllerURL: server.URL, APIKey: "secret", Site: "default"}})
	if !containsWarning(result.Warnings, "unifi_no_devices") {
		t.Fatalf("warnings = %v, want unifi_no_devices", result.Warnings)
	}
}

func TestCollectUnifiOfficial_doesNotFallbackAfterAuthFailure(t *testing.T) {
	legacyCalled := false
	mux := http.NewServeMux()
	mux.HandleFunc("/proxy/network/integration/v1/sites", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	mux.HandleFunc("/proxy/network/api/", func(w http.ResponseWriter, _ *http.Request) {
		legacyCalled = true
		writeJSON(t, w, map[string]any{"data": []any{}})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	result := CollectUnifi(context.Background(), []UnifiConfig{{ControllerURL: server.URL, APIKey: "bad", Site: "default"}})
	if !containsWarning(result.Warnings, "unifi_auth_failed") {
		t.Fatalf("warnings = %v, want auth failure", result.Warnings)
	}
	if legacyCalled {
		t.Fatal("legacy endpoint called after auth failure")
	}
}

func assertAPIKey(t *testing.T, r *http.Request) {
	t.Helper()
	if got := r.Header.Get("X-API-Key"); got != "secret" {
		t.Errorf("X-API-Key = %q", got)
	}
}

func writeJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Fatalf("encode fixture: %v", err)
	}
}

func assertItem(t *testing.T, items []Item, key, itemType string) {
	t.Helper()
	for _, item := range items {
		if item.ObservedKey == key && item.ItemType == itemType {
			return
		}
	}
	t.Fatalf("item %s (%s) not found: %+v", key, itemType, items)
}

func assertRelationship(t *testing.T, relationships []Relationship, from, to, relationshipType string) {
	t.Helper()
	for _, relationship := range relationships {
		if relationship.FromObservedKey == from && relationship.ToObservedKey == to && relationship.RelationshipType == relationshipType {
			return
		}
	}
	t.Fatalf("relationship %s -%s-> %s not found: %+v", from, relationshipType, to, relationships)
}

func containsWarning(warnings []string, want string) bool {
	for _, warning := range warnings {
		if warning == want || strings.HasPrefix(warning, want+":") {
			return true
		}
	}
	return false
}
