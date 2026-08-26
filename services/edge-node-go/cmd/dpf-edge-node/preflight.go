package main

// `dpf-edge-node --preflight` — gather the host and network facts, then let
// internal/preflight name ONE cause (BI-BB919901).
//
// The rendered install command runs this before enrolling, so an operator who
// mistyped the Authority URL, has no NTP, or is on a Docker Desktop container
// with no LAN visibility learns which of those it is, on the machine where the
// problem actually lives, instead of reading a transport error.
//
// Gathering is here; judging is in internal/preflight, which is pure and fully
// unit-tested. This file only does I/O.

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/collect"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/config"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/preflight"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/state"
)

const preflightTimeout = 8 * time.Second

// gatherPreflight performs the observations. Every probe is individually
// guarded: a probe that cannot run leaves its Attempted flag false, which
// internal/preflight treats as "not observed" rather than as a failure.
func gatherPreflight(ctx context.Context, cfg *config.Config) preflight.Observations {
	obs := preflight.Observations{
		AuthorityURL:   cfg.AuthorityURL,
		BootstrapToken: cfg.BootstrapToken,
		LANAddresses:   collect.RealLANAddresses(),
	}

	// A node with prior state has already enrolled and needs no token.
	if st, err := state.Load(cfg.StateDir); err == nil && st != nil {
		obs.AlreadyEnrolled = true
	}

	parsed, err := url.Parse(cfg.AuthorityURL)
	if err != nil || parsed.Host == "" {
		// Malformed — let Evaluate name it; no point probing.
		return obs
	}

	host := parsed.Hostname()
	if net.ParseIP(host) == nil {
		obs.DNSAttempted = true
		resolver := &net.Resolver{}
		lookupCtx, cancel := context.WithTimeout(ctx, preflightTimeout)
		addrs, lookupErr := resolver.LookupHost(lookupCtx, host)
		cancel()
		obs.DNSResolved = lookupErr == nil && len(addrs) > 0
		if !obs.DNSResolved {
			return obs
		}
	}

	obs.ReachAttempted = true
	reqCtx, cancel := context.WithTimeout(ctx, preflightTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, strings.TrimRight(cfg.AuthorityURL, "/")+"/api/health", nil)
	if err != nil {
		obs.ReachError = err.Error()
		return obs
	}
	resp, err := (&http.Client{Timeout: preflightTimeout}).Do(req)
	if err != nil {
		obs.ReachError = err.Error()
		// Distinguish "the certificate is not trusted" from "nothing answered".
		// They look the same in a transport error and need opposite remedies.
		var unknownAuthority x509.UnknownAuthorityError
		var hostnameErr x509.HostnameError
		var certInvalid x509.CertificateInvalidError
		if errors.As(err, &unknownAuthority) || errors.As(err, &hostnameErr) || errors.As(err, &certInvalid) {
			obs.TLSUntrusted = true
		}
		return obs
	}
	defer resp.Body.Close()
	obs.Reachable = resp.StatusCode >= 200 && resp.StatusCode < 500
	obs.HTTPStatus = resp.StatusCode

	// The portal's Date header is the cheapest authoritative clock available,
	// and clock skew is the failure this whole command exists to surface.
	if served := resp.Header.Get("Date"); served != "" {
		if authorityTime, parseErr := http.ParseTime(served); parseErr == nil {
			obs.AuthorityTime = authorityTime
			obs.LocalTime = time.Now().UTC()
		}
	}

	return obs
}

// runPreflight prints one named cause and returns a non-zero-worthy verdict.
// Exit code is the caller's job; this returns whether the node is ready.
func runPreflight(ctx context.Context) bool {
	cfg, err := config.Load(Version)
	if err != nil {
		// A config that will not load is itself the finding, and Evaluate can
		// name the common case (no Authority URL) from the raw environment.
		result := preflight.Evaluate(preflight.Observations{
			AuthorityURL:   os.Getenv(config.EnvAuthorityURL),
			BootstrapToken: os.Getenv(config.EnvBootstrapToken),
		})
		fmt.Fprintln(os.Stdout, preflight.Format(result))
		if result.OK {
			// Config failed for a reason preflight does not model; say so
			// rather than reporting a green that the agent will not honour.
			fmt.Fprintf(os.Stdout, "preflight: configuration could not be loaded — %v\n", err)
			return false
		}
		return false
	}

	result := preflight.Evaluate(gatherPreflight(ctx, cfg))
	fmt.Fprintln(os.Stdout, preflight.Format(result))
	return result.OK
}
