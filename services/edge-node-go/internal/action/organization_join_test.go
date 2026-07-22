package action

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

type recordingCommandRunner struct {
	name       string
	args       []string
	exitCode   int
	err        error
	packageOut string
	mutate     func()
}

func (r *recordingCommandRunner) Run(_ context.Context, name string, args []string) (int, error) {
	r.name = name
	r.args = append([]string(nil), args...)
	if r.mutate != nil {
		r.mutate()
	}
	if r.packageOut != "" {
		for index, arg := range args {
			if (arg == "--package-output" || arg == "-PackageOutput") && index+1 < len(args) {
				if err := os.WriteFile(args[index+1], []byte(r.packageOut), 0o600); err != nil {
					return 1, err
				}
			}
		}
	}
	return r.exitCode, r.err
}

func packageFixture(expiresAt time.Time, peer string) string {
	return strings.Join([]string{
		"DPF_ORGANIZATION_JOIN_V2",
		"package_id=0123456789abcdef0123456789abcdef",
		"ca_url=https://arcamanus.local:9000",
		"root_fingerprint=" + strings.Repeat("A", 64),
		"intended_hostname=" + peer,
		"intended_sans=" + peer,
		"expires_at=" + strconv.FormatInt(expiresAt.Unix(), 10),
		"enrollment_token=token-safe_123",
		"edge_client_enrollment_token=edge-safe_456",
		"",
	}, "\n")
}

func hostFixture(t *testing.T, role OrganizationTrustRole) (*OrganizationJoinHandler, *recordingCommandRunner) {
	t.Helper()
	root := t.TempDir()
	script := filepath.Join(root, "scripts", "bootstrap-organization-pki.sh")
	if err := os.MkdirAll(filepath.Dir(script), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(script, []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	pki := filepath.Join(root, "pki")
	state := filepath.Join(root, "edge-state")
	if err := os.MkdirAll(filepath.Join(pki, "secrets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(state, 0o700); err != nil {
		t.Fatal(err)
	}
	if role == OrganizationTrustAuthority {
		if err := os.WriteFile(filepath.Join(pki, "secrets", "step-ca-password"), []byte("secret"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	runner := &recordingCommandRunner{}
	handler := &OrganizationJoinHandler{
		Config: OrganizationJoinConfig{
			Role: role, Platform: "darwin", InstallRoot: root, StateDir: state, PkiDir: pki,
			HostIdentity: "windows-dev.local", OrganizationCAURL: "https://arcamanus.local:9000",
			Timeout: 30 * time.Second,
		},
		Runner: runner,
		Now:    func() time.Time { return time.Date(2026, 7, 22, 10, 0, 0, 0, time.UTC) },
		Verify: func(context.Context) (map[string]any, error) {
			return map[string]any{
				"certificateTrust": true, "overlayPersistence": true,
				"portalHealth": true, "edgeHeartbeat": true,
			}, nil
		},
	}
	return handler, runner
}

func TestOrganizationJoinIssueUsesFixedExecutableAndArgumentArray(t *testing.T) {
	handler, runner := hostFixture(t, OrganizationTrustAuthority)
	runner.packageOut = packageFixture(handler.Now().Add(10*time.Minute), "windows-dev.local")
	output, err := handler.Execute(context.Background(), "organization.join.issue", []byte(`{"intendedPeer":"windows-dev.local","ttlSeconds":600}`))
	if err != nil {
		t.Fatal(err)
	}
	if runner.name != "/bin/bash" {
		t.Fatalf("executable=%q", runner.name)
	}
	wantPrefix := []string{
		filepath.Join(handler.Config.InstallRoot, "scripts", "bootstrap-organization-pki.sh"),
		"--mode", "issue-join", "--hostname", "windows-dev.local",
		"--out-dir", handler.Config.PkiDir,
		"--ca-url", "https://arcamanus.local:9000",
	}
	if !reflect.DeepEqual(runner.args[:len(wantPrefix)], wantPrefix) {
		t.Fatalf("args=%#v", runner.args)
	}
	if output.Result["joinPackage"] != runner.packageOut || output.Evidence["exitCode"] != 0 {
		t.Fatalf("output=%#v", output)
	}
	if strings.Contains(strings.Join(runner.args, " "), ";") {
		t.Fatal("arguments contain shell control text")
	}
}

func TestOrganizationJoinImportUsesPrivateTempFileAndIndependentVerification(t *testing.T) {
	handler, runner := hostFixture(t, OrganizationTrustMember)
	pkg := packageFixture(handler.Now().Add(10*time.Minute), handler.Config.HostIdentity)
	output, err := handler.Execute(context.Background(), "organization.join.import", []byte(`{"joinPackage":`+strconv.Quote(pkg)+`}`))
	if err != nil {
		t.Fatal(err)
	}
	if runner.name != "/bin/bash" || output.Evidence["certificateTrust"] != true || output.Evidence["edgeHeartbeat"] != true {
		t.Fatalf("runner=%q output=%#v", runner.name, output)
	}
	var packagePath string
	for index, arg := range runner.args {
		if arg == "--join-package" && index+1 < len(runner.args) {
			packagePath = runner.args[index+1]
		}
	}
	if packagePath == "" {
		t.Fatalf("no package path in %#v", runner.args)
	}
	if _, err := os.Stat(packagePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary package was not cleared: %v", err)
	}
}

func TestOrganizationJoinWindowsUsesPowerShellFileAndEquivalentArgumentContract(t *testing.T) {
	handler, runner := hostFixture(t, OrganizationTrustMember)
	handler.Config.Platform = "win32"
	powerShellScript := filepath.Join(handler.Config.InstallRoot, "scripts", "bootstrap-organization-pki.ps1")
	if err := os.WriteFile(powerShellScript, []byte("param()\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	pkg := packageFixture(handler.Now().Add(10*time.Minute), handler.Config.HostIdentity)
	if _, err := handler.Execute(context.Background(), "organization.join.import", []byte(`{"joinPackage":`+strconv.Quote(pkg)+`}`)); err != nil {
		t.Fatal(err)
	}
	wantPrefix := []string{
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", powerShellScript,
		"-Mode", "join", "-Hostname", handler.Config.HostIdentity, "-OutDir", handler.Config.PkiDir,
	}
	if runner.name != "powershell.exe" || !reflect.DeepEqual(runner.args[:len(wantPrefix)], wantPrefix) {
		t.Fatalf("name=%q args=%#v", runner.name, runner.args)
	}
}

func TestOrganizationJoinRejectsWrongRoleUnknownFieldsAndMetacharactersBeforeExecution(t *testing.T) {
	handler, runner := hostFixture(t, OrganizationTrustMember)
	for _, test := range []struct {
		action string
		params string
	}{
		{"organization.join.issue", `{"intendedPeer":"windows-dev.local","ttlSeconds":600}`},
		{"organization.join.import", `{"joinPackage":"x","path":"../../etc"}`},
		{"organization.join.issue", `{"intendedPeer":"peer.local; reboot","ttlSeconds":600}`},
		{"script.run", `{"command":"whoami"}`},
	} {
		if _, err := handler.Execute(context.Background(), test.action, []byte(test.params)); err == nil {
			t.Fatalf("expected rejection for %s %s", test.action, test.params)
		}
	}
	if runner.name != "" {
		t.Fatalf("rejected input executed %q", runner.name)
	}
}

func TestOrganizationJoinImportRestoresOverlaySnapshotOnFailure(t *testing.T) {
	handler, runner := hostFixture(t, OrganizationTrustMember)
	envPath := filepath.Join(handler.Config.InstallRoot, ".env")
	markerPath := filepath.Join(handler.Config.PkiDir, "root_ca.crt")
	if err := os.WriteFile(envPath, []byte("BEFORE=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(markerPath, []byte("old-root"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner.mutate = func() {
		_ = os.WriteFile(envPath, []byte("AFTER=1\n"), 0o600)
		_ = os.WriteFile(markerPath, []byte("bad-root"), 0o600)
	}
	runner.exitCode = 1
	runner.err = errors.New("bootstrap failed")
	pkg := packageFixture(handler.Now().Add(10*time.Minute), handler.Config.HostIdentity)
	if _, err := handler.Execute(context.Background(), "organization.join.import", []byte(`{"joinPackage":`+strconv.Quote(pkg)+`}`)); err == nil {
		t.Fatal("expected import failure")
	}
	env, _ := os.ReadFile(envPath)
	root, _ := os.ReadFile(markerPath)
	if string(env) != "BEFORE=1\n" || string(root) != "old-root" {
		t.Fatalf("rollback failed env=%q root=%q", env, root)
	}
}
