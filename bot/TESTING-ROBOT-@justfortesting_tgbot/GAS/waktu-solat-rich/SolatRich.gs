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
    function headCell(t) { return { text: t, is_header: true, align: 'left', valign: 'top' }; }
    function cell(t, hot) {
      return hot
        ? { text: { type: 'marked', text: { type: 'bold', text: t } }, align: 'left', valign: 'top' }
        : { text: t, align: 'left', valign: 'top' };
    }
    var rows = cfg.prayers.map(function (p) {
      var bold = (p.key === current);
      return [cell(p.emoji + ' ' + p.name, bold), cell(fmtTime(today.times[p.key]), bold)];
    });
    var blocks = [
      { type: 'paragraph', text: cfg.headerTitle + '\n' + cfg.headerPlace + '\n\n' + today.dates + '\n' + today.hijri },
      { type: 'divider' },
      { type: 'blockquote', blocks: [{ type: 'table', is_bordered: true, caption: cfg.zoneCaption, cells: [[headCell('Solat'), headCell('Waktu')]].concat(rows) }] },
      { type: 'paragraph', text: [{ type: 'hashtag', text: '#' + cfg.footerTag, hashtag: cfg.footerTag }, '\nby @' + cfg.footerBy] },
      { type: 'buttons', align: 'center', buttons: [{ text: 'Waktu Solat ' + cfg.zone, url: 'https://dev.mamtj6.com/waktu-solat?location=' + cfg.zone, style: 'success' }] }
    ];
    var lines = cfg.prayers.map(function (p) { return p.emoji + ' ' + fmtTime(today.times[p.key]) + ' : ' + p.name; });
    var fallback = cfg.headerTitle + '\n' + cfg.headerPlace + '\n\n' + today.dates + '\n' + today.hijri +
      '\n\n' + lines.join('\n') + '\n\n#' + cfg.footerTag + '\nby @' + cfg.footerBy;
    return { blocks: blocks, fallback: fallback };
  }

  function fetchDayTimes(cfg) {
    var now = new Date();
    var y = Utilities.formatDate(now, TZ, 'yyyy');
    var mo = parseInt(Utilities.formatDate(now, TZ, 'M'), 10);
    var dd = parseInt(Utilities.formatDate(now, TZ, 'd'), 10);
    var r = UrlFetchApp.fetch('https://api.waktusolat.app/v2/solat/' + cfg.zone + '?year=' + y + '&month=' + mo);
    if (r.getResponseCode() !== 200) throw new Error('solat fetch ' + r.getResponseCode());
    var data = JSON.parse(r.getContentText());
    var found = (data.prayers || []).filter(function (p) { return p.day === dd; })[0];
    if (!found) throw new Error('solat day not found');
    var times = {};
    cfg.prayers.forEach(function (p) { times[p.key] = found[p.key]; });
    var hp = String(found.hijri).split('-');
    return {
      dates: '📅 ' + DAYS[parseInt(Utilities.formatDate(now, TZ, 'u'), 10) % 7] + ', ' + dd + ' ' + MONTHS[mo - 1] + ' ' + y,
      hijri: '🇵🇸 ' + hp[2] + ' ' + MOON[parseInt(hp[1], 10) - 1] + ' ' + hp[0] + 'H',
      times: times
    };
  }
  // NOTE: 'u' gives ISO day (1=Mon..7=Sun); %7 maps Sun→0 to match DAYS (0=Ahad).

  function save(key, val) { props().setProperty(key, val); }
  function load(key) { return props().getProperty(key); }
  function stateKey(cfg, suffix) { return 'SOLAT_' + cfg.zone + '_' + suffix; }

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

      // Per-prayer triggers at exact times (future ones only).
      // Handler names match prayer keys (fajr/dhuhr/asr/maghrib/isha in Code.gs).
      cfg.prayers.forEach(function (p) {
        var t = new Date(today.times[p.key] * 1000);
        if (t.getTime() > Date.now()) {
          ScriptApp.newTrigger(p.key).timeBased().at(t).create();
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
      var time = fmtTime(today.times[current]);
      var next = cfg.prayers[idx + 1];
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
      // Card was just edited above, so the row is MARKED+BOLD — quote must
      // keep the same nesting (API: "rich texts must be nested in the same way").
      var qr = function (t) { return { type: 'marked', text: { type: 'bold', text: t } }; };
      var rr = callTelegram('sendMessage', {
        chat_id: cfg.channelId,
        text: '🕌 Waktu Solat <b>' + p.name + '! ' + p.emoji + '</b>\n' + time + '\n\n' + footer,
        parse_mode: 'HTML',
        reply_parameters: JSON.stringify({
          message_id: mainId,
          allow_sending_without_reply: true,
          quote_rich_texts: [qr(p.emoji + ' ' + p.name), qr(time)]
        }),
        reply_markup: JSON.stringify({
          inline_keyboard: [[{ text: nextTxt, url: cfg.channelLink + '/' + mainId }]]
        })
      });
      if (!rr.ok) throw new Error('reminder failed: ' + JSON.stringify(rr));
      rems.push(rr.result.message_id);
      save(stateKey(cfg, 'REM'), JSON.stringify(rems));
      Logger.log('reminder posted ' + rr.result.message_id + ' for ' + current);
      return rr.result.message_id;
    } catch (e) {
      Logger.log('edits failed: ' + e.stack);
      throw e;
    }
  }

  function resetToday(cfg) {
    var mainId = load(stateKey(cfg, 'MAIN'));
    var rems = load(stateKey(cfg, 'REM'));
    var ids = [];
    if (mainId) ids.push(parseInt(mainId, 10));
    try { (JSON.parse(rems || '[]')).forEach(function (id) { ids.push(parseInt(id, 10)); }); } catch (e) {}
    ids = ids.filter(function (id) { return id > 0; });
    if (ids.length) {
      var r = callTelegram('deleteMessages', { chat_id: cfg.channelId, message_ids: JSON.stringify(ids) });
      Logger.log('reset deleted: ' + JSON.stringify(r));
    }
    ['DAY', 'DATA', 'MAIN', 'REM'].forEach(function (s) { props().deleteProperty(stateKey(cfg, s)); });
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction();
      if (h !== 'setup' && h !== 'daily') ScriptApp.deleteTrigger(t);
    });
  }

  return { daily: daily, edits: edits, resetToday: resetToday };
})();
