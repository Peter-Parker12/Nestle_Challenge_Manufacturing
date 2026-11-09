import { route } from "@/lib/api";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({
  suggestions: await q(
    `select s.id, s.status, s.draft_condition, s.rationale, s.created_at, c.name as category,
       (select coalesce(array_agg(l.code order by l.code), '{}') from core.launch_project l where l.id = any(s.evidence_launch_ids)) as evidence_codes
     from ai.rule_suggestion s join cfg.category c on c.id=s.category_id order by s.created_at desc limit 50`),
}));
