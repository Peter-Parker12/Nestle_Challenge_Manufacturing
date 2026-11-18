import sharp from "sharp";

/**
 * Mock shelf photos for the demo: a drawn shelf with products and price tags, rendered to PNG.
 * They are generated, not real, and the UI labels them as such. A covered tag shows as "2#,0#0" so a reader has to decline to guess.
 */
export type ShelfItem = { label: string; color: string; price: number | null; covered?: boolean; empty?: boolean };
export type ShelfSpec = { store: string; date: string; rows: ShelfItem[][] };

const fmt = (n: number) => n.toLocaleString("en-US");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function coverText(price: number) {
  const s = fmt(price).split("");
  const digits = s.map((c, i) => (c !== "," && i % 2 === 1 ? "#" : c));
  return digits.join("");
}

export async function renderShelf(spec: ShelfSpec): Promise<Buffer> {
  const W = 960, H = 540, rowH = 220;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#e3e8f0"/>`, `<rect x="0" y="0" width="${W}" height="38" fill="#08182e"/><text x="16" y="25" font-family="Arial" font-size="16" fill="#ffffff">${esc(spec.store)} · ${esc(spec.date)} · MOCK PHOTO</text>`];
  spec.rows.forEach((row, ri) => {
    const top = 60 + ri * rowH, boardY = top + 140;
    parts.push(`<rect x="0" y="${boardY}" width="${W}" height="14" fill="#8a9bb5"/>`);
    const slot = (W - 40) / Math.max(row.length, 1);
    row.forEach((it, i) => {
      const x = 20 + i * slot, w = slot - 20;
      if (it.empty) parts.push(`<rect x="${x}" y="${top}" width="${w}" height="132" fill="none" stroke="#8a9bb5" stroke-width="3" stroke-dasharray="10 8" rx="6"/><text x="${x + w / 2}" y="${top + 70}" font-family="Arial" font-size="15" fill="#5a6b84" text-anchor="middle">empty</text>`);
      else parts.push(`<rect x="${x}" y="${top}" width="${w}" height="132" fill="${it.color}" rx="8"/><text x="${x + w / 2}" y="${top + 62}" font-family="Arial" font-weight="bold" font-size="17" fill="#ffffff" text-anchor="middle">${esc(it.label.slice(0, 22))}</text>`);
      const tx = x + w / 2 - 62;
      const txt = it.price == null ? "" : it.covered ? coverText(it.price) : fmt(it.price);
      parts.push(`<rect x="${tx}" y="${boardY + 18}" width="124" height="34" fill="#ffffff" stroke="#8a9bb5" rx="3"/><text x="${tx + 62}" y="${boardY + 42}" font-family="Arial" font-weight="bold" font-size="22" fill="#08182e" text-anchor="middle">${esc(txt)}</text>`);
      if (it.covered) parts.push(`<rect x="${tx + 62}" y="${boardY + 18}" width="40" height="34" fill="#c9d1de" opacity="0.92"/>`);
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
