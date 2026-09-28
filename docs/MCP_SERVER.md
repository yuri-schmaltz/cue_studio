# Cue Studio MCP Server

> **Status:** v2.2.0 — read-mostly preview. Mutations (start/cancel pipeline,
> install LoRA, etc.) arrive in a follow-up release with capability gating and
> a request journal for transport-retry safety.

The Model Context Protocol (MCP) server lets external agents drive Cue Studio
through the same code paths the UI buttons use. Use it from Cursor, Cline,
Claude Code, custom scripts, or any JSON-RPC 2.0 client.

- **Endpoint:** `POST /api/v1/mcp`
- **Transport:** HTTP/1.1 (streamable-HTTP, JSON-RPC 2.0)
- **Protocol version:** `2025-03-26`
- **Authentication:** `Authorization: Bearer <token>`
- **Disabled by default** — enable via Settings, env var, or persistent file

---

## Enabling the server

Three ways, in priority order:

### 1. Environment variable (recommended for deployments)

```bash
export CUE_MCP_TOKEN="<at-least-32-chars-token>"
```

When set, the server is always reachable and rotation requires editing the
environment. The persisted file reflects this state but never holds a token
alongside the env value.

### 2. Persistent file

```bash
mkdir -p ~/.cue_studio
cat > ~/.cue_studio/mcp.json <<EOF
{"enabled": true, "token": "<at-least-32-chars-token>"}
EOF
chmod 600 ~/.cue_studio/mcp.json
```

The token is auto-generated on first enable and returned exactly once.

### 3. UI toggle (follow-up PR)

A `Settings → Integrations → MCP` panel will land with the v2.2.0 UI work.

---

## Quick start with curl

```bash
# 1. Get a token (after enabling via env or file)
TOKEN="<paste your token here>"

# 2. Initialize the session
curl -s -X POST http://127.0.0.1:7860/api/v1/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}'
# {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26", ... }}

# 3. Discover available tools
curl -s -X POST http://127.0.0.1:7860/api/v1/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}'

# 4. Call a tool
curl -s -X POST http://127.0.0.1:7860/api/v1/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {"name": "director_list_pipelines", "arguments": {"limit": 10}}
  }'
```

---

## Available tools (v2.2.0)

| Name | Type | Description |
|---|---|---|
| `system_capabilities` | read | Runtime config snapshot: app version, attention mode, codec, VRAM safety |
| `llm_status` | read | Active LLM model + role routing state |
| `llm_test_connection` | read | Short-lived probe of the LLM endpoint |
| `director_list_pipelines` | read | List Director pipelines with optional status filter |
| `director_get_pipeline` | read | Inspect a single Director pipeline by id |

**Mutations (start/cancel pipeline, install LoRA, etc.) are intentionally
absent in v2.2.0.** They will land with capability gating and an SQLite
request journal that prevents transport retries from creating duplicate
work — the same pattern HocusPocus uses in `routers/wangp_mcp.py`.

---

## Client example (Python)

```python
import json
import urllib.request


class CueMcpClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/") + "/api/v1/mcp"
        self.token = token
        self._next_id = 1

    def _request(self, method: str, params: dict | None = None) -> dict:
        body = {"jsonrpc": "2.0", "id": self._next_id, "method": method}
        if params is not None:
            body["params"] = params
        self._next_id += 1
        req = urllib.request.Request(
            self.base_url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)

    def initialize(self) -> dict:
        return self._request("initialize")

    def list_tools(self) -> list[dict]:
        return self._request("tools/list")["result"]["tools"]

    def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        result = self._request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )["result"]
        if result.get("isError"):
            raise RuntimeError(result["content"][0]["text"])
        return json.loads(result["content"][0]["text"])


if __name__ == "__main__":
    import os

    client = CueMcpClient(
        base_url=os.environ.get("CUE_BASE_URL", "http://127.0.0.1:7860"),
        token=os.environ["CUE_MCP_TOKEN"],
    )
    print(client.initialize())
    print([t["name"] for t in client.list_tools()])
    print(client.call_tool("director_list_pipelines", {"limit": 5}))
```

---

## Error model

JSON-RPC 2.0 standard error codes plus a content-envelope for tool-level
failures:

| Code | Meaning | When |
|---|---|---|
| `-32700` | Parse error | Body is not valid JSON |
| `-32600` | Invalid request | Body is not a JSON-RPC 2.0 object |
| `-32601` | Method not found | Unknown method name |
| `-32602` | Invalid params | (reserved — tool errors use the envelope below) |
| `-32603` | Internal error | Unhandled exception in the dispatcher |

For tool-level failures (`McpToolError`, validation errors), the response is:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "isError": true,
    "content": [{"type": "text", "text": "Pipeline not found: abc123"}]
  }
}
```

This matches the MCP spec — tool errors are surfaced as `isError: true`
content, not transport errors.

---

## Notifications

Requests without an `id` field are notifications. The server returns
`202 Accepted` with no body. Examples:

```json
{"jsonrpc": "2.0", "method": "notifications/initialized"}
{"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"id": 3}}
```

Unknown notification methods are silently dropped (per the MCP spec).

---

## Security notes

- **Tokens are owner-only readable.** The persisted file is created with
  `0o600` mode on POSIX and written atomically (tmp + fsync + `os.replace`).
- **Constant-time comparison** (`secrets.compare_digest`) prevents timing
  attacks on Bearer token checks.
- **Origin header check** rejects cross-origin POSTs (defence-in-depth
  against browsers tricked into hitting the endpoint).
- **Content-Type guard** rejects non-JSON bodies to avoid accidental scraping
  by bots that try to GET/POST the path.
- **Tokens are never logged.** The token is returned exactly once at
  issuance; subsequent `status()` calls expose only the persisted enabled
  flag and `managedByEnvironment` indicator.

If you rotate the token, immediately invalidate any external clients that
held the old value.

---

## Operational checklist

When deploying behind a reverse proxy (nginx, Caddy, etc.):

- Forward `Authorization` header unchanged.
- Allow `POST` to `/api/v1/mcp` (return `405` for `GET` is intentional).
- Limit body size to ~1 MB — JSON-RPC tools carry JSON only, no media.
- Set `Access-Control-Allow-Origin` only if you trust the agent host;
  the in-router origin check is the real gate.

---

## See also

- [docs/MIGRATION_HOCUSPOCUS.md](MIGRATION_HOCUSPOCUS.md) — overall plan
- [MCP specification](https://spec.modelcontextprotocol.io/) — protocol reference
- `app/services/mcp_access.py` — token store
- `app/services/mcp_dispatcher.py` — JSON-RPC envelope
- `app/services/mcp_tools.py` + `mcp_tools_impl.py` — tool registry
- `app/routers/mcp.py` — FastAPI router
- `tests/test_mcp_*.py` — 54 tests covering the whole stack
