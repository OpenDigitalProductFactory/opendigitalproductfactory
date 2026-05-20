//go:build linux

package collect

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"syscall"
)

// osRelease parses /etc/os-release (the freedesktop.org standard at
// https://www.freedesktop.org/software/systemd/man/os-release.html)
// for PRETTY_NAME (release) and uses uname() for the kernel string.
//
// Container hosts (Alpine, Debian-slim) all ship /etc/os-release; the
// few minimal images that don't degrade to "linux" + the uname result.
func osRelease() (release string, kernel string, err error) {
	release = readOSReleasePretty()
	kernel = unameRelease()
	return release, kernel, nil
}

func readOSReleasePretty() string {
	for _, path := range []string{"/etc/os-release", "/usr/lib/os-release"} {
		f, ferr := os.Open(path)
		if ferr != nil {
			continue
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if !strings.HasPrefix(line, "PRETTY_NAME=") {
				continue
			}
			value := strings.TrimPrefix(line, "PRETTY_NAME=")
			// Values may be quoted: PRETTY_NAME="Ubuntu 22.04.5 LTS"
			value = strings.Trim(value, `"'`)
			return value
		}
	}
	return ""
}

func unameRelease() string {
	var u syscall.Utsname
	if err := syscall.Uname(&u); err != nil {
		return ""
	}
	return charsToString(u.Release[:])
}

// charsToString converts a NUL-terminated int8 slice (the shape
// syscall.Utsname uses on Linux) to a Go string. Stops at the first
// NUL or the end of the slice, whichever comes first.
func charsToString(in []int8) string {
	var b strings.Builder
	for _, c := range in {
		if c == 0 {
			break
		}
		b.WriteByte(byte(c))
	}
	out := b.String()
	if out == "" {
		return "linux"
	}
	return fmt.Sprintf("%s", out)
}
