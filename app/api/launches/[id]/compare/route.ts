import { z } from "zod";
import { body, route } from "@/lib/api";
import { previewRecommendation } from "@/lib/repo";

/** BR-11: show the result with the category defaults next to the result with the engineer's weights. Nothing is saved. */
const schema = z.object({
  attributes: z.record(z.string(), z.number()).default({}),
  parameters: z.record(z.string(), z.number()).default({}),
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const d = await body(req, schema);
  const defaults = await previewRecommendation(id, undefined);
  // Start from the currently resolved weights and apply the proposed changes on top.
  const custom = await previewRecommendation(id, {
    attributes: { ...defaults.weights.levels.attributes, ...d.attributes },
    parameters: { ...defaults.weights.levels.parameters, ...d.parameters },
  });
  const sum = (r: typeof defaults) => ({
    nMatched: r.result.nMatched, confidence: r.result.confidence, overallRisk: r.result.overallRisk,
    neighbours: r.result.neighbours.map((n) => ({ code: n.code, similarity: n.similarity })),
    lines: r.result.lines, warnings: r.warnings,
  });
  return { current: sum(defaults), proposed: sum(custom) };
});
