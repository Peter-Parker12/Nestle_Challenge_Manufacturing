# Process setup

**Process setup** (left menu) lets category owners and plant admins manage what trial runs record for a category: process steps, parameters (the settings used in a run), quality tests, and what each line can run. Product fields have their own screen (`CUSTOM_FIELDS.md`).

## What can be set

| Item | Fields |
|---|---|
| Process step | Name. Steps are numbered in the order they were added |
| Parameter | Step, name, code, unit, lowest and highest allowed value, **critical**, **locked limits**, help text |
| Line capability | For each active parameter and each line, the range that line can run. Always inside the parameter's allowed range |
| Quality test | Name, code, unit (optional), **critical** (a result out of spec fails the run), help text |

Targets (minimum and maximum) for a quality test are set per product on the New launch form, as before.

## Rules

| Rule | Enforced in |
|---|---|
| Only category owners and plant admins change the setup | App role check (`manageProcess`) |
| Parameters and tests are retired (with a reason), never deleted | App, and database trigger |
| A parameter code is unique across the whole category (files identify parameters by code) | App |
| Code and unit are fixed once runs reference the parameter or test | Database trigger |
| Once runs have values, the allowed range can be widened but not narrowed | App |
| A line's capability must stay inside the allowed range, with lowest not above highest | App, and database check constraint |
| A new parameter gives every line its full range; the plant admin narrows it per line | App |
| Retired items leave forms, templates, imports, exports and recommendations; past values are kept; they can be reactivated | App |
| Every change is audited with the user and reason | Database audit triggers |

## What a new parameter or test means for recommendations

Past runs have no value for something added later. The recommendation then:
- gives the new parameter a window in the **middle of the line's capability** (clipped to it), and
- raises a **missing data** flag: "No similar launch recorded X, so its window is only the middle of the line capability. Treat it as a starting guess."

As runs record the parameter, history builds and the flag disappears. Quality tests do not feed the recommendation directly; a new critical test simply starts deciding pass or fail for new runs that record it. Older products have no target for it, which is fine.

Past runs cannot be back-filled with a new parameter through the screen. To bring older runs in, re-import them with the new column (history import is one row per run).

## Import and export

The import template, the history export and the run entry forms follow the active parameters and tests. Retiring one removes its column.

## Tests

Unit (5), end to end through the API (9: permissions, validation, capability limits, the no-history flag, edit restrictions, a critical test failing a run, retirement and reactivation, audit), database rules (deleting, changing the code or unit of an item with data, bad ranges and capabilities are refused in SQL), and a real-browser run of the screen with no console errors.

## Not built

- Moving a parameter to another step, or reordering steps.
- Per-product-type overrides of limits.
- Copying a whole setup from one category to another.
- Creating categories and lines on screen (still SQL or the seed).
