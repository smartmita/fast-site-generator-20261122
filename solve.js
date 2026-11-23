// Fast drop-in replacement for makefun-site 1.0.0.
// Pure ES module, zero dependencies, zero cross-case caching.

const REPORT_FILE = 'build-report.txt';
const RESERVED = ['posts', 'tags', 'page'];
const INCLUDE_DEPTH = 8;
const SLUG_MAX = 64;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function byCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const JESC_TEST = /[\\"\x00-\x1f]/;
const JESC_RE = /[\\"\x00-\x1f]/g;
function jEscRepl(ch) {
  const c = ch.charCodeAt(0);
  if (c === 34) return '\\"';
  if (c === 92) return '\\\\';
  if (c === 10) return '\\n';
  if (c === 13) return '\\r';
  if (c === 9) return '\\t';
  if (c === 8) return '\\b';
  if (c === 12) return '\\f';
  return c < 16 ? '\\u000' + c.toString(16) : '\\u00' + c.toString(16);
}
function jStr(s) {
  return JESC_TEST.test(s) ? s.replace(JESC_RE, jEscRepl) : s;
}
const ESCJ_TEST = /[&<>"'\\\x00-\x1f]/;
const ESCJ_RE = /[&<>"'\\\x00-\x1f]/g;
function escJRepl(ch) {
  switch (ch) {
    case '&': return '&amp;';
    case '<': return '&lt;';
    case '>': return '&gt;';
    case '"': return '&quot;';
    case "'": return '&#39;';
    case '\\': return '\\\\';
    case '\n': return '\\n';
    case '\r': return '\\r';
    case '\t': return '\\t';
    case '\b': return '\\b';
    case '\f': return '\\f';
    default: {
      const c = ch.charCodeAt(0);
      return c < 16 ? '\\u000' + c.toString(16) : '\\u00' + c.toString(16);
    }
  }
}
function escapeHtmlJ(s) {
  return ESCJ_TEST.test(s) ? s.replace(ESCJ_RE, escJRepl) : s;
}

const SLUG_CODES = new Uint16Array(64);

function slugifyRaw(text) {
  const len = text.length;
  let n = 0;
  let gap = false;
  for (let i = 0; i < len; i++) {
    let c = text.charCodeAt(i);
    if (c >= 128) {
      const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
      const plen = plain.length;
      n = 0;
      gap = false;
      for (let j = 0; j < plen; j++) {
        let ch = plain.charCodeAt(j);
        if (ch >= 65 && ch <= 90) ch += 32;
        else if (!((ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57))) {
          if (n > 0) gap = true;
          continue;
        }
        if (gap) {
          if (n >= SLUG_MAX - 1) break;
          SLUG_CODES[n++] = 45;
          gap = false;
        } else if (n >= SLUG_MAX) {
          break;
        }
        SLUG_CODES[n++] = ch;
      }
      return n === 0 ? 'untitled' : String.fromCharCode.apply(null, n === 64 ? SLUG_CODES : SLUG_CODES.subarray(0, n));
    }
    if (c >= 65 && c <= 90) c += 32;
    else if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
      if (n > 0) gap = true;
      continue;
    }
    if (gap) {
      if (n >= SLUG_MAX - 1) break;
      SLUG_CODES[n++] = 45;
      gap = false;
    } else if (n >= SLUG_MAX) {
      break;
    }
    SLUG_CODES[n++] = c;
  }
  return n === 0 ? 'untitled' : String.fromCharCode.apply(null, n === 64 ? SLUG_CODES : SLUG_CODES.subarray(0, n));
}

function uniqueSlug(slug, taken) {
  let out = slug;
  if (taken.has(out)) {
    let n = 2;
    while (taken.has((out = `${slug}-${n}`))) n++;
  }
  taken.add(out);
  return out;
}

function longDate(date) {
  const y = date.slice(0, 4);
  const m = (date.charCodeAt(5) - 48) * 10 + (date.charCodeAt(6) - 48);
  const d = (date.charCodeAt(8) - 48) * 10 + (date.charCodeAt(9) - 48);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const WS_U16 = new Uint8Array(65536);
for (const cp of [
  9, 10, 11, 12, 13, 32, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]) {
  WS_U16[cp] = 1;
}

function wordsOf(text) {
  const len = text.length;
  let count = 0;
  let inWord = 0;
  for (let i = 0; i < len; i++) {
    const ws = WS_U16[text.charCodeAt(i)];
    if ((inWord | ws) === 0) count++;
    inWord = ws ^ 1;
  }
  return count;
}

function hasWhitespace(s) {
  for (let i = 0; i < s.length; i++) {
    if (WS_U16[s.charCodeAt(i)] === 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Front matter (zero-alloc)

const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

let fmStrVal = '';
function parseFmString(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return 'a quoted string is not closed';
    let out = '';
    let last = 1;
    const end = raw.length - 1;
    for (let i = 1; i < end; i++) {
      const c = raw.charCodeAt(i);
      if (c === 92) {
        const n = raw.charCodeAt(i + 1);
        if ((n !== 34 && n !== 92) || i + 1 === end) {
          return 'a quoted string holds an escape other than \\" or \\\\';
        }
        if (i > last) out += raw.slice(last, i);
        out += raw[i + 1];
        i++;
        last = i + 1;
      } else if (c === 34) {
        return 'a quoted string holds a stray quote';
      }
    }
    if (last === 1) fmStrVal = raw.slice(1, end);
    else fmStrVal = last < end ? out + raw.slice(last, end) : out;
    return null;
  }
  if (raw.charCodeAt(0) === 91) return 'a bare string opens on [';
  fmStrVal = raw;
  return null;
}

function parseFmValue(key, raw, data) {
  if (key === 'title' || key === 'summary') {
    const err = parseFmString(raw);
    if (err !== null) return `key "${key}": ${err}`;
    data[key] = fmStrVal;
    return null;
  }
  if (key === 'date') {
    if (raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45) {
      const y0 = raw.charCodeAt(0) - 48, y1 = raw.charCodeAt(1) - 48, y2 = raw.charCodeAt(2) - 48, y3 = raw.charCodeAt(3) - 48;
      const m0 = raw.charCodeAt(5) - 48, m1 = raw.charCodeAt(6) - 48;
      const d0 = raw.charCodeAt(8) - 48, d1 = raw.charCodeAt(9) - 48;
      if ((y0 | y1 | y2 | y3 | m0 | m1 | d0 | d1) >= 0 && y0 <= 9 && y1 <= 9 && y2 <= 9 && y3 <= 9 && m0 <= 9 && m1 <= 9 && d0 <= 9 && d1 <= 9) {
        const y = y0 * 1000 + y1 * 100 + y2 * 10 + y3;
        const mo = m0 * 10 + m1;
        const d = d0 * 10 + d1;
        if (y >= 1970 && y <= 2099 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo)) {
          data.date = raw;
          return null;
        }
      }
    }
    return 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
  }
  if (key === 'tags') {
    if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return 'key "tags": not a list [a, b]';
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') { data.tags = []; return null; }
    const parts = inner.split(',');
    const tags = new Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i].trim();
      if (t === '' || !TAG_RE.test(t)) return 'key "tags": an empty tag, or one holding " [ or ]';
      tags[i] = t;
    }
    data.tags = tags;
    return null;
  }
  if (key === 'draft') {
    if (raw === 'true') { data.draft = true; return null; }
    if (raw === 'false') { data.draft = false; return null; }
    return 'key "draft": true or false';
  }
  if (key === 'layout') {
    if (NAME_RE.test(raw)) { data.layout = raw; return null; }
    return 'key "layout": not a template name';
  }
  if (key === 'slug') {
    if (SLUG_RE.test(raw) && raw.length <= 64) { data.slug = raw; return null; }
    return 'key "slug": not a slug';
  }
  return `unknown key "${key}"`;
}

let fmData = null;
let fmBody = '';
function parseFrontMatter(text) {
  const len = text.length;
  const nl0 = text.indexOf('\n');
  if (nl0 === -1) return text === '---' ? 'the front matter is not closed' : 'no front matter';
  if (nl0 !== 3 || text.charCodeAt(0) !== 45 || text.charCodeAt(1) !== 45 || text.charCodeAt(2) !== 45) {
    return 'no front matter';
  }

  const data = {
    title: undefined,
    date: undefined,
    tags: undefined,
    draft: undefined,
    layout: undefined,
    slug: undefined,
    summary: undefined,
  };
  let mask = 0;
  let pos = 4;
  let lineIdx = 1;
  while (pos <= len) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    if (end - pos === 3 && text.charCodeAt(pos) === 45 && text.charCodeAt(pos + 1) === 45 && text.charCodeAt(pos + 2) === 45) {
      if ((mask & 1) === 0) return 'no title';
      fmData = data;
      fmBody = nl === -1 ? '' : text.slice(nl + 1);
      return null;
    }
    if (!startIsBlank(text, pos, end) && text.charCodeAt(pos) !== 35) {
      let colon = -1;
      let validKey = true;
      for (let k = pos; k < end; k++) {
        const kc = text.charCodeAt(k);
        if (kc === 58) {
          colon = k;
          break;
        }
        if (!((kc >= 97 && kc <= 122) || kc === 95)) {
          validKey = false;
        }
      }
      if (colon <= pos || !validKey) return `line ${lineIdx + 1} is not "key: value"`;
      if (colon + 1 < end && text.charCodeAt(colon + 1) !== 32) return `line ${lineIdx + 1} is not "key: value"`;
      const key = text.slice(pos, colon);
      let rawEnd = end;
      while (rawEnd > colon + 2 && (text.charCodeAt(rawEnd - 1) === 32 || text.charCodeAt(rawEnd - 1) === 9)) rawEnd--;
      const raw = colon + 2 <= rawEnd ? text.slice(colon + 2, rawEnd) : '';
      let bit = 0;
      if (key === 'title') bit = 1;
      else if (key === 'date') bit = 2;
      else if (key === 'tags') bit = 4;
      else if (key === 'draft') bit = 8;
      else if (key === 'layout') bit = 16;
      else if (key === 'slug') bit = 32;
      else if (key === 'summary') bit = 64;
      else return `unknown key "${key}"`;
      if ((mask & bit) !== 0) return `key "${key}" is given twice`;
      if (raw === '') return `key "${key}" has no value`;
      const err = parseFmValue(key, raw, data);
      if (err !== null) return err;
      mask |= bit;
    }
    if (nl === -1) break;
    pos = nl + 1;
    lineIdx++;
  }
  return 'the front matter is not closed';
}

// ---------------------------------------------------------------- Markdown helpers

const ESCAPABLE = new Uint8Array(128);
for (const ch of '\\`*_[]()#+-.!>') ESCAPABLE[ch.charCodeAt(0)] = 1;

const PARA_STOP = new Uint8Array(128);
for (const ch of ' \t`#-*') PARA_STOP[ch.charCodeAt(0)] = 1;

const BLANK_RE = /^[ \t]*$/;

const INLINE_J_TBL = new Uint8Array(128);
for (let i = 0; i < 32; i++) INLINE_J_TBL[i] = 1;
INLINE_J_TBL[34] = 1;
INLINE_J_TBL[38] = 1;
INLINE_J_TBL[39] = 1;
INLINE_J_TBL[42] = 1;
INLINE_J_TBL[60] = 1;
INLINE_J_TBL[62] = 1;
INLINE_J_TBL[91] = 1;
INLINE_J_TBL[92] = 1;
INLINE_J_TBL[96] = 1;

const ESC_J_TBL = new Uint8Array(128);
for (let i = 0; i < 32; i++) ESC_J_TBL[i] = 1;
ESC_J_TBL[34] = 1;
ESC_J_TBL[38] = 1;
ESC_J_TBL[39] = 1;
ESC_J_TBL[60] = 1;
ESC_J_TBL[62] = 1;
ESC_J_TBL[92] = 1;

const J_ESC_TBL = new Uint8Array(128);
for (let i = 0; i < 32; i++) J_ESC_TBL[i] = 1;
J_ESC_TBL[34] = 1;
J_ESC_TBL[92] = 1;

function findUnescaped(s, what, from, end) {
  const limit = end - what.length;
  let pos = from;
  while (pos <= limit) {
    const hit = s.indexOf(what, pos);
    if (hit === -1 || hit > limit) return -1;
    let bs = hit - 1;
    while (bs >= from && s.charCodeAt(bs) === 92) bs--;
    if (((hit - 1 - bs) & 1) === 0) return hit;
    pos = hit + 1;
  }
  return -1;
}

function findSingleStar(s, from, end) {
  let pos = from;
  while (pos < end) {
    const hit = s.indexOf('*', pos);
    if (hit === -1 || hit >= end) return -1;
    let bs = hit - 1;
    while (bs >= from && s.charCodeAt(bs) === 92) bs--;
    if (((hit - 1 - bs) & 1) === 1) {
      pos = hit + 1;
      continue;
    }
    if (hit + 1 < end && s.charCodeAt(hit + 1) === 42) {
      pos = hit + 2;
      continue;
    }
    return hit;
  }
  return -1;
}

function isBlankSlice(src, start, end) {
  for (let i = start; i < end; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimSlice(src, start, end) {
  while (start < end && (src.charCodeAt(start) === 32 || src.charCodeAt(start) === 9)) start++;
  while (end > start && (src.charCodeAt(end - 1) === 32 || src.charCodeAt(end - 1) === 9)) end--;
  return src.slice(start, end);
}

function isFenceCloseSlice(src, pos, end) {
  return pos + 3 <= end && src.charCodeAt(pos) === 96 && src.charCodeAt(pos + 1) === 96 && src.charCodeAt(pos + 2) === 96 && isBlankSlice(src, pos + 3, end);
}

function fenceLangEnd(src, pos, end) {
  if (pos + 3 > end || src.charCodeAt(pos) !== 96 || src.charCodeAt(pos + 1) !== 96 || src.charCodeAt(pos + 2) !== 96) return -1;
  let i = pos + 3;
  while (i < end) {
    const c = src.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) {
      i++;
    } else {
      break;
    }
  }
  return isBlankSlice(src, i, end) ? i : -1;
}

function headingDepthSlice(src, pos, end) {
  let d = 0;
  const max = Math.min(end, pos + 6);
  while (pos + d < max && src.charCodeAt(pos + d) === 35) d++;
  if (d === 0 || pos + d >= end) return 0;
  const sp = src.charCodeAt(pos + d);
  if (sp !== 32 && sp !== 9) return 0;
  let t = pos + d + 1;
  while (t < end && (src.charCodeAt(t) === 32 || src.charCodeAt(t) === 9)) t++;
  return t < end ? d : 0;
}

function isHrSlice(src, pos, end, c0) {
  return pos + 3 <= end && src.charCodeAt(pos + 1) === c0 && src.charCodeAt(pos + 2) === c0 && isBlankSlice(src, pos + 3, end);
}

function isBulletSlice(src, pos, end) {
  return pos + 2 <= end && (src.charCodeAt(pos) === 45 || src.charCodeAt(pos) === 42) && src.charCodeAt(pos + 1) === 32;
}

function orderedStartSlice(src, pos, end) {
  let i = pos;
  const limit = Math.min(end, pos + 9);
  while (i < limit) {
    const c = src.charCodeAt(i);
    if (c < 48 || c > 57) break;
    i++;
  }
  if (i === pos || i + 1 >= end || src.charCodeAt(i) !== 46 || src.charCodeAt(i + 1) !== 32) return -1;
  return i + 2;
}

function isContinuedSlice(src, pos, end) {
  if (pos + 2 >= end || src.charCodeAt(pos) !== 32 || src.charCodeAt(pos + 1) !== 32) return false;
  let i = pos + 2;
  while (i < end && src.charCodeAt(i) === 32) i++;
  if (i >= end) return false;
  const c = src.charCodeAt(i);
  return c !== 32 && !(c >= 9 && c <= 13);
}

function startIsBlank(src, pos, end) {
  if (pos === end) return true;
  const c0 = src.charCodeAt(pos);
  if (c0 !== 32 && c0 !== 9) return false;
  return isBlankSlice(src, pos + 1, end);
}

// ---------------------------------------------------------------- Templates (Parse + Partial Eval)

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenizeTemplate(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = BLANK_RE.test(src.slice(lineStart, open)) && BLANK_RE.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenizeTemplate(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) {
        body.push({ kind: 'include', name: m[1] });
      } else {
        throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
      }
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    const len = v.length;
    if (len === 0) return '';
    let s = textOf(v[0]);
    for (let i = 1; i < len; i++) s += ', ' + textOf(v[i]);
    return s;
  }
  return '';
}

function textOfJ(v) {
  if (typeof v === 'string') return jStr(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return jStr(textOf(v));
  return '';
}

function escTextOfJ(v) {
  if (typeof v === 'string') return escapeHtmlJ(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return escapeHtmlJ(textOf(v));
  return '';
}

function isPreJRaw(path) {
  const last = path[path.length - 1];
  return last === 'content' || last === 'excerpt' || last === 'html';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function inlineAst(nodes, depth, templates, out) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'text') {
      if (out.length > 0 && out[out.length - 1].kind === 'text') {
        out[out.length - 1] = { kind: 'text', text: out[out.length - 1].text + n.text };
      } else {
        out.push(n);
      }
    } else if (n.kind === 'include') {
      if (depth < INCLUDE_DEPTH) {
        const t = templates.get(n.name);
        if (t !== undefined) inlineAst(t, depth + 1, templates, out);
      }
    } else if (n.kind === 'if') {
      const thenBody = [];
      inlineAst(n.then, depth, templates, thenBody);
      let elseBody = null;
      if (n.else !== null) {
        elseBody = [];
        inlineAst(n.else, depth, templates, elseBody);
      }
      out.push({ kind: 'if', not: n.not, path: n.path, then: thenBody, else: elseBody });
    } else if (n.kind === 'for') {
      const body = [];
      inlineAst(n.body, depth, templates, body);
      out.push({ kind: 'for', name: n.name, path: n.path, body });
    } else {
      out.push(n);
    }
  }
}

function bodyUsesLoop(list) {
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.kind === 'var' || n.kind === 'raw') {
      if (n.path[0] === 'loop') return true;
    } else if (n.kind === 'if') {
      if (n.path[0] === 'loop') return true;
      if (bodyUsesLoop(n.then)) return true;
      if (n.else !== null && bodyUsesLoop(n.else)) return true;
    } else if (n.kind === 'for') {
      if (n.path[0] === 'loop') return true;
    }
  }
  return false;
}

function astUsesProp(nodes, prop) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'var' || n.kind === 'raw') {
      if (n.path.includes(prop)) return true;
    } else if (n.kind === 'if') {
      if (n.path.includes(prop) || astUsesProp(n.then, prop) || (n.else !== null && astUsesProp(n.else, prop))) return true;
    } else if (n.kind === 'for') {
      if (n.path.includes(prop) || astUsesProp(n.body, prop)) return true;
    }
  }
  return false;
}

function evalPath(path, env) {
  let v = env[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    const k = path[i];
    if (!Object.hasOwn(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

function isStaticNodeList(nodes, bound, dynRoots) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'text') continue;
    if (n.kind === 'var' || n.kind === 'raw') {
      const r = n.path[0];
      if (!bound.has(r) && dynRoots.has(r)) return false;
    } else if (n.kind === 'if') {
      const r = n.path[0];
      if (!bound.has(r) && dynRoots.has(r)) return false;
      if (!isStaticNodeList(n.then, bound, dynRoots)) return false;
      if (n.else !== null && !isStaticNodeList(n.else, bound, dynRoots)) return false;
    } else if (n.kind === 'for') {
      const r = n.path[0];
      if (!bound.has(r) && dynRoots.has(r)) return false;
      const nextBound = new Set(bound);
      nextBound.add(n.name);
      nextBound.add('loop');
      if (!isStaticNodeList(n.body, nextBound, dynRoots)) return false;
    }
  }
  return true;
}

function evalStaticNodes(nodes, env, out) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'text') out.push(jStr(n.text));
    else if (n.kind === 'var') out.push(escTextOfJ(evalPath(n.path, env)));
    else if (n.kind === 'raw') {
      const v = evalPath(n.path, env);
      out.push(isPreJRaw(n.path) && typeof v === 'string' ? v : textOfJ(v));
    } else if (n.kind === 'if') {
      const cond = truthy(evalPath(n.path, env));
      if (n.not ? !cond : cond) evalStaticNodes(n.then, env, out);
      else if (n.else !== null) evalStaticNodes(n.else, env, out);
    } else if (n.kind === 'for') {
      const arr = evalPath(n.path, env);
      if (Array.isArray(arr)) {
        const len = arr.length;
        const prevItem = env[n.name], hasItem = Object.hasOwn(env, n.name);
        const prevLoop = env.loop, hasLoop = Object.hasOwn(env, 'loop');
        for (let k = 0; k < len; k++) {
          env[n.name] = arr[k];
          env.loop = { __proto__: null, index: k + 1, first: k === 0, last: k === len - 1, length: len };
          evalStaticNodes(n.body, env, out);
        }
        if (hasItem) env[n.name] = prevItem; else delete env[n.name];
        if (hasLoop) env.loop = prevLoop; else delete env.loop;
      }
    }
  }
}

function foldAst(nodes, staticEnv, bound, dynRoots, truthyRoots, out) {
  const pushText = (txt) => {
    if (txt === '') return;
    if (out.length > 0 && out[out.length - 1].kind === 'text') {
      out[out.length - 1] = { kind: 'text', text: out[out.length - 1].text + txt };
    } else {
      out.push({ kind: 'text', text: txt });
    }
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'text') {
      pushText(jStr(n.text));
    } else if (n.kind === 'var' || n.kind === 'raw') {
      const r = n.path[0];
      if (!bound.has(r) && !dynRoots.has(r)) {
        const v = evalPath(n.path, staticEnv);
        pushText(n.kind === 'var' ? escTextOfJ(v) : (isPreJRaw(n.path) && typeof v === 'string' ? v : textOfJ(v)));
      } else {
        out.push(n);
      }
    } else if (n.kind === 'if') {
      const r = n.path[0];
      if (!bound.has(r) && !dynRoots.has(r)) {
        const cond = truthy(evalPath(n.path, staticEnv));
        const branch = (n.not ? !cond : cond) ? n.then : n.else;
        if (branch !== null) foldAst(branch, staticEnv, bound, dynRoots, truthyRoots, out);
      } else if (!bound.has(r) && n.path.length === 1 && truthyRoots.has(r)) {
        const branch = n.not ? n.else : n.then;
        if (branch !== null) foldAst(branch, staticEnv, bound, dynRoots, truthyRoots, out);
      } else {
        const thenOut = [];
        foldAst(n.then, staticEnv, bound, dynRoots, truthyRoots, thenOut);
        let elseOut = null;
        if (n.else !== null) {
          elseOut = [];
          foldAst(n.else, staticEnv, bound, dynRoots, truthyRoots, elseOut);
        }
        out.push({ kind: 'if', not: n.not, path: n.path, then: thenOut, else: elseOut });
      }
    } else if (n.kind === 'for') {
      const r = n.path[0];
      const nextBound = new Set(bound);
      nextBound.add(n.name);
      nextBound.add('loop');
      if (!bound.has(r) && !dynRoots.has(r) && isStaticNodeList(n.body, nextBound, dynRoots)) {
        const arr = evalPath(n.path, staticEnv);
        if (Array.isArray(arr)) {
          const buf = [];
          const len = arr.length;
          const prevItem = staticEnv[n.name], hasItem = Object.hasOwn(staticEnv, n.name);
          const prevLoop = staticEnv.loop, hasLoop = Object.hasOwn(staticEnv, 'loop');
          for (let k = 0; k < len; k++) {
            staticEnv[n.name] = arr[k];
            staticEnv.loop = { __proto__: null, index: k + 1, first: k === 0, last: k === len - 1, length: len };
            evalStaticNodes(n.body, staticEnv, buf);
          }
          if (hasItem) staticEnv[n.name] = prevItem; else delete staticEnv[n.name];
          if (hasLoop) staticEnv.loop = prevLoop; else delete staticEnv.loop;
          pushText(buf.join(''));
        }
      } else {
        const bodyOut = [];
        foldAst(n.body, staticEnv, nextBound, dynRoots, truthyRoots, bodyOut);
        out.push({ kind: 'for', name: n.name, path: n.path, body: bodyOut });
      }
    }
  }
}

function bodyUsesBareLoop(list) {
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.kind === 'var' || n.kind === 'raw') {
      if (n.path[0] === 'loop' && (n.path.length !== 2 || (n.path[1] !== 'index' && n.path[1] !== 'first' && n.path[1] !== 'last' && n.path[1] !== 'length'))) return true;
    } else if (n.kind === 'if') {
      if (n.path[0] === 'loop' && (n.path.length !== 2 || (n.path[1] !== 'index' && n.path[1] !== 'first' && n.path[1] !== 'last' && n.path[1] !== 'length'))) return true;
      if (bodyUsesBareLoop(n.then)) return true;
      if (n.else !== null && bodyUsesBareLoop(n.else)) return true;
    } else if (n.kind === 'for') {
      if (n.path[0] === 'loop' && (n.path.length !== 2 || (n.path[1] !== 'index' && n.path[1] !== 'first' && n.path[1] !== 'last' && n.path[1] !== 'length'))) return true;
    }
  }
  return false;
}

const PROTO_KEYS = {};

// ---------------------------------------------------------------- Path helpers

function resolvePath(baseParts, dirStr, rel) {
  if (rel.length > 0 && rel.charCodeAt(0) !== 46 && !rel.includes('.') && !rel.includes('//') && rel.charCodeAt(rel.length - 1) !== 47) {
    return dirStr === '' ? rel : `${dirStr}/${rel}`;
  }
  const parts = baseParts.slice();
  let pos = 0;
  const len = rel.length;
  while (pos <= len) {
    const slash = rel.indexOf('/', pos);
    const seg = slash === -1 ? rel.slice(pos) : rel.slice(pos, slash);
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (seg !== '' && seg !== '.') {
      parts.push(seg);
    }
    if (slash === -1) break;
    pos = slash + 1;
  }
  return parts.join('/');
}

function dirOf(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function resolveLinkCtx(ctx, target) {
  const cached = ctx.urlMap.get(target);
  if (cached !== undefined) return cached;
  const c0 = target.charCodeAt(0);
  if (c0 === 47 || c0 === 35 || (target.includes(':') && SCHEME_RE.test(target))) {
    let esc = ctx.extMap.get(target);
    if (esc === undefined) {
      esc = escapeHtmlJ(target);
      ctx.extMap.set(target, esc);
    }
    ctx.urlMap.set(target, esc);
    return esc;
  }
  const hash = target.indexOf('#');
  const rel = hash === -1 ? target : target.slice(0, hash);
  const frag = hash === -1 ? '' : target.slice(hash);
  let path = null;
  if (rel !== '') {
    let dirMap = ctx.relCache.get(ctx.dir);
    if (dirMap === undefined) {
      dirMap = new Map();
      ctx.relCache.set(ctx.dir, dirMap);
    }
    path = dirMap.get(rel);
    if (path === undefined) {
      path = resolvePath(ctx.dirParts, ctx.dir, rel);
      dirMap.set(rel, path);
    }
  }
  if (path !== null) {
    const targetSrc = ctx.bySource.get(path);
    if (targetSrc !== undefined) {
      const rawUrl = frag === '' ? targetSrc.url : `${targetSrc.url}${frag}`;
      const esc = (ctx.safeUrls && (frag === '' || !ESCJ_TEST.test(frag))) ? rawUrl : escapeHtmlJ(rawUrl);
      ctx.urlMap.set(target, esc);
      return esc;
    }
    if (ctx.staticPaths.has(path)) {
      const rawUrl = frag === '' ? `${ctx.base}/${path}` : `${ctx.base}/${path}${frag}`;
      const esc = (ctx.safeUrls && !ESCJ_TEST.test(path) && (frag === '' || !ESCJ_TEST.test(frag))) ? rawUrl : escapeHtmlJ(rawUrl);
      ctx.urlMap.set(target, esc);
      return esc;
    }
  }
  ctx.broken.add(`broken-link ${ctx.srcPath} -> ${target}`);
  return escapeHtmlJ(target);
}

// ---------------------------------------------------------------- Zero-Alloc OutSlab Engine

function makeSlab(cap) {
  return { buf: Buffer.allocUnsafe(cap), pos: 0, cap };
}

function growSlab(slab, extra) {
  let newCap = slab.cap * 2;
  const need = slab.pos + extra;
  while (newCap < need) newCap *= 2;
  const next = Buffer.allocUnsafe(newCap);
  next.set(slab.buf.subarray(0, slab.pos), 0);
  slab.buf = next;
  slab.cap = newCap;
}

function writeSlabBuf(slab, src) {
  const len = src.length;
  if (len === 0) return;
  if (slab.pos + len > slab.cap) growSlab(slab, len);
  const dst = slab.buf;
  let p = slab.pos;
  if (len <= 16) {
    for (let i = 0; i < len; i++) dst[p++] = src[i];
  } else {
    dst.set(src, p);
    p += len;
  }
  slab.pos = p;
}

function writeSlabSlice(slab, src, start, end) {
  const len = end - start;
  if (len <= 0) return;
  if (slab.pos + len > slab.cap) growSlab(slab, len);
  if (len <= 16) {
    const dst = slab.buf;
    let p = slab.pos;
    for (let i = start; i < end; i++) dst[p++] = src[i];
    slab.pos = p;
  } else {
    src.copy(slab.buf, slab.pos, start, end);
    slab.pos += len;
  }
}

function writeRawStr(s, slab) {
  const len = s.length;
  if (len === 0) return;
  if (slab.pos + len * 3 > slab.cap) growSlab(slab, len * 3);
  const dst = slab.buf;
  let p = slab.pos;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) {
      dst[p++] = c;
    } else if (c < 0x800) {
      dst[p++] = 0xc0 | (c >> 6);
      dst[p++] = 0x80 | (c & 0x3f);
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < len) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      dst[p++] = 0xf0 | (cp >> 18);
      dst[p++] = 0x80 | ((cp >> 12) & 0x3f);
      dst[p++] = 0x80 | ((cp >> 6) & 0x3f);
      dst[p++] = 0x80 | (cp & 0x3f);
    } else {
      dst[p++] = 0xe0 | (c >> 12);
      dst[p++] = 0x80 | ((c >> 6) & 0x3f);
      dst[p++] = 0x80 | (c & 0x3f);
    }
  }
  slab.pos = p;
}

function writeAsciiOrVal(v, slab) {
  if (typeof v === 'number') {
    if (v >= 0 && v < 1000000 && (v | 0) === v) {
      if (slab.pos + 8 > slab.cap) growSlab(slab, 8);
      const dst = slab.buf;
      let p = slab.pos;
      if (v < 10) {
        dst[p++] = 48 + v;
      } else if (v < 100) {
        const d = (v / 10) | 0;
        dst[p++] = 48 + d;
        dst[p++] = 48 + (v - d * 10);
      } else {
        let n = v;
        let div = 100;
        while (n >= div * 10) div *= 10;
        while (div >= 1) {
          const d = (n / div) | 0;
          dst[p++] = 48 + d;
          n -= d * div;
          div = (div / 10) | 0;
        }
      }
      slab.pos = p;
      return;
    }
    writeRawStr(String(v), slab);
    return;
  }
  if (typeof v === 'string') {
    writeRawStr(v, slab);
    return;
  }
  if (typeof v === 'boolean') {
    writeSlabBuf(slab, v ? B_TRUE : B_FALSE);
  }
}

function writeJCtrlChar(c, dst, p) {
  if (c === 34) { dst[p++] = 92; dst[p++] = 34; }
  else if (c === 92) { dst[p++] = 92; dst[p++] = 92; }
  else if (c === 10) { dst[p++] = 92; dst[p++] = 110; }
  else if (c === 13) { dst[p++] = 92; dst[p++] = 114; }
  else if (c === 9) { dst[p++] = 92; dst[p++] = 116; }
  else if (c === 8) { dst[p++] = 92; dst[p++] = 98; }
  else if (c === 12) { dst[p++] = 92; dst[p++] = 102; }
  else {
    dst[p++] = 92; dst[p++] = 117; dst[p++] = 48; dst[p++] = 48;
    dst[p++] = 48 + (c >> 4);
    const d = c & 15;
    dst[p++] = d < 10 ? 48 + d : 87 + d;
  }
  return p;
}

function writeJStrSlab(s, start, end, slab) {
  const len = end - start;
  if (len <= 0) return;
  if (slab.pos + len * 6 > slab.cap) growSlab(slab, len * 6);
  const dst = slab.buf;
  let p = slab.pos;
  for (let i = start; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) {
      if (J_ESC_TBL[c] === 0) {
        dst[p++] = c;
      } else {
        p = writeJCtrlChar(c, dst, p);
      }
    } else if (c < 0x800) {
      dst[p++] = 0xc0 | (c >> 6);
      dst[p++] = 0x80 | (c & 0x3f);
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < end) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      dst[p++] = 0xf0 | (cp >> 18);
      dst[p++] = 0x80 | ((cp >> 12) & 0x3f);
      dst[p++] = 0x80 | ((cp >> 6) & 0x3f);
      dst[p++] = 0x80 | (cp & 0x3f);
    } else {
      dst[p++] = 0xe0 | (c >> 12);
      dst[p++] = 0x80 | ((c >> 6) & 0x3f);
      dst[p++] = 0x80 | (c & 0x3f);
    }
  }
  slab.pos = p;
}

function writeHtmlJSlab(s, start, end, slab) {
  const len = end - start;
  if (len <= 0) return;
  if (slab.pos + len * 6 > slab.cap) growSlab(slab, len * 6);
  const dst = slab.buf;
  let p = slab.pos;
  for (let i = start; i < end; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) {
      if (ESC_J_TBL[c] === 0) {
        dst[p++] = c;
      } else if (c === 38) { dst[p++]=38; dst[p++]=97; dst[p++]=109; dst[p++]=112; dst[p++]=59; }
      else if (c === 60) { dst[p++]=38; dst[p++]=108; dst[p++]=116; dst[p++]=59; }
      else if (c === 62) { dst[p++]=38; dst[p++]=103; dst[p++]=116; dst[p++]=59; }
      else if (c === 34) { dst[p++]=38; dst[p++]=113; dst[p++]=117; dst[p++]=111; dst[p++]=116; dst[p++]=59; }
      else if (c === 39) { dst[p++]=38; dst[p++]=35; dst[p++]=51; dst[p++]=57; dst[p++]=59; }
      else p = writeJCtrlChar(c, dst, p);
    } else if (c < 0x800) {
      dst[p++] = 0xc0 | (c >> 6);
      dst[p++] = 0x80 | (c & 0x3f);
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < end) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      dst[p++] = 0xf0 | (cp >> 18);
      dst[p++] = 0x80 | ((cp >> 12) & 0x3f);
      dst[p++] = 0x80 | ((cp >> 6) & 0x3f);
      dst[p++] = 0x80 | (cp & 0x3f);
    } else {
      dst[p++] = 0xe0 | (c >> 12);
      dst[p++] = 0x80 | ((c >> 6) & 0x3f);
      dst[p++] = 0x80 | (c & 0x3f);
    }
  }
  slab.pos = p;
}

function writeEscTextValSlab(v, slab) {
  if (typeof v === 'string') {
    writeHtmlJSlab(v, 0, v.length, slab);
  } else if (typeof v === 'number') {
    writeAsciiOrVal(v, slab);
  } else if (typeof v === 'boolean') {
    writeSlabBuf(slab, v ? B_TRUE : B_FALSE);
  } else if (Array.isArray(v)) {
    const s = textOf(v);
    writeHtmlJSlab(s, 0, s.length, slab);
  }
}

function writeRawTextValSlab(v, slab) {
  if (typeof v === 'string') {
    writeJStrSlab(v, 0, v.length, slab);
  } else if (typeof v === 'number') {
    writeAsciiOrVal(v, slab);
  } else if (typeof v === 'boolean') {
    writeSlabBuf(slab, v ? B_TRUE : B_FALSE);
  } else if (Array.isArray(v)) {
    const s = textOf(v);
    writeJStrSlab(s, 0, s.length, slab);
  }
}

const B_TRUE = Buffer.from('true');
const B_FALSE = Buffer.from('false');
const B_PRE_OPEN = Buffer.from('<pre><code>');
const B_PRE_LANG = Buffer.from('<pre><code class=\\"language-');
const B_PRE_LANG_END = Buffer.from('\\">');
const B_PRE_CLOSE = Buffer.from('</code></pre>\\n');
const B_BQ_EMPTY = Buffer.from('<blockquote>\\n</blockquote>\\n');
const B_BQ_OPEN = Buffer.from('<blockquote>\\n<p>');
const B_BQ_CLOSE = Buffer.from('</p>\\n</blockquote>\\n');

function resolveLinkATagBuf(ctx, target) {
  let buf = ctx.aBufMap.get(target);
  if (buf !== undefined) return buf;
  const url = resolveLinkCtx(ctx, target);
  buf = Buffer.from(`<a href=\\"${url}\\">`, 'utf8');
  if (ctx.urlMap.has(target)) ctx.aBufMap.set(target, buf);
  return buf;
}

function writeUtf8Char(s, i, end, slab) {
  const c = s.charCodeAt(i);
  const dst = slab.buf;
  let p = slab.pos;
  if (c < 0x800) {
    dst[p++] = 0xc0 | (c >> 6);
    dst[p++] = 0x80 | (c & 0x3f);
  } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < end) {
    const c2 = s.charCodeAt(++i);
    const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
    dst[p++] = 0xf0 | (cp >> 18);
    dst[p++] = 0x80 | ((cp >> 12) & 0x3f);
    dst[p++] = 0x80 | ((cp >> 6) & 0x3f);
    dst[p++] = 0x80 | (cp & 0x3f);
  } else {
    dst[p++] = 0xe0 | (c >> 12);
    dst[p++] = 0x80 | ((c >> 6) & 0x3f);
    dst[p++] = 0x80 | (c & 0x3f);
  }
  slab.pos = p;
  return i + 1;
}

// Tiny zero-deopt leaf scanner for ASCII inline markdown + escaping;
// stops on markdown syntax (* ` [ \), control chars < 32 (other than \n), or non-ASCII >= 128.
function scanInlineFast(s, i, end, slab) {
  const dst = slab.buf;
  let p = slab.pos;
  while (i < end) {
    const c = s.charCodeAt(i);
    if (c >= 128) break;
    if (INLINE_J_TBL[c] === 0) {
      dst[p++] = c;
      i++;
      continue;
    }
    if (c === 10) { dst[p++] = 92; dst[p++] = 110; i++; continue; }
    if (c === 39) { dst[p++]=38; dst[p++]=35; dst[p++]=51; dst[p++]=57; dst[p++]=59; i++; continue; }
    if (c === 34) { dst[p++]=38; dst[p++]=113; dst[p++]=117; dst[p++]=111; dst[p++]=116; dst[p++]=59; i++; continue; }
    if (c === 38) { dst[p++]=38; dst[p++]=97; dst[p++]=109; dst[p++]=112; dst[p++]=59; i++; continue; }
    if (c === 60) { dst[p++]=38; dst[p++]=108; dst[p++]=116; dst[p++]=59; i++; continue; }
    if (c === 62) { dst[p++]=38; dst[p++]=103; dst[p++]=116; dst[p++]=59; i++; continue; }
    break;
  }
  slab.pos = p;
  return i;
}

// Capacity already pre-ensured for the entire markdown file in mdSlab!
function writeInlineJSlab(s, start, end, linkCtx, slab) {
  let i = start;
  while (i < end) {
    i = scanInlineFast(s, i, end, slab);
    if (i >= end) break;
    const c = s.charCodeAt(i);
    if (c >= 128) {
      i = writeUtf8Char(s, i, end, slab);
      continue;
    }
    if (c === 42) {
      if (i + 1 < end && s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2, end);
        if (j > i + 2) {
          const d0 = slab.buf; let p0 = slab.pos;
          d0[p0++]=60; d0[p0++]=115; d0[p0++]=116; d0[p0++]=114; d0[p0++]=111; d0[p0++]=110; d0[p0++]=103; d0[p0++]=62;
          slab.pos = p0;
          const k = scanInlineFast(s, i + 2, j, slab);
          if (k < j) writeInlineJSlab(s, k, j, linkCtx, slab);
          const d1 = slab.buf; let p1 = slab.pos;
          d1[p1++]=60; d1[p1++]=47; d1[p1++]=115; d1[p1++]=116; d1[p1++]=114; d1[p1++]=111; d1[p1++]=110; d1[p1++]=103; d1[p1++]=62;
          slab.pos = p1;
          i = j + 2;
          continue;
        }
        const dst = slab.buf; dst[slab.pos++] = 42; dst[slab.pos++] = 42;
        i += 2;
        continue;
      }
      const j = findSingleStar(s, i + 1, end);
      if (j > i + 1) {
        const d0 = slab.buf; let p0 = slab.pos;
        d0[p0++]=60; d0[p0++]=101; d0[p0++]=109; d0[p0++]=62;
        slab.pos = p0;
        const k = scanInlineFast(s, i + 1, j, slab);
        if (k < j) writeInlineJSlab(s, k, j, linkCtx, slab);
        const d1 = slab.buf; let p1 = slab.pos;
        d1[p1++]=60; d1[p1++]=47; d1[p1++]=101; d1[p1++]=109; d1[p1++]=62;
        slab.pos = p1;
        i = j + 1;
        continue;
      }
      slab.buf[slab.pos++] = 42;
      i++;
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1 && j < end) {
        const d0 = slab.buf; let p0 = slab.pos;
        d0[p0++]=60; d0[p0++]=99; d0[p0++]=111; d0[p0++]=100; d0[p0++]=101; d0[p0++]=62;
        slab.pos = p0;
        writeHtmlJSlab(s, i + 1, j, slab);
        const d1 = slab.buf; let p1 = slab.pos;
        d1[p1++]=60; d1[p1++]=47; d1[p1++]=99; d1[p1++]=111; d1[p1++]=100; d1[p1++]=101; d1[p1++]=62;
        slab.pos = p1;
        i = j + 1;
        continue;
      }
      slab.buf[slab.pos++] = 96;
      i++;
      continue;
    }
    if (c === 91) {
      const k = findUnescaped(s, ']', i + 1, end);
      const m = k !== -1 && k + 1 < end && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      if (m !== -1 && m < end && m > k + 2) {
        const target = s.slice(k + 2, m);
        let aBuf = linkCtx.aBufMap.get(target);
        if (aBuf === undefined && !hasWhitespace(target)) {
          aBuf = resolveLinkATagBuf(linkCtx, target);
        }
        if (aBuf !== undefined) {
          slab.buf.set(aBuf, slab.pos);
          slab.pos += aBuf.length;
          writeInlineJSlab(s, i + 1, k, linkCtx, slab);
          const d1 = slab.buf; let p1 = slab.pos;
          d1[p1++]=60; d1[p1++]=47; d1[p1++]=97; d1[p1++]=62;
          slab.pos = p1;
          i = m + 1;
          continue;
        }
      }
      slab.buf[slab.pos++] = 91;
      i++;
      continue;
    }
    if (c === 92) {
      if (i + 1 < end) {
        const nc = s.charCodeAt(i + 1);
        if (nc < 128 && ESCAPABLE[nc]) {
          if (nc === 62) {
            const dst = slab.buf; let p = slab.pos;
            dst[p++]=38; dst[p++]=103; dst[p++]=116; dst[p++]=59;
            slab.pos = p;
          } else if (nc === 92) {
            const dst = slab.buf; let p = slab.pos;
            dst[p++]=92; dst[p++]=92;
            slab.pos = p;
          } else {
            slab.buf[slab.pos++] = nc;
          }
          i += 2;
          continue;
        }
      }
      const dst = slab.buf; let p = slab.pos;
      dst[p++]=92; dst[p++]=92;
      slab.pos = p;
      i++;
      continue;
    }
    slab.pos = writeJCtrlChar(c, slab.buf, slab.pos);
    i++;
  }
}

function renderMarkdownSlab(src, linkCtx, slugCache, ids, mdSlab) {
  const srcLen = src.length;
  if (mdSlab.pos + srcLen * 8 + 4096 > mdSlab.cap) growSlab(mdSlab, srcLen * 8 + 4096);
  if (ids.size > 0) ids.clear();
  const toc = [];
  const htmlStart = mdSlab.pos;
  let exStart = 0;
  let exEnd = 0;
  let hasExcerpt = false;
  let pos = 0;
  while (pos <= srcLen) {
    const nl = src.indexOf('\n', pos);
    const end = nl === -1 ? srcLen : nl;
    if (pos === end) { if (nl === -1) break; pos = nl + 1; continue; }
    const c0 = src.charCodeAt(pos);
    if ((c0 === 32 || c0 === 9) && isBlankSlice(src, pos + 1, end)) {
      if (nl === -1) break;
      pos = nl + 1;
      continue;
    }
    const nextPos = nl === -1 ? srcLen + 1 : nl + 1;
    if (c0 === 96) {
      const langEnd = fenceLangEnd(src, pos, end);
      if (langEnd !== -1) {
        if (langEnd === pos + 3) {
          writeSlabBuf(mdSlab, B_PRE_OPEN);
        } else {
          writeSlabBuf(mdSlab, B_PRE_LANG);
          writeHtmlJSlab(src, pos + 3, langEnd, mdSlab);
          writeSlabBuf(mdSlab, B_PRE_LANG_END);
        }
        pos = nextPos; const codeStart = pos; let closed = false, codeEnd = pos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos); const end2 = nl2 === -1 ? srcLen : nl2;
          if (isFenceCloseSlice(src, pos, end2)) { codeEnd = pos; pos = nl2 === -1 ? srcLen + 1 : nl2 + 1; closed = true; break; }
          pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
        }
        if (closed) {
          if (codeEnd > codeStart) writeHtmlJSlab(src, codeStart, codeEnd, mdSlab);
        } else if (codeStart <= srcLen) {
          writeHtmlJSlab(src, codeStart, srcLen, mdSlab);
          const d = mdSlab.buf; d[mdSlab.pos++] = 92; d[mdSlab.pos++] = 110;
        }
        writeSlabBuf(mdSlab, B_PRE_CLOSE);
        continue;
      }
    }
    if (c0 === 35) {
      let d = 0; const max = Math.min(end, pos + 6); while (pos + d < max && src.charCodeAt(pos + d) === 35) d++;
      if (d > 0 && pos + d < end) {
        const sp = src.charCodeAt(pos + d);
        if (sp === 32 || sp === 9) {
          let hs = pos + d + 1; while (hs < end && (src.charCodeAt(hs) === 32 || src.charCodeAt(hs) === 9)) hs++;
          let he = end; while (he > hs && (src.charCodeAt(he - 1) === 32 || src.charCodeAt(he - 1) === 9)) he--;
          if (hs < he) {
            const id = uniqueSlug(slugifyCached(slugCache, src.slice(hs, he)), ids);
            const buf = mdSlab.buf;
            let p = mdSlab.pos;
            buf[p++]=60; buf[p++]=104; buf[p++]=48+d; buf[p++]=32; buf[p++]=105; buf[p++]=100; buf[p++]=61; buf[p++]=92; buf[p++]=34;
            mdSlab.pos = p;
            writeRawStr(id, mdSlab);
            p = mdSlab.pos;
            buf[p++]=92; buf[p++]=34; buf[p++]=62;
            mdSlab.pos = p;
            const hStart = p;
            writeInlineJSlab(src, hs, he, linkCtx, mdSlab);
            const hEnd = mdSlab.pos;
            p = hEnd;
            buf[p++]=60; buf[p++]=47; buf[p++]=104; buf[p++]=48+d; buf[p++]=62; buf[p++]=92; buf[p++]=110;
            mdSlab.pos = p;
            if (d === 2 || d === 3) toc.push({ level: d, id, htmlStart: hStart, htmlEnd: hEnd });
            pos = nextPos; continue;
          }
        }
      }
    }
    if (c0 === 45 || c0 === 42) {
      if (isHrSlice(src, pos, end, c0)) {
        const d = mdSlab.buf; let p = mdSlab.pos;
        d[p++]=60; d[p++]=104; d[p++]=114; d[p++]=62; d[p++]=92; d[p++]=110;
        mdSlab.pos = p;
        pos = nextPos; continue;
      }
      if (pos + 1 < end && src.charCodeAt(pos + 1) === 32) {
        const d = mdSlab.buf; let p = mdSlab.pos;
        d[p++]=60; d[p++]=117; d[p++]=108; d[p++]=62; d[p++]=92; d[p++]=110;
        mdSlab.pos = p;
        let curStart = pos + 2; while (curStart < end && (src.charCodeAt(curStart) === 32 || src.charCodeAt(curStart) === 9)) curStart++;
        let curEnd = end; while (curEnd > curStart && (src.charCodeAt(curEnd - 1) === 32 || src.charCodeAt(curEnd - 1) === 9)) curEnd--;
        let curItem = null; pos = nextPos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos); const end2 = nl2 === -1 ? srcLen : nl2;
          if (isBulletSlice(src, pos, end2)) {
            let dp = mdSlab.pos;
            d[dp++]=60; d[dp++]=108; d[dp++]=105; d[dp++]=62;
            mdSlab.pos = dp;
            if (curItem === null) writeInlineJSlab(src, curStart, curEnd, linkCtx, mdSlab);
            else writeInlineJSlab(curItem, 0, curItem.length, linkCtx, mdSlab);
            dp = mdSlab.pos;
            d[dp++]=60; d[dp++]=47; d[dp++]=108; d[dp++]=105; d[dp++]=62; d[dp++]=92; d[dp++]=110;
            mdSlab.pos = dp;
            curStart = pos + 2; while (curStart < end2 && (src.charCodeAt(curStart) === 32 || src.charCodeAt(curStart) === 9)) curStart++;
            curEnd = end2; while (curEnd > curStart && (src.charCodeAt(curEnd - 1) === 32 || src.charCodeAt(curEnd - 1) === 9)) curEnd--;
            curItem = null; pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else if (isContinuedSlice(src, pos, end2)) {
            if (curItem === null) curItem = src.slice(curStart, curEnd);
            curItem += `\n${trimSlice(src, pos, end2)}`; pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else break;
        }
        let dp = mdSlab.pos;
        d[dp++]=60; d[dp++]=108; d[dp++]=105; d[dp++]=62;
        mdSlab.pos = dp;
        if (curItem === null) writeInlineJSlab(src, curStart, curEnd, linkCtx, mdSlab);
        else writeInlineJSlab(curItem, 0, curItem.length, linkCtx, mdSlab);
        dp = mdSlab.pos;
        d[dp++]=60; d[dp++]=47; d[dp++]=108; d[dp++]=105; d[dp++]=62; d[dp++]=92; d[dp++]=110;
        d[dp++]=60; d[dp++]=47; d[dp++]=117; d[dp++]=108; d[dp++]=62; d[dp++]=92; d[dp++]=110;
        mdSlab.pos = dp;
        continue;
      }
    }
    if (c0 === 62) {
      let qText = ''; let first = true;
      const s0 = pos + (pos + 1 < end && src.charCodeAt(pos + 1) === 32 ? 2 : 1);
      const t0 = trimSlice(src, s0, end); if (t0 !== '') { qText = t0; first = false; }
      pos = nextPos;
      while (pos < srcLen && src.charCodeAt(pos) === 62) {
        const nl2 = src.indexOf('\n', pos); const end2 = nl2 === -1 ? srcLen : nl2;
        const s2 = pos + (pos + 1 < end2 && src.charCodeAt(pos + 1) === 32 ? 2 : 1);
        const t2 = trimSlice(src, s2, end2); if (t2 !== '') { qText = first ? t2 : `${qText}\n${t2}`; first = false; }
        pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
      }
      if (first) {
        writeSlabBuf(mdSlab, B_BQ_EMPTY);
      } else {
        writeSlabBuf(mdSlab, B_BQ_OPEN);
        writeInlineJSlab(qText, 0, qText.length, linkCtx, mdSlab);
        writeSlabBuf(mdSlab, B_BQ_CLOSE);
      }
      continue;
    }
    if (c0 >= 48 && c0 <= 57) {
      const contentPos = orderedStartSlice(src, pos, end);
      if (contentPos !== -1) {
        const start = contentPos - 2 === pos + 1 ? c0 - 48 : Number(src.slice(pos, contentPos - 2));
        const d = mdSlab.buf;
        if (start !== 1) writeRawStr(`<ol start=\\"${start}\\">\\n`, mdSlab);
        else {
          let dp = mdSlab.pos;
          d[dp++]=60; d[dp++]=111; d[dp++]=108; d[dp++]=62; d[dp++]=92; d[dp++]=110;
          mdSlab.pos = dp;
        }
        let curStart = contentPos; while (curStart < end && (src.charCodeAt(curStart) === 32 || src.charCodeAt(curStart) === 9)) curStart++;
        let curEnd = end; while (curEnd > curStart && (src.charCodeAt(curEnd - 1) === 32 || src.charCodeAt(curEnd - 1) === 9)) curEnd--;
        let curItem = null; pos = nextPos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos); const end2 = nl2 === -1 ? srcLen : nl2;
          const cPos2 = orderedStartSlice(src, pos, end2);
          if (cPos2 !== -1) {
            let dp = mdSlab.pos;
            d[dp++]=60; d[dp++]=108; d[dp++]=105; d[dp++]=62;
            mdSlab.pos = dp;
            if (curItem === null) writeInlineJSlab(src, curStart, curEnd, linkCtx, mdSlab);
            else writeInlineJSlab(curItem, 0, curItem.length, linkCtx, mdSlab);
            dp = mdSlab.pos;
            d[dp++]=60; d[dp++]=47; d[dp++]=108; d[dp++]=105; d[dp++]=62; d[dp++]=92; d[dp++]=110;
            mdSlab.pos = dp;
            curStart = cPos2; while (curStart < end2 && (src.charCodeAt(curStart) === 32 || src.charCodeAt(curStart) === 9)) curStart++;
            curEnd = end2; while (curEnd > curStart && (src.charCodeAt(curEnd - 1) === 32 || src.charCodeAt(curEnd - 1) === 9)) curEnd--;
            curItem = null; pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else if (isContinuedSlice(src, pos, end2)) {
            if (curItem === null) curItem = src.slice(curStart, curEnd);
            curItem += `\n${trimSlice(src, pos, end2)}`; pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else break;
        }
        let dp = mdSlab.pos;
        d[dp++]=60; d[dp++]=108; d[dp++]=105; d[dp++]=62;
        mdSlab.pos = dp;
        if (curItem === null) writeInlineJSlab(src, curStart, curEnd, linkCtx, mdSlab);
        else writeInlineJSlab(curItem, 0, curItem.length, linkCtx, mdSlab);
        dp = mdSlab.pos;
        d[dp++]=60; d[dp++]=47; d[dp++]=108; d[dp++]=105; d[dp++]=62; d[dp++]=92; d[dp++]=110;
        d[dp++]=60; d[dp++]=47; d[dp++]=111; d[dp++]=108; d[dp++]=62; d[dp++]=92; d[dp++]=110;
        mdSlab.pos = dp;
        continue;
      }
    }
    let pStart = pos;
    let pLastEnd = end;
    let p0Trimmed = false;
    if (pStart < pLastEnd && (c0 === 32 || c0 === 9)) {
      p0Trimmed = true;
      while (pStart < pLastEnd && (src.charCodeAt(pStart) === 32 || src.charCodeAt(pStart) === 9)) pStart++;
    }
    if (pLastEnd > pStart && (src.charCodeAt(pLastEnd - 1) === 32 || src.charCodeAt(pLastEnd - 1) === 9)) {
      p0Trimmed = true;
      while (pLastEnd > pStart && (src.charCodeAt(pLastEnd - 1) === 32 || src.charCodeAt(pLastEnd - 1) === 9)) pLastEnd--;
    }
    let pLines = null;
    pos = nextPos;
    while (pos <= srcLen) {
      const nl2 = src.indexOf('\n', pos);
      const end2 = nl2 === -1 ? srcLen : nl2;
      if (pos === end2) break;
      const lc = src.charCodeAt(pos);
      if (lc < 128 && PARA_STOP[lc]) {
        if (lc === 32 || lc === 9) { if (isBlankSlice(src, pos, end2)) break; }
        else if (lc === 96) { if (fenceLangEnd(src, pos, end2) !== -1) break; }
        else if (lc === 35) { if (headingDepthSlice(src, pos, end2) !== 0) break; }
        else if (isHrSlice(src, pos, end2, lc)) break;
      }
      const needTrim = lc === 32 || lc === 9 || src.charCodeAt(end2 - 1) === 32 || src.charCodeAt(end2 - 1) === 9;
      if (pLines === null) {
        if (p0Trimmed || needTrim) pLines = [src.slice(pStart, pLastEnd), needTrim ? trimSlice(src, pos, end2) : src.slice(pos, end2)];
        else pLastEnd = end2;
      } else {
        pLines.push(needTrim ? trimSlice(src, pos, end2) : src.slice(pos, end2));
      }
      pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
    }
    const d = mdSlab.buf;
    let dp = mdSlab.pos;
    d[dp++]=60; d[dp++]=112; d[dp++]=62;
    mdSlab.pos = dp;
    const pEx0 = dp;
    if (pLines === null) {
      writeInlineJSlab(src, pStart, pLastEnd, linkCtx, mdSlab);
    } else {
      const t = pLines.join('\n');
      writeInlineJSlab(t, 0, t.length, linkCtx, mdSlab);
    }
    const pEx1 = mdSlab.pos;
    if (!hasExcerpt) {
      hasExcerpt = true;
      exStart = pEx0;
      exEnd = pEx1;
    }
    dp = pEx1;
    d[dp++]=60; d[dp++]=47; d[dp++]=112; d[dp++]=62; d[dp++]=92; d[dp++]=110;
    mdSlab.pos = dp;
  }
  return { htmlStart, htmlEnd: mdSlab.pos, exStart, exEnd, toc };
}

function compileTemplateBodySlab(flat, extraVars, itemCaches, dynRoots, isItem, safeUrls, cardSlab) {
  if (flat.length === 0) return () => {};
  if (flat.length === 1 && flat[0].kind === 'text') {
    const b = Buffer.from(flat[0].text, 'utf8');
    return (_v, _slab) => writeSlabBuf(_slab, b);
  }
  let vid = 0;
  const lines = [];
  const scopeStack = isItem ? [{ itemName: isItem, itemVar: '_item', idxVar: null, lenVar: null, loopVar: 'undefined' }] : [];
  const cacheRefs = [];
  const bufs = [];
  const bufMap = new Map();
  const escCache = new Map();
  const escDecl = [];

  function internBuf(str) {
    let idx = bufMap.get(str);
    if (idx === undefined) {
      idx = bufs.length;
      bufs.push(Buffer.from(str, 'utf8'));
      bufMap.set(str, idx);
    }
    return `_b${idx}`;
  }

  function resolveExpr(path) {
    const rootName = path[0];
    if (rootName === 'loop' && path.length === 2) {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        const frame = scopeStack[i];
        if (frame.idxVar !== null) {
          const p = path[1];
          if (p === 'index') return `(${frame.idxVar}+1)`;
          if (p === 'first') return `(${frame.idxVar}===0)`;
          if (p === 'last') return `(${frame.idxVar}===${frame.lenVar}-1)`;
          if (p === 'length') return frame.lenVar;
        }
        break;
      }
    }
    let base = null;
    let isKnownObj = false;
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const frame = scopeStack[i];
      if (rootName === 'loop') {
        base = frame.loopVar;
        isKnownObj = true;
        break;
      }
      if (frame.itemName === rootName) {
        base = frame.itemVar;
        isKnownObj = true;
        break;
      }
    }
    if (base === null) {
      if (isItem) {
        base = `_stat.${rootName}`;
      } else {
        base = `vars.${rootName}`;
        if (rootName === 'site' || (dynRoots !== null && dynRoots.has(rootName) && rootName !== 'posts')) isKnownObj = true;
      }
    }
    let expr = base;
    for (let k = 1; k < path.length; k++) {
      const prop = path[k];
      if (k === 1 && isKnownObj) {
        expr = `${expr}.${prop}`;
      } else if (k === 2 && !isItem && rootName === 'page' && (path[1] === 'newer' || path[1] === 'older') && !(prop in PROTO_KEYS)) {
        const tmp = `_t${vid++}`;
        expr = `((${tmp}=${expr})!==null?${tmp}.${prop}:undefined)`;
      } else if (!(prop in PROTO_KEYS)) {
        const tmp = `_t${vid++}`;
        expr = `((${tmp}=${expr})!==null&&typeof ${tmp}==='object'&&!Array.isArray(${tmp})?${tmp}.${prop}:undefined)`;
      } else {
        const tmp = `_t${vid++}`;
        expr = `((${tmp}=${expr})!==null&&typeof ${tmp}==='object'&&(!Array.isArray(${tmp})||_has(${tmp},${JSON.stringify(prop)}))?${tmp}.${prop}:undefined)`;
      }
    }
    return expr;
  }

  function resolveRawSlice(path) {
    if (path.length !== 2) return null;
    const r = path[0], f = path[1];
    if (!isItem && r === 'page' && (f === 'content' || f === 'excerpt')) {
      return f === 'content' ? ['vars.page.htmlStart', 'vars.page.htmlEnd'] : ['vars.page.exStart', 'vars.page.exEnd'];
    }
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const frame = scopeStack[i];
      if (frame.itemName === r) {
        if (f === 'excerpt') return [`${frame.itemVar}.exStart`, `${frame.itemVar}.exEnd`];
        if (f === 'html') return [`${frame.itemVar}.htmlStart`, `${frame.itemVar}.htmlEnd`];
        break;
      }
    }
    return null;
  }

  function emit(list) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.kind === 'text') {
        if (n.text !== '') lines.push(`_wB(_slab,${internBuf(n.text)});`);
      } else if (n.kind === 'var') {
        const p = n.path;
        let isSafe = false;
        if (p.length === 2) {
          const r = p[0], f = p[1];
          if (r === 'loop' && (f === 'index' || f === 'length')) isSafe = true;
          else if (!isItem && dynRoots !== null && dynRoots.has(r)) {
            if (r === 'page' && (f === 'reading_minutes' || f === 'date' || f === 'date_long' || f === 'slug')) isSafe = true;
            else if (r === 'h' && f === 'id') isSafe = true;
            else if (safeUrls && (f === 'url' || f === 'newer_url' || f === 'older_url')) isSafe = true;
            else if (r === 'pager' && (f === 'number' || f === 'total')) isSafe = true;
            else if (r === 'tag' && (f === 'count' || f === 'slug')) isSafe = true;
          }
        }
        if (isSafe) {
          lines.push(`_wA(${resolveExpr(p)},_slab);`);
        } else if (!isItem && scopeStack.length === 0 && p.length === 2 && p[0] === 'page' && p[1] === 'title') {
          let v = escCache.get('page.title');
          if (v === undefined) {
            v = `_e${vid++}`;
            escCache.set('page.title', v);
            escDecl.push(`const ${v}=_mkEsc(vars.page.title);`);
          }
          lines.push(`_wB(_slab,${v});`);
        } else {
          lines.push(`_esc(${resolveExpr(p)},_slab);`);
        }
      } else if (n.kind === 'raw') {
        const p = n.path;
        const slice = resolveRawSlice(p);
        if (slice !== null) {
          lines.push(`_wS(_slab,_md,${slice[0]},${slice[1]});`);
        } else {
          lines.push(`_txt(${resolveExpr(p)},_slab);`);
        }
      } else if (n.kind === 'if') {
        const np = n.path;
        let cond;
        if (np.length === 2 && !isItem) {
          const r = np[0], f = np[1];
          if ((r === 'page' && (f === 'tags' || f === 'toc')) || (r === 'tag' && f === 'posts') || (r === 'p' && f === 'tags')) cond = `(${resolveExpr(np)}.length>0)`;
          else if ((r === 'page' && (f === 'date' || f === 'summary')) || (r === 'pager' && (f === 'newer_url' || f === 'older_url')) || (r === 't' && f === 'url') || (r === 'p' && f === 'summary')) cond = `(${resolveExpr(np)}!=="")`;
          else if (r === 'page' && (f === 'newer' || f === 'older')) cond = `(${resolveExpr(np)}!==null)`;
          else cond = `_tru(${resolveExpr(np)})`;
        } else {
          cond = `_tru(${resolveExpr(np)})`;
        }
        lines.push(`if(${n.not ? '!' + cond : cond}){`);
        emit(n.then);
        if (n.else !== null && n.else.length > 0) {
          lines.push('}else{');
          emit(n.else);
        }
        lines.push('}');
      } else if (n.kind === 'for') {
        const arrVar = `_a${vid++}`;
        const lenVar = `_n${vid++}`;
        const idxVar = `_k${vid++}`;
        const itemVar = `_x${vid++}`;
        const onlyItem = (n.path.length !== 2 || n.path[1] !== 'toc') && !isItem && scopeStack.length === 0 && !bodyUsesLoop(n.body) && (() => {
          const b = new Set([n.name]);
          return isStaticNodeList(n.body, b, dynRoots);
        })();
        if (onlyItem) {
          const key = n.name + ':' + JSON.stringify(n.body);
          let entry = itemCaches.get(key);
          if (entry === undefined) {
            const subFn = compileTemplateBodySlab(n.body, extraVars, null, null, n.name, safeUrls, cardSlab);
            entry = { cache: new Map(), fn: subFn, cardSlab };
            itemCaches.set(key, entry);
          }
          const cid = cacheRefs.length;
          cacheRefs.push(entry);
          lines.push(`const ${arrVar}=${resolveExpr(n.path)};`);
          lines.push(`if(Array.isArray(${arrVar})){`);
          lines.push(`const ${lenVar}=${arrVar}.length;`);
          lines.push(`const _c${cid}=_caches[${cid}].cache,_f${cid}=_caches[${cid}].fn,_cs${cid}=_caches[${cid}].cardSlab;`);
          lines.push(`for(let ${idxVar}=0;${idxVar}<${lenVar};${idxVar}++){`);
          lines.push(`const ${itemVar}=${arrVar}[${idxVar}];`);
          lines.push(`let _r${cid}=_c${cid}.get(${itemVar});`);
          lines.push(`if(_r${cid}===undefined){const _s0=_cs${cid}.pos;_f${cid}(${itemVar},_cs${cid},_md);_r${cid}=_s0*16777216+_cs${cid}.pos;_c${cid}.set(${itemVar},_r${cid});}`);
          lines.push(`const _e${cid}=_r${cid}%16777216;const _s${cid}=(_r${cid}-_e${cid})/16777216;_wS(_slab,_cs${cid}.buf,_s${cid},_e${cid});`);
          lines.push('}}');
        } else {
          const needBareLoop = bodyUsesBareLoop(n.body);
          const loopVar = needBareLoop ? `_l${vid++}` : 'undefined';
          lines.push(`const ${arrVar}=${resolveExpr(n.path)};`);
          lines.push(`if(Array.isArray(${arrVar})){`);
          lines.push(`const ${lenVar}=${arrVar}.length;`);
          lines.push(`for(let ${idxVar}=0;${idxVar}<${lenVar};${idxVar}++){`);
          lines.push(`const ${itemVar}=${arrVar}[${idxVar}];`);
          if (needBareLoop) {
            lines.push(`const ${loopVar}={index:${idxVar}+1,first:${idxVar}===0,last:${idxVar}===${lenVar}-1,length:${lenVar}};`);
          }
          scopeStack.push({ itemName: n.name, itemVar, idxVar, lenVar, loopVar });
          emit(n.body);
          scopeStack.pop();
          lines.push('}}');
        }
      }
    }
  }

  emit(flat);
  if (escDecl.length > 0) lines.unshift(...escDecl);
  const bufDecls = bufs.map((_, idx) => `const _b${idx}=_bufs[${idx}];`).join('');
  if (isItem) {
    const factory = new Function('_stat', '_bufs', '_wB', '_wS', '_wA', '_esc', '_txt', '_tru', '_has', `${bufDecls}return function(_item,_slab,_md){\n${lines.join('\n')}\n};`);
    return factory(extraVars, bufs, writeSlabBuf, writeSlabSlice, writeAsciiOrVal, writeEscTextValSlab, writeRawTextValSlab, truthy, Object.hasOwn);
  }
  const titleSlab = makeSlab(4096);
  const mkEsc = (s) => {
    titleSlab.pos = 0;
    writeEscTextValSlab(s, titleSlab);
    return titleSlab.buf.subarray(0, titleSlab.pos);
  };
  const factory = new Function('_bufs', '_wB', '_wS', '_wA', '_esc', '_txt', '_tru', '_has', '_caches', '_mkEsc', `${bufDecls}return function(vars,_slab,_md){\n${lines.join('\n')}\n};`);
  return factory(bufs, writeSlabBuf, writeSlabSlice, writeAsciiOrVal, writeEscTextValSlab, writeRawTextValSlab, truthy, Object.hasOwn, cacheRefs, mkEsc);
}

const B_OPEN_BRACE = Buffer.from('{');
const B_CLOSE_BRACE = Buffer.from('}');
const B_QUOTE_CLOSE = Buffer.from('"}');
const B_KEY_SEP_FIRST = Buffer.from('"');
const B_KEY_SEP_NEXT = Buffer.from('","');
const B_KEY_COLON_QUOTE = Buffer.from('":"');
const B_TAGS_INDEX_HTML = Buffer.from('tags/index.html');
const B_REPORT_FILE = Buffer.from(REPORT_FILE);

function slugifyCached(slugCache, text) {
  let s = slugCache.get(text);
  if (s === undefined) {
    s = slugifyRaw(text);
    slugCache.set(text, s);
  }
  return s;
}

function cachedLongDateFrom(dateCache, d) {
  let dl = dateCache.get(d);
  if (dl === undefined) {
    dl = longDate(d);
    dateCache.set(d, dl);
  }
  return dl;
}

function linkOfCached(dateCache, s) {
  if (s === null) return null;
  if (s.link !== undefined) return s.link;
  const dl = s.dateLong ?? (s.data.date === undefined ? '' : cachedLongDateFrom(dateCache, s.data.date));
  s.link = {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: dl,
  };
  return s.link;
}

function runCoreSlab(input, outSlab, mdSlab, cardSlab) {
  mdSlab.pos = 0;
  cardSlab.pos = 0;

  const slugCache = new Map();
  const templates = new Map();
  const report = [];
  const tplNames = Object.keys(input.templates).sort(byCodeUnits);
  for (let i = 0; i < tplNames.length; i++) {
    const name = tplNames[i];
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  let safeUrls = !ESCJ_TEST.test(base);
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));

  const sources = [];
  const statics = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.path.endsWith('.md')) {
      const content = f.content.includes('\r') ? f.content.replace(/\r\n?/g, '\n') : f.content;
      sources.push({ path: f.path, text: content });
    } else {
      statics.push({ path: f.path, content: f.content });
    }
  }

  const kept = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const fmErr = parseFrontMatter(s.text);
    if (fmErr !== null) {
      report.push(`refused ${s.path}: ${fmErr}`);
      continue;
    }
    s.data = fmData;
    s.body = fmBody;
    const post = s.path.startsWith('posts/');
    s.post = post;
    if (!post) {
      if (s.path.startsWith('tags/')) {
        report.push(`refused ${s.path}: tags/ is the generator's own`);
        continue;
      }
      if (s.path.startsWith('page/')) {
        report.push(`refused ${s.path}: page/ is the generator's own`);
        continue;
      }
    }
    if (post && s.data.date === undefined) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  const taken = new Map();
  const bySource = new Map();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (safeUrls && dir !== '' && ESCJ_TEST.test(dir)) safeUrls = false;
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : undefined);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugifyCached(slugCache, s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  const staticPaths = new Set();
  for (let i = 0; i < statics.length; i++) staticPaths.add(statics[i].path);
  const broken = new Set();
  const dirPartsCache = new Map();
  const urlCaches = new Map();
  const aBufCaches = new Map();
  const emptyParts = [];
  const linkCtx = { srcPath: '', dir: '', dirParts: emptyParts, bySource, staticPaths, base, broken, relCache: new Map(), urlMap: null, aBufMap: null, extMap: new Map(), safeUrls };
  const mdIds = new Set();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = dirOf(s.path);
    let dirParts = dir === '' ? emptyParts : dirPartsCache.get(dir);
    if (dirParts === undefined) {
      dirParts = dir.split('/');
      dirPartsCache.set(dir, dirParts);
    }
    let urlMap = urlCaches.get(dir);
    if (urlMap === undefined) {
      urlMap = new Map();
      urlCaches.set(dir, urlMap);
    }
    let aBufMap = aBufCaches.get(dir);
    if (aBufMap === undefined) {
      aBufMap = new Map();
      aBufCaches.set(dir, aBufMap);
    }
    linkCtx.srcPath = s.path;
    linkCtx.dir = dir;
    linkCtx.dirParts = dirParts;
    linkCtx.urlMap = urlMap;
    linkCtx.aBufMap = aBufMap;
    const md = renderMarkdownSlab(s.body, linkCtx, slugCache, mdIds, mdSlab);
    s.htmlStart = md.htmlStart;
    s.htmlEnd = md.htmlEnd;
    s.exStart = md.exStart;
    s.exEnd = md.exEnd;
    s.toc = md.toc;
  }

  const posts = [];
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].post) posts.push(kept[i]);
  }
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  const bySlug = new Map();
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const rawTags = p.data.tags;
    if (rawTags === undefined || rawTags.length === 0) {
      p.tagRefs = [];
      continue;
    }
    const refs = [];
    const seen = new Set();
    for (let j = 0; j < rawTags.length; j++) {
      const name = rawTags[j];
      const slug = slugifyCached(slugCache, name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        const url = `${base}/tags/${slug}/`;
        tag = { name, slug, url, posts: [], pub: { name, slug, url } };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      refs.push(tag.pub);
    }
    p.tagRefs = refs;
  }
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    if (!s.post) {
      const rawTags = s.data.tags;
      if (rawTags === undefined || rawTags.length === 0) {
        s.tagRefs = [];
        continue;
      }
      const refs = [];
      const seen = new Set();
      for (let j = 0; j < rawTags.length; j++) {
        const name = rawTags[j];
        const slug = slugifyCached(slugCache, name);
        if (seen.has(slug)) continue;
        seen.add(slug);
        const existing = bySlug.get(slug);
        refs.push(existing !== undefined ? existing.pub : { name, slug, url: '' });
      }
      s.tagRefs = refs;
    }
  }
  const tagsList = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const dateCache = new Map();
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const dl = p.data.date === undefined ? '' : cachedLongDateFrom(dateCache, p.data.date);
    p.dateLong = dl;
    p.card = {
      title: p.data.title,
      url: p.url,
      date: p.data.date ?? '',
      date_long: dl,
      summary: p.data.summary ?? '',
      exStart: p.exStart,
      exEnd: p.exEnd,
      excerpt: '',
      reading_minutes: Math.max(1, Math.ceil(wordsOf(p.body) / 200)),
      tags: p.tagRefs,
    };
  }

  const site = { title: input.site.title, base_url: base };
  const allTags = tagsList.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recentCount = Math.min(input.site.recent, posts.length);
  const recent = new Array(recentCount);
  for (let i = 0; i < recentCount; i++) {
    const c = posts[i].card;
    c.excerpt = mdSlab.buf.toString('utf8', c.exStart, c.exEnd);
    recent[i] = c;
  }

  const staticEnv = { site, tags: allTags, recent };
  const DYN_BY_KIND = {
    page: new Set(['page']),
    index: new Set(['posts', 'pager']),
    tag: new Set(['tag']),
    tags: new Set(),
  };
  const TRUTHY_BY_KIND = {
    page: new Set(['page']),
    index: new Set(['pager']),
    tag: new Set(['tag']),
    tags: new Set(),
  };
  const emptyBound = new Set();
  const itemCaches = new Map();
  const compiled = new Map();
  const getRenderer = (kind, name) => {
    const key = `${kind}:${name}`;
    let r = compiled.get(key);
    if (r === undefined) {
      const nodes = templates.get(name);
      if (nodes === undefined) return null;
      const inlined = [];
      inlineAst(nodes, 0, templates, inlined);
      const folded = [];
      const dyn = DYN_BY_KIND[kind];
      const tru = TRUTHY_BY_KIND[kind];
      foldAst(inlined, staticEnv, emptyBound, dyn, tru, folded);
      const fn = compileTemplateBodySlab(folded, staticEnv, itemCaches, dyn, null, safeUrls, cardSlab);
      r = { fn, needsRm: astUsesProp(folded, 'reading_minutes') };
      compiled.set(key, r);
    }
    return r;
  };

  writeSlabBuf(outSlab, B_OPEN_BRACE);
  let hasEntry = false;
  const outKeys = new Set();

  const pageObj = {
    title: '',
    url: '',
    date: '',
    date_long: '',
    summary: '',
    htmlStart: 0,
    htmlEnd: 0,
    exStart: 0,
    exEnd: 0,
    reading_minutes: 0,
    tags: null,
    slug: '',
    toc: null,
    newer: null,
    older: null,
    is_post: false,
  };
  const pageVars = { site, tags: allTags, recent, page: pageObj };
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const rObj = getRenderer('page', s.layout);
    const renderer = rObj.fn;
    const needsRm = rObj.needsRm;
    if (s.post) {
      const card = s.card;
      pageObj.title = card.title;
      pageObj.url = card.url;
      pageObj.date = card.date;
      pageObj.date_long = card.date_long;
      pageObj.summary = card.summary;
      pageObj.exStart = card.exStart;
      pageObj.exEnd = card.exEnd;
      pageObj.htmlStart = s.htmlStart;
      pageObj.htmlEnd = s.htmlEnd;
      pageObj.reading_minutes = card.reading_minutes;
      pageObj.tags = card.tags;
      pageObj.slug = s.slug;
      pageObj.toc = s.toc;
      pageObj.newer = linkOfCached(dateCache, s.newer ?? null);
      pageObj.older = linkOfCached(dateCache, s.older ?? null);
      pageObj.is_post = true;
    } else {
      pageObj.title = s.data.title;
      pageObj.url = s.url;
      pageObj.date = s.data.date ?? '';
      pageObj.date_long = s.data.date === undefined ? '' : cachedLongDateFrom(dateCache, s.data.date);
      pageObj.summary = s.data.summary ?? '';
      pageObj.exStart = s.exStart;
      pageObj.exEnd = s.exEnd;
      pageObj.htmlStart = s.htmlStart;
      pageObj.htmlEnd = s.htmlEnd;
      pageObj.reading_minutes = needsRm ? Math.max(1, Math.ceil(wordsOf(s.body) / 200)) : 0;
      pageObj.tags = s.tagRefs;
      pageObj.slug = s.slug;
      pageObj.toc = s.toc;
      pageObj.newer = null;
      pageObj.older = null;
      pageObj.is_post = false;
    }
    const key = `${s.outDir}/index.html`;
    outKeys.add(key);
    writeSlabBuf(outSlab, hasEntry ? B_KEY_SEP_NEXT : B_KEY_SEP_FIRST);
    hasEntry = true;
    writeJStrSlab(key, 0, key.length, outSlab);
    writeSlabBuf(outSlab, B_KEY_COLON_QUOTE);
    renderer(pageVars, outSlab, mdSlab.buf);
  }

  const indexRenderer = getRenderer('index', 'index')?.fn ?? null;
  if (indexRenderer !== null) {
    const per = input.site.per_page;
    const pages = Math.max(1, Math.ceil(posts.length / per));
    const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
    const pagerObj = { number: 0, total: pages, url: '', newer_url: '', older_url: '' };
    const indexVars = { site, tags: allTags, recent, posts: null, pager: pagerObj };
    for (let k = 1; k <= pages; k++) {
      const start = (k - 1) * per;
      const end = Math.min(k * per, posts.length);
      const pagePosts = new Array(Math.max(0, end - start));
      for (let i = start; i < end; i++) pagePosts[i - start] = posts[i].card;
      pagerObj.number = k;
      pagerObj.url = indexUrl(k);
      pagerObj.newer_url = k === 1 ? '' : indexUrl(k - 1);
      pagerObj.older_url = k === pages ? '' : indexUrl(k + 1);
      indexVars.posts = pagePosts;
      const key = k === 1 ? 'index.html' : `page/${k}/index.html`;
      outKeys.add(key);
      writeSlabBuf(outSlab, hasEntry ? B_KEY_SEP_NEXT : B_KEY_SEP_FIRST);
      hasEntry = true;
      writeJStrSlab(key, 0, key.length, outSlab);
      writeSlabBuf(outSlab, B_KEY_COLON_QUOTE);
      indexRenderer(indexVars, outSlab, mdSlab.buf);
    }
  }

  const tagRenderer = getRenderer('tag', 'tag')?.fn ?? null;
  if (tagRenderer !== null) {
    const tagObj = { name: '', slug: '', url: '', count: 0, posts: null };
    const tagVars = { site, tags: allTags, recent, tag: tagObj };
    for (let i = 0; i < tagsList.length; i++) {
      const t = tagsList[i];
      const tPosts = new Array(t.posts.length);
      for (let j = 0; j < t.posts.length; j++) tPosts[j] = t.posts[j].card;
      tagObj.name = t.name;
      tagObj.slug = t.slug;
      tagObj.url = t.url;
      tagObj.count = t.posts.length;
      tagObj.posts = tPosts;
      const key = `tags/${t.slug}/index.html`;
      outKeys.add(key);
      writeSlabBuf(outSlab, hasEntry ? B_KEY_SEP_NEXT : B_KEY_SEP_FIRST);
      hasEntry = true;
      writeJStrSlab(key, 0, key.length, outSlab);
      writeSlabBuf(outSlab, B_KEY_COLON_QUOTE);
      tagRenderer(tagVars, outSlab, mdSlab.buf);
    }
  }

  const tagsRenderer = getRenderer('tags', 'tags')?.fn ?? null;
  if (tagsRenderer !== null) {
    outKeys.add('tags/index.html');
    writeSlabBuf(outSlab, hasEntry ? B_KEY_SEP_NEXT : B_KEY_SEP_FIRST);
    hasEntry = true;
    writeSlabBuf(outSlab, B_TAGS_INDEX_HTML);
    writeSlabBuf(outSlab, B_KEY_COLON_QUOTE);
    tagsRenderer({ site, tags: allTags, recent }, outSlab, mdSlab.buf);
  }

  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (outKeys.has(f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else {
      outKeys.add(f.path);
      writeSlabBuf(outSlab, hasEntry ? B_KEY_SEP_NEXT : B_KEY_SEP_FIRST);
      hasEntry = true;
      writeJStrSlab(f.path, 0, f.path.length, outSlab);
      writeSlabBuf(outSlab, B_KEY_COLON_QUOTE);
      writeJStrSlab(f.content, 0, f.content.length, outSlab);
    }
  }

  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.length - posts.length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tagsList.length} tags and ${statics.length} static files`);
  outKeys.add(REPORT_FILE);
  writeSlabBuf(outSlab, hasEntry ? B_KEY_SEP_NEXT : B_KEY_SEP_FIRST);
  hasEntry = true;
  writeSlabBuf(outSlab, B_REPORT_FILE);
  writeSlabBuf(outSlab, B_KEY_COLON_QUOTE);
  const reportText = `${lines.join('\n')}\n`;
  writeJStrSlab(reportText, 0, reportText.length, outSlab);

  writeSlabBuf(outSlab, hasEntry ? B_QUOTE_CLOSE : B_CLOSE_BRACE);
}

const B_ARR_OPEN = Buffer.from('[');
const B_ARR_COMMA = Buffer.from(',');
const B_ARR_CLOSE = Buffer.from(']');

export function solveCasesToBuffer(cases) {
  const outSlab = makeSlab(10 * 1024 * 1024);
  const mdSlab = makeSlab(2 * 1024 * 1024);
  const cardSlab = makeSlab(256 * 1024);
  writeSlabBuf(outSlab, B_ARR_OPEN);
  for (let i = 0; i < cases.length; i++) {
    if (i > 0) writeSlabBuf(outSlab, B_ARR_COMMA);
    runCoreSlab(cases[i].input, outSlab, mdSlab, cardSlab);
  }
  writeSlabBuf(outSlab, B_ARR_CLOSE);
  return outSlab.buf.subarray(0, outSlab.pos);
}

export function run(input) {
  const outSlab = makeSlab(4 * 1024 * 1024);
  const mdSlab = makeSlab(2 * 1024 * 1024);
  const cardSlab = makeSlab(256 * 1024);
  runCoreSlab(input, outSlab, mdSlab, cardSlab);
  return JSON.parse(outSlab.buf.toString('utf8', 0, outSlab.pos));
}
