-- IFF Cargo portal: SQL equivalent of the portal's data (PostgreSQL syntax).
-- Monthly statements are not included: IFF produces statements in its own system.
-- SQL Server: TIMESTAMP -> DATETIME2, BOOLEAN -> BIT, TEXT -> NVARCHAR(MAX).
-- id = the portal's record id (24 hex characters). Money in DECIMAL(12,2); timestamps in UTC.

-- Customers

CREATE TABLE companies (
  id                    CHAR(24) PRIMARY KEY,
  name                  VARCHAR(200) NOT NULL,
  street                VARCHAR(200),
  city                  VARCHAR(100),
  province              VARCHAR(50),
  postal_code           VARCHAR(20),
  country               CHAR(2) NOT NULL,
  phone                 VARCHAR(40),
  tax_number            VARCHAR(40),
  shipping_type         VARCHAR(40),
  payment_terms         VARCHAR(10) NOT NULL DEFAULT 'card' CHECK (payment_terms IN ('card', 'monthly')),
  credit_limit_cad      DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit_cad            DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit_usd            DECIMAL(12,2) NOT NULL DEFAULT 0,
  account_hold_active   BOOLEAN NOT NULL DEFAULT FALSE,
  account_hold_reason   VARCHAR(300),
  account_hold_since    TIMESTAMP,
  qb_customer_id        VARCHAR(40),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMP NOT NULL,
  updated_at            TIMESTAMP
);

CREATE TABLE users (
  id                        CHAR(24) PRIMARY KEY,
  company_id                CHAR(24) REFERENCES companies(id),
  email                     VARCHAR(200) NOT NULL UNIQUE,
  first_name                VARCHAR(100) NOT NULL,
  last_name                 VARCHAR(100) NOT NULL,
  phone                     VARCHAR(40),
  role                      VARCHAR(20) NOT NULL DEFAULT 'customer'
                            CHECK (role IN ('customer', 'company_admin', 'iff_staff', 'iff_admin')),
  terms_accepted_at         TIMESTAMP,
  terms_accepted_ip         VARCHAR(45),
  fedex_terms_accepted_at   TIMESTAMP,
  fedex_terms_accepted_ip   VARCHAR(45),
  notify_shipment_booked    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_out_for_delivery   BOOLEAN NOT NULL DEFAULT TRUE,
  notify_delivered          BOOLEAN NOT NULL DEFAULT TRUE,
  notify_exceptions         BOOLEAN NOT NULL DEFAULT TRUE,
  notify_spot_rates         BOOLEAN NOT NULL DEFAULT TRUE,
  notify_claims             BOOLEAN NOT NULL DEFAULT TRUE,
  notify_promotional        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMP NOT NULL,
  updated_at                TIMESTAMP
);

CREATE TABLE addresses (
  id                  CHAR(24) PRIMARY KEY,
  company_id          CHAR(24) NOT NULL REFERENCES companies(id),
  created_by_user_id  CHAR(24) REFERENCES users(id),
  contact_name        VARCHAR(100),
  company_name        VARCHAR(200),
  phone               VARCHAR(40),
  street              VARCHAR(200) NOT NULL,
  city                VARCHAR(100) NOT NULL,
  province            VARCHAR(50),
  postal_code         VARCHAR(20) NOT NULL,
  country             CHAR(2) NOT NULL,
  is_residential      BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMP NOT NULL,
  updated_at          TIMESTAMP
);

-- Carriers and pricing rules

CREATE TABLE carriers (
  carrier_id           VARCHAR(20) PRIMARY KEY,   -- fedex, xpo, dayross, manitoulin, polaris, dhl, csa, estes
  name                 VARCHAR(100) NOT NULL,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  provides_live_rates  BOOLEAN NOT NULL DEFAULT FALSE,
  shipment_types       VARCHAR(100),              -- envelope, parcel, ltl (comma-separated)
  lanes                VARCHAR(100),              -- domestic_ca, domestic_us, cross_border, international
  created_at           TIMESTAMP,
  updated_at           TIMESTAMP
);

CREATE TABLE pricing_rule_sets (
  version             INT PRIMARY KEY,
  xb_pts              DECIMAL(6,2) NOT NULL,      -- cross-border markup points
  intl_pts            DECIMAL(6,2) NOT NULL,
  low_density_pts     DECIMAL(6,2) NOT NULL,      -- density < 6 pcf
  multi_piece_pts     DECIMAL(6,2) NOT NULL,      -- 4+ pieces
  floor_envelope      DECIMAL(10,2) NOT NULL,
  floor_package       DECIMAL(10,2) NOT NULL,
  floor_skid          DECIMAL(10,2) NOT NULL,
  floor_lcl           DECIMAL(10,2) NOT NULL,
  min_gross_profit    DECIMAL(10,2) NOT NULL,
  round_up_to         DECIMAL(6,2) NOT NULL,
  dim_divisor         INT NOT NULL,
  usd_to_cad_rate     DECIMAL(8,4) NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT FALSE,
  note                VARCHAR(500),
  created_by_user_id  CHAR(24) REFERENCES users(id),
  created_at          TIMESTAMP NOT NULL
);

CREATE TABLE pricing_bands (
  version     INT NOT NULL REFERENCES pricing_rule_sets(version),
  band_no     INT NOT NULL,
  max_cost    DECIMAL(12,2) NOT NULL,             -- cost up to this amount ...
  markup_pct  DECIMAL(6,2) NOT NULL,              -- ... gets this markup
  PRIMARY KEY (version, band_no)
);

-- Quoting

CREATE TABLE quotes (
  id                       CHAR(24) PRIMARY KEY,
  quote_number             VARCHAR(20) NOT NULL UNIQUE,      -- Q-YYYY-NNNN
  user_id                  CHAR(24) NOT NULL REFERENCES users(id),
  shipment_type            VARCHAR(20) NOT NULL,             -- envelope, parcel, ltl, ftl, air, ocean
  origin_city              VARCHAR(100),
  origin_province          VARCHAR(50),
  origin_postal            VARCHAR(20),
  origin_country           CHAR(2) NOT NULL,
  dest_city                VARCHAR(100),
  dest_province            VARCHAR(50),
  dest_postal              VARCHAR(20),
  dest_country             CHAR(2) NOT NULL,
  weight_lb                DECIMAL(10,2) NOT NULL,
  pieces                   INT NOT NULL DEFAULT 1,
  dim_l_in                 DECIMAL(8,2),
  dim_w_in                 DECIMAL(8,2),
  dim_h_in                 DECIMAL(8,2),
  freight_class            VARCHAR(10),
  currency                 CHAR(3) NOT NULL DEFAULT 'CAD',
  pickup_date              DATE,
  pickup_ready_time        CHAR(5),                          -- HH:MM, local to the pickup address
  pickup_close_time        CHAR(5),
  declared_value           DECIMAL(12,2),
  commodity                VARCHAR(200),
  accessorials             VARCHAR(500),                     -- comma-separated option codes
  opt_fedex_packaging      VARCHAR(40),
  opt_fedex_one_rate       BOOLEAN,
  opt_dg_type              VARCHAR(40),
  opt_battery_material     VARCHAR(40),
  opt_battery_packing      VARCHAR(40),
  opt_home_delivery_date   DATE,
  opt_limited_access_type  VARCHAR(40),
  status                   VARCHAR(20) NOT NULL DEFAULT 'active',  -- active, booked, expired
  expires_at               TIMESTAMP NOT NULL,
  created_at               TIMESTAMP NOT NULL
);

CREATE TABLE quote_line_items (               -- LTL: one row per group of identical pieces
  id             SERIAL PRIMARY KEY,
  quote_id       CHAR(24) NOT NULL REFERENCES quotes(id),
  line_no        INT NOT NULL,
  pieces         INT,
  length_in      DECIMAL(8,2),
  width_in       DECIMAL(8,2),
  height_in      DECIMAL(8,2),
  weight_lb      DECIMAL(10,2),                -- per piece
  freight_class  VARCHAR(10)
);

CREATE TABLE quote_rates (
  id                     CHAR(24) PRIMARY KEY,
  quote_id               CHAR(24) NOT NULL REFERENCES quotes(id),
  carrier_id             VARCHAR(20) NOT NULL,       -- carriers.carrier_id, or 'iff' for spot rates priced by IFF
  carrier_name           VARCHAR(100) NOT NULL,
  service_name           VARCHAR(100) NOT NULL,
  service_code           VARCHAR(60),
  currency               CHAR(3) NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD', 'USD')),
  base_rate              DECIMAL(12,2) NOT NULL,     -- carrier cost
  engine_rate            DECIMAL(12,2),              -- price the pricing engine produced
  display_rate           DECIMAL(12,2) NOT NULL,     -- sell price shown and booked
  transit_days           INT,
  estimated_delivery     DATE,
  is_live_rate           BOOLEAN NOT NULL DEFAULT FALSE,
  is_best_rate           BOOLEAN NOT NULL DEFAULT FALSE,
  rules_version          INT REFERENCES pricing_rule_sets(version),
  markup_pct             DECIMAL(6,2),
  gross_margin           DECIMAL(12,2),
  cost_cad               DECIMAL(12,2),
  sell_cad               DECIMAL(12,2),
  fx_rate                DECIMAL(8,4),
  chargeable_wt_lb       DECIMAL(10,2),
  density_pcf            DECIMAL(8,2),
  est_class              DECIMAL(6,1),
  dim_governs            BOOLEAN,
  flags                  VARCHAR(500),
  not_included_options   VARCHAR(500),
  not_included_message   VARCHAR(500),
  adjusted_by_user_id    CHAR(24) REFERENCES users(id),
  adjusted_at            TIMESTAMP,
  adjustment_reason      VARCHAR(20) CHECK (adjustment_reason IN ('discount', 'competitive', 'contract', 'oneoff', 'correction', 'other')),
  adjustment_note        VARCHAR(500)
);

CREATE TABLE quote_rate_accessorials (       -- carrier's charge per option (already inside base_rate)
  id             SERIAL PRIMARY KEY,
  quote_rate_id  CHAR(24) NOT NULL REFERENCES quote_rates(id),
  code           VARCHAR(40),                  -- some carrier charges come with a label only
  label          VARCHAR(100),
  amount         DECIMAL(12,2) NOT NULL
);

CREATE TABLE spot_rate_requests (
  id                    CHAR(24) PRIMARY KEY,
  request_number        VARCHAR(20) NOT NULL UNIQUE,   -- SPR-YYYY-NNNN
  user_id               CHAR(24) NOT NULL REFERENCES users(id),
  shipment_type         VARCHAR(20) NOT NULL,          -- ftl, air, ocean
  air_service           VARCHAR(10) CHECK (air_service IN ('pickup', 'dropoff')),
  origin_street         VARCHAR(200),
  origin_city           VARCHAR(100),
  origin_province       VARCHAR(50),
  origin_postal         VARCHAR(20),
  origin_country        CHAR(2) NOT NULL,
  dest_city             VARCHAR(100),
  dest_province         VARCHAR(50),
  dest_postal           VARCHAR(20),
  dest_country          CHAR(2) NOT NULL,
  origin_port           VARCHAR(100),
  dest_port             VARCHAR(100),
  ocean_type            VARCHAR(60),
  weight                DECIMAL(10,2),
  weight_unit           CHAR(2) DEFAULT 'lb' CHECK (weight_unit IN ('lb', 'kg')),
  pieces                INT,
  skids                 INT,
  dimensions            VARCHAR(200),                  -- older requests: free-text dimensions
  volume_weight_kg      DECIMAL(10,2),
  chargeable_weight_kg  DECIMAL(10,2),
  pickup_date           DATE,
  commodity             VARCHAR(200),
  declared_value        DECIMAL(12,2),
  special_notes         TEXT,
  status                VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'quoted', 'declined', 'booked')),
  quoted_rate           DECIMAL(12,2),                 -- sell price
  quoted_currency       CHAR(3),
  carrier_cost          DECIMAL(12,2),                 -- cost (internal)
  carrier_name          VARCHAR(100),
  service_name          VARCHAR(100),
  transit_days          INT,
  valid_until           TIMESTAMP,
  customer_note         TEXT,
  staff_note            TEXT,
  quoted_at             TIMESTAMP,
  quoted_by_user_id     CHAR(24) REFERENCES users(id),
  quote_id              CHAR(24) REFERENCES quotes(id),
  quote_rate_id         CHAR(24) REFERENCES quote_rates(id),
  declined_at           TIMESTAMP,
  submitted_at          TIMESTAMP NOT NULL,
  updated_at            TIMESTAMP
);

CREATE TABLE spot_rate_packages (
  id                SERIAL PRIMARY KEY,
  request_id        CHAR(24) NOT NULL REFERENCES spot_rate_requests(id),
  pieces            INT,
  length            DECIMAL(8,2),
  width             DECIMAL(8,2),
  height            DECIMAL(8,2),
  unit              CHAR(2) CHECK (unit IN ('cm', 'in')),
  volume_weight_kg  DECIMAL(10,2)
);

CREATE TABLE guest_quote_requests (
  id                  CHAR(24) PRIMARY KEY,
  request_number      VARCHAR(20) NOT NULL UNIQUE,     -- GQR-YYYY-NNNN
  name                VARCHAR(100) NOT NULL,
  company             VARCHAR(200),
  email               VARCHAR(200) NOT NULL,
  phone               VARCHAR(40) NOT NULL,
  origin              VARCHAR(300) NOT NULL,
  origin_type         VARCHAR(10) DEFAULT 'door' CHECK (origin_type IN ('door', 'terminal')),
  destination         VARCHAR(300) NOT NULL,
  destination_type    VARCHAR(10) DEFAULT 'door' CHECK (destination_type IN ('door', 'terminal')),
  mode                VARCHAR(10) NOT NULL CHECK (mode IN ('air', 'ocean', 'land')),
  volume              VARCHAR(5) CHECK (volume IN ('lcl', 'fcl', 'ltl', 'ftl')),
  terms_of_sale       VARCHAR(10) DEFAULT 'unknown',
  hazardous           BOOLEAN NOT NULL DEFAULT FALSE,
  notes               TEXT,
  source              VARCHAR(40),
  status              VARCHAR(10) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'quoted', 'declined', 'closed')),
  quoted_rate         DECIMAL(12,2),
  quoted_currency     CHAR(3),
  carrier_cost        DECIMAL(12,2),
  carrier_name        VARCHAR(100),
  service_name        VARCHAR(100),
  transit_days        INT,
  valid_until         TIMESTAMP,
  customer_note       TEXT,
  staff_note          TEXT,
  quoted_at           TIMESTAMP,
  quoted_by_user_id   CHAR(24) REFERENCES users(id),
  declined_at         TIMESTAMP,
  handled_by_user_id  CHAR(24) REFERENCES users(id),
  handled_at          TIMESTAMP,
  submitted_at        TIMESTAMP NOT NULL,
  updated_at          TIMESTAMP
);

CREATE TABLE guest_quote_items (
  id           SERIAL PRIMARY KEY,
  request_id   CHAR(24) NOT NULL REFERENCES guest_quote_requests(id),
  quantity     INT,
  length       DECIMAL(8,2),
  width        DECIMAL(8,2),
  height       DECIMAL(8,2),
  dim_unit     CHAR(2) CHECK (dim_unit IN ('cm', 'in')),
  weight       DECIMAL(10,2),                  -- per item
  weight_unit  CHAR(2) CHECK (weight_unit IN ('kg', 'lb'))
);

-- Bookings and shipments

CREATE TABLE bookings (
  id                          CHAR(24) PRIMARY KEY,
  booking_number              VARCHAR(20) NOT NULL UNIQUE,   -- BK-YYYY-NNNN
  quote_id                    CHAR(24) NOT NULL UNIQUE REFERENCES quotes(id),
  quote_rate_id               CHAR(24) NOT NULL REFERENCES quote_rates(id),
  user_id                     CHAR(24) NOT NULL REFERENCES users(id),
  company_id                  CHAR(24) REFERENCES companies(id),
  carrier_id                  VARCHAR(20) NOT NULL,            -- carriers.carrier_id, or 'iff'
  carrier_name                VARCHAR(100) NOT NULL,
  service_name                VARCHAR(100) NOT NULL,
  currency                    CHAR(3) NOT NULL DEFAULT 'CAD',  -- carrier's currency for cost_rate / sell_rate
  cost_rate                   DECIMAL(12,2) NOT NULL,          -- carrier cost
  sell_rate                   DECIMAL(12,2) NOT NULL,          -- sell price (current)
  original_sell_rate          DECIMAL(12,2),
  balance_adjustment          DECIMAL(12,2) NOT NULL DEFAULT 0,
  charge_currency             CHAR(3) CHECK (charge_currency IN ('CAD', 'USD')),
  charge_amount               DECIMAL(12,2),                   -- what the customer paid
  fx_rate                     DECIMAL(8,4),                    -- USD->CAD used
  payment_method              VARCHAR(10) CHECK (payment_method IN ('card', 'qb_link', 'account', 'credit')),
  payment_status              VARCHAR(20) NOT NULL DEFAULT 'not_required'
                              CHECK (payment_status IN ('paid', 'invoiced', 'awaiting_payment', 'not_required', 'cancelled')),
  status                      VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                              CHECK (status IN ('confirmed', 'awaiting_payment', 'cancelled')),
  qb_invoice_id               VARCHAR(40),
  qb_invoice_link             VARCHAR(500),
  pay_by                      TIMESTAMP,
  customer_reference          VARCHAR(100),
  pickup_confirmation_number  VARCHAR(60),
  pickup_confirmed_at         TIMESTAMP,
  measurements_confirmed_at   TIMESTAMP,
  cancelled_at                TIMESTAMP,
  booked_at                   TIMESTAMP NOT NULL,
  updated_at                  TIMESTAMP
);

CREATE TABLE booking_price_overrides (       -- IFF price changes after booking
  id           SERIAL PRIMARY KEY,
  booking_id   CHAR(24) NOT NULL REFERENCES bookings(id),
  from_amount  DECIMAL(12,2),
  to_amount    DECIMAL(12,2),
  reason       VARCHAR(40),
  note         VARCHAR(500),
  by_user_id   CHAR(24) REFERENCES users(id),
  at           TIMESTAMP
);

CREATE TABLE shipments (
  id                           CHAR(24) PRIMARY KEY,
  tracking_number              VARCHAR(20) NOT NULL UNIQUE,  -- IFF-YYYY-NNNNN
  carrier_tracking_number      VARCHAR(60),
  carrier_confirmation_number  VARCHAR(60),
  booking_id                   CHAR(24) NOT NULL UNIQUE REFERENCES bookings(id),
  user_id                      CHAR(24) NOT NULL REFERENCES users(id),
  company_id                   CHAR(24) REFERENCES companies(id),
  carrier_id                   VARCHAR(20) NOT NULL,         -- carriers.carrier_id, or 'iff'
  carrier_name                 VARCHAR(100) NOT NULL,
  service_name                 VARCHAR(100) NOT NULL,
  shipment_type                VARCHAR(20) NOT NULL,
  shipper_name                 VARCHAR(100),
  shipper_company              VARCHAR(200),
  shipper_phone                VARCHAR(40),
  origin_street_1              VARCHAR(200),
  origin_street_2              VARCHAR(200),
  origin_city                  VARCHAR(100),
  origin_province              VARCHAR(50),
  origin_postal                VARCHAR(20),
  origin_country               CHAR(2) NOT NULL,
  recipient_name               VARCHAR(100),
  recipient_company            VARCHAR(200),
  recipient_phone              VARCHAR(40),
  recipient_email              VARCHAR(200),
  dest_street_1                VARCHAR(200),
  dest_street_2                VARCHAR(200),
  dest_city                    VARCHAR(100),
  dest_province                VARCHAR(50),
  dest_postal                  VARCHAR(20),
  dest_country                 CHAR(2) NOT NULL,
  weight_lb                    DECIMAL(10,2) NOT NULL,
  pieces                       INT NOT NULL,
  dim_l_in                     DECIMAL(8,2),
  dim_w_in                     DECIMAL(8,2),
  dim_h_in                     DECIMAL(8,2),
  freight_class                VARCHAR(10),
  currency                     CHAR(3) DEFAULT 'CAD',
  declared_value               DECIMAL(12,2),
  commodity                    VARCHAR(200),
  accessorials                 VARCHAR(500),
  hold_location_id             VARCHAR(40),
  hold_location_name           VARCHAR(200),
  hold_location_type           VARCHAR(40),
  hold_location_address        TEXT,                         -- JSON
  customs_description          VARCHAR(70),                  -- international parcels: what was declared
  customs_hs_code              VARCHAR(10),
  customs_country_of_manufacture CHAR(2),
  dg_un_number                 VARCHAR(10),
  dg_proper_name               VARCHAR(200),
  dg_class                     VARCHAR(10),
  dg_packing_group             VARCHAR(5),
  dg_quantity                  DECIMAL(10,2),
  dg_units                     VARCHAR(10),
  dg_emergency_phone           VARCHAR(40),
  manual_booking_required      BOOLEAN NOT NULL DEFAULT FALSE,
  manual_booking_reason        VARCHAR(300),
  status                       VARCHAR(20) NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'in_transit', 'delivered', 'cancelled')),
  pickup_status                VARCHAR(20) CHECK (pickup_status IN ('scheduled', 'to_arrange')),
  estimated_delivery           DATE,
  actual_delivery              DATE,
  last_tracked_at              TIMESTAMP,
  booked_at                    TIMESTAMP NOT NULL,
  updated_at                   TIMESTAMP
);

CREATE TABLE tracking_events (
  id           CHAR(24) PRIMARY KEY,
  shipment_id  CHAR(24) NOT NULL REFERENCES shipments(id),
  event        VARCHAR(100) NOT NULL,
  location     VARCHAR(200) NOT NULL,
  event_time   TIMESTAMP NOT NULL,
  description  TEXT,
  created_at   TIMESTAMP NOT NULL
);

-- Money

CREATE TABLE payments (
  id                 CHAR(24) PRIMARY KEY,
  booking_id         CHAR(24) REFERENCES bookings(id),
  user_id            CHAR(24) NOT NULL REFERENCES users(id),
  amount             DECIMAL(12,2) NOT NULL,         -- negative for refunds
  currency           CHAR(3) NOT NULL DEFAULT 'CAD',
  method             VARCHAR(10) CHECK (method IN ('card', 'qb_link', 'credit', 'offline')),
  status             VARCHAR(10) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  qb_transaction_id  VARCHAR(60),
  failure_reason     VARCHAR(500),
  attempted_at       TIMESTAMP NOT NULL
);

CREATE TABLE invoices (
  id              CHAR(24) PRIMARY KEY,
  invoice_number  VARCHAR(20) NOT NULL UNIQUE,       -- INV-YYYY-NNNN
  company_id      CHAR(24) REFERENCES companies(id),
  user_id         CHAR(24) REFERENCES users(id),
  total_amount    DECIMAL(12,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'CAD',
  status          VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  due_date        TIMESTAMP,
  paid_at         TIMESTAMP,
  issued_at       TIMESTAMP NOT NULL
);

CREATE TABLE invoice_items (
  id           SERIAL PRIMARY KEY,
  invoice_id   CHAR(24) NOT NULL REFERENCES invoices(id),
  line_no      INT NOT NULL,
  booking_id   CHAR(24) REFERENCES bookings(id),
  shipment_id  CHAR(24) REFERENCES shipments(id),
  description  VARCHAR(500) NOT NULL,
  amount       DECIMAL(12,2) NOT NULL
);

CREATE TABLE adjustments (
  id                  CHAR(24) PRIMARY KEY,
  adjustment_number   VARCHAR(20) NOT NULL UNIQUE,   -- ADJ-YYYY-NNNN
  booking_id          CHAR(24) NOT NULL REFERENCES bookings(id),
  shipment_id         CHAR(24) REFERENCES shipments(id),
  company_id          CHAR(24) REFERENCES companies(id),
  user_id             CHAR(24) REFERENCES users(id),
  currency            CHAR(3) NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD', 'USD')),
  reason              VARCHAR(20) NOT NULL
                      CHECK (reason IN ('weight', 'dimensions', 'freight_class', 'accessorial', 'other')),
  entered_weight_lb   DECIMAL(10,2),
  entered_pieces      INT,
  entered_l_in        DECIMAL(8,2),
  entered_w_in        DECIMAL(8,2),
  entered_h_in        DECIMAL(8,2),
  entered_class       VARCHAR(10),
  measured_weight_lb  DECIMAL(10,2),
  measured_pieces     INT,
  measured_l_in       DECIMAL(8,2),
  measured_w_in       DECIMAL(8,2),
  measured_h_in       DECIMAL(8,2),
  measured_class      VARCHAR(10),
  carrier_reference   VARCHAR(100),
  evidence_note       TEXT,
  original_cost       DECIMAL(12,2),
  new_cost            DECIMAL(12,2),
  original_price      DECIMAL(12,2),
  new_price           DECIMAL(12,2),
  difference          DECIMAL(12,2),
  admin_fee           DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_due          DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  rules_version       INT REFERENCES pricing_rule_sets(version),
  outcome             VARCHAR(10) NOT NULL CHECK (outcome IN ('charge', 'absorbed', 'credit', 'refund')),
  status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'paid', 'disputed', 'waived', 'absorbed', 'credited', 'refunded', 'cancelled')),
  due_date            TIMESTAMP,
  sent_at             TIMESTAMP,
  paid_at             TIMESTAMP,
  paid_with_credit    DECIMAL(12,2) NOT NULL DEFAULT 0,
  qb_transaction_id   VARCHAR(60),
  dispute_reason      TEXT,
  disputed_at         TIMESTAMP,
  resolution_note     TEXT,
  staff_note          TEXT,
  created_by_user_id  CHAR(24) REFERENCES users(id),
  handled_by_user_id  CHAR(24) REFERENCES users(id),
  created_at          TIMESTAMP NOT NULL,
  updated_at          TIMESTAMP
);

-- Claims and audit

CREATE TABLE claims (
  id                CHAR(24) PRIMARY KEY,
  claim_number      VARCHAR(20) NOT NULL UNIQUE,     -- CLM-YYYY-NNNN
  user_id           CHAR(24) NOT NULL REFERENCES users(id),
  shipment_id       CHAR(24) REFERENCES shipments(id),
  tracking_number   VARCHAR(60) NOT NULL,
  carrier_id        VARCHAR(20) NOT NULL,
  carrier_name      VARCHAR(100) NOT NULL,
  claim_type        VARCHAR(30) NOT NULL,            -- free text, e.g. Damage, Lost package, Delay, Other
  shipment_date     DATE,
  amount_claimed    DECIMAL(12,2) NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'CAD',
  commodity         VARCHAR(200),
  description       TEXT NOT NULL,
  additional_notes  TEXT,
  documents         TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'under_review', 'approved', 'closed')),
  submitted_at      TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP
);

CREATE TABLE claim_documents (
  id                   CHAR(24) PRIMARY KEY,
  claim_id             CHAR(24) NOT NULL REFERENCES claims(id),
  uploaded_by_user_id  CHAR(24) REFERENCES users(id),
  document_type        VARCHAR(30) NOT NULL,         -- photo, invoice, packing_list, inspection_report
  file_name            VARCHAR(255),
  mime_type            VARCHAR(100),
  file_size_bytes      BIGINT,
  storage_key          VARCHAR(500) NOT NULL,
  uploaded_at          TIMESTAMP NOT NULL
);

CREATE TABLE activity_log (
  id          CHAR(24) PRIMARY KEY,
  user_id     CHAR(24),                              -- no foreign keys: the log keeps entries
  company_id  CHAR(24),                              -- for users/companies deleted later
  action      VARCHAR(60) NOT NULL,                  -- login, booking_created, adjustment_sent, ...
  details     TEXT,                                  -- JSON
  created_at  TIMESTAMP NOT NULL
);

-- Lookups people run most
CREATE INDEX ix_bookings_company       ON bookings (company_id, booked_at);
CREATE INDEX ix_shipments_carrier_trk  ON shipments (carrier_tracking_number);
CREATE INDEX ix_invoices_company       ON invoices (company_id, status);
CREATE INDEX ix_payments_booking       ON payments (booking_id);
CREATE INDEX ix_adjustments_booking    ON adjustments (booking_id);
CREATE INDEX ix_tracking_shipment      ON tracking_events (shipment_id, event_time);
