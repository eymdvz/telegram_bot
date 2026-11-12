// lib/probehtml.js — rich HTML-pipe catalog, grouped to avoid spam.
// Each entry posts solo; label = official tag. Thread + numbering handled by handler.

export const PROBEHTML = [
  {
    name: 'inline',
    official: 'inline tags (b/i/u/s/code/mark/sub/sup/spoiler + links)',
    html: `<p><b>#H01 inline tags</b></p><p><b>bold</b> <strong>strong</strong> <i>italic</i> <em>em</em> <u>under</u> <s>strike</s> <code>code</code> <mark>marked</mark> <sub>sub</sub> <sup>sup</sup> <tg-spoiler>spoiler</tg-spoiler></p><p><a href="https://t.me/">url</a> <a href="mailto:user@example.com">mail</a> <a href="tel:+123456789">phone</a> <a href="tg://user?id=777000">mention</a> #tag $USD https://t.me /cmd @user</p>`,
  },
  {
    name: 'headings',
    official: 'h1–h6 + anchors',
    html: `<p><b>#H02 headings</b></p><h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6><a name="probe-h"></a><p><a href="#probe-h">jump to anchor</a></p>`,
  },
  {
    name: 'blocks',
    official: 'p/pre/footer/hr + lists',
    html: `<p><b>#H03 blocks</b></p><p>Paragraph text</p><pre>pre block</pre><pre><code class="language-python">print('lang')</code></pre><footer>Footer text</footer><hr/><ul><li>bulleted</li></ul><ol><li>ordered</li></ol><ul><li><input type="checkbox" checked>Checked</li><li><input type="checkbox">Unchecked</li></ul>`,
  },
  {
    name: 'quotes',
    official: 'blockquote + expandable + aside',
    html: `<p><b>#H04 quotes</b></p><blockquote>Line one<br/>Line two<cite>The Author</cite></blockquote><blockquote expandable>Expandable line 1<br/>line 2<br/>line 3<br/>line 4<br/>line 5<br/>line 6<br/>line 7<br/>line 8<br/>line 9<br/>line 10<br/>line 11<br/>line 12<cite>The Author</cite></blockquote><aside>Pull quote<cite>The Author</cite></aside>`,
  },
  {
    name: 'media',
    official: 'img/video/audio/document singles',
    html: `<p><b>#H05 media singles</b></p><img src="https://telegram.org/example/photo.jpg"/><video src="https://telegram.org/example/video.mp4"></video><audio src="https://telegram.org/example/audio.mp3"></audio><audio src="https://telegram.org/example/audio.ogg"></audio><tg-document src="https://telegram.org/example/document.zip"></tg-document>`,
  },
  {
    name: 'figures',
    official: 'figure + figcaption + map',
    html: `<p><b>#H06 figures + map</b></p><figure><img src="https://telegram.org/example/photo.jpg"/><figcaption>Photo caption<cite>Credit</cite></figcaption></figure><tg-map lat="41.9" long="12.5" zoom="14"/><figure><tg-map lat="41.9" long="12.5" zoom="14"/><figcaption>Map caption</figcaption></figure>`,
  },
  {
    name: 'collage',
    official: 'tg-collage + tg-slideshow',
    html: `<p><b>#H07 collage + slideshow</b></p><tg-collage><img src="https://picsum.photos/seed/a/400"/><img src="https://picsum.photos/seed/b/400"/><figcaption>Collage caption (square + square = grid)</figcaption></tg-collage><tg-slideshow><img src="https://telegram.org/example/photo.jpg"/><video src="https://telegram.org/example/video.mp4"/><figcaption>Slideshow caption</figcaption></tg-slideshow>`,
  },
  {
    name: 'table',
    official: 'table bordered striped compact',
    html: `<p><b>#H08 table</b></p><table bordered striped compact><caption>Table caption</caption><tr><td colspan="2" align="left">Span</td><td align="center">C</td><td align="right">R</td></tr><tr><td valign="top">T</td><td valign="middle">M</td><td valign="bottom">B</td></tr><tr><td>V7</td></tr></table>`,
  },
  {
    name: 'details-math',
    official: 'details + tg-math',
    html: `<p><b>#H09 details + math</b></p><details><summary>Title</summary>Content</details><details open><summary>Open</summary>Shown</details><tg-math-block>E = mc^2</tg-math-block><p>Inline <tg-math>x^2 + y^2</tg-math> and <tg-time unix="1647531900" format="wDT">date</tg-time> and <tg-emoji emoji-id="5368324170671202286">👍</tg-emoji> and <tg-reference name="note-1">ref</tg-reference></p>`,
  },
  {
    name: 'buttons',
    official: 'tg-button-row (all types)',
    html: `<p><b>#H10 buttons</b></p><tg-button-row align="left"><tg-button type="url" url="https://t.me">url</tg-button><tg-button type="url" style="success" url="tg://user?id=777000">user</tg-button><tg-button type="callback_data" style="link" data="probe">callback</tg-button></tg-button-row><tg-button-row align="center"><tg-button type="copy_text" text="copyme">Copy</tg-button><tg-button type="disabled">Disabled</tg-button></tg-button-row><tg-button-row align="right"><tg-button type="switch_inline_query" query="q">inline</tg-button></tg-button-row>`,
  },
];
