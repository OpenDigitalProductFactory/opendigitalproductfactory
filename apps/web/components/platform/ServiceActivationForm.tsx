"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateMcpIntegration, registerMcpServer, testMcpConnection } from "@/lib/actions/mcp-services";
import type { McpConnectionConfig, McpTransport } from "@/lib/mcp-server-types";

type Props = {
  integrationId?: string;
  prefillName?: string;
  prefillCategory?: string;
  prefillServerId?: string;
};

export function ServiceActivationForm({ integrationId, prefillName, prefillCategory, prefillServerId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [transport, setTransport] = useState<McpTransport>("http");
  const [name, setName] = useState(prefillName ?? "");
  const [serverId, setServerId] = useState(prefillServerId ?? "");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [headers, setHeaders] = useState("");
  const [envVars, setEnvVars] = useState("");
  const [healthResult, setHealthResult] = useState<{ healthy?: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildConfig(): McpConnectionConfig {
    if (transport === "stdio") {
      const parsedEnv: Record<string, string> = {};
      envVars.split("\n").filter(Boolean).forEach((line) => {
        const [k, ...v] = line.split("=");
        if (k) parsedEnv[k.trim()] = v.join("=").trim();
      });
      return {
        transport: "stdio",
        command,
        args: args ? args.split(/\s+/) : undefined,
        env: Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined,
      };
    }
    const parsedHeaders: Record<string, string> = {};
    headers.split("\n").filter(Boolean).forEach((line) => {
      const [k, ...v] = line.split(":");
      if (k) parsedHeaders[k.trim()] = v.join(":").trim();
    });
    return {
      transport,
      url,
      headers: Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined,
    };
  }

  function handleTestConnection() {
    setHealthResult(null);
    setError(null);
    startTransition(async () => {
      const config = buildConfig();
      if (transport !== "stdio" && !url) {
        setHealthResult({ healthy: false, error: "URL is required" });
        return;
      }
      if (transport === "stdio" && !command) {
        setHealthResult({ healthy: false, error: "Command is required" });
        return;
      }
      const res = await testMcpConnection(config);
      setHealthResult({ healthy: res.healthy, error: res.error });
    });
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const config = buildConfig();
      let result: { ok: boolean; message: string; serverId?: string; id?: string };

      if (integrationId) {
        result = await activateMcpIntegration(integrationId, config);
      } else {
        result = await registerMcpServer(name, serverId || name.toLowerCase().replace(/\W+/g, "-"), config, prefillCategory);
      }

      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/platform/services/${result.serverId ?? result.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 max-w-lg">
      {!integrationId && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background" placeholder="e.g. Stripe MCP Server" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Server ID</label>
            <input value={serverId} onChange={(e) => setServerId(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono" placeholder="e.g. stripe-mcp" />
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Transport</label>
        <div className="flex gap-4">
          {(["http", "sse", "stdio"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="transport" value={t} checked={transport === t} onChange={() => setTransport(t)} />
              {t.toUpperCase()}
            </label>
          ))}
        </div>
      </div>

      {transport === "stdio" ? (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">Command</label>
            <input value={command} onChange={(e) => setCommand(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono" placeholder="npx" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Arguments (space-separated)</label>
            <input value={args} onChange={(e) => setArgs(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono" placeholder="-y stripe-mcp" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Environment Variables (one per line, KEY=VALUE)</label>
            <textarea value={envVars} onChange={(e) => setEnvVars(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono" rows={3} placeholder="STRIPE_API_KEY=sk_live_..." />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono" placeholder="https://mcp.example.com/v1" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Headers (one per line, Key: Value)</label>
            <textarea value={headers} onChange={(e) => setHeaders(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono" rows={3} placeholder="Authorization: Bearer sk_live_..." />
          </div>
        </>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button onClick={handleTestConnection} disabled={isPending}
          className="px-4 py-2 rounded border text-sm hover:bg-muted disabled:opacity-50">
          Test Connection
        </button>
        <button onClick={handleSave} disabled={isPending || !healthResult?.healthy}
          className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50">
          {isPending ? "Saving..." : "Save & Activate"}
        </button>
      </div>

      {healthResult && (
        <p className={`text-xs ${healthResult.healthy ? "text-green-600" : "text-red-600"}`}>
          {healthResult.healthy ? "Connection OK" : healthResult.error ?? "Connection failed"}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
