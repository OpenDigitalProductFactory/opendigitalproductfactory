package action

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReplayJournalPersistsAndRejectsConsumedNonce(t *testing.T) {
	dir := t.TempDir()
	journal, err := OpenReplayJournal(dir, now)
	if err != nil {
		t.Fatal(err)
	}
	if journal.Has("nonce-1", now) {
		t.Fatal("fresh nonce reported consumed")
	}
	if err := journal.Consume("nonce-1", now.Add(time.Minute), now); err != nil {
		t.Fatal(err)
	}
	if !journal.Has("nonce-1", now) {
		t.Fatal("consumed nonce not retained")
	}

	reloaded, err := OpenReplayJournal(dir, now)
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.Has("nonce-1", now) {
		t.Fatal("consumed nonce did not persist")
	}
	info, err := os.Stat(filepath.Join(dir, "action-replay.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("journal mode=%o want 600", info.Mode().Perm())
	}
}

func TestReplayJournalPrunesExpiredEntries(t *testing.T) {
	dir := t.TempDir()
	journal, err := OpenReplayJournal(dir, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := journal.Consume("old", now.Add(time.Second), now); err != nil {
		t.Fatal(err)
	}
	reloaded, err := OpenReplayJournal(dir, now.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Has("old", now.Add(2*time.Second)) {
		t.Fatal("expired nonce was not pruned")
	}
}
