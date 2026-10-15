#!/usr/bin/env node
// Moved to the skill pack so a pack-only host can refresh Grok's credential
// (BI-84C1F526). This path stays for the bootstrap scripts; it runs the pack copy.
import "../packages/dpf-skill-pack/scripts/refresh-grok-mcp-credential.mjs";
