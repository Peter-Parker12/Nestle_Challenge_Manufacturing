import HeyFiller from "@/components/HeyFiller";
import LineTable from "@/components/LineTable";
import { aiEnabled } from "@/lib/ai/client";
import { plantStatus } from "@/lib/plant";

export const dynamic = "force-dynamic";

const PROMPTS = [
  "Is it a good time to run a trial on L1?",
  "Which line should I worry about most this week, and why?",
  "Tuần này dây chuyền nào cần chú ý nhất và vì sao?",
];

export default async function Plant() {
  const { lines, asOf } = await plantStatus();
  return (
    <>
      <div className="eyebrow">Plant · all modules</div>
      <h1>Ask the plant</h1>
      <p className="sub">One view of each line across launches, seals and gaskets, and filler health, and one assistant that can answer questions across all three. It reads; it cannot approve, schedule or change anything. Status as of {asOf}.</p>
      <div className="card" style={{ marginBottom: 14 }}><h2>Lines</h2><LineTable lines={lines} /></div>
      <HeyFiller enabled={aiEnabled()} endpoint="/api/plant/chat" title="Ask the plant" prompts={PROMPTS} placeholder="Ask about a line, a seal or a launch…"
        intro="Ask across launches, seals and the filler, in English or Vietnamese. Answers use only data in this system and cite launches [L], seals [P], alarms [A] and guides [G]; citations that cannot be found are marked." />
    </>
  );
}
