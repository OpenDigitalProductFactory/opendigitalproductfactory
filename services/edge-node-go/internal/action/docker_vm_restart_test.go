package action

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeHost struct {
	commands    []string
	failCommand map[string]error
	dockerReady int // the docker info call (1-based) that first answers
	dockerCalls int
	started     []string
	startErr    error
	existing    map[string]bool
	renamed     []string
	clock       time.Time
	slept       time.Duration
}

func (f *fakeHost) handler(task string) *DockerVmRestartHandler {
	return &DockerVmRestartHandler{
		Config: DockerVmRestartConfig{
			DockerDesktopExe:   `C:\Users\op\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`,
			LocalAppData:       `C:\Users\op\AppData\Local`,
			AutostartTaskName:  task,
			DockerReadyTimeout: 5 * time.Minute,
			PollInterval:       10 * time.Second,
		},
		Run: func(_ context.Context, name string, args ...string) (string, error) {
			line := name + " " + strings.Join(args, " ")
			f.commands = append(f.commands, line)
			if name == "docker" {
				f.dockerCalls++
				if f.dockerReady == 0 || f.dockerCalls < f.dockerReady {
					return "", errors.New("engine not running")
				}
				return "29.1.0\n", nil
			}
			if err, ok := f.failCommand[name]; ok {
				return "boom", err
			}
			return "", nil
		},
		Start:  func(path string) error { f.started = append(f.started, path); return f.startErr },
		Exists: func(path string) bool { return f.existing[path] },
		Rename: func(oldPath, newPath string) error { f.renamed = append(f.renamed, oldPath+" -> "+newPath); return nil },
		Mkdir:  func(string) error { return nil },
		Sleep:  func(d time.Duration) { f.slept += d; f.clock = f.clock.Add(d) },
		Now:    func() time.Time { return f.clock },
	}
}

var wedgedParameters = json.RawMessage(`{"issueKey":"substrate:docker-vm-wedged"}`)

func TestDockerVmRestartRunsTheFixedProcedureAndReportsEachStep(t *testing.T) {
	host := &fakeHost{
		dockerReady: 3,
		existing: map[string]bool{
			`C:\Users\op\AppData\Local\Docker\run`:            true,
			`C:\Users\op\AppData\Local\docker-secrets-engine`: true,
		},
		clock: time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC),
	}
	output, err := host.handler("DPF-Autostart").Execute(context.Background(), wedgedParameters)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(host.commands, "\n")
	for _, want := range []string{"taskkill /IM Docker Desktop.exe /T /F", "wsl.exe --shutdown", "docker info --format {{.ServerVersion}}", "schtasks /Run /TN DPF-Autostart"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in:\n%s", want, joined)
		}
	}
	if len(host.renamed) != 2 || !strings.Contains(host.renamed[1], "docker-secrets-engine.stale-20261007-120000") {
		t.Fatalf("socket directories were not moved aside: %v", host.renamed)
	}
	if len(host.started) != 1 {
		t.Fatalf("Docker Desktop started %d times", len(host.started))
	}
	if output.Evidence["dockerServerVersion"] != "29.1.0" || output.Result["restarted"] != true {
		t.Fatalf("evidence=%v result=%v", output.Evidence, output.Result)
	}
	if host.slept != 20*time.Second {
		t.Fatalf("expected two polls before ready, slept %v", host.slept)
	}
}

func TestDockerVmRestartNeverRebootsTheHost(t *testing.T) {
	host := &fakeHost{dockerReady: 1}
	if _, err := host.handler("DPF-Autostart").Execute(context.Background(), wedgedParameters); err != nil {
		t.Fatal(err)
	}
	for _, command := range host.commands {
		lower := strings.ToLower(command)
		if strings.HasPrefix(lower, "shutdown") || strings.Contains(lower, "restart-computer") || strings.Contains(lower, "/r ") {
			t.Fatalf("host reboot command issued: %q", command)
		}
	}
	h := host.handler("")
	if _, err := h.run(context.Background(), "shutdown.exe", "/r", "/t", "0"); !errors.Is(err, ErrHostCommandNotAllowed) {
		t.Fatalf("shutdown.exe must be refused by the allowlist, got %v", err)
	}
}

func TestDockerVmRestartRefusesAnyOtherParameters(t *testing.T) {
	for _, raw := range []string{`{}`, `{"issueKey":"other"}`, `{"issueKey":"substrate:docker-vm-wedged","command":"x"}`, `not json`} {
		host := &fakeHost{dockerReady: 1}
		if _, err := host.handler("").Execute(context.Background(), json.RawMessage(raw)); !errors.Is(err, ErrInvalidParameters) {
			t.Fatalf("%s: expected ErrInvalidParameters, got %v", raw, err)
		}
		if len(host.commands) != 0 {
			t.Fatalf("%s: ran commands before validating parameters", raw)
		}
	}
}

func TestDockerVmRestartReportsAShutdownFailureWithItsSteps(t *testing.T) {
	host := &fakeHost{failCommand: map[string]error{"wsl.exe": errors.New("exit 1")}}
	output, err := host.handler("").Execute(context.Background(), wedgedParameters)
	if !errors.Is(err, ErrVmShutdownFailed) {
		t.Fatalf("got %v", err)
	}
	if len(host.started) != 0 {
		t.Fatal("must not start Docker after a failed shutdown")
	}
	if output.Evidence["steps"] == nil {
		t.Fatal("failure must still carry its steps")
	}
}

func TestDockerVmRestartTimesOutWhenTheEngineNeverAnswers(t *testing.T) {
	host := &fakeHost{dockerReady: 0}
	_, err := host.handler("DPF-Autostart").Execute(context.Background(), wedgedParameters)
	if !errors.Is(err, ErrDockerNotReady) {
		t.Fatalf("got %v", err)
	}
	if strings.Contains(strings.Join(host.commands, "\n"), "schtasks") {
		t.Fatal("must not run the autostart task when Docker is not up")
	}
}

func TestExecutorDispatchesTheVmRestartOnlyWhenConfigured(t *testing.T) {
	executor := &Executor{}
	if _, err := executor.dispatchPrivileged(context.Background(), DockerVmRestartActionType, wedgedParameters); !errors.Is(err, ErrUnsupportedAction) {
		t.Fatalf("an executor without a restart handler must refuse, got %v", err)
	}
	host := &fakeHost{dockerReady: 1}
	executor.DockerVmRestart = host.handler("")
	if _, err := executor.dispatchPrivileged(context.Background(), DockerVmRestartActionType, wedgedParameters); err != nil {
		t.Fatal(err)
	}
}
