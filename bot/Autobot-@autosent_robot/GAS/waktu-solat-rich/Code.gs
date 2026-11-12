// Code.gs — TEST config + entry points (rich trial).
// Live GAS (bot/Autobot-@autosent_robot/waktu-solat) untouched.
// Setup: new Apps Script project → paste Code.gs + SolatRich.gs →
// Script Properties: BOT_TOKEN = <test bot token, admin in test channel>.

var CONFIG = {
  zone: 'TRG01', // jakimCode - https://api.waktusolat.app/zones
  channelId: '-1001779734656', // TEST channel (same as @Just_arobot trial; live is -1001779734656)
  channelLink: 'https://t.me/unijaconfession', // member-only deep-link base
  headerTitle: '⏰ Jadual Waktu Solat Fardhu',
  headerPlace: '🇲🇾 UniSZA Kampus Gong Badak',
  zoneCaption: 'Zon TRG01: Kuala Terengganu, Marang, Kuala Nerus',
  footerTag: 'IlmuDemiFaedahInsan',
  footerBy: 'utmconfession',
  ramadan: 'auto', // 'auto' | true | false — Ramadan lines when hijri month is 09 (or backup window below)
  ramadanWindow: { start: '2027-02-08', end: '2027-03-09' }, // backup when API hijri is patchy (Raya 2027-03-10)
  // TEST ONLY (keep commented for live): force a hijri date to preview Ramadan lines.
  //testHijri: '1448-09-05',
  //testHijriNext: '1448-09-06',
  prayers: [
    { key: 'imsak',   emoji: '⏳', name: 'Imsak',
      head: '🕌 Waktu Imsak! ⏳',
      body: 'Yang bersahur tu boleh dah slow-slow siap untuk azan Subuh yaa' },
    { key: 'fajr',    emoji: '⛅️', name: 'Subuh'   },
    { key: 'syuruk',  emoji: '🌄', name: 'Syuruk', noTick: true,
      head: '🕌 Waktu Syuruk! 🌄',
      body: 'Matahari dah terbit, Dhuha masuk ~25 minit lagi.' },
    { key: 'dhuha',   emoji: '🌅', name: 'Dhuha',
      head: '🕌 Waktu Solat Dhuha! 🌅',
      body: '<blockquote>Daripada Abu Zar r.a., Rasulullah SAW bersabda: "Pada setiap pagi, ada kewajipan sedekah bagi tiap-tiap sendi salah seorang dari kamu. Maka tiap-tiap tasbih adalah sedekah, tiap-tiap tahmid adalah sedekah, tiap-tiap tahlil adalah sedekah, tiap-tiap takbir adalah sedekah, menyuruh kepada kebaikan adalah sedekah, mencegah kemungkaran adalah sedekah. Dan semua itu cukup (dibayar) dengan dua rakaat Dhuha yang didirikannya." (Riwayat Muslim no. 720)</blockquote>' },
    { key: 'dhuhr',   emoji: '🌞', name: 'Zohor',
      pre: "⏰ Menghampiri Waktu Zohor {time}\n(Waktu Dhuha telah tamat. sekarang waktu istiwa', diharamkan solat sunat pada waktu ini kecuali pada hari Jumaat)." },
    { key: 'asr',     emoji: '☀️', name: 'Asar'    },
    { key: 'maghrib', emoji: '🌙', name: 'Maghrib' },
    { key: 'isha',    emoji: '⭐️', name: 'Isyak'   }
  ]
};

function daily() {
  SolatRich.daily(CONFIG, 4, 45);
}

function reminder(col, name) {
  SolatRich.edits(CONFIG, col, name,
    'bagi umat Islam.\nMoh belaka solat awal!\n');
}

// Helper Functions (col is legacy/unused — 0 for new rows)
// NOTE: trigger names are Malay; prayer keys stay API-form (reminder's 2nd arg).
function imsak()    { return reminder(0, 'imsak');    }
function subuh()    { return reminder(2, 'fajr');    }
function dhuha()    { return reminder(0, 'dhuha');    }
function syuruk()   { return reminder(0, 'syuruk');   } // manual only — no auto trigger

// 10-min heads-up (light notice, no card edit, no quote)
// Mornings excluded: preFajr ≈ imsak time (noise), preDhuha unneeded.
function preZohor()   { return SolatRich.pre(CONFIG, 'dhuhr');   }
function preAsar()     { return SolatRich.pre(CONFIG, 'asr');     }
function preMaghrib() { return SolatRich.pre(CONFIG, 'maghrib'); }
function preIsyak()    { return SolatRich.pre(CONFIG, 'isha');    }
function zohor()   { return reminder(3, 'dhuhr');   }
function asar()     { return reminder(4, 'asr');     }
function maghrib() { return reminder(5, 'maghrib'); }
function isyak()    { return reminder(6, 'isha');    }

// Wipe today's state + delete today's test posts (re-run clean).
function resetToday() {
  SolatRich.resetToday(CONFIG);
}

// Daily self-scheduling: run once, it re-arms daily + per-prayer triggers.
function setup() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('daily').timeBased().everyDays(1).atHour(4).nearMinute(45).create();
  daily();
}
