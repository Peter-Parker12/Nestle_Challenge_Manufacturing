import AssetSetup from "@/components/AssetSetup";
import { setupLists } from "@/lib/assets";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Setup() {
  const user = await getUser();
  const d = await setupLists();
  return (
    <>
      <div className="eyebrow">Setup</div>
      <h1>Plant setup</h1>
      <p className="sub">The structure the seal and line-health modules stand on: lines (shared with launches), equipment, positions and seal types. Everything is retired, never deleted, so history keeps its meaning.</p>
      <AssetSetup role={user.role} lines={d.lines} equipment={d.equipment} partTypes={d.partTypes} />
    </>
  );
}
