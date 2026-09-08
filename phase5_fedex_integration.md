# Phase 5 — FedEx Integrator Requirements

This phase addresses all FedEx Integrator Provider Validation (PIW) requirements. All API
integrations (Rate, Ship, Track, Address Validation) are working against the FedEx sandbox.
Test cases are complete and Brand UI screenshots have been captured. Remaining work is
completing the PIW paperwork and submitting to FedEx.

IFF ships on IFF's own account (1st party model) — IFF is both integrator and shipper.
End User Registration (EULA + Factor 1/2 MFA) is not required since customers do not
connect their own FedEx accounts.

---

## Requirement 1: FedEx EULA shown at sign-up with acceptance record

**Status: Done**

Every customer sees the FedEx End User License Agreement during post-signup onboarding and
must explicitly accept it before accessing the portal.

### What was built

**Frontend — onboarding step 2 (agreements):**
- File: `frontend/app/portal/onboarding/page.js`
- The second step of the 2-step onboarding flow shows three agreements:
  1. IFF Cargo Terms of Service (checkbox)
  2. FedEx End User License Agreement (scrollable text box + checkbox)
  3. Authorization to ship on user's behalf (checkbox)
- All three must be checked before the "Complete setup" button is enabled.
- The FedEx EULA text is the **real** agreement: FedEx Form No. 2002382 v 4 June 2024 Rev
  (3rd Party Hosted), 23 sections, 11 pages. Source PDF stored at
  `APIs/FedEx_End_User_License_Agreement_Distributed_Technology.pdf`.

**Frontend — EULA text source:**
- File: `frontend/lib/fedexCompliance.js`
- Exports `FEDEX_EULA_TEXT` (full agreement text) and `FEDEX_DISCLAIMER` (trademark notice
  shown on FedEx rate cards).
- Previously contained placeholder text; replaced with the real EULA extracted from the PDF.

**Backend — acceptance recording:**
- File: `backend/src/routes/profile.routes.js` — `POST /api/profile/accept-terms`
- Records on the User document:
  - `termsAcceptedAt` — timestamp of IFF terms acceptance
  - `termsAcceptedFromIp` — IP address at time of acceptance
  - `fedexTermsAcceptedAt` — timestamp of FedEx EULA acceptance
  - `fedexTermsAcceptedFromIp` — IP address at time of FedEx acceptance
- Logs acceptance to the `ActivityLog` collection (audit trail).

**Backend — onboarding gate:**
- File: `backend/src/routes/profile.routes.js` — `GET /api/profile/onboarding-status`
- Returns `{ needsOnboarding, needsTerms }`. If either `termsAcceptedAt` or
  `fedexTermsAcceptedAt` is missing, `needsTerms: true` and the frontend redirects the
  user back to the onboarding flow.
- IFF staff/admin roles skip the onboarding check.

**User model fields added:**
- File: `backend/src/models/User.js`
- `termsAcceptedAt` (Date), `termsAcceptedFromIp` (String)
- `fedexTermsAcceptedAt` (Date), `fedexTermsAcceptedFromIp` (String)

### Files changed
| File | Change |
|------|--------|
| `frontend/app/portal/onboarding/page.js` | New file — 2-step onboarding (personal + company → agreements) |
| `frontend/app/portal/onboarding/page.module.css` | New file — onboarding styles |
| `frontend/lib/fedexCompliance.js` | Replaced placeholder EULA with real FedEx agreement |
| `backend/src/routes/profile.routes.js` | Added `accept-terms` and `onboarding-status` endpoints |
| `backend/src/models/User.js` | Added terms acceptance fields |
| `backend/src/seed.js` | Demo users pre-accepted terms |
| `frontend/app/portal/layout.js` | Added onboarding gate (redirect if terms not accepted) |

---

## Requirement 2: Identity verification at sign-up

**Status: Done (via Auth0)**

The customer portal guide says: "Auth0 gives us identity verification for free." Auth0 sends
email verification on signup — the user must verify their email address before they can log in.

### What was built

- Auth0 was integrated in Phase 3 (`phase3_auth0_migration_notes.md`).
- Login/register redirect to Auth0's Universal Login page.
- Auth0 handles email verification natively.

### Confirmed

- Auth0 email verification is **enabled** — verified in the Auth0 dashboard (Branding →
  Email Templates → "Verification Email (Link)" template status is ON).
- Auth0 sends a verification email with a link when users sign up or log in for the first
  time. The `email_verified` flag is set on the user's profile when they follow the link.
- **Production note:** Currently using Auth0's built-in email provider (dev/trial only).
  Must configure a Custom Email Provider (SendGrid, Mailgun, AWS SES) under Branding →
  Email Provider before going live — otherwise emails may not deliver reliably.

---

## Requirement 3: Estimate disclaimer on every quote

**Status: Done**

Every quote path shows a disclaimer that rates are estimates and may change.

### What was built

**Instant quotes (envelope, parcel, LTL):**
- File: `frontend/app/portal/quote/page.js`
- A disclaimer appears above the rate results after clicking "Get quotes":
  > "All rates shown are estimates and may be subject to adjustment based on actual shipment
  > weight, dimensions, and carrier surcharges."

**Spot rate requests (FTL, air, ocean):**
- Same file, above the "Send spot rate request" button:
  > "Quoted rates are estimates and may be subject to adjustment based on actual shipment
  > details and carrier surcharges."

**FedEx trademark notice:**
- Each FedEx rate card also shows: "The FedEx service marks are owned by Federal Express
  Corporation and are used by permission." (from `FEDEX_DISCLAIMER` in `fedexCompliance.js`).

### Files changed
| File | Change |
|------|--------|
| `frontend/app/portal/quote/page.js` | Added estimate disclaimers above rate results and spot rate submit |

---

## Requirement 4: Address validation before booking

**Status: Done (sandbox)**

FedEx Address Validation API is integrated into both the quote flow (frontend) and the
booking flow (backend server-side gate).

### What was built

**FedEx OAuth2 token service:**
- File: `backend/src/services/fedexAuth.service.js`
- Acquires OAuth2 bearer tokens from `https://apis-sandbox.fedex.com/oauth/token` using
  `client_credentials` grant with `FEDEX_API_KEY` and `FEDEX_SECRET_KEY`.
- Caches tokens in memory with automatic refresh (60-second buffer before expiry).
- Handles concurrent requests (single in-flight refresh promise to avoid duplicate calls).
- Switches between sandbox (`apis-sandbox.fedex.com`) and production (`apis.fedex.com`)
  based on `FEDEX_ENVIRONMENT` env var.

**Address validation service:**
- File: `backend/src/services/fedexAddressValidation.service.js`
- Calls `POST /address/v1/addresses/resolve` on the FedEx API.
- Parses the response and returns a normalized result:
  ```js
  {
    valid: true | false,
    classification: 'BUSINESS' | 'RESIDENTIAL' | 'UNKNOWN',
    effectiveAddress: { streetLines, city, stateOrProvinceCode, postalCode, countryCode },
    changes: ['CITY', 'POSTAL_CODE', ...],  // what FedEx corrected
    attributes: { matched, validlyFormed, countrySupported, addressType, addressPrecision },
  }
  ```
- Uses FedEx's `attributes.Matched`, `attributes.ValidlyFormed`, and
  `attributes.CountrySupported` to determine validity.
- If the FedEx API is unreachable, returns `{ valid: null, fallback: true }` — never blocks
  users due to FedEx downtime.

**API route:**
- File: `backend/src/routes/addressValidation.routes.js`
- `POST /api/address-validation` — Zod-validated, uses `optionalAuth` (works for both
  logged-in and guest users).
- Request body: `{ streetLines, city, stateOrProvinceCode?, postalCode, countryCode }`

**Frontend integration (quote page):**
- File: `frontend/app/portal/quote/page.js`
- When the user clicks "Get quotes":
  1. Button shows "Validating addresses..." state
  2. Origin and destination are validated in parallel via `POST /api/address-validation`
  3. Results shown below each address column:
     - **Green** (valid): "Origin address verified (business)"
     - **Amber** (suggestion): "FedEx suggests: TORONTO, ON M5V3A8" + "Accept suggestion" button
     - **Red** (invalid): "Address could not be validated"
  4. If either address is invalid, rates are NOT fetched — user must correct first
  5. If FedEx API is down (`fallback: true`), validation is skipped and rates are fetched
- Validation state clears when user edits any address field or switches shipment type.

**Server-side booking gate:**
- File: `backend/src/services/booking.service.js`
- Before payment/booking transaction, validates both origin and destination addresses.
- If either returns `valid: false`, throws a `ValidationError` blocking the booking.
- If FedEx API is down, allows booking to proceed (graceful degradation).
- This is a safety net — even if someone bypasses the frontend validation, the booking is
  still gated server-side.

**Validation styles:**
- File: `frontend/app/portal/quote/page.module.css`
- `.validationOk` — green background/border
- `.validationError` — red background/border
- `.validationSuggestion` — amber background/border with "Accept suggestion" button
- `.btnAcceptSuggestion` — amber button style

### Environment variables
```
FEDEX_API_KEY=<from FedEx Developer Portal>
FEDEX_SECRET_KEY=<from FedEx Developer Portal>
FEDEX_ACCOUNT_NUMBER=<sandbox test account number>
FEDEX_ENVIRONMENT=sandbox   # or 'production' after approval
```

These are read by `backend/src/config/env.js` (already configured since Phase 1).

### Files changed
| File | Change |
|------|--------|
| `backend/src/services/fedexAuth.service.js` | New — OAuth2 token management |
| `backend/src/services/fedexAddressValidation.service.js` | New — FedEx Address Validation API wrapper |
| `backend/src/routes/addressValidation.routes.js` | New — `POST /api/address-validation` |
| `backend/src/routes/index.js` | Registered address-validation route |
| `backend/src/services/booking.service.js` | Added server-side address validation gate |
| `frontend/app/portal/quote/page.js` | Validation UI + flow integration |
| `frontend/app/portal/quote/page.module.css` | Validation result styles |

### Testing
Tested against FedEx sandbox (`apis-sandbox.fedex.com`):
- OAuth token acquisition: working
- Toronto, CA (M5V3A8): valid, matched, precision: Street
- Chicago, US (60601): valid, matched, precision: Street
- FedEx HQ (10 FedEx Pkwy, Collierville 38017): valid, matched, precision: Street

Note: The FedEx sandbox returns `"VIRTUAL.RESPONSE"` and is lenient (accepts most addresses).
Production will provide real validation with proper rejections of invalid addresses.

---

## Requirement 5: Live FedEx Rate API integration

**Status: Done (sandbox)**

The FedEx Comprehensive Rates & Transit Times API is integrated into the carrier adapter.
When `FEDEX_API_KEY` is set, FedEx returns real rates from the API instead of mock data.
All other carriers still use mock data until their APIs are integrated.

### What was built

**FedEx Rate API call (`_getLiveRates`):**
- File: `backend/src/carriers/fedex.adapter.js`
- When `FEDEX_API_KEY` is set (`isLive` returns true), `getRates()` calls the real FedEx
  `POST /rate/v1/rates/quotes` endpoint. If the API call fails, it gracefully falls back
  to mock rates.
- Builds the FedEx rate request body with:
  - Account number, shipper/recipient addresses, packaging type, ship date
  - Package line items with weight and optional dimensions (length/width/height)
  - Special services mapped from internal accessorial names to FedEx codes
  - Customs clearance details for international shipments (CA↔US) — commodity description,
    country of manufacture, customs value, duties payment type
- Requests both `LIST` and `ACCOUNT` rate types with transit time details.

**Response parsing (`_parseRateResponse`):**
- Extracts rates from `data.output.rateReplyDetails`, taking the first `totalNetCharge`
  per service (prefers ACCOUNT rate over LIST).
- Maps FedEx service type codes to friendly names (e.g., `FEDEX_EXPRESS_SAVER` → "Express
  Saver", `FEDEX_INTERNATIONAL_PRIORITY` → "International Priority").
- Extracts transit times from `commit.transitDays`, `operationalDetail.transitTime`, or
  calculates business days between ship date and `commit.dateDetail.dayFormat`.
- Falls back to default transit estimates per service type when FedEx doesn't return
  transit data (common for international sandbox responses).
- Filters services by shipment type: envelope = express only, parcel = express + ground,
  LTL = freight.
- Deduplicates by service name, keeping the lowest rate per service.
- Sorts results by rate (cheapest first).

**Accessorial mapping (`_mapAccessorialsToFedEx`):**
- Maps internal accessorial names to FedEx special service type codes:
  - `residential` → `HOME_DELIVERY_PREMIUM`
  - `saturday` → `SATURDAY_DELIVERY`
  - `signature` → `SIGNATURE_OPTION`
  - `hazmat` → `DANGEROUS_GOODS`
  - `inside_delivery` → `INSIDE_DELIVERY`
  - `appointment` → `APPOINTMENT_DELIVERY`
  - `liftgate_pickup` → `LIFTGATE_PICK_UP`
  - `liftgate_delivery` → `LIFTGATE_DELIVERY`

**Auth service updates (`fedexAuth.service.js`):**
- Switched from Node.js `fetch` (undici) to `https` module for all FedEx HTTP calls.
  The MongoDB driver's network layer interferes with undici-based fetch in Node.js v26,
  causing 401 errors on FedEx's API Gateway. The `https` module is unaffected.
- Exported `httpsPost(url, body, headers)` helper — handles gzip/deflate response
  decompression, JSON parsing, and error reporting. Used by both the auth service and the
  rate adapter.
- Added `User-Agent: IFFCargo/1.0` header to all requests — FedEx's Layer7 API Gateway
  rejects requests without a User-Agent.

**Retry logic for sandbox quirks:**
- FedEx sandbox sometimes rejects the first request with a new token (401) while the token
  propagates across gateway nodes. The adapter retries up to 3 times with 500ms delay for
  401 and 503 errors before falling back to mock rates.

### Services returned (tested against sandbox)

**Domestic parcel (Toronto → Montreal):**
| Service | Rate (after markup) | Transit |
|---------|--------------------:|--------:|
| Ground | $50.08 | 1 day |
| Express Saver | $128.54 | 1 day |
| 2Day | $128.54 | 1 day |
| Standard Overnight | $128.54 | 1 day |
| Priority Overnight | $140.52 | 1 day |
| First Overnight | $173.58 | 1 day |

**International envelope (Toronto → New York):**
| Service | Rate (after markup) | Transit |
|---------|--------------------:|--------:|
| International Priority | $152.44 | 3 days |
| International Priority Express | $159.10 | 2 days |
| International First | $361.76 | 1 day |

**International parcel (Toronto → Chicago):**
| Service | Rate (after markup) | Transit |
|---------|--------------------:|--------:|
| Ground | $113.76 | 2 days |
| International Economy | $350.17 | 5 days |
| International Priority | $552.73 | 3 days |
| International Priority Express | $578.73 | 2 days |
| International First | $714.01 | 1 day |

Note: Sandbox rates are virtualized (pre-canned responses). Production will return real
negotiated account rates.

### Technical challenges solved

1. **MongoDB + `fetch` conflict (Node.js v26):** The MongoDB Node.js driver interferes
   with undici-based `fetch`, causing 401 errors on FedEx's API Gateway even with valid
   tokens. Tokens obtained via `fetch` work in curl but fail when used by `fetch` within
   the same process. Root cause: the MongoDB driver's network layer affects undici's
   connection handling. Fix: use Node.js `https` module for all FedEx HTTP calls.

2. **`User-Agent` header required:** FedEx's Layer7 API Gateway returns 401 for requests
   without a `User-Agent` header (curl sends one by default; Node.js does not).

3. **Sandbox token propagation delay:** The first API request after token acquisition
   sometimes fails with 401 as the token propagates across FedEx gateway nodes. Retry
   logic handles this transparently.

4. **Gzip-compressed error responses:** FedEx returns gzip-compressed bodies even for
   error responses. The `httpsPost` helper handles `Content-Encoding: gzip/deflate`.

5. **International customs clearance:** Cross-border shipments (CA↔US) require
   `customsClearanceDetail` in the rate request body. Auto-generated with commodity
   description, country of manufacture, and declared value.

### Files changed
| File | Change |
|------|--------|
| `backend/src/carriers/fedex.adapter.js` | Added `_getLiveRates()`, `_parseRateResponse()`, customs clearance, retry logic |
| `backend/src/services/fedexAuth.service.js` | Switched to `https` module, added `httpsPost` helper with gzip support |

### Testing
Tested against FedEx sandbox (`apis-sandbox.fedex.com`):
- OAuth token acquisition: working (cached with auto-refresh)
- Domestic parcel rates (CA→CA): 6 services returned, all `isLive: true`
- International envelope rates (CA→US): 3 services returned with customs clearance
- International parcel rates (CA→US): 5 services returned including Ground
- Fallback to mock: confirmed — when API fails, mock rates seamlessly replace live ones
- Markup engine applied: live rates go through the same `applyMarkup()` as mock rates

---

## Requirement 6: Live FedEx Ship API integration

**Status: Done (sandbox)**

The FedEx Ship API is integrated into the carrier adapter. `bookShipment()` creates real
shipments and returns base64-encoded labels (PDF, PNG, or ZPL). All 5 Integrator Validation
ship test cases (IntegratorCA01–CA05) pass against the FedEx sandbox.

### What was built

**FedEx Ship API call (`_liveBookShipment`):**
- File: `backend/src/carriers/fedex.adapter.js`
- When `FEDEX_API_KEY` is set, `bookShipment()` calls the real FedEx
  `POST /ship/v1/shipments` endpoint. If the API call fails, it gracefully falls back to a
  mock response (same pattern as `getRates()`).
- Added `_buildShipRequest(details)` — assembles the full Ship API JSON body:
  - `labelResponseOptions: 'LABEL'` at top level (tells FedEx to return base64 label data)
  - `recipients` (plural array — Ship API differs from Rate API's singular `recipient`)
  - `shippingChargesPayment` — SENDER or THIRD_PARTY with payor account
  - `customsClearanceDetail` — for international shipments (duties, commodities)
  - `shipmentSpecialServices` — SATURDAY_DELIVERY, etc.
  - Package-level `packageSpecialServices` — SIGNATURE_OPTION (must be package-level, not
    shipment-level, for FedEx Ground)
  - `labelSpecification` — imageType (PDF/PNG/ZPLII) + labelStockType
- Added `_buildShipPayment(paymentConfig, fallbackAccountNumber)` — handles SENDER vs
  THIRD_PARTY payment types.
- Uses the same retry logic as rate API (3 attempts, 500ms delay for 401/503).

**Response parsing (`_parseShipResponse`):**
- Extracts tracking number from `output.transactionShipments[0].masterTrackingNumber`
  (falls back to `pieceResponses[0].trackingNumber`).
- Extracts label from `pieceResponses[0].packageDocuments[0]` — returns `encodedLabel`
  (base64), `url`, `docType`, `contentType`.
- Logs FedEx alerts/warnings.
- Returns:
  ```js
  {
    carrierTrackingNumber: '794644790138',
    confirmationNumber: '794644790138',
    status: 'confirmed',
    label: { encodedLabel: '<base64>', url, docType, contentType },
    serviceType: 'FEDEX_EXPRESS_SAVER',
    serviceName: 'FedEx Express Saver',
    shipDatestamp: '2026-09-03',
    rawResponse: { ... },
  }
  ```

**Test script (`fedexShipTestCases.js`):**
- File: `backend/src/scripts/fedexShipTestCases.js`
- Runs the 5 CA ship test cases from the FedEx_Integrator_Test_Case_Baseline.xlsx against
  the sandbox. For each test case:
  1. Builds Ship API request body → saves `IntegratorCA0X_request.json`
  2. Calls FedEx sandbox with retry → saves `IntegratorCA0X_response.json`
  3. Decodes base64 label → saves `IntegratorCA0X_label.{pdf|png|zpl}`
  4. Prints tracking number, file sizes, and alerts
- Supports running a single case: `node backend/src/scripts/fedexShipTestCases.js CA03`

### Test cases and results

All 5 test cases pass against the FedEx sandbox. Shared shipper: 5985 EXPLORER DR,
Mississauga ON L4W5K6, CA.

| TC | Service | Packaging | Route | Weight | Dims | Label | Payment | Special |
|----|---------|-----------|-------|--------|------|-------|---------|---------|
| CA01 | EXPRESS_SAVER | YOUR_PACKAGING | → Winnipeg MB | 15 LB | 25×25×25 | PDF | SENDER | — |
| CA02 | PRIORITY_OVERNIGHT | FEDEX_TUBE | → St-Laurent QC | 15 LB | — | PNG | SENDER | — |
| CA03 | INTL_PRIORITY | FEDEX_TUBE | → Lancaster PA | 4 LB | — | PDF | SENDER + 3rd-party duties (198823520) | SATURDAY_DELIVERY, customs |
| CA04 | GROUND | YOUR_PACKAGING | → Anchorage AK | 60 LB | 25×25×25 | PDF | THIRD_PARTY (150067600) | SIGNATURE DIRECT, customs |
| CA05 | GROUND | YOUR_PACKAGING | → Burnaby BC | 23 LB | 20×20×20 | ZPLII | SENDER | declaredValue $1200 |

**Results (sandbox, 2026-09-03):**
| TC | Tracking | Label Size | Label Format |
|----|----------|------------|-------------|
| CA01 | 794860006524 | 106.2 KB | PDF |
| CA02 | 794860006535 | 10.5 KB | PNG |
| CA03 | 794860006557 | 92.9 KB | PDF |
| CA04 | 794860006568 | 12.6 KB | PDF |
| CA05 | 794860006579 | 2.7 KB | ZPL |

### Output files

All files saved to `fedex_test_output/`:
```
IntegratorCA01_request.json    IntegratorCA01_response.json    IntegratorCA01_label.pdf
IntegratorCA02_request.json    IntegratorCA02_response.json    IntegratorCA02_label.png
IntegratorCA03_request.json    IntegratorCA03_response.json    IntegratorCA03_label.pdf
IntegratorCA04_request.json    IntegratorCA04_response.json    IntegratorCA04_label.pdf
IntegratorCA05_request.json    IntegratorCA05_response.json    IntegratorCA05_label.zpl
```

### Technical challenges solved

1. **SIGNATURE_OPTION must be package-level:** FedEx Ground requires `SIGNATURE_OPTION` on
   the package line item's `packageSpecialServices`, not on the shipment-level
   `shipmentSpecialServices`. Placing it at shipment level returns
   `SHIPMENT.SPECIALSERVICETYPE.NOTALLOWED`.

2. **SIGNATURE_OPTION requires detail object:** Even after moving to package level, FedEx
   requires both `signatureOptionDetail: { signatureReleaseNumber: '' }` and
   `signatureOptionType: 'DIRECT'` fields. Without them:
   `PACKAGESPECIALSERVICES.SIGNATUREOPTIONDETAIL.REQUIRED`.

3. **Ship API uses `recipients` (plural):** Unlike the Rate API's singular `recipient`, the
   Ship API expects `recipients` as an array. Easy to miss, causes cryptic validation errors.

4. **Label decoding:** Labels come as base64 strings in `encodedLabel`. Decode with
   `Buffer.from(base64, 'base64')` and write to the correct file extension based on
   `docType` (PDF→.pdf, PNG→.png, ZPLII→.zpl).

### Files changed
| File | Change |
|------|--------|
| `backend/src/carriers/fedex.adapter.js` | Added `_liveBookShipment()`, `_buildShipRequest()`, `_buildShipPayment()`, `_parseShipResponse()` |
| `backend/src/scripts/fedexShipTestCases.js` | New — standalone script running 5 CA ship test cases |

### Note on booking flow integration

The Ship API is functional in the adapter but **not yet wired into the booking route**
(`POST /api/bookings`). The current booking flow creates a Booking + Shipment record with
a mock tracking number. Wiring `bookShipment()` into `booking.service.js` is a follow-up
task — separate from the Integrator Validation test case requirement.

---

## Requirement 7: Live FedEx Track API integration

**Status: Done (sandbox)**

The FedEx Track API is integrated into the carrier adapter. `getTracking()` calls the live
Track API and returns status, delivery dates, and scan events. All 5 ship test case tracking
numbers were successfully tracked against the sandbox.

### What was built

**FedEx Track API call (`_liveGetTracking`):**
- File: `backend/src/carriers/fedex.adapter.js`
- When `FEDEX_API_KEY` is set, `getTracking()` calls the real FedEx
  `POST /track/v1/trackingnumbers` endpoint with `includeDetailedScans: true`.
  Falls back to mock on failure (same pattern as Rate and Ship).
- Retry logic with token refresh: on 401, invalidates the cached token via
  `invalidateToken()`, re-authenticates, and retries (up to 3 attempts).

**Response parsing (`_parseTrackResponse`):**
- Maps FedEx `derivedCode` to internal status:
  - `DL` → `delivered`
  - `IT`, `OD`, `DP`, `AR`, `PU`, `AF`, `CC`, `CD`, `OF`, `TR`, `HL` → `in_transit`
  - Everything else → `pending`
- Extracts estimated/actual delivery dates, ship date from `dateAndTimes` array.
- Extracts scan events with event description, location (city + state), and timestamp.
- Returns service description, weight, pieces, and the full raw response.

**Tracking service rewrite:**
- File: `backend/src/services/tracking.service.js`
- Looks up shipments by both IFF tracking number and carrier tracking number.
- Calls the carrier adapter's `getTracking()` when a `carrierTrackingNumber` exists.
- Falls back to database `TrackingEvent` records if the carrier API fails.
- Formats events with `time`, `done`, `active` fields the frontend expects.
- Returns `carrierTrackingNumber` separately so the frontend can show both IFF and
  carrier tracking numbers.

**Frontend updates:**
- File: `frontend/app/portal/track/page.js`
- Shows carrier tracking number when it differs from the IFF tracking number.

**Test script (`fedexTrackTestCases.js`):**
- File: `backend/src/scripts/fedexTrackTestCases.js`
- Reads tracking numbers from the Ship test case response files and tracks each via
  the FedEx Track API. Saves request/response JSON for PIW evidence.
- Supports: `node fedexTrackTestCases.js` (all), `node fedexTrackTestCases.js CA03`
  (single case), or `node fedexTrackTestCases.js 794644790138` (direct number).

### Test results (sandbox, 2026-09-03)

All 5 ship test case tracking numbers tracked successfully:

| TC | Tracking | Status | Scan Events |
|----|----------|--------|-------------|
| CA01 | 794860006524 | In transit (HL) | 16 events |
| CA02 | 794860006535 | In transit (HL) | 16 events |
| CA03 | 794860006557 | In transit (HL) | 16 events |
| CA04 | 794860006568 | In transit (HL) | 16 events |
| CA05 | 794860006579 | In transit (HL) | 16 events |

Note: FedEx sandbox returns identical canned tracking data for all numbers (same 16 scan
events through Greenwood IN, Troutdale OR, etc. regardless of actual route). This is
expected sandbox behavior — production returns real tracking data.

### Output files

All files saved to `fedex_test_output/`:
```
IntegratorCA01_track_request.json    IntegratorCA01_track_response.json
IntegratorCA02_track_request.json    IntegratorCA02_track_response.json
IntegratorCA03_track_request.json    IntegratorCA03_track_response.json
IntegratorCA04_track_request.json    IntegratorCA04_track_response.json
IntegratorCA05_track_request.json    IntegratorCA05_track_response.json
```

### Files changed
| File | Change |
|------|--------|
| `backend/src/carriers/fedex.adapter.js` | Added `_liveGetTracking()`, `_parseTrackResponse()`, token refresh on 401 |
| `backend/src/services/fedexAuth.service.js` | Added `invalidateToken()` for clearing stale cached tokens |
| `backend/src/services/tracking.service.js` | Rewritten — carrier adapter integration, frontend-compatible event format |
| `frontend/app/portal/track/page.js` | Shows carrier tracking number when different from IFF number |
| `backend/src/scripts/fedexTrackTestCases.js` | New — Track API test script for PIW evidence |

---

## Requirement 8: Token refresh fix (401 handling)

**Status: Done**

Fixed a bug where FedEx API calls failed with 401 NOT.AUTHORIZED.ERROR when the cached
OAuth token expired or was invalidated by FedEx's gateway.

### Problem
The retry logic in Rate, Ship, and Track API calls retried with the same stale token on
401 errors. Since `getToken()` returned the cached token (which it believed was still valid
based on `tokenExpiresAt`), all 3 retry attempts used the same expired token and all failed.

### Fix
- Added `invalidateToken()` to `fedexAuth.service.js` — clears `cachedToken` and
  `tokenExpiresAt` so the next `getToken()` call fetches a fresh token.
- Updated all 3 retry loops (Rate, Ship, Track) in `fedex.adapter.js`: on a 401 error,
  call `invalidateToken()`, then `getToken()` for a fresh token, then update the
  `Authorization` header before retrying.

### Files changed
| File | Change |
|------|--------|
| `backend/src/services/fedexAuth.service.js` | Added `invalidateToken()`, exported it |
| `backend/src/carriers/fedex.adapter.js` | All 3 retry loops now invalidate + re-auth on 401 |

---

## Requirement 9: Brand UI screenshots for PIW

**Status: Done**

Screenshots taken with live FedEx sandbox rates for PIW submission.

### Screenshots saved to `fedex_test_output/`

| File | Content |
|------|---------|
| `BrandUI_QuotePage_LiveRates.png` | Full quote page showing 10 rate cards (6 FedEx live + 4 other carriers mock), with FedEx disclaimer on each FedEx card and estimate disclaimer above results |
| `BrandUI_FedExRateCards_Disclaimer.png` | Close-up of FedEx Ground rate card showing "● live" badge and FedEx trademark disclaimer |

### What the screenshots demonstrate
- FedEx service marks displayed with required disclaimer text
- Live FedEx rates clearly labeled ("● live" badge vs "~ est." for mock carriers)
- Estimate disclaimer shown above all rate results
- Rate comparison UI with multiple FedEx services (Ground, Express Saver, Standard
  Overnight, 2Day, Priority Overnight, First Overnight)

### Note on EULA / MFA screenshots
IFF ships on IFF's own account (1st party model) — IFF is both integrator and shipper.
End users do not connect their own FedEx accounts. Therefore:
- End User Registration (EULA + Factor 1 + Factor 2 MFA) is **not required**
- The `FedexConnectModal` component exists but is not wired into the UI
- EULA screenshots were taken but removed since they are not needed for the 1st party model

---

## Requirement 10: Submit to FedEx for approval (PIW)

**Status: In progress — test cases complete, paperwork pending**

### Completed
- Rate API test cases: live rates returned from sandbox
- Ship API test cases: 5/5 CA cases pass (CA01–CA05), labels generated
- Track API test cases: 5/5 tracking numbers tracked successfully
- Brand UI screenshots: quote page with live FedEx rates + disclaimer
- Address validation: working against sandbox
- FedEx EULA: shown at onboarding (acceptance recorded with timestamp + IP)
- Auth0 identity verification: email verification enabled

### Remaining to submit
- Complete the PIW (Provider Integration Worksheet) form
- Complete the Integrator Validation Cover Sheet
- Package all test output files (request/response JSON, labels)
- Submit to validationmtp@fedex.com
- Wait for FedEx approval (external timeline — typically weeks)

---

## Summary

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | EULA at sign-up + acceptance record | Done | Real EULA, recorded with timestamp + IP + audit log |
| 2 | Identity verification | Done | Auth0 email verification (confirm toggle is ON) |
| 3 | Estimate disclaimer | Done | On all quote paths (instant + spot) |
| 4 | Address validation | Done (sandbox) | Full integration — frontend UI + backend gate |
| 5 | Live FedEx Rate API | Done (sandbox) | Real rates via `https` module, markup applied, fallback to mock |
| 6 | Live FedEx Ship API | Done (sandbox) | 5/5 CA test cases pass, labels generated (PDF/PNG/ZPL) |
| 7 | Live FedEx Track API | Done (sandbox) | 5/5 tracking numbers tracked, scan events parsed |
| 8 | Token refresh (401 fix) | Done | `invalidateToken()` on 401 in all retry loops |
| 9 | Brand UI screenshots | Done | Quote page with live FedEx rates + disclaimer |
| 10 | Submit PIW to FedEx | In progress | Test cases complete, paperwork pending |
