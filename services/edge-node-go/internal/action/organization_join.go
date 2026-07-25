package action

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type OrganizationTrustRole string

const (
	OrganizationTrustAuthority OrganizationTrustRole = "authority"
	OrganizationTrustMember    OrganizationTrustRole = "member"
)

var (
	ErrWrongOrganizationTrustRole = errors.New("organization join action is not allowed for this host role")
	ErrHostActionFailed           = errors.New("organization join host action failed")
	ErrHealthVerificationFailed   = errors.New("organization join health verification failed")
	ErrRollbackFailed             = errors.New("organization join rollback failed")
	safePeerPattern               = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,253}$`)
	safeTokenPattern              = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
)

const maxJoinPackageBytes = 64 * 1024

type OrganizationJoinConfig struct {
	Role              OrganizationTrustRole
	Platform          string
	InstallRoot       string
	StateDir          string
	PkiDir            string
	HostIdentity      string
	OrganizationCAURL string
	Timeout           time.Duration
}

type HostCommandRunner interface {
	Run(context.Context, string, []string) (int, error)
}

type OrganizationJoinHandler struct {
	Config OrganizationJoinConfig
	Runner HostCommandRunner
	Now    func() time.Time
	Verify func(context.Context) (map[string]any, error)
}

type execCommandRunner struct{}

func (h *OrganizationJoinHandler) now() time.Time {
	if h.Now != nil {
		return h.Now().UTC()
	}
	return time.Now().UTC()
}

func (execCommandRunner) Run(ctx context.Context, name string, args []string) (int, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	err := cmd.Run()
	if err == nil {
		return 0, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode(), err
	}
	return -1, err
}

func (h *OrganizationJoinHandler) Execute(ctx context.Context, actionType string, raw json.RawMessage) (ExecutionOutput, error) {
	if err := h.validateConfig(); err != nil {
		return ExecutionOutput{}, err
	}
	switch actionType {
	case "organization.join.issue":
		if h.Config.Role != OrganizationTrustAuthority {
			return ExecutionOutput{}, ErrWrongOrganizationTrustRole
		}
		parameters, err := parseIssueParameters(raw)
		if err != nil {
			return ExecutionOutput{}, err
		}
		return h.issue(ctx, parameters)
	case "organization.join.import":
		if h.Config.Role != OrganizationTrustMember {
			return ExecutionOutput{}, ErrWrongOrganizationTrustRole
		}
		parameters, err := parseImportParameters(raw, h.now(), h.Config.HostIdentity)
		if err != nil {
			return ExecutionOutput{}, err
		}
		return h.importPackage(ctx, parameters)
	default:
		return ExecutionOutput{}, ErrUnsupportedAction
	}
}

type issueParameters struct {
	IntendedPeer string `json:"intendedPeer"`
	TTLSeconds   int    `json:"ttlSeconds"`
}

type importParameters struct {
	JoinPackage string `json:"joinPackage"`
}

func parseIssueParameters(raw json.RawMessage) (issueParameters, error) {
	var parameters issueParameters
	if err := decodeExactJSON(raw, &parameters); err != nil {
		return parameters, ErrInvalidParameters
	}
	if !safePeerPattern.MatchString(parameters.IntendedPeer) || parameters.TTLSeconds < 300 || parameters.TTLSeconds > 900 {
		return parameters, ErrInvalidParameters
	}
	return parameters, nil
}

func parseImportParameters(raw json.RawMessage, now time.Time, hostIdentity string) (importParameters, error) {
	var parameters importParameters
	if err := decodeExactJSON(raw, &parameters); err != nil || parameters.JoinPackage == "" {
		return parameters, ErrInvalidParameters
	}
	preview, err := validateJoinPackage(parameters.JoinPackage, now)
	if err != nil || preview.IntendedPeer != hostIdentity {
		return parameters, ErrInvalidParameters
	}
	return parameters, nil
}

func decodeExactJSON(raw json.RawMessage, destination any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}

func (h *OrganizationJoinHandler) issue(ctx context.Context, parameters issueParameters) (ExecutionOutput, error) {
	if _, err := os.Stat(filepath.Join(h.Config.PkiDir, "secrets", "step-ca-password")); err != nil {
		return ExecutionOutput{}, ErrWrongOrganizationTrustRole
	}
	temporary, err := os.MkdirTemp(h.Config.StateDir, "organization-join-issue-")
	if err != nil {
		return ExecutionOutput{}, ErrHostActionFailed
	}
	_ = os.Chmod(temporary, 0o700)
	defer os.RemoveAll(temporary)
	packagePath := filepath.Join(temporary, "organization-join.dpfjoin")
	executable, args, err := h.command("issue-join", parameters.IntendedPeer, packagePath, parameters.TTLSeconds)
	if err != nil {
		return ExecutionOutput{}, err
	}
	exitCode, err := h.run(ctx, executable, args)
	if err != nil || exitCode != 0 {
		return ExecutionOutput{}, ErrHostActionFailed
	}
	joinPackage, err := readPrivateBoundedFile(packagePath)
	if err != nil {
		return ExecutionOutput{}, ErrHostActionFailed
	}
	preview, err := validateJoinPackage(joinPackage, h.now())
	if err != nil || preview.IntendedPeer != parameters.IntendedPeer {
		return ExecutionOutput{}, ErrHostActionFailed
	}
	return ExecutionOutput{
		Result: map[string]any{"joinPackage": joinPackage},
		Evidence: map[string]any{
			"exitCode":     exitCode,
			"intendedPeer": preview.IntendedPeer,
			"expiresAt":    preview.ExpiresAt.Format(time.RFC3339),
		},
	}, nil
}

func (h *OrganizationJoinHandler) importPackage(ctx context.Context, parameters importParameters) (ExecutionOutput, error) {
	temporary, err := os.MkdirTemp(h.Config.StateDir, "organization-join-import-")
	if err != nil {
		return ExecutionOutput{}, ErrHostActionFailed
	}
	_ = os.Chmod(temporary, 0o700)
	defer os.RemoveAll(temporary)
	packagePath := filepath.Join(temporary, "organization-join.dpfjoin")
	if err := os.WriteFile(packagePath, []byte(parameters.JoinPackage), 0o600); err != nil {
		return ExecutionOutput{}, ErrHostActionFailed
	}
	if err := os.Chmod(packagePath, 0o600); err != nil {
		return ExecutionOutput{}, ErrHostActionFailed
	}
	snapshotPath := filepath.Join(temporary, "rollback")
	snapshot, err := createOrganizationTrustSnapshot(h.Config.InstallRoot, h.Config.PkiDir, snapshotPath)
	if err != nil {
		return ExecutionOutput{}, ErrHostActionFailed
	}
	restore := func() error { return snapshot.Restore(h.Config.InstallRoot, h.Config.PkiDir) }
	executable, args, err := h.command("join", h.Config.HostIdentity, packagePath, 0)
	if err != nil {
		return ExecutionOutput{}, err
	}
	exitCode, executionErr := h.run(ctx, executable, args)
	if executionErr != nil || exitCode != 0 {
		if restoreErr := restore(); restoreErr != nil {
			return ExecutionOutput{}, ErrRollbackFailed
		}
		return ExecutionOutput{}, ErrHostActionFailed
	}
	verification, verificationErr := h.verify(ctx)
	if verificationErr != nil || !verificationAllTrue(verification) {
		if restoreErr := restore(); restoreErr != nil {
			return ExecutionOutput{}, ErrRollbackFailed
		}
		return ExecutionOutput{}, ErrHealthVerificationFailed
	}
	evidence := map[string]any{"exitCode": exitCode, "rollbackRestored": false}
	for key, value := range verification {
		evidence[key] = value
	}
	return ExecutionOutput{Evidence: evidence}, nil
}

func (h *OrganizationJoinHandler) run(ctx context.Context, executable string, args []string) (int, error) {
	timeout := h.Config.Timeout
	if timeout <= 0 || timeout > 15*time.Minute {
		timeout = 10 * time.Minute
	}
	commandContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	runner := h.Runner
	if runner == nil {
		runner = execCommandRunner{}
	}
	return runner.Run(commandContext, executable, args)
}

func (h *OrganizationJoinHandler) verify(ctx context.Context) (map[string]any, error) {
	if h.Verify == nil {
		return nil, ErrHealthVerificationFailed
	}
	return h.Verify(ctx)
}

func (h *OrganizationJoinHandler) command(mode, peer, packagePath string, ttlSeconds int) (string, []string, error) {
	if h.Config.Platform == "win32" {
		script := filepath.Join(h.Config.InstallRoot, "scripts", "bootstrap-organization-pki.ps1")
		if err := validateFixedScript(script, false); err != nil {
			return "", nil, err
		}
		args := []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Mode", mode, "-Hostname", peer, "-OutDir", h.Config.PkiDir}
		if mode == "issue-join" {
			args = append(args, "-CaUrl", h.Config.OrganizationCAURL, "-PackageOutput", packagePath, "-PackageTtlSeconds", strconv.Itoa(ttlSeconds))
		} else {
			args = append(args, "-JoinPackage", packagePath)
		}
		return "powershell.exe", args, nil
	}
	script := filepath.Join(h.Config.InstallRoot, "scripts", "bootstrap-organization-pki.sh")
	if err := validateFixedScript(script, true); err != nil {
		return "", nil, err
	}
	args := []string{script, "--mode", mode, "--hostname", peer, "--out-dir", h.Config.PkiDir}
	if mode == "issue-join" {
		args = append(args, "--ca-url", h.Config.OrganizationCAURL, "--package-output", packagePath, "--package-ttl-seconds", strconv.Itoa(ttlSeconds))
	} else {
		args = append(args, "--join-package", packagePath)
	}
	return "/bin/bash", args, nil
}

func (h *OrganizationJoinHandler) validateConfig() error {
	if h.Config.Role != OrganizationTrustAuthority && h.Config.Role != OrganizationTrustMember {
		return ErrWrongOrganizationTrustRole
	}
	if h.Config.Platform != "darwin" && h.Config.Platform != "linux" && h.Config.Platform != "win32" {
		return ErrHostActionFailed
	}
	for _, path := range []string{h.Config.InstallRoot, h.Config.StateDir, h.Config.PkiDir} {
		if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return ErrHostActionFailed
		}
	}
	if !safePeerPattern.MatchString(h.Config.HostIdentity) {
		return ErrHostActionFailed
	}
	if h.Config.Role == OrganizationTrustAuthority && !validPrivateCAURL(h.Config.OrganizationCAURL) {
		return ErrHostActionFailed
	}
	return nil
}

func validateFixedScript(path string, enforcePOSIXPermissions bool) error {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || (enforcePOSIXPermissions && info.Mode().Perm()&0o022 != 0) {
		return ErrHostActionFailed
	}
	return nil
}

func readPrivateBoundedFile(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxJoinPackageBytes {
		return "", ErrHostActionFailed
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		return "", ErrHostActionFailed
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

type joinPackagePreview struct {
	IntendedPeer string
	ExpiresAt    time.Time
}

func validateJoinPackage(raw string, now time.Time) (joinPackagePreview, error) {
	var preview joinPackagePreview
	if len(raw) == 0 || len(raw) > maxJoinPackageBytes || strings.ContainsRune(raw, '\x00') {
		return preview, ErrInvalidParameters
	}
	scanner := bufio.NewScanner(strings.NewReader(strings.ReplaceAll(raw, "\r\n", "\n")))
	if !scanner.Scan() || scanner.Text() != "DPF_ORGANIZATION_JOIN_V2" {
		return preview, ErrInvalidParameters
	}
	allowed := map[string]bool{
		"package_id": true, "ca_url": true, "root_fingerprint": true,
		"intended_hostname": true, "intended_sans": true, "expires_at": true,
		"enrollment_token": true, "edge_client_enrollment_token": true,
	}
	fields := map[string]string{}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 || !allowed[parts[0]] || fields[parts[0]] != "" {
			return preview, ErrInvalidParameters
		}
		fields[parts[0]] = parts[1]
	}
	if scanner.Err() != nil || !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(fields["package_id"]) ||
		!regexp.MustCompile(`^[A-Fa-f0-9]{64}$`).MatchString(fields["root_fingerprint"]) ||
		!safePeerPattern.MatchString(fields["intended_hostname"]) || !validPrivateCAURL(fields["ca_url"]) ||
		!validSafeToken(fields["enrollment_token"]) || !validSafeToken(fields["edge_client_enrollment_token"]) {
		return preview, ErrInvalidParameters
	}
	for _, san := range strings.Split(fields["intended_sans"], ",") {
		if san != "" && !safePeerPattern.MatchString(san) {
			return preview, ErrInvalidParameters
		}
	}
	expiresEpoch, err := strconv.ParseInt(fields["expires_at"], 10, 64)
	if err != nil {
		return preview, ErrInvalidParameters
	}
	preview.IntendedPeer = fields["intended_hostname"]
	preview.ExpiresAt = time.Unix(expiresEpoch, 0).UTC()
	if !preview.ExpiresAt.After(now) {
		return joinPackagePreview{}, ErrInvalidParameters
	}
	return preview, nil
}

func validSafeToken(value string) bool {
	return len(value) > 0 && len(value) <= 4096 && safeTokenPattern.MatchString(value)
}

func validPrivateCAURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "host.docker.internal" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

func verificationAllTrue(value map[string]any) bool {
	for _, key := range []string{"certificateTrust", "overlayPersistence", "portalHealth", "edgeHeartbeat"} {
		if passed, ok := value[key].(bool); !ok || !passed {
			return false
		}
	}
	return true
}

type organizationTrustSnapshot struct {
	root       string
	envExisted bool
	pkiExisted bool
}

func createOrganizationTrustSnapshot(installRoot, pkiDir, destination string) (*organizationTrustSnapshot, error) {
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return nil, err
	}
	snapshot := &organizationTrustSnapshot{root: destination}
	envPath := filepath.Join(installRoot, ".env")
	if _, err := os.Stat(envPath); err == nil {
		snapshot.envExisted = true
		if err := copyFile(envPath, filepath.Join(destination, "install.env")); err != nil {
			return nil, err
		}
	}
	if _, err := os.Stat(pkiDir); err == nil {
		snapshot.pkiExisted = true
		if err := copyTree(pkiDir, filepath.Join(destination, "pki")); err != nil {
			return nil, err
		}
	}
	return snapshot, nil
}

func (s *organizationTrustSnapshot) Restore(installRoot, pkiDir string) error {
	envPath := filepath.Join(installRoot, ".env")
	if s.envExisted {
		if err := copyFile(filepath.Join(s.root, "install.env"), envPath); err != nil {
			return err
		}
	} else if err := os.Remove(envPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.RemoveAll(pkiDir); err != nil {
		return err
	}
	if s.pkiExisted {
		return copyTree(filepath.Join(s.root, "pki"), pkiDir)
	}
	return nil
}

func copyTree(source, destination string) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported snapshot entry")
		}
		return copyFile(path, target)
	})
}

func copyFile(source, destination string) error {
	content, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	return os.WriteFile(destination, content, info.Mode().Perm())
}
