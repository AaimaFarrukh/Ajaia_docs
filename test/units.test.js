import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { sanitizeHtml } from '../server/sanitize.js';
import { markdownToHtml, textToHtml, docxToHtml, importFile } from '../server/importers.js';

test('sanitizer strips scripts, handlers and unknown tags but keeps formatting', () => {
  const dirty = '<p onclick="x()">Hi <b>there</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:1">link</a></p>';
  const clean = sanitizeHtml(dirty);
  assert.equal(clean, '<p>Hi <b>there</b>link</p>');
});

test('sanitizer maps browser variants and escapes stray angle brackets', () => {
  assert.equal(sanitizeHtml('<div><strong>a</strong> < b</div>'), '<p><b>a</b> &lt; b</p>');
});

test('markdown converts headings, lists and inline styles', () => {
  const html = markdownToHtml('# Title\n\nSome **bold** and *italic* <script>x</script>\n\n- one\n- two\n\n1. a\n2. b');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /<i>italic<\/i>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.doesNotMatch(html, /<script>/);
});

test('plain text becomes paragraphs', () => {
  assert.equal(textToHtml('a\nb\n\nc'), '<p>a<br>b</p><p>c</p>');
});

function makeZip(files) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name); const raw = Buffer.from(content);
    const data = zlib.deflateRawSync(raw); const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

test('docx import keeps headings, bold/italic runs and lists', () => {
  const body = `<w:document><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Plan</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> and &amp; italic</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item A</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item B</w:t></w:r></w:p>
  </w:body></w:document>`;
  const numbering = `<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const html = docxToHtml(makeZip({ 'word/document.xml': body, 'word/numbering.xml': numbering }));
  assert.equal(html, '<h1>Plan</h1><p><b>Bold</b><i> and &amp; italic</i></p><ol><li>Item A</li><li>Item B</li></ol>');
});

test('importFile rejects unsupported and invalid files with clear messages', () => {
  assert.throws(() => importFile('x.pdf', Buffer.from('a')), /Unsupported file type/);
  assert.throws(() => importFile('x.docx', Buffer.from('not a zip at all')), /valid \.docx/);
  assert.throws(() => importFile('x.txt', Buffer.alloc(0)), /empty/);
});
