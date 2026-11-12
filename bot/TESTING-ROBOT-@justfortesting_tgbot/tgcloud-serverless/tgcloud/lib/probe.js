// lib/probe.js — rich-shape catalog with OFFICIAL Bot API names.
// Source: bot/ask_the_robot/tgcloud/lib/probe.js (all 32 verified live 01 Nov 2026).
// Each entry posts solo in topic order; label uses the official type name so
// probes are referable as https://core.telegram.org/bots/api#rich-messages names.

const label = (official) => ({ type: 'paragraph', text: { type: 'bold', text: official } });

export const PROBES = [
  { name: 'heading', official: 'RichBlockSectionHeading', blocks: [label('RichBlockSectionHeading'), { type: 'heading', text: 'PROBE heading', size: 2 }] },
  { name: 'pre', official: 'RichBlockPreformatted', blocks: [label('RichBlockPreformatted'), { type: 'pre', text: 'PROBE mono' }] },
  {
    name: 'list', official: 'RichBlockList',
    blocks: [label('RichBlockList'), {
      type: 'list',
      items: [
        { blocks: [{ type: 'paragraph', text: 'PROBE one' }] },
        { blocks: [{ type: 'paragraph', text: 'PROBE two' }] },
      ],
    }],
  },
  { name: 'blockquote', official: 'RichBlockBlockQuotation', blocks: [label('RichBlockBlockQuotation'), { type: 'blockquote', blocks: [{ type: 'paragraph', text: 'PROBE quote' }] }] },
  { name: 'expandable_blockquote', official: 'RichBlockExpandableBlockQuotation', blocks: [label('RichBlockExpandableBlockQuotation'), { type: 'expandable_blockquote', text: 'PROBE expand' }] },
  { name: 'pullquote', official: 'RichBlockPullQuotation', blocks: [label('RichBlockPullQuotation'), { type: 'pullquote', text: 'PROBE pull' }] },
  { name: 'math', official: 'RichBlockMathematicalExpression', blocks: [label('RichBlockMathematicalExpression'), { type: 'mathematical_expression', expression: 'E=mc^2' }] },
  { name: 'map', official: 'RichBlockMap', blocks: [label('RichBlockMap'), { type: 'map', location: { latitude: 3.139, longitude: 101.6869 } }] },
  { name: 'photo', official: 'RichBlockPhoto', blocks: [label('RichBlockPhoto'), { type: 'photo', photo: { type: 'photo', media: 'https://picsum.photos/200' } }] },
  {
    name: 'table-striped-compact', official: 'RichBlockTable',
    blocks: [label('RichBlockTable'), {
      type: 'table', is_striped: true, is_compact: true,
      cells: [
        [{ text: { type: 'bold', text: 'PROBE' }, is_header: true }, { text: { type: 'bold', text: 'label' }, is_header: true }],
        [{ text: 'row one' }, { text: { type: 'bold', text: '1.00' } }],
        [{ text: 'row two' }, { text: { type: 'bold', text: '2.00' } }],
      ],
    }],
  },
  {
    name: 'details-bold-summary', official: 'RichBlockDetails',
    blocks: [label('RichBlockDetails'), {
      type: 'details',
      summary: { type: 'bold', text: 'PROBE collapsed title' },
      blocks: [{ type: 'paragraph', text: 'PROBE hidden body' }],
    }],
  },
  {
    name: 'details-string-summary', official: 'RichBlockDetails',
    blocks: [label('RichBlockDetails (string summary)'), {
      type: 'details',
      summary: 'PROBE collapsed title',
      blocks: [{ type: 'paragraph', text: 'PROBE hidden body' }],
    }],
  },
  {
    name: 'divider', official: 'RichBlockDivider',
    blocks: [
      label('RichBlockDivider'),
      { type: 'paragraph', text: { type: 'bold', text: 'PROBE above' } },
      { type: 'divider' },
      { type: 'paragraph', text: { type: 'bold', text: 'PROBE below' } },
    ],
  },
  {
    name: 'buttons-url', official: 'RichBlockButtons',
    blocks: [label('RichBlockButtons (url)'), { type: 'buttons', buttons: [{ text: 'PROBE link', url: 'https://example.com' }] }],
  },
  {
    name: 'html-buttons-row', official: 'RichBlockButtons (html pipe)',
    html: `<p>RichBlockButtons (html pipe)</p><tg-button-row align="center"><tg-button type="callback_data" data="list">List</tg-button><tg-button type="callback_data" data="clear">Clear</tg-button></tg-button-row>`,
  },
  { name: 'marked', official: 'RichTextMarked', blocks: [label('RichTextMarked'), { type: 'paragraph', text: { type: 'marked', text: 'PROBE marked' } }] },
  {
    name: 'inline-format', official: 'RichText(Bold|Italic|Underline|Strikethrough|Spoiler|Code)',
    blocks: [label('RichText inline formats'), { type: 'paragraph', text: ['PROBE ', { type: 'bold', text: 'mountains' }, ' ', { type: 'italic', text: 'talking?' }, ' ', { type: 'underline', text: 'alive!' }, ' ', { type: 'strikethrough', text: 'five!' }, ' ', { type: 'spoiler', text: 'James Bond' }, ' ', { type: 'code', text: 'Dave' }] }],
  },
  {
    name: 'anchor-pair', official: 'RichBlockAnchor + RichTextAnchorLink',
    blocks: [label('RichBlockAnchor + RichTextAnchorLink'), { type: 'anchor', name: 'probe' }, { type: 'paragraph', text: ['Jump to ', { type: 'anchor_link', text: 'top', anchor_name: 'probe' }] }],
  },
  {
    name: 'footnote', official: 'RichTextReference + RichBlockFooter',
    blocks: [
      label('RichTextReference + RichBlockFooter'),
      { type: 'paragraph', text: { type: 'reference', text: ['Cite sources', { type: 'reference_link', text: { type: 'superscript', text: '1' }, reference_name: 'fn-1' }, '.'], name: 'fnref-1-1' } },
      { type: 'footer', text: { type: 'reference', text: ['1. Source: me. ', { type: 'reference_link', text: '↩️', reference_name: 'fnref-1-1' }], name: 'fn-1' } },
    ],
  },
  {
    name: 'custom-emoji', official: 'RichTextCustomEmoji',
    blocks: [label('RichTextCustomEmoji'), { type: 'paragraph', text: ['PROBE ', { type: 'custom_emoji', custom_emoji_id: '5208541126583136130', alternative_text: '🎉' }] }],
  },
  {
    name: 'date-time', official: 'RichTextDateTime',
    blocks: [label('RichTextDateTime'), { type: 'paragraph', text: ['PROBE ', { type: 'date_time', text: 'Aug 13, 2013', unix_time: 1735689600, date_time_format: 'D' }] }],
  },
  {
    name: 'inline-math', official: 'RichTextMathematicalExpression (inline)',
    blocks: [label('RichTextMathematicalExpression (inline)'), { type: 'paragraph', text: ['Solve for ', { type: 'mathematical_expression', expression: 'x' }, ' and ', { type: 'mathematical_expression', expression: 'E = mc^2' }] }],
  },
  {
    name: 'list-checkbox', official: 'RichBlockList (checkbox)',
    blocks: [label('RichBlockList (checkbox)'), {
      type: 'list',
      items: [
        { label: '•', blocks: [{ type: 'paragraph', text: 'PROBE plain' }] },
        { label: '•', blocks: [{ type: 'paragraph', text: 'PROBE done' }], has_checkbox: true, is_checked: true },
      ],
    }],
  },
  {
    name: 'list-ordered', official: 'RichBlockList (ordered)',
    blocks: [label('RichBlockList (ordered)'), {
      type: 'list',
      items: [
        { label: '1.', blocks: [{ type: 'paragraph', text: 'Step 1' }], type: '1', value: 1 },
        { label: '2.', blocks: [{ type: 'paragraph', text: 'Step 2' }], type: '1', value: 2 },
      ],
    }],
  },
  { name: 'pre-lang', official: 'RichBlockPreformatted (+language)', blocks: [label('RichBlockPreformatted (+language)'), { type: 'pre', text: 'echo "hello";', language: 'php' }] },
  {
    name: 'details-open', official: 'RichBlockDetails (is_open)',
    blocks: [label('RichBlockDetails (is_open)'), {
      type: 'details', summary: 'PROBE open title', is_open: true,
      blocks: [{ type: 'paragraph', text: 'PROBE shown body' }],
    }],
  },
  { name: 'pullquote-credit', official: 'RichBlockPullQuotation (+credit)', blocks: [label('RichBlockPullQuotation (+credit)'), { type: 'pullquote', text: 'PROBE free', credit: 'Pavel Durov' }] },
  { name: 'map-full', official: 'RichBlockMap (full)', blocks: [label('RichBlockMap (full)'), { type: 'map', location: { latitude: 25.195949, longitude: 55.273412 }, zoom: 15, width: 800, height: 400, caption: { text: 'Where are we?' } }] },
  {
    name: 'link-inline', official: 'RichTextUrl + RichTextEmailAddress',
    blocks: [label('RichTextUrl + RichTextEmailAddress'), { type: 'paragraph', text: [{ type: 'url', text: 'Link', url: 'https://example.com' }, ' · ', { type: 'email_address', text: 'Email', email_address: 'user@example.com' }] }],
  },
  {
    name: 'photo-file-id', official: 'RichBlockPhoto (url — file_id is per-bot, untransferable)',
    blocks: [label('RichBlockPhoto (url — file_id is per-bot)'), { type: 'photo', photo: { type: 'photo', media: 'https://telegram.org/img/t_logo.png' } }],
  },
  {
    name: 'video-file-id', official: 'RichBlockVideo (url — file_id is per-bot, untransferable)',
    blocks: [label('RichBlockVideo (url — file_id is per-bot)'), { type: 'video', video: { type: 'video', media: 'https://telegram.org/example/video.mp4' } }],
  },
];
