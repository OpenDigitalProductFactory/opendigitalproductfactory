package main

import (
	"encoding/json"
	"os"
)

// jsonEncoder returns a pretty-printer writing to stdout. Indent two
// spaces; suppress HTML escaping so the fixture file looks like what
// an operator wrote by hand. Used by printEnrollFixture.
func jsonEncoder() *json.Encoder {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc
}
