let _doc, _ss = {};
const now = new Date();
const timezone = Session.getScriptTimeZone();
const year = Utilities.formatDate(now,timezone,'yyyy');
const row = parseInt(Utilities.formatDate(now,timezone,'D')) + 1;

function onOpen(e){ const sheet=e.source.getSheetByName(year); sheet.getRange(row,1).activate(); }

const pd = {
  'fajr':    { index: 0, next: 'syuruk'  },
  'dhuhr':   { index: 1, next: 'asr'     },
  'asr':     { index: 2, next: 'maghrib' },
  'maghrib': { index: 3, next: 'isha'    },
  'isha':    { index: 4 }
};

function getss(sheet) {
  const s = String(sheet);
  if (!_ss[s]) {
    if (!_doc) { _doc = SpreadsheetApp.getActiveSpreadsheet(); }
    _ss[s] = _doc.getSheetByName(s);
    if (!_ss[s]) { _ss[s] = _doc.insertSheet(s, {template: getss('year')}); }
  }
  return _ss[s];
}

function compose(head, prayers, foot, today, currentKey = null) {
  head += `${today.dates}\n${today.hijri}\n\n`;
  const ent = [];
  let i = 0;
  const maps = Object.keys(pd).map(key => {
    const p = prayers[pd[key].index];
    const line = `${p.emoji} ${today.times[key]} : ${p.name}`;
    if (key === currentKey) ent.push({ type:'bold',offset:head.length + i,length:line.length });
    i += line.length + 1;
    return line;
  }).join('\n');
  ent.push({ type:'blockquote',offset:head.length,length:maps.length });
  return { txt: head + maps + foot, ent };
}

function fetchJSON(url,i=0) {
  try {
    const r = UrlFetchApp.fetch(url);
    if (r.getResponseCode() === 200) return JSON.parse(r.getContentText());
    throw new Error(JSON.stringify(r));
  } catch (e) {
    if (i > 5) throw new Error('Retry fetchJSON Failed:'+ JSON.stringify(e.stack));
    Utilities.sleep(5000 * (i + 1));
    return fetch(url, i + 1);
  }
}

function fetch(url,pld,i=0){
	try {
		return JSON.parse(UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify(pld),muteHttpExceptions:true}).getContentText());
	} catch (e) {
		if (i>1) throw new Error(JSON.stringify(e.stack));
    Utilities.sleep(5000*i);
    return fetch(url,pld,i+1);
	}
}

function send(bt,cid,end,pld,i=0){
  pld.chat_id = cid;
	const rsp=fetch(`https://api.telegram.org/bot${bt}/${end}`,pld);
	if (rsp.ok){
		return rsp;
	} else if(rsp.error_code===429){
    Utilities.sleep(1000*(rsp.parameters.retry_after||10));
		return send(bt,cid,end,pld,i+1);
	} else if (rsp.error_code===400){
    console.log(end+JSON.stringify(pld,null,2)+JSON.stringify(rsp,null,2));
    return rsp;
  } else if(i>3) {
    console.log(end+JSON.stringify(pld,null,2)+JSON.stringify(rsp,null,2));
    return rsp;
  }
  return send(bt,cid,end,pld,i+1);
}

function daily(bt,cid,head,prayers,foot,zone,hour,min) {
  try {
    const today = { unix: {}, times: {} };
    ScriptApp.getProjectTriggers().forEach(trigger => ScriptApp.deleteTrigger(trigger));
    ScriptApp.newTrigger('daily').timeBased().at(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,hour,min,0)).inTimezone(timezone).create();
    const yesterday = new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);
    const prev = getss(Utilities.formatDate(yesterday,timezone,'yyyy')).getRange(parseInt(Utilities.formatDate(yesterday,timezone,'D'))+1,4,1,6).getValues()[0];
    if (prev[0] || prev[5]) send(bt,cid,'deleteMessages',{message_ids: [prev[0], prev[5]]});
    const found = fetchJSON(`https://api.waktusolat.app/v2/solat/${zone}?year=${now.getFullYear()}&month=${now.getMonth()+1}`).prayers.find(p => p.day === now.getDate());
    if (found) {
      for (const key in found) {
        if (key === 'day') {
          const days = ['Ahad','Isnin','Selasa','Rabu','Khamis','Jumaat','Sabtu'];
          const months = ['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'];
          today.dates = `📅 ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${year}`;
        } else if (key === 'hijri'){
          const moon = ['Muharram','Safar','Rabi\'ul Awal','Rabi\'ul Akhir','Jamadil Awal','Jamadil Akhir','Rejab','Sya\'aban','Ramadhan','Syawal','Zulkaedah','Zulhijjah'];
          const [years,months,days] = found[key].split('-');
          today.hijri = `🇵🇸 ${days} ${moon[parseInt(months)-1]} ${years}H`;
        } else {
          today.unix[key] = found[key];
          today.times[key] = Utilities.formatDate(new Date(found[key]*1000),timezone,'hh:mm a');
        }
      }
      const load = compose(head,prayers,foot,today);
      getss(year).getRange(row,1,1,4).setValues([[today.dates,today.hijri,JSON.stringify(today.times,null,2),send(bt,cid,'sendMessage',{text:load.txt,entities:load.ent}).result.message_id]]);
      return Object.keys(pd).forEach(key => {
        const time = new Date(today.unix[key] * 1000);
        if (time > now) ScriptApp.newTrigger(key).timeBased().at(time).inTimezone(timezone).create();
      });
    }
    throw new Error('JSON fetched Failed');    
  } catch (e) {
    console.log(JSON.stringify(e.stack,null,2)); // Handle error
  }  
}

function getTimes() {
  const cache = CacheService.getDocumentCache();
  const keyDate = Utilities.formatDate(now,timezone,'dd-MM-yy');
  const cached = cache.get(keyDate);
  if (cached) return JSON.parse(cached);
  const today = {};
  const values = getss(year).getRange(row,1,1,3).getValues()[0];
  if (values[0] && values[1] && values[2]){
    today.dates = values[0];
    today.hijri = values[1];
    today.times = JSON.parse(values[2]);
    cache.put(keyDate,JSON.stringify(today));
    return today;
  }
  throw new Error('getTimes Failed');
}

function edits(bt,cid,head,prayers,foot,col,current,footer,url) {
  try {
    const today = getTimes();
    const load = compose(head,prayers,foot, today, current);
    const prev = getss(year).getRange(row,4,1,col).getValues()[0];
    if ((col > 2) && prev[(col - 2)]) send(bt,cid,'deleteMessage',{message_id: prev[(col - 2)]});
    if (prev[0]) send(bt,cid,'editMessageText',{message_id: prev[0], text: load.txt, entities: load.ent});
    const type = pd[current];
    const types = prayers[type.index];
    const currents = `${types.name}! ${types.emoji}\n${today.times[current]}`;
    const txt = `🕌 Waktu Solat ${currents} ${footer}`;
    let next = '⏰ Jadual Waktu Solat Fardhu';
    if (type.next) next = `${pd[type.next] ? prayers[pd[type.next].index].name : type.next.charAt(0).toUpperCase() + type.next.slice(1)} 🔜 ${today.times[type.next]}`;
    getss(year).getRange(row,col + 3).setValue(send(bt,cid,'sendMessage',{
      text: txt,
      entities:[{type:'bold',offset:15,length:currents.length}],
      reply_parameters:{
        message_id:prev[0],
        allow_sending_without_reply:true,
        quote:`${types.emoji} ${today.times[current]} : ${types.name}`,
        quote_entities:[
          {type:'bold',offset:0,length:load.ent[0].length},
          {type:load.ent[1].type,offset:0,length:load.ent[0].length},
        ]
      },
      reply_markup: { inline_keyboard: [[{ text: next, url: `${url}/${prev[0]}` }]]}
    }).result.message_id);
  } catch (e) {
    console.log(JSON.stringify(e.stack,null,2));
  }
}