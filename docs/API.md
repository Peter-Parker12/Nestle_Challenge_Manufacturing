# HTTP API

JSON over HTTP, served by the Next.js app on port 9361. The acting user comes from the `baf1_user` cookie (demo stub, see `PRODUCTION_GAPS.md`).

## Errors

All errors return `{ "error": "<code>", "message": "<text>" }`.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_json` | Body is not JSON |
| 403 | `forbidden` | The role may not do this |
| 404 | `not_found` | |
| 409 | `conflict` / `rule_violation` | State does not allow it, or a database business rule refused it |
| 413, 415 | `too_large`, `unsupported` | Uploaded file |
| 422 | `validation` / `constraint` | Input failed validation |
| 429 | `ai_rate_limited` | Claude API rate limit |
| 502 | `ai_invalid`, `ai_error` | Claude output failed validation, or Claude returned an error |
| 503 | `ai_unavailable` | No API key configured |
| 500 | `internal` | Unexpected. Details are only in the server log |

## Endpoints

### General

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/health` | any | `{status, db, ai, engine}`. 503 if the database is unreachable |
| `GET /api/session` | any | Current user, and the user list if the switcher is on |
| `POST /api/session` | any | `{userId}` sets the demo user cookie. 403 if `DEMO_USER_SWITCHER=false` |
| `GET /api/kpis` | any | Dashboard figures |
| `GET /api/audit?limit=` | QA, category owner, plant admin | Audit events |
| `GET /api/categories/{id}/config` | any | Attributes, parameters, tests, default weights, rules |
| `POST /api/categories/{id}/weights` | category owner | `{attributes, parameters, reason}` |

### Launches and recommendations

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/launches` | any | Launch list, categories, lines |
| `POST /api/launches` | R&D, process, plant admin | Create. `{categoryId, lineId, name, attrs, specs, objective?}`. Validates against attribute definitions |
| `GET /api/launches/{id}` | any | Full detail: product, runs, recommendations, evidence, flags, weights |
| `POST /api/launches/{id}/recommend` | R&D, process | Create and store a recommendation |
| `POST /api/launches/{id}/compare` | any | `{attributes, parameters}` proposed weights. Returns current and proposed result, nothing saved |
| `POST /api/launches/{id}/weights` | R&D, process | Save recipe weights. `reason` required |
| `POST /api/launches/{id}/recommendations/{recId}/decision` | R&D, process | `{action: approved|edited|rejected, finalValues?, reason?}`. Creates the next run unless rejected |
| `POST /api/launches/{id}/recommendations/{recId}/explain` | any | `{refresh?}`. Claude explanation, or the standard text without a key |
| `POST /api/launches/{id}/ta` | QA | `{decision: Accepted|Accepted with conditions|Rejected}` |
| `POST /api/launches/{id}/cancel` | R&D, process, plant admin | `{reason}` |

### MCP endpoint (Microsoft Copilot)

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /mcp` (also `/api/mcp`) | `Authorization: Bearer <MCP_API_KEY>` or `x-api-key` | MCP over Streamable HTTP (stateless, JSON). Nine tools; none can approve, decide, enter results or change setup. 503 if `MCP_API_KEY` is not set, 401 for a wrong key, 429 over the rate limit |
| `GET /mcp`, `DELETE /mcp` | same | 405. The server does not stream or keep sessions |

See `COPILOT_MCP.md`.

### Product fields

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/categories/{id}/fields` | any | All fields (Draft, Active, Retired) with coverage of the history, weight and whether each is used for matching |
| `POST /api/categories/{id}/fields` | category owner | Create a field as a Draft. Body: `code, name, type, kind?, unit?, choices?, absMin?, absMax?, required?, helpText?, section?, sortOrder?, aiVisible?, initialWeight?` |
| `PATCH /api/categories/{id}/fields/{fieldId}` | category owner | `{action: update|activate|retire|reactivate, patch?, reason?}`. Retiring needs a reason |
| `GET /api/categories/{id}/fields/backfill-template` | category owner, plant admin | CSV of every product with its current field values |
| `POST /api/categories/{id}/fields/backfill` | category owner, plant admin | Multipart `file`, `dryRun` (default true). Checks, or with `dryRun=false` writes, values for existing products. All or nothing |

See `CUSTOM_FIELDS.md`.

### Process setup

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/categories/{id}/process` | any | Steps, parameters (with runs holding values), quality tests, lines and per-line capability |
| `POST /api/categories/{id}/process` | category owner, plant admin | `{action: addStep \| addParameter \| updateParameter \| setParameterStatus \| setCapability \| addTest \| updateTest \| setTestStatus, …}` |
| `GET /api/categories/{id}/fields/{fieldId}/history` | QA, category owner, plant admin | Definition history of a product field from the audit log |

See `PROCESS_SETUP.md`.

### Historical import

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/import` | any | Previous imports and categories |
| `GET /api/import/template?categoryId=` | any | CSV template for the category |
| `GET /api/import/export?categoryId=` | plant admin, category owner, process | History of the category in the import format |
| `POST /api/import/validate` | plant admin, category owner, process | Multipart `file`, `categoryId`, `assumeAccepted`. Stores the rows in staging and returns counts, errors and warnings by row. Saves nothing operational |
| `POST /api/import/{id}/commit` | same | `{skipInvalid}`. Re-reads the stored rows, validates again, writes launch by launch. 409 `has_errors` if errors remain and `skipInvalid` is false; 409 if already imported |

See `IMPORT_FORMAT.md`.

### Runs

| Method and path | Roles | Purpose |
|---|---|---|
| `POST /api/runs/{id}/start` | process | Planned to Running |
| `POST /api/runs/{id}/results` | process, QA | `{actuals, quality, lossKg?, aborted?, notes?}`. Calculates the result |
| `POST /api/runs/{id}/review` | process, QA | `{reasons[], nextStep: TA|Repeat|Stop, overrideResult?, overrideReason?, comment?}` |

### Claude features

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/ai/status` | any | `{enabled, models}` |
| `POST /api/ai/parse-request` | any | `{text, categoryId}`. Returns attributes, warnings, unparsed facts |
| `POST /api/ai/ask` | any | `{question, categoryId}`. Returns the answer, cited codes, invalid citations |
| `POST /api/ai/extract` | R&D, process | Multipart `file` (PDF or text, up to 10 MB) and `launchId`. Returns the proposed run and problems |
| `POST /api/ai/extractions/{id}/approve` | R&D, process | Creates the run through the normal results path |
| `POST /api/ai/extractions/{id}/reject` | R&D, process | |
| `POST /api/ai/suggest-rules` | category owner | `{categoryId}`. Needs at least 10 closed launches |
| `GET /api/rule-suggestions` | any | List |
| `POST /api/ai/rule-suggestions/{id}` | category owner | `{accept}` |

## Example

```bash
curl -s -X POST http://localhost:9361/api/launches/$ID/recommend -H "cookie: baf1_user=$USER_ID"
# {"id":"…","confidence":"Medium","overallRisk":"High","nMatched":7}
```
