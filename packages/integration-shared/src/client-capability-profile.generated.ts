// GENERATED FILE — do not edit. Source: packages/dpf-skill-pack/client-capabilities.json
// Regenerate: node packages/dpf-skill-pack/scripts/gen-client-capabilities.mjs (BI-64795FD0)

import type { ClientCapabilityProfile } from "./client-capability-rules.cjs";

export const CLIENT_CAPABILITY_PROFILE: ClientCapabilityProfile = {
  "schemaVersion": 1,
  "clients": {
    "claude-code": {
      "displayName": "Claude Code",
      "policyClient": "claude",
      "loadsPack": true,
      "verifiedVersion": "2.1.295",
      "verifiedRange": {
        "min": "2.1.295",
        "max": "2.1.295"
      },
      "sources": [
        "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
        "https://code.claude.com/docs/en/hooks",
        "https://code.claude.com/docs/en/mcp",
        "https://code.claude.com/docs/en/plugins-reference"
      ],
      "writes": [
        {
          "path": "~/.agents/plugins/.claude-plugin/marketplace.json",
          "owner": "dpf",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "DPF's own local marketplace; `claude plugin marketplace add` registers it"
        },
        {
          "path": "~/.agents/plugins/plugins/dpf-platform/**",
          "owner": "dpf",
          "format": "tree",
          "writer": "direct",
          "cli": null,
          "reason": "the shared managed copy DPF delivers; Claude desktop and Grok install from it"
        },
        {
          "path": "~/.claude/plugins/installed_plugins.json",
          "owner": "client",
          "format": "json",
          "writer": "cli",
          "cli": "claude plugin install|update --scope local|project",
          "reason": "Claude Code records each install itself"
        },
        {
          "path": "~/.claude/plugins/cache/**",
          "owner": "client",
          "format": "tree",
          "writer": "cli",
          "cli": "claude plugin install|update",
          "reason": "Claude Code fills its own cache"
        },
        {
          "path": "~/.claude/plugins/cache/**/claude.mcp.json",
          "owner": "client",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "no CLI sets a cached record's connector URL; pinned to a literal endpoint (design 5.4)"
        },
        {
          "path": "~/.claude.json",
          "owner": "client",
          "format": "json",
          "writer": "cli",
          "cli": "claude mcp remove dpf -s user|local",
          "reason": "a duplicate dpf server is removed through the CLI after a backup"
        },
        {
          "path": "~/.claude/dpf-*-mcp.legacy-bak*.json",
          "owner": "dpf",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "the backup taken before the CLI removes a duplicate user- or local-scope server"
        },
        {
          "path": "<project>/.mcp.json",
          "owner": "client",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "no CLI disables a project .mcp.json server; backed up, then disabled"
        },
        {
          "path": "<project>/.mcp.json.legacy-bak*",
          "owner": "dpf",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "the backup taken before a project .mcp.json is disabled"
        },
        {
          "path": "<project>/.claude/settings.local.json",
          "owner": "client",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "no CLI writes routine permissions"
        }
      ],
      "capabilities": {
        "oauthHttps": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-09-19",
          "verifiedVersion": null,
          "evidence": "packages/integration-shared/src/mcp-client-credential-policy.ts (BI-46B636B0); scope pin BI-3D2FD68C"
        },
        "oauthLoopbackHttp": {
          "value": false,
          "status": "verified",
          "verifiedAt": "2026-09-17",
          "verifiedVersion": null,
          "evidence": "docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §12.2: Claude refuses OAuth over http, loopback included (BI-46B636B0)"
        },
        "staticHeaders": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-09-19",
          "verifiedVersion": null,
          "evidence": "packages/dpf-bootstrap/src/agent-toolchain/mcp-client-config.ts writes an Authorization header where a bearer is required"
        },
        "declarationCarrier": {
          "value": "header",
          "status": "encoded",
          "verifiedAt": "2026-10-14",
          "verifiedVersion": null,
          "evidence": "#6329 (BI-DE1E6485): the updater writes the header carrier; the header leaves the connector URL, the OAuth resource and the desktop URL check unchanged. Not live-probed until the carrier spike measures it"
        },
        "pluginScopes": {
          "value": [
            "user",
            "project",
            "local"
          ],
          "status": "encoded",
          "verifiedAt": "2026-10-08",
          "verifiedVersion": null,
          "evidence": "packages/dpf-skill-pack/scripts/update_agent_toolchain.py converges local and project-scope pins (BI-B9F359AC, BI-81B0A3BE)"
        },
        "reloadRequired": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-10-13",
          "verifiedVersion": null,
          "evidence": "apps/web/lib/agent-toolchain/toolchain-verdict.ts formatToolchainNotice asks for a client restart after an update"
        },
        "skillsLoad": {
          "value": true,
          "status": "verified",
          "verifiedAt": "2026-07-26",
          "verifiedVersion": null,
          "evidence": "docs/architecture/agent-client-capability-parity.md governance table G1 (live install sample 2026-07-26)"
        },
        "hookPlane": {
          "cli": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "No live probe of the terminal host is recorded. The desktop proof (BI-E5C45F61) ran the same Claude Code version in another host.",
            "delivery": "plugin hooks/hooks.json plus project .claude/settings.json",
            "denyEnvelope": "hookSpecificOutput",
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": [
              "compose-guard.mjs",
              "raw-tool-guard.mjs",
              "lease-punt-guard.mjs",
              "decision-routing-guard.mjs"
            ]
          },
          "desktop": {
            "status": "verified",
            "verifiedAt": "2026-10-13",
            "verifiedVersion": "2.1.295",
            "evidence": "docs/superpowers/specs/2026-07-03-harness-enforced-decision-routing-and-lease-punt-gates-design.md §15.1 (BI-E5C45F61, #6287): desktop app 2.31226.1 ran every PreToolUse hook but discarded a top-level decision \"deny\"; with the fix, compose-guard and decision-routing-guard probes were denied live. The 2026-10-07 reading that the AskUserQuestion matcher was skipped (BI-271B8EEC) was disproven there.",
            "delivery": "plugin hooks/hooks.json plus project .claude/settings.json (project hooks resolve to the root clone)",
            "denyEnvelope": "hookSpecificOutput",
            "permissionModes": [
              "bypassPermissions"
            ],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "fires",
              "PreToolUse:AskUserQuestion": "fires",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": [
              "compose-guard.mjs",
              "raw-tool-guard.mjs",
              "lease-punt-guard.mjs",
              "decision-routing-guard.mjs"
            ]
          },
          "ide": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "No probe recorded for the IDE extension host.",
            "delivery": "plugin hooks/hooks.json",
            "denyEnvelope": "hookSpecificOutput",
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": [
              "compose-guard.mjs",
              "raw-tool-guard.mjs",
              "lease-punt-guard.mjs",
              "decision-routing-guard.mjs"
            ]
          }
        }
      }
    },
    "codex": {
      "displayName": "Codex CLI",
      "policyClient": "codex",
      "loadsPack": true,
      "verifiedVersion": "0.155.0-alpha.16",
      "verifiedRange": {
        "min": "0.142.5",
        "max": "0.155.0-alpha.16"
      },
      "sources": [
        "https://github.com/openai/codex/releases",
        "https://developers.openai.com/codex/hooks",
        "https://developers.openai.com/codex/mcp",
        "https://developers.openai.com/codex/config-basic"
      ],
      "writes": [
        {
          "path": "~/.agents/plugins/marketplace.json",
          "owner": "dpf",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "DPF's own personal marketplace that `codex plugin add` installs from"
        },
        {
          "path": "~/plugins/dpf-platform/**",
          "owner": "dpf",
          "format": "tree",
          "writer": "direct",
          "cli": null,
          "reason": "the Codex managed copy DPF delivers"
        },
        {
          "path": "~/.codex/plugins/cache/**",
          "owner": "client",
          "format": "tree",
          "writer": "cli",
          "cli": "codex plugin add",
          "reason": "Codex fills its own cache"
        },
        {
          "path": "~/.codex/config.toml",
          "owner": "client",
          "format": "toml",
          "writer": "direct",
          "cli": null,
          "reason": "`codex mcp add` sets neither http_headers nor OAuth scopes, and no CLI toggles a plugin's enabled state; every write round-trips through Codex's own parser (X14)"
        },
        {
          "path": "~/.codex/hooks.json",
          "owner": "client",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "no Codex CLI registers hooks"
        },
        {
          "path": "<project>/.codex/config.toml",
          "owner": "client",
          "format": "toml",
          "writer": "direct",
          "cli": null,
          "reason": "no CLI writes routine permissions; parsed before writing"
        },
        {
          "path": "<project>/.codex/rules/dpf-routine.rules",
          "owner": "dpf",
          "format": "text",
          "writer": "direct",
          "cli": null,
          "reason": "DPF's own marked rules file"
        }
      ],
      "capabilities": {
        "oauthHttps": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-09-20",
          "verifiedVersion": null,
          "evidence": "docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §11 (BI-A5307F9E): Codex uses OAuth on https and loopback http"
        },
        "oauthLoopbackHttp": {
          "value": true,
          "status": "verified",
          "verifiedAt": "2026-09-20",
          "verifiedVersion": null,
          "evidence": "docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §11 (BI-A5307F9E): codex mcp login dpf succeeded against http://127.0.0.1:3000/api/mcp/v1, then governed reads and writes"
        },
        "staticHeaders": {
          "value": null,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "DPF writes bearer_token_env_var for Codex, never a static header"
        },
        "declarationCarrier": {
          "value": "header",
          "status": "encoded",
          "verifiedAt": "2026-10-14",
          "verifiedVersion": null,
          "evidence": "#6329 (BI-DE1E6485): the updater writes the header carrier; the header leaves the connector URL, the OAuth resource and the desktop URL check unchanged. Not live-probed until the carrier spike measures it"
        },
        "pluginScopes": {
          "value": [
            "user"
          ],
          "status": "encoded",
          "verifiedAt": "2026-09-24",
          "verifiedVersion": "0.155.0-alpha.16",
          "evidence": "#5636 (BI-2B634E68): Codex loads the plugin from ~/.codex/plugins/cache"
        },
        "reloadRequired": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-10-13",
          "verifiedVersion": null,
          "evidence": "apps/web/lib/agent-toolchain/toolchain-verdict.ts formatToolchainNotice asks for a client restart after an update"
        },
        "skillsLoad": {
          "value": true,
          "status": "verified",
          "verifiedAt": "2026-07-26",
          "verifiedVersion": null,
          "evidence": "docs/architecture/agent-client-capability-parity.md governance table G1 (live install sample 2026-07-26)"
        },
        "hookPlane": {
          "cli": {
            "status": "verified",
            "verifiedAt": "2026-07-07",
            "verifiedVersion": "0.142.5",
            "evidence": "docs/superpowers/specs/2026-07-03-harness-enforced-decision-routing-and-lease-punt-gates-design.md §11 (BI-883FC2FC): a lease-punt probe ran without hook trust and was denied with it. The ask tool is not named AskUserQuestion, so that matcher never fires (BI-B22DE548). Single plugin plane since #5636 (BI-2B634E68, codex-cli 0.155.0-alpha.16).",
            "delivery": "plugin hooks/hooks.json from the plugin cache; ~/.codex/hooks.json only as a fallback. Fails open until the operator grants hook trust (BI-66EBEA06).",
            "denyEnvelope": "hookSpecificOutput",
            "permissionModes": [
              "codex exec with hook trust granted"
            ],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "fires",
              "PreToolUse:AskUserQuestion": "not-fired",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": [
              "lease-punt-guard.mjs"
            ]
          },
          "desktop": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "No probe recorded for the Codex desktop host.",
            "delivery": "plugin hooks/hooks.json from the plugin cache",
            "denyEnvelope": "hookSpecificOutput",
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": [
              "lease-punt-guard.mjs"
            ]
          },
          "ide": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "No probe recorded for the Codex IDE extension host.",
            "delivery": "plugin hooks/hooks.json from the plugin cache",
            "denyEnvelope": "hookSpecificOutput",
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": [
              "lease-punt-guard.mjs"
            ]
          }
        }
      }
    },
    "grok": {
      "displayName": "Grok Build",
      "policyClient": "grok",
      "loadsPack": true,
      "verifiedVersion": "0.2.87",
      "verifiedRange": {
        "min": "0.2.87",
        "max": "0.2.87"
      },
      "sources": [
        "https://x.ai/news/grok-build-cli",
        "https://docs.x.ai/build/overview",
        "https://docs.x.ai/build/cli/headless-scripting"
      ],
      "writes": [
        {
          "path": "~/.grok/installed-plugins/**",
          "owner": "client",
          "format": "tree",
          "writer": "cli",
          "cli": "grok plugin install|uninstall",
          "reason": "Grok's own plugin store"
        },
        {
          "path": "~/.grok/hooks/dpf-guards.json",
          "owner": "dpf",
          "format": "json",
          "writer": "direct",
          "cli": null,
          "reason": "DPF's own hook file; Grok has no hooks CLI"
        },
        {
          "path": "~/.grok/config.toml",
          "owner": "client",
          "format": "toml",
          "writer": "direct",
          "cli": null,
          "reason": "`grok mcp add` cannot set bearer_token_file and no CLI writes permissions; parsed before writing (X14)"
        },
        {
          "path": "<project>/.grok/config.toml",
          "owner": "client",
          "format": "toml",
          "writer": "direct",
          "cli": null,
          "reason": "no CLI writes routine permissions; parsed before writing"
        }
      ],
      "capabilities": {
        "oauthHttps": {
          "value": false,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §12.2.1: Grok documents a browser OAuth flow, but no grant for an https DPF origin exists; the founder reported on 2026-10-07 that the Grok CLI cannot complete OAuth against a local install"
        },
        "oauthLoopbackHttp": {
          "value": false,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §12.2.1: one dpf.read loopback grant was stored on 2026-09-18; no governed write over it is recorded"
        },
        "staticHeaders": {
          "value": null,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "DPF writes bearer_token_env_var for Grok, never a static header"
        },
        "declarationCarrier": {
          "value": "query",
          "status": "encoded",
          "verifiedAt": "2026-10-14",
          "verifiedVersion": null,
          "evidence": "#6329 (BI-DE1E6485): the updater writes the query carrier; Grok's descriptor URL is literal and it authenticates with a bearer, so it keeps the query. Not live-probed until the carrier spike measures it"
        },
        "pluginScopes": {
          "value": [
            "user"
          ],
          "status": "encoded",
          "verifiedAt": "2026-07-07",
          "verifiedVersion": "0.2.87",
          "evidence": "docs/superpowers/specs/2026-07-03-harness-enforced-decision-routing-and-lease-punt-gates-design.md §11: Grok discovers the plugin from a version-keyed user cache"
        },
        "reloadRequired": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-10-13",
          "verifiedVersion": null,
          "evidence": "apps/web/lib/agent-toolchain/toolchain-verdict.ts formatToolchainNotice asks for a client restart after an update"
        },
        "skillsLoad": {
          "value": true,
          "status": "verified",
          "verifiedAt": "2026-07-26",
          "verifiedVersion": null,
          "evidence": "docs/architecture/agent-client-capability-parity.md governance table G1 (live install sample 2026-07-26)"
        },
        "hookPlane": {
          "cli": {
            "status": "verified",
            "verifiedAt": "2026-07-07",
            "verifiedVersion": "0.2.87",
            "evidence": "docs/superpowers/specs/2026-07-03-harness-enforced-decision-routing-and-lease-punt-gates-design.md §11.1 (BI-883FC2FC): a prisma migrate probe was denied in a DPF worktree and ran in a bare folder. Grok ignores plugin-bundled hooks. The SessionStart and Stop session plane is wired globally (BI-BCA23DBB) and was sampled live on 2026-07-26.",
            "delivery": "global ~/.grok/hooks/dpf-guards.json only, written by update_agent_toolchain.py install_grok_hooks",
            "denyEnvelope": "dual",
            "permissionModes": [
              "headless grok -p"
            ],
            "events": {
              "SessionStart": "fires",
              "PreToolUse:Bash": "fires",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "fires",
              "SessionEnd": "unproven"
            },
            "probes": [
              "lease-punt-guard.mjs"
            ]
          },
          "desktop": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "No probe recorded for the Grok desktop app.",
            "delivery": "global ~/.grok/hooks/dpf-guards.json",
            "denyEnvelope": "dual",
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": [
              "lease-punt-guard.mjs"
            ]
          },
          "ide": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "No Grok IDE host is known to DPF.",
            "delivery": null,
            "denyEnvelope": null,
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": []
          }
        }
      }
    },
    "antigravity": {
      "displayName": "Antigravity",
      "policyClient": "antigravity",
      "loadsPack": true,
      "verifiedVersion": null,
      "verifiedRange": null,
      "sources": [
        "https://antigravity.google/",
        "https://github.com/google-antigravity/antigravity-cli/releases"
      ],
      "writes": [
        {
          "path": "~/.gemini/config/mcp_config.json",
          "owner": "client",
          "format": "json",
          "writer": "cli",
          "cli": "agy mcp add|disable",
          "reason": "agy covers the URL and headers, so it is the only writer"
        },
        {
          "path": "~/.gemini/antigravity/skills/**",
          "owner": "dpf",
          "format": "tree",
          "writer": "direct",
          "cli": null,
          "reason": "the pack's own skill directories; an operator's other skills are never touched"
        }
      ],
      "capabilities": {
        "oauthHttps": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-09-19",
          "verifiedVersion": null,
          "evidence": "packages/integration-shared/src/mcp-client-credential-policy.ts (BI-46B636B0): no bearer on https"
        },
        "oauthLoopbackHttp": {
          "value": false,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "No probe recorded"
        },
        "staticHeaders": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-09-19",
          "verifiedVersion": null,
          "evidence": "packages/dpf-skill-pack/scripts/update_agent_toolchain.py writes an Authorization header for Antigravity where a bearer is required"
        },
        "declarationCarrier": {
          "value": "header",
          "status": "encoded",
          "verifiedAt": "2026-10-14",
          "verifiedVersion": null,
          "evidence": "#6329 (BI-DE1E6485): the updater writes the header carrier; the header leaves the connector URL, the OAuth resource and the desktop URL check unchanged. Not live-probed until the carrier spike measures it"
        },
        "pluginScopes": {
          "value": null,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "docs/architecture/agent-client-capability-parity.md governance table: no plugin-disable CLI; pack install only"
        },
        "reloadRequired": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-10-13",
          "verifiedVersion": null,
          "evidence": "apps/web/lib/agent-toolchain/toolchain-verdict.ts formatToolchainNotice asks for a client restart after an update"
        },
        "skillsLoad": {
          "value": null,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "docs/architecture/agent-client-capability-parity.md governance table G1: partial (pack only)"
        },
        "hookPlane": {
          "cli": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "docs/architecture/agent-client-capability-parity.md governance table G3: hooks unproven, an honest gap",
            "delivery": null,
            "denyEnvelope": null,
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": []
          },
          "desktop": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "No probe recorded.",
            "delivery": null,
            "denyEnvelope": null,
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": []
          },
          "ide": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "No probe recorded.",
            "delivery": null,
            "denyEnvelope": null,
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": []
          }
        }
      }
    },
    "vscode": {
      "displayName": "VS Code",
      "policyClient": "vscode",
      "loadsPack": false,
      "verifiedVersion": null,
      "verifiedRange": null,
      "sources": [
        "https://code.visualstudio.com/updates",
        "https://code.visualstudio.com/docs/copilot/chat/mcp-servers"
      ],
      "capabilities": {
        "oauthHttps": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-09-19",
          "verifiedVersion": null,
          "evidence": "packages/integration-shared/src/mcp-client-credential-policy.ts (BI-46B636B0): no bearer on https"
        },
        "oauthLoopbackHttp": {
          "value": false,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "No probe recorded"
        },
        "staticHeaders": {
          "value": true,
          "status": "encoded",
          "verifiedAt": "2026-09-19",
          "verifiedVersion": null,
          "evidence": "apps/web/lib/auth/mcp-setup-snippets.ts gives VS Code an Authorization header where a bearer is required"
        },
        "declarationCarrier": {
          "value": null,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "VS Code does not load the dpf-platform pack, so it declares nothing"
        },
        "pluginScopes": {
          "value": null,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "VS Code does not load the dpf-platform pack"
        },
        "reloadRequired": {
          "value": null,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "No probe recorded"
        },
        "skillsLoad": {
          "value": null,
          "status": "unproven",
          "verifiedAt": null,
          "verifiedVersion": null,
          "evidence": "VS Code does not load the dpf-platform pack"
        },
        "hookPlane": {
          "cli": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "VS Code has no DPF hook plane.",
            "delivery": null,
            "denyEnvelope": null,
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": []
          },
          "desktop": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "VS Code has no DPF hook plane.",
            "delivery": null,
            "denyEnvelope": null,
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": []
          },
          "ide": {
            "status": "unproven",
            "verifiedAt": null,
            "verifiedVersion": null,
            "evidence": "VS Code has no DPF hook plane.",
            "delivery": null,
            "denyEnvelope": null,
            "permissionModes": [],
            "events": {
              "SessionStart": "unproven",
              "PreToolUse:Bash": "unproven",
              "PreToolUse:AskUserQuestion": "unproven",
              "PreToolUse:Write|Edit|MultiEdit": "unproven",
              "UserPromptSubmit": "unproven",
              "Stop": "unproven",
              "SessionEnd": "unproven"
            },
            "probes": []
          }
        }
      }
    }
  }
};
