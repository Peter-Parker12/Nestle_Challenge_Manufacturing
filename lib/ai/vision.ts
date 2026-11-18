import { z } from "zod";
import { HttpError } from "../auth";
import { q, q1, tx, qc } from "../db";
import { median } from "../engine/types";
import { models, structured } from "./client";

/**
 * Reads price tags and facings from a shelf photo. Claude reads; it does not decide. Rules:
 * - a price is given only when the digits are legible; a covered or blurred tag returns no price and a low confidence
 * - the reading is stored as the AI's value and a person confirms or corrects it before it enters the price history
 * - a price far from that SKU's usual range is flagged for checking in code, whatever the AI's confidence
 */
const TOOL = {
  name: "read_shelf_photo",
  description: "Report every price tag visible in the shelf photo and the product it belongs to.",
  input_schema: {
    type: "object",
    properties: {
      usable: { type: "boolean", description: "false if the photo is too blurred, dark or cropped to read tags" },
      notes: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "The product as printed or recognised, short" },
            sku_code: { type: ["string", "null"], description: "One of the provided SKU codes, or null if it is not one of them" },
            price: { type: ["number", "null"], description: "Shelf price in VND. null unless every digit is legible. Never guess a covered or blurred digit" },
            facings: { type: ["integer", "null"], description: "Number of facings, 0 for an empty slot" },
            promo_text: { type: ["string", "null"] },
            confidence: { type: "number", description: "0 to 1" },
            note: { type: "string" },
          },
          required: ["label", "sku_code", "price", "facings", "confidence", "note"],
        },
      },
    },
    required: ["usable", "items"],
  },
};
const Out = z.object({
  usable: z.boolean(), notes: z.string().optional(),
  items: z.array(z.object({ label: z.string().max(80), sku_code: z.string().nullable(), price: z.number().positive().nullable(), facings: z.number().int().min(0).max(40).nullable(), promo_text: z.string().nullable().optional(), confidence: z.number().min(0).max(1), note: z.string().max(200) })).max(40),
});

export async function readShelfPhoto(userId: string, photoId: string) {
  const p = await q1<{ bytes: Buffer; mime: string; retailer_id: string }>(`select bytes, mime, retailer_id from mkt.photo where id=$1`, [photoId]);
  if (!p) throw new HttpError(404, "Photo not found", "not_found");
  if ((await q1<{ n: number }>(`select count(*)::int as n from mkt.photo_item where photo_id=$1`, [photoId]))!.n > 0) throw new HttpError(409, "This photo was already read", "conflict");
  const skus = await q(`select id, code, name, brand from mkt.sku where status='Active' order by code`);
  const system = `You read retail shelf photos for a market radar in Vietnam. SKU codes you may use:\n${skus.map((s) => `${s.code}: ${s.brand} ${s.name}`).join("\n")}\nReport each price tag with its product. Prices are in VND. If a tag is covered, blurred or cut off, set price to null and lower the confidence; never guess digits. An empty slot has facings 0.`;
  const out = await structured({
    purpose: "shelf_photo_read", model: models.main(), system, tool: TOOL, zod: Out, userId, maxTokens: 2500,
    content: [{ type: "image", source: { type: "base64", media_type: p.mime as "image/png" | "image/jpeg", data: p.bytes.toString("base64") } }, { type: "text", text: "Read this shelf photo." }],
    logRequest: { photo_id: photoId }, inputRefs: { photo: photoId },
  });
  if (!out.valid || !out.data) throw new HttpError(502, `The reading was not usable: ${out.errors.join("; ")}`, "ai_invalid");
  const bySku = new Map(skus.map((s) => [s.code as string, s.id as string]));
  const items = out.data.usable ? out.data.items : [];
  const created = await tx({ userId, reason: "Shelf photo read by AI" }, async (c) => {
    let i = 0; const ids: string[] = [];
    for (const it of items) {
      const skuId = it.sku_code ? bySku.get(it.sku_code) ?? null : null;
      let note = it.note, conf = it.confidence, price = it.price;
      if (price != null && skuId) {
        // sanity check in code: far from the usual range for this SKU in this retailer's channel
        const hist = await qc(c, `select o.price from mkt.observation o join mkt.retailer r on r.id=o.retailer_id where o.sku_id=$1 and r.channel_id=(select channel_id from mkt.retailer where id=$2) order by o.observed_on desc limit 40`, [skuId, p.retailer_id]);
        const m = median(hist.map((h) => Number(h.price)));
        if (hist.length >= 5 && (price < m * 0.6 || price > m * 1.6)) { note = `${note}. Outside the usual range (about ${Math.round(m)}); check the digits.`; conf = Math.min(conf, 0.5); }
      }
      const needs = conf < 0.8 || price == null || !skuId;
      const row = await qc(c, `insert into mkt.photo_item(photo_id,idx,label,sku_id,ai_price,ai_facings,ai_conf,ai_note,needs_check) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [photoId, i++, it.label || "Unlabelled", skuId, price, it.facings, conf, note, needs]);
      ids.push(row[0].id);
    }
    return ids;
  });
  return { usable: out.data.usable, notes: out.data.notes ?? null, items: created.length };
}
