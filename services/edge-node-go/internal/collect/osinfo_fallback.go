//go:build !windows && !linux && !darwin

package collect

// osRelease fallback for platforms the Edge Node doesn't officially
// target (FreeBSD, OpenBSD, etc.). Returns empty strings + no error;
// the host item still gets submitted with kernelVersion = "".
//
// Adding a new platform: drop in osinfo_<goos>.go with the matching
// build tag and remove that platform from the negative list above.
func osRelease() (release string, kernel string, err error) {
	return "", "", nil
}
