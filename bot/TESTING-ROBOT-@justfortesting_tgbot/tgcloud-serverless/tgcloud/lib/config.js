// Test env config — mirrors bot/@Just_arobot test targets. Never tokens here.
export const CHANNEL_ID = -1001267775431; // Test Channel — bot must be admin (post + delete)
export const GROUP_ID = -1002435146176; // Test group (unused for now)
export const TEST_CHANNEL_LINK = 'https://t.me/c/1267775431'; // member-only deep link base
export const ZONE = 'TRG01'; // jakimCode - https://api.waktusolat.app/zones
export const HEADER_TITLE = '⏰ Jadual Waktu Solat Fardhu';
export const HEADER_PLACE = '🇲🇾 UniSZA Kampus Gong Badak';
export const ZONE_CAPTION = 'Zon TRG01: Kuala Terengganu, Marang, Kuala Nerus';
export const FOOTER_TAG = 'IlmuDemiFaedahInsan';
export const FOOTER_BY = 'utmconfession';
export const PRAYERS = [
  { key: 'fajr', emoji: '⛅️', name: 'Subuh' },
  { key: 'dhuhr', emoji: '🌞', name: 'Zohor' },
  { key: 'asr', emoji: '☀️', name: 'Asar' },
  { key: 'maghrib', emoji: '🌙', name: 'Maghrib' },
  { key: 'isha', emoji: '⭐️', name: 'Isyak' },
];
export const PRAYER_KEYS = PRAYERS.map((p) => p.key);
// Same owner id as bot/@Just_arobot — test commands are owner-only.
export const ADMIN_IDS = [230757915];
