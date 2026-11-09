import "./globals.css";
import Nav from "@/components/Nav";
import { getUser } from "@/lib/auth";
import { listUsers } from "@/lib/repo";

export const metadata = {
  title: "Launch Accelerator",
  description: "BAF-1: AI new product launch accelerator (Nestlé Vietnam AI Reinvention demo)",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const switcher = process.env.DEMO_USER_SWITCHER !== "false";
  const users = switcher ? ((await listUsers()) as any[]) : [];
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
      </head>
      <body>
        <div className="shell">
          <Nav user={user} users={users} switcher={switcher} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
