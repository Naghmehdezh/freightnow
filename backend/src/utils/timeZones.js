// Main time zone per Canadian province / US state, to turn a local pickup time into a
// timestamp with a UTC offset (e.g. "2026-11-05T08:00:00-05:00"). States that span zones use
// the zone most of their population is in.

const CA = {
  NL: 'America/St_Johns', NS: 'America/Halifax', PE: 'America/Halifax', NB: 'America/Moncton',
  QC: 'America/Toronto', ON: 'America/Toronto', MB: 'America/Winnipeg', SK: 'America/Regina',
  AB: 'America/Edmonton', BC: 'America/Vancouver', NT: 'America/Yellowknife', NU: 'America/Iqaluit',
  YT: 'America/Whitehorse',
};

const US_ZONES = {
  'America/New_York': ['CT', 'DE', 'DC', 'FL', 'GA', 'IN', 'KY', 'ME', 'MD', 'MA', 'MI', 'NH', 'NJ', 'NY', 'NC', 'OH', 'PA', 'RI', 'SC', 'VT', 'VA', 'WV'],
  'America/Chicago': ['AL', 'AR', 'IL', 'IA', 'KS', 'LA', 'MN', 'MS', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'TX', 'WI'],
  'America/Denver': ['CO', 'MT', 'NM', 'UT', 'WY', 'ID'],
  'America/Phoenix': ['AZ'],
  'America/Los_Angeles': ['CA', 'NV', 'OR', 'WA'],
  'America/Anchorage': ['AK'],
  'Pacific/Honolulu': ['HI'],
};
const US = Object.fromEntries(Object.entries(US_ZONES).flatMap(([zone, states]) => states.map(st => [st, zone])));

function timeZoneFor(country, region) {
  const r = String(region || '').toUpperCase();
  if (String(country || '').toUpperCase() === 'US') return US[r] || 'America/New_York';
  return CA[r] || 'America/Toronto';
}

// "-05:00" style offset of a zone on a given date (handles daylight saving time).
function utcOffset(timeZone, date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find(p => p.type === 'timeZoneName')?.value || 'GMT';
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
}

// Local date + "HH:MM" at an address → ISO timestamp with that address's offset.
function localTimestamp(date, time, country, region) {
  return `${date}T${time}:00${utcOffset(timeZoneFor(country, region), date)}`;
}

module.exports = { timeZoneFor, utcOffset, localTimestamp };
