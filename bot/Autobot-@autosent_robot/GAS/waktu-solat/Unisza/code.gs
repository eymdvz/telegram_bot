const zone = 'TRG01'; // jakimCode - https://api.waktusolat.app/zones
const bot_token = '7230381034:AAFxJ40u-xFdQbLVYW_jA5DBvv8qubKxksI';
const channel_url = 'https://t.me/unijaconfession';
const channel_id = '-1001779734656' // '-1002833980400'

const header = `⏰ Jadual Waktu Solat Fardhu\n`
              +`🇲🇾 UniSZA Kampus Gong Badak\n\n`;

const prayers = [
  { emoji: '⛅️', name: 'Subuh'   },
  { emoji: '🌞', name: 'Zohor'   },
  { emoji: '☀️', name: 'Asar'    },
  { emoji: '🌙', name: 'Maghrib' },
  { emoji: '⭐️', name: 'Isyak'   }
];

const footer = '\n\n#IlmuDemiFaedahInsan\nby @utmconfession';

function daily(){
  v2.daily( bot_token, channel_id, header, prayers, footer, zone, 4, 45 );
}

// https://t.me/unijaconfession/44988https://t.me/unijaconfession/54234https://t.me/unijaconfession/66508https://t.me/unijaconfession/73071https://t.me/unijaconfession/95761https://t.me/unijaconfession/125888https://t.me/unijaconfession/127194https://t.me/unijaconfession/129322https://t.me/unijaconfession/130605https://t.me/unijaconfession/132227https://t.me/unijaconfession/134312

function test() {
  console.log(JSON.stringify(v2.send(bot_token, channel_id, 'deleteMessage', { message_id: 134312 })));
}

function reminder( col, name ){
  v2.edits( bot_token, channel_id, header, prayers, footer, col, name, 'bagi umat Islam.\nMoh belaka solat awal!\n', channel_url );
}

// Helper Functions
function fajr()     { return reminder(2,'fajr');    }
function dhuhr()    { return reminder(3,'dhuhr');   }
function asr()      { return reminder(4,'asr');     }
function maghrib()  { return reminder(5,'maghrib'); }
function isha()     { return reminder(6,'isha');    }
function onOpen(e)  { return v2.onOpen(e);          }