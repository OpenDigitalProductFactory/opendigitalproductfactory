package action

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const replayFilename = "action-replay.json"
const maxReplayEntries = 4096

type ReplayJournal struct {
	path    string
	entries map[string]time.Time
}

func OpenReplayJournal(stateDir string, now time.Time) (*ReplayJournal, error) {
	journal := &ReplayJournal{path: filepath.Join(stateDir, replayFilename), entries: map[string]time.Time{}}
	raw, err := os.ReadFile(journal.path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return journal, nil
		}
		return nil, fmt.Errorf("read action replay journal: %w", err)
	}
	var stored map[string]string
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, fmt.Errorf("decode action replay journal: %w", err)
	}
	for nonce, expiryText := range stored {
		expiry, err := time.Parse(time.RFC3339Nano, expiryText)
		if err == nil && expiry.After(now) {
			journal.entries[nonce] = expiry
		}
	}
	return journal, nil
}

func (j *ReplayJournal) Has(nonce string, now time.Time) bool {
	expiresAt, ok := j.entries[nonce]
	return ok && expiresAt.After(now)
}

func (j *ReplayJournal) Consume(nonce string, expiresAt, now time.Time) error {
	if nonce == "" || !expiresAt.After(now) {
		return ErrInvalidEnvelope
	}
	if j.Has(nonce, now) {
		return ErrNonceConsumed
	}
	for known, expiry := range j.entries {
		if !expiry.After(now) {
			delete(j.entries, known)
		}
	}
	j.entries[nonce] = expiresAt
	if len(j.entries) > maxReplayEntries {
		type entry struct {
			nonce  string
			expiry time.Time
		}
		ordered := make([]entry, 0, len(j.entries))
		for known, expiry := range j.entries {
			ordered = append(ordered, entry{known, expiry})
		}
		sort.Slice(ordered, func(i, k int) bool { return ordered[i].expiry.Before(ordered[k].expiry) })
		for _, oldest := range ordered[:len(j.entries)-maxReplayEntries] {
			delete(j.entries, oldest.nonce)
		}
	}
	return j.save()
}

func (j *ReplayJournal) save() error {
	if err := os.MkdirAll(filepath.Dir(j.path), 0o700); err != nil {
		return err
	}
	stored := make(map[string]string, len(j.entries))
	for nonce, expiry := range j.entries {
		stored[nonce] = expiry.UTC().Format(time.RFC3339Nano)
	}
	body, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	body = append(body, '\n')
	tmp := fmt.Sprintf("%s.tmp.%d", j.path, os.Getpid())
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, j.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Chmod(j.path, 0o600)
}
