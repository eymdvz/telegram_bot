// SolatRich.gs — rich-card port of v2.gs for the TEST project.
// State in PropertiesService (no Sheets here).
// Verified shapes (tgcloud trial, msg 376+): sendRichMessage blocks,
// quote_rich_texts with the two table cells. Rich edit is UNVERIFIED —
// edits() tries rich edit, falls back to delete+repost.

var SolatRich = (function () {
  var TZ = 'Asia/Singapore';
  var DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
  var MONTHS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
  var MOON = ['Muharram', 'Safar', "Rabi'ul Awal", "Rabi'ul Akhir", 'Jamadil Awal', 'Jamadil Akhir', 'Rejab', "Sya'aban", 'Ramadhan', 'Syawal', 'Zulkaedah', 'Zulhijjah'];

  function props() { return PropertiesService.getScriptProperties(); }
  function token() {
    var t = props().getProperty('BOT_TOKEN');
    if (!t) throw new Error('BOT_TOKEN missing (Script Properties).');
    return t;
  }

  function dayKey(d) {
    return Utilities.formatDate(d || new Date(), TZ, 'yyyy-MM-dd');
  }
  function fmtTime(unixSec) {
    return Utilities.formatDate(new Date(unixSec * 1000), TZ, 'hh:mm a');
  }

  function callTelegram(method, payload) {
    var url = 'https://api.telegram.org/bot' + token() + '/' + method;
    var res = UrlFetchApp.fetch(url, { method: 'post', payload: payload, muteHttpExceptions: true });
    return JSON.parse(res.getContentText());
  }

  function sendRich(cfg, blocks, fallbackText) {
    var r = callTelegram('sendRichMessage', {
      chat_id: cfg.channelId,
      rich_message: JSON.stringify({ blocks: blocks })
    });
    if (r.ok) return { id: r.result.message_id, rich: true };
    Logger.log('rich failed: ' + JSON.stringify(r) + ' — falling back to text');
    var t = callTelegram('sendMessage', {
      chat_id: cfg.channelId,
      text: String(fallbackText).slice(0, 4096)
    });
    if (!t.ok) throw new Error('sendMessage failed: ' + JSON.stringify(t));
    return { id: t.result.message_id, rich: false };
  }

  function buildBlocks(cfg, today, current) {
    function nameCell(t) { return { text: t, align: 'right', valign: 'top' }; }
    function timeCell(t) { return { text: t, align: 'left', valign: 'top' }; }
    function hotName(t) { return { text: t, is_header: true, align: 'right', valign: 'top' }; }
    function hotTime(t) { return { text: t, is_header: true, align: 'left', valign: 'top' }; }
    var rows = cfg.prayers.map(function (p) {
      var hot = (p.key === current);
      return hot
        ? [hotName(p.emoji + ' ' + p.name), hotTime(fmtTime(today.times[p.key]))]
        : [nameCell(p.emoji + ' ' + p.name), timeCell(fmtTime(today.times[p.key]))];
    });
    var blocks = [
      { type: 'paragraph', text: cfg.headerTitle + '\n' + cfg.headerPlace + '\n\n' + today.dates + '\n' + today.hijri },
      { type: 'divider' },
      { type: 'table', is_bordered: false, is_compact: true, caption: cfg.zoneCaption, cells: rows },
      { type: 'paragraph', text: [{ type: 'hashtag', text: '#' + cfg.footerTag, hashtag: cfg.footerTag }, '\nby @' + cfg.footerBy] },
      { type: 'buttons', align: 'center', buttons: [{ text: 'Waktu Solat ' + cfg.zone, url: 'https://dev.mamtj6.com/waktu-solat?location=' + cfg.zone, style: 'success' }] }
    ];
    var lines = cfg.prayers.map(function (p) { return p.emoji + ' ' + fmtTime(today.times[p.key]) + ' : ' + p.name; });
    var fallback = cfg.headerTitle + '\n' + cfg.headerPlace + '\n\n' + today.dates + '\n' + today.hijri +
      '\n\n' + lines.join('\n') + '\n\n#' + cfg.footerTag + '\nby @' + cfg.footerBy;
    return { blocks: blocks, fallback: fallback };
  }

  function fetchMonth(cfg, y, mo) {
    var r = UrlFetchApp.fetch('https://api.waktusolat.app/v2/solat/' + cfg.zone + '?year=' + y + '&month=' + mo);
    if (r.getResponseCode() !== 200) throw new Error('solat fetch ' + r.getResponseCode());
    return JSON.parse(r.getContentText());
  }

  function parseH(s) {
    var p = String(s).split('-');
    return { y: p[0], m: ('0' + parseInt(p[1], 10)).slice(-2), d: parseInt(p[2], 10) };
  }
  function shiftKey(key, days) {
    var p = key.split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + days);
    return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  }

  function fetchDayTimes(cfg) {
    var now = new Date();
    var y = Utilities.formatDate(now, TZ, 'yyyy');
    var mo = parseInt(Utilities.formatDate(now, TZ, 'M'), 10);
    var dd = parseInt(Utilities.formatDate(now, TZ, 'd'), 10);
    var data = fetchMonth(cfg, y, mo);
    var found = (data.prayers || []).filter(function (p) { return p.day === dd; })[0];
    if (!found) throw new Error('solat day not found');
    // Tomorrow's hijri decides terawih-vs-Raya (roll to next month if needed).
    var tom = (data.prayers || []).filter(function (p) { return p.day === dd + 1; })[0];
    if (!tom) {
      var ny = mo === 12 ? parseInt(y, 10) + 1 : parseInt(y, 10);
      var nm = mo === 12 ? 1 : mo + 1;
      var data2 = fetchMonth(cfg, ny, nm);
      tom = (data2.prayers || [])[0];
    }
    var times = {};
    cfg.prayers.forEach(function (p) { times[p.key] = found[p.key]; });
    var hp = String(found.hijri).split('-');
    var h = parseH(found.hijri);
    var th = tom ? parseH(tom.hijri) : { y: h.y, m: h.m, d: h.d + 1 };
    // TEST ONLY: forced hijri (Code.gs testHijri) to preview Ramadan lines.
    if (cfg.testHijri) {
      h = parseH(cfg.testHijri);
      th = cfg.testHijriNext ? parseH(cfg.testHijriNext) : { y: h.y, m: h.m, d: h.d + 1 };
    }
    return {
      dates: '📅 ' + DAYS[parseInt(Utilities.formatDate(now, TZ, 'u'), 10) % 7] + ', ' + dd + ' ' + MONTHS[mo - 1] + ' ' + y,
      hijri: '🇵🇸 ' + hp[2] + ' ' + MOON[parseInt(hp[1], 10) - 1] + ' ' + hp[0] + 'H',
      times: times,
      h: h,
      tom: th
    };
  }
  // NOTE: 'u' gives ISO day (1=Mon..7=Sun); %7 maps Sun→0 to match DAYS (0=Ahad).

  function save(key, val) { props().setProperty(key, val); }
  function load(key) { return props().getProperty(key); }
  function stateKey(cfg, suffix) { return 'SOLAT_' + cfg.zone + '_' + suffix; }

  function ramadanInfo(cfg, today, key) {
    if (cfg.ramadan === false) return { on: false };
    if (cfg.ramadan !== true && cfg.ramadan !== 'auto') return { on: false };
    var inWin = function (k) { return !!cfg.ramadanWindow && k >= cfg.ramadanWindow.start && k <= cfg.ramadanWindow.end; };
    var hToday = (today.h.m === '09');
    var hTom = (today.tom.m === '09');
    var wToday = inWin(key);
    var wTom = inWin(shiftKey(key, 1));
    var on = (cfg.ramadan === true) || hToday || wToday;
    if (!on) return { on: false };
    var dayNo = hToday ? today.h.d : (Math.round((new Date(key) - new Date(cfg.ramadanWindow.start)) / 86400000) + 1);
    var tomRamadan = hTom || wTom;
    return { on: true, day: dayNo, terawih: tomRamadan ? (hTom ? today.tom.d : dayNo + 1) : 0, raya: !tomRamadan };
  }

  function daily(cfg, hour, minute) {
    try {
      // Re-arm: wipe yesterday's one-shot prayer triggers, keep the schedulers.
      ScriptApp.getProjectTriggers().forEach(function (t) {
        var h = t.getHandlerFunction();
        if (h !== 'setup' && h !== 'daily') ScriptApp.deleteTrigger(t);
      });
      var now = new Date();

      var key = dayKey();
      var prevMain = load(stateKey(cfg, 'MAIN'));
      var prevRem = load(stateKey(cfg, 'REM'));
      if (prevMain || prevRem) {
        var ids = [];
        if (prevMain) ids.push(parseInt(prevMain, 10));
        try { (JSON.parse(prevRem || '[]')).forEach(function (id) { ids.push(parseInt(id, 10)); }); } catch (e) {}
        ids = ids.filter(function (id) { return id > 0; });
        if (ids.length) callTelegram('deleteMessages', { chat_id: cfg.channelId, message_ids: JSON.stringify(ids) });
      }

      var today = fetchDayTimes(cfg);
      var b = buildBlocks(cfg, today, null);
      var sent = sendRich(cfg, b.blocks, b.fallback);

      save(stateKey(cfg, 'DAY'), key);
      save(stateKey(cfg, 'DATA'), JSON.stringify(today));
      save(stateKey(cfg, 'MAIN'), String(sent.id));
      save(stateKey(cfg, 'REM'), JSON.stringify([]));
      save(stateKey(cfg, 'PRE'), JSON.stringify({}));

      // Per-prayer triggers, 60s EARLY (GAS fires late, never early —
      // edits() sleeps the remainder so the post lands on the exact time).
      // noTick rows (Syuruk) are card-only: no trigger, no reminder.
      // Trigger fn names are Malay (Code.gs) — keys stay API-form.
      var FN = { fajr: 'subuh', dhuhr: 'zohor', asr: 'asar', isha: 'isyak' };
      cfg.prayers.forEach(function (p) {
        if (p.noTick) return;
        var fn = FN[p.key] || p.key;
        var t = new Date(today.times[p.key] * 1000 - 60000);
        if (t.getTime() > Date.now()) {
          ScriptApp.newTrigger(fn).timeBased().at(t).create();
        }
        // 10-min heads-up (skip silent rows + Imsak, which IS the fajr-10min
        // warning, + morning Fajr/Dhuha to keep dawn quiet).
        if (p.key === 'imsak' || p.key === 'fajr' || p.key === 'dhuha') return;
        var pre = new Date(today.times[p.key] * 1000 - 10 * 60 * 1000);
        if (pre.getTime() > Date.now()) {
          var preBase = FN[p.key] || p.key;
          ScriptApp.newTrigger('pre' + preBase.charAt(0).toUpperCase() + preBase.slice(1)).timeBased().at(pre).create();
        }
      });
      Logger.log('posted day card ' + sent.id + ' rich=' + sent.rich);
      return sent.id;
    } catch (e) {
      Logger.log('daily failed: ' + e.stack);
      throw e;
    }
  }

  function edits(cfg, col, current, footer) {
    try {
      var today = JSON.parse(load(stateKey(cfg, 'DATA')) || 'null');
      if (!today) throw new Error('no DATA — run daily() first');
      var mainId = parseInt(load(stateKey(cfg, 'MAIN')), 10);
      var rems = JSON.parse(load(stateKey(cfg, 'REM')) || '[]');

      var p = cfg.prayers.filter(function (x) { return x.key === current; })[0];
      var idx = cfg.prayers.indexOf(p);

      // On-time guard: trigger was armed 60s early — sleep the remainder
      // (cap 120s; if the trigger itself ran late, skip the sleep).
      var waitMs = today.times[current] * 1000 - Date.now();
      if (waitMs > 0 && waitMs <= 120000) Utilities.sleep(waitMs);
      var time = fmtTime(today.times[current]);
      var next = null;
      for (var j = idx + 1; j < cfg.prayers.length; j++) {
        if (!cfg.prayers[j].noTick) { next = cfg.prayers[j]; break; }
      }
      var nextTxt = next ? next.name + ' 🔜 ' + fmtTime(today.times[next.key]) : '⏰ Jadual Waktu Solat Fardhu';

      // 1) Rich card edit (UNVERIFIED) → fallback delete+repost.
      var b = buildBlocks(cfg, today, current);
      var er = callTelegram('editMessageText', {
        chat_id: cfg.channelId,
        message_id: String(mainId),
        rich_message: JSON.stringify({ blocks: b.blocks })
      });
      if (er.ok) {
        Logger.log('rich edit ok for ' + current);
      } else {
        Logger.log('rich edit failed (' + JSON.stringify(er) + ') — delete+repost');
        callTelegram('deleteMessage', { chat_id: cfg.channelId, message_id: String(mainId) });
        var rs = sendRich(cfg, b.blocks, b.fallback);
        mainId = rs.id;
        save(stateKey(cfg, 'MAIN'), String(mainId));
      }

      // 2) Reminder reply with real rich quote (verified in tgcloud trial).
      // Card row is now is_header (plain text) — quote stays plain strings
      // to mirror the card (API: "rich texts must be nested in the same way").
      var rb = reminderBlocks(cfg, p, time, nextTxt, mainId, ramadanLine(cfg, today, load(stateKey(cfg, 'DAY')), current));
      var replyParams = {
        message_id: mainId,
        allow_sending_without_reply: true,
        quote_rich_texts: [p.emoji + ' ' + p.name, time]
      };
      var rr = callTelegram('sendRichMessage', {
        chat_id: cfg.channelId,
        rich_message: JSON.stringify({ blocks: rb.blocks }),
        reply_parameters: JSON.stringify(replyParams),
        reply_markup: JSON.stringify({ inline_keyboard: [[{ text: rb.nextTxt, url: cfg.channelLink + '/' + mainId }]] })
      });
      if (!rr.ok || !rr.result) {
        Logger.log('rich reminder failed (' + JSON.stringify(rr) + ') — falling back to text');
        rr = callTelegram('sendMessage', {
          chat_id: cfg.channelId,
          text: String(rb.fallback).slice(0, 4096),
          parse_mode: 'HTML',
          reply_parameters: JSON.stringify(replyParams),
          reply_markup: JSON.stringify({
            inline_keyboard: [
              [{ text: nextTxt, url: cfg.channelLink + '/' + mainId }],
              [{ text: '🌐 Waktu Solat ' + cfg.zone, url: 'https://dev.mamtj6.com/waktu-solat?location=' + cfg.zone }]
            ]
          })
        });
      }
      if (!rr.ok) throw new Error('reminder failed: ' + JSON.stringify(rr));
      rems.push(rr.result.message_id);
      save(stateKey(cfg, 'REM'), JSON.stringify(rems));
      Logger.log('reminder posted ' + rr.result.message_id + ' for ' + current);

      // 3) Clean up this prayer's 10-min heads-up (ignore result — already-gone is fine).
      var pres = JSON.parse(load(stateKey(cfg, 'PRE')) || '{}');
      if (pres[current]) {
        callTelegram('deleteMessage', { chat_id: cfg.channelId, message_id: String(pres[current]) });
        delete pres[current];
        save(stateKey(cfg, 'PRE'), JSON.stringify(pres));
      }
      return rr.result.message_id;
    } catch (e) {
      Logger.log('edits failed: ' + e.stack);
      throw e;
    }
  }

  // 10-min heads-up: light plain reply, no card edit, no quote.
  function pre(cfg, current) {
    try {
      var today = JSON.parse(load(stateKey(cfg, 'DATA')) || 'null');
      if (!today) throw new Error('no DATA — run daily() first');
      var mainId = parseInt(load(stateKey(cfg, 'MAIN')), 10);
      var pres = JSON.parse(load(stateKey(cfg, 'PRE')) || '{}');
      if (pres[current]) { Logger.log('pre already sent for ' + current); return pres[current]; }
      var list = cfg.prayers;
      var idx = -1;
      var p = null;
      for (var j = 0; j < list.length; j++) { if (list[j].key === current) { idx = j; p = list[j]; break; } }
      if (!p) throw new Error('unknown prayer ' + current);
      var prev = null;
      for (var k = idx - 1; k >= 0; k--) { if (!list[k].noTick) { prev = list[k]; break; } }
      var tpl = p.pre || ('⏰ Menghampiri Waktu ' + p.name + ' {time}' + (prev ? ' (Waktu ' + prev.name + ' berbaki 10 minit lagi).' : '.'));
      var time = fmtTime(today.times[current]);
      var r = callTelegram('sendMessage', {
        chat_id: cfg.channelId,
        text: tpl.split('{time}').join(time),
        parse_mode: 'HTML',
        reply_parameters: JSON.stringify({ message_id: mainId, allow_sending_without_reply: true })
      });
      if (!r.ok) throw new Error('pre failed: ' + JSON.stringify(r));
      pres[current] = r.result.message_id;
      save(stateKey(cfg, 'PRE'), JSON.stringify(pres));
      return r.result.message_id;
    } catch (e) {
      Logger.log('pre failed: ' + e.stack);
      throw e;
    }
  }

  function inlineRich(s) {
    var out = [];
    var re = /<b>(.*?)<\/b>/g;
    var last = 0;
    var m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      out.push({ type: 'bold', text: m[1] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }

  function ramadanLine(cfg, today, dayKey, current) {
    var ri = ramadanInfo(cfg, today, dayKey);
    if (!ri.on) return '';
    if (current === 'fajr') return '\nSelamat berpuasa untuk hari ke ' + ri.day + ' Ramadan';
    if (current === 'maghrib') return '\nAlhamdulilah, anda telah selesai berpuasa pada hari ke ' + ri.day + ' Ramadan';
    if (current === 'isha') {
      return ri.terawih
        ? '\nJom berterawih untuk malam ke ' + ri.terawih + ' Ramadan'
        : (ri.raya ? '\nSelamat Hari Raya Aidilfitri!' : '');
    }
    return '';
  }

  function reminderBlocks(cfg, p, time, nextTxt, mainId, extra) {
    var head = p.head || ('🕌 Waktu Solat <b>' + p.name + '! ' + p.emoji + '</b>');
    var body = ((p.body !== undefined && p.body !== null) ? p.body : 'bagi umat Islam.\nMoh belaka solat awal!') + (extra || '');
    var blocks = [{ type: 'paragraph', text: inlineRich(head).concat(['\n' + time]) }];
    var bqm = body.match(/^<blockquote>([\s\S]*)<\/blockquote>$/);
    if (bqm) blocks.push({ type: 'blockquote', blocks: [{ type: 'paragraph', text: bqm[1] }] });
    else blocks.push({ type: 'paragraph', text: inlineRich(body) });
    blocks.push({ type: 'buttons', align: 'center', buttons: [
      { text: '🌐 Waktu Solat ' + cfg.zone, url: 'https://dev.mamtj6.com/waktu-solat?location=' + cfg.zone, style: 'success' }
    ] });
    return { blocks: blocks, fallback: head + '\n' + time + '\n\n' + body, nextTxt: nextTxt };
  }

  function resetToday(cfg) {
    var mainId = load(stateKey(cfg, 'MAIN'));
    var rems = load(stateKey(cfg, 'REM'));
    var ids = [];
    if (mainId) ids.push(parseInt(mainId, 10));
    try { (JSON.parse(rems || '[]')).forEach(function (id) { ids.push(parseInt(id, 10)); }); } catch (e) {}
    try {
      var preIds = JSON.parse(load(stateKey(cfg, 'PRE')) || '{}');
      Object.keys(preIds).forEach(function (k) { ids.push(parseInt(preIds[k], 10)); });
    } catch (e2) {}
    ids = ids.filter(function (id) { return id > 0; });
    if (ids.length) {
      var r = callTelegram('deleteMessages', { chat_id: cfg.channelId, message_ids: JSON.stringify(ids) });
      Logger.log('reset deleted: ' + JSON.stringify(r));
    }
    ['DAY', 'DATA', 'MAIN', 'REM', 'PRE'].forEach(function (s) { props().deleteProperty(stateKey(cfg, s)); });
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction();
      if (h !== 'setup' && h !== 'daily') ScriptApp.deleteTrigger(t);
    });
  }

  return { daily: daily, edits: edits, pre: pre, resetToday: resetToday };
})();
