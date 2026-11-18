import { q } from "./db";
import { renderShelf, type ShelfItem } from "./mockShelf";
import { createPhoto } from "./radar";

/** A generated shelf photo for demos and tests: current general-trade prices, one covered tag, sometimes an empty slot. Labelled MOCK in the image and the database. */
const COLORS: Record<string, string> = { "N-UHT-1L": "#0b6e4f", "N-UHT-180": "#0b6e4f", "N-RTD-180": "#7a4a2b", "N-YOG-4": "#0072a8", "A-UHT-1L": "#c4161d", "C-UHT-1L": "#2b6fb5", "A-UHT-180": "#c4161d", "C-RTD-180": "#2b6fb5", "B-YOG-4": "#6a3fa0" };

export async function makeMockPhoto(userId: string, opts: { retailerCode?: string; salt?: number } = {}) {
  const stores = await q(`select r.id, r.code, r.name from mkt.retailer r join cfg.channel c on c.id=r.channel_id where c.code='GT' order by r.code`);
  const salt = opts.salt ?? Date.now();
  const store = stores.find((s) => s.code === opts.retailerCode) ?? stores[salt % stores.length];
  const skus = await q(`select s.id, s.code, s.name, s.brand, s.is_nestle,
      (select o.price from mkt.observation o join mkt.retailer r on r.id=o.retailer_id join cfg.channel c on c.id=r.channel_id where o.sku_id=s.id and c.code='GT' order by o.observed_on desc limit 1) as price from mkt.sku s order by s.code`);
  const pick = (code: string, extra: Partial<ShelfItem> = {}): ShelfItem => {
    const s = skus.find((x) => x.code === code)!;
    const jitter = 1 + (((salt >> 3) % 5) - 2) / 400;
    return { label: `${s.is_nestle ? "Our" : s.brand} ${s.name}`.replace("full cream ", ""), color: COLORS[code], price: Math.round((Number(s.price) * jitter) / 100) * 100, ...extra };
  };
  const covered = ["N-YOG-4", "N-RTD-180", "A-UHT-1L"][salt % 3];
  const rows: ShelfItem[][] = [
    [pick("N-RTD-180", covered === "N-RTD-180" ? { covered: true } : {}), pick("C-RTD-180"), pick("N-UHT-180")],
    [pick("N-UHT-1L"), pick("A-UHT-1L", covered === "A-UHT-1L" ? { covered: true } : {}), pick("N-YOG-4", covered === "N-YOG-4" ? { covered: true } : {})],
  ];
  const today = new Date().toISOString().slice(0, 10);
  const bytes = await renderShelf({ store: store.name, date: today, rows });
  const id = await createPhoto(userId, { retailerId: store.id, takenOn: today, bytes, mime: "image/png", isMock: true });
  return { id, store: store.name };
}
