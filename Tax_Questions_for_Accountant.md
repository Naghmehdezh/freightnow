Prepared for review with an accountant before building real invoicing/tax logic into the platform.
## Context
IFF Cargo is a freight brokerage platform: we negotiate rates directly with carriers (FedEx, XPO Logistics, Day & Ross, Manitoulin, Polaris, and others as they're added), then resell that capacity to customers at a marked-up price. Customers never see the carrier's cost, only our final price.

Shipments span several categories: envelopes/documents, parcels, and LTL freight are quoted and priced instantly; full truckload, air freight, and ocean freight are quoted manually by our team. Shipments can be entirely within Canada, or cross-border between Canada and the US (and potentially other countries for air/ocean freight). Customers can pay by card at time of booking, or  for higher-volume accounts be invoiced monthly on payment terms. Invoices can be issued in CAD or USD.

We want to get the tax treatment right before any of this goes live to real customers, rather than correcting it across a year of issued invoices.

## Basic Applicability
Is freight transportation/forwarding taxable, zero-rated, or exempt under GST/HST and does that answer change between domestic (within Canada) and export (Canada→US) shipments?
Domestic = Tax treatment of the province the goods are delivered in.
Delivery to Ontario = 13% HST
Delivery to Nova Scotia = 14% HST
Delivery to New Brunswick/Newfoundland/PEI = 15% HST
Delivery to QC/BC/AB/SK/MB/Territories = 5% GST
Origin AND destination is in QC = 5% GST + 9.975% QST
If origin is outside of QC and delivery to QC then only 5%.
International = Zero-rated
Does it matter that IFF is a freight broker reselling carrier capacity (buying at a negotiated rate, marking it up, invoicing the marked-up price) rather than physically operating the trucks/planes/ships ourselves? Does acting as principal (buying and reselling) vs. agent (billing on the carrier's behalf) change the tax treatment?
No. That is the whole business model of a freight forwarder.

## Which Rate Applies (Place of Supply)
When a customer's billing address is in one province and the shipment's origin/destination is in another, which governs the tax rate: the customer's address, the shipment origin, or something else?
See tax treatment above. Tax treatment is based on origin/destination.
Does the answer differ for shipments entirely within one province vs. shipments crossing provincial lines?
Yes. See tax treatment above.
Do we need to register for tax collection in multiple provinces, or is a single federal GST/HST registration sufficient given freight's interprovincial nature?
GST/HST is a federal tax not a provincial tax you don’t register at the provincial level.
Quebec specifically, does QST need to be broken out as its own line, separate from GST?
Yes.

## Cross-Border / International
For exports (Canada → US), is the shipment zero-rated? Does that apply to the entire invoice, or only specific line items?
Zero Rated entirely.
For imports (US/international → Canada), is treatment different from exports?
No. Zero Rated.
For ocean/air freight where IFF may also be arranging customs clearance or duties on the customer's behalf, are duties/taxes collected as a pass-through treated differently from IFF's own service fee?
Not relevant for this build.
Does anything change for a customer who is a US-domiciled company paying in USD, is Canadian sales tax applicable to them at all?.
Irrelevant. Goods movement dictates tax treatment.

## Line Items Beyond the Base Rate
Do accessorials (liftgate, residential delivery, appointment, signature, etc.) get taxed the same way as the base freight charge, or differently?
Yes
Declared value charges, same treatment as the base charge?
Yes
FTL/air/ocean spot-rate quotes are manually priced per shipment rather than instant, does that change anything about how/when tax is calculated or disclosed, versus the instant-quote categories (envelope/parcel/LTL)?
Zero-Rated. We will generate quotes and invoices for this.

## Invoicing & Records
Does our GST/HST registration number need to appear on every invoice? Any other mandatory invoice disclosures?
Yes but we have a template already.
Card-paid (immediate) vs. monthly-invoiced (net terms) customers, does the payment method/timing affect when tax is legally “collected” (point of sale vs. point of invoicing)?
Invoice date is the date HST is remitted – this will always be earlier than collection date or be equal to collection date.
Should tax be calculated and stored as a single combined rate, or split into components (e.g., GST + PST/QST) so each shows separately on the invoice?
Split

## Edge Cases
If a shipment is later claimed for loss/damage and a refund or credit is issued, does the originally collected tax need to be reversed? How should that be tracked?
Yes. The claim should be cancel out the original request. A credit to offset the original revenue.
For USD-denominated invoices, is tax calculated on the USD amount directly, or converted to a CAD equivalent first?
No invoice would be USD denominated unless it originated in the US – there is no tax calculated for non-domestic shipments.
Rounding, any specific rounding rules we need to follow at the cents level for tax calculations?
Always round up to the nearest penny.

## Why This Matters Now
We're building the invoicing logic into the platform in the coming weeks. Getting this answered before that work starts means we build it correctly the first time, rather than having to correct tax on invoices already issued to customers.
