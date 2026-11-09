# Connecting Microsoft Copilot (MCP)

The app includes an **MCP server** so Microsoft Copilot (Copilot Studio) and other MCP clients can talk to the Launch Accelerator: look up launches, draft a new one, ask for a recommendation, and ask why. It runs inside the same app, so the tunnel still only needs port 9361.

> **Not tested against Copilot Studio.** I tested the server with the official MCP client and with raw HTTP requests. I could not connect a real Copilot Studio agent from here, so the Copilot Studio menu names below follow Microsoft's documented flow and may differ slightly in your tenant. Section "Test it" lets you prove the server works before you try Copilot.

## What it is

| | |
|---|---|
| Protocol | MCP, Streamable HTTP (the transport Copilot Studio supports), stateless, plain JSON responses |
| Address | `https://<your-domain>/mcp` (also `/api/mcp`) |
| Sign-in | An API key, sent as `Authorization: Bearer <key>` or `x-api-key: <key>` |
| Switched on by | `MCP_API_KEY` being set. With no key the endpoint answers 503 and `/api/health` shows `mcp: false` |

## What Copilot can and cannot do

| Tool | What it does | Writes? |
|---|---|---|
| `get_category_setup` | Lists categories, or for one category the product fields (types, units, options, ranges, required), quality tests, parameters and lines. Copilot calls this first so it fills a launch correctly | No |
| `list_launches` | Launches with status, runs and latest result | No |
| `get_launch` | One launch: product fields, quality targets, runs, and the latest recommendation with settings, risk flags and evidence | No |
| `create_launch` | Drafts a launch. It stays a **Draft**; nothing starts, nothing is approved | Yes |
| `recommend` | Asks for a recommendation. Stored as a **proposal** for a person to review | Yes |
| `explain_recommendation` | Plain-language explanation citing past launches (Claude if configured, otherwise a standard text) | No |
| `preview_weights` | What-if: how the result changes with different weights. Saves nothing | No |
| `ask_history` | Questions about past launches, answered by Claude with checked citations. Needs the Claude API | No |
| `get_dashboard` | Headline figures | No |

**Copilot cannot** approve, reject or edit a plan, enter or review run results, record technical acceptance, change weights, product fields or process setup, import data, or cancel a launch. Those tools do not exist on this server, so no instruction to Copilot can make it do them. Every tool that writes returns a link to the launch so a person can review and decide in the web app. This keeps the rule that nothing is auto-approved.

## Safeguards

| Safeguard | Detail |
|---|---|
| Key required | Constant-time comparison. Wrong or missing key gives 401 |
| Service account | Calls run as **Copilot (MCP)**, an inactive user that cannot sign in and does not appear in the role switcher. The audit log names it for every change |
| Fixed role | `MCP_SERVICE_ROLE`: `viewer` (read only), `rd_engineer` (default: can draft launches and ask for recommendations), `process_engineer`. The role's permissions are checked on every tool; a viewer is refused `create_launch` and `recommend` |
| Audit | Every tool call is recorded (`MCP_TOOL`) with the tool and its arguments, and every change it makes is audited as usual |
| Private fields | Product fields marked "never shared with AI assistants" are left out of every answer and cannot be written through MCP |
| Validation | The same rules as the web forms apply: ranges, options, required fields, units. Errors come back as readable tool errors so Copilot can correct itself |
| Rate limit | `MCP_RATE_LIMIT_PER_MIN` (default 60) per key, then 429 |
| No streaming, no sessions | Each call stands alone; nothing is kept between calls |

## Set it up

### 1. Turn it on

In `.env`:

```
MCP_API_KEY=<a long random value, at least 16 characters>      # openssl rand -hex 32
MCP_SERVICE_ROLE=rd_engineer                                    # or viewer for read only
PUBLIC_BASE_URL=https://<your-domain>                           # so review links work
```

Then `docker compose up -d`. Check `GET /api/health` shows `"mcp": true`. Keep the key out of chat, tickets and the repository (`.env` is not committed).

### 2. Test it before involving Copilot

```bash
KEY=<your key>; URL=https://<your-domain>/mcp
curl -s $URL -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should see the nine tools. The automated suite does the same through the official client: `API_BASE=… MCP_API_KEY=… npx vitest run tests/mcp.int.test.ts`.

### 3. Add it to a Copilot Studio agent

1. In Copilot Studio open the agent, go to **Tools**, and choose **Add a tool**, then **New tool**, then **Model Context Protocol**.
2. Enter a name (for example *Launch Accelerator*), a short description, and the server URL `https://<your-domain>/mcp`.
3. For authentication choose **API key**, put the key in a **header**, and use the header name `x-api-key` (or `Authorization` with the value `Bearer <key>`). Create the connection and paste the key when asked.
4. Add the tools to the agent. Give the agent an instruction such as: *"Use the Launch Accelerator tools for product launch questions. Call get_category_setup before creating a launch. Recommendations are proposals: always give the user the review link and never say a plan is approved."*
5. Test in the agent's chat: *"List the open launches"*, then *"Draft a launch for a choco malt RTD, cocoa base, 2.8% fat, 15.5% solids, viscosity 38 on line L1, then recommend a starting window."*

The server must be reachable from the internet by Microsoft (your Cloudflare tunnel does this). If you restrict it with Cloudflare Access, Copilot Studio will not get through unless you allow it. The API key is the sign-in.

Other MCP clients (Claude Desktop, VS Code and others) can use the same URL and key.

## Data and approval

Everything a tool returns is sent to Microsoft Copilot and its model. That includes recipes, process settings and trial results of the launches it reads. **Nestlé must approve this** (data classification, residency, whether Copilot may see recipes) before real data is connected. Until then, run it on the synthetic data. Use `MCP_SERVICE_ROLE=viewer` for read-only access, and mark sensitive product fields "never shared".

## Limits

- **One shared identity.** Everyone using the Copilot agent acts as the same service account. The audit log shows "Copilot (MCP)", not the person who asked. Per-user identity needs OAuth with Microsoft Entra ID and mapping users to roles (see `PRODUCTION_GAPS.md`).
- **API key only.** No OAuth yet. Rotate the key by changing `MCP_API_KEY` and restarting the app, then updating the connection in Copilot Studio.
- **Rate limit is per process.** With several app instances each has its own counter.
- Tools only; no MCP resources or prompts. Results are JSON text.
- `ask_history` and the Claude-written explanations need `ANTHROPIC_API_KEY`. Without it, explanations fall back to the standard text and `ask_history` returns a clear message.

## Troubleshooting

| Symptom | Cause |
|---|---|
| 503 `mcp_disabled` | `MCP_API_KEY` is empty or shorter than 16 characters |
| 401 | Wrong key, or the header name or value in the connection does not match |
| 405 on GET | Expected: the server is stateless and only accepts POST |
| 429 | Rate limit reached; wait a minute or raise `MCP_RATE_LIMIT_PER_MIN` |
| A tool says the role "is not allowed" | `MCP_SERVICE_ROLE` is `viewer`; change it if drafting should be allowed |
| Review links are relative (`/launches/…`) | `PUBLIC_BASE_URL` is not set |
| Copilot cannot reach the server | The tunnel or a firewall blocks Microsoft's servers, or the URL is not public |
