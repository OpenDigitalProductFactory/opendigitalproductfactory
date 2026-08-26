package preflight

import (
	"strings"
	"testing"
	"time"
)

// A node that is genuinely fine. Every other case mutates this.
func healthy() Observations {
	return Observations{
		AuthorityURL:   "https://portal.example.internal:3000",
		DNSAttempted:   true,
		DNSResolved:    true,
		ReachAttempted: true,
		Reachable:      true,
		HTTPStatus:     200,
		BootstrapToken: "edgeboot_token",
		LocalTime:      time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC),
		AuthorityTime:  time.Date(2026, 8, 25, 12, 0, 2, 0, time.UTC),
		LANAddresses:   []string{"192.168.1.42"},
	}
}

func TestHealthyNodeIsReady(t *testing.T) {
	got := Evaluate(healthy())
	if !got.OK || got.Cause != CauseOK {
		t.Fatalf("expected ok, got %q: %s", got.Cause, got.Summary)
	}
}

func TestMissingAuthorityURL(t *testing.T) {
	obs := healthy()
	obs.AuthorityURL = "   "
	if got := Evaluate(obs); got.Cause != CauseAuthorityMissing {
		t.Fatalf("got %q", got.Cause)
	}
}

func TestMalformedAuthorityURL(t *testing.T) {
	for _, raw := range []string{"portal.example", "ftp://portal", "://nope", "https://"} {
		obs := healthy()
		obs.AuthorityURL = raw
		if got := Evaluate(obs); got.Cause != CauseAuthorityMalformed {
			t.Fatalf("%q: got %q", raw, got.Cause)
		}
	}
}

// The single most common remote-provisioning footgun: the operator copies a URL
// that only means anything on the portal's own machine.
func TestLoopbackAuthorityURLIsNamed(t *testing.T) {
	for _, raw := range []string{
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://[::1]:3000",
		"http://host.docker.internal:3000",
		"http://0.0.0.0:3000",
	} {
		obs := healthy()
		obs.AuthorityURL = raw
		got := Evaluate(obs)
		if got.Cause != CauseAuthorityLoopback {
			t.Fatalf("%q: got %q", raw, got.Cause)
		}
		if !strings.Contains(got.Remedy, "LAN address") {
			t.Fatalf("%q: remedy does not tell the operator what to use: %q", raw, got.Remedy)
		}
	}
}

// A private LAN address is the INTENDED target, not a fault.
func TestPrivateLANAddressIsNotLoopback(t *testing.T) {
	for _, raw := range []string{
		"http://192.168.1.10:3000",
		"http://10.0.0.5:3000",
		"http://portal.local:3000",
	} {
		obs := healthy()
		obs.AuthorityURL = raw
		if got := Evaluate(obs); !got.OK {
			t.Fatalf("%q: expected ok, got %q", raw, got.Cause)
		}
	}
}

func TestDNSFailureIsNamedBeforeReachability(t *testing.T) {
	obs := healthy()
	obs.DNSResolved = false
	obs.Reachable = false
	// Both would fail; the DNS cause explains the reachability one.
	if got := Evaluate(obs); got.Cause != CauseDNSUnresolved {
		t.Fatalf("got %q", got.Cause)
	}
}

func TestUnreachableAuthority(t *testing.T) {
	obs := healthy()
	obs.Reachable = false
	obs.ReachError = "dial tcp 192.168.1.10:3000: connect: connection refused"
	got := Evaluate(obs)
	if got.Cause != CauseUnreachable {
		t.Fatalf("got %q", got.Cause)
	}
	if got.Detail != obs.ReachError {
		t.Fatalf("transport error should survive as detail, got %q", got.Detail)
	}
	if !strings.Contains(got.Remedy, "firewall") {
		t.Fatalf("remedy should mention the firewall: %q", got.Remedy)
	}
}

func TestUntrustedTLSIsDistinctFromADeadSocket(t *testing.T) {
	obs := healthy()
	obs.Reachable = false
	obs.TLSUntrusted = true
	obs.ReachError = "x509: certificate signed by unknown authority"
	got := Evaluate(obs)
	if got.Cause != CauseTLSUntrusted {
		t.Fatalf("got %q", got.Cause)
	}
	if !strings.Contains(got.Remedy, "CA certificate") {
		t.Fatalf("remedy should name the CA: %q", got.Remedy)
	}
}

func TestMissingTokenOnAFirstRun(t *testing.T) {
	obs := healthy()
	obs.BootstrapToken = ""
	if got := Evaluate(obs); got.Cause != CauseTokenMissing {
		t.Fatalf("got %q", got.Cause)
	}
}

// A node with state does not need a token, and telling it otherwise would send
// the operator to re-issue one for no reason.
func TestEnrolledNodeNeedsNoToken(t *testing.T) {
	obs := healthy()
	obs.BootstrapToken = ""
	obs.AlreadyEnrolled = true
	if got := Evaluate(obs); !got.OK {
		t.Fatalf("expected ok, got %q", got.Cause)
	}
}

func TestRejectedToken(t *testing.T) {
	for _, status := range []int{401, 403} {
		obs := healthy()
		obs.HTTPStatus = status
		got := Evaluate(obs)
		if got.Cause != CauseTokenRejected {
			t.Fatalf("status %d: got %q", status, got.Cause)
		}
		if !strings.Contains(got.Remedy, "single-use") {
			t.Fatalf("remedy should explain single-use tokens: %q", got.Remedy)
		}
	}
}

// An unreachable portal and a rejected token look identical to an operator, so
// reachability is reported first and the token cause never masks it.
func TestUnreachableBeatsTokenCause(t *testing.T) {
	obs := healthy()
	obs.Reachable = false
	obs.BootstrapToken = ""
	if got := Evaluate(obs); got.Cause != CauseUnreachable {
		t.Fatalf("got %q", got.Cause)
	}
}

// The silent one: edge-node-multi-host.md records that fresh VMs without NTP
// drift tens of seconds, and the Authority's freshness window then rejects
// observations while everything else looks healthy.
func TestClockSkewIsNamed(t *testing.T) {
	obs := healthy()
	obs.AuthorityTime = obs.LocalTime.Add(-90 * time.Second)
	got := Evaluate(obs)
	if got.Cause != CauseClockSkew {
		t.Fatalf("got %q", got.Cause)
	}
	if !strings.Contains(got.Remedy, "NTP") {
		t.Fatalf("remedy should name NTP: %q", got.Remedy)
	}
	if !strings.Contains(got.Summary, "1m30s") {
		t.Fatalf("summary should quantify the drift: %q", got.Summary)
	}
}

func TestClockSkewIsSymmetric(t *testing.T) {
	obs := healthy()
	obs.AuthorityTime = obs.LocalTime.Add(90 * time.Second)
	if got := Evaluate(obs); got.Cause != CauseClockSkew {
		t.Fatalf("got %q", got.Cause)
	}
}

func TestSmallSkewIsTolerated(t *testing.T) {
	obs := healthy()
	obs.AuthorityTime = obs.LocalTime.Add(-5 * time.Second)
	if got := Evaluate(obs); !got.OK {
		t.Fatalf("expected ok, got %q", got.Cause)
	}
}

func TestUnobservedClockIsNotAFinding(t *testing.T) {
	obs := healthy()
	obs.LocalTime = time.Time{}
	obs.AuthorityTime = time.Time{}
	if got := Evaluate(obs); !got.OK {
		t.Fatalf("expected ok, got %q", got.Cause)
	}
}

// The worst shape of failure: the node enrols, every status reads healthy, and
// it reports nothing real. That is Docker Desktop.
func TestNoLANVisibilityIsReportedEvenThoughEverythingElsePasses(t *testing.T) {
	obs := healthy()
	obs.LANAddresses = nil
	got := Evaluate(obs)
	if got.Cause != CauseNoLANVisibility {
		t.Fatalf("got %q", got.Cause)
	}
	if !strings.Contains(got.Remedy, "native agent") {
		t.Fatalf("remedy should point at the native agent: %q", got.Remedy)
	}
}

// A real connection problem matters more than what the node can see.
func TestConnectivityBeatsLANVisibility(t *testing.T) {
	obs := healthy()
	obs.Reachable = false
	obs.LANAddresses = nil
	if got := Evaluate(obs); got.Cause != CauseUnreachable {
		t.Fatalf("got %q", got.Cause)
	}
}

func TestEvaluateIsTotalAndDeterministic(t *testing.T) {
	obs := healthy()
	first := Evaluate(obs)
	second := Evaluate(obs)
	if first != second {
		t.Fatalf("not deterministic: %+v vs %+v", first, second)
	}
	// A zero-value Observations must still produce a named cause, never a panic.
	if got := Evaluate(Observations{}); got.Cause != CauseAuthorityMissing {
		t.Fatalf("zero value should name the missing URL, got %q", got.Cause)
	}
}

func TestFormatNamesTheCauseAndTheRemedy(t *testing.T) {
	out := Format(Evaluate(Observations{AuthorityURL: "http://localhost:3000"}))
	for _, want := range []string{string(CauseAuthorityLoopback), "what to do:"} {
		if !strings.Contains(out, want) {
			t.Fatalf("format missing %q:\n%s", want, out)
		}
	}
	if ok := Format(Result{OK: true, Cause: CauseOK}); !strings.Contains(ok, "ok") {
		t.Fatalf("healthy format should say ok: %q", ok)
	}
}
