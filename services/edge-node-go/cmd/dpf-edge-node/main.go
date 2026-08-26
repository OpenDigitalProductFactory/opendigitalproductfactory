// dpf-edge-node — Mode 4 native binary for the DPF Edge Node.
//
// Mirrors the Phase 0 lifecycle of services/edge-node/src/index.ts:
//  1. Load config from env (refuse to start on invalid config).
//  2. Try to load existing state from disk.
//     3a. State present  → skip enrollment, run heartbeat + sweep loops.
//     3b. State missing  → require DPF_BOOTSTRAP_TOKEN, enroll, persist
//     state, then run loops.
//
// Heartbeat + sweep loops run concurrently. If either returns (e.g.
// node revoked), the process exits so the supervisor can restart.
//
// W1 ships the scaffold + enroll + heartbeat loop. The sweep loop in
// this slice is a placeholder that sleeps the configured interval and
// submits an empty discovery-run envelope so the wire-contract parity
// test sees data from both runtimes; W2+ replaces it with real
// collectors.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// Plan: docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md (W1)
// ADR:  docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md
package main

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/google/uuid"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/action"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/actionrunner"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/api"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/collect"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/config"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/federation"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/state"
)

// Version is stamped at build time via -ldflags "-X main.Version=...".
// Default is the dev fallback; production builds inject the release tag.
var Version = "0.0.0-dev"

// nativeCapabilities includes host-owned behavior that the Docker runtime
// cannot provide on macOS/Windows. The Authority accepts only its closed
// enrollment allow-list; wire shape parity does not require runtime parity.
var nativeCapabilities = []string{"discovery.network", "federation.discovery"}

const (
	nearbyDiscoveryUnknown int32 = iota
	nearbyDiscoveryHealthy
	nearbyDiscoveryDegraded
)

const (
	actionDispatchUnknown int32 = iota
	actionDispatchHealthy
	actionDispatchDegraded
)

var nearbyDiscoveryHealth atomic.Int32
var nearbyDiscoveryAccepted atomic.Bool
var actionDispatchHealth atomic.Int32

func main() {
	printFixtureMode := flag.Bool("print-enroll-fixture", false,
		"Print a sample EnrollRequest as JSON to stdout and exit. Used to "+
			"seed the Authority-side wire-contract parity fixtures.")
	preflightMode := flag.Bool("preflight", false,
		"Check whether this host can reach and enrol with its Authority, print "+
			"one named cause, and exit. Non-zero exit means not ready.")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if *printFixtureMode {
		printEnrollFixture()
		return
	}

	// Runs BEFORE enrollment in the portal-rendered install command, so a bad
	// Authority URL, an unsynced clock, or a container with no LAN visibility
	// names itself on the machine where the problem is (BI-BB919901).
	if *preflightMode {
		if !runPreflight(context.Background()) {
			os.Exit(1)
		}
		return
	}

	if err := run(); err != nil {
		slog.Error("edge node fatal", slog.String("err", err.Error()))
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(Version)
	if err != nil {
		return err
	}

	slog.Info("DPF Edge Node starting",
		slog.String("version", cfg.Version),
		slog.String("authority", cfg.AuthorityURL),
		slog.String("name", cfg.EdgeNodeName),
		slog.String("platform", cfg.Platform),
		slog.String("installMode", cfg.InstallMode),
		slog.String("stateDir", cfg.StateDir),
	)

	client, err := api.New(api.Options{AuthorityURL: cfg.AuthorityURL})
	if err != nil {
		return err
	}
	var actionClient *api.Client
	if cfg.ActionDispatchEnabled() {
		httpClient, err := api.NewMutualTLSHTTPClient(api.MutualTLSOptions{
			CAFile: cfg.EdgeActionCAFile, CertFile: cfg.EdgeActionCertFile, KeyFile: cfg.EdgeActionKeyFile,
		})
		if err != nil {
			return fmt.Errorf("configure Edge action machine identity: %w", err)
		}
		actionClient, err = api.New(api.Options{AuthorityURL: cfg.EdgeActionURL, HTTPClient: httpClient})
		if err != nil {
			return err
		}
	}

	// Stop the loops cleanly on SIGINT/SIGTERM so a service-manager
	// restart doesn't leave a half-written state.json.
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	st, err := state.Load(cfg.StateDir)
	if err != nil {
		return fmt.Errorf("load state: %w", err)
	}

	if st == nil {
		slog.Info("No prior state found; running enrollment")
		st, err = enrollOnce(ctx, cfg, client)
		if err != nil {
			return fmt.Errorf("enrollment: %w", err)
		}
	} else {
		slog.Info("Resuming",
			slog.String("nodeId", st.NodeID),
			slog.String("trustState", st.TrustState),
			slog.String("enrolledAt", st.EnrolledAt),
		)
	}
	nearbyDiscoveryAccepted.Store(containsString(st.AcceptedCapabilities, "federation.discovery"))

	slog.Info("Starting heartbeat + sweep loops",
		slog.Int("heartbeatIntervalSec", st.HeartbeatIntervalSec),
		slog.Int("sweepIntervalSec", st.SweepIntervalSec),
	)

	// Race the two loops. Whichever returns first ends the process so
	// the supervisor can restart with fresh state. Heartbeat exits on
	// node_revoked; sweep currently runs until ctx is cancelled.
	errCh := make(chan error, 4)
	go func() { errCh <- runHeartbeat(ctx, cfg, client, st) }()
	go func() { errCh <- runSweep(ctx, cfg, client, st) }()
	go func() { errCh <- runFederationDiscovery(ctx, cfg, client, st) }()
	if actionClient != nil {
		publicKey, err := action.LoadPublicKey(cfg.EdgeActionSigningPublicKeyFile)
		if err != nil {
			return err
		}
		journal, err := action.OpenReplayJournal(cfg.StateDir, time.Now().UTC())
		if err != nil {
			return err
		}
		executor := &action.Executor{
			NodeID: st.NodeID, PublicKey: publicKey, Journal: journal,
			CollectInventory: func(actionContext context.Context) (map[string]any, error) {
				if err := submitSweep(actionContext, cfg, client, st); err != nil {
					return nil, err
				}
				return map[string]any{"inventorySubmission": "accepted"}, nil
			},
		}
		if cfg.OrganizationJoinEnabled() {
			executor.OrganizationJoin = &action.OrganizationJoinHandler{
				Config: action.OrganizationJoinConfig{
					Role: action.OrganizationTrustRole(cfg.OrganizationTrustRole), Platform: cfg.Platform,
					InstallRoot: cfg.InstallRoot, StateDir: cfg.StateDir, PkiDir: cfg.PkiDir,
					HostIdentity: cfg.EdgeNodeName, OrganizationCAURL: cfg.OrganizationCAURL,
					Timeout: 10 * time.Minute,
				},
				Verify: func(verifyContext context.Context) (map[string]any, error) {
					return verifyOrganizationJoin(verifyContext, cfg, client, st)
				},
			}
		}
		runner := &actionrunner.Runner{Client: actionClient, Executor: executor, NodeToken: st.NodeToken, BatchSize: 1}
		go func() { errCh <- runActionDispatch(ctx, actionClient, runner, st.NodeToken) }()
	}

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		return nil
	}
}

func runFederationDiscovery(ctx context.Context, cfg *config.Config, client *api.Client, st *state.EdgeNodeState) error {
	if len(st.NodeToken) < 16 {
		return errors.New("node token is too short to derive a discovery identifier")
	}
	for ctx.Err() == nil {
		if !nearbyDiscoveryAccepted.Load() {
			nearbyDiscoveryHealth.Store(nearbyDiscoveryUnknown)
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(5 * time.Second):
				continue
			}
		}

		discoveryCtx, cancelDiscovery := context.WithCancel(ctx)
		monitorDone := make(chan struct{})
		go func() {
			defer close(monitorDone)
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-discoveryCtx.Done():
					return
				case <-ticker.C:
					if !nearbyDiscoveryAccepted.Load() {
						cancelDiscovery()
						return
					}
				}
			}
		}()

		err := federation.Run(discoveryCtx, federation.DiscoveryOptions{
			AuthorityURL:      cfg.AuthorityURL,
			Secret:            []byte(st.NodeToken),
			CapabilityVersion: "dpf.demand/1",
			OnReady: func() {
				nearbyDiscoveryHealth.Store(nearbyDiscoveryHealthy)
			},
		}, func(ctx context.Context, candidates []federation.Candidate) error {
			wireCandidates := make([]any, len(candidates))
			for i := range candidates {
				wireCandidates[i] = candidates[i]
			}
			err := client.SubmitFederationCandidates(ctx, st.NodeToken, api.FederationCandidateSnapshot{
				ObservedAt: time.Now().UTC().Format(time.RFC3339Nano),
				Candidates: wireCandidates,
			})
			if err != nil {
				slog.Warn("Nearby DPF candidate submission failed", slog.String("err", err.Error()))
				return err
			}
			slog.Info("Nearby DPF candidates submitted", slog.Int("candidates", len(candidates)))
			return nil
		})
		cancelDiscovery()
		<-monitorDone
		if ctx.Err() != nil {
			return nil
		}
		if !nearbyDiscoveryAccepted.Load() {
			nearbyDiscoveryHealth.Store(nearbyDiscoveryUnknown)
			continue
		}
		nearbyDiscoveryHealth.Store(nearbyDiscoveryDegraded)
		slog.Warn("Nearby DPF discovery unavailable; retrying", slog.String("err", err.Error()))
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(30 * time.Second):
		}
	}
	return nil
}

func federationCapabilityReports() []api.CapabilityReport {
	status := "unknown"
	switch nearbyDiscoveryHealth.Load() {
	case nearbyDiscoveryHealthy:
		status = "healthy"
	case nearbyDiscoveryDegraded:
		status = "degraded"
	}
	return []api.CapabilityReport{{
		Capability: "federation.discovery",
		Status:     status,
		Evidence: map[string]any{
			"serviceType": federation.ServiceFQDN,
			"transport":   "dns-sd-mdns",
		},
	}}
}

func capabilityReports(actionConfigured, organizationJoinEnabled bool, organizationTrustRole string) []api.CapabilityReport {
	reports := federationCapabilityReports()
	if !actionConfigured {
		return reports
	}
	status := "unknown"
	switch actionDispatchHealth.Load() {
	case actionDispatchHealthy:
		status = "healthy"
	case actionDispatchDegraded:
		status = "degraded"
	}
	actionTypes := []string{"inventory.collect"}
	if organizationJoinEnabled {
		if organizationTrustRole == "authority" {
			actionTypes = append(actionTypes, "organization.join.issue")
		} else if organizationTrustRole == "member" {
			actionTypes = append(actionTypes, "organization.join.import")
		}
	}
	return append(reports, api.CapabilityReport{
		Capability: "action.execute",
		Status:     status,
		Evidence: map[string]any{
			"transport":             "mutual-tls-pull",
			"actionTypes":           actionTypes,
			"organizationTrustRole": organizationTrustRole,
		},
	})
}

func enrollOnce(ctx context.Context, cfg *config.Config, client *api.Client) (*state.EdgeNodeState, error) {
	if cfg.BootstrapToken == "" {
		return nil, errors.New(
			"DPF_BOOTSTRAP_TOKEN is required for first-run enrollment. " +
				"Issue one via the Authority's Admin > Platform Development > Edge Nodes page.")
	}

	slog.Info("Enrolling",
		slog.String("name", cfg.EdgeNodeName),
		slog.String("authority", cfg.AuthorityURL),
	)

	// Populate metadata.host.ipAddresses from the host's real NICs so
	// the Admin UI can identify the node by its LAN address without
	// SQL-querying the metadata blob. Mirrors T2.4 in the TS path
	// (services/edge-node/src/collectors/host-network.ts).
	ipAddresses := collect.RealLANAddresses()
	if ipAddresses == nil {
		ipAddresses = []string{}
	}

	capabilities := append([]string(nil), nativeCapabilities...)
	if cfg.ActionDispatchEnabled() {
		capabilities = append(capabilities, "action.execute")
	}
	resp, err := client.Enroll(ctx, cfg.BootstrapToken, api.EnrollRequest{
		DisplayName:            cfg.EdgeNodeName,
		Platform:               cfg.Platform,
		InstallMode:            cfg.InstallMode,
		Version:                cfg.Version,
		AdvertisedCapabilities: capabilities,
		Metadata: map[string]any{
			"hostname": cfg.EdgeNodeName,
			"host": map[string]any{
				"hostname":    cfg.EdgeNodeName,
				"ipAddresses": ipAddresses,
			},
		},
	})
	if err != nil {
		return nil, err
	}

	slog.Info("Enrolled",
		slog.String("nodeId", resp.NodeID),
		slog.String("trustState", resp.TrustState),
		slog.Int("heartbeatIntervalSec", resp.HeartbeatIntervalSec),
		slog.Int("sweepIntervalSec", resp.SweepIntervalSec),
	)

	st := &state.EdgeNodeState{
		NodeID:               resp.NodeID,
		NodeToken:            resp.NodeToken,
		EnrolledAt:           time.Now().UTC().Format(time.RFC3339Nano),
		HeartbeatIntervalSec: resp.HeartbeatIntervalSec,
		SweepIntervalSec:     resp.SweepIntervalSec,
		MetricsIntervalSec:   resp.MetricsIntervalSec,
		AcceptedCapabilities: resp.AcceptedCapabilities,
		TrustState:           resp.TrustState,
	}
	if err := state.Save(cfg.StateDir, st); err != nil {
		return nil, fmt.Errorf("save state: %w", err)
	}
	slog.Info("State persisted", slog.String("path", state.Path(cfg.StateDir)))
	return st, nil
}

func runActionDispatch(ctx context.Context, client *api.Client, runner *actionrunner.Runner, nodeToken string) error {
	registered := false
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		if !registered {
			if err := client.RegisterActionCertificate(ctx, nodeToken); err != nil {
				actionDispatchHealth.Store(actionDispatchDegraded)
				slog.Warn("Edge action certificate registration unavailable; channel remains inert", slog.String("err", err.Error()))
			} else {
				registered = true
				actionDispatchHealth.Store(actionDispatchHealthy)
				slog.Info("Edge action machine certificate registered")
			}
		}
		if registered {
			if err := runner.RunOnce(ctx); err != nil {
				if ctx.Err() != nil {
					return nil
				}
				actionDispatchHealth.Store(actionDispatchDegraded)
				slog.Warn("Edge action poll failed", slog.String("err", err.Error()))
			} else {
				actionDispatchHealth.Store(actionDispatchHealthy)
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func runHeartbeat(ctx context.Context, cfg *config.Config, client *api.Client, st *state.EdgeNodeState) error {
	ticker := time.NewTicker(time.Duration(st.HeartbeatIntervalSec) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}

		resp, err := client.Heartbeat(ctx, st.NodeToken, api.HeartbeatRequest{
			CapabilityReports: capabilityReports(cfg.ActionDispatchEnabled(), cfg.OrganizationJoinEnabled(), cfg.OrganizationTrustRole),
		})
		if err != nil {
			if api.IsRevoked(err) {
				slog.Error("Heartbeat revoked — clearing state and exiting")
				if clearErr := state.Clear(cfg.StateDir); clearErr != nil {
					slog.Warn("Failed to clear state", slog.String("err", clearErr.Error()))
				}
				return errors.New("node revoked by Authority")
			}
			slog.Warn("Heartbeat failed", slog.String("err", err.Error()))
			continue
		}

		// Authority-driven cadence: if the interval changed, persist
		// + retick. The sweep loop reads from the same struct via the
		// shared pointer (W1 doesn't yet protect this with a mutex
		// because we have one writer; tightening lands with the W3
		// sweep work).
		changed := false
		if resp.HeartbeatIntervalSec != st.HeartbeatIntervalSec {
			st.HeartbeatIntervalSec = resp.HeartbeatIntervalSec
			ticker.Reset(time.Duration(resp.HeartbeatIntervalSec) * time.Second)
			changed = true
		}
		if resp.SweepIntervalSec != st.SweepIntervalSec {
			st.SweepIntervalSec = resp.SweepIntervalSec
			changed = true
		}
		if !equalPtrInt(resp.MetricsIntervalSec, st.MetricsIntervalSec) {
			st.MetricsIntervalSec = resp.MetricsIntervalSec
			changed = true
		}
		if !equalStringSlices(resp.AcceptedCapabilities, st.AcceptedCapabilities) {
			st.AcceptedCapabilities = resp.AcceptedCapabilities
			nearbyDiscoveryAccepted.Store(containsString(resp.AcceptedCapabilities, "federation.discovery"))
			changed = true
		}
		if resp.TrustState != st.TrustState {
			st.TrustState = resp.TrustState
			changed = true
		}
		if changed {
			if err := state.Save(cfg.StateDir, st); err != nil {
				slog.Warn("Failed to persist updated state", slog.String("err", err.Error()))
			}
		}
	}
}

func verifyOrganizationJoin(
	ctx context.Context,
	cfg *config.Config,
	client *api.Client,
	st *state.EdgeNodeState,
) (map[string]any, error) {
	evidence := map[string]any{
		"certificateTrust":   false,
		"overlayPersistence": false,
		"portalHealth":       false,
		"edgeHeartbeat":      false,
	}
	if err := verifyOrganizationCertificateChain(cfg.PkiDir); err != nil {
		return evidence, err
	}
	evidence["certificateTrust"] = true
	envContent, err := os.ReadFile(filepath.Join(cfg.InstallRoot, ".env"))
	if err != nil || !strings.Contains(string(envContent), "DPF_ORGANIZATION_TRUST_ENABLED=1") ||
		!strings.Contains(string(envContent), "DPF_PKI_TRUST_BUNDLE=") {
		return evidence, errors.New("organization trust overlay is not persisted")
	}
	evidence["overlayPersistence"] = true
	if err := client.Health(ctx); err != nil {
		return evidence, err
	}
	evidence["portalHealth"] = true
	if _, err := client.Heartbeat(ctx, st.NodeToken, api.HeartbeatRequest{
		CapabilityReports: capabilityReports(cfg.ActionDispatchEnabled(), cfg.OrganizationJoinEnabled(), cfg.OrganizationTrustRole),
	}); err != nil {
		return evidence, err
	}
	evidence["edgeHeartbeat"] = true
	return evidence, nil
}

func verifyOrganizationCertificateChain(pkiDir string) error {
	rootPEM, err := os.ReadFile(filepath.Join(pkiDir, "root_ca.crt"))
	if err != nil {
		return err
	}
	authorityPEM, err := os.ReadFile(filepath.Join(pkiDir, "authority.crt"))
	if err != nil {
		return err
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(rootPEM) {
		return errors.New("organization root certificate is invalid")
	}
	var certificates []*x509.Certificate
	remaining := authorityPEM
	for len(remaining) > 0 {
		block, rest := pem.Decode(remaining)
		remaining = rest
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		certificate, parseErr := x509.ParseCertificate(block.Bytes)
		if parseErr != nil {
			return parseErr
		}
		certificates = append(certificates, certificate)
	}
	if len(certificates) == 0 {
		return errors.New("organization authority certificate is invalid")
	}
	intermediates := x509.NewCertPool()
	for _, certificate := range certificates[1:] {
		intermediates.AddCert(certificate)
	}
	_, err = certificates[0].Verify(x509.VerifyOptions{Roots: roots, Intermediates: intermediates})
	return err
}

// runSweep collects host facts each interval and submits them to
// /api/v1/edge/discovery-runs. W2 ships the host-info collector; W3
// adds ARP via the platform-specific neighbor table; W4 adds SNMP.
// The collector chain composes — each adds items + relationships +
// warnings to the same envelope.
//
// The sweep also runs once immediately on startup (in addition to the
// ticker schedule) so the first submission lands within ~1 second
// of enrollment rather than waiting a full interval. The TS path in
// services/edge-node/src/sweep.ts has the same "drain-then-collect"
// pattern; this matches it.
func runSweep(ctx context.Context, cfg *config.Config, client *api.Client, st *state.EdgeNodeState) error {
	doTick := func() {
		if err := submitSweep(ctx, cfg, client, st); err != nil {
			if api.IsRevoked(err) {
				// Heartbeat owns the terminal-revocation lifecycle;
				// sweep just stops submitting and lets the other loop
				// clear state and exit.
				slog.Error("Sweep got node_revoked — pausing until heartbeat handles it")
				return
			}
			slog.Warn("Sweep submission failed", slog.String("err", err.Error()))
			return
		}
	}

	// One immediate sweep on startup so the operator sees data within
	// seconds, not after the first 5-minute interval elapses.
	doTick()

	ticker := time.NewTicker(time.Duration(st.SweepIntervalSec) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
		doTick()
	}
}

// submitSweep builds one envelope from the current collector chain and
// POSTs it. Pulled into its own function so tests can drive it without
// constructing a ticker.
//
// Collector chain (matches services/edge-node/src/sweep.ts):
//  1. HostInfo — local host facts; always present.
//  2. ArpNeighbors — kernel/OS ARP cache. This is the collector
//     that finally surfaces the OTHER devices on the LAN (Amazon
//     Echo, Reolink cameras, Kasa switches, etc.) when the binary
//     runs natively on Windows/macOS rather than inside Docker.
//  3. Authority-scoped adapters — LAN-local vendor APIs such as UniFi.
//     Credentials remain Authority-owned and are released only to the
//     authenticated trusted edge through GET /api/v1/edge/adapters.
func submitSweep(ctx context.Context, cfg *config.Config, client *api.Client, st *state.EdgeNodeState) error {
	hostResult := collect.HostInfo()
	arpResult := collect.ArpNeighbors()
	unifiResult := collect.Result{}
	adapterResponse, adapterErr := client.FetchAdapters(ctx, st.NodeToken)
	if adapterErr != nil {
		unifiResult.Warnings = append(unifiResult.Warnings, "adapters_fetch_failed:"+adapterErr.Error())
	} else {
		unifiConfigs := make([]collect.UnifiConfig, 0, len(adapterResponse.Adapters))
		for _, adapter := range adapterResponse.Adapters {
			if adapter.CollectorType != "unifi" {
				continue
			}
			unifiConfigs = append(unifiConfigs, collect.UnifiConfig{
				ConnectionID:    adapter.ID,
				ControllerURL:   adapter.EndpointURL,
				APIKey:          adapter.APIKey,
				Site:            adapter.Configuration.Site,
				DiscoverClients: adapter.Configuration.DiscoverClients,
				TLSInsecure:     adapter.Configuration.TLSInsecure,
			})
		}
		unifiResult = collect.CollectUnifi(ctx, unifiConfigs)
	}

	// Convert []collect.Item → []any so the SubmissionEnvelope's typed
	// `[]any` accepts them. The JSON marshal layer produces identical
	// bytes either way; the indirection only matters at the Go type
	// level.
	items := make([]any, 0, len(hostResult.Items)+len(arpResult.Items)+len(unifiResult.Items))
	for _, item := range hostResult.Items {
		items = append(items, item)
	}
	for _, item := range arpResult.Items {
		items = append(items, item)
	}
	for _, item := range unifiResult.Items {
		items = append(items, item)
	}

	rels := make([]any, 0, len(hostResult.Relationships)+len(arpResult.Relationships)+len(unifiResult.Relationships))
	for _, rel := range hostResult.Relationships {
		rels = append(rels, rel)
	}
	for _, rel := range arpResult.Relationships {
		rels = append(rels, rel)
	}
	for _, rel := range unifiResult.Relationships {
		rels = append(rels, rel)
	}

	warnings := make([]string, 0, len(hostResult.Warnings)+len(arpResult.Warnings)+len(unifiResult.Warnings))
	warnings = append(warnings, hostResult.Warnings...)
	warnings = append(warnings, arpResult.Warnings...)
	warnings = append(warnings, unifiResult.Warnings...)

	envelope := api.SubmissionEnvelope{
		RunKey:        uuid.NewString(),
		AgentMode:     cfg.InstallMode,
		AgentVersion:  cfg.Version,
		ObservedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Capabilities:  []string{"discovery.network"},
		Items:         items,
		Relationships: rels,
		Warnings:      warnings,
	}

	if _, err := client.SubmitDiscoveryRun(ctx, st.NodeToken, envelope); err != nil {
		return err
	}
	slog.Info("Discovery run submitted",
		slog.String("runKey", envelope.RunKey),
		slog.Int("items", len(envelope.Items)),
		slog.Int("relationships", len(envelope.Relationships)),
		slog.Int("warnings", len(envelope.Warnings)),
	)
	return nil
}

// printEnrollFixture emits a canonical EnrollRequest JSON document to
// stdout. The Authority-side wire-contract parity test consumes the
// result as the Go fixture; the TS fixture is generated similarly
// from services/edge-node. The two must round-trip through the same
// Zod schema without field-level drift.
func printEnrollFixture() {
	fixture := api.EnrollRequest{
		DisplayName:            "fixture-host",
		Platform:               "linux",
		InstallMode:            "native",
		Version:                "0.1.0-fixture",
		AdvertisedCapabilities: nativeCapabilities,
		Metadata: map[string]any{
			"hostname": "fixture-host",
			"host": map[string]any{
				"hostname":    "fixture-host",
				"ipAddresses": []string{"192.168.0.10"},
			},
		},
	}
	enc := jsonEncoder()
	if err := enc.Encode(fixture); err != nil {
		fmt.Fprintf(os.Stderr, "encode fixture: %v\n", err)
		os.Exit(2)
	}
}

func equalPtrInt(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
