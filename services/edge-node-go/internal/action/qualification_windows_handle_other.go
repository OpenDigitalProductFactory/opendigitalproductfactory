//go:build !windows

package action

import (
	"io"
	"os"
)

// The handler rejects non-Windows execution before opening a fixture. Keeping
// this implementation buildable lets ordinary Linux CI verify the orchestration
// while the Windows implementation owns the actual share-mode contract.
func openQualificationHandle(file string) (io.Closer, error) {
	return os.Open(file)
}
