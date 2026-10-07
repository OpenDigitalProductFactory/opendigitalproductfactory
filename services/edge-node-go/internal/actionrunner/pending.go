package actionrunner

// BI-F8F8C383: a terminal report that cannot be delivered is kept and retried.
//
// The runner used to return the error and drop the outcome. That never mattered
// for a quick inventory collect, but a Docker VM restart takes the portal down
// with it, so its terminal report always meets an unreachable portal. The
// report is now written to the node's state directory and delivered before the
// next claim, so the portal learns how the restart went once it is back.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/api"
)

// PendingReports stores terminal reports awaiting delivery.
type PendingReports interface {
	Load() ([]api.ActionResultRequest, error)
	Save(api.ActionResultRequest) error
	Remove(actionKey string) error
}

var unsafeKeyCharacters = regexp.MustCompile(`[^A-Za-z0-9_.-]`)

// FilePendingReports keeps one owner-only JSON file per action key.
type FilePendingReports struct {
	Dir string
}

func (f FilePendingReports) path(actionKey string) string {
	return filepath.Join(f.Dir, unsafeKeyCharacters.ReplaceAllString(actionKey, "_")+".json")
}

func (f FilePendingReports) Load() ([]api.ActionResultRequest, error) {
	entries, err := os.ReadDir(f.Dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".json" {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	reports := make([]api.ActionResultRequest, 0, len(names))
	for _, name := range names {
		raw, err := os.ReadFile(filepath.Join(f.Dir, name))
		if err != nil {
			return nil, err
		}
		var report api.ActionResultRequest
		if err := json.Unmarshal(raw, &report); err != nil || report.ActionKey == "" {
			// An unreadable file cannot be delivered; keep it out of the way.
			_ = os.Rename(filepath.Join(f.Dir, name), filepath.Join(f.Dir, name+".unreadable"))
			continue
		}
		reports = append(reports, report)
	}
	return reports, nil
}

func (f FilePendingReports) Save(report api.ActionResultRequest) error {
	if err := os.MkdirAll(f.Dir, 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(report)
	if err != nil {
		return err
	}
	target := f.path(report.ActionKey)
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, target)
}

func (f FilePendingReports) Remove(actionKey string) error {
	err := os.Remove(f.path(actionKey))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// refusedForGood reports whether the portal rejected a report in a way that a
// retry cannot change (it no longer accepts this outcome for this action).
func refusedForGood(err error) bool {
	var httpErr *api.HTTPError
	if !errors.As(err, &httpErr) {
		return false
	}
	return httpErr.Status >= 400 && httpErr.Status < 500 && httpErr.Status != 408 && httpErr.Status != 429
}
