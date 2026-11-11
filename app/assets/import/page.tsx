import AssetImport from "@/components/AssetImport";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImportAssets() {
  const user = await getUser();
  return (
    <>
      <div className="eyebrow">Setup</div>
      <h1>Import seal history</h1>
      <p className="sub">Load the equipment, positions and seal history you already keep in spreadsheets, so the platform starts with real history. The file is checked first and nothing is saved until you load it. Launch history has its own import under Setup.</p>
      <AssetImport role={user.role} />
    </>
  );
}
