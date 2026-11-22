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

function escapeHtml(s) {
  const len = s.length;
  let last = 0;
  let out = '';
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    let rep;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    else continue;
    if (last !== i) out += s.slice(last, i);
    out += rep;
    last = i + 1;
  }
  if (last === 0) return s;
  if (last < len) out += s.slice(last);
  return out;
}

function slugifyRaw(text) {
  const len = text.length;
  let isAscii = true;
  for (let i = 0; i < len; i++) {
    if (text.charCodeAt(i) >= 128) {
      isAscii = false;
      break;
    }
  }
  const plain = isAscii ? text : text.normalize('NFKD').replace(/\p{M}/gu, '');
  const plen = plain.length;
  let out = '';
  let gap = false;
  for (let i = 0; i < plen; i++) {
    const c = plain.charCodeAt(i);
    let ch = '';
    if (c >= 65 && c <= 90) ch = String.fromCharCode(c + 32);
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) ch = plain[i];
    else {
      if (out.length > 0) gap = true;
      continue;
    }
    if (gap) {
      if (out.length >= SLUG_MAX - 1) break;
      out += '-';
      gap = false;
    } else if (out.length >= SLUG_MAX) {
      break;
    }
    out += ch;
  }
  return out === '' ? 'untitled' : out;
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

function isJsWhitespace(c) {
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return (
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

function wordsOf(text) {
  const len = text.length;
  let count = 0;
  let inWord = false;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    const ws = c < 128 ? c === 32 || (c >= 9 && c <= 13) : isJsWhitespace(c);
    if (ws) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

function hasWhitespace(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128 ? c === 32 || (c >= 9 && c <= 13) : isJsWhitespace(c)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Front matter

const FM_KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const LINE_RE = /^([a-z_]+):(?: (.*))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    let last = 1;
    const end = raw.length - 1;
    for (let i = 1; i < end; i++) {
      const c = raw.charCodeAt(i);
      if (c === 92) {
        const n = raw.charCodeAt(i + 1);
        if ((n !== 34 && n !== 92) || i + 1 === end) {
          return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        }
        if (i > last) out += raw.slice(last, i);
        out += raw[i + 1];
        i++;
        last = i + 1;
      } else if (c === 34) {
        return { error: 'a quoted string holds a stray quote' };
      }
    }
    if (last === 1) return { value: raw.slice(1, end) };
    if (last < end) out += raw.slice(last, end);
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function fmValueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      if (!m) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const parts = inner.split(',');
      const tags = new Array(parts.length);
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i].trim();
        if (t === '' || !TAG_RE.test(t)) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        tags[i] = t;
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  const len = text.length;
  const nl0 = text.indexOf('\n');
  const line0 = nl0 === -1 ? text : text.slice(0, nl0);
  if (line0 !== '---') return { error: 'no front matter' };
  if (nl0 === -1) return { error: 'the front matter is not closed' };

  const data = Object.create(null);
  let pos = nl0 + 1;
  let lineIdx = 1;
  while (pos <= len) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    if (end - pos === 3 && text.charCodeAt(pos) === 45 && text.charCodeAt(pos + 1) === 45 && text.charCodeAt(pos + 2) === 45) {
      if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
      const body = nl === -1 ? '' : text.slice(nl + 1);
      return { data, body };
    }
    const line = text.slice(pos, end);
    if (!isBlankLine(line) && line.charCodeAt(0) !== 35) {
      const m = LINE_RE.exec(line);
      if (!m) return { error: `line ${lineIdx + 1} is not "key: value"` };
      const key = m[1];
      const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
      if (!FM_KEYS.has(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = fmValueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    if (nl === -1) break;
    pos = nl + 1;
    lineIdx++;
  }
  return { error: 'the front matter is not closed' };
}

// ---------------------------------------------------------------- Markdown

const ESCAPABLE = new Uint8Array(128);
for (const ch of '\\`*_[]()#+-.!>') ESCAPABLE[ch.charCodeAt(0)] = 1;

const INLINE_SPECIAL = new Uint8Array(128);
for (const ch of '\\`*[&<>"\'') INLINE_SPECIAL[ch.charCodeAt(0)] = 1;

function findUnescaped(s, what, from) {
  const hit = s.indexOf(what, from);
  if (hit === -1) return -1;
  const sl = s.indexOf('\\', from);
  if (sl === -1 || hit < sl) return hit;

  const len = s.length;
  const wlen = what.length;
  const c0 = what.charCodeAt(0);
  const c1 = wlen > 1 ? what.charCodeAt(1) : -1;
  const limit = len - wlen;
  for (let j = from; j <= limit; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < len) {
      const nc = s.charCodeAt(j + 1);
      if (nc < 128 && ESCAPABLE[nc]) {
        j++;
        continue;
      }
    }
    if (c === c0 && (wlen === 1 || s.charCodeAt(j + 1) === c1)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  if (s.indexOf('*', from) === -1) return -1;
  const len = s.length;
  for (let j = from; j < len; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < len) {
      const nc = s.charCodeAt(j + 1);
      if (nc < 128 && ESCAPABLE[nc]) {
        j++;
        continue;
      }
    }
    if (c !== 42) continue;
    if (j + 1 < len && s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

function inline(s, resolveLink) {
  const len = s.length;
  let i = 0;
  while (i < len) {
    const ch = s.charCodeAt(i);
    if (ch < 128 && INLINE_SPECIAL[ch]) break;
    i++;
  }
  if (i === len) return s;

  let out = i > 0 ? s.slice(0, i) : '';
  while (i < len) {
    const c = s.charCodeAt(i);
    if (c < 128 && INLINE_SPECIAL[c]) {
      if (c === 92) {
        if (i + 1 < len) {
          const nc = s.charCodeAt(i + 1);
          if (nc < 128 && ESCAPABLE[nc]) {
            out += nc === 62 ? '&gt;' : s[i + 1];
            i += 2;
            continue;
          }
        }
        out += '\\';
        i++;
        continue;
      }
      if (c === 96) {
        const j = s.indexOf('`', i + 1);
        if (j > i + 1) {
          out += `<code>${escapeHtml(s.slice(i + 1, j))}</code>`;
          i = j + 1;
        } else {
          out += '`';
          i++;
        }
        continue;
      }
      if (c === 42) {
        if (i + 1 < len && s.charCodeAt(i + 1) === 42) {
          const j = findUnescaped(s, '**', i + 2);
          if (j > i + 2) {
            out += `<strong>${inline(s.slice(i + 2, j), resolveLink)}</strong>`;
            i = j + 2;
          } else {
            out += '**';
            i += 2;
          }
          continue;
        }
        const j = findSingleStar(s, i + 1);
        if (j > i + 1) {
          out += `<em>${inline(s.slice(i + 1, j), resolveLink)}</em>`;
          i = j + 1;
        } else {
          out += '*';
          i++;
        }
        continue;
      }
      if (c === 91) {
        const k = findUnescaped(s, ']', i + 1);
        const m = k !== -1 && k + 1 < len && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
        const target = m === -1 ? '' : s.slice(k + 2, m);
        if (target !== '' && !hasWhitespace(target)) {
          out += `<a href="${escapeHtml(resolveLink(target))}">${inline(s.slice(i + 1, k), resolveLink)}</a>`;
          i = m + 1;
          continue;
        }
        out += '[';
        i++;
        continue;
      }
      if (c === 38) out += '&amp;';
      else if (c === 60) out += '&lt;';
      else if (c === 62) out += '&gt;';
      else if (c === 34) out += '&quot;';
      else out += '&#39;';
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < len) {
      const ch = s.charCodeAt(i);
      if (ch < 128 && INLINE_SPECIAL[ch]) break;
      i++;
    }
    out += s.slice(start, i);
  }
  return out;
}

const BLANK_RE = /^[ \t]*$/;
const FENCE_OPEN_RE = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE_RE = /^```[ \t]*$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR_RE = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET_RE = /^[-*] (.*)$/;
const ORDERED_RE = /^(\d{1,9})\. (.*)$/;
const CONTINUED_RE = /^ {2,}\S/;

function isBlankLine(line) {
  const len = line.length;
  if (len === 0) return true;
  const c0 = line.charCodeAt(0);
  if (c0 !== 32 && c0 !== 9) return false;
  for (let i = 1; i < len; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function isBlankSlice(src, start, end) {
  for (let i = start; i < end; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  const len = line.length;
  if (len === 0) return line;
  const c0 = line.charCodeAt(0);
  const cEnd = line.charCodeAt(len - 1);
  if (c0 !== 32 && c0 !== 9 && cEnd !== 32 && cEnd !== 9) return line;
  let s = 0;
  let e = len;
  while (s < e && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  while (e > s && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  return line.slice(s, e);
}

function trimSlice(src, start, end) {
  while (start < end && (src.charCodeAt(start) === 32 || src.charCodeAt(start) === 9)) start++;
  while (end > start && (src.charCodeAt(end - 1) === 32 || src.charCodeAt(end - 1) === 9)) end--;
  return src.slice(start, end);
}

function headingOf(line) {
  if (line.charCodeAt(0) !== 35) return null;
  const m = HEADING_RE.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

function endsParagraph(src, start, end) {
  if (isBlankSlice(src, start, end)) return true;
  const c0 = src.charCodeAt(start);
  if (c0 !== 96 && c0 !== 35 && c0 !== 45 && c0 !== 42) return false;
  const line = src.slice(start, end);
  if (c0 === 96) return FENCE_OPEN_RE.test(line);
  if (c0 === 35) return headingOf(line) !== null;
  return HR_RE.test(line);
}

function renderMarkdown(src, resolveLink, slugify) {
  const srcLen = src.length;
  const ids = new Set();
  const toc = [];
  let excerpt = null;
  let out = '';
  let pos = 0;

  while (pos <= srcLen) {
    const nl = src.indexOf('\n', pos);
    const end = nl === -1 ? srcLen : nl;
    if (isBlankSlice(src, pos, end)) {
      if (nl === -1) break;
      pos = nl + 1;
      continue;
    }

    const c0 = src.charCodeAt(pos);
    const nextPos = nl === -1 ? srcLen + 1 : nl + 1;

    if (c0 === 96) {
      const line = src.slice(pos, end);
      const fence = FENCE_OPEN_RE.exec(line);
      if (fence !== null) {
        const lang = fence[1];
        const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
        let codeHtml = `<pre><code${cls}>`;
        pos = nextPos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos);
          const end2 = nl2 === -1 ? srcLen : nl2;
          const l2 = src.slice(pos, end2);
          pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          if (l2.charCodeAt(0) === 96 && FENCE_CLOSE_RE.test(l2)) break;
          codeHtml += `${escapeHtml(l2)}\n`;
        }
        out += `${codeHtml}</code></pre>\n`;
        continue;
      }
    }

    if (c0 === 35) {
      const line = src.slice(pos, end);
      const heading = headingOf(line);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        const html = inline(heading.text, resolveLink);
        out += `<h${heading.depth} id="${id}">${html}</h${heading.depth}>\n`;
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
        pos = nextPos;
        continue;
      }
    }

    if (c0 === 45 || c0 === 42) {
      const line = src.slice(pos, end);
      if (HR_RE.test(line)) {
        out += '<hr>\n';
        pos = nextPos;
        continue;
      }
      const bullet = BULLET_RE.exec(line);
      if (bullet !== null) {
        let listHtml = '<ul>\n';
        let curItem = trimLine(bullet[1]);
        pos = nextPos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos);
          const end2 = nl2 === -1 ? srcLen : nl2;
          const l2 = src.slice(pos, end2);
          const m = BULLET_RE.exec(l2);
          if (m !== null) {
            listHtml += `<li>${inline(curItem, resolveLink)}</li>\n`;
            curItem = trimLine(m[1]);
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else if (CONTINUED_RE.test(l2)) {
            curItem += `\n${trimLine(l2)}`;
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else {
            break;
          }
        }
        listHtml += `<li>${inline(curItem, resolveLink)}</li>\n</ul>\n`;
        out += listHtml;
        continue;
      }
    }

    if (c0 === 62) {
      let qText = '';
      let first = true;
      {
        const s0 = pos + (pos + 1 < end && src.charCodeAt(pos + 1) === 32 ? 2 : 1);
        const t0 = trimSlice(src, s0, end);
        if (t0 !== '') {
          qText = t0;
          first = false;
        }
      }
      pos = nextPos;
      while (pos <= srcLen && src.charCodeAt(pos) === 62) {
        const nl2 = src.indexOf('\n', pos);
        const end2 = nl2 === -1 ? srcLen : nl2;
        const s2 = pos + (pos + 1 < end2 && src.charCodeAt(pos + 1) === 32 ? 2 : 1);
        const t2 = trimSlice(src, s2, end2);
        if (t2 !== '') {
          if (first) {
            qText = t2;
            first = false;
          } else {
            qText += `\n${t2}`;
          }
        }
        pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
      }
      out += first ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(qText, resolveLink)}</p>\n</blockquote>\n`;
      continue;
    }

    if (c0 >= 48 && c0 <= 57) {
      const line = src.slice(pos, end);
      const ordered = ORDERED_RE.exec(line);
      if (ordered !== null) {
        const start = Number(ordered[1]);
        let listHtml = start !== 1 ? `<ol start="${start}">\n` : '<ol>\n';
        let curItem = trimLine(ordered[2]);
        pos = nextPos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos);
          const end2 = nl2 === -1 ? srcLen : nl2;
          const l2 = src.slice(pos, end2);
          const m = ORDERED_RE.exec(l2);
          if (m !== null) {
            listHtml += `<li>${inline(curItem, resolveLink)}</li>\n`;
            curItem = trimLine(m[2]);
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else if (CONTINUED_RE.test(l2)) {
            curItem += `\n${trimLine(l2)}`;
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else {
            break;
          }
        }
        listHtml += `<li>${inline(curItem, resolveLink)}</li>\n</ol>\n`;
        out += listHtml;
        continue;
      }
    }

    // Paragraph (zero extra line slices)
    let pText = trimSlice(src, pos, end);
    pos = nextPos;
    while (pos <= srcLen) {
      const nl2 = src.indexOf('\n', pos);
      const end2 = nl2 === -1 ? srcLen : nl2;
      if (endsParagraph(src, pos, end2)) break;
      pText += `\n${trimSlice(src, pos, end2)}`;
      pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
    }
    const html = inline(pText, resolveLink);
    if (excerpt === null) excerpt = html;
    out += `<p>${html}</p>\n`;
  }
  return { html: out, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- Templates (Parse + JIT Compile)

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

function escTextOf(v) {
  if (typeof v === 'string') return escapeHtml(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return escapeHtml(textOf(v));
  return '';
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

function compileTemplate(nodes, templates) {
  const flat = [];
  inlineAst(nodes, 0, templates, flat);

  let vid = 0;
  const lines = ['let _o = "";'];
  const scopeStack = [];

  function resolveExpr(path) {
    const rootName = path[0];
    let base = null;
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const frame = scopeStack[i];
      if (rootName === 'loop') {
        base = frame.loopVar;
        break;
      }
      if (frame.itemName === rootName) {
        base = frame.itemVar;
        break;
      }
    }
    if (base === null) {
      base = `(_has(vars,${JSON.stringify(rootName)})?vars.${rootName}:undefined)`;
    }
    let expr = base;
    for (let k = 1; k < path.length; k++) {
      const prop = path[k];
      const tmp = `_t${vid++}`;
      expr = `((${tmp}=${expr})!==null&&typeof ${tmp}==='object'&&_has(${tmp},${JSON.stringify(prop)})?${tmp}.${prop}:undefined)`;
    }
    return expr;
  }

  function emit(list) {
    let exprParts = [];
    const flushParts = () => {
      if (exprParts.length > 0) {
        lines.push(`_o += ${exprParts.join(' + ')};`);
        exprParts = [];
      }
    };
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.kind === 'text') {
        exprParts.push(JSON.stringify(n.text));
      } else if (n.kind === 'var') {
        exprParts.push(`_esc(${resolveExpr(n.path)})`);
      } else if (n.kind === 'raw') {
        exprParts.push(`_txt(${resolveExpr(n.path)})`);
      } else if (n.kind === 'if') {
        flushParts();
        const cond = `_tru(${resolveExpr(n.path)})`;
        lines.push(`if (${n.not ? '!' + cond : cond}) {`);
        emit(n.then);
        if (n.else !== null && n.else.length > 0) {
          lines.push('} else {');
          emit(n.else);
        }
        lines.push('}');
      } else if (n.kind === 'for') {
        flushParts();
        const arrVar = `_a${vid++}`;
        const lenVar = `_n${vid++}`;
        const idxVar = `_k${vid++}`;
        const itemVar = `_x${vid++}`;
        const needLoop = bodyUsesLoop(n.body);
        const loopVar = needLoop ? `_l${vid++}` : 'undefined';
        lines.push(`const ${arrVar} = ${resolveExpr(n.path)};`);
        lines.push(`if (Array.isArray(${arrVar})) {`);
        lines.push(`const ${lenVar} = ${arrVar}.length;`);
        lines.push(`for (let ${idxVar} = 0; ${idxVar} < ${lenVar}; ${idxVar}++) {`);
        lines.push(`const ${itemVar} = ${arrVar}[${idxVar}];`);
        if (needLoop) {
          lines.push(`const ${loopVar} = { index: ${idxVar} + 1, first: ${idxVar} === 0, last: ${idxVar} === ${lenVar} - 1, length: ${lenVar} };`);
        }
        scopeStack.push({ itemName: n.name, itemVar, loopVar });
        emit(n.body);
        scopeStack.pop();
        lines.push('}');
        lines.push('}');
      }
    }
    flushParts();
  }

  emit(flat);
  lines.push('return _o;');
  const fn = new Function('vars', '_esc', '_txt', '_tru', '_has', lines.join('\n'));
  return (vars) => fn(vars, escTextOf, textOf, truthy, Object.hasOwn);
}

// ---------------------------------------------------------------- Path helpers

function resolvePath(baseParts, rel) {
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

// ---------------------------------------------------------------- Main entry

export function run(input) {
  const slugCache = new Map();
  const slugify = (text) => {
    let s = slugCache.get(text);
    if (s === undefined) {
      s = slugifyRaw(text);
      slugCache.set(text, s);
    }
    return s;
  };

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

  const compiled = new Map();
  const getRenderer = (name) => {
    let r = compiled.get(name);
    if (r === undefined) {
      const nodes = templates.get(name);
      if (nodes === undefined) return null;
      r = compileTemplate(nodes, templates);
      compiled.set(name, r);
    }
    return r;
  };

  const base = input.site.base_url.replace(/\/+$/, '');
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

  // 2. Front matter
  const kept = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
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
    if (post && !Object.hasOwn(s.data, 'date')) {
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

  // 3. Permalinks
  const taken = new Map();
  const bySource = new Map();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : undefined);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Markdown
  const staticPaths = new Set();
  for (let i = 0; i < statics.length; i++) staticPaths.add(statics[i].path);
  const broken = new Set();
  const dirPartsCache = new Map();
  const emptyParts = [];
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = dirOf(s.path);
    let dirParts = dir === '' ? emptyParts : dirPartsCache.get(dir);
    if (dirParts === undefined) {
      dirParts = dir.split('/');
      dirPartsCache.set(dir, dirParts);
    }
    const resolveLink = (target) => {
      const c0 = target.charCodeAt(0);
      if (c0 === 47 || c0 === 35 || (target.includes(':') && SCHEME_RE.test(target))) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dirParts, rel);
      if (path !== null) {
        const targetSrc = bySource.get(path);
        if (targetSrc !== undefined) return `${targetSrc.url}${frag}`;
        if (staticPaths.has(path)) return `${base}/${path}${frag}`;
      }
      broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.body, resolveLink, slugify);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. Collections
  const posts = [];
  for (let i = 0; i < kept.length; i++) {
    if (kept[i].post) posts.push(kept[i]);
  }
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 6. Tags
  const bySlug = new Map();
  const ownTags = (s) => {
    const rawTags = s.data.tags;
    if (rawTags === undefined || rawTags.length === 0) return [];
    const seen = new Set();
    const res = [];
    for (let i = 0; i < rawTags.length; i++) {
      const name = rawTags[i];
      const sl = slugify(name);
      if (!seen.has(sl)) {
        seen.add(sl);
        res.push(name);
      }
    }
    return res;
  };

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const pTags = ownTags(p);
    p.tagRefs = new Array(pTags.length);
    for (let j = 0; j < pTags.length; j++) {
      const name = pTags[j];
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        const url = `${base}/tags/${slug}/`;
        tag = { name, slug, url, posts: [], pub: { name, slug, url } };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs[j] = tag.pub;
    }
  }
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    if (!s.post) {
      const sTags = ownTags(s);
      s.tagRefs = new Array(sTags.length);
      for (let j = 0; j < sTags.length; j++) {
        const name = sTags[j];
        const slug = slugify(name);
        const existing = bySlug.get(slug);
        s.tagRefs[j] = existing !== undefined ? existing.pub : { name, slug, url: '' };
      }
    }
  }
  const tagsList = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Layouts
  const linkOf = (s) => (s === null ? null : {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
  });

  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs,
  });

  const cards = new Map();
  for (let i = 0; i < posts.length; i++) {
    cards.set(posts[i], cardOf(posts[i]));
  }

  const site = { title: input.site.title, base_url: base };
  const allTags = tagsList.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recentCount = Math.min(input.site.recent, posts.length);
  const recent = new Array(recentCount);
  for (let i = 0; i < recentCount; i++) recent[i] = cards.get(posts[i]);

  const output = {};
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const renderer = getRenderer(s.layout);
    const card = s.post ? cards.get(s) : null;
    const tocArr = new Array(s.toc.length);
    for (let j = 0; j < s.toc.length; j++) {
      const h = s.toc[j];
      tocArr[j] = { level: h.level, id: h.id, html: h.html };
    }
    const page = card !== null ? {
      title: card.title,
      url: card.url,
      date: card.date,
      date_long: card.date_long,
      summary: card.summary,
      excerpt: card.excerpt,
      reading_minutes: card.reading_minutes,
      tags: card.tags,
      slug: s.slug,
      content: s.html,
      toc: tocArr,
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: true,
    } : {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: s.tagRefs,
      slug: s.slug,
      content: s.html,
      toc: tocArr,
      newer: null,
      older: null,
      is_post: false,
    };
    output[`${s.outDir}/index.html`] = renderer({ site, tags: allTags, recent, page });
  }

  const indexRenderer = getRenderer('index');
  if (indexRenderer !== null) {
    const per = input.site.per_page;
    const pages = Math.max(1, Math.ceil(posts.length / per));
    const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
    for (let k = 1; k <= pages; k++) {
      const start = (k - 1) * per;
      const end = Math.min(k * per, posts.length);
      const pagePosts = new Array(Math.max(0, end - start));
      for (let i = start; i < end; i++) pagePosts[i - start] = cards.get(posts[i]);
      const pager = {
        number: k,
        total: pages,
        url: indexUrl(k),
        newer_url: k === 1 ? '' : indexUrl(k - 1),
        older_url: k === pages ? '' : indexUrl(k + 1),
      };
      output[k === 1 ? 'index.html' : `page/${k}/index.html`] = indexRenderer({ site, tags: allTags, recent, posts: pagePosts, pager });
    }
  }

  const tagRenderer = getRenderer('tag');
  if (tagRenderer !== null) {
    for (let i = 0; i < tagsList.length; i++) {
      const t = tagsList[i];
      const tPosts = new Array(t.posts.length);
      for (let j = 0; j < t.posts.length; j++) tPosts[j] = cards.get(t.posts[j]);
      output[`tags/${t.slug}/index.html`] = tagRenderer({
        site,
        tags: allTags,
        recent,
        tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: tPosts },
      });
    }
  }

  const tagsRenderer = getRenderer('tags');
  if (tagsRenderer !== null) {
    output['tags/index.html'] = tagsRenderer({ site, tags: allTags, recent });
  }

  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. Report
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.length - posts.length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tagsList.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;

  return output;
}
