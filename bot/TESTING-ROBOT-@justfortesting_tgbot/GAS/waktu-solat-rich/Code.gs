// Code.gs — TEST config + entry points (rich trial).
// Live GAS (bot/Autobot-@autosent_robot/waktu-solat) untouched.
// Setup: new Apps Script project → paste Code.gs + SolatRich.gs →
// Script Properties: BOT_TOKEN = <test bot token, admin in test channel>.

var CONFIG = {
  zone: 'TRG01', // jakimCode - https://api.waktusolat.app/zones
  channelId: '-1001267775431', // TEST channel (same as @Just_arobot trial; live is -1001779734656)
  channelLink: 'https://t.me/c/1267775431', // member-only deep-link base
  headerTitle: '⏰ Jadual Waktu Solat Fardhu',
  headerPlace: '🇲🇾 UniSZA Kampus Gong Badak',
  zoneCaption: 'Zon TRG01: Kuala Terengganu, Marang, Kuala Nerus',
  footerTag: 'IlmuDemiFaedahInsan',
  footerBy: 'utmconfession',
  prayers: [
    { key: 'fajr',    emoji: '⛅️', name: 'Subuh'   },
    { key: 'dhuhr',   emoji: '🌞', name: 'Zohor'   },
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

// Helper Functions
function fajr()    { return reminder(2, 'fajr');    }
function dhuhr()   { return reminder(3, 'dhuhr');   }
function asr()     { return reminder(4, 'asr');     }
function maghrib() { return reminder(5, 'maghrib'); }
function isha()    { return reminder(6, 'isha');    }

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
