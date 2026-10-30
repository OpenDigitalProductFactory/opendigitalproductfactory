//go:build windows

package action

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestQualificationHandleRefusesReplacementUntilReleased(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.json")
	first := filepath.Join(dir, "first.json")
	second := filepath.Join(dir, "second.json")
	if err := os.WriteFile(target, []byte(`{"status":"before"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(first, []byte(`{"status":"after"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	held, err := openQualificationHandle(target)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(first, target); err == nil {
		t.Fatal("replacement succeeded while destination denied delete sharing")
	}
	contents, err := os.ReadFile(target)
	if err != nil || string(contents) != `{"status":"before"}` {
		t.Fatalf("first refusal did not preserve destination: contents=%q err=%v", contents, err)
	}
	if err := os.Remove(first); err != nil {
		t.Fatalf("failed replacement source was not independently cleanable: %v", err)
	}
	if err := held.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, []byte(`{"status":"after"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(second, target); err != nil {
		t.Fatalf("replacement remained blocked after handle release: %v", err)
	}
	contents, err = os.ReadFile(target)
	if err != nil || string(contents) != `{"status":"after"}` {
		t.Fatalf("second replacement did not update destination: contents=%q err=%v", contents, err)
	}
	if _, err := os.Stat(second); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("successful replacement source still exists: %v", err)
	}
}
