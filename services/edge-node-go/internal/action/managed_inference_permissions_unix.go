//go:build !windows

package action

import (
	"os"
	"syscall"
)

func nativeTrustedOwner(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && (stat.Uid == 0 || stat.Uid == uint32(os.Getuid()))
}

func signalNativeAuthorityFence(process *os.Process) error { return process.Signal(syscall.SIGUSR1) }
