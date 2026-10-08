package main

// BI-F8F8C383: real host I/O for the operator-approved Docker VM restart. The
// procedure and its allowlist live in internal/action/docker_vm_restart.go.

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/action"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/config"
)

// dockerDesktopExe prefers the configured path, then the per-user install
// (where current Docker Desktop installs itself), then the machine install.
func dockerDesktopExe(cfg *config.Config) string {
	if cfg.DockerDesktopExe != "" {
		return cfg.DockerDesktopExe
	}
	perUser := filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "DockerDesktop", "Docker Desktop.exe")
	if _, err := os.Stat(perUser); err == nil {
		return perUser
	}
	return filepath.Join(os.Getenv("ProgramFiles"), "Docker", "Docker", "Docker Desktop.exe")
}

func newDockerVmRestartHandler(cfg *config.Config) *action.DockerVmRestartHandler {
	return &action.DockerVmRestartHandler{
		Config: action.DockerVmRestartConfig{
			Platform:           cfg.Platform,
			DockerDesktopExe:   dockerDesktopExe(cfg),
			LocalAppData:       os.Getenv("LOCALAPPDATA"),
			AutostartTaskName:  cfg.AutostartTaskName,
			DockerReadyTimeout: 6 * time.Minute,
			PollInterval:       10 * time.Second,
		},
		Run: func(ctx context.Context, name string, args ...string) (string, error) {
			commandContext, cancel := context.WithTimeout(ctx, 2*time.Minute)
			defer cancel()
			out, err := exec.CommandContext(commandContext, name, args...).CombinedOutput()
			return string(out), err
		},
		Start: func(path string) error {
			command := exec.Command(path)
			if err := command.Start(); err != nil {
				return err
			}
			return command.Process.Release()
		},
		Exists: func(path string) bool {
			_, err := os.Lstat(path)
			return err == nil
		},
		Rename: os.Rename,
		Mkdir:  func(path string) error { return os.MkdirAll(path, 0o755) },
		Sleep:  time.Sleep,
		Now:    func() time.Time { return time.Now().UTC() },
	}
}

var (
	dockerRuntimeOnce   sync.Once
	dockerRuntimeCached = action.DockerRuntimeUnknown
)

// currentHostUpkeep reports the restart capability and the Docker runtime,
// detected once per process: switching between Docker Desktop and a native
// engine needs a reinstall, and the agent restarts with the host anyway.
func currentHostUpkeep(cfg *config.Config) hostUpkeepReport {
	if !cfg.DockerVmRestartEnabled() {
		return hostUpkeepReport{}
	}
	dockerRuntimeOnce.Do(func() {
		run := func(ctx context.Context, name string, args ...string) (string, error) {
			commandContext, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			out, err := exec.CommandContext(commandContext, name, args...).CombinedOutput()
			return string(out), err
		}
		dockerRuntimeCached = action.DetectDockerRuntime(context.Background(), cfg.Platform, run)
	})
	return hostUpkeepReport{dockerVmRestart: true, dockerRuntime: dockerRuntimeCached}
}
