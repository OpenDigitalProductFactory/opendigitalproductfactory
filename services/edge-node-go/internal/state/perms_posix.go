//go:build !windows

package state

import (
	"fmt"
	"io/fs"
	"os"
	"syscall"
)

func shouldEnforcePosixPerms() bool { return true }

// verifyPosixPerms enforces mode 0600 + owner == current UID on the
// state file. The mode check refuses to read a group/world-readable
// file (the token in it would be exposed). The owner check refuses to
// read a file owned by a different UID (the host bind-mount-leak
// threat the spec's storage downgrade controls bound).
func verifyPosixPerms(path string, info fs.FileInfo) error {
	mode := info.Mode().Perm()
	if mode != 0o600 {
		return fmt.Errorf(
			"state file %s has unsafe permissions: expected mode 0600, got 0%03o. "+
				"Refusing to load; the node token in this file may be exposed. "+
				"Fix: chmod 600 %s (and investigate how the loose mode got there).",
			path, mode, path,
		)
	}

	sys, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		// Filesystem doesn't expose POSIX stat — e.g. a 9p mount on
		// a non-Linux Docker Desktop backend. Skip the owner check
		// rather than refuse to start; the mode check still applies.
		return nil
	}
	myUID := uint32(os.Getuid())
	if sys.Uid != myUID {
		return fmt.Errorf(
			"state file %s is owned by UID %d, but the current process runs as UID %d. "+
				"Refusing to load; cross-account state-file read is the host-bind-mount-leak threat the spec's storage downgrade controls bound. "+
				"Fix: ensure the state directory is owned by the runtime's dedicated UID and is a managed volume, not a host bind-mount.",
			path, sys.Uid, myUID,
		)
	}
	return nil
}
