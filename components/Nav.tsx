"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

type U = { id: string; name: string; role: string };

type Item = { href: string; label: string };
const groups: { title: string; tag?: string; items: Item[]; soon?: { label: string; phase: string }[] }[] = [
  { title: "Plant", items: [{ href: "/", label: "Overview" }] },
  {
    title: "Launch", tag: "BAF-1",
    items: [{ href: "/launches", label: "Launches" }, { href: "/launches/new", label: "New launch" }, { href: "/ask", label: "Ask the history" }],
  },
  {
    title: "Seals & gaskets", tag: "BAF-2",
    items: [{ href: "/risk", label: "Risk and alerts" }, { href: "/assets", label: "Plant map" }, { href: "/assets/parts", label: "Seal register" }, { href: "/assets/stops", label: "Planned stops" }],
  },
  { title: "Line health", tag: "DNF-2", items: [{ href: "/line-health", label: "Filler health" }, { href: "/line-health/guides", label: "Troubleshooting guides" }] },
  {
    title: "Setup",
    items: [
      { href: "/assets/setup", label: "Plant setup" },
      { href: "/config/fields", label: "Product fields" },
      { href: "/config/process", label: "Process setup" },
      { href: "/config", label: "Weights and rules" },
      { href: "/import", label: "Import launch history" },
      { href: "/assets/import", label: "Import seal history" },
      { href: "/audit", label: "Audit log" },
    ],
  },
];
const links = groups.flatMap((g) => g.items);

export default function Nav({ user, users, switcher }: { user: U; users: U[]; switcher: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path === href || (path.startsWith(href + "/") && !links.some((l) => l.href !== href && l.href.startsWith(href + "/") && path.startsWith(l.href))));

  async function switchTo(id: string) {
    setBusy(true);
    await api("/api/session", { body: { userId: id } });
    setBusy(false);
    router.refresh();
  }
  return (
    <aside className="side">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src="/brand/logo-white.png" alt="Workforce Solution" width={148} height={62} />
      <div className="brand">Line Intelligence</div>
      <div className="brand-sub">One platform for launches, seals and line health · Nestlé Vietnam AI Reinvention</div>
      <nav className="nav" aria-label="Main">
        {groups.map((g) => (
          <div key={g.title} className="ng">
            <div className="nh">{g.title}{g.tag && <span>{g.tag}</span>}</div>
            {g.items.map((l) => (
              <Link key={l.href} href={l.href} className={active(l.href) ? "on" : ""} aria-current={active(l.href) ? "page" : undefined}>{l.label}</Link>
            ))}
            {g.soon?.map((l) => (
              <span key={l.label} className="soon">{l.label}<em>{l.phase}</em></span>
            ))}
          </div>
        ))}
      </nav>
      <div className="who">
        <label htmlFor="who">Signed in as</label>
        {switcher ? (
          <select id="who" value={user.id} disabled={busy} onChange={(e) => switchTo(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        ) : (
          <div>{user.name}</div>
        )}
        <div className="small muted" style={{ marginTop: 6 }}>Role: {user.role.replace("_", " ")}</div>
        {switcher && <div className="small muted" style={{ marginTop: 6 }}>Demo role switcher. In production this is replaced by single sign-on.</div>}
      </div>
    </aside>
  );
}
