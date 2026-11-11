import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../auth";
import { q1 } from "../db";
import { models, structured } from "./client";

/**
 * Photo assessment of a seal. Advisory only: the inspector decides. Rule BR-S5 (also in the database):
 * the assessment can raise concern; a lower rating than the assessment needs a written reason.
 */
const out = z.object({
  usable: z.boolean(),
  rating: z.number().int().min(1).max(5),
  findings: z.string().min(3).max(600),
  confidence: z.enum(["low", "medium", "high"]),
});

const TOOL = {
  name: "assess_seal_photo",
  description: "Rate the visible condition of the seal in the photo.",
  input_schema: {
    type: "object",
    properties: {
      usable: { type: "boolean", description: "false if the photo is too dark, blurred or does not show a seal or gasket" },
      rating: { type: "integer", minimum: 1, maximum: 5, description: "1 like new, 2 light wear, 3 visible wear, 4 damaged (chips, cracks, tears: fragments possible), 5 failed" },
      findings: { type: "string", description: "What is visible, in one or two plain sentences. Do not guess causes or things not visible." },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["usable", "rating", "findings", "confidence"],
  },
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export async function analyseSealPhoto(userId: string, photo: { contentType: string; bytes: Buffer }) {
  if (!IMAGE_TYPES.includes(photo.contentType as any)) throw new HttpError(422, "The photo must be a JPEG, PNG or WebP image", "validation");
  if (photo.bytes.length > 4 * 1024 * 1024) throw new HttpError(413, "The photo is larger than 4 MB", "too_large");
  const sha = createHash("sha256").update(photo.bytes).digest("hex");
  const r = await structured({
    purpose: "seal_photo", model: models.main(), userId, maxTokens: 600,
    system: "You help a maintenance inspector rate a food-plant seal or gasket from one photo. Rate only what is visible. Rating 4 or 5 means a piece could break off. When unsure between two ratings choose the higher one and say why in the findings.",
    content: [
      { type: "image", source: { type: "base64", media_type: photo.contentType as "image/jpeg", data: photo.bytes.toString("base64") } },
      { type: "text", text: "Rate this seal." },
    ],
    tool: TOOL, zod: out, inputRefs: { photo_sha: sha }, logRequest: { photo_sha: sha, bytes: photo.bytes.length },
  });
  if (!r.valid || !r.data) throw new HttpError(502, "The assessment did not come back in a usable form. Rate the seal yourself", "ai_invalid");
  if (!r.data.usable) return { usable: false as const, findings: r.data.findings };
  const row = await q1<{ id: string }>(
    `insert into ast.photo_analysis(photo_sha,rating,findings,confidence,model,created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
    [sha, r.data.rating, r.data.findings, r.data.confidence, models.main(), userId]);
  return { usable: true as const, analysisId: row!.id, rating: r.data.rating, findings: r.data.findings, confidence: r.data.confidence };
}
