import { route } from "@/lib/api";
import { listLoads } from "@/lib/importRepo";
import { listCategories } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ loads: await listLoads(), categories: await listCategories() }));
