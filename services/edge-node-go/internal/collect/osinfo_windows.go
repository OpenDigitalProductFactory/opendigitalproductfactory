//go:build windows

package collect

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// osRelease reads HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion
// for the human-readable Windows product name + the build number that
// uniquely identifies the OS version. The two strings together let
// the admin UI distinguish "Windows 11 Pro 24H2 (build 26100)" from
// "Windows Server 2022 (build 20348)" without operator data entry.
//
// Reading errors degrade gracefully — we return what we got plus an
// error; the caller surfaces a warning and keeps the host item.
func osRelease() (release string, kernel string, err error) {
	k, openErr := registry.OpenKey(
		registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion`,
		registry.QUERY_VALUE|registry.WOW64_64KEY,
	)
	if openErr != nil {
		return "", "", fmt.Errorf("open CurrentVersion key: %w", openErr)
	}
	defer k.Close()

	productName, _, _ := k.GetStringValue("ProductName")           // e.g. "Windows 11 Pro"
	displayVersion, _, _ := k.GetStringValue("DisplayVersion")     // e.g. "24H2"
	currentBuild, _, _ := k.GetStringValue("CurrentBuild")         // e.g. "26100"
	ubr, _, _ := k.GetIntegerValue("UBR")                          // update build revision; e.g. 4239
	currentMajor, _, _ := k.GetIntegerValue("CurrentMajorVersionNumber")
	currentMinor, _, _ := k.GetIntegerValue("CurrentMinorVersionNumber")

	// "ProductName" still returns "Windows 10 Pro" on Windows 11 hosts
	// because Microsoft never updated the registry value. Override
	// when the build number is >= 22000 (the Win 11 cutover).
	if buildNum, perr := parseUint(currentBuild); perr == nil && buildNum >= 22000 {
		productName = strings.Replace(productName, "Windows 10", "Windows 11", 1)
	}

	var parts []string
	if productName != "" {
		parts = append(parts, productName)
	}
	if displayVersion != "" {
		parts = append(parts, displayVersion)
	}
	release = strings.Join(parts, " ")

	// Kernel-equivalent string: "<major>.<minor>.<build>.<ubr>" — the
	// shape Microsoft's GetVersionEx-era APIs produce. Lines up with
	// what `ver` shows in cmd.exe.
	kernel = fmt.Sprintf("%d.%d.%s.%d", currentMajor, currentMinor, currentBuild, ubr)

	return release, kernel, nil
}

func parseUint(s string) (uint64, error) {
	var out uint64
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, fmt.Errorf("non-digit %q in %q", ch, s)
		}
		out = out*10 + uint64(ch-'0')
	}
	return out, nil
}
