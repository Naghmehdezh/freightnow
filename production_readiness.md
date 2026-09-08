# Production Readiness Checklist

Reconciled against `IFF Customer Portal Guide.md` — the client's own product spec — as of this
writing. That guide is now the authoritative source for what "done" means; this doc tracks status
against it, plus anything it doesn't cover.

**Read this first:** the guide describes an architecture that differs from what's originally built
in several places. All six of the open decisions below have now been made and are being rolled out
as a sequence of phases (see `.claude/plans/ethereal-squishing-cascade.md` for the phasing
rationale). Phases 1 and 2 are complete; this section tracks decision status, not just "still
open."

---

## 0. Architecture decisions — status

- [x] **Database: MongoDB.** ✅ **Done** (Phase 2, see `phase2_mongodb_migration_changes.md`).
  Postgres/Prisma fully removed; the backend runs on MongoDB/Mongoose, with local MongoDB
  configured as a single-node replica set for transactions. Still local-only — Khizer's real
  connection credentials (or a hosted Atlas cluster) haven't been wired in yet.
- [x] **Auth: Auth0.** ✅ **Done** (Phase 3, see `phase3_auth0_migration_notes.md`). Custom JWT +
  2FA auth fully replaced with Auth0. Backend validates Auth0 access tokens via JWKS. Frontend uses
  `@auth0/auth0-react` SDK. Login/register now redirect to Auth0's Universal Login page.
- [x] **Payments: QuickBooks**, not Stripe. ✅ **Done** (Phase 4, see
  `phase4_quickbooks_integration_changes.md`). Full QB Payments integration: OAuth2 connection,
  card tokenization, card charging at booking time, auto-invoice generation. Running against QB
  sandbox (charges mocked); production requires Intuit app review + stakeholder OAuth authorization.
- [x] **FedEx compliance flow: per the guide's simpler shape.** Decided — fold EULA acceptance +
  identity verification into signup itself, drop the per-customer FedEx account number
  requirement. Not yet implemented; today's fuller `FedexConnectModal.js` / Factor 1+2 flow is
  still what's live. This is its own later phase.
- [x] **Data model: `Booking` split from `Shipment`.** ✅ **Done** (Phase 1, see
  `phase1_booking_and_roles_changes.md`; ported to MongoDB in Phase 2). A `Booking` record exists
  distinct from `Shipment`, verified end-to-end on both database engines.
- [x] **Four-tier roles vs. two.** ✅ **Done** (Phase 1, ported in Phase 2). `customer` /
  `company_admin` / `iff_staff` / `iff_admin` exist as real seeded fixtures with a `requireRole`
  middleware ready to use. Not yet *enforced* anywhere, because the staff/admin-only routes it
  would gate (spot-rate pricing, claims processing, markup rules) don't exist yet — see Step 8
  below.
- [ ] **Money stored as decimals, not integer cents.** Still open. The guide is explicit that
  money should be stored as whole cents (`$312.40` → `31240`) to avoid rounding drift across
  thousands of invoices. The Mongoose schemas (Phase 2) still use `Number` for every money field,
  including the brand-new ones (`Booking.costRate`/`sellRate`, `Payment.amount`) that had no
  legacy data to migrate — those would have been free to do as cents from day one, but were kept
  consistent with the rest of the codebase per this item's existing "fix everywhere at once"
  plan. Worth doing before real invoicing volume.

### Also delivered in Phase 2, beyond the original 6 decisions

The client's guide names 17 target collections; 6 didn't exist in any form before Phase 2:
- [x] **`Carrier`** and **`MarkupRule`** — ✅ fully live, not just schema. Carrier
  enabled/disabled state and the markup tier ladder are now database-driven instead of hardcoded,
  verified against the running API.
- [x] **`Address`** — ✅ real CRUD API (`/api/addresses`), scoped by company. No frontend UI yet.
- [x] **`ActivityLog`** — ✅ real, wired into login, FedEx EULA acceptance, and booking creation.
- [x] **`Payment`** — ✅ now wired into the live booking flow (Phase 4). Created when QB charges a
  card, linked to the booking after creation. Records `qbTransactionId`, status, amount.
- [~] **`ClaimDocument`** — schema only, not wired into any live flow (no file storage yet).

---

## 1. Status against the guide's own 9-step build order

**Step 1 — Foundations.** Local MongoDB is now running (Phase 2) as the settled database engine —
that piece of Step 1 is no longer unresolved, just not yet hosted in production. Auth0 account
exists and is live (Phase 3). QuickBooks developer app exists and is connected in sandbox (Phase 4).
Still not started: no hosting account/domain pointed at `iffcargo.com`, no file storage service
(no S3/Cloudinary/multer references in the backend). QuickBooks production credentials require
Intuit app review.

**Step 2 — Public site + accounts.** ✅ **Mostly done** (Phase 3 + Phase 4). Landing page exists.
Auth now uses Auth0 Universal Login (Phase 3) — login/register redirect to Auth0's hosted pages.
Post-signup onboarding gate (Phase 4) ensures every customer creates a company before accessing the
portal. Whether the third signup step (agreements) matches the guide's design — recording FedEx EULA
acceptance with timestamp + IP address at signup — needs checking; today's EULA acceptance lives in
the separate FedEx-account-connection flow, not in registration.

**Step 3 — FedEx requirements + submit for approval.** The guide lists 4 things that must be built
and working before submitting to FedEx. Current status:

1. **FedEx EULA shown at sign-up + acceptance recorded.**
   - [x] EULA displayed during onboarding step 2 (scrollable text + checkbox confirmation)
   - [x] Acceptance recorded: `fedexTermsAcceptedAt` + `fedexTermsAcceptedFromIp` on User model
   - [x] Audit trail: logged to `ActivityLog` collection
   - [x] **Real EULA text** in `frontend/lib/fedexCompliance.js` — replaced placeholder with the
     full FedEx End User License Agreement (3rd Party Hosted), FedEx Form No. 2002382 v 4 June
     2024 Rev (11 pages, 23 sections). Source PDF: `APIs/FedEx_End_User_License_Agreement_Distributed_Technology.pdf`.

2. **Identity verification at sign-up** (code sent by text/email, typed back in).
   - [x] Auth0 handles this — the guide explicitly says "this gives us identity verification for
     free." Auth0 sends email verification on signup.
   - [x] **Auth0 email verification is enabled** — confirmed in Auth0 dashboard (Branding →
     Email Templates → "Verification Email (Link)" template is enabled). Auth0 sends a
     verification email on signup. Note: still using Auth0's built-in email provider
     (dev/trial) — must configure a Custom Email Provider (SendGrid, Mailgun, etc.) before
     production to ensure reliable delivery.

3. **Estimate disclaimer on every quote** ("the price is an estimate and may change").
   - [x] General estimate disclaimer shown above all rate results: "All rates shown are estimates
     and may be subject to adjustment based on actual shipment weight, dimensions, and carrier
     surcharges."
   - [x] Same disclaimer on spot rate request form (FTL/air/ocean)
   - [x] FedEx trademark notice (`FEDEX_DISCLAIMER`) shown per FedEx rate card
   - [ ] Verify `frontend/public/carrier-logos/fedex.svg` (and other carrier logos) are genuinely
     sourced from each carrier's official brand assets.

4. **Address validation before booking.**
   - [ ] **Not implemented.** FedEx Address Validation API integration needed. Requires: API call
     before booking, UI feedback for invalid/suggested addresses, blocking booking on failure.
     Blocked on having real FedEx API credentials (currently mocked).

5. **Submit screenshots + test transactions to FedEx.**
   - [ ] Cannot happen until items 1–4 are complete. Requires: screenshots of EULA screen, identity
     verification flow, disclaimer on quotes, address validation UI. Plus records of test
     transactions against FedEx sandbox. Package and send to FedEx for Integrator approval.
   - [ ] Once submitted, there is an external approval timeline — nothing can go live to real
     customers until FedEx approves.

**Step 4 — Quoting.** Structurally in place (`/portal/quote`) but running entirely on mocked
carrier data. Markup application: the guide explicitly flags that a prototype calculating markup
in the browser is a real problem ("must move before real customers use it") because anything sent
to the browser can be inspected, exposing your margin. Confirm the frontend's `applyMarkup()` is
only ever a demo fallback when the backend is unreachable, and that the live path always applies
markup server-side (`backend/src/services/markup.service.js`) before rates reach the client — this
needs verifying, not assuming. Markup rules living in an editable settings area (not hardcoded)
and per-company discount overrides are not yet built — `Company` has no discount/markup-override
fields today.

**Step 5 — Booking + payment.** ✅ **Mostly done** (Phase 1 + Phase 4). The `Booking` entity exists,
"Book this rate" creates a real `Booking` + `Shipment`, and QuickBooks Payments integration is live
(card charged at booking time via QB, auto-invoice generated). Payment methods are company-scoped.
Companies can be `'card'` (pay upfront) or `'monthly'` (invoiced on terms). Still not built: no
live carrier booking calls (still mocked), no label/BOL generation (depends on real carrier APIs),
monthly invoice consolidation not yet implemented.

**Step 6 — Post-booking.** Shipments list, tracking, and claims UI exist in the frontend
(`/portal/shipments`, `/portal/track`, `/portal/claims`) against mocked data. Automatic
transactional emails (booking confirmed, delivered, exception) — status unconfirmed; an
`email.service.js` exists but its current scope needs checking against what the guide asks for.

**Step 7 — Billing.** ✅ **Mostly done** (Phase 4). Invoice list with real data (company-scoped),
PDF download via `html2pdf.js`, spending stats from actual invoices, company payment methods with
add/remove/set-default, QB card tokenization, and a "Connect QuickBooks" admin button. Post-signup
onboarding gate ensures every customer has a company before accessing the portal.
**Tax treatment is explicitly called out by the client as an open question requiring accountant
sign-off** — do not guess at Canadian freight tax rules; get that answered before building real
invoicing logic, not after. Still not built: monthly invoice consolidation, due dates, overdue
status transitions, admin UI to set payment terms.

**Step 8 — Admin tools.** Not started. No admin routes exist in the backend today (spot-rate
pricing queue, claims queue, markup-rule editor, customer discount settings, margin reporting are
all in the guide's Step 8 but have no corresponding backend routes yet). The role model and
`requireRole` gating mechanism are ready (Phase 1) — `// TODO` markers are already in
`spotRate.routes.js` and `claim.routes.js` for exactly where staff/admin gating goes once these
routes are built. The guide places this late deliberately but warns not to defer it indefinitely
once volume picks up.

**Step 9 — Remaining carriers.** All 5 carriers are currently mocked; none are "genuinely live"
per the guide's own done-criteria for this step. Day & Ross is closest (account #197742 approved,
API live since March 2026) and is the reasonable first real integration.

---

## 2. Known concrete issues (independent of the architecture questions above)

- [x] ~~Rate-quote API response never exposed a per-rate `id`, so there was no way to book a
  specific rate.~~ **Fixed in Phase 1.**
- [x] ~~"Book this rate" button had no click handler at all — dead UI stub.~~ **Fixed in Phase 1.**
- [~] **Company-level data scoping.** Partially done (Phase 4): payment methods, invoices, and
  billing stats are now company-scoped. Shipments/quotes/claims/spot-rates are still scoped by
  individual `userId` — these should be switched to `companyId` so all users at a company share
  visibility. The `companyId` is already denormalized on `Booking`/`Shipment` records, making this
  a small follow-up per collection.
- [ ] **PIN logging leak.** `backend/src/services/fedexAccount.service.js` logs the real
  verification PIN to the server console (`[DEV FEDEX PIN] ...`). Needs removing or gating behind
  a dev-only env check regardless of how the FedEx flow's shape is ultimately resolved.
- [ ] Secrets management — DB URL, auth provider keys, carrier API keys, QuickBooks keys all need
  real production secrets storage, not a local `.env`.
- [x] ~~`frontend/lib/api.js` hardcodes `http://localhost:4000`~~ — **Fixed (Phase 4).** Now reads
  from `NEXT_PUBLIC_API_URL` env var, defaults to `http://localhost:4000` in dev. Backend callback
  redirect also uses `FRONTEND_URL` env var.
- [ ] No automated test coverage exists.
- [ ] CORS currently open for localhost only.
- [ ] No rate limiting / input-validation audit has been done on public endpoints.

---

## 3. Suggested order of attack

1. ~~Resolve the architecture decisions in section 0~~ — **done**: MongoDB, Auth0, QuickBooks, the
   simplified FedEx flow, the Booking/Shipment split, and four-tier roles have all been decided.
2. ~~Data model: split `Booking` from `Shipment`; add four-tier roles~~ — **done (Phase 1)**, see
   `phase1_booking_and_roles_changes.md`.
3. ~~Phase 2: the Mongo migration~~ — **done**, see `phase2_mongodb_migration_changes.md`. Also
   delivered the `Carrier`/`MarkupRule`/`Address`/`ActivityLog` collections live, and
   `Payment`/`ClaimDocument` as ready-to-wire scaffolding.
4. ~~Phase 3: Auth0 swap~~ — **done**, see `phase3_auth0_migration_notes.md`.
5. ~~Phase 4: QuickBooks integration~~ — **done**, see `phase4_quickbooks_integration_changes.md`.
   Full card payment flow, company-scoped payment methods + invoices, post-signup onboarding,
   Connect QuickBooks admin UI, environment variables for production URLs.
6. **Next up — remaining company-level data scoping** (shipments, quotes, claims, spot-rates still
   user-scoped, need to switch to company-scoped).
7. Fix the PIN-logging leak — small, fast, real security issue, independent of the phased work
   above.
8. Get the tax-treatment question in front of an accountant now — it has its own lead time and
   blocks real invoicing regardless of engineering progress.
9. Phase 5: FedEx flow rework (fold EULA + identity verification into signup, drop the
   per-customer FedEx account number).
10. Stand up remaining Step 1 foundations as each phase's account/credential dependency is
    actually needed (hosting, domain, file storage — the last of which also unblocks wiring real
    uploads behind the `ClaimDocument` collection).
11. Wire up Day & Ross live rates as the first real carrier integration — the `Carrier` collection
    built in Phase 2 makes flipping it live a data change, not a code change.
12. Submit the FedEx Step 3 flow for approval early once its shape is settled (Phase 5) — it has
    its own external approval timeline and blocks going live to real customers regardless of what
    else is ready.
13. Build Step 8 admin tooling — the `requireRole` mechanism and `TODO` markers are already in
    place (Phase 1), and `Carrier`/`MarkupRule` already have live data + a ready
    `updateMarkupTier()` service function (Phase 2) waiting for a route. Don't defer indefinitely
    once volume picks up. Also needed: admin UI to set company `paymentTerms` (card vs monthly).
14. Add the remaining carriers (XPO, Manitoulin, Polaris) as each becomes available.
15. QuickBooks production go-live: see section 4 below for full checklist.

---

## 4. QuickBooks Production Go-Live

The app's QB integration is fully functional against the **sandbox**. Going live with the
stakeholder's real QuickBooks account requires four steps — no code changes needed.

### Step 1 — Submit app for Intuit production review

- Go to [developer.intuit.com](https://developer.intuit.com) → your app → "Production" tab
- Fill out the app assessment questionnaire (what data you access, how tokens are stored, OAuth
  scopes used: `com.intuit.quickbooks.accounting` + `com.intuit.quickbooks.payment`)
- Submit for review — typically **1–3 weeks** turnaround
- On approval, Intuit issues **production** `QB_CLIENT_ID` and `QB_CLIENT_SECRET`

**Status:** [ ] Not started

### Step 2 — Set production environment variables

Deploy (or update `.env`) with:

```
QB_CLIENT_ID=<production client ID>
QB_CLIENT_SECRET=<production client secret>
QB_REDIRECT_URI=https://<your-domain>/api/quickbooks/callback
QB_ENVIRONMENT=production
FRONTEND_URL=https://<your-frontend-domain>
```

The backend already switches API base URLs based on `QB_ENVIRONMENT`
(`backend/src/services/quickbooks.service.js` lines 8–16):
- `production` → `https://quickbooks.api.intuit.com` + `https://api.intuit.com`
- `sandbox` → `https://sandbox-quickbooks.api.intuit.com` + `https://sandbox.api.intuit.com`

**Status:** [ ] Blocked on Step 1

### Step 3 — Stakeholder authorizes via OAuth (one-time)

Once deployed with production credentials:
1. An IFF admin logs in → goes to `/portal/billing`
2. Clicks **"Connect QuickBooks"** button
3. Redirected to Intuit's OAuth consent page → logs in with the IFF QuickBooks company account
4. Authorizes the app (accounting + payments access)
5. Redirected back → tokens stored in the `QBToken` collection automatically

This is a **one-time action** by whoever owns the IFF QuickBooks account (Khizer or IFF's
accountant). After authorization, the app handles token refresh automatically.

**Status:** [ ] Blocked on Steps 1 + 2

### Step 4 — Token lifecycle & maintenance

| Token | Lifespan | Handling |
|-------|----------|----------|
| Access token | 60 minutes | Auto-refreshed by `quickbooks.service.js` (line 119) when within 5 min of expiry |
| Refresh token | **100 days** | If it expires, the admin must re-authorize (repeat Step 3) |

**Recommendation:** Add a scheduled job (cron or similar) to call the QB API weekly — this
exercises the refresh flow and prevents the refresh token from silently expiring during
periods of low activity. Not yet built.

**Status:** [ ] Auto-refresh works; proactive keep-alive not yet built

### Summary checklist

| # | Task | Who | Blocked on |
|---|------|-----|-----------|
| 1 | Submit app for Intuit production review | Developer (Uzair / you) | Nothing — can start now |
| 2 | Get production credentials back from Intuit | Intuit | Step 1 (1–3 week review) |
| 3 | Deploy with production env vars | Developer | Step 2 |
| 4 | Stakeholder OAuth authorization (one-time click) | Khizer / IFF admin | Step 3 |
| 5 | Verify a real charge + invoice generation | QA | Step 4 |
| 6 | Build token keep-alive cron (optional but recommended) | Developer | Nothing |
