// dpf-edge-node — Mode 4 native binary for the DPF Edge Node.
//
// Mirrors the Phase 0 lifecycle of services/edge-node/src/index.ts:
//   1. Load config from env (refuse to start on invalid config).
//   2. Try to load existing state from disk.
//   3a. State present  → skip enrollment, run heartbeat + sweep loops.
//   3b. State missing  → require DPF_BOOTSTRAP_TOKEN, enroll, persist
//                        state, then run loops.
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
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/api"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/collect"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/config"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/state"
)

// Version is stamped at build time via -ldflags "-X main.Version=...".
// Default is the dev fallback; production builds inject the release tag.
var Version = "0.0.0-dev"

// phase0Capabilities mirrors PHASE_0_CAPABILITIES in
// services/edge-node/src/enroll.ts. Drift here is a wire-contract
// regression caught by the Authority-side parity test.
var phase0Capabilities = []string{"discovery.network"}

func main() {
	printFixtureMode := flag.Bool("print-enroll-fixture", false,
		"Print a sample EnrollRequest as JSON to stdout and exit. Used to "+
			"seed the Authority-side wire-contract parity fixtures.")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if *printFixtureMode {
		printEnrollFixture()
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

	slog.Info("Starting heartbeat + sweep loops",
		slog.Int("heartbeatIntervalSec", st.HeartbeatIntervalSec),
		slog.Int("sweepIntervalSec", st.SweepIntervalSec),
	)

	// Race the two loops. Whichever returns first ends the process so
	// the supervisor can restart with fresh state. Heartbeat exits on
	// node_revoked; sweep currently runs until ctx is cancelled.
	errCh := make(chan error, 2)
	go func() { errCh <- runHeartbeat(ctx, cfg, client, st) }()
	go func() { errCh <- runSweep(ctx, cfg, client, st) }()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		return nil
	}
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

	resp, err := client.Enroll(ctx, cfg.BootstrapToken, api.EnrollRequest{
		DisplayName:            cfg.EdgeNodeName,
		Platform:               cfg.Platform,
		InstallMode:            cfg.InstallMode,
		Version:                cfg.Version,
		AdvertisedCapabilities: phase0Capabilities,
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

func runHeartbeat(ctx context.Context, cfg *config.Config, client *api.Client, st *state.EdgeNodeState) error {
	ticker := time.NewTicker(time.Duration(st.HeartbeatIntervalSec) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}

		resp, err := client.Heartbeat(ctx, st.NodeToken, api.HeartbeatRequest{})
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
//   1. HostInfo — local host facts; always present.
//   2. ArpNeighbors — kernel/OS ARP cache. This is the collector
//      that finally surfaces the OTHER devices on the LAN (Amazon
//      Echo, Reolink cameras, Kasa switches, etc.) when the binary
//      runs natively on Windows/macOS rather than inside Docker.
func submitSweep(ctx context.Context, cfg *config.Config, client *api.Client, st *state.EdgeNodeState) error {
	hostResult := collect.HostInfo()
	arpResult := collect.ArpNeighbors()

	// Convert []collect.Item → []any so the SubmissionEnvelope's typed
	// `[]any` accepts them. The JSON marshal layer produces identical
	// bytes either way; the indirection only matters at the Go type
	// level.
	items := make([]any, 0, len(hostResult.Items)+len(arpResult.Items))
	for _, item := range hostResult.Items {
		items = append(items, item)
	}
	for _, item := range arpResult.Items {
		items = append(items, item)
	}

	rels := make([]any, 0, len(hostResult.Relationships)+len(arpResult.Relationships))
	for _, rel := range hostResult.Relationships {
		rels = append(rels, rel)
	}
	for _, rel := range arpResult.Relationships {
		rels = append(rels, rel)
	}

	warnings := make([]string, 0, len(hostResult.Warnings)+len(arpResult.Warnings))
	warnings = append(warnings, hostResult.Warnings...)
	warnings = append(warnings, arpResult.Warnings...)

	envelope := api.SubmissionEnvelope{
		RunKey:        uuid.NewString(),
		AgentMode:     cfg.InstallMode,
		AgentVersion:  cfg.Version,
		ObservedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Capabilities:  phase0Capabilities,
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
		AdvertisedCapabilities: phase0Capabilities,
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
