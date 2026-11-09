import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, serviceUser } from "@/lib/mcp/auth";
import { buildServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * MCP endpoint (Streamable HTTP, stateless, JSON responses) for Microsoft Copilot Studio and other MCP clients.
 * Reachable at /mcp (see next.config.mjs) and /api/mcp. Setup: docs/COPILOT_MCP.md
 */
const method405 = () => new Response(JSON.stringify({ error: "method_not_allowed", message: "Use POST. This server is stateless and does not stream." }), { status: 405, headers: { allow: "POST", "content-type": "application/json" } });
export const GET = async (req: Request) => { const a = authenticate(req); return a.ok ? method405() : a.response; };
export const DELETE = GET;

export async function POST(req: Request) {
  const a = authenticate(req);
  if (!a.ok) return a.response;
  const user = await serviceUser();
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  const server = buildServer({ userId: user.id, role: user.role, baseUrl: base });
  // Stateless: a fresh server and transport per request, so any instance can answer and nothing is kept between calls.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 1_000_000 });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close().catch(() => undefined);
  }
}
