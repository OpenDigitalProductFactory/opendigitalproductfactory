//go:build darwin

package collect

import (
	"context"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// osRelease shells to /usr/bin/sw_vers for the user-facing macOS
// version (e.g. "macOS 14.5") and uses syscall.Uname() for the
// Darwin kernel string. sw_vers ships with the base OS so this
// doesn't require Xcode or third-party tools.
//
// 2-second timeout — sw_vers is local and should respond instantly;
// any longer means the system is in a degenerate state and we'd
// rather surface an empty release than block the sweep.
func osRelease() (release string, kernel string, err error) {
	release = swVersDescription()
	kernel = darwinUnameRelease()
	return release, kernel, nil
}

func swVersDescription() string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/bin/sw_vers", "-productName").Output()
	if err != nil {
		return ""
	}
	productName := strings.TrimSpace(string(out))

	out2, err := exec.CommandContext(ctx, "/usr/bin/sw_vers", "-productVersion").Output()
	if err != nil {
		return productName
	}
	productVersion := strings.TrimSpace(string(out2))

	if productName == "" {
		return productVersion
	}
	if productVersion == "" {
		return productName
	}
	return productName + " " + productVersion
}

func darwinUnameRelease() string {
	var u syscall.Utsname
	if err := syscall.Uname(&u); err != nil {
		return ""
	}
	return utsnameToString(u.Release[:])
}

// utsnameToString reads the int8/byte slice the platform returns and
// stops at the first NUL terminator. Darwin's syscall.Utsname.Release
// is `[256]int8`.
func utsnameToString(in []int8) string {
	var b strings.Builder
	for _, c := range in {
		if c == 0 {
			break
		}
		b.WriteByte(byte(c))
	}
	return b.String()
}
