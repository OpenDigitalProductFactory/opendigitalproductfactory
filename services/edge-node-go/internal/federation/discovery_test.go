package federation

import (
	"context"
	"testing"
	"time"
)

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
