# IFF Cargo Pricing Engine — Technical Handover

Postgres (Supabase) + a single-file vanilla JS frontend. No build step, no
framework, no dependencies beyond the Supabase JS client from a CDN.

---

## What the system does

It is **not** a rating engine. It does not predict what a carrier will charge.

The rep obtains a carrier cost the way they always have — booking request,
load board, rate sheet — and enters it. The engine applies a margin policy to
that cost and returns a sell price, plus derived shipment figures and
operational warnings.

The problem being solved is **inconsistency**, not cost estimation. A sample
of ten historical shipments showed markups ranging from 29% to 324% on
comparable work, with the largest shipment carrying the thinnest margin.

---

## Architecture

```
Browser (index.html)                 Postgres (Supabase)
┌──────────────────────┐            ┌────────────────────────────┐
│ Supabase Auth        │──────────▶ │ auth.users                 │
│ line items, lane, UI │            │ profiles (role: rep|admin) │
│                      │            │                            │
│ rpc price_quote() ───┼──────────▶ │ price_quote()   SECURITY   │
│ rpc save_quote()  ───┼──────────▶ │ save_quote()    DEFINER    │
│ rpc update_quote()───┼──────────▶ │ update_quote()             │
│ rpc lane_history()───┼──────────▶ │ lane_history()             │
│                      │            │        │                   │
│ ◀── price + flags ───┼────────────┤        ▼                   │
│     never the rules  │            │ pricing_rules  (RLS: admin)│
└──────────────────────┘            │ quotes         (RLS: own)  │
                                     │ customers     (read all)  │
                                     │ settings                  │
                                     └────────────────────────────┘
```

### The central design constraint

**Reps must never be able to read the margin bands.** This drives everything
else.

`pricing_rules` has RLS enabled with **no policy for the rep role**, so a rep
selecting from it gets zero rows. `price_quote()` is `SECURITY DEFINER`, so it
reads the table on the caller's behalf and returns only the computed price.
The bands never reach the client, so devtools reveals nothing.

Consequence: all pricing arithmetic lives in Postgres, not JavaScript. The
frontend does unit conversion and a local preview of weights and volume, but
every number that matters is computed server-side.

### Why the server re-prices on save

`save_quote()` and `update_quote()` both call `price_quote()` internally rather
than accepting an `engine_sell` from the client. A modified client could
otherwise log a fabricated recommendation, which would make every override
look like agreement and corrupt the calibration data.

---

## Schema

| Table | Purpose | RLS |
|---|---|---|
| `profiles` | name, role (`rep`/`admin`), active flag | own row; admins all |
| `pricing_rules` | versioned bands, adjusters, floors, dim divisor | **admin only** |
| `quotes` | every quote with inputs, derived figures, outcome | own rows; admins all |
| `customers` | account list | read all; write admin only |
| `settings` | key/value; currently the USD→CAD default | read all; write admin |

### pricing_rules

Versioned, never updated in place. `publish_rules()` inserts a new row and
flips `active`. A unique partial index enforces exactly one active version:

```sql
create unique index pricing_rules_one_active
  on pricing_rules ((active)) where active;
```

Every quote stores `rules_version`, so any historical price is reproducible.
This matters when a customer queries an invoice from six months ago.

`bands` is jsonb: `[{"max":40,"mk":175}, ...]` ascending by `max`, the last
row with a very large ceiling. Lookup takes the first band whose ceiling the
cost fits under.

### quotes

Notable columns:

- `markup_pct` — **generated column**, `(final_sell / cost - 1) * 100`. Cannot
  drift from its inputs.
- `cost_cad` — the CAD equivalent. Calibration groups on this so USD and CAD
  shipments land in the same bands.
- `origin_zone` / `dest_zone` — **generated**, first 3 chars of the postal
  code, uppercased and stripped. Full postal codes are stored; zones are what
  the reports group on, because a full Canadian postal code often covers one
  side of one street and would give every lane a sample size of one.
- `voided` — soft delete. Excluded from calibration and all reports, row
  retained. There is no hard delete policy for any role.
- `reason` — enum. **`contract` and `oneoff` are excluded from calibration
  medians.** This is the guard that stops negotiated accounts dragging the
  standard rate down.

Two check constraints worth knowing:

```sql
-- packaging must match mode
(mode = 'ltl' and packaging = 'Skid') or
(mode = 'lcl' and packaging = 'LCL')  or
(mode = 'courier' and packaging in ('Envelope','Package'))

-- a reason is mandatory on any override
abs(final_sell - engine_sell) < 0.01 or reason is not null
```

The second is enforced in the database, not the UI, deliberately.

---

## Pricing logic (`price_quote`)

```
1. Resolve FX          USD cost → CAD via settings.usd_cad or a per-quote override
2. Per-line loop       actual weight, cubic inches, volumetric weight
3. Chargeable weight   mode-dependent (see below)
4. Band lookup         on cost_cad, not face value
5. Adjusters           scope, low density, multi-piece — added as percentage points
6. sell = cost_cad × (1 + (band + adj)/100)
7. Floors              max(packaging minimum, cost + min_gross_margin)
8. Currency            convert back if quoting USD
9. Round up            to the configured increment
10. Flags              operational warnings, safe to expose
```

### Chargeable weight differs by mode

This is the part most likely to be got wrong by someone modifying the code.

- **Courier** — volumetric weight per piece, `(L×W×H)/divisor`, billed as the
  greater of actual and volumetric, **summed across pieces**. Splitting one
  bulky box into two often helps; splitting a heavy one does not.
- **LTL** — chargeable weight is the **scale weight**. There is no volumetric
  substitution. Density (`lb/ft³`) drives the NMFC freight class, which drives
  the rate. An earlier version applied the courier divisor here and produced
  1,864 lb for a 900 lb shipment.
- **LCL** — charged on **W/M**, the greater of cubic metres and metric tonnes.
  `chargeable_wt` holds revenue tons. LCL is forced to `scope = intl` and
  skips the density and multi-piece adjusters, since its cost already
  reflects volume.

### Flags

Returned as a text array alongside the price. Dim weight governing, density
near a class boundary, cubic capacity thresholds, sub-1-CBM minimums,
multi-piece confirmation, floor applied, currency conversion. These are most
of the day-to-day value and are deliberately safe to show a rep — they
describe the shipment, not the rules.

---

## Calibration

`calibration_report(months, min_n, cap)` — admin only, enforced inside the
function via `is_admin()`.

Per band it returns count, median markup, P25, P75, spread, **distinct rep
count**, and a proposed markup. Guards:

- minimum sample (default 30) or the band does not move
- movement capped at ±10 points per cycle
- `single rep - review before applying` when one person supplies all the
  observations — that is one person's habit, not a house rate
- `ready, but spread is wide` when IQR exceeds 60 points

It **proposes only**. `publish_rules()` is a separate call. In the UI the
proposals load into the rules editor for review alongside adjusters and
floors before anything is published.

Excluded from every median: voided quotes, `contract`, `oneoff`.

---

## Frontend (`index.html`)

Single file, no build step. Config is two constants at the top:

```javascript
const SUPABASE_URL  = 'https://xxxx.supabase.co';
const SUPABASE_ANON = 'eyJ...';
```

The anon key is public by design; RLS is the access control.

Structure: login → role check against `profiles` → tabbed views. `rep` sees
New quote and My quotes; `admin` additionally sees Admin and Customers. The
tab visibility is presentation only — the database enforces the real
boundary.

Points a developer should know before editing:

- **Line item inputs store raw strings** and are parsed only at calculation
  time. The table markup is built once; recalculation repaints only the
  computed column. Rebuilding rows on every keystroke destroys focus and
  corrupts partially-typed decimals (`0.5` parsed as `0` after the first
  character).
- **Units convert independently.** Dimensions in/cm and weight lb/kg are
  separate toggles; `impLines()` always emits inches and pounds for the
  server.
- **Wheel events on number inputs are blocked** — `preventDefault` plus blur,
  delegated so it covers dynamically created rows.
- **Pagination is server-side**, `.range(from, to)` with `{count:'exact'}`.
  Summary figures are queried separately so they cover the whole set, not the
  visible page.
- **`profiles` is referenced twice from `quotes`** (`rep_id`, `voided_by`), so
  embeds must name the FK: `profiles!quotes_rep_id_fkey(full_name)`.

---

## Files, in execution order

A fresh install runs these in sequence. 7a **must** run alone — Postgres will
not let a new enum value be added and used in the same transaction.

| # | File | Adds |
|---|---|---|
| 1 | `iff-pricing-schema.sql` | tables, RLS, `price_quote`, `save_quote`, calibration, views |
| 2 | `fix-price-quote.sql` | `array_append` for flags (`text[] \|\| text` is ambiguous) |
| 3 | `fix-2-ltl.sql` | LTL chargeable weight; cubic capacity flags |
| 4 | `fix-3-calibration.sql` | cast `percentile_cont` to numeric before `round(_, int)` |
| 5 | `migration-4-customers.sql` | customers table, `customer_id` on quotes |
| 6 | `migration-5-void-customers.sql` | voiding; customers become admin-managed |
| 7 | `migration-6-publish-divisor.sql` | `publish_rules` takes the dim divisor; band validation |
| 8 | `migration-7a-enums.sql` | **run alone** — `lcl` mode, `LCL` packaging |
| 9 | `migration-7b-lcl-currency.sql` | LCL pricing, USD handling, `settings` |
| 10 | `migration-8-dual-currency.sql` | returns the price in both currencies |
| 11 | `migration-9-edit-quotes.sql` | `update_quote`, edit tracking |
| 12 | `migration-10-lanes.sql` | lane capture, derived zones, `lane_history`, `lane_summary` |

Files 2–4 are bug fixes against file 1 rather than feature migrations. Worth
folding into a consolidated baseline if the developer sets up proper
migration tooling.

`index.html` — the application.
`DEPLOYMENT-GUIDE.md` — setup written for a non-developer.

---

## Known gaps

Listed honestly, since these are the first questions a developer will ask.

- **No migration tooling.** Files were applied by hand in the SQL editor. A
  fresh environment means running all twelve in order. Worth consolidating
  into a baseline plus proper migrations.
- **No tests.** Four of the twelve files exist because a type error only
  surfaced when a code path first executed.
- **The bands are not calibrated.** Current values were fitted to ten
  historical rows and are placeholders. They need replacing from real volume
  before they mean anything.
- **No time limit on quote editing.** A rep can amend a quote from any date,
  which means amending calibration data retroactively. `edit_count` and
  `edited_at` are recorded but nothing is enforced. A 7-day window with admin
  override would be a small policy change.
- **No outcome tracking.** `outcome` (`pending`/`won`/`lost`) and
  `actual_cost` exist on the table but nothing populates them. Filling
  `actual_cost` from carrier invoices would enable the `margin_realization`
  view, which is where reweighs and accessorials show up as margin leakage.
  This is probably the highest-value addition.
- **Lane data starts empty.** Only quotes saved after migration 10 carry lane
  information.
- **Rounding.** Dual-currency figures round up independently, so the CAD and
  USD prices are not exactly equivalent to the cent.

---

## Possible next steps

1. **Populate `actual_cost`** — enables realized-margin reporting. Higher
   value than anything else on this list.
2. **Carrier rate tables** — for courier and LTL, cost is a published tariff
   times a contracted discount plus fuel. Loading those gives exact costs for
   every lane immediately, which is a better route to quoting without a
   carrier quote than predicting cost from history.
3. **Consolidated baseline schema** plus real migration tooling.
4. **Accessorials as line items** — currently quoted separately by hand;
   residential, DAS, tailgate and waiting time are where courier margin
   leaks.
