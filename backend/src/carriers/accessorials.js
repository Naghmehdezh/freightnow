// Accessorial options offered on the quote form, and which carrier supports which.
// Source: Accessorial_Support_Map.md — each code was confirmed against the carrier's API.
//
// Every carrier names its services differently; the app uses one set of option ids and each
// adapter translates them to its own codes. When a selected option isn't offered by a carrier,
// that carrier isn't queried and the customer sees "not available with …" instead.

const OPTIONS = {
  // LTL / freight
  liftgate_pickup: 'Liftgate pickup',
  liftgate_delivery: 'Liftgate delivery',
  residential_pickup: 'Residential pickup',
  residential: 'Residential delivery', // also parcel: residential address
  inside_pickup: 'Inside pickup',
  inside_delivery: 'Inside delivery',
  limited_access_pickup: 'Limited access pickup',
  limited_access_delivery: 'Limited access delivery',
  appointment_pickup: 'Pickup appointment',
  appointment: 'Delivery appointment', // parcel: FedEx Home Delivery® appointment
  call_before_delivery: 'Call before delivery',
  hazmat: 'Hazmat', // parcel: dangerous goods
  do_not_stack: 'Do not stack',
  oversize: 'Oversize / excess length',
  in_bond: 'In-bond (customs)',
  saturday: 'Saturday delivery',
  // Parcel / envelope only
  pickup: 'Pickup', // a courier collects it (LTL always includes a pickup, so it isn't an option there)
  saturday_pickup: 'Saturday pickup',
  signature_none: 'No Signature Required',
  signature_indirect: 'Indirect Signature Required',
  signature_direct: 'Direct Signature Required',
  signature_adult: 'Adult Signature Required',
  hold_at_location: 'Hold at location',
  evening_delivery: 'FedEx Evening Home Delivery®',
  date_certain: 'FedEx Date Certain Home Delivery®',
};

// Parcel / envelope wording (FedEx Integrator validation) where it differs from LTL.
const PARCEL_OPTIONS = {
  residential: 'Residential Delivery',
  appointment: 'FedEx Appointment Home Delivery®',
  hazmat: 'Dangerous goods',
};

const NO = null; // the carrier doesn't offer it
const NOT_ONLINE = 'not_online'; // offered, but the carrier can't price it online (needs IFF)

// Per carrier: option → the carrier's code (informational for adapters with special mapping),
// NO, or NOT_ONLINE. Options missing from a carrier's table are treated as NO.
const SUPPORT = {
  csa: {
    liftgate_pickup: 'TAIL', liftgate_delivery: 'TAILC',
    residential_pickup: 'CURBP', residential: 'CURB',
    limited_access_pickup: 'LIMITED', limited_access_delivery: 'LIMITEDD',
    appointment_pickup: 'APPTFEEP', appointment: 'APPTFEE',
    call_before_delivery: 'NOT',
  },
  dayross: {
    pickup: 'pickUpBy', // parcel: the pickup window is part of every Day & Ross shipment
    liftgate_pickup: 'TLGPU', liftgate_delivery: 'TLGDL',
    residential_pickup: 'PRESPU', residential: 'PRESDL',
    // Valid codes, but Day & Ross's API answers "Unable to rate shipment" when they're sent.
    inside_pickup: NOT_ONLINE, inside_delivery: NOT_ONLINE,
    limited_access_pickup: NOT_ONLINE, limited_access_delivery: NOT_ONLINE,
    appointment_pickup: 'APPTPU', appointment: 'APPTDL',
    hazmat: 'HAZMAT',
    in_bond: 'INBOND',
  },
  polaris: {
    liftgate_pickup: 'Lifgate_Pickup', liftgate_delivery: 'Lifgate_Delivery',
    residential_pickup: 'Residential_Pickup', residential: 'Residential_Delivery',
    inside_pickup: 'Inside_Pickup', inside_delivery: 'Inside_Delivery',
    limited_access_pickup: 'Limited_Access_Pickup', limited_access_delivery: 'Limited_Access_Delivery',
    appointment: 'Appointment_Delivery',
    do_not_stack: 'Do_Not_Stack', oversize: 'OverSizeFreight', in_bond: 'In_Bond',
  },
  xpo: {
    liftgate_pickup: 'OLG', liftgate_delivery: 'DLG',
    residential_pickup: 'RSO', residential: 'RSD',
    inside_pickup: 'OIP', inside_delivery: 'DID',
    limited_access_pickup: 'OLA', limited_access_delivery: 'DLA',
    appointment: 'APT',
    call_before_delivery: 'DNC',
    hazmat: 'ZHM',
    oversize: 'ELS',
    in_bond: 'CIB',
    saturday: 'DSH',
  },
  estes: {
    liftgate_pickup: 'LGATEP', liftgate_delivery: 'LGATE',
    residential_pickup: 'HPU', residential: 'HD',
    inside_pickup: 'INP', inside_delivery: 'INS',
    limited_access_pickup: 'by site type', limited_access_delivery: 'by site type',
    appointment: 'APT',
    call_before_delivery: 'NCM',
    hazmat: 'HAZ',
    oversize: 'from dimensions', // Estes applies LONG16/LONG20/… itself from the length
    in_bond: 'INB',
  },
  // Parcel carriers. FedEx supports every parcel option; lane/date limits (e.g. Home Delivery®
  // US only, Saturday pickup on Saturdays) are checked by the adapter itself.
  fedex: Object.fromEntries([
    'pickup', 'residential', 'saturday', 'saturday_pickup', 'signature_none', 'signature_indirect', 'signature_direct', 'signature_adult',
    'hold_at_location', 'appointment', 'evening_delivery', 'date_certain', 'hazmat',
  ].map(o => [o, 'FedEx'])),
  dhl: {
    pickup: 'pickup', // booked with the shipment (pickup.isRequested), not a value-added service
    residential: 'TK',
    saturday: 'AA',
    signature_none: 'SX',
    signature_direct: 'SF',
    signature_adult: 'SD',
    hold_at_location: 'LX',
    hazmat: 'HE',
  },
};

// Estes charges limited access by type of site.
const ESTES_LIMITED_ACCESS = {
  school: { label: 'School', delivery: 'SCHLDL', pickup: 'SCHLPU' },
  secured: { label: 'Prison / secured site', delivery: 'PRISDL', pickup: 'PRISPU' },
  farm: { label: 'Farm / ranch', delivery: 'FARMDL', pickup: 'FARMPU' },
  mini_storage: { label: 'Mini-storage', delivery: 'MINIDL', pickup: 'MINIPU' },
  worship: { label: 'Place of worship', delivery: 'WORDL', pickup: 'WORPU' },
  seaport: { label: 'Seaport', delivery: 'SEADL', pickup: 'SEAPU' },
  fair: { label: 'Fair / exhibition', delivery: 'FAIRDL', pickup: 'FAIRPU' },
  construction: { label: 'Construction site', delivery: 'CONST', pickup: 'CONSTP' },
};

// Carriers return charge descriptions in capitals ("TAILGATE DELIVERY") — tidy for display.
function titleCase(text) {
  return String(text).toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\s+/g, ' ').trim();
}

function labelFor(option, shipmentType) {
  if ((shipmentType === 'parcel' || shipmentType === 'envelope') && PARCEL_OPTIONS[option]) return PARCEL_OPTIONS[option];
  return OPTIONS[option] || option;
}

// The selected options this carrier can't provide: [{ option, label, reason }].
function unavailableOptions(carrierId, accessorials = [], params = {}) {
  const table = SUPPORT[carrierId];
  if (!table) return [];
  const out = [];
  for (const option of accessorials) {
    const v = table[option];
    if (v === undefined || v === NO) out.push({ option, label: labelFor(option, params.shipmentType), reason: 'not_offered' });
    else if (v === NOT_ONLINE) out.push({ option, label: labelFor(option, params.shipmentType), reason: 'not_online' });
  }
  // Estes limited access needs the site type to choose its code.
  if (carrierId === 'estes' && !ESTES_LIMITED_ACCESS[params.limitedAccessType]) {
    for (const option of accessorials.filter(a => a.startsWith('limited_access') && !out.some(o => o.option === a))) {
      out.push({ option, label: labelFor(option), reason: 'needs_details' });
    }
  }
  return out;
}

// Why the carrier's price doesn't include these options (shown on the rate card).
function unavailableMessage(items) {
  const parts = [];
  const of = reason => items.filter(i => i.reason === reason).map(i => i.label);
  if (of('not_offered').length) parts.push(`This carrier doesn't offer ${of('not_offered').join(', ')}.`);
  if (of('not_online').length) parts.push(`This carrier can't price ${of('not_online').join(', ')} online.`);
  if (of('needs_details').length) parts.push('Select the type of limited access site to include it.');
  return parts.join(' ');
}

// Thrown by an adapter when the carrier can't provide a selected option on this shipment
// (found only at quote time — e.g. FedEx Home Delivery® outside the US). `options` lists the
// option ids concerned; null means the carrier couldn't say which (drop them all).
class OptionUnavailableError extends Error {
  constructor(message, options = null) {
    super(message);
    this.name = 'OptionUnavailableError';
    this.options = options;
  }
}

module.exports = { OPTIONS, SUPPORT, ESTES_LIMITED_ACCESS, labelFor, titleCase, unavailableOptions, unavailableMessage, OptionUnavailableError };
