import Chat from "@/components/Chat";
import { aiEnabled } from "@/lib/ai/client";

export const dynamic = "force-dynamic";
export default function Ask() {
  return (
    <>
      <div className="eyebrow">Sales · assistant</div>
      <h1>Ask the radar</h1>
      <p className="sub">Questions that cross price, promo, pack and shelf. Every answer cites the moves and price observations behind it, and a citation that cannot be found is marked in red.</p>
      <Chat enabled={aiEnabled()} />
    </>
  );
}
