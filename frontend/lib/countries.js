// ISO 3166-1 alpha-2 country codes for the country pickers, with Canada and the US first.
// Names come from the browser (Intl.DisplayNames), so they're localized and always current.
const CODES = [
  'AF', 'AL', 'DZ', 'AD', 'AO', 'AG', 'AR', 'AM', 'AU', 'AT', 'AZ', 'BS', 'BH', 'BD', 'BB', 'BY', 'BE', 'BZ', 'BJ', 'BT',
  'BO', 'BA', 'BW', 'BR', 'BN', 'BG', 'BF', 'BI', 'KH', 'CM', 'CV', 'CF', 'TD', 'CL', 'CN', 'CO', 'KM', 'CG', 'CD',
  'CR', 'CI', 'HR', 'CU', 'CY', 'CZ', 'DK', 'DJ', 'DM', 'DO', 'EC', 'EG', 'SV', 'GQ', 'ER', 'EE', 'SZ', 'ET', 'FJ', 'FI',
  'FR', 'GA', 'GM', 'GE', 'DE', 'GH', 'GR', 'GD', 'GT', 'GN', 'GW', 'GY', 'HT', 'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IR',
  'IQ', 'IE', 'IL', 'IT', 'JM', 'JP', 'JO', 'KZ', 'KE', 'KI', 'KW', 'KG', 'LA', 'LV', 'LB', 'LS', 'LR', 'LY', 'LI', 'LT',
  'LU', 'MO', 'MG', 'MW', 'MY', 'MV', 'ML', 'MT', 'MH', 'MR', 'MU', 'MX', 'FM', 'MD', 'MC', 'MN', 'ME', 'MA', 'MZ', 'MM',
  'NA', 'NR', 'NP', 'NL', 'NZ', 'NI', 'NE', 'NG', 'KP', 'MK', 'NO', 'OM', 'PK', 'PW', 'PA', 'PG', 'PY', 'PE', 'PH', 'PL',
  'PT', 'PR', 'QA', 'RO', 'RU', 'RW', 'KN', 'LC', 'VC', 'WS', 'SM', 'ST', 'SA', 'SN', 'RS', 'SC', 'SL', 'SG', 'SK', 'SI',
  'SB', 'SO', 'ZA', 'KR', 'SS', 'ES', 'LK', 'SD', 'SR', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TZ', 'TH', 'TL', 'TG', 'TO', 'TT',
  'TN', 'TR', 'TM', 'TV', 'UG', 'UA', 'AE', 'GB', 'UY', 'UZ', 'VU', 'VE', 'VN', 'YE', 'ZM', 'ZW',
];

function names() {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return code => dn.of(code) || code;
  } catch {
    return code => code;
  }
}

const nameOf = names();

export const COUNTRIES = [
  { code: 'CA', name: nameOf('CA') },
  { code: 'US', name: nameOf('US') },
  ...CODES.map(code => ({ code, name: nameOf(code) })).sort((a, b) => a.name.localeCompare(b.name)),
];

export const COUNTRY_CODES = new Set(COUNTRIES.map(c => c.code));
