# Market Move Radar: end-to-end flow

One day in the life of the radar, from raw prices to a decision a person owns. Each step says who or what acts, what is stored, and what rule protects it.

```
 FEEDS            DETECT           SIZE             RESPOND            DECIDE            LEARN
 prices, promos   robust compare   exposure and     4 scenarios        a person          history kept,
 packs, stock,    with each        elasticity       with ranges        accepts, defers   brief, chat,
 shelf photos,    retailer's own   from sales       and risks          or rejects        backtest
 Nestlé sales     history
```

## 0. Before the first day (setup, once)
| Who | Does | Stored |
|---|---|---|
| Category manager | Confirms products, which competitor product each Nestlé product competes with, retailers per channel | `mkt.sku`, `mkt.retailer` |
| Category manager / Finance | Confirms assumptions: gross margin, how much of a price gap moves demand, thresholds | `cfg.setting` (each change needs a reason, audited) |
| IT / Nestlé data owner | Connects the feeds (see Data below) | `mkt.feed_status` |

## 1. Collect (every day, 06:00)
| Input | Source | Format | Becomes |
|---|---|---|---|
| eCom prices and promos | Marketplace listings (public) or a vendor feed | price, promo price, promo text, in stock, pack size | `mkt.observation` (source feed) |
| Modern trade prices | Chain price lists or a retailer-audit file | price, pack size, facings | `mkt.observation` (source price_list) |
| General trade shelf | Field rep photos (step 2) and a weekly audit | photo, or price per store | `mkt.observation` (source shelf_photo or feed) |
| Nestlé sales | Sales extract (weekly, per product and channel) | units, revenue | `mkt.sales_weekly` |
In the demo these come from a synthetic collector. A real feed is another collector behind the same interface; nothing downstream changes. Price and sales history is append-only: a correction is a new row.

## 2. Read shelf photos (any time, field rep)
1. Rep uploads a photo, or generates a mock one for the demo. It is stored with its SHA-256 and cannot be changed.
2. Claude reads each price tag and the number of facings and returns the product, price, confidence and a note. A covered or blurred tag returns no price; it is never guessed.
3. Code checks the reading: a price far from that product's usual range is held for checking whatever the confidence.
4. A person confirms, corrects (with a reason) or marks unreadable. Confirm and correct add an observation; the AI value stays beside it and cannot be overwritten. Unreadable adds nothing.

## 3. Detect (06:05, or "Refresh now")
For each competitor product and channel the engine compares every retailer's price with that retailer's own last 8 weeks (median and median absolute deviation). It reports a move only when the typical retailer moved enough (default 3%) and it is statistically unusual (default 3 deviations).
Move types: price cut, price rise, promo (price after voucher), pack change, shelf gap, and out of stock on our own product (3 or more retailers).
A move already known in the last 7 days is not created again.

## 4. Size
Exposure = Nestlé weekly revenue at that product and channel × share of demand that moves (diversion rate) × |price elasticity| × size of the move × share of retailers showing it. The range comes from the elasticity interval. Elasticity is estimated from 52 weeks of Nestlé sales (log-log regression with a trend). When the data cannot support an estimate (too few weeks, no price variation) the engine says so and uses the default. Level: High, Medium or Low by exposure thresholds in Settings; a price rise is always Low (an opportunity).

## 5. Respond (scenarios)
For each move the engine builds scenarios with volume change and margin change per week, each with a range, cost, risk, confidence and the assumptions used:
- A Hold · B Targeted promo · C Match price · D Shelf action (out of stock: Hold and Expedite restock; price rise: Hold and watch).
Claude never produces these numbers.

## 6. Brief (06:10)
Claude writes a short brief (English or Vietnamese) from the engine's numbers. Every `[M:move]` and `[O:observation]` citation is checked against what it was given; unverifiable ones are stored and shown in red. With no API key a standard template brief is written. Briefs are kept, never edited.

## 7. Decide (a person, same day)
| Step | Rule |
|---|---|
| Sales lead or category manager opens the move, reads the chart, evidence and scenarios | Everyone can read |
| Picks one scenario and accepts, defers or rejects | Reject or defer needs a reason; defer needs a future date |
| Price match (C) | Only a category manager can accept it (database rule) |
| The decision is saved with name, time and reason | Cannot be edited or deleted; a later decision replaces it for the radar and the history is kept |
The radar changes nothing in any system. The response (promo, price, restock, display) is carried out by people.

## 8. Ask and follow up
"Ask the radar" answers questions in English or Vietnamese using read-only tools (moves, price history, products), cites moves and observations, and flags any citation it cannot verify. It cannot decide or change anything.

## 9. Check that it works (backtest, setup page)
Replays the planted events in the sample data and shows when the detector first flags each. On synthetic data this checks the code, not the real market. Run it on real history before trusting the thresholds.

## Roles at a glance
| Role | Can |
|---|---|
| Sales lead | Read, refresh, write the brief, decide (not price match), check readings, upload photos |
| Category manager | All of the above plus price match, change settings |
| Field rep | Upload photos, check readings |
| Analyst | Refresh, brief, upload, check readings |
| Admin | Settings, audit, upload |
| Viewer | Read only, ask the radar |

## What a real pilot still needs
1. A real price feed and a sales extract from Nestlé, and Nestlé's confirmation of the diversion rate and gross margin.
2. Confirmed competitor-product pairs and retailer lists per channel.
3. Real shelf photos to test Claude's reading, and a rule for how many are checked.
4. A backtest on real history, and agreed thresholds per category.
5. Sign-in through Nestlé's identity provider and delivery of the brief to Teams or email.
