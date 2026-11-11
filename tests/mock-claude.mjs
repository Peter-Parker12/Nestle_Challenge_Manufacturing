// Minimal mock of the Anthropic Messages API for testing the AI code paths without a key.
//   node tests/mock-claude.mjs            (listens on :9999)
//   ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999 npm start
// It returns canned tool calls that include deliberate mistakes (a wrong number, a fake citation, an out-of-range value)
// so the server-side guardrails can be seen working.
import http from "node:http";
import fs from "node:fs";

const text = (c) => (typeof c === "string" ? c : JSON.stringify(c));
const reply = (content, stop = "end_turn") => ({
  id: "msg_mock", type: "message", role: "assistant", model: "mock", content, stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
});

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    if (process.env.MOCK_LOG) fs.appendFileSync(process.env.MOCK_LOG, raw + "\n"); // record every request, to inspect what a prompt contains
    const body = raw ? JSON.parse(raw) : {};
    const tool = body.tool_choice?.type === "tool" ? body.tool_choice.name : null;
    const all = text(body.messages);
    let out;
    if (tool === "fill_request")
      out = reply([{ type: "tool_use", id: "t1", name: tool, input: { product_name: "Choco Malt RTD 200ml", attributes: { viscosity_cp: 38, fat_pct: 2.8, solids_pct: 15.5, base: "cocoa", pack_ml: 99999, bogus_field: 1 }, unparsed: ["wants a red cap"] } }], "tool_use");
    else if (tool === "write_explanation") {
      const codes = [...all.matchAll(/L-\d{4}/g)].map((m) => m[0]);
      out = reply([{ type: "tool_use", id: "t1", name: tool, input: {
        summary: `Seven similar launches support a start near 200 bar. A margin of 777 bar was never observed.`,
        key_points: [{ text: `Closest match ${codes[0]} passed or needed rework as listed.`, evidence_codes: [codes[0], "L-9999"] }],
        watch_outs: ["Creaming risk with high fat."] } }], "tool_use");
    } else if (tool === "record_trial_run")
      out = reply([{ type: "tool_use", id: "t1", name: tool, input: {
        parameters: [{ code: "homog_pressure_bar", actual: 205, source_quote: "Homogenizer 205 bar" }, { code: "uht_temp_c", actual: 140.5 }, { code: "hold_time_s", actual: 4.7 }, { code: "fill_temp_c", actual: 22 }, { code: "flow_rate_lph", actual: 4650 }],
        quality: [{ code: "viscosity_cp", value: 38.4 }, { code: "sediment_pct", value: 0.31 }, { code: "creaming_idx", value: 1.2 }, { code: "ph", value: 6.7 }],
        product_fields: [{ code: "pack_type", value: "pouch", source_quote: "Packed in pouches" }, { code: "organic", value: "maybe", source_quote: "organic?" }],
        loss_kg: 75, notes: "Imported" } }], "tool_use");
    else if (tool === "assess_seal_photo") {
      const blurry = all.includes("QkxVUg"); // base64 of "BLUR" at the start of the fake photo
      out = reply([{ type: "tool_use", id: "t1", name: tool, input: blurry
        ? { usable: false, rating: 1, findings: "Photo is blurred", confidence: "low" }
        : { usable: true, rating: 4, findings: "Chipped edge on the sealing lip, a fragment could come off.", confidence: "medium" } }], "tool_use");
    } else if (tool === "propose_rules")
      out = reply([{ type: "tool_use", id: "t1", name: tool, input: { rules: [{ attr: "fat_pct", op: ">", value: 2.8, severity: "Medium", message: "Fat above 2.8%: more rework seen.", rationale: "Rework rate rises in the top band.", evidence_codes: ["L-1001", "L-1002"] }] } }], "tool_use");
    else if (!tool && body.tools?.length) {
      // history Q&A: first turn asks for a tool, second turn answers
      const gotResult = all.includes("tool_result");
      if (!gotResult) out = reply([{ type: "tool_use", id: "t2", name: "search_launches", input: { filters: [{ attr: "viscosity_cp", op: ">", value: 35 }], needed_rework: true } }], "tool_use");
      else {
        const code = (all.match(/L-\d{4}/) || ["L-1001"])[0];
        out = reply([{ type: "text", text: `Launches with high viscosity needed rework, for example [${code}]. I could not confirm [L-9999].` }]);
      }
    } else out = reply([{ type: "text", text: "ok" }]);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out));
  });
}).listen(9999, () => console.log("mock claude on :9999"));
