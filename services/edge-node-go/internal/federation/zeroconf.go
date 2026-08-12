package federation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/betamos/zeroconf"
)

// ServiceType is the application/protocol portion expected by zeroconf.NewType.
// The library supplies the local domain itself; passing the fully-qualified
// name leaves its parsed domain as "local." and silently produces bad DNS
// resource data on announcement.
const ServiceType = "_dpf-federation._tcp"

// ServiceFQDN is the operator-facing standard DNS-SD name.
const ServiceFQDN = ServiceType + ".local."

type DiscoveryOptions struct {
	AuthorityURL       string
	Secret             []byte
	RotationWindow     time.Duration
	SubmissionInterval time.Duration
	CapabilityVersion  string
	OnReady            func()
}

type SubmitCandidates func(context.Context, []Candidate) error

// Run advertises this Authority and continuously browses for peers. It
// binds the host's real multicast interfaces, so it belongs only in the native
// Edge Node process—not the Docker Desktop portal container.
func Run(ctx context.Context, opts DiscoveryOptions, submit SubmitCandidates) error {
	if len(opts.Secret) < 16 {
		return errors.New("federation discovery secret must be at least 16 bytes")
	}
	authority, err := url.Parse(opts.AuthorityURL)
	if err != nil || (authority.Scheme != "http" && authority.Scheme != "https") || authority.Hostname() == "" {
		return errors.New("federation discovery requires an HTTP or HTTPS Authority URL")
	}
	port := uint16(80)
	if authority.Scheme == "https" {
		port = 443
	}
	if authority.Port() != "" {
		parsedPort, parseErr := strconv.ParseUint(authority.Port(), 10, 16)
		if parseErr != nil || parsedPort == 0 {
			return errors.New("Authority URL has an invalid port")
		}
		port = uint16(parsedPort)
	}
	if opts.RotationWindow <= 0 {
		opts.RotationWindow = 15 * time.Minute
	}
	if opts.SubmissionInterval <= 0 {
		opts.SubmissionInterval = 15 * time.Second
	}
	capabilityDigest := sha256.Sum256([]byte(opts.CapabilityVersion))

	for ctx.Err() == nil {
		discoveryID := RotatingDiscoveryID(opts.Secret, time.Now(), opts.RotationWindow)
		typeDef := zeroconf.NewType(ServiceType)
		published := zeroconf.NewService(typeDef, "dpf-"+discoveryID, port)
		published.Hostname = "dpf-" + discoveryID + ".local"
		published.Text = AdvertisementTXT(
			discoveryID,
			hex.EncodeToString(capabilityDigest[:4]),
			authority.Scheme,
		)

		var mu sync.Mutex
		found := map[string]Candidate{}
		client, err := zeroconf.New().
			Publish(published).
			Browse(func(event zeroconf.Event) {
				key := event.Service.String()
				mu.Lock()
				defer mu.Unlock()
				if event.Op == zeroconf.OpRemoved {
					delete(found, key)
					return
				}
				candidate, parseErr := ParseService(ServiceRecord{
					Host: event.Hostname,
					Port: int(event.Port),
					TXT:  event.Text,
				})
				if parseErr != nil || candidate.DiscoveryID == discoveryID {
					delete(found, key)
					return
				}
				found[key] = candidate
			}, typeDef).
			Expiry(2 * time.Minute).
			Open()
		if err != nil {
			return fmt.Errorf("open DNS-SD advertise/browse: %w", err)
		}
		if opts.OnReady != nil {
			opts.OnReady()
		}

		submitTicker := time.NewTicker(opts.SubmissionInterval)
		rotateTimer := time.NewTimer(opts.RotationWindow)
		cycleDone := false
		for !cycleDone {
			select {
			case <-ctx.Done():
				cycleDone = true
			case <-rotateTimer.C:
				cycleDone = true
			case <-submitTicker.C:
				mu.Lock()
				keys := make([]string, 0, len(found))
				for key := range found {
					keys = append(keys, key)
				}
				sort.Strings(keys)
				snapshot := make([]Candidate, 0, len(keys))
				for _, key := range keys {
					snapshot = append(snapshot, found[key])
				}
				mu.Unlock()
				if err := submit(ctx, snapshot); err != nil && ctx.Err() == nil {
					// Discovery is optional and eventually consistent. A failed
					// snapshot must not stop heartbeat or host discovery.
					continue
				}
			}
		}
		submitTicker.Stop()
		if !rotateTimer.Stop() {
			select {
			case <-rotateTimer.C:
			default:
			}
		}
		_ = client.Close()
	}
	return nil
}
