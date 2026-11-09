# AI design

## Division of work

| Done by code (deterministic, tested) | Done by Claude (language and documents) |
|---|---|
| Which past launches are similar | Turning a free-text product description into form fields |
| Recommended values and windows | Explaining a recommendation in plain language |
| Clipping to line capability | Answering questions about past launches, with citations |
| Confidence and risk flags | Reading a trial report (PDF or text) into structured values |
| Run result (Pass, Marginal, Fail) | Proposing candidate expert rules from failure patterns |
| Every approval and audit record | |

**Claude never produces a recommended setting.** If the AI is off or wrong, the recommendation is the same.

## The five features

| Feature | Model setting | Mechanism | Human gate |
|---|---|---|---|
| Parse request | `CLAUDE_MODEL_FAST` | Forced tool call; output validated; unknown fields and out-of-range values dropped with a warning | Form fields are shown for the engineer to check before saving |
| Explain | `CLAUDE_MODEL_MAIN` | Forced tool call over a bounded context package; citations and numbers checked; result cached | Read-only text next to the numbers |
| Ask the history | `CLAUDE_MODEL_MAIN` | Tool loop with four fixed read-only functions, at most 10 rows each, at most 6 rounds | Answer shows which launches it cites; citations not found in the lookups are flagged |
| Extract a report | `CLAUDE_MODEL_MAIN` | PDF sent as a document block; forced tool call with codes restricted to the category's lists; values range-checked | A person must approve; approval goes through the normal results path |
| Suggest rules | `CLAUDE_MODEL_MAIN` | Receives aggregated rework rates by attribute band, not rows | The category owner accepts or rejects each rule |

Model names default to `claude-sonnet-5-5` and `claude-haiku-5-5` and are set by environment variables.

## Custom product fields

Fields defined by category owners flow into the AI features as described in `CUSTOM_FIELDS.md`. The key control is the per-field **Allow Claude to see this field** switch: a field marked "never shared" is excluded from form filling, explanations, history questions and rule suggestions. It defaults to off for free text. Text values are wrapped as data in prompts and capped at 500 characters. When a report is read, Claude may also propose values for these product fields (with source quotes); approval fills only empty fields and never overwrites.

## Guardrails

1. **Schema validation.** Every Claude output is parsed with zod. Invalid output is rejected, logged as invalid, and the user sees a clear message or the standard fallback.
2. **Citation check.** Launch codes in an explanation or answer must exist in the evidence or lookups the model was given. Others are shown as "not found in the records".
3. **Number check.** Numbers in an explanation that do not appear in the data are listed as unverified (small whole numbers ignored).
4. **No free SQL.** Claude calls fixed functions. It never sees the schema or writes a query.
5. **Row and size caps.** 10 rows per lookup, 12,000 characters per tool result, 10 MB per upload, 4,000 characters per description.
6. **Prompt injection.** User text and document text are wrapped in `<data>` or `<document>` tags, and the system prompt says to treat them as content, not instructions. For extraction the output can only be a schema-valid object whose codes are restricted to known lists, so injected text has nowhere to act.
7. **No writes from AI.** An extraction or rule suggestion is a proposal. Nothing reaches the operational tables until a person approves it.
8. **Role checks** still apply to every endpoint.

## Logging

Every call writes a row to `ai.call_log`: purpose, model, prompt hash, the ids of the rows given as context, the response, whether it validated, token counts, latency, user and any error. Uploaded report bytes are not copied into the log; only file name, type and size.

## Without an API key

`GET /api/ai/status` reports `enabled: false`. The engine, workflow and audit work. Explain returns a standard text built from the same numbers. The other four features return `503 ai_unavailable` and the UI explains why.

## Testing without a key

`tests/mock-claude.mjs` imitates the Messages API and returns canned tool calls that include deliberate mistakes (an out-of-range value, an unknown field, a number not in the data, a fake citation). Start the app with `ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:9999` to see the guardrails work. This tests our code paths. It does **not** test the quality of real Claude output.

## Data handling

- Only synthetic data is in this repository. Before any Nestlé data is sent to a hosted model, Nestlé must approve it. This is an open question for the briefing, together with data residency and whether Azure OpenAI or another provider is required.
- The similarity matching and windows run locally. Only the explanation, questions and document reading use a language model.
- The API key is read from the server environment and never sent to the browser.

## Known limitations

- Real-model behaviour is not verified here, only our handling of it.
- Reading scanned or image-only PDFs depends on the model's document support; poor scans may fail validation.
- Explanations are cached per recommendation; "Regenerate" creates a new one.
- No rate limiting per user yet; the SDK retries on rate limits.
