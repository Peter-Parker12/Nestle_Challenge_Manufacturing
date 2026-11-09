# Demo script (about 8 minutes)

Before presenting: reseed (`npx tsx scripts/seed.ts --force`), confirm `GET /api/health` shows `db: true`, and, if showing the Claude features, `ai: true`.

## 1. The problem (1 min), dashboard

Open **Dashboard**. Say: new products need trial runs. In the history, 57% of launches pass the first run, a launch takes 1.5 runs on average and loses about 212 kg of material. The tool learns from those past launches. Point out the history figures; the "with a recommendation" box is empty until a launch finishes.

## 2. Start a launch (1 min), New launch

Open **New launch**. If Claude is on, paste: *"New chocolate malt RTD, 200 ml carton, cocoa base, about 2.8% fat, 15.5% solids, viscosity about 38 cP."* and click **Fill the form with Claude**. Show that the engineer still checks every field. (Or open the prepared demo launch **L-1060** from Launches.)

## 3. The recommendation (2 min), as Linh Tran (R&D)

Open the demo launch and click **Generate recommendation**.

- Each parameter has a start value and a window, shown against the line's capability.
- **Risk flags** explain what to be careful about: 4 of 7 similar launches needed rework, the similar launches disagree on homogenisation pressure, and three expert rules fired.
- **Evidence** lists the past launches behind the plan. Click one to open it.
- Open **Weights**: viscosity and fat count most. Change fat to 5, click **Preview the effect** to see the neighbours change, without saving. Add a reason to save. Mention the warning if more than two items are Critical.
- Click **Explain this recommendation**. With a key, Claude writes it from the numbers; unverified numbers and citations not in the evidence are flagged.

## 4. Approve (30 s)

Choose **Approve as is** (or edit a value and show that values outside line capability are refused) and **Record decision and create run**. Mention that nothing is applied automatically, and that a Low-confidence plan would need a written reason.

## 5. Run it (2 min), switch to Minh Nguyen (Process)

- **Start run**, then **Enter results**. Use a bad run first: sediment 0.72, with viscosity 38, creaming 1.2 and pH 6.7. Save: the result is **Fail**, calculated, not typed.
- **Review this run**: try saving without a reason code, which is refused. Pick *Sedimentation*, next step *Repeat with changes*.
- Switch back to R&D, **Recommend again**. It now targets run 2. Approve.
- As the process engineer, enter a good run (viscosity 38.2, sediment 0.28, creaming 1.1, pH 6.7). Result: **Pass**. Review, next step *Send for Technical Acceptance*.

## 6. Acceptance and learning (1 min), switch to Hoa Pham (QA)

Record **Accepted**. The launch is closed and read-only. Open **Dashboard**: the launch now counts under "With a recommendation", with the comparison to history. State clearly that one launch is not evidence.

## 7. Governance (1 min), still as QA

Open **Audit log**: every step with who and why. Mention that the log, decisions and recommendations cannot be edited, even by someone with database access through the application, and that closed launches are read-only.

## Optional extras

- **Ask the history** (needs a key): "Which launches with viscosity above 35 needed rework, and why?" Show the cited launches and open one.
- **Configuration**: show the second category (Sauces) set up with different parameters and no history. Explain that adding a category needs no code change. As the category owner, change a default weight (reason required) and, with a key, **Look for patterns** to get suggested expert rules.
- **Import a trial report** (needs a key): upload a short text or PDF report and approve the extracted run.

- **Product fields** (as the category owner): add a field such as *Pack type* (choice), back-fill values for the existing launches, activate it and set its weight on Configuration. It then appears on the New launch form and in the next recommendation's weights.

## Honest framing to say out loud

- The data is synthetic. The numbers show the method working, not its accuracy.
- Claude explains and reads documents. The recommendation itself is computed by code, so it is repeatable and auditable.
- Single sign-on, cross-category matching and a real accuracy study are the next steps (see `PRODUCTION_GAPS.md`).

## If something goes wrong

| Symptom | Action |
|---|---|
| Demo launch already used | `npx tsx scripts/seed.ts --force` |
| Claude features say unavailable | The server has no `ANTHROPIC_API_KEY`. Everything else still works. |
| Page shows "Could not reach the server" | Check `docker compose ps` and `GET /api/health` |
