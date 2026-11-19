// == UNISZA Confession Channel Bot ==
// Full script with updated Iklan Niaga message format

// bot @autosent_robot (token lives in GAS Script Properties > BOT_TOKEN — never commit it) 

// https://t.me/unijaconfession (unijaconfession ch) -1001779734656 
// https://t.me/chat_unijaconfession (Chat @ Unija Confession Ch) -1002010542998
// parent message group: https://t.me/chat_unijaconfession/72138
// comment thread https://t.me/unijaconfession/109676?comment=72138

// test channel (Test channel) -1002672028652 https://t.me/c/2672028652/1
// test group (Test Channel Test Chat) -1003882284928

// SOP link https://t.me/unijaconfession/109676?comment=72138

// == UNISZA Confession Channel Bot (With Auto-Delete Feature) ==

// == UNISZA Confession Channel Bot ==
// bot @autosent_robot
// test channel: -1002672028652
// test group: -1003882284928

/**
 * UNISZA Confession Bot - Final Optimized Master Version (FIXED SUICIDE BUG)
 */

const CONFIG = {
  // --- CONNECTION SETTINGS ---
  chatId: '-1001779734656',        // UniJa Confession Channel
  channelUsername: 'unijaconfession', 
  
  groupChatId: '-1002010542998',   // Chat @ Unija Confession
  groupUsername: 'chat_unijaconfession', 
  cleanGroupId: '2010542998',      
  
  testMode: false,                 
  timeZoneOffset: 8,
  
  // --- THREAD SETTINGS ---
  parentMessageId: 72138,          
  sopChannelMsgId: 109676,         
  sopGroupMsgId: 72138,            

  // --- CONTENT SCHEDULES ---
  messages: {
    alMulk: {
      photoUrl: 'https://telegra.ph/file/ac93ddd660204b4372274.png',
      caption: '✨ Jangan lupa baca surah Al-Mulk setiap malam untuk keberkatan! ✨\nMalas nak baca? nak dengar sebelum tidur pun boleh\nTak dapat buat semua, jangan tinggal semua',
      // LIVE bot's own file_id (per-bot!). Seeded 19 Nov 2026 via @autosent_robot DM + getUpdates.
      audioFileId: 'CQACAgUAAxkBAAMhav8BK_PsORh3d4lsAw5wmBx04_MAAiMgAALUtalXnhli5GwgBGI9BA',
      audioCaption: '🎧 Audio Al-Mulk, jom dengar sebelum tidur.',
      schedule: [{ hour: 23, minute: 0 }],
      deletePrevious: false
    },

    iklanNiaga: {
      photoUrl: 'https://telegra.ph/file/6ed5935972e53a04190a2.png',
      // We use <b></b> for bold instead of ** or *
      caption: `Iklan niaga/iklan sewa tidak akan di post dalam channel ini.\n(rujuk <a href="https://t.me/unijaconfession/61294">Larangan Iklan Niaga</a> / <a href="https://t.me/unijaconfession/68591">larangan iklan sewa</a>).`,
      extraButtonText: '🏘️ @iklansewa_unisza',
      extraButtonUrl: 'https://t.me/iklansewa_unisza',
      isAdCategory: true,
      schedule: [{ hour: 10, minute: 0 }, { hour: 21, minute: 0 }],
      deletePrevious: true
    },
    
    //iklanNiaga: {
    //  photoUrl: 'https://telegra.ph/file/6ed5935972e53a04190a2.png',
    //  caption: 'Untuk hantar iklan niaga, sila gunakan butang di bawah', 
    //  isAdCategory: true,
    //  schedule: [{ hour: 10, minute: 0 }, { hour: 21, minute: 0 }],
    //  deletePrevious: true
   // },

    selawat: {
      photoUrl: 'https://telegra.ph/file/a140f873dd3a86d27f5ae.png',
      caption: '۞ اَللهُمَّ صَلِّ عَلَى سَيِّدِنَا مُحَمَّدٍ وَعَلَى آلِ سَيِّدِنَا مُحَمَّدٍ ۞\n\nJangan lupa selawat tau geng 😊',
      schedule: [{ hour: 17, minute: 0 }],
      deletePrevious: false
    }
  },
  stickers: {
    midnightStickers: {
      stickerIds: ['CAACAgUAAxkBAAEObNNoGr3ht5rt42I1zpUIdsZrPYzM_AACYhQAAr2LyVTX1khskE7vSjYE'],
      schedule: [{ hour: 0, minute: 0 }],
      deletePrevious: false
    }
  }
};

// --- ROUTING STUBS ---
function iklanNiaga() { executeBroadcast('iklanNiaga'); }
function alMulk() { executeBroadcast('alMulk'); }
function selawat() { executeBroadcast('selawat'); }
function midnightStickers() { executeBroadcast('midnightStickers'); }

// --- THE UNIVERSAL BROADCASTER ---
function executeBroadcast(key) {
  const token = getTelegramToken();
  const isSticker = CONFIG.stickers[key];
  const item = isSticker || CONFIG.messages[key];
  if (!item) return;

  try {
    if (item.deletePrevious || item.isAdCategory) {
      deleteMsg(`LAST_ID_${key}_GROUP`, CONFIG.groupChatId);
      deleteMsg(`LAST_ID_${key}_CHANNEL`, CONFIG.chatId);
    }
    // Audio follow-ups are one-shot: clear yesterday's before posting today's.
    deleteMsg(`LAST_ID_${key}_CHANNEL2`, CONFIG.chatId);

    let inlineButton = null;
    let chanJumpLink = null;
    if (item.isAdCategory) {
      let sopLink = CONFIG.testMode 
        ? `https://t.me/c/${CONFIG.cleanGroupId}/${CONFIG.sopGroupMsgId}?thread=${CONFIG.sopGroupMsgId}`
        : `https://t.me/${CONFIG.channelUsername}/${CONFIG.sopChannelMsgId}?comment=${CONFIG.sopGroupMsgId}`;

      const groupText = 
        `*Sila hantar iklan anda di sini sahaja (ruangan Iklan Niaga).*\n\n` + 
        `[Wajib Rujuk SOP ini](${sopLink}) kalau tak nak kena mute/ban.\n\n` +
        `Tak faham tanya, jangan buat palatao`;

      const gRes = callTelegram('sendMessage', {
        chat_id: CONFIG.groupChatId,
        text: groupText,
        parse_mode: 'Markdown',
        reply_parameters: JSON.stringify({ message_id: CONFIG.parentMessageId, allow_sending_without_reply: true }),
        link_preview_options: JSON.stringify({ is_disabled: true })
      });

      if (gRes.ok) {
  saveId(`${key}_GROUP`, gRes.result.message_id);
  chanJumpLink = CONFIG.testMode 
    ? `https://t.me/c/${CONFIG.cleanGroupId}/${gRes.result.message_id}?thread=${CONFIG.parentMessageId}`
    : `https://t.me/${CONFIG.channelUsername}/${CONFIG.sopChannelMsgId}?comment=${gRes.result.message_id}`;
    
  
  // --- UPDATED BUTTON LOGIC ---
  inlineButton = [
      [{ text: '📝 Iklan Niaga', url: chanJumpLink }], // Button 1
      [{ text: item.extraButtonText, url: item.extraButtonUrl }] // Button 2
  ];
      }
    }

    let cRes;
    if (isSticker) {
      item.stickerIds.forEach(id => {
        cRes = callTelegram('sendSticker', { chat_id: CONFIG.chatId, sticker: id });
      });
    } else if (item.isAdCategory && chanJumpLink) {
      cRes = sendIklanRich(CONFIG.chatId, chanJumpLink, item, inlineButton);
    } else if (item.audioFileId) {
      cRes = sendAlMulkRich(CONFIG.chatId, item);
    } else {
      const payload = {
        chat_id: CONFIG.chatId,
        photo: item.photoUrl,
        caption: item.caption,
        parse_mode: 'HTML' // <--- CHANGE THIS FROM 'Markdown' TO 'HTML'
      };
      if (inlineButton) payload.reply_markup = JSON.stringify({ inline_keyboard: inlineButton });
      cRes = callTelegram('sendPhoto', payload);
    }

    if (cRes && cRes.ok && (item.deletePrevious || item.isAdCategory)) {
      saveId(`${key}_CHANNEL`, cRes.result.message_id);
    }
  } catch (e) {
    Logger.log(`❌ Critical Error: ${e.message}`);
    notifyOwner(`❌ daily-reminder LIVE ${key} gagal: ${e.message}`);
  }
}

// --- OWNER ALERTS (silent failures page the owner DM) ---
function ownerDm() {
  return PropertiesService.getScriptProperties().getProperty('OWNER_DM');
}
function notifyOwner(text) {
  try {
    const id = ownerDm();
    if (!id) { Logger.log('notifyOwner skipped (no OWNER_DM): ' + text); return; }
    callTelegram('sendMessage', { chat_id: id, text: String(text).slice(0, 4000) });
  } catch (e) { Logger.log('owner alert failed: ' + e); }
}

// --- IKLAN RICH CARD (blocks body + inline keyboard, no comment UI) ---
// Rule caption + 2 collapsibles + button/desc pairs. Falls back to photo+buttons.
function sendIklanRich(chatId, jumpLink, item, inlineButton) {
  var blocks = [
    { type: 'paragraph', text: { type: 'bold', text: 'Iklan Niaga/Sewa' } },
    { type: 'photo', photo: { type: 'photo', media: item.photoUrl } },
    { type: 'paragraph', text: [
      'Iklan niaga/iklan sewa tidak akan di post dalam channel ini.\n(rujuk ',
      { type: 'url', text: 'Larangan Iklan Niaga', url: 'https://t.me/unijaconfession/61294' },
      ' / ',
      { type: 'url', text: 'larangan iklan sewa', url: 'https://t.me/unijaconfession/68591' },
      ').'
    ] },
    { type: 'details', summary: 'Apa itu iklan niaga?', blocks: [
      { type: 'paragraph', text: '• Promote link shoppe dan apa jua affiliate\n• referral link (Temu, dll)\n• Letgo apa jua jenis barangan\n• letgo/jual tiket bas\n• Sebarang link/pautan kepada group niaga (kecuali yang dibenarkan)\n• Apa jua jenis servis (grab, delivery, runner, dan sebagainya)' }
    ] },
    { type: 'details', summary: 'Apa itu iklan sewa?', blocks: [
      { type: 'paragraph', text: '• Kekosongan bilik/rumah & mencari pengganti penyewa\n• Promote rumah/bilik sewa (oleh owner/ejen)\n• Mencari rumah/bilik sewa (oleh penyewa)' }
    ] },
    { type: 'paragraph', text: '📝 Iklan Niaga: untuk urusan hantar & lihat iklan niaga' },
    { type: 'paragraph', text: '🏘️ @\u200Biklansewa_unisza: urusan rumah sewa (iklan, mencari replacement)' },
  ];
  var keyboard = { inline_keyboard: [
    [{ text: '📝 Iklan Niaga', url: jumpLink }],
    [{ text: '🏘️ @iklansewa_unisza', url: item.extraButtonUrl }]
  ] };
  var r = callTelegram('sendRichMessage', {
    chat_id: chatId,
    rich_message: JSON.stringify({ blocks: blocks }),
    reply_markup: JSON.stringify(keyboard)
  });
  if (r.ok) return r;
  Logger.log('rich iklan failed (' + JSON.stringify(r) + ') — falling back to photo+buttons');
  var payload = { chat_id: chatId, photo: item.photoUrl, caption: item.caption, parse_mode: 'HTML' };
  if (inlineButton) payload.reply_markup = JSON.stringify({ inline_keyboard: inlineButton });
  else payload.reply_markup = JSON.stringify(keyboard);
  return callTelegram('sendPhoto', payload);
}

// --- MANUAL PROBE: rich iklan card by hand (port of test richIklanButton) ---
// Run richIklanButton() manually in GAS. Same card as scheduled iklanNiaga,
// fixed jump link to the SOP thread (no fresh group post). Verifies the rich
// path on live without waiting for 10:00/21:00 or spamming the group.
function richIklanButton() {
  var chatId = CONFIG.chatId;
  var item = CONFIG.messages.iklanNiaga;
  var jumpLink = 'https://t.me/' + CONFIG.channelUsername + '/' + CONFIG.sopChannelMsgId + '?comment=' + CONFIG.sopGroupMsgId;
  var blocks = [
    { type: 'paragraph', text: { type: 'bold', text: 'Iklan Niaga/Sewa' } },
    { type: 'photo', photo: { type: 'photo', media: item.photoUrl } },
    { type: 'paragraph', text: [
      'Iklan niaga/iklan sewa tidak akan di post dalam channel ini.\n(rujuk ',
      { type: 'url', text: 'Larangan Iklan Niaga', url: 'https://t.me/unijaconfession/61294' },
      ' / ',
      { type: 'url', text: 'larangan iklan sewa', url: 'https://t.me/unijaconfession/68591' },
      ').'
    ] },
    { type: 'details', summary: 'Apa itu iklan niaga?', blocks: [
      { type: 'paragraph', text: '• Promote link shoppe dan apa jua affiliate\n• referral link (Temu, dll)\n• Letgo apa jua jenis barangan\n• letgo/jual tiket bas\n• Sebarang link/pautan kepada group niaga (kecuali yang dibenarkan)\n• Apa jua jenis servis (grab, delivery, runner, dan sebagainya)' }
    ] },
    { type: 'details', summary: 'Apa itu iklan sewa?', blocks: [
      { type: 'paragraph', text: '• Kekosongan bilik/rumah & mencari pengganti penyewa\n• Promote rumah/bilik sewa (oleh owner/ejen)\n• Mencari rumah/bilik sewa (oleh penyewa)' }
    ] },
    { type: 'paragraph', text: '📝 Iklan Niaga: untuk urusan hantar & lihat iklan niaga' },
    { type: 'paragraph', text: '🏘️ @iklansewa_unisza: urusan rumah sewa (iklan, mencari replacement)'.replace('@iklansewa', '@\u200Biklansewa') }
  ];
  var keyboard = { inline_keyboard: [
    [{ text: '📝 Iklan Niaga', url: jumpLink }],
    [{ text: '🏘️ @iklansewa_unisza', url: item.extraButtonUrl }]
  ] };
  var r = callTelegram('sendRichMessage', {
    chat_id: chatId,
    rich_message: JSON.stringify({ blocks: blocks }),
    reply_markup: JSON.stringify(keyboard)
  });
  if (!r.ok) {
    Logger.log('richIklanButton rich failed (' + JSON.stringify(r) + ') — falling back to photo');
    var payload = { chat_id: chatId, photo: item.photoUrl, caption: item.caption, parse_mode: 'HTML' };
    payload.reply_markup = JSON.stringify(keyboard);
    r = callTelegram('sendPhoto', payload);
  }
  if (r && r.ok) saveId('iklanNiaga_CHANNEL', r.result.message_id);
  Logger.log('richIklanButton posted ' + (r && r.ok ? r.result.message_id : 'FAILED: ' + JSON.stringify(r)));
}

// --- ALMULK RICH SINGLE (photo + caption + audio in one message) ---
// Proven by /specialprobe mulkrich (test) — title dropped: identity is baked
// at upload, title on file_id resend is ignored by Telegram.
function sendAlMulkRich(chatId, item) {
  var blocks = [
    { type: 'paragraph', text: { type: 'bold', text: 'Daily Al-Mulk Reminder' } },
    { type: 'photo', photo: { type: 'photo', media: item.photoUrl } },
    { type: 'paragraph', text: item.caption },
    { type: 'audio', audio: { type: 'audio', media: item.audioFileId } },
    { type: 'paragraph', text: item.audioCaption || '' }
  ];
  var r = callTelegram('sendRichMessage', { chat_id: chatId, rich_message: JSON.stringify({ blocks: blocks }) });
  if (r.ok) return r;
  Logger.log('rich almulk failed (' + JSON.stringify(r) + ') — falling back to photo+audio');
  var p = callTelegram('sendPhoto', { chat_id: chatId, photo: item.photoUrl, caption: item.caption, parse_mode: 'HTML' });
  if (p.ok) callTelegram('sendAudio', { chat_id: chatId, audio: item.audioFileId, caption: item.audioCaption || '' });
  return p;
}

// --- TELEGRAM & HELPERS ---
function callTelegram(method, payload) {
  const url = `https://api.telegram.org/bot${getTelegramToken()}/${method}`;
  const res = UrlFetchApp.fetch(url, { method: 'post', payload: payload, muteHttpExceptions: true });
  return JSON.parse(res.getContentText());
}

function getTelegramToken() {
  const t = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  if (!t) throw new Error("BOT_TOKEN missing.");
  return t;
}

function deleteMsg(propKey, chatId) {
  const id = PropertiesService.getScriptProperties().getProperty(propKey);
  if (id) {
    callTelegram('deleteMessage', { chat_id: chatId, message_id: id });
    PropertiesService.getScriptProperties().deleteProperty(propKey);
  }
}

function saveId(suffix, val) {
  PropertiesService.getScriptProperties().setProperty(`LAST_ID_${suffix}`, val.toString());
}

// --- DYNAMIC TRIGGER ENGINE ---
function createTriggers() {
  const allTriggers = ScriptApp.getProjectTriggers();
  
  // FIXED: Do NOT delete the Daily Reset trigger itself
  allTriggers.forEach(t => {
    if (t.getHandlerFunction() !== 'createTriggers') {
      ScriptApp.deleteTrigger(t);
    }
  });

  const setTimeTrigger = (funcName, schedules) => {
    schedules.forEach(s => {
      const triggerTime = new Date(); 
      triggerTime.setHours(s.hour, s.minute, 0, 0);
      if (triggerTime.getTime() < new Date().getTime()) triggerTime.setDate(triggerTime.getDate() + 1);
      ScriptApp.newTrigger(funcName).timeBased().at(triggerTime).create();
      Logger.log(`📅 Scheduled ${funcName} for ${triggerTime.toLocaleString()}`);
    });
  };

  for (let key in CONFIG.messages) setTimeTrigger(key, CONFIG.messages[key].schedule);
  for (let key in CONFIG.stickers) setTimeTrigger(key, CONFIG.stickers[key].schedule);
}

function setup() {
  // Wipe EVERYTHING to start clean
  const allTriggers = ScriptApp.getProjectTriggers();
  allTriggers.forEach(t => ScriptApp.deleteTrigger(t));
  
  cleanupDatabase();

  // 1. Create the permanent Daily Reset trigger (Day 1)
  ScriptApp.newTrigger('createTriggers')
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .nearMinute(5)
    .create();
    
  // 2. Run createTriggers manually for Day 1
  createTriggers();
  
  Logger.log('✅ Setup Complete. Permanent Master Trigger installed.');
}

function cleanupDatabase() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const validKeys = Object.keys(CONFIG.messages).concat(Object.keys(CONFIG.stickers));
  for (let key in allProps) {
    if (key.startsWith('LAST_ID_')) {
      const category = key.replace('LAST_ID_', '').replace('_GROUP', '').replace('_CHANNEL', '');
      if (!validKeys.includes(category)) props.deleteProperty(key);
    }
  }
}