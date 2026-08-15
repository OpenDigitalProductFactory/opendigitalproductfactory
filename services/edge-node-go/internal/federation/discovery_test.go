package federation

import (
	"context"
	"testing"
	"time"

	"github.com/betamos/zeroconf"
)

func TestServiceTypeUsesZeroconfTypeInputWithoutDomainSuffix(t *testing.T) {
	typeDef := zeroconf.NewType(ServiceType)
	if ServiceType != "_dpf-federation._tcp" {
		t.Fatalf("ServiceType = %q; zeroconf.NewType requires the service type without .local.", ServiceType)
	}
	if typeDef.Domain != "local" {
		t.Fatalf("zeroconf domain = %q, want local", typeDef.Domain)
	}
	if typeDef.String() != "_dpf-federation._tcp.local" {
		t.Fatalf("resolved service type = %q", typeDef.String())
	}
}

func TestAdvertisementTXTContainsOnlyPrivacySafeAllowList(t *testing.T) {
	txt := AdvertisementTXT("ephemeral-123", "8f31c9a2", "https")
	want := []string{
		"protocol=1",
		"install=ephemeral-123",
		"caps=8f31c9a2",
		"pair=/connect/pair",
		"scheme=https",
	}
	if len(txt) != len(want) {
		t.Fatalf("got %d TXT values, want %d: %#v", len(txt), len(want), txt)
	}
	for i := range want {
		if txt[i] != want[i] {
			t.Errorf("txt[%d] = %q, want %q", i, txt[i], want[i])
		}
	}
}

func TestRotatingDiscoveryIDIsStableInsideWindowAndRotatesAfter(t *testing.T) {
	secret := []byte("installation-local-secret-not-advertised")
	window := 15 * time.Minute
	first := RotatingDiscoveryID(secret, time.Unix(1_720_000_000, 0), window)
	same := RotatingDiscoveryID(secret, time.Unix(1_720_000_100, 0), window)
	next := RotatingDiscoveryID(secret, time.Unix(1_720_001_000, 0), window)
	if first != same {
		t.Fatalf("ID changed inside rotation window: %q != %q", first, same)
	}
	if first == next {
		t.Fatalf("ID did not rotate after window: %q", first)
	}
}

func TestParseServiceRejectsUnexpectedTXTAndInsecurePairing(t *testing.T) {
	_, err := ParseService(ServiceRecord{
		Host: "peer.local.",
		Port: 3000,
		TXT: []string{
			"protocol=1",
			"install=ephemeral-123",
			"caps=8f31c9a2",
			"pair=/connect/pair",
			"scheme=http",
			"organization=Arcamanus",
		},
	})
	if err == nil {
		t.Fatal("expected privacy-unsafe TXT record to be rejected")
	}
}

func TestParseServiceCarriesHTTPCandidateWithoutMakingItTrusted(t *testing.T) {
	candidate, err := ParseService(ServiceRecord{
		Host: "dpf-ephemeral.local.",
		Port: 3000,
		TXT:  AdvertisementTXT("ephemeral-123", "8f31c9a2", "http"),
	})
	if err != nil {
		t.Fatalf("ParseService: %v", err)
	}
	if candidate.Endpoint != "http://dpf-ephemeral.local:3000" {
		t.Fatalf("endpoint = %q", candidate.Endpoint)
	}
}

func TestRunRejectsAuthorityPortOutsideUint16(t *testing.T) {
	for _, authorityURL := range []string{"http://peer.local:0", "http://peer.local:65536"} {
		err := Run(context.Background(), DiscoveryOptions{
			AuthorityURL: authorityURL,
			Secret:       []byte("installation-local-secret"),
		}, func(context.Context, []Candidate) error { return nil })
		if err == nil {
			t.Fatalf("Run(%q) accepted an out-of-range port", authorityURL)
		}
	}
}

func TestCandidateSubmissionGateSkipsEmptySnapshots(t *testing.T) {
	gate := candidateSubmissionGate{}
	if gate.shouldSubmit(nil, time.Unix(1_720_000_000, 0), 90*time.Second) {
		t.Fatal("empty candidate snapshot should not be submitted")
	}
}

func TestCandidateSubmissionGateSubmitsChangesAndRefreshesBeforeTTL(t *testing.T) {
	now := time.Unix(1_720_000_000, 0)
	refresh := 90 * time.Second
	first := []Candidate{{DiscoveryID: "peer-a", Endpoint: "https://peer-a.local:3000"}}
	changed := []Candidate{{DiscoveryID: "peer-b", Endpoint: "https://peer-b.local:3000"}}
	gate := candidateSubmissionGate{}

	if !gate.shouldSubmit(first, now, refresh) {
		t.Fatal("first non-empty snapshot should be submitted")
	}
	gate.markSubmitted(first, now)
	if gate.shouldSubmit(first, now.Add(15*time.Second), refresh) {
		t.Fatal("unchanged snapshot should be suppressed before refresh interval")
	}
	if !gate.shouldSubmit(changed, now.Add(30*time.Second), refresh) {
		t.Fatal("changed snapshot should be submitted on the next observation tick")
	}
	if !gate.shouldSubmit(first, now.Add(refresh), refresh) {
		t.Fatal("unchanged snapshot should refresh before the Authority TTL")
	}
}

func TestCandidateSubmissionGateRetriesWhenSubmissionWasNotMarkedSuccessful(t *testing.T) {
	now := time.Unix(1_720_000_000, 0)
	snapshot := []Candidate{{DiscoveryID: "peer-a", Endpoint: "https://peer-a.local:3000"}}
	gate := candidateSubmissionGate{}

	if !gate.shouldSubmit(snapshot, now, 90*time.Second) {
		t.Fatal("first attempt should submit")
	}
	if !gate.shouldSubmit(snapshot, now.Add(15*time.Second), 90*time.Second) {
		t.Fatal("failed attempt must remain eligible on the next observation tick")
	}
}
