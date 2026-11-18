import { route } from "@/lib/api";
import { getPhoto } from "@/lib/radar";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>(async (_req, { id }) => getPhoto(id));
