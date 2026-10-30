# Accessorial Support Map

**Status (2026-10-20): built into the app.** This lists which special-handling options (accessorials) each carrier
supports and the code its API uses. The same table lives in code (`backend/src/carriers/accessorials.js`):

- Each carrier is sent its own codes for the options the customer selects, and **the price comes from the carrier's
  API**. Every carrier's price is its tax-included total; the app adds no tax.
- The carrier's charge for each selected option is shown as a line on the rate card ("Includes Liftgate Delivery
  C$45.00 …"). When the markup engine applies, it marks up the freight only — accessorial charges pass through at
  the carrier's price.
- A carrier that can't provide a selected option isn't left out silently: the results show it as
  **"Not available with …"**.

Carriers are split by shipment type, matching `Carrier_Mapping.md`: LTL carriers handle pallets/freight, and
parcel carriers handle envelopes/packages.

### How each column was confirmed
| Carrier | Source |
|---|---|
| CSA Transport | CSA's API documentation, then live quotes with the codes (each comes back as a priced `aCharges` line) |
| Day & Ross | Live test API: each code sent in a real rate request. Day & Ross rejects unknown codes ("Unable to retrieve the associated Accessorial"), so accepted vs. rejected is definitive. |
| Polaris | Polaris API documentation, then live cross-border quotes (charges come back in `Additional_Services`) |
| XPO | XPO's own accessorial list endpoint (`GET /rating/1.0/accessorials/ratequote`, all four lanes CA↔US), then live rate quotes with the codes |
| Estes | Estes's published code list, then the live test API with the codes. Invalid codes are rejected (422). |
| FedEx | FedEx API docs + Product Information Worksheet (PIW), each request shape tested in the sandbox |
| DHL Express | Live MyDHL rate requests with the value-added service codes on IFF's account |

### Legend
| Mark | Meaning |
|---|---|
| `CODE` ✅ | Sent to the carrier and priced from its API. |
| `CODE` 🟡 | Supported by the carrier, but not offered on the quote form (yet). |
| ❓ | Unconfirmed — treated as "not available" until the carrier's rep confirms a code. |
| ✗ | Not offered by this carrier — shown to the customer as "not available with …". |
| ⚠️ | Offered by the carrier, but its API can't price it online — shown as "can't be priced online, contact IFF". |

---

## LTL / freight (pallets)

| Option shown to customer | CSA Transport | Day & Ross | Polaris (cross-border only) | XPO | Estes |
|---|---|---|---|---|---|
| **Pickup** | | | | | |
| Liftgate pickup | `TAIL` ✅ | `TLGPU` ✅ | `Lifgate_Pickup` ✅ | `OLG` ✅ | `LGATEP` ✅ |
| Residential pickup | `CURBP` ✅ ¹ | `PRESPU` ✅ | `Residential_Pickup` ✅ ⁴ | `RSO` ✅ | `HPU` ✅ |
| Inside pickup | ✗ | `INSDPU` ⚠️ ² | `Inside_Pickup` ✅ | `OIP` ✅ | `INP` ✅ |
| Limited access pickup | `LIMITED` ✅ | `LTDAPU` ⚠️ ² | `Limited_Access_Pickup` ✅ | `OLA` ✅ | by site type ✅ ³ |
| Pickup appointment | `APPTFEEP` ✅ | `APPTPU` ✅ ⁴ | ✗ | ✗ | ✗ |
| Call before pickup | `NOTIFY` 🟡 | ❓ ⁶ | ✗ | ✗ | ✗ |
| **Delivery** | | | | | |
| Liftgate delivery | `TAILC` ✅ | `TLGDL` ✅ | `Lifgate_Delivery` ✅ | `DLG` ✅ | `LGATE` ✅ |
| Residential delivery | `CURB` ✅ ¹ | `PRESDL` ✅ | `Residential_Delivery` ✅ | `RSD` ✅ | `HD` ✅ ⁵ |
| Inside delivery | ✗ | `INSDDL` ⚠️ ² | `Inside_Delivery` ✅ | `DID` ✅ | `INS` ✅ |
| Limited access delivery | `LIMITEDD` ✅ | `LTDADL` ⚠️ ² | `Limited_Access_Delivery` ✅ | `DLA` ✅ | by site type ✅ ³ |
| Delivery appointment | `APPTFEE` ✅ | `APPTDL` ✅ | `Appointment_Delivery` ✅ | `APT` ✅ | `APT` ✅ ⁴ |
| Call before delivery | `NOT` ✅ | ❓ ⁶ | ✗ | `DNC` ✅ | `NCM` ✅ ⁴ |
| Saturday delivery | ✗ | ✗ | ✗ | `DSH` ✅ | ✗ |
| **Shipment** | | | | | |
| Hazmat | ✗ (CSA doesn't carry hazmat) | `HAZMAT` ✅ ⁴ | ✗ at rating (order entry only) | `ZHM` ✅ | `HAZ` ✅ |
| Do not stack | ✗ | ❓ | `Do_Not_Stack` ✅ ⁴ | ✗ at rating ⁷ | ✗ |
| Oversize / excess length | ✗ | ❓ | `OverSizeFreight` ✅ | `ELS` ✅ (length in inches, from the dimensions) | automatic from the length ✅ ⁸ |
| In-bond (customs) | ✗ | `INBOND` ✅ | `In_Bond` ✅ | `CIB` ✅ (US customs in-bond) | `INB` ✅ |

**Footnotes**
1. **CSA** requires residential pickup/delivery to come **with tailgate and appointment**, so the app adds them
   automatically; their charges show on the rate card.
2. **Day & Ross** accepts these codes, but its API then answers *"Unable to rate shipment, please contact customer
   service"* with no price. The customer sees "can't be priced online — contact IFF". To confirm with Day & Ross
   whether production behaves the same.
3. **Estes has no general "limited access" code** — it charges by type of site. When limited access is selected the
   form asks the site type: school `SCHLDL`/`SCHLPU`, prison/secured `PRISDL`/`PRISPU`, farm `FARMDL`/`FARMPU`,
   mini-storage `MINIDL`/`MINIPU`, place of worship `WORDL`/`WORPU`, seaport `SEADL`/`SEAPU`, fair `FAIRDL`/`FAIRPU`,
   construction `CONST`/`CONSTP`. Without a site type, Estes is shown as "not available".
   (`LADPU` is *not* limited access — Estes describes it as "dock pickup of shipment".)
4. Accepted but **priced at $0** on the test accounts (Day & Ross `APPTPU`, `HAZMAT`; Estes `APT`, `NCM`; Polaris
   residential pickup, do not stack). Production pricing may differ.
5. **Estes** adds `HDSIG` "Residential appointment/signature delivery" (+$25) itself whenever `HD` is sent; it's
   listed on the rate card too.
6. **Day & Ross** accepts a code `CALL` but returns no charge or description, so what it means is unconfirmed.
7. **XPO** has no "do not stack" accessorial for standard rating (only its spot-quote API has a `stackableInd` flag).
8. **Estes** applies its overlength charge itself from the handling unit's length — `LONG16` for 12–15.9 ft,
   `LONG20` for 16–19.9 ft, and so on — whether or not "Oversize" is ticked. It's always listed on the rate card.

**LTL notes**
- **Prices:** CSA and Day & Ross used to be quoted on their freight-only `charges` field, which leaves out fuel,
  accessorials and tax. They now use `totalCharges` (what the carrier bills). E.g. Day & Ross test lane with liftgate
  + residential + appointment: 246.00 before, 774.82 now.
- **CSA** uses different codes for USD shipments (`TAIL-US`, `CURB-US`, `APPTFEE-U`, …) — handled by the adapter.
  CSA also excludes hazardous, temperature-controlled and US→US shipments, max 10 skids.
- **Signature** isn't offered for LTL: every LTL delivery is signed for. (Day & Ross `CHAIN`, sent before for
  "Signature req.", is a chain-of-custody service and broke their quote — no longer sent.)
- **Polaris** is quoted on cross-border lanes only. Its fields are Y/N flags; "Hazmat" only exists when booking.
- **Estes** can't quote Canadian domestic LTL online (its API answers "unable to complete the LTL portion of your
  quote online"), with or without options — a lane limitation to raise with Estes.
- XPO and Estes have more services not offered on the form (guaranteed delivery, after-hours, construction site
  delivery, protect from freezing, …). They can be added if IFF wants them.

---

## Parcel / envelope

Envelopes use the same options except dangerous goods (not allowed in envelope services).

| Option shown to customer | FedEx | DHL Express |
|---|---|---|
| **Delivery** | | |
| Residential | address flag `residential: true` ✅ | `TK` Residential address ✅ |
| Saturday delivery | Saturday versions FedEx returns for a Thursday/Friday ship date ✅ ⁹ | `AA` ✅ (some lanes only — e.g. offered to GB, not to US) |
| Signature: indirect | `SIGNATURE_OPTION` + `INDIRECT` ✅ (in Canada: FedEx Ground® only) | ✗ |
| Signature: direct | `SIGNATURE_OPTION` + `DIRECT` ✅ | `SF` Direct signature ✅ |
| Signature: adult | `SIGNATURE_OPTION` + `ADULT` ✅ | `SD` Adult signature ✅ |
| Hold at location | `HOLD_AT_LOCATION` ✅ (no charge; location picked at booking) | `LX` Hold for collection ✅ |
| Home delivery: evening | Home Delivery® `HOME_DELIVERY_PREMIUM` + `EVENING` ✅ (US residential only) | ✗ |
| Home delivery: appointment | Home Delivery® `HOME_DELIVERY_PREMIUM` + `APPOINTMENT` ✅ (US residential only) | ✗ |
| Home delivery: chosen date | Home Delivery® `HOME_DELIVERY_PREMIUM` + `DATE_CERTAIN` + date ✅ (US residential only) | ✗ (`TT` Scheduled delivery 🟡) |
| **Pickup** | | |
| Saturday pickup | `SATURDAY_PICKUP` ✅ (Saturday pickup date only) | ✗ |
| **Shipment** | | |
| Dangerous goods (accessible / inaccessible) | `DANGEROUS_GOODS` per package ✅ | `HE` Full dangerous goods ✅ |
| Dangerous goods: small quantity exception | `DANGEROUS_GOODS` + `SMALL_QUANTITY_EXCEPTION` ✅ | `HH` Excepted quantities ✅ |
| Lithium batteries (Section II) | `DANGEROUS_GOODS` + option `BATTERY` + battery details ✅ | `HV`/`HD` (ion) · `HW`/`HM` (metal) ✅ |
| Declared value | package `declaredValue` ✅ | `II` Shipment Value Protection ✅ |
| Dry ice | `DRY_ICE` 🟡 (not declared in PIW) | `HC` Dry ice UN1845 🟡 |
| Alcohol | `ALCOHOL` 🟡 (not declared in PIW) | ✗ |
| FedEx packaging (Envelope, Pak, Tube, Boxes) | `packagingType` ✅ | ✗ |
| FedEx One Rate® | `FEDEX_ONE_RATE` ✅ (US domestic only) | ✗ |

**Parcel notes**
- **FedEx** option charges come from the rate's surcharge list (e.g. Residential delivery, Signature, Dangerous goods,
  Declared value, FedEx Home Delivery® appointment). FedEx is shown as "not available" with the reason when Home
  Delivery® is selected outside the US, Saturday pickup on a weekday, no Saturday delivery exists for the date, or
  FedEx can't combine the selected options on the shipment.
- **DHL** is rated with its POST rate request so the value-added services can be priced. DHL doesn't refuse a service
  a product can't do — it just leaves it off that product's price — so the app only keeps DHL products whose price
  includes every selected service; if none does, DHL is shown as "not available with …" naming the service.
- FedEx bookings send the same options to FedEx's Ship API (see the booking step). Fully regulated DG and the small
  quantity exception are flagged for IFF staff to book (needs a DG-approved account + shipper's declaration).
  Home Delivery® appointment/date certain return a sandbox error at booking in every form, so they're unconfirmed.
- FedEx option names keep FedEx's marks when shown (e.g. FedEx Home Delivery®).
9. FedEx returns Saturday-delivery versions of its services by itself when the ship date allows it. When the customer
   ticks Saturday delivery, only those are shown; otherwise they're hidden.

---

## Open questions
1. **Day & Ross:** do inside pickup/delivery and limited access really fail online pricing in production too? What is
   `CALL`? Do they have codes for do not stack and oversize? Do `APPTPU` and `HAZMAT` really price at $0?
2. **Estes:** can Canadian domestic LTL be quoted online for IFF's account?
3. **FedEx packaging:** the PIW doesn't tick FedEx packaging types, but the form offers them (with One Rate®).
4. **Booking:** LTL bookings don't pass the selected accessorials to each carrier's booking (BOL) API yet — only FedEx
   bookings do.
