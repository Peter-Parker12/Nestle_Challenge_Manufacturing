// Minimal mock of the Anthropic Messages API for testing the AI code paths without a key.
//   node tests/mock-claude.mjs            (listens on :9999)
//   ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999 npm start
// It returns canned answers that include deliberate mistakes (a fake citation, a covered price, an out-of-range price)
// so the server-side guardrails can be seen working. A very small image is treated as unreadable.
import http from "node:http";

const text = (c) => (typeof c === "string" ? c : JSON.stringify(c));
const reply = (content, stop = "end_turn") => ({
  id: "msg_mock", type: "message", role: "assistant", model: "mock", content, stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
});

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const tool = body.tool_choice?.type === "tool" ? body.tool_choice.name : null;
    const all = text(body.messages);
    let out;
    if (tool === "read_shelf_photo") {
      const img = body.messages?.[0]?.content?.find?.((b) => b.type === "image");
      const tiny = !img || img.source.data.length < 3000;
      out = reply([{ type: "tool_use", id: "t1", name: tool, input: tiny
        ? { usable: false, notes: "Photo is too small or blurred to read", items: [] }
        : { usable: true, notes: "Two rows of products", items: [
          { label: "Our RTD chocolate 180 ml", sku_code: "N-RTD-180", price: 11500, facings: 2, confidence: 0.95, note: "Tag clear" },
          { label: "Competitor C RTD 180 ml", sku_code: "C-RTD-180", price: 10500, facings: 3, confidence: 0.92, note: "Tag clear" },
          { label: "Our drinking yoghurt x4", sku_code: "N-YOG-4", price: null, facings: 1, confidence: 0.4, note: "Tag partly covered, not guessed" },
          { label: "Our UHT 1 L", sku_code: "N-UHT-1L", price: 125000, facings: 2, confidence: 0.9, note: "Tag clear" },
          { label: "Local brand milk", sku_code: null, price: 9000, facings: 1, confidence: 0.9, note: "Not one of our tracked SKUs" },
        ] } }], "tool_use");
    } else if (tool === "write_brief") {
      const codes = [...new Set([...all.matchAll(/M-\d{4}/g)].map((m) => m[0]))];
      out = reply([{ type: "tool_use", id: "t1", name: tool, input: {
        headline: `Two price moves need a decision this week`,
        sections: [
          { title: "Summary", text: `The biggest move is ${codes[0] ?? "none"} [M:${codes[0] ?? "M-0000"}]. A second move [M:${codes[1] ?? "M-0000"}] follows. Exposure figures are estimates with a range.` },
          { title: "Unverified", text: `A third move [M:M-9999] was mentioned, and a price [O:99999999] that is not in the data.` },
        ] } }], "tool_use");
    } else if (!tool && body.tools?.some((t) => t.name === "get_moves")) {
      if (!all.includes("tool_result")) out = reply([{ type: "tool_use", id: "t5", name: "get_moves", input: {} }], "tool_use");
      else {
        const code = (all.match(/M-\d{4}/) || ["M-2001"])[0];
        out = reply([{ type: "text", text: `The biggest move is ${code} [M:${code}]. I cannot confirm [M:M-9999]. Impact is an estimate, not a certainty.` }]);
      }
    } else out = reply([{ type: "text", text: "ok" }]);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out));
  });
}).listen(9999, () => console.log("mock claude on :9999"));
