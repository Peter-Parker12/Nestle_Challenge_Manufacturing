"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

type U = { id: string; name: string; role: string };

const links = [
  { href: "/", label: "Dashboard", sub: "KPIs and open launches" },
  { href: "/launches", label: "Launches", sub: "All product launches" },
  { href: "/launches/new", label: "New launch", sub: "Start a trial plan" },
  { href: "/import", label: "Import history", sub: "Upload previous runs" },
  { href: "/ask", label: "Ask the history", sub: "Questions with citations" },
  { href: "/config", label: "Configuration", sub: "Weights and expert rules" },
  { href: "/config/fields", label: "Product fields", sub: "Custom fields per category" },
  { href: "/config/process", label: "Process setup", sub: "Parameters, tests, line limits" },
  { href: "/audit", label: "Audit log", sub: "Every change, who and why" },
];

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
      <div className="brand">Launch Accelerator</div>
      <div className="brand-sub">BAF-1 · prepared for the Nestlé Vietnam AI Reinvention programme</div>
      <nav className="nav" aria-label="Main">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={active(l.href) ? "on" : ""}>
            {l.label}
            <small>{l.sub}</small>
          </Link>
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
