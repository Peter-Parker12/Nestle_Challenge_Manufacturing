# What must change before a real pilot

The demo is built with production-style practices, but it is a demo. This list is what stands between it and use with real Nestlé data.

## Must fix

| Gap | Today | Needed |
|---|---|---|
| **Authentication** | A cookie holds a user id and a switcher lets anyone pick a role | Single sign-on (for example Azure AD). Replace `getUser()` in `lib/auth.ts` with the identity claims and map groups to roles. Set `DEMO_USER_SWITCHER=false`. Until then, keep the site behind Cloudflare Access. |
| **Data approval** | Synthetic data only | Nestlé approval before any real trial data goes into the database or to a hosted model. Confirm data residency and whether Azure OpenAI or another provider is required. |
| **Real data import** | CSV upload with validation, staging and export (see `IMPORT_FORMAT.md`) | A mapping from Nestlé's real source (trial report files, SharePoint, an MES or LIMS extract) into the CSV format. Reading old PDF or Word reports in bulk with Claude is not built; it works one run at a time. |
| **Recommendation validation** | Only tested on synthetic data generated from a similar model | Evaluate on held-out real launches. Agree the success threshold with Nestlé before claiming any benefit. |
| **Secrets and transport** | `.env` file on the server; TLS ends at Cloudflare | Secrets manager or at least restricted file permissions; confirm tunnel configuration |
| **Copilot identity and approval** | One shared service account behind an API key. The audit log shows "Copilot (MCP)", not the person | OAuth with Microsoft Entra ID so each Copilot user acts as themselves with their own role. Nestlé approval for sending launch data to Microsoft Copilot. Test with a real Copilot Studio agent |
| **Backups** | Manual `pg_dump` in the runbook | Scheduled, tested restores, retention policy |

## Should fix

| Gap | Notes |
|---|---|
| Rate limiting and abuse protection | AI endpoints cost money. Add per-user limits. |
| Cross-category matching (BR-10) | Not built. Similarity is within one category. |
| Second approver for Low-confidence plans (BR-04) | The reason is required. A second approver is an open question for Nestlé. |
| Document storage | Uploaded reports are stored in the database. Use object storage with virus scanning. |
| Row-level security by plant or category | Recipes are commercially sensitive. All signed-in roles see all launches today. |
| Concurrency | Two people recommending at once is safe (append-only), but there is no optimistic locking on screens. |
| Observability | Logs go to stdout. Add metrics, error tracking and alerts on health and AI errors. |
| Migrations beyond the first | The runner is forward-only; add a down-migration or restore process. |
| Pagination | Launch list is capped at 200 rows; history queries load all closed launches in a category (fine for hundreds, review at thousands). |
| Accessibility audit | Labels and focus states are present; no formal audit. |
| Vietnamese interface | English only. |
| Admin screens | **Product fields** and **Process setup** (steps, parameters, quality tests, line capability) now have screens. Still SQL or the seed: creating categories and lines, reason codes, users, and moving a parameter between steps. A history file can only use definitions that exist, so set these up before importing. |

## Known limitations of the method

- The similarity method is explainable but simple. With few launches it gives wide windows and Low confidence by design.
- The windows assume past accepted settings are good guides. If past launches were accepted despite poor settings, the recommendation inherits that.
- Weights set by engineers can bias results. The audit trail, the "preview with default weights" and the Critical-count warning reduce but do not remove this.
- A launch's accepted run is its last Pass run. Launches accepted with conditions may need a different rule.

## Open questions for Nestlé

1. Where do trial reports live, how structured are they, and how many exist?
2. Which parameters and quality tests matter per category, and what are the real limits and line capabilities?
3. How is "similar product" judged today?
4. Who approves a starting window, category default weights and expert rules?
5. Baseline numbers: runs per launch, first-pass rate, loss, days to acceptance.
6. Minimum number of similar launches for a usable recommendation.
7. Is a second approver needed for Low-confidence plans?
8. Data classification, residency and permitted model providers.
