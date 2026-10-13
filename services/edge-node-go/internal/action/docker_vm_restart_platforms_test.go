package action

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// BI-28EFE18A: the restart works on macOS and on Linux with Docker Desktop,
// refuses on native Linux Engine, and can never reboot any host.

type scriptedHost struct {
	commands      []string
	operatingOS   string // what `docker info --format {{.OperatingSystem}}` prints
	desktopStatus error  // result of `docker desktop status`
	restartErr    error
	readyAfter    int
	infoCalls     int
	clock         time.Time
}

func (s *scriptedHost) handler(platform, autostart string) *DockerVmRestartHandler {
	return &DockerVmRestartHandler{
		Config: DockerVmRestartConfig{
			Platform:           platform,
			AutostartTaskName:  autostart,
			DockerReadyTimeout: 5 * time.Minute,
			PollInterval:       10 * time.Second,
		},
		Run: func(_ context.Context, name string, args ...string) (string, error) {
			line := name + " " + strings.Join(args, " ")
			s.commands = append(s.commands, line)
			switch {
			case line == "docker info --format {{.OperatingSystem}}":
				return s.operatingOS, nil
			case line == "docker desktop status":
				return "running", s.desktopStatus
			case line == "docker desktop restart":
				return "", s.restartErr
			case line == "docker info --format {{.ServerVersion}}":
				s.infoCalls++
				if s.infoCalls < s.readyAfter {
					return "", errors.New("not ready")
				}
				return "29.8.2", nil
			}
			return "", nil
		},
		Sleep: func(d time.Duration) { s.clock = s.clock.Add(d) },
		Now:   func() time.Time { return s.clock },
	}
}

func TestDockerVmRestartOnMacOSUsesTheDockerDesktopCLIAndTheLaunchAgent(t *testing.T) {
	host := &scriptedHost{operatingOS: "Docker Desktop", readyAfter: 2}
	output, err := host.handler("darwin", "com.dpf.autostart").Execute(context.Background(), wedgedParameters)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(host.commands, "\n")
	for _, want := range []string{"docker desktop restart", "launchctl start com.dpf.autostart"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in:\n%s", want, joined)
		}
	}
	if strings.Contains(joined, "wsl.exe") || strings.Contains(joined, "taskkill") {
		t.Fatalf("Windows steps ran on macOS:\n%s", joined)
	}
	if output.Result["restarted"] != true {
		t.Fatalf("result=%v", output.Result)
	}
}

func TestDockerVmRestartOnLinuxDockerDesktopRestartsTheVMAndTheUserService(t *testing.T) {
	host := &scriptedHost{operatingOS: "Ubuntu 24.04", desktopStatus: nil, readyAfter: 1}
	if _, err := host.handler("linux", "dpf.service").Execute(context.Background(), wedgedParameters); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(host.commands, "\n")
	if !strings.Contains(joined, "docker desktop restart") || !strings.Contains(joined, "systemctl --user start dpf.service") {
		t.Fatalf("commands:\n%s", joined)
	}
}

func TestDockerVmRestartOnNativeLinuxEngineRefusesBecauseOnlyARebootClearsIt(t *testing.T) {
	host := &scriptedHost{operatingOS: "Ubuntu 24.04", desktopStatus: errors.New("docker: 'desktop' is not a docker command")}
	output, err := host.handler("linux", "dpf.service").Execute(context.Background(), wedgedParameters)
	if !errors.Is(err, ErrHostRebootRequired) {
		t.Fatalf("got %v", err)
	}
	for _, command := range host.commands {
		if strings.Contains(command, "desktop restart") || strings.HasPrefix(command, "systemctl") {
			t.Fatalf("acted on a native engine: %q", command)
		}
	}
	if output.Evidence["steps"] == nil {
		t.Fatal("the refusal must carry its steps")
	}
}

func TestNoPlatformAllowsARebootOrShutdownOfTheHost(t *testing.T) {
	attempts := map[string][][]string{
		"win32":  {{"shutdown.exe", "/r", "/t", "0"}, {"schtasks", "/Run", "/TN", "x", "/F"}, {"wsl.exe", "--terminate", "x"}},
		"darwin": {{"shutdown", "-r", "now"}, {"launchctl", "reboot"}, {"launchctl", "start", "x", "extra"}, {"osascript", "-e", "tell app \"System Events\" to restart"}},
		"linux":  {{"systemctl", "reboot"}, {"systemctl", "--user", "reboot", "x"}, {"systemctl", "start", "reboot.target"}, {"reboot"}, {"shutdown", "-r", "now"}},
	}
	for platform, commands := range attempts {
		for _, command := range commands {
			if allowedHostCommand(platform, command[0], command[1:]) {
				t.Fatalf("%s allowed %v", platform, command)
			}
		}
	}
}

func TestDetectDockerRuntime(t *testing.T) {
	cases := []struct {
		platform, os string
		status       error
		want         string
	}{
		{"win32", "", nil, DockerRuntimeDesktop},
		{"darwin", "Docker Desktop", nil, DockerRuntimeDesktop},
		{"linux", "Docker Desktop", nil, DockerRuntimeDesktop},
		{"linux", "Ubuntu 24.04", errors.New("no desktop"), DockerRuntimeEngine},
		{"darwin", "colima", errors.New("no desktop"), DockerRuntimeUnknown},
	}
	for _, c := range cases {
		host := &scriptedHost{operatingOS: c.os, desktopStatus: c.status}
		got := DetectDockerRuntime(context.Background(), c.platform, host.handler(c.platform, "").Run)
		if got != c.want {
			t.Fatalf("%s/%s: got %s want %s", c.platform, c.os, got, c.want)
		}
	}
}
