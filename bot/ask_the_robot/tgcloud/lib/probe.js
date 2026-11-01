// lib/probe.js — /probe catalog. Every shape below is copied from probe-verified
// sources (gmvmax-auto tg-probe route + hourly.ts buildBlocks); nothing invented.
// Each probe sends solo so one bad shape can't kill the rest.

const label = (name) => ({ type: 'paragraph', text: { type: 'bold', text: `PROBE: ${name}` } });

export const PROBES = [
  { name: 'heading', blocks: [label('heading'), { type: 'heading', text: 'PROBE heading', size: 2 }] },
  { name: 'pre', blocks: [label('pre'), { type: 'pre', text: 'PROBE mono' }] },
  {
    name: 'list',
    blocks: [label('list'), {
      type: 'list',
      items: [
        { blocks: [{ type: 'paragraph', text: 'PROBE one' }] },
        { blocks: [{ type: 'paragraph', text: 'PROBE two' }] },
      ],
    }],
  },
  { name: 'blockquote', blocks: [label('blockquote'), { type: 'blockquote', blocks: [{ type: 'paragraph', text: 'PROBE quote' }] }] },
  { name: 'expandable_blockquote', blocks: [label('expandable_blockquote'), { type: 'expandable_blockquote', text: 'PROBE expand' }] },
  { name: 'pullquote', blocks: [label('pullquote'), { type: 'pullquote', text: 'PROBE pull' }] },
  { name: 'math', blocks: [label('math'), { type: 'mathematical_expression', expression: 'E=mc^2' }] },
  { name: 'map', blocks: [label('map'), { type: 'map', location: { latitude: 3.139, longitude: 101.6869 } }] },
  { name: 'photo', blocks: [label('photo'), { type: 'photo', photo: { type: 'photo', media: 'https://picsum.photos/200' } }] },
  {
    name: 'table-striped-compact',
    blocks: [label('table-striped-compact'), {
      type: 'table', is_striped: true, is_compact: true,
      cells: [
        [{ text: { type: 'bold', text: 'PROBE' }, is_header: true }, { text: { type: 'bold', text: 'label' }, is_header: true }],
        [{ text: 'row one' }, { text: { type: 'bold', text: '1.00' } }],
        [{ text: 'row two' }, { text: { type: 'bold', text: '2.00' } }],
      ],
    }],
  },
  {
    name: 'details-bold-summary',
    blocks: [label('details-bold-summary'), {
      type: 'details',
      summary: { type: 'bold', text: 'PROBE collapsed title' },
      blocks: [{ type: 'paragraph', text: 'PROBE hidden body' }],
    }],
  },
  {
    name: 'details-string-summary',
    blocks: [label('details-string-summary'), {
      type: 'details',
      summary: 'PROBE collapsed title',
      blocks: [{ type: 'paragraph', text: 'PROBE hidden body' }],
    }],
  },
  {
    name: 'divider',
    blocks: [
      label('divider'),
      { type: 'paragraph', text: { type: 'bold', text: 'PROBE above' } },
      { type: 'divider' },
      { type: 'paragraph', text: { type: 'bold', text: 'PROBE below' } },
    ],
  },
  {
    name: 'buttons-url',
    blocks: [label('buttons-url'), { type: 'buttons', buttons: [{ text: 'PROBE link', url: 'https://example.com' }] }],
  },
  {
    name: 'html-buttons-row',
    html: `<p>PROBE: html-buttons-row</p><tg-button-row align="center"><tg-button type="callback_data" data="list">List</tg-button><tg-button type="callback_data" data="clear">Clear</tg-button></tg-button-row>`,
  },
  { name: 'marked', blocks: [{ type: 'paragraph', text: { type: 'marked', text: 'PROBE marked' } }] },
  // --- Batch 2: shapes from All Types Demo dump (msg 76, 01 Nov 2026). Experimental: each isolated, ❌ is data.
  {
    name: 'inline-format',
    blocks: [{ type: 'paragraph', text: ['PROBE ', { type: 'bold', text: 'mountains' }, ' ', { type: 'italic', text: 'talking?' }, ' ', { type: 'underline', text: 'alive!' }, ' ', { type: 'strikethrough', text: 'five!' }, ' ', { type: 'spoiler', text: 'James Bond' }, ' ', { type: 'code', text: 'Dave' }] }],
  },
  {
    name: 'anchor-pair',
    blocks: [{ type: 'anchor', name: 'probe' }, { type: 'paragraph', text: ['Jump to ', { type: 'anchor_link', text: 'top', anchor_name: 'probe' }] }],
  },
  {
    name: 'footnote',
    blocks: [
      { type: 'paragraph', text: { type: 'reference', text: ['Cite sources', { type: 'reference_link', text: { type: 'superscript', text: '1' }, reference_name: 'fn-1' }, '.'], name: 'fnref-1-1' } },
      { type: 'footer', text: { type: 'reference', text: ['1. Source: me. ', { type: 'reference_link', text: '↩️', reference_name: 'fnref-1-1' }], name: 'fn-1' } },
    ],
  },
  {
    name: 'custom-emoji',
    blocks: [{ type: 'paragraph', text: ['PROBE ', { type: 'custom_emoji', custom_emoji_id: '5208541126583136130', alternative_text: '🎉' }] }],
  },
  {
    name: 'date-time',
    blocks: [{ type: 'paragraph', text: ['PROBE ', { type: 'date_time', text: 'Aug 13, 2013', unix_time: 1735689600, date_time_format: 'D' }] }],
  },
  {
    name: 'inline-math',
    blocks: [{ type: 'paragraph', text: ['Solve for ', { type: 'mathematical_expression', expression: 'x' }, ' and ', { type: 'mathematical_expression', expression: 'E = mc^2' }] }],
  },
  {
    name: 'list-checkbox',
    blocks: [label('list-checkbox'), {
      type: 'list',
      items: [
        { label: '•', blocks: [{ type: 'paragraph', text: 'PROBE plain' }] },
        { label: '•', blocks: [{ type: 'paragraph', text: 'PROBE done' }], has_checkbox: true, is_checked: true },
      ],
    }],
  },
  {
    name: 'list-ordered',
    blocks: [label('list-ordered'), {
      type: 'list',
      items: [
        { label: '1.', blocks: [{ type: 'paragraph', text: 'Step 1' }], type: '1', value: 1 },
        { label: '2.', blocks: [{ type: 'paragraph', text: 'Step 2' }], type: '1', value: 2 },
      ],
    }],
  },
  { name: 'pre-lang', blocks: [label('pre-lang'), { type: 'pre', text: 'echo "hello";', language: 'php' }] },
  {
    name: 'details-open',
    blocks: [{
      type: 'details', summary: 'PROBE open title', is_open: true,
      blocks: [{ type: 'paragraph', text: 'PROBE shown body' }],
    }],
  },
  { name: 'pullquote-credit', blocks: [label('pullquote-credit'), { type: 'pullquote', text: 'PROBE free', credit: 'Pavel Durov' }] },
  { name: 'map-full', blocks: [label('map-full'), { type: 'map', location: { latitude: 25.195949, longitude: 55.273412 }, zoom: 15, width: 800, height: 400, caption: { text: 'Where are we?' } }] },
  {
    name: 'link-inline',
    blocks: [{ type: 'paragraph', text: [{ type: 'url', text: 'Link', url: 'https://example.com' }, ' · ', { type: 'email_address', text: 'Email', email_address: 'user@example.com' }] }],
  },
  {
    name: 'photo-file-id',
    blocks: [label('photo-file-id'), { type: 'photo', photo: { type: 'photo', media: 'AgACAgEAAxUAAWrm9AMohvUAAXTfc5TPhJMDDq8kxQACiw5rGziAWEVKv1bRNWZVXQEAAwIAA20AAz0E' } }],
  },
  {
    name: 'video-file-id',
    blocks: [label('video-file-id'), { type: 'video', video: { type: 'video', media: 'BAACAgEAAxUAAWrm9AP1d6Bdkbfgbe0xwvvH_3yiAAKTBQACOIBYRQ75hxPsInuiPQQ' } }],
  },
];

// All 32 verified live 01 Nov 2026 — incl. cross-bot file_id reuse + video mirror guess.
