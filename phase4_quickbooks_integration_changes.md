# Phase 4: QuickBooks Integration Changes

## Overview
Added QuickBooks Online integration for payment processing and invoicing. The system connects to QuickBooks via OAuth2, tokenizes customer credit cards via QB Payments API, charges cards when bookings are made, and auto-generates invoices. In sandbox mode, charges that fail are mocked (same pattern as the carrier adapters).

## QuickBooks Configuration

### Credentials (in `backend/.env`)
```
QB_CLIENT_ID=ABUwAQSO0CINugMbqcBVpcPMz2BZJJMu96KO1qMPY4pZywZhPz
QB_CLIENT_SECRET=aDPm8BB9p8hAOXrArLAeAqWcMQDZjual8iqsMlY8
QB_REDIRECT_URI=http://localhost:4000/api/quickbooks/callback
QB_ENVIRONMENT=sandbox
```

### QuickBooks App Settings (developer.intuit.com)
- **App Type:** QuickBooks Online Payments + Accounting
- **OAuth2 Redirect URI:** `http://localhost:4000/api/quickbooks/callback`
- **Scopes:** `com.intuit.quickbooks.accounting com.intuit.quickbooks.payment`
- **Environment:** Sandbox (switch to `production` for live charges)

---

## Backend Changes

### 1. New Dependencies
- **Backend:** None (uses native `fetch` for QB API calls)
- **Frontend:** `html2pdf.js` — client-side PDF generation for invoice downloads

### 2. `backend/src/config/env.js`
Added QuickBooks config block:
```js
quickbooks: {
  clientId: process.env.QB_CLIENT_ID,
  clientSecret: process.env.QB_CLIENT_SECRET,
  redirectUri: process.env.QB_REDIRECT_URI || 'http://localhost:4000/api/quickbooks/callback',
  environment: process.env.QB_ENVIRONMENT || 'sandbox',
},
```

### 3. New Model: `backend/src/models/QBToken.js`
Stores the QuickBooks OAuth2 tokens for the connected company account. Only one active connection at a time.

| Field | Type | Description |
|-------|------|-------------|
| realmId | String (unique) | QuickBooks company ID |
| accessToken | String | Current access token |
| refreshToken | String | Refresh token |
| accessTokenExpiresAt | Date | Access token expiry (~1 hour) |
| refreshTokenExpiresAt | Date | Refresh token expiry (~100 days) |
| connectedBy | ObjectId (ref User) | Admin who connected |

### 4. Modified Model: `backend/src/models/PaymentMethod.js`
Added `qbCardToken` field:
```js
qbCardToken: String, // QuickBooks Payments tokenized card ID
```
When a card is tokenized via QB Payments, the token is stored here. During booking, if this field is present, the system charges the card via QB.

### 5. Modified Model: `backend/src/models/Payment.js`
Changed `booking` from required to optional:
```js
booking: { type: Schema.Types.ObjectId, ref: 'Booking' }, // was required: true
```
Reason: The charge happens before the booking is created (charge first, then book if charge succeeds). The booking ID is assigned after creation.

### 6. Modified Model: `backend/src/models/Company.js`
Added `paymentTerms` field:
```js
paymentTerms: { type: String, enum: ['card', 'monthly'], default: 'card' },
```
Determines whether a company pays per-booking (card charge) or is invoiced monthly.

### 7. New Service: `backend/src/services/quickbooks.service.js`
Core QB connection management:
- `getAuthorizationUrl(state)` — generates OAuth2 redirect URL to Intuit
- `exchangeCodeForTokens(code, realmId, userId)` — exchanges auth code for access/refresh tokens, stores in QBToken
- `refreshAccessToken(tokenDoc)` — refreshes expired access tokens automatically
- `getValidToken()` — returns a valid token (auto-refreshes if within 5 min of expiry)
- `qbRequest(method, path, body, isPayments)` — authenticated request helper
- `getConnectionStatus()` — returns connection health info
- `getBaseUrl()` / `getPaymentsBaseUrl()` — returns correct sandbox/production URLs

### 8. New Service: `backend/src/services/qbPayments.service.js`
Payment processing via QuickBooks Payments API:
- `tokenizeCard(cardData)` — sends card to `POST /quickbooks/v4/payments/tokens`, returns token string
- `chargeCard({ bookingId, userId, amount, currency, paymentMethodId })` — charges a tokenized card via `POST /quickbooks/v4/payments/charges`, records Payment in DB
- `refundCharge(qbTransactionId, amount)` — refunds a charge via `POST /quickbooks/v4/payments/charges/:id/refunds`

**Sandbox fallback:** If `QB_ENVIRONMENT=sandbox` and the charge is declined (QB sandbox doesn't accept test cards), the system mocks a successful payment with a `sandbox-mock-*` transaction ID and proceeds with the booking.

### 9. New Service: `backend/src/services/invoice.service.js`
Auto-generates invoices after bookings:
- `generateInvoiceNumber()` — sequential numbering format: `INV-YYYYMM-NNNN`
- `createInvoiceForBooking(booking, userId)` — creates an Invoice with line items from the booking. Status is `paid` if card charge succeeded, `pending` if monthly billing.

### 10. New Routes: `backend/src/routes/quickbooks.routes.js`
Mounted at `/api/quickbooks`:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/connect` | None (dev) | Redirects admin to Intuit OAuth2 authorization page |
| GET | `/callback` | None | OAuth2 callback — exchanges code for tokens, redirects to billing page |
| GET | `/status` | None (dev) | Returns QB connection status (connected, token validity) |
| POST | `/tokenize-card` | Yes | Tokenizes a credit card via QB Payments, saves as PaymentMethod |

**Card tokenization** validates via Zod:
```js
{ number, expMonth, expYear, cvc, name }
```
Auto-detects card type (Visa/MC/Amex/Discover) from number prefix.

### 11. Modified: `backend/src/routes/index.js`
Added QuickBooks routes:
```js
const quickbooksRoutes = require('./quickbooks.routes');
router.use('/quickbooks', quickbooksRoutes);
```

### 12. Modified: `backend/src/services/booking.service.js`
Major changes to support QB payment on booking:

**Before:** Created booking without any payment processing.

**After:** Full payment flow before booking creation:
1. Determines `paymentTerms` from company (`'card'` or `'monthly'`)
2. If card: finds user's default PaymentMethod (or specified one)
3. If PaymentMethod has `qbCardToken`: calls `qbPayments.chargeCard()`
4. Creates Booking + Shipment inside a transaction
5. Updates Payment record with booking ID
6. Auto-generates invoice via `invoiceService.createInvoiceForBooking()`
7. Logs activity

Payment errors are wrapped as `ValidationError` so users see the actual failure reason (e.g., "Payment failed: Payment declined") instead of a generic 500.

### 13. Modified: `backend/src/routes/booking.routes.js`
Added optional `paymentMethodId` to booking schema:
```js
const bookSchema = z.object({
  quoteId: objectId(),
  quoteRateId: objectId(),
  customerReference: z.string().optional(),
  paymentMethodId: z.string().optional(), // NEW — pick a specific card
});
```

---

## Frontend Changes

### 1. Modified: `frontend/components/AuthBridge.js`
**Bug fix:** Token getter was set in a `useEffect` that ran after child component effects (React fires child effects before parent effects). This caused all API calls on page load to go out without auth tokens (401 errors on every page).

**Fix:** Set `tokenGetter` synchronously during render when `isAuthenticated` is true:
```js
if (isAuthenticated) {
  setTokenGetter(() => getAccessTokenSilently());
}
```

### 2. Modified: `frontend/lib/api.js`
Changed to token-getter pattern (from Phase 3). The `tokenGetter` is a function set by `AuthBridge` that returns an Auth0 access token. This enables the `fetchAPI` helper to attach the correct bearer token to all requests.

### 3. Modified: `frontend/app/portal/quote/page.js`
Updated booking handler to:
- Call `POST /api/bookings` with `{ quoteId, quoteRateId }`
- Display success message with payment status: "Booked & paid!" (card) or "Booked! Invoice will be sent." (monthly)
- Show actual error messages from the backend on failure

### 4. Modified: `frontend/app/portal/page.js` (Dashboard)
Added "Book →" action column to the Recent Quotes table on the Dashboard. Users can book live quotes directly from the dashboard without navigating to the quote page:
- **"Book →"** button appears for quotes that are still live (not expired) and haven't been booked yet
- **"Booked ✓"** (disabled) appears for quotes already booked
- **"Expired"** (disabled) appears for expired quotes
- Calls `POST /api/bookings` with `{ quoteId, quoteRateId }` — same endpoint as the quote page, including full QB payment processing
- Displays payment-aware success message: "Booked & paid!" (card charged) or "Booked! Invoice will be sent." (monthly billing)
- Shows actual backend error messages on failure

### 5. Modified: `frontend/app/portal/billing/page.js`
Fixed field mappings between API responses and UI display:

| API Field | Frontend Display |
|-----------|-----------------|
| `spentThisYear` | Total spent (all time) |
| `spentThisMonth` | This month |
| `outstanding` | Outstanding |
| `invoiceNumber` | Invoice # |
| `issuedAt` | Date (formatted) |
| `totalAmount` | Amount (C$ formatted) |
| `items.length` | Shipments count |
| `expiryMonth` + `expiryYear` | Expiry (MM/YY) |

Added **"+ Add payment method"** modal form:
- Opens a modal overlay with fields: Name on card, Card number, Exp. month, Exp. year, CVC
- Card type (Visa/Mastercard/Amex/Discover) is auto-detected from the card number prefix — no manual selection needed
- Calls `POST /api/quickbooks/tokenize-card` which tokenizes the card via QB Payments API and stores as a PaymentMethod
- On success, the new card appears in the payment methods list immediately (no page reload)
- Shows inline error message if tokenization fails
- First card added is automatically set as default
- Cancel button or clicking the overlay backdrop closes the form

Also added **"Download PDF"** button for each invoice that generates an actual PDF file (saved to Downloads) using `html2pdf.js`. The PDF includes IFF Cargo branding, line items, and totals formatted on A4 paper.

---

## OAuth2 Flow

```
1. Admin visits GET /api/quickbooks/connect
2. Backend redirects to: https://appcenter.intuit.com/connect/oauth2?client_id=...&scope=...
3. Admin authorizes at Intuit
4. Intuit redirects to: GET /api/quickbooks/callback?code=...&realmId=...
5. Backend exchanges code for tokens (POST to oauth.platform.intuit.com)
6. Tokens stored in QBToken collection
7. Backend redirects admin to: http://localhost:3000/portal/billing?qb_connected=true
```

## Booking Payment Flow

```
1. User clicks "Book this rate" on quote page
2. Frontend: POST /api/bookings { quoteId, quoteRateId }
3. Backend: booking.service.createBooking()
   a. Validates quote + selected rate
   b. Checks company.paymentTerms (default: 'card')
   c. Finds user's default PaymentMethod
   d. If qbCardToken present → qbPayments.chargeCard()
      - Calls QB Payments API: POST /quickbooks/v4/payments/charges
      - In sandbox: mocks success if charge is declined
   e. Creates Payment record (status: succeeded)
   f. Creates Booking (paymentStatus: paid) + Shipment (in transaction)
   g. Updates Payment with booking ID
   h. Auto-generates Invoice (status: paid)
4. Response: { booking, shipment } → frontend shows success alert
```

## Card Tokenization Flow

```
1. POST /api/quickbooks/tokenize-card { number, expMonth, expYear, cvc, name }
2. Backend calls QB Payments: POST /quickbooks/v4/payments/tokens
3. QB returns token string (one-time-use card reference)
4. Backend creates PaymentMethod with qbCardToken = token
5. Returns { id, type, last4, expiryMonth, expiryYear, isDefault }
```

---

## Database Changes

### New Collection: `qbtokens`
Stores QB OAuth tokens (see model above).

### Modified Collection: `paymentmethods`
Added `qbCardToken` field for QB Payments card tokens.

### Modified Collection: `payments`
`booking` field changed from required to optional (charge is created before booking).

### Modified Collection: `companies`
Added `paymentTerms` field (`'card'` | `'monthly'`, default `'card'`).

### Modified Collection: `invoices`
Added `company` field (company-scoped). `user` changed from required to optional (audit trail).

---

## Testing in Development

### Demo Accounts
| Role | Email | Password |
|------|-------|----------|
| Customer | john@acmecorp.com | demo1234 |
| Company admin | jane@acmecorp.com | demo1234 |
| IFF staff | staff@iffcargo.com | staff1234 |
| IFF admin | admin@iffcargo.com | admin1234 |

Authentication is via Auth0 — these accounts are seeded in the Auth0 tenant.

### Connect QuickBooks (one-time)
1. Visit `http://localhost:4000/api/quickbooks/connect` in browser
2. Log in with your Intuit sandbox credentials
3. Authorize the app
4. You'll be redirected to the billing page with `?qb_connected=true`

### Verify Connection
```bash
curl http://localhost:4000/api/quickbooks/status
# Returns: { connected: true, realmId: "...", accessTokenValid: true, ... }
```

### Add a Payment Method (via UI)
1. Go to `/portal/billing`
2. Click "+ Add payment method"
3. Fill in: Name on card, Card number, Exp. month (2-digit), Exp. year (4-digit), CVC
4. Click "Add card"
5. Card type is auto-detected from number (Visa starts with 4, MC with 51-55, Amex with 34/37)
6. Card appears in the payment methods list immediately

### Add a Payment Method (via API)
```bash
curl -X POST http://localhost:4000/api/quickbooks/tokenize-card \
  -H "Authorization: Bearer <auth0_token>" \
  -H "Content-Type: application/json" \
  -d '{"number":"4111111111111111","expMonth":"12","expYear":"2027","cvc":"123","name":"Test User"}'
```

### Test Booking with Payment
1. Go to `/portal/quote`
2. Get quotes for any shipment
3. Click "Book this rate"
4. If card on file → charges via QB (sandbox mocked) → shows "Booked & paid!"
5. Check `/portal/billing` for the invoice

---

## Company-Scoped Payment Methods & Onboarding

Per the Customer Portal Guide, payment methods belong to the **company**, not individual users. All users at the same company share the same saved cards. Additionally, every user must have a company before accessing the portal.

### Company Model Updates
**File:** `backend/src/models/Company.js`

Added billing address fields per the guide's requirements ("Billing address, phone, tax number"):
```js
street: String,
phone: String,
taxNumber: String,
isActive: { type: Boolean, default: true },
```

### PaymentMethod Model — Company-Scoped
**File:** `backend/src/models/PaymentMethod.js`

- Added `company` field (ObjectId ref to Company) — this is the primary ownership scope
- `user` field kept as optional audit trail ("who added this card")
- All queries switched from `{ user: userId }` to `{ company: companyId }`

### Backend Service Changes

| File | Change |
|------|--------|
| `backend/src/services/billing.service.js` | All payment method functions now accept `companyId` instead of `userId` |
| `backend/src/services/booking.service.js` | Looks up default PaymentMethod by `{ company: companyId }` |
| `backend/src/services/qbPayments.service.js` | `chargeCard()` validates payment method by company |
| `backend/src/routes/billing.routes.js` | Passes `req.user.companyId`, returns 403 if no company |
| `backend/src/routes/quickbooks.routes.js` | Tokenize-card creates cards scoped to company |
| `backend/src/services/profile.service.js` | `updateCompany()` now accepts `street`, `phone`, `taxNumber` |
| `backend/src/routes/profile.routes.js` | Company schema updated + new `GET /api/profile/onboarding-status` endpoint |

### Onboarding Status Endpoint
```
GET /api/profile/onboarding-status
```
Returns `{ needsOnboarding: boolean, needsTerms: boolean, role: string }`. IFF staff/admin always get `false` for both. Customers without a company get `needsOnboarding: true`. Customers who haven't accepted IFF + FedEx terms get `needsTerms: true`.

### Accept Terms Endpoint
```
POST /api/profile/accept-terms
```
Records acceptance of IFF Cargo Terms of Service + FedEx End User License Agreement. Stores timestamp and IP address on the User record (`termsAcceptedAt`, `termsAcceptedFromIp`, `fedexTermsAcceptedAt`, `fedexTermsAcceptedFromIp`). Also writes to `ActivityLog` for audit.

### Post-Signup Onboarding Page (2-step flow)
**New files:** `frontend/app/portal/onboarding/page.js` + `page.module.css`

A full-page, 2-step onboarding flow with step indicator (dots 1–2):

**Step 1 — Personal info + Company details:**
- First name, Last name (required) — saved via `PUT /api/profile`
- *(visual divider)*
- Company name (required)
- Street address (billing)
- City, Province/State, Postal code
- Country (Canada / United States)
- Phone
- Tax number (GST/HST, optional)

On submit: saves personal info then company info → advances to step 2.

**Step 2 — Agreements:**
- IFF Cargo Terms of Service (scrollable text box + checkbox)
- FedEx End User License Agreement (scrollable text box + checkbox)
- Authorization confirmation checkbox ("I confirm I am authorised to open and manage a shipping account on behalf of my company")
- All three checkboxes required to proceed

On submit: calls `POST /api/profile/accept-terms` (records timestamp + IP) → redirects to `/portal`.

If user already has a company but hasn't accepted terms (e.g., existing user), the page auto-skips to step 2.

### Portal Layout — Onboarding Gate
**File:** `frontend/app/portal/layout.js`

After auth is confirmed, checks `/api/profile/onboarding-status`:
- If `needsOnboarding` OR `needsTerms` and not on `/portal/onboarding` → redirects there
- If on onboarding page but already completed both → redirects to `/portal`
- IFF staff/admin are never redirected (they don't need a company or terms)
- Onboarding page renders without portal chrome (no sidebar/topbar)

### Profile Page — Read-Only by Default
**File:** `frontend/app/portal/profile/page.js`

The profile page shows all user and company data in read-only mode. Each section has an "Edit" button that enables the fields for editing:

- **Personal Information:** First name, Last name (editable on click), Email (always read-only — managed by Auth0)
- **Company:** All fields from onboarding (name, street, city, province, postal code, country, phone, tax number) — read-only until "Edit" is clicked
- **Password:** Hidden behind "Change password" button; form appears on click

Save/Cancel buttons appear only when editing. On save, fields return to read-only.

**Removed from profile page:** The old FedEx Connect flow (EULA + Factor 1/2 MFA account connection modal) — EULA acceptance is now handled during onboarding, not as a separate profile action.

### Migration Script
**New file:** `backend/src/scripts/migratePaymentMethodsToCompany.js`

For existing databases: links PaymentMethod records to their user's company. Idempotent (safe to re-run).
```bash
node backend/src/scripts/migratePaymentMethodsToCompany.js
```

---

## Company-Scoped Invoices & Billing Stats

Per the Customer Portal Guide, invoices belong to the **company**, not the individual user: "Each invoice record holds an invoice number and specifies which company it is for." All users at the same company see the same invoices and billing stats.

### Invoice Model — Company-Scoped
**File:** `backend/src/models/Invoice.js`

- Added `company` field (ObjectId ref to Company) — primary ownership scope
- `user` field changed from `required: true` to optional (audit trail of who triggered the invoice)

```js
const invoiceSchema = new Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  company: { type: Schema.Types.ObjectId, ref: 'Company' },  // NEW — invoice belongs to company
  user: { type: Schema.Types.ObjectId, ref: 'User' },        // was required — now optional audit trail
  totalAmount: { type: Number, required: true },
  currency: { type: String, default: 'CAD' },
  status: { type: String, default: 'pending' },
  paidAt: Date,
  items: [invoiceItemSchema],
}, { timestamps: { createdAt: 'issuedAt', updatedAt: false } });
```

### Invoice Service — Accepts Company ID
**File:** `backend/src/services/invoice.service.js`

Function signature changed: `createInvoiceForBooking(booking, companyId, userId)` — sets `company` on the invoice.

### Billing Service — Queries by Company
**File:** `backend/src/services/billing.service.js`

| Function | Before | After |
|----------|--------|-------|
| `getInvoices(userId)` | Queried `{ user: userId }` | `getInvoices(companyId)` — queries `{ company: companyId }` |
| `getInvoiceById(id, userId)` | Validated by user | `getInvoiceById(id, companyId)` — validates by company |
| `getBillingStats(userId)` | Summed Booking.sellRate by user | `getBillingStats(companyId)` — sums Invoice.totalAmount by company + calculates outstanding |

Billing stats now return:
```js
{ spentThisMonth, spentThisYear, outstanding }
```
- `spentThisMonth` / `spentThisYear` — sum of Invoice `totalAmount` for the company within the period
- `outstanding` — sum of all invoices with `status: 'pending'`

### Billing Routes — Company-Scoped Guards
**File:** `backend/src/routes/billing.routes.js`

- `GET /api/billing/invoices` — passes `req.user.companyId`, returns empty if no company
- `GET /api/billing/invoices/:id` — passes `req.user.companyId`, returns 403 if no company
- `GET /api/billing/stats` — passes `req.user.companyId`, returns zeros if no company

### Booking Service — Passes Company ID to Invoice
**File:** `backend/src/services/booking.service.js`

Changed invoice creation call from:
```js
await invoiceService.createInvoiceForBooking(result.booking, userId);
```
To:
```js
await invoiceService.createInvoiceForBooking(result.booking, companyId, userId);
```

### Seed Data
**File:** `backend/src/seed.js`

Seeded invoices now include `company: company._id`.

---

## Payment Terms: Card vs Monthly

### 1. Card (pay upfront)
- Company has `paymentTerms: 'card'`
- At booking time, the card on file is charged immediately via QuickBooks Payments
- The invoice generated is essentially a **receipt** — money is already collected
- Invoice status = `paid` immediately
- One invoice per booking

### 2. Monthly (invoiced on terms)
- Company has `paymentTerms: 'monthly'`
- At booking time, **no charge happens** — the booking just goes through
- At the end of the month, a single invoice is generated covering all shipments that month
- Invoice status = `pending` (becomes `overdue` if not paid by due date)
- The customer pays the invoice later (via bank transfer, cheque, etc. — outside the portal)
- This is for trusted/regular customers with an established relationship

### What's already built
- The `Company.paymentTerms` field (`'card'` | `'monthly'`) exists
- The booking service checks `paymentTerms` — if `'monthly'`, it skips the card charge and sets `paymentStatus: 'invoiced'`
- Single-booking invoices are auto-generated in both cases

### What's NOT built yet
- Monthly invoice consolidation (one invoice covering all shipments that month)
- Due dates on invoices
- Invoice status transitions (`pending` → `overdue` after due date)
- Any mechanism for the customer to mark an invoice as paid (or admin to mark it)
- The actual offline payment collection (bank transfer, etc.)
- Admin UI to set a company's `paymentTerms` (no admin panel exists yet)

### How `paymentTerms` is set today
Currently only changeable manually in the database:
```bash
db.companies.updateOne({ name: 'Acme' }, { $set: { paymentTerms: 'monthly' } })
```
An IFF admin could set it, but no admin panel exists yet.

This is intentional — it's not something the customer chooses themselves. It's a business decision made by IFF staff for trusted/regular customers. The typical flow would be:
- New companies default to `'card'` (must pay upfront)
- After a relationship is established, IFF admin switches them to `'monthly'`

---

## Production QuickBooks Integration

### Development vs Production

| Component | Development (Current) | Production |
|-----------|----------------------|------------|
| **Developer Portal** | Personal Intuit developer account | IFF Cargo's Intuit developer account (or same — the app is what matters) |
| **App** | "IFF Cargo" sandbox app | Same app, but with **Production** keys enabled (requires Intuit review) |
| **QB Company** | Intuit sandbox test company (fake data) | IFF Cargo's **real** QuickBooks Online company (their actual books) |
| **Credentials** | Sandbox `client_id` / `client_secret` | Production `client_id` / `client_secret` from the Production tab |
| **Charges** | Mocked (sandbox doesn't process real cards) | Real money, real card processing |

### The Key Distinction

There are **two separate things**:

1. **The Intuit Developer App** (developer.intuit.com) — this is the API credentials. The developer controls this.
2. **The QuickBooks Online Company** (quickbooks.intuit.com) — this is IFF's actual accounting software where they already manage their books, customers, invoices, etc.

The OAuth flow **connects** #1 to #2:
```
IFF admin clicks "Connect QuickBooks"
  → authorizes the app to access THEIR QB company
  → the app can now create invoices, charge cards in their real QB account
```

### What the Authorization Actually Is

The authorization (OAuth flow) gives the app **permission to act on IFF's QuickBooks account**.

IFF has their QuickBooks account where they manage their books — invoices, payments, customers, etc. The app needs to do things inside that account on their behalf — charge a customer's card, create an invoice, etc. Intuit won't let any random app touch their account. Someone at IFF (an admin) has to explicitly say: "Yes, I trust this app to access my QuickBooks."

**That "yes" is the authorization click.**

It happens once. After that, the app has a token (like a key) that lets it make API calls against IFF's QB account — create invoices, process payments, etc. — without anyone needing to click anything again.

**What it's NOT:**
- It's not creating a new QuickBooks account
- It's not giving you their login credentials
- It's not costing anyone money
- It's not installing anything on their computer

**What it IS:**
- IFF admin logs into Intuit, sees "IFF Cargo Portal wants to access your QuickBooks", clicks "Authorize"
- Intuit gives the app a token
- The app uses that token to call QB APIs (charge cards, create invoices)
- The token expires after ~100 days, then they click authorize again (or it auto-refreshes)

It's the same pattern as "Sign in with Google" or "Connect your Slack" — just granting access.

### Cost

Using production credentials does **not** cost the developer anything.

| Who | What They Pay |
|-----|---------------|
| **Developer** | Nothing. The Intuit Developer Portal and API access are free. No per-call charges. |
| **IFF Cargo (stakeholder)** | QuickBooks Online subscription (~$30–200/mo, they already have this) + QuickBooks Payments transaction fees per card charge (~2.9% + $0.25) |

The card processing fees come out of IFF's QuickBooks Payments account. When a customer's card is charged $500 for a shipment, IFF receives ~$485 after fees — same as if they manually ran the card through QuickBooks. The app just automates what they'd otherwise do by hand in their QB dashboard.

### Steps to Go Production

1. **Get production access** — in the Intuit Developer Portal, go to the app → Keys & OAuth → **Production** tab. Submit for Intuit's review (they check scopes, privacy policy, etc.)

2. **Update `.env`** with production credentials:
   ```
   QB_CLIENT_ID=<production_client_id>
   QB_CLIENT_SECRET=<production_client_secret>
   QB_REDIRECT_URI=https://api.iffcargo.com/api/quickbooks/callback
   QB_ENVIRONMENT=production
   ```

3. **IFF admin connects once** — visits `/api/quickbooks/connect`, logs into their real QuickBooks account, authorizes the app. Now the app has tokens to operate on their real company.

4. **From that point on:**
   - Card tokenization charges real cards
   - Invoices created via the API show up in IFF's real QuickBooks
   - Their accountant sees everything in QB just like manually-created invoices

### What the Stakeholder Needs to Provide

- Nothing code-wise. They just need to **click authorize** when prompted during the OAuth flow.
- Their existing QuickBooks Online login credentials (they sign in during OAuth — the developer never sees their password)
- Optionally: confirm which QB "company" to connect if they have multiple

The integration is designed so the stakeholder doesn't need to touch the developer portal at all. They just authorize access to their existing QB account through the browser prompt.

### Connect QuickBooks Button (Admin UI)

Added a "Connect QuickBooks" section on the billing page (`/portal/billing`), visible **only to IFF admin/staff**:

- **If not connected:** Shows a message + green "Connect QuickBooks" button that starts the OAuth flow
- **If connected:** Shows a green dot with "Connected to QuickBooks (Realm: ...)" and a "Reconnect" link
- Customers never see this section

The button links to `${API_URL}/api/quickbooks/connect` — uses the environment variable, not hardcoded localhost.

### Environment Variables for URLs

Removed all hardcoded `localhost` URLs. Everything now uses environment variables with dev defaults:

| Where | Variable | Default (dev) | Production example |
|-------|----------|---------------|-------------------|
| Frontend → Backend API | `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | `https://api.iffcargo.com` |
| Backend → Frontend (OAuth callback redirect) | `FRONTEND_URL` | `http://localhost:3000` | `https://portal.iffcargo.com` |

**Frontend** (`frontend/.env`):
```
NEXT_PUBLIC_API_URL=https://api.iffcargo.com
```

**Backend** (`backend/.env`):
```
FRONTEND_URL=https://portal.iffcargo.com
```

In development, nothing needs to be set — defaults to localhost. In production, set both variables to the real domains.

**Files changed:**
- `frontend/lib/api.js` — `API_URL` now reads from `NEXT_PUBLIC_API_URL` env var, exported for use in components
- `frontend/app/portal/billing/page.js` — imports `API_URL`, uses it for the QB connect link
- `backend/src/routes/quickbooks.routes.js` — OAuth callback redirect uses `FRONTEND_URL` env var

### Production Deployment Checklist

- Change `QB_ENVIRONMENT=production` in `.env`
- Use real Intuit production app credentials (from the Production tab, after Intuit review)
- Set `NEXT_PUBLIC_API_URL` in frontend environment (production API domain)
- Set `FRONTEND_URL` in backend environment (production frontend domain)
- Set `QB_REDIRECT_URI` to the production callback URL (e.g. `https://api.iffcargo.com/api/quickbooks/callback`)
- Add `authenticate` middleware to `/connect` and `/status` routes (currently open for dev convenience)
- QB sandbox mocking in `qbPayments.service.js` only activates when `QB_ENVIRONMENT=sandbox` — production charges are real
- Refresh tokens expire after ~100 days — if expired, admin must reconnect via OAuth

---

## Files Changed (Summary)

### New Files
| File | Purpose |
|------|---------|
| `backend/src/models/QBToken.js` | QB OAuth token storage |
| `backend/src/routes/quickbooks.routes.js` | QB endpoints (connect, callback, status, tokenize) |
| `backend/src/services/quickbooks.service.js` | QB OAuth + API request management |
| `backend/src/services/qbPayments.service.js` | Card tokenization + charging via QB Payments |
| `backend/src/services/invoice.service.js` | Auto-invoice generation after booking (company-scoped) |
| `backend/src/scripts/migratePaymentMethodsToCompany.js` | Migration: link payment methods to company |
| `frontend/app/portal/onboarding/page.js` | 2-step onboarding: personal info + company → agreements (IFF Terms + FedEx EULA) |
| `frontend/app/portal/onboarding/page.module.css` | Onboarding page styles (steps, terms boxes, checkboxes, divider) |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/config/env.js` | Added `quickbooks` config block |
| `backend/src/models/Company.js` | Added `paymentTerms`, `street`, `phone`, `taxNumber`, `isActive` |
| `backend/src/models/PaymentMethod.js` | Added `qbCardToken` + `company` field (company-scoped) |
| `backend/src/models/Payment.js` | Made `booking` optional |
| `backend/src/routes/index.js` | Mounted quickbooks routes |
| `backend/src/routes/booking.routes.js` | Added `paymentMethodId` to schema |
| `backend/src/models/Invoice.js` | Added `company` field, made `user` optional (company-scoped) |
| `backend/src/routes/billing.routes.js` | Payment methods + invoices + stats now company-scoped, 403 guard |
| `backend/src/routes/profile.routes.js` | New company fields in schema + onboarding-status (returns `needsTerms`) + accept-terms endpoint |
| `backend/src/models/User.js` | Added `termsAcceptedAt`, `termsAcceptedFromIp`, `fedexTermsAcceptedAt`, `fedexTermsAcceptedFromIp` |
| `frontend/app/portal/profile/page.js` | Removed FedEx Connect section, added all company fields, read-only/edit pattern |
| `frontend/app/portal/profile/page.module.css` | Added edit button, read-only, cancel, hint styles |
| `backend/src/services/booking.service.js` | Full payment flow + company-scoped card lookup + passes companyId to invoice |
| `backend/src/services/billing.service.js` | All payment + invoice + stats queries by company instead of user |
| `backend/src/services/qbPayments.service.js` | Card lookup by company + sandbox mock |
| `backend/src/services/profile.service.js` | Accepts new company fields (street, phone, taxNumber) |
| `backend/src/seed.js` | Company with billing address, PaymentMethod with company, demo users with terms accepted |
| `backend/src/middleware/auth.js` | (from Phase 3 — Auth0 validation) |
| `frontend/components/AuthBridge.js` | Fixed token getter race condition |
| `frontend/lib/api.js` | Token getter pattern for Auth0 + `API_URL` from env var (`NEXT_PUBLIC_API_URL`) |
| `frontend/app/portal/layout.js` | Onboarding gate (redirects users without company) |
| `frontend/app/portal/page.js` | Dashboard Book button with QB payment flow |
| `frontend/app/portal/quote/page.js` | Booking with payment status display |
| `frontend/app/portal/billing/page.js` | Company payment methods + Add card modal + PDF download + QB connect button (admin) |
| `frontend/app/portal/billing/page.module.css` | Added QB connection section styles |
