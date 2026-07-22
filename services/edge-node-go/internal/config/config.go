// Package config loads the Edge Node configuration from environment
// variables. Mirrors services/edge-node/src/config.ts on the wire
// (same env var names, same defaults where they make sense for a
// native binary; differing defaults — like installMode=native — are
// noted inline).
package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	// EnvAuthorityURL is the required base URL of the Authority Core,
	// e.g. http://localhost:3000 when Authority runs on the same host,
	// or the LAN IP when it runs elsewhere.
	EnvAuthorityURL = "DPF_AUTHORITY_URL"

	// EnvBootstrapToken is required on first run only; consumed by the
	// Authority on enrollment, never sent again. Subsequent runs read
	// the persisted nodeToken from state.json.
	EnvBootstrapToken = "DPF_BOOTSTRAP_TOKEN"

	// EnvEdgeNodeName is the operator-friendly display name. Defaults
	// to os.Hostname() — usually what an operator wants.
	EnvEdgeNodeName = "DPF_EDGE_NODE_NAME"

	// EnvStateDir is where state.json lives. Per-platform default
	// computed below.
	EnvStateDir = "DPF_EDGE_STATE_DIR"

	// EnvInstallMode classifies how this binary was deployed. Default
	// "native" for Mode 4. Operators don't typically set this.
	EnvInstallMode = "DPF_INSTALL_MODE"

	// EnvPlatformOverride lets tests force a non-current GOOS value.
	// Production never sets this.
	EnvPlatformOverride = "DPF_PLATFORM_OVERRIDE"

	// EnvVersion is the agent version reported on enroll. Burned in at
	// build time via -ldflags "-X main.Version=..."; env var lets dev
	// builds override.
	EnvVersion = "DPF_EDGE_NODE_VERSION"

	// The action listener is deliberately separate from the ordinary Edge API:
	// it requires a machine certificate in addition to the node bearer token.
	EnvEdgeActionURL                  = "DPF_EDGE_ACTION_URL"
	EnvEdgeActionCAFile               = "DPF_EDGE_ACTION_CA_FILE"
	EnvEdgeActionCertFile             = "DPF_EDGE_ACTION_CERT_FILE"
	EnvEdgeActionKeyFile              = "DPF_EDGE_ACTION_KEY_FILE"
	EnvEdgeActionSigningPublicKeyFile = "DPF_EDGE_ACTION_SIGNING_PUBLIC_KEY_FILE"

	// Privileged organization-join actions are available only when the native
	// installer pins the source owner and host role. None of these values are
	// accepted from a RemoteAction parameter.
	EnvInstallRoot           = "DPF_INSTALL_ROOT"
	EnvOrganizationTrustRole = "DPF_ORGANIZATION_TRUST_ROLE"
	EnvPkiDir                = "DPF_PKI_DIR"
	EnvOrganizationCAURL     = "DPF_ORGANIZATION_CA_URL"
)

// Config is the loaded, validated runtime configuration.
type Config struct {
	AuthorityURL                   string
	BootstrapToken                 string // empty on subsequent runs
	EdgeNodeName                   string
	StateDir                       string
	Platform                       string // darwin | win32 | linux  (matches TS contract)
	InstallMode                    string // native | container-host | container-vm
	Version                        string
	EdgeActionURL                  string
	EdgeActionCAFile               string
	EdgeActionCertFile             string
	EdgeActionKeyFile              string
	EdgeActionSigningPublicKeyFile string
	InstallRoot                    string
	OrganizationTrustRole          string
	PkiDir                         string
	OrganizationCAURL              string
}

func (c *Config) OrganizationJoinEnabled() bool {
	if c.OrganizationTrustRole != "authority" && c.OrganizationTrustRole != "member" {
		return false
	}
	if c.InstallRoot == "" || c.PkiDir == "" || c.EdgeNodeName == "" {
		return false
	}
	return c.OrganizationTrustRole != "authority" || c.OrganizationCAURL != ""
}

// ActionDispatchEnabled reports whether the complete fail-closed machine trust
// bundle is configured. An installation with no bundle keeps the action channel
// inert while enrollment, heartbeat, and discovery continue normally.
func (c *Config) ActionDispatchEnabled() bool {
	return c.EdgeActionURL != "" && c.EdgeActionCAFile != "" && c.EdgeActionCertFile != "" &&
		c.EdgeActionKeyFile != "" && c.EdgeActionSigningPublicKeyFile != ""
}

// Load reads and validates configuration from os environment. Returns
// a structured error listing all missing/invalid fields rather than
// failing on the first one — operators usually want the full list.
func Load(version string) (*Config, error) {
	cfg := &Config{
		AuthorityURL:                   strings.TrimRight(os.Getenv(EnvAuthorityURL), "/"),
		BootstrapToken:                 os.Getenv(EnvBootstrapToken),
		EdgeNodeName:                   os.Getenv(EnvEdgeNodeName),
		StateDir:                       os.Getenv(EnvStateDir),
		Platform:                       resolvePlatform(),
		InstallMode:                    strings.TrimSpace(os.Getenv(EnvInstallMode)),
		Version:                        os.Getenv(EnvVersion),
		EdgeActionURL:                  strings.TrimRight(strings.TrimSpace(os.Getenv(EnvEdgeActionURL)), "/"),
		EdgeActionCAFile:               strings.TrimSpace(os.Getenv(EnvEdgeActionCAFile)),
		EdgeActionCertFile:             strings.TrimSpace(os.Getenv(EnvEdgeActionCertFile)),
		EdgeActionKeyFile:              strings.TrimSpace(os.Getenv(EnvEdgeActionKeyFile)),
		EdgeActionSigningPublicKeyFile: strings.TrimSpace(os.Getenv(EnvEdgeActionSigningPublicKeyFile)),
		InstallRoot:                    filepath.Clean(strings.TrimSpace(os.Getenv(EnvInstallRoot))),
		OrganizationTrustRole:          strings.TrimSpace(os.Getenv(EnvOrganizationTrustRole)),
		PkiDir:                         filepath.Clean(strings.TrimSpace(os.Getenv(EnvPkiDir))),
		OrganizationCAURL:              strings.TrimRight(strings.TrimSpace(os.Getenv(EnvOrganizationCAURL)), "/"),
	}

	if cfg.EdgeNodeName == "" {
		if name, err := os.Hostname(); err == nil && name != "" {
			cfg.EdgeNodeName = name
		} else {
			cfg.EdgeNodeName = "dpf-edge-node"
		}
	}
	if cfg.StateDir == "" {
		cfg.StateDir = defaultStateDir()
	}
	if cfg.InstallMode == "" {
		cfg.InstallMode = "native"
	}
	if cfg.Version == "" {
		cfg.Version = version
		if cfg.Version == "" {
			cfg.Version = "0.0.0-dev"
		}
	}

	var problems []string
	if cfg.AuthorityURL == "" {
		problems = append(problems, fmt.Sprintf("%s is required (e.g. http://localhost:3000)", EnvAuthorityURL))
	} else if _, err := url.Parse(cfg.AuthorityURL); err != nil {
		problems = append(problems, fmt.Sprintf("%s=%q is not a valid URL: %v", EnvAuthorityURL, cfg.AuthorityURL, err))
	}
	switch cfg.Platform {
	case "darwin", "win32", "linux":
	default:
		problems = append(problems, fmt.Sprintf("platform %q is unsupported (need darwin|win32|linux)", cfg.Platform))
	}
	switch cfg.InstallMode {
	case "native", "container-host", "container-vm":
	default:
		problems = append(problems, fmt.Sprintf("%s=%q is unrecognized (need native|container-host|container-vm)", EnvInstallMode, cfg.InstallMode))
	}

	actionFields := []struct {
		name  string
		value string
	}{
		{EnvEdgeActionURL, cfg.EdgeActionURL},
		{EnvEdgeActionCAFile, cfg.EdgeActionCAFile},
		{EnvEdgeActionCertFile, cfg.EdgeActionCertFile},
		{EnvEdgeActionKeyFile, cfg.EdgeActionKeyFile},
		{EnvEdgeActionSigningPublicKeyFile, cfg.EdgeActionSigningPublicKeyFile},
	}
	configuredActionFields := 0
	for _, field := range actionFields {
		if field.value != "" {
			configuredActionFields++
		}
	}
	if configuredActionFields > 0 && configuredActionFields != len(actionFields) {
		for _, field := range actionFields {
			if field.value == "" {
				problems = append(problems, fmt.Sprintf("%s is required when the Edge action channel is configured", field.name))
			}
		}
	}
	if cfg.EdgeActionURL != "" {
		actionURL, err := url.Parse(cfg.EdgeActionURL)
		if err != nil || actionURL.Scheme != "https" || actionURL.Host == "" {
			problems = append(problems, fmt.Sprintf("%s must be an absolute https URL", EnvEdgeActionURL))
		}
	}

	joinFieldsConfigured := cfg.OrganizationTrustRole != "" || os.Getenv(EnvInstallRoot) != "" ||
		os.Getenv(EnvPkiDir) != "" || cfg.OrganizationCAURL != ""
	if joinFieldsConfigured {
		if cfg.OrganizationTrustRole != "authority" && cfg.OrganizationTrustRole != "member" {
			problems = append(problems, fmt.Sprintf("%s must be authority or member", EnvOrganizationTrustRole))
		}
		if os.Getenv(EnvInstallRoot) == "" || !filepath.IsAbs(cfg.InstallRoot) {
			problems = append(problems, fmt.Sprintf("%s must be an absolute path", EnvInstallRoot))
		}
		if os.Getenv(EnvPkiDir) == "" || !filepath.IsAbs(cfg.PkiDir) {
			problems = append(problems, fmt.Sprintf("%s must be an absolute path", EnvPkiDir))
		}
		if cfg.OrganizationTrustRole == "authority" && !privateHTTPSOrigin(cfg.OrganizationCAURL) {
			problems = append(problems, fmt.Sprintf("%s must be a private or local HTTPS origin for an authority host", EnvOrganizationCAURL))
		}
	}

	if len(problems) > 0 {
		return nil, errors.New("edge node config invalid:\n  - " + strings.Join(problems, "\n  - "))
	}
	return cfg, nil
}

func privateHTTPSOrigin(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "host.docker.internal" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

// resolvePlatform converts Go's GOOS to the wire-contract platform
// string the Authority expects. GOOS "windows" → "win32" matches
// services/edge-node/src/config.ts which uses Node's process.platform
// values; the Authority's Zod schema accepts only those three.
func resolvePlatform() string {
	if override := os.Getenv(EnvPlatformOverride); override != "" {
		return override
	}
	switch runtime.GOOS {
	case "windows":
		return "win32"
	default:
		return runtime.GOOS
	}
}

func defaultStateDir() string {
	switch runtime.GOOS {
	case "windows":
		// ProgramData is the conventional shared-secure location for
		// Windows services. The Mode 4 installer creates the directory
		// with restricted ACLs at install time; we just resolve the
		// path here.
		if pd := os.Getenv("PROGRAMDATA"); pd != "" {
			return pd + `\dpf-edge-node`
		}
		return `C:\ProgramData\dpf-edge-node`
	case "darwin":
		return "/Library/Application Support/dpf-edge-node"
	default:
		return "/var/lib/dpf-edge-node"
	}
}
