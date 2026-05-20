//go:build windows

package state

import "io/fs"

// On Windows, file-mode bits beyond the read-only attribute are
// advisory and don't carry POSIX semantics. The TypeScript state.ts
// also skips POSIX enforcement on Windows; ACL-based equivalents land
// with the Phase-1 OS-secure-store work (Credential Manager).
func shouldEnforcePosixPerms() bool { return false }

func verifyPosixPerms(_ string, _ fs.FileInfo) error { return nil }
