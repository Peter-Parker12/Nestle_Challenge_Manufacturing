import Backtest from "@/components/Backtest";
import SettingsForm from "@/components/SettingsForm";
import { getUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettingRows, overview, setupLists } from "@/lib/radar";
import { ENGINE_VERSION } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export default async function Setup() {
  const user = await getUser();
  const [settings, lists, o] = await Promise.all([getSettingRows(), setupLists(), overview()]);
  return (
    <>
      <div className="eyebrow">Setup</div>
      <h1>Settings and data</h1>
      <p className="sub">What counts as a move, and the business assumptions behind the scenarios. Every change needs a reason and is audited. Engine version <span className="mono">{ENGINE_VERSION}</span>.</p>
      <section className="card"><h2>Thresholds and assumptions</h2><SettingsForm settings={settings as any} canEdit={can(user.role, "manageSettings")} /></section>
      <section className="card"><h2>Backtest</h2><p className="small muted">Replays the planted events in the sample data and shows when the detector first flags each one. It checks that the detector works; it says nothing about the real market until it is run on real history.</p><Backtest /></section>
      <section className="card">
        <h2>Data feeds</h2>
        <div className="tw"><table>
          <thead><tr><th>Feed</th><th>Kind</th><th>Last run</th><th>Rows</th><th>Source</th></tr></thead>
          <tbody>{o.feeds.map((f: any) => <tr key={f.name}><td>{f.name}</td><td>{f.kind}</td><td>{f.last_run ? String(f.last_run).slice(0, 16).replace("T", " ") : "never"}</td><td>{f.rows_added}</td><td>{f.note}</td></tr>)}</tbody>
        </table></div>
        <div className="small muted">Feeds are collectors behind one interface. The demo uses a synthetic collector; a real feed (eCom listings, price lists, a sales extract) plugs in without changing the rest.</div>
      </section>
      <div className="grid g2">
        <section className="card"><h2>Products</h2><div className="tw"><table><thead><tr><th>Code</th><th>Product</th><th>Brand</th><th>Competes with</th></tr></thead><tbody>{lists.skus.map((s: any) => <tr key={s.id}><td className="mono">{s.code}</td><td>{s.name}</td><td>{s.brand}</td><td>{s.vs ?? "–"}</td></tr>)}</tbody></table></div></section>
        <section className="card"><h2>Retailers</h2><div className="tw"><table><thead><tr><th>Code</th><th>Name</th><th>Channel</th></tr></thead><tbody>{lists.retailers.map((r: any) => <tr key={r.id}><td className="mono">{r.code}</td><td>{r.name}</td><td>{r.channel_code}</td></tr>)}</tbody></table></div></section>
      </div>
    </>
  );
}
