import { route } from "@/lib/api";
import { q } from "@/lib/db";
import { categoryWeightLevels, loadCategoryConfig } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (_req, { id }) => {
  const cfg = await loadCategoryConfig(id);
  const rules = await q("select id, condition, risk_effect, message, status from cfg.sme_rule where category_id=$1 order by status, message", [id]);
  return { ...cfg, categoryWeights: await categoryWeightLevels(id, cfg.attrDefs, cfg.paramDefs), rules };
});
