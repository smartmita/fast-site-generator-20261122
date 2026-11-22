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

const ESC_TEST = /[&<>"']/;
const ESC_RE = /[&<>"']/g;
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escRepl = (m) => ESC_MAP[m];

function escapeHtml(s) {
  return ESC_TEST.test(s) ? s.replace(ESC_RE, escRepl) : s;
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
  const codes = [];
  let gap = false;
  for (let i = 0; i < plen; i++) {
    let c = plain.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    else if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
      if (codes.length > 0) gap = true;
      continue;
    }
    if (gap) {
      if (codes.length >= SLUG_MAX - 1) break;
      codes.push(45);
      gap = false;
    } else if (codes.length >= SLUG_MAX) {
      break;
    }
    codes.push(c);
  }
  return codes.length === 0 ? 'untitled' : String.fromCharCode.apply(null, codes);
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
    if (c > 32 && c < 128) {
      if (!inWord) {
        inWord = true;
        count++;
      }
    } else if (c === 32 || (c >= 9 && c <= 13) || (c >= 128 && isJsWhitespace(c))) {
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
    if (c === 32 || (c >= 9 && c <= 13) || (c >= 128 && isJsWhitespace(c))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Front matter

const FM_KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
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
    if (!startIsBlank(text, pos, end) && text.charCodeAt(pos) !== 35) {
      const line = text.slice(pos, end);
      const colon = line.indexOf(':');
      if (colon <= 0) return { error: `line ${lineIdx + 1} is not "key: value"` };
      let validKey = true;
      for (let k = 0; k < colon; k++) {
        const kc = line.charCodeAt(k);
        if (!((kc >= 97 && kc <= 122) || kc === 95)) {
          validKey = false;
          break;
        }
      }
      if (!validKey) return { error: `line ${lineIdx + 1} is not "key: value"` };
      if (colon + 1 < line.length && line.charCodeAt(colon + 1) !== 32) return { error: `line ${lineIdx + 1} is not "key: value"` };
      const key = line.slice(0, colon);
      let rawEnd = line.length;
      while (rawEnd > colon + 2 && (line.charCodeAt(rawEnd - 1) === 32 || line.charCodeAt(rawEnd - 1) === 9)) rawEnd--;
      const raw = colon + 2 <= rawEnd ? line.slice(colon + 2, rawEnd) : '';
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

const PARA_STOP = new Uint8Array(128);
for (const ch of ' \t`#-*') PARA_STOP[ch.charCodeAt(0)] = 1;

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
  let hit = s.indexOf('*', from);
  if (hit === -1) return -1;
  const sl = s.indexOf('\\', from);
  const len = s.length;
  if (sl === -1) {
    while (hit !== -1) {
      if (hit + 1 >= len || s.charCodeAt(hit + 1) !== 42) return hit;
      hit = s.indexOf('*', hit + 2);
    }
    return -1;
  }
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

const MD_RE = /[\\`*[]/g;

function inline(s, resolveLink) {
  MD_RE.lastIndex = 0;
  if (!MD_RE.test(s)) return escapeHtml(s);
  let idx = MD_RE.lastIndex - 1;
  const len = s.length;
  let out = idx > 0 ? escapeHtml(s.slice(0, idx)) : '';
  let i = idx;
  while (true) {
    const c = s.charCodeAt(idx);
    if (c === 92) {
      if (idx + 1 < len) {
        const nc = s.charCodeAt(idx + 1);
        if (nc < 128 && ESCAPABLE[nc]) {
          out += nc === 62 ? '&gt;' : s[idx + 1];
          i = idx + 2;
        } else {
          out += '\\';
          i = idx + 1;
        }
      } else {
        out += '\\';
        i = idx + 1;
      }
    } else if (c === 96) {
      const j = s.indexOf('`', idx + 1);
      if (j > idx + 1) {
        out += `<code>${escapeHtml(s.slice(idx + 1, j))}</code>`;
        i = j + 1;
      } else {
        out += '`';
        i = idx + 1;
      }
    } else if (c === 42) {
      if (idx + 1 < len && s.charCodeAt(idx + 1) === 42) {
        const j = findUnescaped(s, '**', idx + 2);
        if (j > idx + 2) {
          out += `<strong>${inline(s.slice(idx + 2, j), resolveLink)}</strong>`;
          i = j + 2;
        } else {
          out += '**';
          i = idx + 2;
        }
      } else {
        const j = findSingleStar(s, idx + 1);
        if (j > idx + 1) {
          out += `<em>${inline(s.slice(idx + 1, j), resolveLink)}</em>`;
          i = j + 1;
        } else {
          out += '*';
          i = idx + 1;
        }
      }
    } else {
      // c === 91 '['
      const k = findUnescaped(s, ']', idx + 1);
      const m = k !== -1 && k + 1 < len && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !hasWhitespace(target)) {
        out += `<a href="${escapeHtml(resolveLink(target))}">${inline(s.slice(idx + 1, k), resolveLink)}</a>`;
        i = m + 1;
      } else {
        out += '[';
        i = idx + 1;
      }
    }
    if (i >= len) break;
    MD_RE.lastIndex = i;
    if (!MD_RE.test(s)) {
      out += escapeHtml(s.slice(i));
      break;
    }
    idx = MD_RE.lastIndex - 1;
    if (idx > i) out += escapeHtml(s.slice(i, idx));
  }
  return out;
}

const BLANK_RE = /^[ \t]*$/;
const FENCE_OPEN_RE = /^```([A-Za-z0-9_+-]*)[ \t]*$/;

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

function isFenceOpenSlice(src, pos, end) {
  if (pos + 3 > end || src.charCodeAt(pos) !== 96 || src.charCodeAt(pos + 1) !== 96 || src.charCodeAt(pos + 2) !== 96) return false;
  return FENCE_OPEN_RE.test(src.slice(pos, end));
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

function headingBounds(src, pos, end) {
  let d = 0;
  const max = Math.min(end, pos + 6);
  while (pos + d < max && src.charCodeAt(pos + d) === 35) d++;
  if (d === 0 || pos + d >= end) return null;
  const sp = src.charCodeAt(pos + d);
  if (sp !== 32 && sp !== 9) return null;
  let s = pos + d + 1;
  while (s < end && (src.charCodeAt(s) === 32 || src.charCodeAt(s) === 9)) s++;
  let e = end;
  while (e > s && (src.charCodeAt(e - 1) === 32 || src.charCodeAt(e - 1) === 9)) e--;
  return s < e ? { depth: d, text: src.slice(s, e) } : null;
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

function endsParagraph(src, start, end) {
  if (start === end) return true;
  const c0 = src.charCodeAt(start);
  if (c0 >= 128 || !PARA_STOP[c0]) return false;
  if (c0 === 32 || c0 === 9) return isBlankSlice(src, start, end);
  if (c0 === 96) return isFenceOpenSlice(src, start, end);
  if (c0 === 35) return headingDepthSlice(src, start, end) !== 0;
  return isHrSlice(src, start, end, c0);
}

function startIsBlank(src, pos, end) {
  if (pos === end) return true;
  const c0 = src.charCodeAt(pos);
  if (c0 !== 32 && c0 !== 9) return false;
  return isBlankSlice(src, pos + 1, end);
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
    if (startIsBlank(src, pos, end)) {
      if (nl === -1) break;
      pos = nl + 1;
      continue;
    }

    const c0 = src.charCodeAt(pos);
    const nextPos = nl === -1 ? srcLen + 1 : nl + 1;

    if (c0 === 96 && pos + 3 <= end && src.charCodeAt(pos + 1) === 96 && src.charCodeAt(pos + 2) === 96) {
      const fence = FENCE_OPEN_RE.exec(src.slice(pos, end));
      if (fence !== null) {
        const lang = fence[1];
        const openTag = lang === '' ? '<pre><code>' : `<pre><code class="language-${escapeHtml(lang)}">`;
        pos = nextPos;
        const codeStart = pos;
        let closed = false;
        let codeEnd = pos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos);
          const end2 = nl2 === -1 ? srcLen : nl2;
          if (isFenceCloseSlice(src, pos, end2)) {
            codeEnd = pos;
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
            closed = true;
            break;
          }
          pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
        }
        const body = closed
          ? (codeEnd > codeStart ? escapeHtml(src.slice(codeStart, codeEnd)) : '')
          : (codeStart <= srcLen ? `${escapeHtml(src.slice(codeStart))}\n` : '');
        out += `${openTag}${body}</code></pre>\n`;
        continue;
      }
    }

    if (c0 === 35) {
      const heading = headingBounds(src, pos, end);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        const html = inline(heading.text, resolveLink);
        out += `<h${heading.depth} id="${id}">${html}</h${heading.depth}>\n`;
        if (heading.depth === 2 || heading.depth === 3) toc.push({ __proto__: null, level: heading.depth, id, html });
        pos = nextPos;
        continue;
      }
    }

    if (c0 === 45 || c0 === 42) {
      if (isHrSlice(src, pos, end, c0)) {
        out += '<hr>\n';
        pos = nextPos;
        continue;
      }
      if (pos + 1 < end && src.charCodeAt(pos + 1) === 32) {
        let listHtml = '<ul>\n';
        let curItem = trimSlice(src, pos + 2, end);
        pos = nextPos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos);
          const end2 = nl2 === -1 ? srcLen : nl2;
          if (isBulletSlice(src, pos, end2)) {
            listHtml += `<li>${inline(curItem, resolveLink)}</li>\n`;
            curItem = trimSlice(src, pos + 2, end2);
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else if (isContinuedSlice(src, pos, end2)) {
            curItem += `\n${trimSlice(src, pos, end2)}`;
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else {
            break;
          }
        }
        out += `${listHtml}<li>${inline(curItem, resolveLink)}</li>\n</ul>\n`;
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
      const contentPos = orderedStartSlice(src, pos, end);
      if (contentPos !== -1) {
        const start = contentPos - 2 === pos + 1 ? src.charCodeAt(pos) - 48 : Number(src.slice(pos, contentPos - 2));
        let listHtml = start !== 1 ? `<ol start="${start}">\n` : '<ol>\n';
        let curItem = trimSlice(src, contentPos, end);
        pos = nextPos;
        while (pos <= srcLen) {
          const nl2 = src.indexOf('\n', pos);
          const end2 = nl2 === -1 ? srcLen : nl2;
          const cPos2 = orderedStartSlice(src, pos, end2);
          if (cPos2 !== -1) {
            listHtml += `<li>${inline(curItem, resolveLink)}</li>\n`;
            curItem = trimSlice(src, cPos2, end2);
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else if (isContinuedSlice(src, pos, end2)) {
            curItem += `\n${trimSlice(src, pos, end2)}`;
            pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
          } else {
            break;
          }
        }
        out += `${listHtml}<li>${inline(curItem, resolveLink)}</li>\n</ol>\n`;
        continue;
      }
    }

    const p0Trimmed = pos < end && (src.charCodeAt(pos) === 32 || src.charCodeAt(pos) === 9 || src.charCodeAt(end - 1) === 32 || src.charCodeAt(end - 1) === 9);
    const pStart = pos;
    let pLastEnd = end;
    let pLines = p0Trimmed ? [trimSlice(src, pos, end)] : null;
    pos = nextPos;
    while (pos <= srcLen) {
      const nl2 = src.indexOf('\n', pos);
      const end2 = nl2 === -1 ? srcLen : nl2;
      if (endsParagraph(src, pos, end2)) break;
      const needTrim = pos < end2 && (src.charCodeAt(pos) === 32 || src.charCodeAt(pos) === 9 || src.charCodeAt(end2 - 1) === 32 || src.charCodeAt(end2 - 1) === 9);
      if (pLines === null) {
        if (needTrim) {
          pLines = [src.slice(pStart, pLastEnd), trimSlice(src, pos, end2)];
        } else {
          pLastEnd = end2;
        }
      } else {
        pLines.push(needTrim ? trimSlice(src, pos, end2) : src.slice(pos, end2));
      }
      pos = nl2 === -1 ? srcLen + 1 : nl2 + 1;
    }
    const pText = pLines === null ? src.slice(pStart, pLastEnd) : pLines.join('\n');
    const html = inline(pText, resolveLink);
    if (excerpt === null) excerpt = html;
    out += `<p>${html}</p>\n`;
  }
  return { html: out, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- Templates (Parse + Partial Eval + JIT Compile)

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
  if (typeof v === 'string') return ESC_TEST.test(v) ? v.replace(ESC_RE, escRepl) : v;
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
    if (n.kind === 'text') out.push(n.text);
    else if (n.kind === 'var') out.push(escTextOf(evalPath(n.path, env)));
    else if (n.kind === 'raw') out.push(textOf(evalPath(n.path, env)));
    else if (n.kind === 'if') {
      const cond = truthy(evalPath(n.path, env));
      if (n.not ? !cond : cond) evalStaticNodes(n.then, env, out);
      else if (n.else !== null) evalStaticNodes(n.else, env, out);
    } else if (n.kind === 'for') {
      const arr = evalPath(n.path, env);
      if (Array.isArray(arr)) {
        const len = arr.length;
        const prevItem = env[n.name];
        const hasItem = Object.hasOwn(env, n.name);
        const prevLoop = env.loop;
        const hasLoop = Object.hasOwn(env, 'loop');
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
      pushText(n.text);
    } else if (n.kind === 'var' || n.kind === 'raw') {
      const r = n.path[0];
      if (!bound.has(r) && !dynRoots.has(r)) {
        const v = evalPath(n.path, staticEnv);
        pushText(n.kind === 'var' ? escTextOf(v) : textOf(v));
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
          const prevItem = staticEnv[n.name];
          const hasItem = Object.hasOwn(staticEnv, n.name);
          const prevLoop = staticEnv.loop;
          const hasLoop = Object.hasOwn(staticEnv, 'loop');
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

function hasControlFlow(list) {
  for (let i = 0; i < list.length; i++) {
    const k = list[i].kind;
    if (k === 'if' || k === 'for') return true;
  }
  return false;
}

function compileBodyToFn(flat, extraVars, itemCaches, dynRoots) {
  if (flat.length === 0) return () => '';
  if (flat.length === 1 && flat[0].kind === 'text') {
    const s = flat[0].text;
    return () => s;
  }
  let vid = 0;
  const useArray = hasControlFlow(flat);
  const lines = useArray ? ['const _p = [];'] : [];
  const flatParts = useArray ? null : [];
  const scopeStack = [];
  const cacheRefs = [];

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
    if (base === null) base = `vars.${rootName}`;
    let expr = base;
    for (let k = 1; k < path.length; k++) {
      const prop = path[k];
      const tmp = `_t${vid++}`;
      expr = `((${tmp}=${expr})!==null&&typeof ${tmp}==='object'&&(!Array.isArray(${tmp})||_has(${tmp},${JSON.stringify(prop)}))?${tmp}.${prop}:undefined)`;
    }
    return expr;
  }

  function emit(list) {
    let pushBatch = [];
    const flushPush = () => {
      if (pushBatch.length > 0) {
        lines.push(`_p.push(${pushBatch.join(',')});`);
        pushBatch = [];
      }
    };
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.kind === 'text') {
        if (useArray) pushBatch.push(JSON.stringify(n.text));
        else flatParts.push(JSON.stringify(n.text));
      } else if (n.kind === 'var') {
        const e = `_esc(${resolveExpr(n.path)})`;
        if (useArray) pushBatch.push(e);
        else flatParts.push(e);
      } else if (n.kind === 'raw') {
        const e = `_txt(${resolveExpr(n.path)})`;
        if (useArray) pushBatch.push(e);
        else flatParts.push(e);
      } else if (n.kind === 'if') {
        flushPush();
        const cond = `_tru(${resolveExpr(n.path)})`;
        lines.push(`if (${n.not ? '!' + cond : cond}) {`);
        emit(n.then);
        if (n.else !== null && n.else.length > 0) {
          lines.push('} else {');
          emit(n.else);
        }
        lines.push('}');
      } else if (n.kind === 'for') {
        flushPush();
        const arrVar = `_a${vid++}`;
        const lenVar = `_n${vid++}`;
        const idxVar = `_k${vid++}`;
        const itemVar = `_x${vid++}`;
        const onlyItem = scopeStack.length === 0 && !bodyUsesLoop(n.body) && (() => {
          const b = new Set([n.name]);
          return isStaticNodeList(n.body, b, dynRoots);
        })();
        if (onlyItem) {
          const key = n.name + ':' + JSON.stringify(n.body);
          let entry = itemCaches.get(key);
          if (entry === undefined) {
            const subFn = compileItemRenderer(n.body, n.name, extraVars);
            entry = { cache: new Map(), fn: subFn };
            itemCaches.set(key, entry);
          }
          const cid = cacheRefs.length;
          cacheRefs.push(entry);
          lines.push(`const ${arrVar} = ${resolveExpr(n.path)};`);
          lines.push(`if (Array.isArray(${arrVar})) {`);
          lines.push(`const ${lenVar} = ${arrVar}.length;`);
          lines.push(`const _c${cid} = _caches[${cid}].cache, _f${cid} = _caches[${cid}].fn;`);
          lines.push(`for (let ${idxVar} = 0; ${idxVar} < ${lenVar}; ${idxVar}++) {`);
          lines.push(`const ${itemVar} = ${arrVar}[${idxVar}];`);
          lines.push(`let _r${cid} = _c${cid}.get(${itemVar});`);
          lines.push(`if (_r${cid} === undefined) { _r${cid} = _f${cid}(${itemVar}); _c${cid}.set(${itemVar}, _r${cid}); }`);
          lines.push(`_p.push(_r${cid});`);
          lines.push('}');
          lines.push('}');
        } else {
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
    }
    if (useArray) flushPush();
  }

  emit(flat);
  if (useArray) {
    lines.push('return _p.length === 1 ? _p[0] : _p.join("");');
  } else if (flatParts.length === 0) {
    lines.push('return "";');
  } else if (flatParts.length === 1) {
    lines.push(`return ${flatParts[0]};`);
  } else {
    lines.push(`return [${flatParts.join(',')}].join("");`);
  }
  const fn = new Function('vars', '_esc', '_txt', '_tru', '_has', '_caches', lines.join('\n'));
  return (vars) => fn(vars, escTextOf, textOf, truthy, Object.hasOwn, cacheRefs);
}

function compileItemRenderer(body, itemName, extraVars) {
  let vid = 0;
  const useArray = hasControlFlow(body);
  const lines = useArray ? ['const _p = [];'] : [];
  const flatParts = useArray ? null : [];
  const scopeStack = [{ itemName, itemVar: '_item', loopVar: 'undefined' }];

  function resolveExpr(path) {
    const rootName = path[0];
    let base = null;
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const frame = scopeStack[i];
      if (rootName === 'loop') { base = frame.loopVar; break; }
      if (frame.itemName === rootName) { base = frame.itemVar; break; }
    }
    if (base === null) base = `_stat.${rootName}`;
    let expr = base;
    for (let k = 1; k < path.length; k++) {
      const prop = path[k];
      const tmp = `_t${vid++}`;
      expr = `((${tmp}=${expr})!==null&&typeof ${tmp}==='object'&&(!Array.isArray(${tmp})||_has(${tmp},${JSON.stringify(prop)}))?${tmp}.${prop}:undefined)`;
    }
    return expr;
  }

  function emit(list) {
    let pushBatch = [];
    const flushPush = () => {
      if (pushBatch.length > 0) {
        lines.push(`_p.push(${pushBatch.join(',')});`);
        pushBatch = [];
      }
    };
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.kind === 'text') {
        if (useArray) pushBatch.push(JSON.stringify(n.text));
        else flatParts.push(JSON.stringify(n.text));
      } else if (n.kind === 'var') {
        const e = `_esc(${resolveExpr(n.path)})`;
        if (useArray) pushBatch.push(e);
        else flatParts.push(e);
      } else if (n.kind === 'raw') {
        const e = `_txt(${resolveExpr(n.path)})`;
        if (useArray) pushBatch.push(e);
        else flatParts.push(e);
      } else if (n.kind === 'if') {
        flushPush();
        const cond = `_tru(${resolveExpr(n.path)})`;
        lines.push(`if (${n.not ? '!' + cond : cond}) {`);
        emit(n.then);
        if (n.else !== null && n.else.length > 0) {
          lines.push('} else {');
          emit(n.else);
        }
        lines.push('}');
      } else if (n.kind === 'for') {
        flushPush();
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
    if (useArray) flushPush();
  }

  emit(body);
  if (useArray) {
    lines.push('return _p.length === 1 ? _p[0] : _p.join("");');
  } else if (flatParts.length === 0) {
    lines.push('return "";');
  } else if (flatParts.length === 1) {
    lines.push(`return ${flatParts[0]};`);
  } else {
    lines.push(`return [${flatParts.join(',')}].join("");`);
  }
  const fn = new Function('_item', '_stat', '_esc', '_txt', '_tru', '_has', lines.join('\n'));
  return (item) => fn(item, extraVars, escTextOf, textOf, truthy, Object.hasOwn);
}

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
      const path = rel === '' ? null : resolvePath(dirParts, dir, rel);
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
        tag = { name, slug, url, posts: [], pub: { __proto__: null, name, slug, url } };
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
        s.tagRefs[j] = existing !== undefined ? existing.pub : { __proto__: null, name, slug, url: '' };
      }
    }
  }
  const tagsList = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Layouts
  const linkOf = (s) => (s === null ? null : {
    __proto__: null,
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
  });

  const cardOf = (s) => ({
    __proto__: null,
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

  const site = { __proto__: null, title: input.site.title, base_url: base };
  const allTags = tagsList.map((t) => ({ __proto__: null, name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recentCount = Math.min(input.site.recent, posts.length);
  const recent = new Array(recentCount);
  for (let i = 0; i < recentCount; i++) recent[i] = cards.get(posts[i]);

  const staticEnv = { __proto__: null, site, tags: allTags, recent };
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
      const fn = compileBodyToFn(folded, staticEnv, itemCaches, dyn);
      r = { fn, needsRm: astUsesProp(folded, 'reading_minutes') };
      compiled.set(key, r);
    }
    return r;
  };

  const output = {};
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const rObj = getRenderer('page', s.layout);
    const renderer = rObj.fn;
    const needsRm = rObj.needsRm;
    const card = s.post ? cards.get(s) : null;
    const tocArr = s.toc;
    const page = card !== null ? {
      __proto__: null,
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
      __proto__: null,
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: needsRm ? Math.max(1, Math.ceil(wordsOf(s.body) / 200)) : 0,
      tags: s.tagRefs,
      slug: s.slug,
      content: s.html,
      toc: tocArr,
      newer: null,
      older: null,
      is_post: false,
    };
    output[`${s.outDir}/index.html`] = renderer({ __proto__: null, site, tags: allTags, recent, page });
  }

  const indexRenderer = getRenderer('index', 'index')?.fn ?? null;
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
        __proto__: null,
        number: k,
        total: pages,
        url: indexUrl(k),
        newer_url: k === 1 ? '' : indexUrl(k - 1),
        older_url: k === pages ? '' : indexUrl(k + 1),
      };
      output[k === 1 ? 'index.html' : `page/${k}/index.html`] = indexRenderer({ __proto__: null, site, tags: allTags, recent, posts: pagePosts, pager });
    }
  }

  const tagRenderer = getRenderer('tag', 'tag')?.fn ?? null;
  if (tagRenderer !== null) {
    for (let i = 0; i < tagsList.length; i++) {
      const t = tagsList[i];
      const tPosts = new Array(t.posts.length);
      for (let j = 0; j < t.posts.length; j++) tPosts[j] = cards.get(t.posts[j]);
      output[`tags/${t.slug}/index.html`] = tagRenderer({
        __proto__: null,
        site,
        tags: allTags,
        recent,
        tag: { __proto__: null, name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: tPosts },
      });
    }
  }

  const tagsRenderer = getRenderer('tags', 'tags')?.fn ?? null;
  if (tagsRenderer !== null) {
    output['tags/index.html'] = tagsRenderer({ __proto__: null, site, tags: allTags, recent });
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
