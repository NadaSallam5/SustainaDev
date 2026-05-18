/*
Carbon intensity sources:
- Electricity Maps API (real-time): https://www.electricitymaps.com/
- IEA country averages (2023): https://www.iea.org/data-and-statistics/data-product/emissions-factors-2023
- Our World in Data grid intensity: https://ourworldindata.org/grapher/carbon-intensity-electricity
*/

// IEA 2023 country averages in gCO₂/kWh
// Source: https://www.iea.org/data-and-statistics/data-product/emissions-factors-2023
const COUNTRY_INTENSITY: Record<string, number> = {
  // Africa
  EG: 458,  // Egypt
  NG: 430,  // Nigeria
  ZA: 840,  // South Africa (coal-heavy)
  MA: 610,  // Morocco
  KE: 58,   // Kenya (geothermal-heavy)
  ET: 22,   // Ethiopia (hydro-heavy)
  GH: 340,  // Ghana
  TZ: 205,  // Tanzania

  // Americas
  US: 386,  // United States (EPA eGRID 2022 national average)
  CA: 120,  // Canada (hydro-heavy)
  BR: 89,   // Brazil (hydro-heavy)
  MX: 430,  // Mexico
  AR: 320,  // Argentina
  CL: 280,  // Chile
  CO: 175,  // Colombia
  PE: 185,  // Peru

  // Europe
  GB: 189,  // United Kingdom
  DE: 385,  // Germany
  FR: 56,   // France (nuclear-heavy)
  NO: 26,   // Norway (almost all hydro)
  SE: 41,   // Sweden
  PL: 635,  // Poland
  NL: 290,  // Netherlands
  ES: 158,  // Spain
  IT: 233,  // Italy
  CH: 28,   // Switzerland (nuclear + hydro)
  AT: 85,   // Austria
  BE: 143,  // Belgium
  DK: 159,  // Denmark
  FI: 75,   // Finland
  PT: 130,  // Portugal
  CZ: 410,  // Czech Republic
  RO: 240,  // Romania
  HU: 210,  // Hungary
  GR: 380,  // Greece
  UA: 215,  // Ukraine
  RU: 320,  // Russia

  // Asia
  CN: 557,  // China
  IN: 632,  // India
  JP: 462,  // Japan
  KR: 415,  // South Korea
  SA: 710,  // Saudi Arabia
  AE: 520,  // UAE
  TR: 390,  // Turkey
  PK: 350,  // Pakistan
  BD: 520,  // Bangladesh
  ID: 640,  // Indonesia
  TH: 490,  // Thailand
  VN: 480,  // Vietnam
  MY: 550,  // Malaysia
  SG: 390,  // Singapore
  PH: 560,  // Philippines
  TW: 490,  // Taiwan
  HK: 540,  // Hong Kong
  IL: 430,  // Israel
  IR: 520,  // Iran
  IQ: 590,  // Iraq

  // Oceania
  AU: 490,  // Australia
  NZ: 85,   // New Zealand (geothermal + hydro)
};

// Global average from IEA 2023 — used when country unknown
export const GLOBAL_AVERAGE_INTENSITY = 436;

/**
 * Calculate carbon emissions in grams CO₂ from energy consumption.
 *
 * @param energyKwh - Energy consumed in kilowatt-hours
 * @param countryCode - ISO 3166-1 alpha-2 country code (e.g. "US", "DE", "EG")
 * @returns Carbon in grams CO₂
 */
export function calculateCarbon(
  energyKwh: number,
  countryCode?: string
): number {
  const intensity: number =
    (countryCode ? COUNTRY_INTENSITY[countryCode.toUpperCase()] : undefined) ??
    GLOBAL_AVERAGE_INTENSITY;

  return energyKwh * intensity;
}

/**
 * Get the carbon intensity for a country code.
 * Returns global average if country is unknown.
 */
export function getIntensity(countryCode?: string): number {
  return (
    (countryCode ? COUNTRY_INTENSITY[countryCode.toUpperCase()] : undefined) ??
    GLOBAL_AVERAGE_INTENSITY
  );
}

/**
 * Detect country code from system locale/timezone as best-effort.
 * This is used to automatically wire country into carbon calculations
 * without requiring the user to configure it.
 *
 * Priority:
 *   1. VS Code locale setting (passed in if available)
 *   2. LANG environment variable
 *   3. TZ (timezone) → country heuristic
 *   4. undefined → falls back to global average in calculateCarbon()
 */
export function detectCountryCode(vscodeLangOverride?: string): string | undefined {
  // 1. Explicit override (e.g. from VS Code config)
  if (vscodeLangOverride) {
    const match = vscodeLangOverride.match(/[-_]([A-Z]{2})$/i);
    if (match) return match[1].toUpperCase();
  }

  // 2. LANG env var e.g. "en_US.UTF-8" → "US"
  const lang = process.env.LANG ?? process.env.LANGUAGE ?? "";
  const langMatch = lang.match(/[-_]([A-Z]{2})/i);
  if (langMatch) {
    const code = langMatch[1].toUpperCase();
    if (COUNTRY_INTENSITY[code] !== undefined) return code;
  }

  // 3. Timezone heuristic — maps broad TZ prefixes to likely countries
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const tzMap: Record<string, string> = {
    "America/New_York": "US",
    "America/Chicago": "US",
    "America/Denver": "US",
    "America/Los_Angeles": "US",
    "America/Toronto": "CA",
    "America/Vancouver": "CA",
    "America/Sao_Paulo": "BR",
    "America/Mexico_City": "MX",
    "America/Buenos_Aires": "AR",
    "America/Santiago": "CL",
    "America/Bogota": "CO",
    "America/Lima": "PE",
    "Europe/London": "GB",
    "Europe/Berlin": "DE",
    "Europe/Paris": "FR",
    "Europe/Oslo": "NO",
    "Europe/Stockholm": "SE",
    "Europe/Warsaw": "PL",
    "Europe/Amsterdam": "NL",
    "Europe/Madrid": "ES",
    "Europe/Rome": "IT",
    "Europe/Zurich": "CH",
    "Europe/Vienna": "AT",
    "Europe/Brussels": "BE",
    "Europe/Copenhagen": "DK",
    "Europe/Helsinki": "FI",
    "Europe/Lisbon": "PT",
    "Europe/Prague": "CZ",
    "Europe/Bucharest": "RO",
    "Europe/Budapest": "HU",
    "Europe/Athens": "GR",
    "Europe/Kiev": "UA",
    "Europe/Moscow": "RU",
    "Asia/Shanghai": "CN",
    "Asia/Beijing": "CN",
    "Asia/Kolkata": "IN",
    "Asia/Tokyo": "JP",
    "Asia/Seoul": "KR",
    "Asia/Riyadh": "SA",
    "Asia/Dubai": "AE",
    "Asia/Istanbul": "TR",
    "Asia/Karachi": "PK",
    "Asia/Dhaka": "BD",
    "Asia/Jakarta": "ID",
    "Asia/Bangkok": "TH",
    "Asia/Ho_Chi_Minh": "VN",
    "Asia/Kuala_Lumpur": "MY",
    "Asia/Singapore": "SG",
    "Asia/Manila": "PH",
    "Asia/Taipei": "TW",
    "Asia/Hong_Kong": "HK",
    "Asia/Jerusalem": "IL",
    "Asia/Tehran": "IR",
    "Asia/Baghdad": "IQ",
    "Africa/Cairo": "EG",
    "Africa/Lagos": "NG",
    "Africa/Johannesburg": "ZA",
    "Africa/Casablanca": "MA",
    "Africa/Nairobi": "KE",
    "Africa/Addis_Ababa": "ET",
    "Africa/Accra": "GH",
    "Africa/Dar_es_Salaam": "TZ",
    "Australia/Sydney": "AU",
    "Australia/Melbourne": "AU",
    "Pacific/Auckland": "NZ",
  };

  if (tzMap[tz]) return tzMap[tz];

  // Prefix fallback e.g. "America/..." → check first segment
  const tzPrefix = tz.split("/")[0];
  if (tzPrefix === "America") return "US"; // best guess for unknown Americas
  if (tzPrefix === "Europe") return "DE";  // best guess for unknown Europe
  if (tzPrefix === "Asia") return "CN";    // best guess for unknown Asia
  if (tzPrefix === "Africa") return "ZA";  // best guess for unknown Africa
  if (tzPrefix === "Australia") return "AU";

  return undefined;
}