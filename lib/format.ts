export const vnd = (n: number | string | null | undefined) => {
  if (n === null || n === undefined || n === "") return "–";
  const v = Number(n), a = Math.abs(v), s = v < 0 ? "−" : "";
  return a >= 1e9 ? `${s}VND ${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}VND ${Math.round(a / 1e6)}M` : `${s}VND ${Math.round(a).toLocaleString("en-US")}`;
};
export const price = (n: number | string | null | undefined) => (n === null || n === undefined ? "–" : Math.round(Number(n)).toLocaleString("en-US"));
export const pctText = (n: number | string | null | undefined, digits = 1) => (n === null || n === undefined ? "–" : `${Number(n) > 0 ? "+" : Number(n) < 0 ? "−" : ""}${Math.abs(Number(n)).toFixed(digits)}%`);
export const levelClass = (l?: string | null) => (l === "High" ? "b-red" : l === "Medium" ? "b-amber" : l === "Low" ? "b-green" : "b-gray");
export const KIND_LABEL: Record<string, string> = { price_cut: "Price cut", price_rise: "Price rise", promo: "Promo", pack_change: "Pack change", shelf_gap: "Shelf gap", out_of_stock: "Out of stock" };
