# Accessorial Support Map

**Status: verified against the carriers' APIs (2026-10-14), for review.** This lists which special-handling options
(accessorials) each carrier supports, and the code the carrier's API uses for each. The app's carrier integrations
will read this map, so the quote form only offers options that make sense for the shipment, and every carrier is told
about the options it supports.

Carriers are split by shipment type, matching `Carrier_Mapping.md`: LTL carriers handle pallets/freight, and
parcel carriers handle envelopes/packages.

### How each column was confirmed
| Carrier | Source |
|---|---|
| CSA Transport | CSA's API documentation (`APIs/CSA Transport/API Documentation 2025 Testing.pdf`) |
| Day & Ross | Live test API: each code sent in a real rate request. Day & Ross rejects unknown codes ("Unable to retrieve the associated Accessorial"), so accepted vs. rejected is definitive. |
| Polaris | Polaris API documentation (`APIs/Polaris/…docx`) |
| XPO | XPO's own accessorial list endpoint (`GET /rating/1.0/accessorials/ratequote`, all four lanes CA↔US), then a live rate quote with the codes. Each one came back priced. |
| Estes | Estes's published code list, then the live test API with the codes. Each one came back priced with Estes's description; invalid codes are rejected (422). |
| FedEx | FedEx API docs + Product Information Worksheet (PIW) |
| DHL Express | Live MyDHL rate request with `requestAllValueAddedServices: true` on IFF's account (CA→US and CA→GB), which lists every service the account can use |

### Legend
| Mark | Meaning |
|---|---|
| `CODE` ✅ | Supported. This is the carrier's code, and the app already sends it today. |
| `CODE` 🟡 | Supported and confirmed, but the app doesn't send it yet. |
| ❓ | Still unconfirmed. Needs the carrier's account rep. |
| ✗ | Not supported by this carrier, so the carrier is listed as "not available with this option". |
| ⚠️ | A problem today (see notes). |

---

## LTL / freight (pallets)

| Option shown to customer | CSA Transport | Day & Ross | Polaris | XPO | Estes |
|---|---|---|---|---|---|
| **Pickup** | | | | | |
| Liftgate at pickup | `TAIL` ✅ | `TLGPU` ✅ | `Lifgate_Pickup` ✅ | `OLG` 🟡 | `LGATEP` 🟡 |
| Residential pickup | `CURBP` 🟡 ¹ | `PRESPU` 🟡 | `Residential_Pickup` 🟡 | `RSO` 🟡 | `HPU` 🟡 |
| Inside pickup | ✗ | `INSDPU` ⚠️ ² | `Inside_Pickup` 🟡 | `OIP` 🟡 | `INP` 🟡 |
| Limited access pickup | `LIMITED` 🟡 | `LTDAPU` ⚠️ ² | `Limited_Access_Pickup` 🟡 | `OLA` 🟡 | 🟡 by site type ³ |
| Pickup appointment | `APPTFEEP` 🟡 | `APPTPU` 🟡 ⁴ | ✗ | ✗ | ✗ |
| Call before pickup | `NOTIFY` 🟡 | ❓ ⁶ | ✗ | ✗ | ✗ |
| **Delivery** | | | | | |
| Liftgate at delivery | `TAILC` ✅ | `TLGDL` ✅ | `Lifgate_Delivery` ✅ | `DLG` 🟡 | `LGATE` 🟡 |
| Residential delivery | `CURB` ✅ ¹ | `PRESDL` ✅ | `Residential_Delivery` ✅ | `RSD` 🟡 | `HD` 🟡 ⁵ |
| Inside delivery | ✗ | `INSDDL` ⚠️ ² | `Inside_Delivery` ✅ | `DID` 🟡 | `INS` 🟡 |
| Limited access delivery | `LIMITEDD` 🟡 | `LTDADL` ⚠️ ² | `Limited_Access_Delivery` 🟡 | `DLA` 🟡 | 🟡 by site type ³ |
| Delivery appointment | `APPTFEE` ✅ | `APPTDL` ✅ | `Appointment_Delivery` ✅ | `APT` 🟡 | `APT` 🟡 ⁴ |
| Call before delivery | `NOT` 🟡 | ❓ ⁶ | ✗ | `DNC` 🟡 | `NCM` 🟡 ⁴ |
| **Shipment** | | | | | |
| Hazardous materials | ✗ (CSA doesn't carry hazmat) | `HAZMAT` ✅ ⁴ | ✗ at rating (order entry only) | `ZHM` 🟡 | `HAZ` 🟡 |
| Do not stack | ✗ | ❓ | `Do_Not_Stack` 🟡 | ✗ at rating ⁷ | ✗ |
| Oversize / excess length | ✗ | ❓ | `OverSizeFreight` 🟡 | `ELS` 🟡 (length in inches) | `LONG12`…`LONG53` 🟡 (by length in ft) |
| In-bond (customs) | ✗ | `INBOND` 🟡 | `In_Bond` 🟡 | `CIB` 🟡 (US customs in-bond) | `INB` 🟡 |

**Footnotes**
1. **CSA** residential pickup/delivery must be sent **together with tailgate and appointment** (CSA's rule).
2. **Day & Ross** accepts these codes, but the test API then answers *"Unable to rate shipment, please contact
   customer service"* and returns no price. The whole Day & Ross quote fails, so **today, ticking Inside delivery
   or Limited access silently drops Day & Ross from the results**. The `CHAIN` code (sent today for "Signature")
   does the same. To confirm with Day & Ross whether production behaves the same (these may need manual pricing).
3. **Estes has no general "limited access" code.** It charges by type of site: `SCHLDL`/`SCHLPU` school,
   `PRISDL`/`PRISPU` secured location/prison, `FARMDL`/`FARMPU` farm, `MINIDL`/`MINIPU` mini-storage,
   `WORDL`/`WORPU` place of worship, `SEADL`/`SEAPU` seaport, `FAIRDL`/`FAIRPU` fair/exhibition, `CONST`
   construction site. We'd need to ask the customer the site type, or default to one.
   Note: `LADPU` is *not* limited access (Estes describes it as "dock pickup of shipment").
4. Accepted but **priced at $0** on the test account (D&R `APPTPU`, `HAZMAT`; Estes `APT`, `NCM`). Production
   pricing may differ.
5. **Estes** automatically adds `HDSIG` "Residential appointment/signature delivery" (+$25) whenever `HD` is sent.
6. **Day & Ross** accepts a code `CALL` but returns no charge and no description, so what it means is unconfirmed.
   Ask Day & Ross.
7. **XPO** has no "do not stack" accessorial for standard rating. Only its spot-quote API takes a
   `stackableInd` flag.

**LTL notes**
- **CSA** uses different codes for USD shipments: add `-US` (e.g. `TAIL-US`, `CURB-US`), or `-U` for
  appointments. CAD shipments use `-C` for liftgate (`TAIL-C`, `TAILC-C`) and plain codes for the rest. The app
  already handles this. CSA also excludes hazardous, temperature-controlled and US→US shipments, max 10 skids.
- **Day & Ross** `CHAIN` ("chain of signature") is currently sent for "Signature req.". It's a custody service,
  not a delivery signature, and it breaks the quote (footnote 2). Proposed: drop "Signature" for LTL.
- **Polaris** fields are Y/N flags in the rate request. "Hazmat" only exists when booking
  (`Cannot_Travel_With_HAZMAT_YN`), not when quoting.
- ⚠️ **XPO and Estes:** the app currently sends **no** accessorials to either, so their prices exclude anything
  the customer selects. The codes above are now confirmed and can be wired in. Sample live prices (test lanes):
  XPO residential $191, delivery liftgate $274, appointment $71.50; Estes liftgate $45, residential $50,
  inside $100, hazmat $30, in-bond $120.
- Both XPO and Estes have more services not listed here (e.g. guaranteed delivery, after-hours, construction
  site, protect from freezing). They can be added later if IFF wants to offer them.
- Saturday delivery and signature options aren't standard LTL services, so they're removed from the LTL form.

---

## Parcel / envelope

| Option shown to customer | FedEx | DHL Express |
|---|---|---|
| **Delivery** | | |
| Residential address | address flag `residential: true` ✅ | `TK` Residential address 🟡 |
| Saturday delivery | Saturday versions FedEx returns for a Thursday/Friday ship date ✅ ⁸ | `AA` 🟡 (only some lanes, e.g. offered to GB, not to US) |
| Signature: indirect (someone at the address) | `SIGNATURE_OPTION` + `INDIRECT` ✅ (in Canada: FedEx Ground® only) | ✗ (closest: `SG` Signature required) |
| Signature: direct (recipient) | `SIGNATURE_OPTION` + `DIRECT` ✅ | `SF` Direct signature 🟡 |
| Signature: adult (19+/21+) | `SIGNATURE_OPTION` + `ADULT` ✅ | `SD` Adult signature 🟡 |
| Hold at carrier location | `HOLD_AT_LOCATION` ✅ (no charge; location picked at booking) | `LX` Hold for collection 🟡 (also `TV` Direct to service point) |
| Evening home delivery | Home Delivery® `HOME_DELIVERY_PREMIUM` + `EVENING` ✅ (US residential only) | ✗ |
| Delivery appointment | Home Delivery® `HOME_DELIVERY_PREMIUM` + `APPOINTMENT` ✅ (US residential only) | ✗ |
| Delivery on a chosen date | Home Delivery® `HOME_DELIVERY_PREMIUM` + `DATE_CERTAIN` + date ✅ (US residential only) | `TT` Scheduled delivery 🟡 (Express Worldwide only) |
| **Pickup** | | |
| Saturday pickup | `SATURDAY_PICKUP` ✅ (Saturday pickup date only) | ✗ |
| **Shipment** | | |
| Dangerous goods | `DANGEROUS_GOODS` per package: accessible / inaccessible / small quantity exception ✅ | `HE` Full dangerous goods 🟡, `HH` excepted quantities 🟡 |
| Lithium batteries (Section II) | `DANGEROUS_GOODS` + option `BATTERY` + battery details ✅ (no DG surcharge) | `HD`/`HV`/`HM`/`HW` 🟡 |
| Dry ice | `DRY_ICE` 🟡 (not declared in PIW) | `HC` Dry ice UN1845 🟡 |
| Alcohol | `ALCOHOL` 🟡 (not declared in PIW) | ✗ |
| Insurance (declared value) | package `declaredValue` ✅ (FedEx adds its declared-value charge) | `II` Shipment insurance 🟡 |
| FedEx packaging (Envelope, Pak, Tube, Boxes) | `packagingType` ✅ | ✗ |
| FedEx One Rate® | `FEDEX_ONE_RATE` ✅ (US domestic only) | ✗ |
| **Not for parcels** | | |
| Liftgate, inside delivery | ✗ FedEx Freight only (removed from the parcel form) | ✗ |

**Parcel notes**
- **FedEx fixes done (2026-10-14), each request shape tested against the FedEx sandbox:**
  - **Residential** now sets the address's residential flag (FedEx adds its residential surcharge). It used to send
    *Home Delivery Premium*, which made FedEx reject the request.
  - **Signature** is sent per package with the type the customer picks (Indirect, Direct or Adult). Without a type,
    FedEx rejected the request.
  - **Appointment** is sent as the FedEx Home Delivery® appointment option on US domestic shipments. On other lanes
    FedEx doesn't offer it, so FedEx is left out of the results.
  - **Liftgate / Inside delivery** are no longer offered for envelopes/parcels. If they're sent anyway, FedEx is
    left out of the results instead of the request failing.
  - **Dangerous goods** is sent per package with accessibility (accessible DG costs more). Class/UN number are only
    needed when the shipment is created, not for a quote.
  - **Saturday delivery** (footnote 8) was also broken: sending `SATURDAY_DELIVERY` while asking for all services
    made FedEx reject the request.
  - **PIW items added (2026-10-15):** Saturday pickup, hold at location, Home Delivery® evening and date certain,
    declared value, DG small quantity exception and lithium batteries (Section II). FedEx services are now limited to
    the ones ticked in the PIW (this replaces a hardcoded list that hid declared services, including the Express
    Freight services FedEx returns for heavy parcels).
  - **Booking (2026-10-15):** the booking step now collects street address + contact for both ends, the FedEx
    hold location (from FedEx's location search) and dangerous goods details, and sends the quoted options to FedEx's
    Ship API (tested in the sandbox: signature, residential, declared value, FedEx packaging, hold at location,
    Saturday pickup/delivery, Home Delivery® evening, lithium batteries). Fully regulated DG and the small quantity
    exception are recorded and flagged for IFF staff to book (needs a DG-approved account + shipper's declaration).
    Home Delivery® appointment/date certain return a sandbox error in every form, so they're unconfirmed.
- FedEx option names should keep FedEx's marks when shown (e.g. FedEx Home Delivery®).
8. FedEx returns Saturday-delivery versions of its services by itself when the ship date allows it. When the
   customer ticks Saturday delivery, only those are shown; otherwise they're hidden.
- **DHL** codes are the account's "value-added service" codes. Availability depends on the product (Express
  Worldwide, Express 12:00, …) and lane; e.g. `HE` dangerous goods and `HC` dry ice are only on Express Worldwide
  and Medical Express. The app sends none today. DHL returns them per product, so the app can check per quote.

---

## Open questions for review
1. **Day & Ross:** do Inside pickup/delivery, Limited access and Chain of signature really fail online pricing in
   production too? What is `CALL`? Do they have codes for Do not stack and Oversize?
2. **Estes limited access:** ask the customer the site type (school, farm, …), or not offer limited access for Estes?
3. **Which options should IFF offer at all?** (e.g. dry ice and alcohol aren't declared in the FedEx PIW.)
4. **When a carrier doesn't support a selected option**, should it be hidden from the results or shown greyed out
   as "not available with …"? (Recommended: shown greyed out.)
