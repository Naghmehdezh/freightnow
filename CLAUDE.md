# IFF Cargo - Project Instructions

## Project Overview
IFF Cargo is a freight forwarding platform that compares shipping rates from 5 Canadian carriers (FedEx, XPO Logistics, Day & Ross, Manitoulin, Polaris). Users input shipment size, weight, and destination to get instant rate comparisons.

## Project Structure
```
├── Web Design/iffcargo-website/   # Original static HTML/CSS/JS (reference designs)
├── frontend/                       # Next.js React app (port 3000)
│   ├── app/
│   │   ├── layout.js              # Root layout (fonts, global CSS)
│   │   ├── globals.css            # Design system (CSS vars, shared styles)
│   │   ├── page.js                # Landing page (/)
│   │   ├── page.module.css
│   │   ├── login/page.js          # Login (/login)
│   │   ├── register/page.js       # Multi-step registration (/register)
│   │   └── portal/
│   │       ├── layout.js          # Portal layout (sidebar + topbar + auth guard)
│   │       ├── page.js            # Dashboard (/portal)
│   │       ├── quote/page.js      # Rate comparison (/portal/quote)
│   │       ├── shipments/page.js  # Shipment list (/portal/shipments)
│   │       ├── track/page.js      # Tracking (/portal/track)
│   │       ├── claims/page.js     # Claims (/portal/claims)
│   │       ├── profile/page.js    # Profile settings (/portal/profile)
│   │       └── billing/page.js    # Billing (/portal/billing)
│   ├── components/
│   │   ├── Sidebar.js             # Portal sidebar navigation
│   │   ├── Topbar.js              # Portal top bar
│   │   └── FedexConnectModal.js   # FedEx account connect flow (EULA + Factor 1/2 MFA)
│   ├── lib/
│   │   ├── api.js                 # API helper (fetchAPI with JWT auth)
│   │   ├── carriers.js            # Carrier data (colors, names, abbreviations)
│   │   └── fedexCompliance.js     # FedEx disclaimer text + placeholder EULA text
│   └── public/
│       ├── logo.svg, logo-white.svg, logo.png
├── backend/                        # Node.js + Express API (port 4000)
│   └── src/
│       ├── index.js               # Express app
│       ├── carriers/              # Carrier adapter pattern (5 adapters)
│       ├── models/                # Mongoose schemas/models (one file per collection)
│       ├── services/              # Business logic
│       ├── routes/                # API route handlers
│       ├── middleware/            # Auth, validation, error handling
│       ├── utils/                 # Helpers
│       ├── scripts/dropDatabase.js
│       └── seed.js                # Demo data
└── APIs/                           # Carrier API documentation (PDFs)
```

## Running the Frontend (Next.js)
```bash
cd frontend
npm install              # Install dependencies (first time only)
npm run dev              # Start dev server on port 3000
```

## Running the Backend
```bash
# 1. Start MongoDB (must be running before the backend)
brew services start mongodb-community@6.0
# One-time only, on a fresh machine: MongoDB needs to run as a (single-node) replica set
# so multi-document transactions work (used by booking/quote creation). Add to
# /opt/homebrew/etc/mongod.conf:
#   replication:
#     replSetName: rs0
# then `brew services restart mongodb-community@6.0` and run once:
mongosh --eval "rs.initiate()"

# 2. Start the backend
cd backend
npm install              # Install dependencies (first time only)
npm run db:seed          # Seed demo data (first time only)
npm run dev              # Start server on port 4000 (with nodemon auto-reload)
```

## Running Both Together
```bash
# Terminal 1: Backend (must be started first)
brew services start mongodb-community@6.0
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```
Then open http://localhost:3000 in your browser.

## Stopping Everything
```bash
# Stop the frontend: Ctrl+C in the terminal running frontend npm run dev
# Stop the backend: Ctrl+C in the terminal running backend npm run dev
# Stop MongoDB:
brew services stop mongodb-community@6.0
```

## Demo Credentials
- **User:** john@acmecorp.com / `demo1234`
- **Admin:** admin@iffcargo.com / `admin1234`
- Login requires a 6-digit code after password (two-factor). No real email is sent — in dev the code is printed to the **backend console** as `[DEV EMAIL] To: ... code: ...`.

## Tech Stack
- **Frontend:** Next.js 16 (App Router), React, CSS Modules
- **Backend:** Node.js, Express, Mongoose ODM
- **Database:** MongoDB 6.0 (via Homebrew, running as a single-node replica set for transactions)
- **Auth:** JWT + bcrypt (token stored in localStorage), plus a mandatory email-OTP second factor after password login
- **Validation:** Zod
- **Fonts:** Outfit (display), DM Sans (body), JetBrains Mono (mono)

## Frontend Architecture (Next.js)
- **Framework:** Next.js 16 with App Router (all pages are `'use client'`)
- **Styling:** CSS Modules (`.module.css` files) — pixel-for-pixel copy of original HTML designs
- **State:** React hooks (`useState`, `useEffect`) — no global state library needed
- **API calls:** `lib/api.js` wraps `fetch()` with JWT token from localStorage
- **Auth guard:** Portal layout redirects to `/login` if no token present
- **Rate simulation:** Client-side deterministic seeded RNG as fallback when backend is unavailable
- **Route structure:** Public pages at root (`/`, `/login`, `/register`), protected pages under `/portal/*`

### Frontend Pages
| Route | Description |
|-------|-------------|
| `/` | Landing page (hero, services, footer) |
| `/login` | Split-screen login with API auth + email-OTP two-factor step |
| `/register` | 3-step registration (info → company → EULA) |
| `/portal` | Dashboard (stats, quick action, recent shipments) |
| `/portal/quote` | Rate comparison — 6 types (envelope, parcel, LTL = instant; FTL, air, ocean = spot rate) — FedEx rate cards show the required FedEx disclaimer |
| `/portal/shipments` | Shipment list with status filters, search, expandable detail rows |
| `/portal/track` | Tracking number lookup with timeline visualization |
| `/portal/claims` | Claims list + modal to file new claim |
| `/portal/profile` | Personal info, company info, change password, **Connect FedEx Account** (EULA + Factor 1/2 MFA) |
| `/portal/billing` | Payment methods, invoices table, spending stats |

## Database (MongoDB)
- **Engine:** MongoDB 6.0 (installed via Homebrew), running as a single-node replica set
  (`rs0`) — required for the multi-document transactions used in booking/quote creation.
- **Database name:** `iffcargo`
- **Connection string:** `mongodb://localhost:27017/iffcargo?replicaSet=rs0` (the
  `?replicaSet=rs0` is required, not optional — without it the driver won't route
  transactions correctly)
- **ODM:** Mongoose (schemas at `backend/src/models/*.js`, one file per collection)
- **Start MongoDB:** `brew services start mongodb-community@6.0`
- **Stop MongoDB:** `brew services stop mongodb-community@6.0`
- **View data visually:** `mongosh iffcargo` (CLI), or install **MongoDB Compass**
  (`brew install --cask mongodb-compass`) for a GUI — there's no built-in equivalent to
  Prisma Studio, so no `db:studio` script exists anymore.
- **Reset database:** `cd backend && npm run db:reset` (drops the database, re-seeds)
- **Re-seed data:** `cd backend && npm run db:seed`
- **No migrations:** MongoDB is schemaless — there's no `db:migrate` step. Schema
  validation and indexes come from each model file's Mongoose schema declaration and are
  applied automatically the first time the app connects.

### Why MongoDB
Per the client's Customer Portal Guide, which specifies MongoDB as the target database.
Reasons that hold up given how this app is actually used:
- The data model keeps growing new, loosely-related collections as external integrations
  land in phases (Address, Payment, ClaimDocument, Carrier, MarkupRule, ActivityLog) —
  a flexible schema suits that better than a rigid one needing a migration per addition.
- Mongoose sessions (`mongoose.startSession()` + `session.withTransaction(...)`) still give
  the atomicity guarantees the app actually needs (Booking+Shipment, Quote+QuoteRate) once
  running as a replica set — losing nothing on that front versus Postgres.
- Several records (embedded `NotificationPreference` on `User`, embedded `InvoiceItem[]` on
  `Invoice`) are always fetched together with their parent and never queried independently —
  a natural fit for embedded documents rather than a join.
- Scales horizontally without an architecture change.

## Database Schema (22 collections)

### Users & Companies
| Collection | What it stores |
|-------|---------------|
| **User** | email, passwordHash, firstName, lastName, phone, role (`customer`/`company_admin`/`iff_staff`/`iff_admin`), company (ref), embedded `notifications` (shipmentBooked, outForDelivery, delivered, exceptions, spotRates, claims, promotional) |
| **Company** | name, country, province, city, postalCode, shippingType |
| **Address** | Saved address book, shared across a company — company (ref), createdBy, contactName, companyName, phone, street/city/province/postalCode/country, isResidential, isVerified |

### Quoting
| Collection | What it stores |
|-------|---------------|
| **Quote** | quoteNumber, shipmentType, origin/dest (city, postal, country), weight, pieces, dimensions, freightClass, currency, pickupDate, declaredValue, commodity, accessorials, status, expiresAt |
| **QuoteRate** | One doc per carrier result — quote (ref), carrierId, carrierName, serviceName, baseRate (cost), displayRate (marked up), transitDays, estimatedDelivery, isLiveRate, isBestRate |
| **SpotRateRequest** | For FTL/air/ocean quotes needing manual pricing — requestNumber, shipment details, origin/dest ports (ocean), commodity, specialNotes, status, quotedRate, quotedAt |

### Shipping
| Collection | What it stores |
|-------|---------------|
| **Booking** | The commercial record — bookingNumber, quote + quoteRate (ref), user, company (snapshot), carrier info, costRate/sellRate (frozen at booking time), currency, customerReference, paymentStatus, status, pickup confirmation |
| **Shipment** | The physical record — trackingNumber, user, company (snapshot), booking (ref), carrier info, full origin/dest details, weight/pieces/dims, status (`pending`/`in_transit`/`delivered`), estimatedDelivery, actualDelivery |
| **TrackingEvent** | Per-shipment timeline — shipment (ref), event name, location, timestamp, description |

### Claims
| Collection | What it stores |
|-------|---------------|
| **Claim** | claimNumber, trackingNumber, carrier, claimType, shipmentDate, amountClaimed, commodity, description, notes, documents, status (`open`/`under_review`/`approved`/`closed`) |
| **ClaimDocument** | Evidence pointers (not the files themselves) — claim (ref), uploadedBy, documentType, fileName, mimeType, fileSizeBytes, storageKey. Schema-only scaffolding — no real file storage/upload exists yet. |

### Money
| Collection | What it stores |
|-------|---------------|
| **PaymentMethod** | type (visa/mastercard), last4 digits, expiry, isDefault |
| **Payment** | One doc per charge attempt — booking (ref), user, amount, currency, qbTransactionId, status (`pending`/`succeeded`/`failed`/`refunded`), failureReason. Schema-only scaffolding — no real QuickBooks integration exists yet. |
| **Invoice** | invoiceNumber, totalAmount, currency, status (`pending`/`paid`), issuedAt, paidAt, embedded `items` (description, amount, shipment ref) |

### FedEx Integrator Compliance
| Collection | What it stores |
|-------|---------------|
| **FedexAccountConnection** | A customer's own FedEx account connection — fedexAccountNumber, embedded shippingAddress, eulaAcceptedAt, status (`awaiting_factor2`/`verified`/`failed`/`locked`), factor2Method (`pin_email`/`pin_sms`/`pin_call`/`invoice`), pinCodeHash + pinExpiresAt, attempts, lockedUntil (24h lockout after 5 failed attempts), mocked childKey/childSecret once verified |

### Auth / Security
| Collection | What it stores |
|-------|---------------|
| **TwoFactorCode** | Login second factor — bcrypt-hashed 6-digit codeHash, expiresAt (10 min), attempts, consumedAt |

### Carriers & Pricing
| Collection | What it stores |
|-------|---------------|
| **Carrier** | carrierId, name, enabled, providesLiveRates, shipmentTypes, credentialsRef — data-driven policy layered on top of the unchanged `backend/src/carriers/*.adapter.js` code |
| **MarkupRule** | minAmount, maxAmount, markupMultiplier, effectiveFrom/effectiveTo, isActive — old tiers are retired (not overwritten) when changed, so historical quotes stay explainable |

### Operational
| Collection | What it stores |
|-------|---------------|
| **ActivityLog** | user, company, action, details (Mixed) — written via `activityLog.service.js`'s `logActivity()`, called on login, FedEx EULA acceptance, booking creation, and markup-rule changes |

### Relationships
```
User → Company (many-to-one)
Company → Addresses, Bookings
User → Quotes → QuoteRates
User → Bookings → Shipment → TrackingEvents
User → Claims → ClaimDocuments
User → PaymentMethods, Payments
User → Invoices (embedded InvoiceItems)
User → SpotRateRequests
User → FedexAccountConnections, TwoFactorCodes
Quote → Booking (one-to-one, when booked) → Shipment (one-to-one, once carrier confirms)
```

### Not yet in DB (needed for production)
- Real QuickBooks charge flow behind the `Payment` collection (schema exists, not wired up)
- Real file storage behind the `ClaimDocument` collection (schema exists, not wired up)
- Real carrier API credentials storage (`Carrier.credentialsRef` is a pointer, not the secret)
- Email verification status
- Password reset tokens

## Key API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Server status + carrier availability |
| `POST /api/rate/all` | Get rates from all 5 carriers (core feature) |
| `POST /api/rate/fedex` | Legacy FedEx endpoint (frontend compatibility) |
| `POST /api/auth/register` | User registration |
| `POST /api/auth/login` | Login step 1 — verifies password, emails a 6-digit code, returns `{twoFactorRequired, pendingToken}` (no JWT yet) |
| `POST /api/auth/verify-otp` | Login step 2 — verifies the code, returns the real JWT |
| `POST /api/auth/resend-otp` | Resend the login verification code |
| `POST /api/bookings` | Book a quote (creates a Booking + the resulting Shipment). Body adds `recipient` (required) and `shipper` contact/street, `holdAtLocation`, `dangerousGoods` when the quoted options need them |
| `GET /api/fedex/locations?quoteRateId=` | FedEx locations near the quote's destination that accept Hold at Location for the quoted service |
| `GET /api/bookings` | List user bookings |
| `GET /api/shipments` | List user shipments (filter: ?status=in_transit) — read-only; booking happens via `/api/bookings` |
| `GET /api/tracking/:number` | Track a shipment |
| `POST /api/claims` | Submit a cargo claim |
| `GET /api/claims` | List user claims |
| `GET /api/billing/stats` | Spending stats (month/year) |
| `GET /api/billing/invoices` | Invoice history |
| `GET/PUT /api/profile` | User profile management |
| `POST /api/spot-rates` | Submit spot rate request (FTL/air/ocean) |
| `POST /api/fedex-account` | Start a FedEx account connection (EULA acceptance + Factor 1: account number/address) |
| `GET /api/fedex-account` | List the user's connected FedEx accounts |
| `POST /api/fedex-account/:id/factor2/start` | Choose Factor 2 method (PIN via email/SMS/call, or invoice) and send/prepare it |
| `POST /api/fedex-account/:id/factor2/verify-pin` | Verify the PIN code |
| `POST /api/fedex-account/:id/factor2/verify-invoice` | Verify via FedEx invoice details |
| `DELETE /api/fedex-account/:id` | Disconnect a FedEx account |
| `GET/POST /api/addresses` | List / create saved company addresses |
| `PUT/DELETE /api/addresses/:id` | Update / delete a saved address |

## Carrier Adapter Pattern
Each carrier is in `backend/src/carriers/<name>.adapter.js` implementing a common interface:
- `getRates(params)` — returns rates for given shipment
- `getTracking(trackingNumber)` — returns tracking info
- `bookShipment(details)` — books with the carrier

All adapters are currently **mocked**. To enable live API calls, add credentials to `backend/.env` — the adapter auto-switches when keys are present.

### Adding a New Carrier
1. Create `backend/src/carriers/<name>.adapter.js` extending `CarrierAdapter`
2. Register it in `backend/src/carriers/index.js`
3. Add env vars to `.env` for live API credentials
4. The carrier automatically appears in `/api/rate/all` results

## FedEx Integrator Compliance (mocked)
Implements the customer-facing parts of FedEx's Integrator program requirements (see `APIs/` for the source guidance doc): a customer can connect their own FedEx account from `/portal/profile`, gated by EULA acceptance and FedEx's Factor 1 + Factor 2 "End User registration" MFA flow. No live FedEx Account Registration API call is made — this mirrors how the carrier adapters are mocked.

- **Backend:** `backend/src/services/fedexAccount.service.js` + `backend/src/routes/fedexAccount.routes.js` (mounted at `/api/fedex-account`). Factor 2 PIN codes are bcrypt-hashed, 10-minute expiry, 5 attempts before a 24-hour lockout — same shape as FedEx's spec. PIN codes are "delivered" via `console.log('[DEV FEDEX PIN] ...')` (no real email/SMS provider). Invoice validation is mocked (rejects invoices >90 days old or with missing/invalid fields). On success, a mock `child_key`/`child_secret` is generated via `crypto.randomBytes`.
- **Frontend:** `frontend/components/FedexConnectModal.js` drives the 5-step UI (EULA → Factor 1 → Factor 2 choice → PIN/invoice entry → success), used from `/portal/profile`. `frontend/lib/fedexCompliance.js` exports the required FedEx disclaimer text (shown wherever FedEx marks/rates appear, e.g. `/portal/quote`) and the EULA text.
- ⚠️ **The EULA text in `fedexCompliance.js` is placeholder legal text**, not FedEx's actual End User License Agreement — it must be replaced with the real text from the FedEx Developer Portal before any real FedEx Integrator validation submission.

## Login Two-Factor Authentication
After a correct password, login requires a 6-digit email code before a session JWT is issued — no SMTP provider is configured, so delivery is mocked via `backend/src/services/email.service.js` (`console.log('[DEV EMAIL] ...')`).

- **Flow:** `POST /api/auth/login` validates the password and returns `{ twoFactorRequired: true, pendingToken }` (a purpose-scoped, 10-minute JWT — not usable as a normal auth token). The frontend (`frontend/app/login/page.js`) then shows a code-entry screen and calls `POST /api/auth/verify-otp` with `{ pendingToken, code }` to get the real JWT.
- **Storage:** `TwoFactorCode` table — bcrypt-hashed code, 10-minute expiry, 5 attempts before requiring a resend (`POST /api/auth/resend-otp`).
- Logic lives in `backend/src/services/auth.service.js` (`login`, `verifyLoginOtp`, `resendLoginOtp`).

## Markup Engine (backend/src/services/markup.service.js)
DB-backed via the `MarkupRule` collection (not hardcoded) — `applyMarkup()` queries the
active tiers. The current tiers, seeded by `backend/src/seed.js`:
```
≤$100  → ×1.70 (70% markup)
≤$250  → ×1.55 (55% markup)
≤$500  → ×1.40 (40% markup)
≤$1000 → ×1.30 (30% markup)
≤$2500 → ×1.20 (20% markup)
>$2500 → ×1.15 (15% markup)
```
Changing a tier retires the old row (`isActive: false`, `effectiveTo` set) and inserts a new
one rather than overwriting it, via `markup.service.js`'s `updateMarkupTier()` — not yet
exposed on a route (no admin UI built yet), but the service function is ready.

## Production Deployment

### Database Options for Production
| Provider | Free Tier | Paid | Best For |
|----------|-----------|------|----------|
| **MongoDB Atlas** | 512MB shared cluster | $9-57/mo | Purpose-built for MongoDB — managed replica sets out of the box, cheapest/simplest to start |
| **Railway** | 1GB, $5 credit/mo | Usage-based | Self-hosted Mongo container alongside the backend, deploy together |
| **DigitalOcean Managed MongoDB** | None | $15/mo | Reliable, daily backups included |
| **AWS DocumentDB** | None | $15-50/mo | MongoDB-compatible, AWS ecosystem |
| **Azure Cosmos DB (Mongo API)** | $200 credit (30 days) | $25-50/mo | Microsoft ecosystem, MongoDB-compatible |

### Backend Hosting Options
| Provider | Cost | Notes |
|----------|------|-------|
| **Railway** | Free → $5/mo | Easiest for Express — zero code changes, deploy from Git |
| **Render** | Free (spins down) → $7/mo | Simple, auto-deploy from Git |
| **Vercel** | Free → $20/mo | Great for frontend; backend needs serverless conversion |
| **DigitalOcean App Platform** | $5/mo | Simple traditional hosting |
| **AWS (EC2/ECS)** | $10+/mo | Full control, complex setup |

### Recommended Deployment Strategy
| Stage | Setup |
|-------|-------|
| **Now (development)** | Local MongoDB (single-node replica set) + `npm run dev` |
| **MVP / first deploy** | **MongoDB Atlas** (managed replica set, free tier to start) + **Railway** (backend) |
| **Growing / production** | **Vercel** (frontend CDN) + **MongoDB Atlas** (database) + **Railway** (backend API) |

### Switching to Production Database
No code changes needed — just update `.env`:
```env
# Local (current)
MONGODB_URI="mongodb://localhost:27017/iffcargo?replicaSet=rs0"

# Production example (MongoDB Atlas):
MONGODB_URI="mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/iffcargo?retryWrites=true&w=majority"
```
Atlas clusters are already provisioned as replica sets, so transactions work without any
extra setup — no `replicaSet=rs0` param needed against Atlas (the `mongodb+srv://` scheme
handles that). No migration step to run — Mongoose builds indexes automatically on connect.

### Why Not Convex?
Convex is an all-in-one backend platform (database + functions + auth in TypeScript). Not recommended for IFF because:
- Would require rewriting the entire backend from scratch (moving from MongoDB/Mongoose to
  Convex's own document store and function model is still a full rewrite, not a lighter
  lift just because both are document-oriented — the query/mutation model, deployment
  model, and auth integration are all different)
- Vendor lock-in — can't move without rewriting
- Charges per function call — rate comparison is API-call-heavy

### Why Not Vercel for Backend?
Vercel is ideal for hosting the **frontend** (static HTML on CDN). For the Express backend:
- Requires converting to serverless functions (code restructuring)
- 10s function timeout on free tier — carrier API calls can be slow
- Cold starts add latency
- Railway runs our Express code as-is with zero changes

## Frontend ↔ Backend Connection
- The Next.js frontend runs on `http://localhost:3000`
- It calls the backend API at `http://localhost:4000` (hardcoded in `frontend/lib/api.js`)
- All API calls include JWT token from localStorage (set at login)
- The frontend works without the backend (shows demo/mock data) but needs it for real auth and rate fetching
- CORS is enabled on the backend for localhost origins

## Conventions
- Routes in `src/routes/*.routes.js`, services in `src/services/*.service.js`
- All protected endpoints require `Authorization: Bearer <token>` header
- Errors return `{ error: { code, message, details? } }`
- Pagination returns `{ data, pagination: { page, limit, total } }`

---

## Available Carriers in Canada

### Currently Integrated (5 carriers — mocked)
| Carrier | ID | Services | API Status |
|---------|----|----------|------------|
| FedEx | `fedex` | Express, Ground, Freight LTL, International | Mock (have setup docs) |
| XPO Logistics | `xpo` | LTL, Cross-border | Mock |
| Day & Ross | `dayross` | LTL, Parcel, Express | Mock (API form submitted, acct #197742) |
| Manitoulin Transport | `manitoulin` | LTL, Northern/remote Canada | Mock |
| Polaris Transportation | `polaris` | LTL, Ontario/Quebec/Western/US NE | Mock |

### Priority Carriers to Add Next
| Priority | Carrier | Why | API |
|----------|---------|-----|-----|
| 1 | Purolator | Largest Canadian-owned courier, parcel + freight | Yes — developer.purolator.com |
| 2 | UPS | Second-largest global carrier, full API suite | Yes — developer.ups.com |
| 3 | Canpar Express | Popular Canadian parcel/ground (TFI subsidiary) | Yes |
| 4 | Canada Post | Essential for residential/rural, cheapest for light parcel | Yes — developer.canadapost.ca |
| 5 | TST Overland / Canadian Freightways | TFI International brands, strong Canadian LTL | Yes |

### All Courier & Parcel Carriers in Canada
| Carrier | Services | API |
|---------|----------|:---:|
| FedEx | Express, Ground, Home Delivery, International | Yes |
| UPS | Ground, Express, International | Yes |
| Purolator | Express, Ground, Freight | Yes |
| Canada Post | Regular, Xpresspost, Priority, International | Yes |
| DHL Express | International express, domestic | Yes |
| Canpar Express | Ground, Express (TFI subsidiary) | Yes |
| Loomis Express | Ground, Express (western Canada strong) | Yes |
| GLS Canada | Parcel delivery | Yes |
| IntelCom | Last-mile delivery (Amazon partner) | Limited |
| Nationex | Parcel, same-day (Quebec/Ontario) | Yes |

### All LTL Freight Carriers in Canada
| Carrier | Coverage | API |
|---------|----------|:---:|
| Day & Ross | All Canada + cross-border US | Yes |
| Manitoulin Transport | All Canada, specializes in remote/northern | Yes |
| Polaris Transportation | Ontario, Quebec, Western Canada, US NE | Yes |
| XPO Logistics | Canada + US cross-border | Yes |
| FedEx Freight | Canada + US LTL | Yes |
| Kindersley Transport | Western Canada, Alberta focus | Limited |
| TST Overland (TFI) | Canada-wide LTL | Yes |
| ABF Freight | Cross-border Canada-US | Yes |
| R+L Carriers | Cross-border Canada-US | Yes |
| Saia | Cross-border, Southern US to Canada | Yes |
| Old Dominion (ODFL) | Cross-border Canada-US | Yes |
| Fastfrate | Canada-wide, intermodal | Limited |
| Midland Transport | Atlantic Canada, Quebec, Ontario | Yes |
| Canadian Freightways (TFI) | Western Canada | Yes |
| Rosenau Transport | Alberta, BC, Saskatchewan | Limited |
| Estes (formerly YRC/Vitran) | Cross-border Canada-US | Yes |
| Purolator Freight | Heavy parcel + LTL | Yes |

### FTL (Full Truckload) Carriers in Canada
| Carrier | Coverage | API |
|---------|----------|:---:|
| TransX | Canada-wide + cross-border | Limited |
| Challenger Motor Freight | Canada + US | Limited |
| Bison Transport | Canada-wide, western strong | Limited |
| Heartland Express | Cross-border | Yes |
| Schneider National | Canada-US cross-border | Yes |
| J.B. Hunt | Cross-border | Yes |
| Trimac | Bulk/specialized, Canada-wide | Limited |

### Day & Ross API Details (from submitted form)
- **Account:** #197742 (International Freight Forwarders)
- **API Type:** REST (went live March 2026), OAuth authentication
- **Developer:** Uzair Amir (uzair@iffcargo.com)
- **API Email:** api@iffcargo.com
- **Services approved:** Create Shipment, Create Quote, Get Rate, Get Shipment, Get Shipment Status, Get Image PDF, Get Invoice History, Cancel Shipment
- **Contact:** web.support@dayross.com

### FedEx API Details (from product worksheet)
- **Key APIs for IFF:** Comprehensive Rates & Transit Times API, Freight LTL API, Ship API, Track API, Pickup Request API
- **Region:** AMERS (US, Canada, Latin America)
- **Canada-specific:** FedEx Economy (CA only), International Ground (CA↔US), rate quotes with/without Canadian tax
- **Portal:** developer.fedex.com
- **Important:** Do not hard-code business logic — use Service Availability API for dynamic service lists
