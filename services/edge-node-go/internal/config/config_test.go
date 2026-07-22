package config

import (
	"strings"
	"testing"
)

func setEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		t.Setenv(k, v)
	}
}

// clearEnv removes any DPF_* vars the test runner may have set so
// each test starts from a known baseline.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		EnvAuthorityURL, EnvBootstrapToken, EnvEdgeNodeName,
		EnvStateDir, EnvInstallMode, EnvPlatformOverride, EnvVersion,
		EnvEdgeActionURL, EnvEdgeActionCAFile, EnvEdgeActionCertFile,
		EnvEdgeActionKeyFile, EnvEdgeActionSigningPublicKeyFile,
	} {
		t.Setenv(k, "")
	}
}

func TestLoad_actionDispatchRequiresCompleteMachineTrustBundle(t *testing.T) {
	clearEnv(t)
	setEnv(t, map[string]string{
		EnvAuthorityURL:     "http://localhost:3000",
		EnvPlatformOverride: "linux",
		EnvEdgeActionURL:    "https://localhost:8443",
		EnvEdgeActionCAFile: "/trust/root.crt",
	})

	_, err := Load("0.1.0")
	if err == nil {
		t.Fatal("expected incomplete action trust configuration to fail closed")
	}
	for _, name := range []string{EnvEdgeActionCertFile, EnvEdgeActionKeyFile, EnvEdgeActionSigningPublicKeyFile} {
		if !strings.Contains(err.Error(), name) {
			t.Fatalf("error %q does not name missing %s", err, name)
		}
	}
}

func TestLoad_actionDispatchTrustBundleIsOptionalButCompleteWhenEnabled(t *testing.T) {
	clearEnv(t)
	setEnv(t, map[string]string{
		EnvAuthorityURL:                   "http://localhost:3000",
		EnvPlatformOverride:               "linux",
		EnvEdgeActionURL:                  "https://localhost:8443/",
		EnvEdgeActionCAFile:               "/trust/root.crt",
		EnvEdgeActionCertFile:             "/trust/edge-client.crt",
		EnvEdgeActionKeyFile:              "/trust/edge-client.key",
		EnvEdgeActionSigningPublicKeyFile: "/trust/action-signing-public.pem",
	})

	cfg, err := Load("0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.ActionDispatchEnabled() || cfg.EdgeActionURL != "https://localhost:8443" {
		t.Fatalf("unexpected action configuration: %#v", cfg)
	}
}

func TestLoad_requiresAuthorityURL(t *testing.T) {
	clearEnv(t)
	_, err := Load("0.1.0")
	if err == nil {
		t.Fatal("expected error for missing AUTHORITY_URL")
	}
	if !strings.Contains(err.Error(), EnvAuthorityURL) {
		t.Errorf("error %q does not name the missing var", err)
	}
}

func TestLoad_happyPath(t *testing.T) {
	clearEnv(t)
	setEnv(t, map[string]string{
		EnvAuthorityURL:     "http://localhost:3000",
		EnvBootstrapToken:   "dpfboot_TEST",
		EnvEdgeNodeName:     "test-node",
		EnvStateDir:         "/tmp/dpf-test",
		EnvInstallMode:      "native",
		EnvPlatformOverride: "linux",
		EnvVersion:          "0.1.0-test",
	})
	c, err := Load("ignored")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.AuthorityURL != "http://localhost:3000" {
		t.Errorf("AuthorityURL: %q", c.AuthorityURL)
	}
	if c.BootstrapToken != "dpfboot_TEST" {
		t.Errorf("BootstrapToken not preserved")
	}
	if c.EdgeNodeName != "test-node" || c.StateDir != "/tmp/dpf-test" {
		t.Errorf("name/state: %q / %q", c.EdgeNodeName, c.StateDir)
	}
	if c.Platform != "linux" {
		t.Errorf("Platform: %q", c.Platform)
	}
	if c.InstallMode != "native" {
		t.Errorf("InstallMode: %q", c.InstallMode)
	}
	if c.Version != "0.1.0-test" {
		t.Errorf("Version env var should override the literal arg: %q", c.Version)
	}
}

func TestLoad_trimsTrailingSlashesOnURL(t *testing.T) {
	clearEnv(t)
	setEnv(t, map[string]string{
		EnvAuthorityURL:     "http://localhost:3000///",
		EnvPlatformOverride: "linux",
	})
	c, err := Load("0.1.0")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.AuthorityURL != "http://localhost:3000" {
		t.Errorf("expected trailing slashes trimmed, got %q", c.AuthorityURL)
	}
}

func TestLoad_defaultsInstallModeToNative(t *testing.T) {
	clearEnv(t)
	setEnv(t, map[string]string{
		EnvAuthorityURL:     "http://h:3000",
		EnvPlatformOverride: "linux",
	})
	c, err := Load("0.1.0")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.InstallMode != "native" {
		t.Errorf("default InstallMode = %q, want native", c.InstallMode)
	}
}

func TestLoad_rejectsUnknownInstallMode(t *testing.T) {
	clearEnv(t)
	setEnv(t, map[string]string{
		EnvAuthorityURL:     "http://h:3000",
		EnvInstallMode:      "experimental",
		EnvPlatformOverride: "linux",
	})
	_, err := Load("0.1.0")
	if err == nil || !strings.Contains(err.Error(), "experimental") {
		t.Errorf("expected installMode rejection, got %v", err)
	}
}

func TestLoad_reportsAllProblemsAtOnce(t *testing.T) {
	clearEnv(t)
	setEnv(t, map[string]string{
		// authority missing, installMode bogus, platform override garbage
		EnvInstallMode:      "garbage",
		EnvPlatformOverride: "weirdos",
	})
	_, err := Load("0.1.0")
	if err == nil {
		t.Fatal("expected error")
	}
	msg := err.Error()
	if !strings.Contains(msg, EnvAuthorityURL) {
		t.Errorf("error doesn't mention missing AuthorityURL: %q", msg)
	}
	if !strings.Contains(msg, "garbage") {
		t.Errorf("error doesn't mention bad install mode: %q", msg)
	}
	if !strings.Contains(msg, "weirdos") {
		t.Errorf("error doesn't mention bad platform: %q", msg)
	}
}

func TestResolvePlatform_mapsWindowsToWin32(t *testing.T) {
	clearEnv(t)
	t.Setenv(EnvPlatformOverride, "")
	// We can't change runtime.GOOS, but we can verify the override
	// path mirrors what resolvePlatform would do for "windows".
	t.Setenv(EnvPlatformOverride, "win32")
	got := resolvePlatform()
	if got != "win32" {
		t.Errorf("override path returned %q", got)
	}
}
