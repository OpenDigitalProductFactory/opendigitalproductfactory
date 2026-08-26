// Package preflight answers one question before the agent enrols: if this node
// cannot reach its Authority, WHY?
//
// BI-BB919901. Before this, `enrollOnce` returned the raw wrapped error and the
// operator got a transport message with no cause. Every likely failure was
// documented in prose and detected by nothing:
//
//   - the Authority URL is unreachable from THIS host (the portal-side renderer
//     catches a loopback URL when the command is issued, but nothing checked it
//     where the command actually runs);
//   - DNS does not resolve the Authority host;
//   - the bootstrap token is missing, expired, or already consumed;
//   - the node enrolled fine and is still `pending`, so it submits and is
//     refused — indistinguishable from a broken node from the operator's chair;
//   - CLOCK SKEW. The Authority's freshness window rejects submissions whose
//     observedAt drifts too far from server time, and edge-node-multi-host.md
//     records that fresh VMs without NTP drift tens of seconds. Silent and
//     confusing, with an obvious diagnostic.
//
// Shape follows Datadog's agent `diagnose`: run the checks the operator cannot
// run themselves, and name ONE cause rather than dumping a stack.
//
// Deliberately pure where it can be. Evaluate() takes already-gathered
// observations and returns a verdict, so every branch is unit-testable without a
// network, a clock, or a host.
package preflight

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Cause is the closed set of reasons a node cannot talk to its Authority.
// Closed so an operator surface can branch on it, and so a new failure mode has
// to be named rather than folded into a generic error.
type Cause string

const (
	CauseOK                 Cause = "ok"
	CauseAuthorityMissing   Cause = "authority-url-missing"
	CauseAuthorityMalformed Cause = "authority-url-malformed"
	CauseAuthorityLoopback  Cause = "authority-url-loopback"
	CauseDNSUnresolved      Cause = "authority-dns-unresolved"
	CauseUnreachable        Cause = "authority-unreachable"
	CauseTLSUntrusted       Cause = "authority-tls-untrusted"
	CauseTokenMissing       Cause = "bootstrap-token-missing"
	CauseTokenRejected      Cause = "bootstrap-token-rejected"
	CauseClockSkew          Cause = "clock-skew"
	CauseNoLANVisibility    Cause = "no-lan-visibility"
)

// Observations are the facts a caller gathers from the host and the network.
// Every field is optional in the sense that a zero value means "not observed";
// Evaluate reports what it can and never invents a cause it did not see.
type Observations struct {
	AuthorityURL string

	// DNSResolved is false only when a lookup was ATTEMPTED and failed.
	DNSAttempted bool
	DNSResolved  bool

	// Reachable is false only when a request was ATTEMPTED and failed.
	ReachAttempted bool
	Reachable      bool
	// ReachError is the transport error, carried for the detail line only.
	ReachError string
	// TLSUntrusted distinguishes a certificate refusal from a dead socket.
	TLSUntrusted bool

	// HTTPStatus from the health probe, 0 when none was received.
	HTTPStatus int

	BootstrapToken string
	// AlreadyEnrolled suppresses the missing-token cause: a node with state
	// does not need one.
	AlreadyEnrolled bool

	// Clock comparison. Both zero means it was not observed.
	LocalTime     time.Time
	AuthorityTime time.Time
	// MaxSkew tolerated before it is reported. The Authority's freshness window
	// is the real bound; this is the client-side warning ahead of it.
	MaxSkew time.Duration

	// LANAddresses the host can actually see. Empty on a container that has no
	// view of the real network — the Docker Desktop case, which enrols happily
	// and then reports nothing useful.
	LANAddresses []string
}

// Result is one named cause plus operator-readable text.
type Result struct {
	Cause Cause
	// OK is true only for CauseOK.
	OK bool
	// Summary is one line naming what is wrong.
	Summary string
	// Remedy is what to do about it, or empty when there is nothing to do.
	Remedy string
	// Detail carries the underlying error, for the log rather than the headline.
	Detail string
}

const defaultMaxSkew = 30 * time.Second

func loopbackHost(host string) bool {
	h := strings.ToLower(host)
	switch h {
	case "localhost", "0.0.0.0", "::1", "[::1]", "host.docker.internal":
		return true
	}
	return strings.HasPrefix(h, "127.")
}

// Evaluate returns the FIRST cause that explains the failure, in dependency
// order: a malformed URL explains a DNS failure, and a DNS failure explains an
// unreachable host, so reporting the deepest one is what stops an operator
// chasing a symptom.
//
// Pure and total. Equal observations always produce an equal result.
func Evaluate(obs Observations) Result {
	if strings.TrimSpace(obs.AuthorityURL) == "" {
		return Result{
			Cause:   CauseAuthorityMissing,
			Summary: "No Authority URL is set.",
			Remedy:  "Set DPF_AUTHORITY_URL to the address of your DPF portal, as shown on Platform > Edge Nodes.",
		}
	}

	parsed, err := url.Parse(obs.AuthorityURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return Result{
			Cause:   CauseAuthorityMalformed,
			Summary: fmt.Sprintf("The Authority URL %q is not a usable http or https address.", obs.AuthorityURL),
			Remedy:  "Copy the address from Platform > Edge Nodes rather than typing it.",
		}
	}

	if loopbackHost(parsed.Hostname()) {
		return Result{
			Cause: CauseAuthorityLoopback,
			Summary: fmt.Sprintf(
				"The Authority URL points at %s, which means THIS machine, not the portal.",
				parsed.Hostname()),
			Remedy: "Use the portal's LAN address or hostname. A localhost URL only works on the machine running the portal itself.",
		}
	}

	if obs.DNSAttempted && !obs.DNSResolved {
		return Result{
			Cause:   CauseDNSUnresolved,
			Summary: fmt.Sprintf("The name %s does not resolve from this machine.", parsed.Hostname()),
			Remedy:  "Check DNS, or use the portal's IP address instead of its name.",
		}
	}

	if obs.ReachAttempted && !obs.Reachable {
		if obs.TLSUntrusted {
			return Result{
				Cause:   CauseTLSUntrusted,
				Summary: fmt.Sprintf("%s answered, but its certificate is not trusted by this machine.", parsed.Host),
				Detail:  obs.ReachError,
				Remedy:  "Install your organization's CA certificate on this machine, or use the http address on a trusted LAN.",
			}
		}
		return Result{
			Cause:   CauseUnreachable,
			Summary: fmt.Sprintf("Cannot reach %s from this machine.", parsed.Host),
			Detail:  obs.ReachError,
			Remedy:  "Check that the portal is running, that the port is open, and that a firewall between the two machines allows it.",
		}
	}

	// Token checks come AFTER reachability: a rejected token and an unreachable
	// portal look the same to an operator, and only one of them is about the token.
	if !obs.AlreadyEnrolled && strings.TrimSpace(obs.BootstrapToken) == "" {
		return Result{
			Cause:   CauseTokenMissing,
			Summary: "No enrollment token is set, and this node has never enrolled.",
			Remedy:  "Issue a token on Platform > Edge Nodes and re-run the command it gives you.",
		}
	}

	if obs.HTTPStatus == 401 || obs.HTTPStatus == 403 {
		return Result{
			Cause:   CauseTokenRejected,
			Summary: "The Authority refused this enrollment token.",
			Remedy:  "Tokens are single-use and time-limited. Issue a fresh one on Platform > Edge Nodes.",
		}
	}

	if !obs.LocalTime.IsZero() && !obs.AuthorityTime.IsZero() {
		maxSkew := obs.MaxSkew
		if maxSkew <= 0 {
			maxSkew = defaultMaxSkew
		}
		skew := obs.LocalTime.Sub(obs.AuthorityTime)
		if skew < 0 {
			skew = -skew
		}
		if skew > maxSkew {
			return Result{
				Cause: CauseClockSkew,
				Summary: fmt.Sprintf(
					"This machine's clock is %s away from the portal's.", skew.Round(time.Second)),
				Remedy: "Enable NTP time sync on this machine. The portal rejects observations whose timestamps drift too far, so discovery will look broken while the clocks disagree.",
			}
		}
	}

	// Reached last on purpose. The node CAN enrol; it just will not see anything
	// worth reporting, which is the most misleading failure of all because every
	// status reads healthy.
	if obs.ReachAttempted && obs.Reachable && len(obs.LANAddresses) == 0 {
		return Result{
			Cause:   CauseNoLANVisibility,
			Summary: "This node can reach the portal but cannot see any real network interface.",
			Remedy:  "A container on Docker Desktop sees only its own virtual network. Use the native agent for this operating system, or run the container with host networking on Linux.",
		}
	}

	return Result{Cause: CauseOK, OK: true, Summary: "Ready to enrol."}
}

// Format renders a result for a terminal: one headline, then what to do.
func Format(r Result) string {
	if r.OK {
		return "preflight: ok — ready to enrol."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "preflight: %s\n  %s", r.Cause, r.Summary)
	if r.Remedy != "" {
		fmt.Fprintf(&b, "\n  what to do: %s", r.Remedy)
	}
	if r.Detail != "" {
		fmt.Fprintf(&b, "\n  detail: %s", r.Detail)
	}
	return b.String()
}
