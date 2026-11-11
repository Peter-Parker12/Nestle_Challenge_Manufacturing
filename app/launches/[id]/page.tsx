import LaunchView from "@/components/LaunchView";
import LineBanner from "@/components/LineBanner";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  return <><LineBanner launchId={id} /><LaunchView id={id} role={user.role} /></>;
}
