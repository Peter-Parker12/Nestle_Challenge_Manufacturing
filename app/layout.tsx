import "./globals.css";
import Nav from "@/components/Nav";
import { getUser } from "@/lib/auth";
import { listUsers } from "@/lib/repo";

export const metadata = {
  title: "Line Intelligence | Workforce Solution",
  description: "One platform for launches, seals and line health (BAF-1, BAF-2, DNF-2). A Workforce Solution demo for the Nestlé Vietnam AI Reinvention programme",
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
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&family=Poppins:wght@400;500;600&display=swap" />
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
