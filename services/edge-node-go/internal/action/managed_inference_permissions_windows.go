//go:build windows

package action

import "os"

// The corrected Mac runtime is never enabled on a Windows host.
func nativeTrustedOwner(os.FileInfo) bool                  { return false }
func signalNativeAuthorityFence(process *os.Process) error { return process.Kill() }
