import zlib from 'node:zlib';
import { escapeHtml, sanitizeHtml } from './sanitize.js';

export class ImportError extends Error {}

export const SUPPORTED = ['.txt', '.md', '.markdown', '.docx'];
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function importFile(filename, buf) {
  const ext = (filename.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  if (!SUPPORTED.includes(ext)) {
    throw new ImportError(`Unsupported file type "${ext || 'unknown'}". Use .txt, .md or .docx.`);
  }
  if (!buf.length) throw new ImportError('That file is empty.');
  const title = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120) || 'Imported document';
  let html;
  if (ext === '.txt') html = textToHtml(buf.toString('utf8'));
  else if (ext === '.docx') html = docxToHtml(buf);
  else html = markdownToHtml(buf.toString('utf8'));
  return { title, html: sanitizeHtml(html) || '<p><br></p>' };
}

export function textToHtml(text) {
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function inline(raw) {
  return escapeHtml(raw)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<b>${a ?? b}</b>`)
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<i>$2</i>');
}

export function markdownToHtml(md) {
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => {
    if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; }
  };
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList();
      const lv = Math.min(m[1].length, 3);
      out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara();
      if (list?.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list?.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    flushList();
    para.push(line.replace(/^>\s?/, '').trim());
  }
  flushPara(); flushList();
  return out.join('');
}

/* ---------- .docx: minimal zip reader + WordprocessingML -> HTML ---------- */

const MAX_UNZIPPED = 20 * 1024 * 1024;

export function readZipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportError('That does not look like a valid .docx file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === wanted) {
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) {
        try { return zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }); }
        catch { throw new ImportError('This .docx is corrupted or too large to import.'); }
      }
      throw new ImportError('Unsupported compression in .docx file.');
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

const xmlDecode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function listTypes(numberingXml) {
  const abstract = new Map();
  for (const b of numberingXml.match(/<w:abstractNum [\s\S]*?<\/w:abstractNum>/g) || []) {
    const id = b.match(/w:abstractNumId="(\d+)"/)?.[1];
    const fmt = b.match(/<w:numFmt w:val="([^"]+)"/)?.[1];
    if (id) abstract.set(id, fmt === 'bullet' ? 'ul' : 'ol');
  }
  const nums = new Map();
  for (const b of numberingXml.match(/<w:num w:numId="\d+"[^>]*>[\s\S]*?<\/w:num>/g) || []) {
    const id = b.match(/w:numId="(\d+)"/)[1];
    const a = b.match(/<w:abstractNumId w:val="(\d+)"/)?.[1];
    nums.set(id, abstract.get(a) || 'ul');
  }
  return nums;
}

const flag = (rpr, tag) => {
  const m = rpr.match(new RegExp(`<w:${tag}(?: [^>]*)?/>`));
  return !!m && !/w:val="(0|false|none)"/.test(m[0]);
};

export function docxToHtml(buf) {
  const doc = readZipEntry(buf, 'word/document.xml');
  if (!doc) throw new ImportError('That does not look like a valid .docx file.');
  const numbering = readZipEntry(buf, 'word/numbering.xml')?.toString('utf8') || '';
  const types = listTypes(numbering);
  const xml = doc.toString('utf8');
  const out = [];
  let open = null;
  for (const para of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {
    let inner = '';
    for (const run of para.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || []) {
      const rpr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || '';
      let text = '';
      for (const t of run.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
        text += t[1] !== undefined ? escapeHtml(xmlDecode(t[1])) : t[0] === '<w:tab/>' ? ' ' : '<br>';
      }
      if (!text) continue;
      if (flag(rpr, 'b')) text = `<b>${text}</b>`;
      if (flag(rpr, 'i')) text = `<i>${text}</i>`;
      if (flag(rpr, 'u')) text = `<u>${text}</u>`;
      inner += text;
    }
    if (!inner.replace(/<[^>]+>/g, '').trim()) continue;
    const style = para.match(/<w:pStyle w:val="([^"]+)"/)?.[1] || '';
    const numId = para.match(/<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"/)?.[1];
    const heading = style.match(/^Heading([1-6])$/i)?.[1] || (/^title$/i.test(style) ? '1' : null);
    const listType = numId && numId !== '0' && !heading ? types.get(numId) || 'ul' : null;
    if (listType) {
      if (open !== listType) { if (open) out.push(`</${open}>`); out.push(`<${listType}>`); open = listType; }
      out.push(`<li>${inner}</li>`);
      continue;
    }
    if (open) { out.push(`</${open}>`); open = null; }
    out.push(heading ? `<h${Math.min(+heading, 3)}>${inner}</h${Math.min(+heading, 3)}>` : `<p>${inner}</p>`);
  }
  if (open) out.push(`</${open}>`);
  if (!out.length) throw new ImportError('No readable text found in that .docx file.');
  return out.join('');
}
