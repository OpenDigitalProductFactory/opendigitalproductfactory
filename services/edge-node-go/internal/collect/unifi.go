package collect

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	unifiPageSize    = 100
	unifiMaxPages    = 100
	unifiMaxResponse = 8 << 20
)

var unifiMACPattern = regexp.MustCompile(`^[0-9a-f]{2}(:[0-9a-f]{2}){5}$`)

// UnifiConfig is one Authority-scoped DiscoveryConnection prepared for the
// LAN-local edge collector. APIKey must never be copied into output or logs.
type UnifiConfig struct {
	ConnectionID    string
	ControllerURL   string
	APIKey          string
	Site            string
	DiscoverClients bool
	TLSInsecure     bool
}

type unifiHTTPError struct {
	status int
	kind   string
}

func (e *unifiHTTPError) Error() string { return e.kind }

type unifiPage[T any] struct {
	Offset     int `json:"offset"`
	Limit      int `json:"limit"`
	Count      int `json:"count"`
	TotalCount int `json:"totalCount"`
	Data       []T `json:"data"`
}

type unifiSite struct {
	ID                string `json:"id"`
	InternalReference string `json:"internalReference"`
	Name              string `json:"name"`
}

type unifiDeviceOverview struct {
	ID              string   `json:"id"`
	MACAddress      string   `json:"macAddress"`
	IPAddress       string   `json:"ipAddress"`
	Name            string   `json:"name"`
	Model           string   `json:"model"`
	State           string   `json:"state"`
	FirmwareVersion string   `json:"firmwareVersion"`
	Features        []string `json:"features"`
}

type unifiDeviceDetail struct {
	ID     string `json:"id"`
	Uplink *struct {
		DeviceID string `json:"deviceId"`
	} `json:"uplink"`
	Interfaces struct {
		Ports []struct {
			Index        int    `json:"idx"`
			State        string `json:"state"`
			Connector    string `json:"connector"`
			SpeedMbps    int    `json:"speedMbps"`
			MaxSpeedMbps int    `json:"maxSpeedMbps"`
		} `json:"ports"`
	} `json:"interfaces"`
}

type unifiClientOverview struct {
	ID         string `json:"id"`
	MACAddress string `json:"macAddress"`
	IPAddress  string `json:"ipAddress"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Access     *struct {
		DeviceID string `json:"deviceId"`
		Type     string `json:"type"`
		Port     int    `json:"port"`
	} `json:"access"`
}

type legacyResponse[T any] struct {
	Data []T `json:"data"`
}

type legacyDevice struct {
	MAC       string `json:"mac"`
	IP        string `json:"ip"`
	Name      string `json:"name"`
	Model     string `json:"model"`
	ModelName string `json:"model_name"`
	Type      string `json:"type"`
	State     int    `json:"state"`
	Version   string `json:"version"`
	Uplink    *struct {
		MAC        string `json:"uplink_mac"`
		RemotePort int    `json:"uplink_remote_port"`
		Type       string `json:"type"`
	} `json:"uplink"`
}

type legacyClient struct {
	MAC      string `json:"mac"`
	IP       string `json:"ip"`
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	IsWired  bool   `json:"is_wired"`
	APMAC    string `json:"ap_mac"`
	SWMAC    string `json:"sw_mac"`
	SWPort   int    `json:"sw_port"`
}

// CollectUnifi runs every configured controller independently so one failed
// site never suppresses host/ARP evidence or another controller's topology.
func CollectUnifi(ctx context.Context, configs []UnifiConfig) Result {
	combined := Result{}
	for _, config := range configs {
		result := collectUnifiController(ctx, config)
		combined.Items = append(combined.Items, result.Items...)
		combined.Relationships = append(combined.Relationships, result.Relationships...)
		combined.Warnings = append(combined.Warnings, result.Warnings...)
	}
	return combined
}

func collectUnifiController(ctx context.Context, config UnifiConfig) Result {
	client := newUnifiHTTPClient(config.TLSInsecure)
	result, err := collectOfficialUnifi(ctx, client, config)
	if err == nil {
		return result
	}

	var httpErr *unifiHTTPError
	if errors.As(err, &httpErr) && isUnsupportedOfficialStatus(httpErr.status) {
		legacy, legacyErr := collectLegacyUnifi(ctx, client, config)
		if legacyErr == nil {
			legacy.Warnings = append(legacy.Warnings, "unifi_legacy_api")
			return legacy
		}
		return Result{Warnings: []string{warningForUnifiError(legacyErr)}}
	}
	return Result{Warnings: []string{warningForUnifiError(err)}}
}

func newUnifiHTTPClient(tlsInsecure bool) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if tlsInsecure {
		// UniFi appliances commonly ship self-signed certificates. This is an
		// explicit per-connection operator choice, never a process-wide default.
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // #nosec G402
	}
	return &http.Client{Transport: transport, Timeout: 12 * time.Second}
}

func collectOfficialUnifi(ctx context.Context, client *http.Client, config UnifiConfig) (Result, error) {
	base := strings.TrimRight(config.ControllerURL, "/") + "/proxy/network/integration/v1"
	sites, err := fetchAllPages[unifiSite](ctx, client, base+"/sites", config.APIKey)
	if err != nil {
		return Result{}, err
	}
	site, ok := resolveUnifiSite(sites, config.Site)
	if !ok {
		return Result{}, &unifiHTTPError{status: http.StatusNotFound, kind: "unifi_site_not_found"}
	}
	sitePath := base + "/sites/" + url.PathEscape(site.ID)
	devices, err := fetchAllPages[unifiDeviceOverview](ctx, client, sitePath+"/devices", config.APIKey)
	if err != nil {
		return Result{}, err
	}
	if len(devices) == 0 {
		return Result{Warnings: []string{"unifi_no_devices"}}, nil
	}

	result := Result{}
	keyByID := make(map[string]string, len(devices))
	for _, device := range devices {
		key := unifiObservedKey(device.MACAddress, device.ID)
		keyByID[device.ID] = key
		itemType := officialDeviceType(device)
		result.Items = append(result.Items, Item{
			ObservedKey: key,
			ItemType:    itemType,
			Name:        firstNonEmpty(device.Name, device.Model, "UniFi device"),
			Confidence:  1,
			RawData: map[string]any{
				"mac": device.MACAddress, "ip": device.IPAddress, "model": device.Model,
				"state": device.State, "version": device.FirmwareVersion,
				"unifiDeviceId": device.ID, "unifiSiteId": site.ID,
				"connectionId": config.ConnectionID, "apiGeneration": "integration_v1",
				"discoveredVia": "unifi_api", "osiLayer": deviceOSILayer(itemType),
			},
		})
	}

	for _, device := range devices {
		detailURL := sitePath + "/devices/" + url.PathEscape(device.ID)
		var detail unifiDeviceDetail
		if err := unifiGetJSON(ctx, client, detailURL, config.APIKey, &detail); err != nil {
			result.Warnings = append(result.Warnings, "unifi_partial:device_detail:"+device.ID)
			continue
		}
		if detail.Uplink == nil || detail.Uplink.DeviceID == "" {
			continue
		}
		parentKey, parentExists := keyByID[detail.Uplink.DeviceID]
		childKey, childExists := keyByID[device.ID]
		if !parentExists || !childExists || parentKey == childKey {
			result.Warnings = append(result.Warnings, "unifi_partial:missing_uplink_parent:"+device.ID)
			continue
		}
		result.Relationships = append(result.Relationships, Relationship{
			FromObservedKey: parentKey, ToObservedKey: childKey, RelationshipType: "HOSTS",
			RawData: map[string]any{"evidenceKind": "unifi_uplink", "parentDeviceId": detail.Uplink.DeviceID, "childDeviceId": device.ID},
		})
	}

	if config.DiscoverClients {
		clients, clientErr := fetchAllPages[unifiClientOverview](ctx, client, sitePath+"/clients", config.APIKey)
		if clientErr != nil {
			result.Warnings = append(result.Warnings, "unifi_partial:clients")
		} else {
			appendOfficialClients(&result, clients, keyByID, site.ID, config.ConnectionID)
		}
	}
	return result, nil
}

func appendOfficialClients(result *Result, clients []unifiClientOverview, keyByID map[string]string, siteID, connectionID string) {
	for _, client := range clients {
		mac := normalizeUnifiMAC(client.MACAddress)
		if mac == "" {
			continue
		}
		key := "unifi-client:" + mac
		result.Items = append(result.Items, Item{
			ObservedKey: key, ItemType: "network_client",
			Name: firstNonEmpty(client.Name, "Client "+mac), Confidence: .9,
			RawData: map[string]any{
				"mac": mac, "address": client.IPAddress, "clientType": client.Type,
				"unifiClientId": client.ID, "unifiSiteId": siteID, "connectionId": connectionID,
				"apiGeneration": "integration_v1", "discoveredVia": "unifi_clients_api", "osiLayer": 3,
			},
		})
		if client.IPAddress != "" {
			result.Relationships = append(result.Relationships, Relationship{
				FromObservedKey: key, ToObservedKey: "arp:" + client.IPAddress,
				RelationshipType: "SAME_AS", RawData: map[string]any{"mechanism": "unifi_ip_mac_correlation"},
			})
		}
		if client.Access != nil {
			if parentKey, ok := keyByID[client.Access.DeviceID]; ok {
				result.Relationships = append(result.Relationships, Relationship{
					FromObservedKey: key, ToObservedKey: parentKey, RelationshipType: "CONNECTS_TO",
					RawData: map[string]any{"connectionType": strings.ToLower(client.Access.Type), "port": client.Access.Port, "evidenceKind": "unifi_client_access"},
				})
			}
		}
	}
}

func collectLegacyUnifi(ctx context.Context, client *http.Client, config UnifiConfig) (Result, error) {
	base := strings.TrimRight(config.ControllerURL, "/") + "/proxy/network/api/s/" + url.PathEscape(firstNonEmpty(config.Site, "default"))
	var deviceResponse legacyResponse[legacyDevice]
	if err := unifiGetJSON(ctx, client, base+"/stat/device", config.APIKey, &deviceResponse); err != nil {
		return Result{}, err
	}
	if len(deviceResponse.Data) == 0 {
		return Result{Warnings: []string{"unifi_no_devices"}}, nil
	}

	result := Result{}
	keyByMAC := make(map[string]string, len(deviceResponse.Data))
	for _, device := range deviceResponse.Data {
		mac := normalizeUnifiMAC(device.MAC)
		if mac == "" {
			continue
		}
		key := "unifi:" + mac
		keyByMAC[mac] = key
		itemType := legacyDeviceType(device.Type)
		result.Items = append(result.Items, Item{
			ObservedKey: key, ItemType: itemType,
			Name: firstNonEmpty(device.Name, device.ModelName, device.Model, "UniFi device"), Confidence: 1,
			RawData: map[string]any{
				"mac": mac, "ip": device.IP, "model": device.Model, "state": device.State,
				"version": device.Version, "connectionId": config.ConnectionID,
				"apiGeneration": "legacy", "discoveredVia": "unifi_api", "osiLayer": deviceOSILayer(itemType),
			},
		})
	}
	for _, device := range deviceResponse.Data {
		childKey := keyByMAC[normalizeUnifiMAC(device.MAC)]
		parentKey := ""
		if device.Uplink != nil {
			parentKey = keyByMAC[normalizeUnifiMAC(device.Uplink.MAC)]
		}
		if childKey != "" && parentKey != "" && childKey != parentKey {
			result.Relationships = append(result.Relationships, Relationship{
				FromObservedKey: parentKey, ToObservedKey: childKey, RelationshipType: "HOSTS",
				RawData: map[string]any{"evidenceKind": "unifi_uplink", "parentPort": device.Uplink.RemotePort, "connectionType": device.Uplink.Type},
			})
		}
	}
	if config.DiscoverClients {
		var clientResponse legacyResponse[legacyClient]
		if err := unifiGetJSON(ctx, client, base+"/stat/sta", config.APIKey, &clientResponse); err != nil {
			result.Warnings = append(result.Warnings, "unifi_partial:clients")
		} else {
			for _, clientRow := range clientResponse.Data {
				appendLegacyClient(&result, clientRow, keyByMAC, config.ConnectionID)
			}
		}
	}
	return result, nil
}

func appendLegacyClient(result *Result, client legacyClient, keyByMAC map[string]string, connectionID string) {
	mac := normalizeUnifiMAC(client.MAC)
	if mac == "" {
		return
	}
	key := "unifi-client:" + mac
	result.Items = append(result.Items, Item{
		ObservedKey: key, ItemType: "network_client", Name: firstNonEmpty(client.Name, client.Hostname, "Client "+mac), Confidence: .9,
		RawData: map[string]any{"mac": mac, "address": client.IP, "connectionId": connectionID, "apiGeneration": "legacy", "discoveredVia": "unifi_clients_api", "osiLayer": 3},
	})
	if client.IP != "" {
		result.Relationships = append(result.Relationships, Relationship{FromObservedKey: key, ToObservedKey: "arp:" + client.IP, RelationshipType: "SAME_AS", RawData: map[string]any{"mechanism": "unifi_ip_mac_correlation"}})
	}
	parentMAC, connectionType := client.APMAC, "wireless"
	if client.IsWired {
		parentMAC, connectionType = client.SWMAC, "wired"
	}
	if parentKey := keyByMAC[normalizeUnifiMAC(parentMAC)]; parentKey != "" {
		result.Relationships = append(result.Relationships, Relationship{FromObservedKey: key, ToObservedKey: parentKey, RelationshipType: "CONNECTS_TO", RawData: map[string]any{"connectionType": connectionType, "port": client.SWPort, "evidenceKind": "unifi_client_access"}})
	}
}

func fetchAllPages[T any](ctx context.Context, client *http.Client, endpoint, apiKey string) ([]T, error) {
	items := make([]T, 0)
	for pageNumber, offset := 0, 0; pageNumber < unifiMaxPages; pageNumber++ {
		separator := "?"
		if strings.Contains(endpoint, "?") {
			separator = "&"
		}
		pageURL := fmt.Sprintf("%s%soffset=%d&limit=%d", endpoint, separator, offset, unifiPageSize)
		var page unifiPage[T]
		if err := unifiGetJSON(ctx, client, pageURL, apiKey, &page); err != nil {
			return nil, err
		}
		items = append(items, page.Data...)
		if page.TotalCount <= len(items) || len(page.Data) == 0 {
			return items, nil
		}
		nextOffset := page.Offset + len(page.Data)
		if nextOffset <= offset {
			return nil, &unifiHTTPError{kind: "unifi_invalid_pagination"}
		}
		offset = nextOffset
	}
	return nil, &unifiHTTPError{kind: "unifi_pagination_limit"}
}

func unifiGetJSON(ctx context.Context, client *http.Client, endpoint, apiKey string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return &unifiHTTPError{kind: "unifi_invalid_url"}
	}
	req.Header.Set("X-API-Key", apiKey)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		message := strings.ToLower(err.Error())
		if strings.Contains(message, "certificate") || strings.Contains(message, "tls") {
			return &unifiHTTPError{kind: "unifi_tls_error"}
		}
		return &unifiHTTPError{kind: "unifi_unreachable"}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return &unifiHTTPError{status: resp.StatusCode, kind: "unifi_auth_failed"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return &unifiHTTPError{status: resp.StatusCode, kind: fmt.Sprintf("unifi_api_error:%d", resp.StatusCode)}
	}
	limited := io.LimitReader(resp.Body, unifiMaxResponse+1)
	bytes, err := io.ReadAll(limited)
	if err != nil {
		return &unifiHTTPError{kind: "unifi_unreadable_response"}
	}
	if len(bytes) > unifiMaxResponse {
		return &unifiHTTPError{kind: "unifi_response_too_large"}
	}
	if err := json.Unmarshal(bytes, out); err != nil {
		return &unifiHTTPError{kind: "unifi_invalid_json"}
	}
	return nil
}

func resolveUnifiSite(sites []unifiSite, configured string) (unifiSite, bool) {
	configured = strings.TrimSpace(configured)
	if configured == "" {
		configured = "default"
	}
	for _, site := range sites {
		if site.ID == configured || strings.EqualFold(site.InternalReference, configured) || strings.EqualFold(site.Name, configured) {
			return site, true
		}
	}
	if strings.EqualFold(configured, "default") && len(sites) == 1 {
		return sites[0], true
	}
	return unifiSite{}, false
}

func officialDeviceType(device unifiDeviceOverview) string {
	features := append([]string(nil), device.Features...)
	sort.Strings(features)
	for _, feature := range features {
		switch strings.ToLower(feature) {
		case "accesspoint", "access_point", "wifi":
			return "access_point"
		case "switching", "switch":
			return "switch"
		case "routing", "gateway":
			return "gateway"
		}
	}
	model := strings.ToLower(device.Model)
	if strings.Contains(model, "u7") || strings.Contains(model, "u6") || strings.HasPrefix(model, "uap") {
		return "access_point"
	}
	if strings.HasPrefix(model, "us-") || strings.HasPrefix(model, "usw") {
		return "switch"
	}
	if strings.Contains(model, "ucg") || strings.Contains(model, "udm") || strings.Contains(model, "uxg") || strings.Contains(model, "gateway") {
		return "gateway"
	}
	return "network_device"
}

func legacyDeviceType(deviceType string) string {
	switch strings.ToLower(deviceType) {
	case "usw":
		return "switch"
	case "uap":
		return "access_point"
	case "ugw", "udm", "udmpro", "uxg":
		return "gateway"
	default:
		return "network_device"
	}
}

func deviceOSILayer(itemType string) int {
	if itemType == "gateway" {
		return 3
	}
	return 2
}

func unifiObservedKey(mac, id string) string {
	if normalized := normalizeUnifiMAC(mac); normalized != "" {
		return "unifi:" + normalized
	}
	return "unifi-device:" + id
}

func normalizeUnifiMAC(raw string) string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(raw), "-", ":"))
	if !unifiMACPattern.MatchString(normalized) {
		return ""
	}
	return normalized
}

func warningForUnifiError(err error) string {
	if err == nil {
		return ""
	}
	var httpErr *unifiHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.kind
	}
	return "unifi_unreachable"
}

func isUnsupportedOfficialStatus(status int) bool {
	return status == http.StatusNotFound || status == http.StatusMethodNotAllowed || status == http.StatusNotImplemented
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
