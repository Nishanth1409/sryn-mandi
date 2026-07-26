/** Major arecanut APMCs / districts with approximate coordinates (WGS84). */
export type MandiPoint = {
  id: string
  market: string
  district: string
  state: string
  lat: number
  lng: number
  aliases: string[]
}

export const ARECA_MANDIS: MandiPoint[] = [
  {
    id: 'shimoga',
    market: 'Shimoga APMC',
    district: 'Shivamogga',
    state: 'Karnataka',
    lat: 13.9299,
    lng: 75.5681,
    aliases: ['shimoga', 'shivamogga', 'shimoga apmc'],
  },
  {
    id: 'bhadravathi',
    market: 'Bhadravathi APMC',
    district: 'Shivamogga',
    state: 'Karnataka',
    lat: 13.8485,
    lng: 75.705,
    aliases: ['bhadravathi', 'bhadravati'],
  },
  {
    id: 'shikaripura',
    market: 'Shikaripura APMC',
    district: 'Shivamogga',
    state: 'Karnataka',
    lat: 14.2697,
    lng: 75.3564,
    aliases: ['shikaripura', 'shikaripur'],
  },
  {
    id: 'thirthahalli',
    market: 'APMC THIRTHAHALLI',
    district: 'Shivamogga',
    state: 'Karnataka',
    lat: 13.6881,
    lng: 75.245,
    aliases: ['thirthahalli', 'tirthahalli', 'theertahalli'],
  },
  {
    id: 'sagar',
    market: 'Sagar APMC',
    district: 'Shivamogga',
    state: 'Karnataka',
    lat: 14.1667,
    lng: 75.0333,
    aliases: ['sagar', 'hosanagara'],
  },
  {
    id: 'sorab',
    market: 'Sorabha APMC',
    district: 'Shivamogga',
    state: 'Karnataka',
    lat: 14.38,
    lng: 75.09,
    aliases: ['sorab', 'sorabha'],
  },
  {
    id: 'channagiri',
    market: 'Channagiri APMC',
    district: 'Davangere',
    state: 'Karnataka',
    lat: 14.024,
    lng: 75.925,
    aliases: ['channagiri'],
  },
  {
    id: 'davangere',
    market: 'Davangere APMC',
    district: 'Davangere',
    state: 'Karnataka',
    lat: 14.4644,
    lng: 75.9218,
    aliases: ['davangere', 'davanagere'],
  },
  {
    id: 'honnali',
    market: 'Honnali APMC',
    district: 'Davangere',
    state: 'Karnataka',
    lat: 14.24,
    lng: 75.62,
    aliases: ['honnali'],
  },
  {
    id: 'kadur',
    market: 'Kadur APMC',
    district: 'Chikkamagaluru',
    state: 'Karnataka',
    lat: 13.5528,
    lng: 76.0111,
    aliases: ['kadur'],
  },
  {
    id: 'koppa',
    market: 'Koppa APMC',
    district: 'Chikkamagaluru',
    state: 'Karnataka',
    lat: 13.5302,
    lng: 75.3633,
    aliases: ['koppa'],
  },
  {
    id: 'tarikere',
    market: 'Tarikere APMC',
    district: 'Chikkamagaluru',
    state: 'Karnataka',
    lat: 13.7094,
    lng: 75.8139,
    aliases: ['tarikere'],
  },
  {
    id: 'puttur',
    market: 'Puttur APMC',
    district: 'Dakshina Kannada',
    state: 'Karnataka',
    lat: 12.7597,
    lng: 75.2017,
    aliases: ['puttur'],
  },
  {
    id: 'sulya',
    market: 'Sulya APMC',
    district: 'Dakshina Kannada',
    state: 'Karnataka',
    lat: 12.561,
    lng: 75.389,
    aliases: ['sulya', 'sullia'],
  },
  {
    id: 'bantwala',
    market: 'Bantwala APMC',
    district: 'Dakshina Kannada',
    state: 'Karnataka',
    lat: 12.8905,
    lng: 75.0349,
    aliases: ['bantwala', 'bantwal'],
  },
  {
    id: 'belthangadi',
    market: 'Belthangdi APMC',
    district: 'Dakshina Kannada',
    state: 'Karnataka',
    lat: 12.991,
    lng: 75.301,
    aliases: ['belthangadi', 'belthangdi'],
  },
  {
    id: 'karkala',
    market: 'Karkala APMC',
    district: 'Udupi',
    state: 'Karnataka',
    lat: 13.214,
    lng: 74.996,
    aliases: ['karkala'],
  },
  {
    id: 'kundapura',
    market: 'Kundapura APMC',
    district: 'Udupi',
    state: 'Karnataka',
    lat: 13.631,
    lng: 74.691,
    aliases: ['kundapura', 'kundapur'],
  },
  {
    id: 'sirsi',
    market: 'Sirsi APMC',
    district: 'Uttara Kannada',
    state: 'Karnataka',
    lat: 14.6196,
    lng: 74.8354,
    aliases: ['sirsi'],
  },
  {
    id: 'kumta',
    market: 'Kumta APMC',
    district: 'Uttara Kannada',
    state: 'Karnataka',
    lat: 14.426,
    lng: 74.419,
    aliases: ['kumta'],
  },
  {
    id: 'yellapur',
    market: 'Yellapur APMC',
    district: 'Uttara Kannada',
    state: 'Karnataka',
    lat: 14.964,
    lng: 74.712,
    aliases: ['yellapur'],
  },
  {
    id: 'honnavar',
    market: 'Honnavar APMC',
    district: 'Uttara Kannada',
    state: 'Karnataka',
    lat: 14.28,
    lng: 74.445,
    aliases: ['honnavar', 'honnavara'],
  },
  {
    id: 'tiptur',
    market: 'Tiptur APMC',
    district: 'Tumakuru',
    state: 'Karnataka',
    lat: 13.258,
    lng: 76.476,
    aliases: ['tiptur'],
  },
  {
    id: 'sira',
    market: 'Sira APMC',
    district: 'Tumakuru',
    state: 'Karnataka',
    lat: 13.745,
    lng: 76.904,
    aliases: ['sira'],
  },
  {
    id: 'mysuru',
    market: 'Mysuru APMC',
    district: 'Mysuru',
    state: 'Karnataka',
    lat: 12.2958,
    lng: 76.6394,
    aliases: ['mysuru', 'mysore'],
  },
  {
    id: 'bengaluru',
    market: 'Bengaluru APMC',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    lat: 12.9716,
    lng: 77.5946,
    aliases: ['bengaluru', 'bangalore', 'bengaluru urban', 'bengaluru rural'],
  },
]

/** Four headline arecanut grades shown on local mandi boards. */
export const VARIETY_BUCKETS = [
  {
    key: 'sarakku',
    title: 'Sarakku',
    kannada: 'ಸರಕು',
    match: ['saraku', 'sarakku', 'sarak'],
  },
  {
    key: 'bede',
    title: 'Bede',
    kannada: 'ಬೆಟ್ಟೆ',
    match: ['bette', 'bede', 'tattibettee', 'tatti bettee'],
  },
  {
    key: 'rashi',
    title: 'Rashi',
    kannada: 'ರಾಶಿ',
    match: ['rashi', 'rasi'],
  },
  {
    key: 'andal',
    title: 'Andal',
    kannada: 'ಅಂಡಲ್',
    // Andal is the local board name; AGMARKNET often lists this grade as Gorabalu
    match: ['andal', 'andaal', 'gorabalu', 'gorabal'],
  },
] as const

export type VarietyBucketKey = (typeof VARIETY_BUCKETS)[number]['key']

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function findNearestMandi(lat: number, lng: number): {
  mandi: MandiPoint
  distanceKm: number
} {
  let best = ARECA_MANDIS[0]
  let bestDist = Number.POSITIVE_INFINITY
  for (const m of ARECA_MANDIS) {
    const d = haversineKm(lat, lng, m.lat, m.lng)
    if (d < bestDist) {
      best = m
      bestDist = d
    }
  }
  return { mandi: best, distanceKm: Math.round(bestDist * 10) / 10 }
}

export function matchesVarietyBucket(variety: string, match: readonly string[]): boolean {
  const v = variety.toLowerCase().trim()
  return match.some((m) => v === m || v.includes(m))
}
