//go:build windows

package action

import (
	"io"
	"os"

	"golang.org/x/sys/windows"
)

// openQualificationHandle deliberately excludes FILE_SHARE_DELETE. The
// production writer replaces its destination with one rename; this handle
// reproduces the Windows sharing boundary without permitting the qualification
// procedure to delete the destination first.
func openQualificationHandle(file string) (io.Closer, error) {
	name, err := windows.UTF16PtrFromString(file)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(
		name,
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(handle), file), nil
}
