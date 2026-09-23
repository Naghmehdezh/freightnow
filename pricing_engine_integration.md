# Pricing Engine Integration

Ports the margin-calculation logic from the standalone "Pricing Engine" reference the user
provided (`Pricing Engine/files/` — a Postgres/Supabase system, never deployed as such) into
freightnow's own Node/Mongoose backend, replacing the old flat percentage-tier markup. Applied
to the automated carrier-rate path (envelope/parcel/LTL); FTL/air/ocean's manually-staff-priced
spot-rate flow is untouched. Full design rationale lives in
`.claude/plans/ethereal-squishing-cascade.md`; this file is the changelog plus a plain
explanation of how the pricing logic actually works.

**Status:** complete and verified — `backend/src/scripts/pricingEngineTestCases.js` (10/10
checks) confirms the calculation, the admin publish/versioning flow, and the database-level
"only one active rule set" guarantee all work correctly. No UI changes were made or needed —
see "What didn't change" below.

---

## 1. What changed

### New files

- **`backend/src/models/PricingRuleSet.js`** — replaces `MarkupRule.js`. One document = one
  complete, versioned pricing policy (bands, adjusters, floors, dim divisor, USD→CAD rate)
  rather than six flat per-band rows. A partial unique index on `{active: true}` makes MongoDB
  itself enforce "exactly one active version at a time."
- **`backend/src/services/pricingEngine.service.js`** — the ported calculation itself
  (`priceQuote()`). Pure function, no database access — see section 2 below for how it works.
- **`backend/src/services/pricingRules.service.js`** — `getActiveRuleSet()` and
  `publishRuleSet()`, replacing the old (never-wired-up) `updateMarkupTier`. Publishing
  validates that bands are present and strictly ascending, then atomically retires the old
  version and activates the new one.
- **`backend/src/routes/pricingRules.routes.js`** — `GET /api/pricing-rules/active` and
  `POST /api/pricing-rules`, both gated `requireRole(ROLES.IFF_ADMIN)` — admin-only, per the
  explicit ask, not opened to `iff_staff`.
- **`backend/src/utils/shipmentScope.js`** — a single shared `detectScope()` helper
  (domestic/cross-border/international), replacing the fact that this concept previously existed
  three times under three different names (`isCrossBorder`, `isIntl`, `isInternational`) spread
  across different carrier adapters, never reaching the pricing layer.
- **`backend/src/scripts/pricingEngineTestCases.js`** — a permanent, reusable verification
  script (same convention as the existing `dayrossTestCases.js`/`fedexRateTestCase.js`), runs
  directly against the database with no HTTP server or login required.

### Modified files

- **`backend/src/services/rate.service.js`** — `getAllRates`/`getSingleCarrierRate` now fetch
  the active rule set once per request, detect scope, map `shipmentType` to the engine's
  mode/packaging, convert total weight into the per-piece figure the engine needs, and price
  every carrier's cost through `priceQuote()` instead of the old flat multiplier.
- **`backend/src/models/QuoteRate.js`** — gained fields to snapshot the engine's full output
  (`rulesVersion`, `markupPct`, `grossMargin`, `costCad`/`sellCad`, `fxRate`, `chargeableWt`,
  `densityPcf`, `estClass`, `dimGoverns`, `flags`) so a past quote's price stays explainable
  after the rule set changes later. Additive only — no migration needed.
- **`backend/src/seed.js`** — seeds one `PricingRuleSet` document (explicitly marked as
  uncalibrated placeholder values, matching the reference system's own honesty about this)
  instead of the old six `MarkupRule` rows. (Also fixed an unrelated `now is not defined` bug
  introduced while editing this block.)
- **`backend/src/routes/index.js`** — mounted `/api/pricing-rules`.

### Deleted files

- **`backend/src/models/MarkupRule.js`**, **`backend/src/services/markup.service.js`** —
  confirmed referenced nowhere else after the above changes; deleted rather than left unused, so
  nothing can accidentally wire a future caller back into the old flat-tier signature.

### What didn't change

- **No frontend code.** The Quote page already calls `POST /api/rate/all` and renders whatever
  `displayRate` comes back — it has no idea how that number was computed, so the existing UI
  shows the new prices automatically with zero UI changes. The new `flags` array (operational
  warnings) is returned by the API but nothing displays it yet — building that UI wasn't part of
  this task.
- **FTL/air/ocean's spot-rate flow** — untouched. The engine fully supports an `lcl` mode (W/M
  pricing) for exactly this reason, so it's ready to power that flow later with no changes to
  the engine itself, but wiring it in is separate work.
- **Two pre-existing, unrelated gaps surfaced along the way, not fixed here**: `npm install` had
  never been run in `backend/` after the Auth0 dependency was added upstream (fixed in passing,
  since it blocked even starting the server to test), and this local `.env` is missing real
  `AUTH0_DOMAIN`/`AUTH0_AUDIENCE` values, which is why the server can't currently boot via
  `npm run dev` here — that's a local environment setup gap, not something this change caused or
  addresses.

---

## 2. How the pricing logic actually works

### The mental model

Three things drive every price: **bands**, **adjusters**, and **floors** — all three live
together in one versioned "rule set" document.

- **Bands** — a sliding scale of markup percentage by carrier cost. Cheaper shipments carry a
  much higher percentage markup than expensive ones (today's seed values: 175% under $40,
  tapering down to 55% over $1000) — this mirrors how the old flat-tier system worked, just with
  more nuance layered on top.
- **Adjusters** — percentage points added on top of the band markup for specific situations:
  cross-border (Canada↔US) shipments, international shipments, low-density ("light and bulky")
  cargo, and multi-piece (4+) shipments. These stack — a cross-border, low-density, 5-piece
  shipment gets all three adjusters added together.
- **Floors** — a minimum price that overrides the band+adjuster math if it would come out too
  low. There's a minimum per package type (envelope/parcel/LTL skid) and a minimum guaranteed
  profit over cost (`min_gp`) — whichever floor is higher wins.

The final price is always rounded up to a clean increment (currently $5).

### Why the weight calculation differs by shipment type

This is the part most likely to look wrong to someone unfamiliar with freight pricing, so it's
worth spelling out:

- **Envelope/parcel (courier-style)** bill on the *greater of* actual weight and "dimensional
  weight" (a stand-in for how much space a box takes up, calculated from its dimensions) — per
  piece, then summed. A big, light box can cost more to ship than its scale weight suggests,
  because it takes up truck space a heavy, dense box doesn't.
- **LTL (palletized freight)** bills on actual scale weight only — no dimensional-weight
  substitution. Instead, how light-and-bulky the shipment is (its density) determines its
  official freight class, which is what actually drives the carrier's rate. This is why a
  separate "reclass risk" warning exists specifically for LTL, not for envelope/parcel.

### The warnings ("flags")

Every priced rate also returns a list of plain-English operational warnings — things like "no
dimensions were entered so density can't be checked," "this shipment's density sits right on a
freight-class boundary, so a small measurement error could reprice it," or "the calculated price
was below the minimum, so the floor took over." These aren't errors — they're the kind of thing
a person quoting freight by hand would want to double-check before committing to a price. They're
computed and returned by the API today; nothing in the UI displays them yet.

### How an admin changes pricing

`POST /api/pricing-rules` (admin-only) takes a complete new set of bands/adjusters/floors and
publishes it as a new version — it never edits the current one in place. The previous version is
marked inactive and kept forever, which is what makes an old quote's price still explainable
after the rules change: every `QuoteRate` remembers exactly which rule-set version priced it.

### A worked example

A domestic LTL shipment (Toronto → Vancouver, 500 lb, 2 pieces, 48×40×48 in) with a carrier cost
of $574.33:
1. Cost falls in the "$500–$1000" band → 70% base markup.
2. Density works out to about 4.7 lb/ft³ — that's "light and bulky," so the low-density adjuster
   (+10 points) applies.
3. 574.33 × (1 + 80/100) = $1033.79.
4. That's well above the floor, so no floor override.
5. Rounded up to the nearest $5 → **$1035**, which is exactly what the engine returns.

---

## 3. Verification

`backend/src/scripts/pricingEngineTestCases.js` — run anytime with:
```bash
cd backend && node src/scripts/pricingEngineTestCases.js
```
Covers: the domestic-LTL band+density-adjuster math (worked example above), cross-border
multi-piece adjusters, the envelope floor case, and the admin publish/version-retirement flow
(including confirming the database itself — not just application code — rejects two active rule
sets at once). Last run: **10/10 checks passed**. The script cleans up any state it creates, so
it's safe to re-run against the seeded database at any time.
