// User-facing changelog (newest last in file, shown newest-first).
// Append one entry per shipped slice; bump VERSION in config.js alongside.
export const CHANGELOG = [
  {
    v: '1.0.0 021126', date: '02 Nov 2026',
    ms: 'BM/EN per pengguna, jenis Soalan/Hilang/Jumpa dengan nombor siri #ask/#lost/#found, dan kawalan spam (3/minit).',
    en: 'Per-user BM/EN, Question/Lost/Found kinds with #ask/#lost/#found serials, and spam control (3/min).',
  },
  {
    v: '1.0.0 031126', date: '03 Nov 2026',
    ms: 'Semakan FAQ wajib sebelum Tanya Soalan, dan carian pengguna /who + /list untuk admin.',
    en: 'Mandatory FAQ check before asking, plus /who + /list user lookup for admins.',
  },
  {
    v: '1.0.0 041126', date: '04 Nov 2026',
    ms: 'Statistik admin, sebutan !all, /recent, /oldest berk halaman, nota mod, dan arahan /tutorial + /changelog ini.',
    en: 'Admin stats, !all mentions, /recent, paged /oldest, mod notes, and these /tutorial + /changelog commands.',
  },
  {
    v: '1.0.1 051126', date: '05 Nov 2026',
    ms: 'Statistik bot /botstats (pengguna, hantaran, perbualan bot), jejak aktif last-seen, dan siaran /announce kepada semua pengguna.',
    en: 'Bot-wide /botstats (users, submissions, bot talk), last-seen activity tracking, and /announce broadcasts to all users.',
  },
  {
    v: '1.0.2 051126', date: '05 Nov 2026',
    ms: 'Had media naik ke 4 sehari; voice, sticker, audio dan dokumen kini disokong penuh (pratonton, inbox, channel, chat).',
    en: 'Media limit up to 4/day; voice, stickers, audio and documents fully supported (preview, inbox, channel, chat).',
  },
  {
    v: '1.0.3 051126', date: '05 Nov 2026',
    ms: 'Foto/video/dokumen wajib ada caption (edit mesej untuk tambah, bot kesan automatik); voice digalakkan tambah caption.',
    en: 'Photo/video/document now require captions (edit your message to add one, auto-detected); voice captions encouraged.',
  },
  {
    v: '1.0.4 051126', date: '05 Nov 2026',
    ms: 'Pratonton dikemas semula mengikut tertib (kandungan dahulu) selepas edit caption; sokongan voice/sticker/dokumen dikukuhkan.',
    en: 'Preview rebuilds in order (content first) after caption edits; voice/sticker/document support hardened.',
  },
  {
    v: '1.0.5 051126', date: '05 Nov 2026',
    ms: 'Soalan berkategori: Makan, Sewa, Servis (Runner/Grab/Lain), Barang, Tempat (Dalam/Luar + peta), Tumpang, Bas (lokasi + soalan).',
    en: 'Categorized questions: Food, Rent, Services (Runner/Grab/Other), Goods, Places (In/Out + map), Rides, Bus (locations + questions).',
  },
  {
    v: '1.0.6 051126', date: '05 Nov 2026',
    ms: 'Pengesan reply copy-paste (r:/rep:/reply:, titik dua atau sengkang): hantaran ditahan, tekan "Bukan reply" untuk teruskan atau Batal.',
    en: 'Copy-paste reply detector (r:/rep:/reply:, colon or dash): submission held, tap "Not a reply" to continue or Cancel.',
  },
  {
    v: '1.0.7 051126', date: '05 Nov 2026',
    ms: 'Tutorial langkah 3 kini paut ke cara reply (46470) dan senarai mesej ditolak (46990).',
    en: 'Tutorial step 3 now links the reply guide (46470) and the reject list (46990).',
  },
  {
    v: '1.0.8 051126', date: '05 Nov 2026',
    ms: 'Pengesan link group (t.me/WhatsApp): hantaran ditahan dengan sebab privacy, tekan "Bukan link group" untuk teruskan atau Batal.',
    en: 'Group-link detector (t.me/WhatsApp): submission held with privacy reason, tap "Not a group link" to continue or Cancel.',
  },
  {
    v: '1.0.9 051126', date: '05 Nov 2026',
    ms: '/crown owner: mahkota bulanan — Tindakan Terbanyak + Triage Terpantas (30d), atau Juara Keseluruhan jika sama orang.',
    en: '/crown for owner: monthly crowns — Most Actions + Fastest Triage (30d), or Overall winner if the same admin takes both.',
  },
  {
    v: '1.0.10 051126', date: '05 Nov 2026',
    ms: 'Baiki /crown: owner dikecualikan (sudah 👑), ralat set-title sebenar dipaparkan untuk diagnosis.',
    en: '/crown fix: owner excluded (already 👑), raw set-title error now shown for diagnosis.',
  },
  {
    v: '1.0.11 051126', date: '05 Nov 2026',
    ms: '/crown tanpa title (had Telegram): mahkota bot-side — pengumuman + penanda 👑/⚡ dalam /adminstats.',
    en: '/crown without titles (Telegram limit): bot-side crown — announcement + 👑/⚡ markers in /adminstats.',
  },
  {
    v: '1.0.12 051126', date: '05 Nov 2026',
    ms: '/maintenance owner: jeda/sambung semula hantaran baharu (review jalan terus).',
    en: '/maintenance for owner: pause/resume new submissions (review runs on); `meta` switch.',
  },
  {
    v: '1.0.13 051126', date: '05 Nov 2026',
    ms: 'Mod tengah malam: notis 🌙 pada pratonton + ack (12–7 pagi, admin tidur); /midnight on|off|auto.',
    en: 'Midnight mode: 🌙 notice on preview + ack (12–7am, admins asleep); /midnight on|off|auto.',
  },
  {
    v: '1.0.14 051126', date: '05 Nov 2026',
    ms: 'Nudge iklan/sewa: baris amaran pada pratonton bila mesej nampak seperti iklan niaga atau carian rumah sewa.',
    en: 'Ad/rental nudge: warning line on preview when a message looks like a business ad or house-rental hunt.',
  },
  {
    v: '1.0.15 051126', date: '05 Nov 2026',
    ms: 'Keputusan (approve/reject/warn/ban/undo/edit/laporan) dan reply admin kini membalas mesej asal anda.',
    en: 'Verdicts (approve/reject/warn/ban/undo/edit/reports) and admin replies now reply to your original message.',
  },
  {
    v: '1.0.16 051126', date: '05 Nov 2026',
    ms: 'Username dan nombor telefon dibenarkan buat masa ini (e-mel/link kekal disorok); suis MASK_MENTIONS/MASK_PHONES.',
    en: 'Usernames and phone numbers allowed for now (emails/links stay hidden); MASK_MENTIONS/MASK_PHONES switches.',
  },
  {
    v: '1.0.17 051126', date: '05 Nov 2026',
    ms: 'Modul Iklan/Event/Dana: butang grid baharu — Iklan ke ruang iklan, Event ke channel pengumuman, Cari Dana dipost dengan #cariandana.',
    en: 'Ads/Events/Funds module: new grid buttons — Ads to the ad space, Events to the announcement channel, Fund Hunts post with #cariandana.',
  },
  {
    v: '1.0.18 051126', date: '05 Nov 2026',
    ms: 'Menu Utama baharu: 5 baris + pemisah, butang Bantuan/Tutorial, header dwibahasa.',
    en: 'New Main Menu: 5 rows + separator, Help/Tutorial buttons, bilingual header.',
  },
  {
    v: '1.0.19 051126', date: '05 Nov 2026',
    ms: 'Jenis Suggest/Info: butang grid baharu, #suggest/#info tanpa nombor, nudge iklan dilangkau bila niat diisytihar.',
    en: 'Suggest/Info kinds: new grid buttons, #suggest/#info without serials, ad nudge skipped on declared intent.',
  },
  {
    v: '1.0.20 051126', date: '05 Nov 2026',
    ms: 'Semua Batal dan /cancel* berakhir di Menu Utama.',
    en: 'Every Cancel and /cancel* now lands back on the Main Menu.',
  },
  {
    v: '1.0.21 051126', date: '05 Nov 2026',
    ms: 'Sub-jenis Dana: Dana Program (#cariandana) vs Derma Kilat (#dermakilat), kad berbeza.',
    en: 'Dana sub-types: Dana Program (#cariandana) vs Derma Kilat (#dermakilat), distinct cards.',
  },
  {
    v: '1.0.22 051126', date: '05 Nov 2026',
    ms: 'Nombor post awam: footer `#id · A-id` dari message id channel (survive edit, ada di kad Accept).',
    en: 'Public post numbers: `#id · A-id` footer from the channel message id (survives edits, shown on Accept card).',
  },
  {
    v: '1.0.23 051126', date: '05 Nov 2026',
    ms: 'Modul Bot Feedback: lapor bug/cadangan dengan screenshot, pratonton + Sahkan, kad #F ke admin.',
    en: 'Bot Feedback module: report bugs/ideas with screenshots, preview + Confirm, #F cards to admins.',
  },
  {
    v: '1.0.24 051126', date: '05 Nov 2026',
    ms: 'Chat admin di mana-mana: /startchat & /endadminsession berfungsi dari semua topik, jawapan ikut thread asal, arahan slash tidak lagi relay ke user.',
    en: 'Admin chat everywhere: /startchat & /endadminsession work from every topic, answers follow the origin thread, slash commands never relay to users.',
  },
  {
    v: '1.0.25 051126', date: '05 Nov 2026',
    ms: '/faqsync owner: tarik CSV Sheet FAQ ke DB (lapor tambah/kemas/prune).',
    en: '/faqsync for owner: pull Sheet FAQ CSV into the DB (reports added/updated/pruned).',
  },
  {
    v: '1.0.26 051126', date: '05 Nov 2026',
    ms: 'Auto-route soalan: mesej nampak seperti soalan masuk modul Tanya Soalan (park + gate + pilih kategori, tanpa taip semula).',
    en: 'Question auto-route: question-lookalike messages enter the Ask module (park + gate + pick a category, no retyping).',
  },
  {
    v: '1.0.27 051126', date: '05 Nov 2026',
    ms: 'Hygiene: semua cancel lalu cancelEnd() satu punca; rujukan claims mati dibuang.',
    en: 'Hygiene: all cancels through one cancelEnd() helper; dead claims refs removed.',
  },
  {
    v: '1.0.28 051126', date: '05 Nov 2026',
    ms: 'Alat debug owner: /debugmode, /debuginfo #C, /strings — penanda id tanpa tg_id di permukaan kongsi.',
    en: 'Owner debug tools: /debugmode, /debuginfo #C, /strings — id markers with no tg_id on shared surfaces.',
  },
  {
    v: '1.0.29 051126', date: '05 Nov 2026',
    ms: 'SID fasa 1: nama kunci sebagai id ([faqNudge]) pada mesej intake + ask bila debug on.',
    en: 'SID phase 1: key names as ids ([faqNudge]) on intake + ask messages when debug is on.',
  },
  {
    v: '1.0.30 051126', date: '05 Nov 2026',
    ms: '/start tunjuk A-id sendiri di bawah sapaan.',
    en: '/start shows your own A-id under the greeting.',
  },
  {
    v: '1.1.0 051126', date: '05 Nov 2026',
    ms: 'CID: id pengguna kini CID-001 (alias berbayar via /setcid); parser terima CID/A/alias.',
    en: 'CID: user ids are now CID-001 (paid aliases via /setcid); parsers accept CID/A/alias.',
  },
  {
    v: '1.1.1 051126', date: '05 Nov 2026',
    ms: 'Bersih alias legacy U-* (32 baris) — paparan kembali ke CID sebenar; bentuk U-* dikhaskan.',
    en: 'Legacy U-* aliases cleaned (32 rows) — display falls back to the real CID; U-* shape reserved.',
  },
  {
    v: '1.2.0 051126', date: '05 Nov 2026',
    ms: 'UID/CUID: id UID-001, alias papar CUID; semua copy + parser ikut; myAid dua cabang.',
    en: 'UID/CUID: UID-001 ids, aliases shown as CUID; all copy + parsers follow; myAid branches.',
  },
  {
    v: '1.3.0 051126', date: '05 Nov 2026',
    ms: 'Templat reply admin: /tpl dengan 8 templat + susunan butang kad baharu.',
    en: 'Admin reply templates: /tpl with 8 templates + new card button layout.',
  },
  {
    v: '1.4.0 051126', date: '05 Nov 2026',
    ms: 'Reject bersebab: pilihan Peraturan/Format/FAQ + /msg mesej custom; amaran pasang reaksi ⚠️.',
    en: 'Reject with reasons: Rules/Format/FAQ presets + /msg custom messages; warns set ⚠️ reaction.',
  },
  {
    v: '1.5.0 051126', date: '05 Nov 2026',
    ms: 'Tapisan auto: mesej terlalu pendek disekat terus; kata kesat ditapis di channel (kad admin kekal asal + flag kesat).',
    en: 'Auto filters: low-effort messages hard-blocked; curses censored on channel (admin cards keep original + kesat flag).',
  },
  {
    v: '1.5.1 071126', date: '07 Nov 2026',
    ms: 'Baiki reply terus: balas mesej bot tidak lagi jadi confession baru (panduan dihantar); baiki ack shadow-tag; notis kesat di pratonton.',
    en: 'Direct-reply fix: replying to bot messages no longer stages a new confession (guide sent); ack shadow-tag fix; curse notice on preview.',
  },
  {
    v: '1.5.2 081126', date: '08 Nov 2026',
    ms: 'Balas ack/pratonton dapat panduan pendek dengan #C; selebihnya panduan penuh.',
    en: 'Replies to the ack/preview get a short guide with #C; everything else gets the full guide.',
  },
  {
    v: '1.6.0 081126', date: '08 Nov 2026',
    ms: 'Undi native: hantar poll sebagai confession — dipost sebagai poll anonymous di channel (quiz dibenarkan, jawapan ditanda pada kad).',
    en: 'Native polls: send a poll as a confession — posted as an anonymous poll on the channel (quiz allowed, answer marked on the card).',
  },
  {
    v: '1.7.0 081126', date: '08 Nov 2026',
    ms: 'Satu draf live: mesej baru ganti pratonton lama (lama dibuang + bubble dipadam); undi dikira dalam had teks.',
    en: 'Single live draft: new messages replace the old preview (old discarded + bubbles deleted); polls count toward text limits.',
  },
  {
    v: '1.7.1 081126', date: '08 Nov 2026',
    ms: 'Balas semasa gate FAQ/kategori: panduan reply dahulu, bukan scold gate.',
    en: 'Replies during FAQ/category gates get the reply guide first, not the gate scold.',
  },
  {
    v: '1.7.2 081126', date: '08 Nov 2026',
    ms: 'Ujian wiring discussion: balas post channel di group dikesan sebagai reply-confession anonymous (pratonton di DM).',
    en: 'Discussion wiring test: channel-post replies in the group stage as anonymous reply-confessions (preview in DM).',
  },
  {
    v: '1.8.0 081126', date: '08 Nov 2026',
    ms: '/delete: balas mesej asal untuk minta padam post publish — kad mod Apply/Dismiss.',
    en: '/delete: reply to your original message to request published-post removal — mod Apply/Dismiss card.',
  },
  {
    v: '1.8.1 081126', date: '08 Nov 2026',
    ms: 'Tutup tutorial + halaman tutorial berfungsi dalam group (stateless sahaja; selebihnya kekal DM).',
    en: 'Tutorial close + pages work in groups (stateless only; everything else stays DM-locked).',
  },
  {
    v: '1.9.0 101126', date: '10 Nov 2026',
    ms: 'Ban Telegram: sederhana = mute group, berat = ban group+channel; /ban [group|channel|all]; /unban angkat semua.',
    en: 'Telegram bans: medium = group mute, heavy = group+channel ban; /ban [group|channel|all]; /unban lifts all.',
  },
];
