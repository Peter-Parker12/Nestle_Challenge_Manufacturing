# Custom product fields

Category owners can add fields that describe a product, for example pack type, supplier or an organic flag. The screen is **Product fields** in the left menu.

## Two kinds of field

| Kind | Effect | Types |
|---|---|---|
| **Affects matching** | Helps decide which past launches count as similar, so it can change a recommendation | Number, choice, yes/no |
| **Information only** | Stored, shown, exported and imported. Never changes a recommendation | Any type. **Text and date fields are always information only** |

Fields belong to a **category**, not to a single product, so every product in the category can be compared on them.

## Types

| Type | Input | Rules |
|---|---|---|
| Number | Number box | Needs a lowest and highest allowed value. Optional unit |
| Choice | Drop-down | At least two and at most 30 options |
| Yes / no | Drop-down (Not set, Yes, No) | Files accept yes, no, true, false, y, n, 1, 0 |
| Text | Text area | Up to 500 characters |
| Date | Date picker | `YYYY-MM-DD` |

Every field also has: a name, a code (lowercase letters, digits and underscores, used in files), optional help text, an optional section heading on the form, an order, whether it is required, and whether Claude may see it.

## Lifecycle

```
Draft ──activate──> Active ──retire (reason)──> Retired ──reactivate──> Active
```

- **Draft:** saved but not on any form, import template or matching. Use this time to fill in values for existing launches.
- **Active:** appears on the New launch form, in templates and exports, and (if it affects matching and has enough data) in matching.
- **Retired:** hidden from forms and matching. Stored values are kept. Fields are **never deleted**.

## Rules

| Rule | Enforced in |
|---|---|
| Only the category owner adds, edits, activates or retires fields | App role check (`manageFields`) |
| Code and type cannot change once any product has a value | Database trigger |
| Fields cannot be deleted | Database trigger |
| Text and date fields cannot affect matching | Database check constraint and app |
| Text values are at most 500 characters | Database check constraint and app |
| Choice options can be added, not removed or renamed, once values exist | App |
| A numeric range can be widened, not narrowed, once values exist. The unit cannot change | App |
| Retiring needs a reason | App |
| A new matching field starts at **weight 0** (ignored) | App, stored as a new category weight set |
| Every change to a field and every stored value is audited | Database audit triggers |

## Matching and missing values

Past launches will not have a value for a field that was just added. Two things protect the recommendations:

1. **A matching field is used only when enough history has a value.** The default is 30% of the accepted launches (`MIN_FIELD_COVERAGE`). Below that, the field is left out of the comparison and the recommendation lists it as "not used for matching yet". The Product fields screen shows each field's coverage and whether it is currently in use.
2. **A missing value never makes a launch look closer.** Only fields that both products have are compared, and the weights are rescaled over those fields. Each neighbour records its **coverage** (the share of the weighted fields that could be compared) and its similarity is reduced when coverage is low.

If the matches rest on fewer fields than usual, the recommendation shows a "missing data" flag, and confidence cannot be High (average coverage below 70%) or is Low (below 40%). If the target product has no value for a field that carries weight, that is flagged too.

Note: this also fixes an earlier weakness. Before custom fields, a launch lacking an optional value such as pH looked slightly closer than it should. That no longer happens.

## Filling in existing launches (back-fill)

The back-fill card on the Product fields page writes values onto existing launches.

1. Download the list. It contains every product in the category, with its current values.
2. Fill in the new field's column (`attr_<code>`).
3. **Check the file.** Nothing is saved. You see how many values are new, changed or unchanged, and every error by row.
4. **Save.** All or nothing: any error blocks the whole file.

Only filled cells are written. Empty cells never clear a value. Run data is not touched, so closed launches keep their runs and results. The change is audited with the user and the reason "Product field back-fill".

## Forms, import and export

- The New launch form is built from the active fields, grouped by section, with a type-appropriate input and the help text.
- The import template, the history export and the back-fill list all get an `attr_<code>` column per active field. The import rules in `IMPORT_FORMAT.md` apply to each type.
- The weights panels on a launch and on Configuration list matching fields only.

## How the AI handles custom fields

| Feature | Behaviour |
|---|---|
| Fill the form from a description | The schema Claude fills is built from the active fields, with their types, units, options and help text. It fills only what the text states. Values are validated by the same rules as the form |
| Explain a recommendation | Receives attributes used for matching and, separately, information fields. It is told information fields did not influence the result |
| Ask the history | The lookups know the category's fields (including a "contains" filter for text). Results are capped as before |
| Suggest expert rules | Considers numeric matching fields only |
| Read a trial report | Claude may also propose product field values it finds in the report, each with a source quote. A person approves them. Approval fills **only fields that are still empty** and only values that pass the field's own rules. A different value in the report is shown as a problem and never overwrites what is stored. Private fields are not offered |

**Allow Claude to see this field.** Each field has this switch. A field marked "never shared" is left out of every prompt: its name and values are not sent in form filling, explanations, history questions or rule suggestions. It defaults to **off for text fields** (free text can hold confidential or personal details) and on for the other types. The call log records which rows each call was given.

## History and reproducibility

- **History:** each field has a History button (for roles that can view the audit log) listing every change: when, who, why, and old value to new value.
- **Snapshot:** every recommendation stores the product values it saw, which fields were used or left out, the parameter limits and line capability in force, and the thresholds (`MIN_FIELD_COVERAGE`, top N, minimum matches). A recommendation can therefore be explained later even if fields or limits change afterwards.

## Not built

- Custom process parameters and quality tests are in a separate screen: see `PROCESS_SETUP.md`.
- A separate version number on field definitions. Instead, every change to a definition is in the audit log and shown as **History** on the Product fields screen, and each recommendation stores a snapshot of the fields, values and thresholds it used (see below).
- A "contains" operator for expert rules on text fields (text is information only).
- Field definitions are per category. There is no copy of a field set from one category to another.

## Tests

- Unit: distance with missing values, coverage, ignored sparse fields, boolean matching, information fields, field validation, value parsing (15 tests).
- End to end through the API (10 tests): permissions, validation, back-fill check and apply, activation, weights, the sparse-field flag, text and AI-visible defaults, edit restrictions, retirement, audit.
- Database: deleting a field, changing the type of a field with values, a text field set to matching, an over-long text value and an empty value row are all refused when attempted directly in SQL.
- Browser: the whole owner flow was run in a real browser (add, back-fill, impact check, activate, the field appearing on R&D's form, read-only for non-owners), with no console errors.
