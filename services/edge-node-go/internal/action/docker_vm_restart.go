package action

// BI-F8F8C383 — restart the Docker Desktop VM (WSL) on the Windows host.
//
// The substrate reconciler reports processes stuck in uninterruptible I/O
// (`substrate:docker-vm-wedged`). Only a VM restart clears them, and the portal
// that would order it runs inside that VM, so the restart runs here, on the
// host, after an operator approved it in the portal.
//
// The procedure is fixed and takes no input beyond the issue it clears:
//   1. stop Docker Desktop (it would otherwise race the VM shutdown),
//   2. `wsl.exe --shutdown`,
//   3. move Docker's IPC socket directories aside: a crashed backend leaves
//      AF_UNIX reparse points Windows cannot open or delete, and the next start
//      then fails on them (observed eight times; BI-DDA569D9),
//   4. start Docker Desktop and wait until the engine answers,
//   5. run the DPF autostart task, when configured, to bring the stack up.
//
// It can never reboot the host: every command goes through an allowlist that
// holds only taskkill, wsl.exe, docker and schtasks, and a refused command is
// an error, not a fallback.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

const (
	DockerVmRestartActionType = "substrate.docker-vm.restart"
	DockerVmWedgedIssueKey    = "substrate:docker-vm-wedged"
)

var (
	ErrVmShutdownFailed      = errors.New("wsl --shutdown failed")
	ErrDockerStartFailed     = errors.New("docker desktop could not be started")
	ErrDockerNotReady        = errors.New("docker engine did not become ready")
	ErrHostCommandNotAllowed = errors.New("host command is not in the docker vm restart allowlist")
	// ErrHostRebootRequired: native Docker Engine on Linux has no VM; a process
	// stuck in the host kernel is cleared only by a host reboot, which this
	// agent never performs.
	ErrHostRebootRequired = errors.New("only a host reboot clears this, and the agent never reboots the host")
)

// Docker runtimes the restart can tell apart (BI-28EFE18A).
const (
	DockerRuntimeDesktop = "desktop"
	DockerRuntimeEngine  = "engine"
	DockerRuntimeUnknown = "unknown"
)

// allowedHostCommand is the whole of what the restart may run on each host.
// It checks the arguments too, not just the program: systemctl and launchctl
// can reboot a machine, so only their exact start forms pass. Nothing here can
// reboot or shut down the host on any platform.
func allowedHostCommand(platform, name string, args []string) bool {
	exactly := func(want ...string) bool {
		if len(args) != len(want) {
			return false
		}
		for i := range want {
			if want[i] != "*" && args[i] != want[i] {
				return false
			}
		}
		return true
	}
	dockerCommand := func() bool {
		return exactly("info", "--format", "*") || exactly("desktop", "status") || exactly("desktop", "restart")
	}
	switch platform {
	case "win32":
		switch name {
		case "taskkill":
			return exactly("/IM", "*", "/T", "/F")
		case "wsl.exe":
			return exactly("--shutdown")
		case "docker":
			return dockerCommand()
		case "schtasks":
			return exactly("/Run", "/TN", "*")
		}
	case "darwin":
		switch name {
		case "docker":
			return dockerCommand()
		case "launchctl":
			return exactly("start", "*")
		}
	case "linux":
		switch name {
		case "docker":
			return dockerCommand()
		case "systemctl":
			return exactly("--user", "start", "*")
		}
	}
	return false
}

// CommandRunner runs one host command and returns its combined output.
type CommandRunner func(ctx context.Context, name string, args ...string) (string, error)

type DockerVmRestartConfig struct {
	// Platform is the host OS in the agent's vocabulary: win32 | darwin | linux.
	Platform           string
	DockerDesktopExe   string
	LocalAppData       string
	AutostartTaskName  string
	DockerReadyTimeout time.Duration
	PollInterval       time.Duration
}

type DockerVmRestartHandler struct {
	Config DockerVmRestartConfig
	Run    CommandRunner
	// Start launches Docker Desktop detached; it must not wait for it to exit.
	Start  func(path string) error
	Exists func(path string) bool
	Rename func(oldPath, newPath string) error
	Mkdir  func(path string) error
	Sleep  func(time.Duration)
	Now    func() time.Time
}

type restartStep struct {
	Step    string `json:"step"`
	Outcome string `json:"outcome"`
	Detail  string `json:"detail,omitempty"`
}

func (h *DockerVmRestartHandler) platform() string {
	if h.Config.Platform == "" {
		return "win32"
	}
	return h.Config.Platform
}

func (h *DockerVmRestartHandler) run(ctx context.Context, name string, args ...string) (string, error) {
	if !allowedHostCommand(h.platform(), name, args) {
		return "", fmt.Errorf("%w: %s %s", ErrHostCommandNotAllowed, name, strings.Join(args, " "))
	}
	return h.Run(ctx, name, args...)
}

// DetectDockerRuntime reports whether the host's Docker runs inside Docker
// Desktop's VM or directly on the host kernel. Windows always runs Docker in
// a VM. Elsewhere Docker Desktop names itself in `docker info`, and its CLI
// answers `docker desktop status`; a native Linux Engine does neither.
func DetectDockerRuntime(ctx context.Context, platform string, run CommandRunner) string {
	if platform == "win32" {
		return DockerRuntimeDesktop
	}
	guarded := func(name string, args ...string) (string, error) {
		if !allowedHostCommand(platform, name, args) {
			return "", ErrHostCommandNotAllowed
		}
		return run(ctx, name, args...)
	}
	if out, err := guarded("docker", "info", "--format", "{{.OperatingSystem}}"); err == nil && strings.Contains(out, "Docker Desktop") {
		return DockerRuntimeDesktop
	}
	if _, err := guarded("docker", "desktop", "status"); err == nil {
		return DockerRuntimeDesktop
	}
	if platform == "linux" {
		return DockerRuntimeEngine
	}
	return DockerRuntimeUnknown
}

func validDockerVmRestartParameters(raw json.RawMessage) bool {
	var parameters map[string]any
	if err := json.Unmarshal(raw, &parameters); err != nil || len(parameters) != 1 {
		return false
	}
	return parameters["issueKey"] == DockerVmWedgedIssueKey
}

func trimDetail(text string) string {
	text = strings.TrimSpace(text)
	if len(text) > 300 {
		return text[:300]
	}
	return text
}

// Execute runs the fixed restart procedure. Its evidence lists every step, so
// the portal can show what happened even when the restart failed.
func (h *DockerVmRestartHandler) Execute(ctx context.Context, parameters json.RawMessage) (ExecutionOutput, error) {
	if !validDockerVmRestartParameters(parameters) {
		return ExecutionOutput{}, ErrInvalidParameters
	}
	now := h.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	startedAt := now()
	steps := []restartStep{}
	output := func() ExecutionOutput {
		return ExecutionOutput{Evidence: map[string]any{
			"steps":      steps,
			"startedAt":  startedAt.Format(time.RFC3339Nano),
			"finishedAt": now().Format(time.RFC3339Nano),
		}}
	}

	if h.platform() != "win32" {
		return h.restartDockerDesktop(ctx, steps, output, now)
	}

	for _, image := range []string{"Docker Desktop.exe", "com.docker.backend.exe"} {
		// A process that is not running is fine; this only makes sure nothing
		// holds the VM while it shuts down.
		detail, err := h.run(ctx, "taskkill", "/IM", image, "/T", "/F")
		outcome := "stopped"
		if err != nil {
			outcome = "not-running"
		}
		steps = append(steps, restartStep{Step: "stop " + image, Outcome: outcome, Detail: trimDetail(detail)})
	}

	if detail, err := h.run(ctx, "wsl.exe", "--shutdown"); err != nil {
		steps = append(steps, restartStep{Step: "wsl --shutdown", Outcome: "failed", Detail: trimDetail(detail + " " + err.Error())})
		return output(), ErrVmShutdownFailed
	}
	steps = append(steps, restartStep{Step: "wsl --shutdown", Outcome: "done"})

	stamp := startedAt.Format("20060102-150405")
	for _, dir := range []string{
		filepath.Join(h.Config.LocalAppData, "Docker", "run"),
		filepath.Join(h.Config.LocalAppData, "docker-secrets-engine"),
	} {
		if !h.Exists(dir) {
			steps = append(steps, restartStep{Step: "clear " + dir, Outcome: "absent"})
		} else if err := h.Rename(dir, dir+".stale-"+stamp); err != nil {
			steps = append(steps, restartStep{Step: "clear " + dir, Outcome: "failed", Detail: trimDetail(err.Error())})
			continue
		} else {
			steps = append(steps, restartStep{Step: "clear " + dir, Outcome: "moved aside"})
		}
		_ = h.Mkdir(dir)
	}

	if err := h.Start(h.Config.DockerDesktopExe); err != nil {
		steps = append(steps, restartStep{Step: "start Docker Desktop", Outcome: "failed", Detail: trimDetail(err.Error())})
		return output(), ErrDockerStartFailed
	}
	steps = append(steps, restartStep{Step: "start Docker Desktop", Outcome: "started"})

	return h.finishRestart(ctx, &steps, output, now)
}

// restartDockerDesktop is the macOS and Linux procedure. Docker Desktop's own
// CLI restarts its VM on both; native Linux Engine has no VM to restart.
func (h *DockerVmRestartHandler) restartDockerDesktop(
	ctx context.Context,
	steps []restartStep,
	output func() ExecutionOutput,
	now func() time.Time,
) (ExecutionOutput, error) {
	runtime := DetectDockerRuntime(ctx, h.platform(), h.Run)
	steps = append(steps, restartStep{Step: "detect Docker runtime", Outcome: runtime})
	withSteps := func() ExecutionOutput {
		result := output()
		result.Evidence["steps"] = steps
		return result
	}
	if runtime != DockerRuntimeDesktop {
		steps = append(steps, restartStep{Step: "restart Docker VM", Outcome: "refused", Detail: ErrHostRebootRequired.Error()})
		return withSteps(), ErrHostRebootRequired
	}
	if detail, err := h.run(ctx, "docker", "desktop", "restart"); err != nil {
		steps = append(steps, restartStep{Step: "docker desktop restart", Outcome: "failed", Detail: trimDetail(detail + " " + err.Error())})
		return withSteps(), ErrDockerStartFailed
	}
	steps = append(steps, restartStep{Step: "docker desktop restart", Outcome: "done"})
	return h.finishRestart(ctx, &steps, withSteps, now)
}

// finishRestart waits for the engine, then brings the DPF stack back through
// the platform's own autostart: the logon task, LaunchAgent or user service.
func (h *DockerVmRestartHandler) finishRestart(
	ctx context.Context,
	steps *[]restartStep,
	output func() ExecutionOutput,
	now func() time.Time,
) (ExecutionOutput, error) {
	deadline := now().Add(h.Config.DockerReadyTimeout)
	ready := false
	serverVersion := ""
	for {
		version, err := h.run(ctx, "docker", "info", "--format", "{{.ServerVersion}}")
		// A shim that exits 0 with no output is not an answering engine.
		if err == nil && strings.TrimSpace(version) != "" {
			ready = true
			serverVersion = strings.TrimSpace(version)
			break
		}
		if !now().Before(deadline) || ctx.Err() != nil {
			break
		}
		h.Sleep(h.Config.PollInterval)
	}
	if !ready {
		*steps = append(*steps, restartStep{Step: "wait for Docker engine", Outcome: "timed out"})
		return output(), ErrDockerNotReady
	}
	*steps = append(*steps, restartStep{Step: "wait for Docker engine", Outcome: "ready", Detail: serverVersion})

	if h.Config.AutostartTaskName != "" {
		var detail string
		var err error
		switch h.platform() {
		case "darwin":
			detail, err = h.run(ctx, "launchctl", "start", h.Config.AutostartTaskName)
		case "linux":
			detail, err = h.run(ctx, "systemctl", "--user", "start", h.Config.AutostartTaskName)
		default:
			detail, err = h.run(ctx, "schtasks", "/Run", "/TN", h.Config.AutostartTaskName)
		}
		outcome := "started"
		if err != nil {
			outcome = "failed"
		}
		*steps = append(*steps, restartStep{Step: "run " + h.Config.AutostartTaskName, Outcome: outcome, Detail: trimDetail(detail)})
	}

	result := output()
	result.Evidence["dockerServerVersion"] = serverVersion
	result.Result = map[string]any{"restarted": true, "issueKey": DockerVmWedgedIssueKey}
	return result, nil
}
