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
)

var dockerVmRestartCommands = map[string]bool{
	"taskkill": true,
	"wsl.exe":  true,
	"docker":   true,
	"schtasks": true,
}

// CommandRunner runs one host command and returns its combined output.
type CommandRunner func(ctx context.Context, name string, args ...string) (string, error)

type DockerVmRestartConfig struct {
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

func (h *DockerVmRestartHandler) run(ctx context.Context, name string, args ...string) (string, error) {
	if !dockerVmRestartCommands[name] {
		return "", fmt.Errorf("%w: %s", ErrHostCommandNotAllowed, name)
	}
	return h.Run(ctx, name, args...)
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
		steps = append(steps, restartStep{Step: "wait for Docker engine", Outcome: "timed out"})
		return output(), ErrDockerNotReady
	}
	steps = append(steps, restartStep{Step: "wait for Docker engine", Outcome: "ready", Detail: serverVersion})

	if h.Config.AutostartTaskName != "" {
		detail, err := h.run(ctx, "schtasks", "/Run", "/TN", h.Config.AutostartTaskName)
		outcome := "started"
		if err != nil {
			outcome = "failed"
		}
		steps = append(steps, restartStep{Step: "run " + h.Config.AutostartTaskName, Outcome: outcome, Detail: trimDetail(detail)})
	}

	result := output()
	result.Evidence["dockerServerVersion"] = serverVersion
	result.Result = map[string]any{"restarted": true, "issueKey": DockerVmWedgedIssueKey}
	return result, nil
}
