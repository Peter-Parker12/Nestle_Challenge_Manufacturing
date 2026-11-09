export default {
  serverExternalPackages: ["pg"],
  async rewrites() {
    // A short, stable address for the MCP endpoint that Copilot connects to.
    return [{ source: "/mcp", destination: "/api/mcp" }];
  },
};
