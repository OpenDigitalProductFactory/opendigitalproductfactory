//go:build darwin

package collect

import (
	"context"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// osRelease shells to /usr/bin/sw_vers for the user-facing macOS
// version (e.g. "macOS 14.5") and uses unix.Uname() for the Darwin
// kernel string. sw_vers ships with the base OS so this doesn't
// require Xcode or third-party tools.
//
// stdlib syscall.Utsname is Linux-only; we route through
// golang.org/x/sys/unix (already in the module's dep tree via the
// Windows ARP code) which exposes the same API on Darwin.
//
// 2-second timeout — sw_vers is local and should respond instantly;
// longer means the system is in a degenerate state and we'd rather
// surface an empty release than block the sweep.
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
	var u unix.Utsname
	if err := unix.Uname(&u); err != nil {
		return ""
	}
	// unix.Utsname.Release is [65]byte on Darwin (not int8 like Linux);
	// the bytes are NUL-terminated.
	return utsnameToString(u.Release[:])
}

func utsnameToString(in []byte) string {
	end := 0
	for end < len(in) && in[end] != 0 {
		end++
	}
	return string(in[:end])
}
