/*
 * QPS 고속 XLSX 리더 v1.0.0
 *
 * 박스상품 상세정보 파일은 시트 XML이 약 200MB(모든 셀이 inline string)라서 SheetJS의
 * XLSX.read()가 전체 52개 컬럼을 객체로 만드는 데만 20초 이상 걸린다.
 * 이 리더는 브라우저 내장 DecompressionStream으로 시트를 스트리밍 해제하면서
 * 필요한 컬럼만 추출한다. 지원하지 않는 형식이면 예외를 던지고, 호출 측에서 SheetJS로 대체한다.
 *
 * 출력은 XLSX.utils.sheet_to_json(ws, {defval:''})와 같은 형태(헤더 키 객체 배열)이며,
 * 중복 헤더는 SheetJS와 동일하게 '이름_1', '이름_2'로 구분한다.
 * 숫자 셀은 Number, 그 외는 문자열로 반환한다.
 */
(function (global) {
  'use strict';
  const td = new TextDecoder('utf-8');

  function supported() {
    return typeof DecompressionStream === 'function' && typeof TextDecoderStream === 'function' && typeof Blob === 'function';
  }

  // ---------- ZIP (central directory) ----------
  function readZipEntries(buf) {
    const view = new DataView(buf), bytes = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 종료 레코드를 찾지 못함');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    if (p === 0xffffffff) throw new Error('ZIP64 미지원');
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 중앙 디렉터리 손상');
      const method = view.getUint16(p + 10, true), compSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.set(name, { method, compSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }
  function entryStream(buf, entry) {
    const view = new DataView(buf), lo = entry.localOffset;
    if (view.getUint32(lo, true) !== 0x04034b50) throw new Error('ZIP 로컬 헤더 손상');
    const start = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true);
    const blob = new Blob([new Uint8Array(buf, start, entry.compSize)]);
    if (entry.method === 0) return blob.stream().pipeThrough(new TextDecoderStream());
    if (entry.method === 8) return blob.stream().pipeThrough(new DecompressionStream('deflate-raw')).pipeThrough(new TextDecoderStream());
    throw new Error(`지원하지 않는 압축 방식: ${entry.method}`);
  }
  async function readEntryText(buf, entries, name) {
    const entry = entries.get(name);
    if (!entry) return null;
    const reader = entryStream(buf, entry).getReader();
    let out = '';
    for (;;) { const { done, value } = await reader.read(); if (done) break; out += value; }
    return out;
  }

  // ---------- XML helpers ----------
  const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unescapeXml(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITY[e.toLowerCase()];
    });
  }
  // <t>..</t> 조각을 모두 이어 붙임(서식 있는 텍스트 run 포함). 발음 표기(<rPh>)는 제외.
  function textOf(xml) {
    const clean = xml.indexOf('<rPh') >= 0 ? xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '') : xml;
    let out = '', i = 0;
    for (;;) {
      const a = clean.indexOf('<t', i); if (a < 0) break;
      const c = clean.charCodeAt(a + 2);
      if (c !== 62 && c !== 32) { i = a + 2; continue; } // <t> 또는 <t xml:space=..> 만
      const gt = clean.indexOf('>', a); if (clean.charCodeAt(gt - 1) === 47) { i = gt + 1; continue; } // <t/>
      const b = clean.indexOf('</t>', gt); if (b < 0) break;
      out += clean.slice(gt + 1, b); i = b + 4;
    }
    return unescapeXml(out);
  }
  function attr(tag, name) {
    const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
    return m ? m[1] : null;
  }
  function colIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }
  function resolveTarget(target) {
    if (target.startsWith('/')) return target.slice(1);
    return target.startsWith('xl/') ? target : `xl/${target}`;
  }

  // ---------- Workbook ----------
  async function openWorkbook(buf) {
    if (!supported()) throw new Error('브라우저가 DecompressionStream을 지원하지 않음');
    const entries = readZipEntries(buf);
    const wbXml = await readEntryText(buf, entries, 'xl/workbook.xml');
    const relsXml = await readEntryText(buf, entries, 'xl/_rels/workbook.xml.rels');
    if (!wbXml || !relsXml) throw new Error('workbook.xml 없음');
    const rels = new Map();
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) rels.set(attr(m[0], 'Id'), attr(m[0], 'Target'));
    const sheets = [];
    for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
      const target = rels.get(attr(m[0], 'r:id'));
      if (target) sheets.push({ name: unescapeXml(attr(m[0], 'name') || ''), path: resolveTarget(target) });
    }
    let sst = null;
    const loadSst = async () => {
      if (sst) return sst;
      const xml = await readEntryText(buf, entries, 'xl/sharedStrings.xml');
      sst = [];
      if (xml) for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) sst.push(m[1] ? textOf(m[1]) : '');
      return sst;
    };
    return {
      sheetNames: sheets.map(s => s.name),
      // options.keepColumn(header) -> bool : 결과에 포함할 컬럼. options.headerOnly : 헤더 행만 읽음.
      async readSheet(name, options = {}) {
        const sheet = sheets.find(s => s.name === name);
        if (!sheet || !entries.has(sheet.path)) throw new Error(`시트 없음: ${name}`);
        const strings = await loadSst();
        return parseSheet(entryStream(buf, entries.get(sheet.path)), strings, options);
      }
    };
  }

  function cellValue(tagOpen, body, strings) {
    const t = attr(tagOpen, 't') || 'n';
    if (t === 'inlineStr') return textOf(body);
    const v0 = body.indexOf('<v'); if (v0 < 0) return '';
    const vs = body.indexOf('>', v0) + 1, ve = body.indexOf('</v>', vs);
    const raw = ve < 0 ? '' : body.slice(vs, ve);
    if (t === 's') return strings[Number(raw)] ?? '';
    if (t === 'n') { const n = Number(raw); return raw === '' || !Number.isFinite(n) ? raw : n; }
    if (t === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
    return unescapeXml(raw); // str, e, d
  }

  // 한 행의 XML에서 wanted 컬럼(Map<colIdx, key>)만 추출. wanted가 null이면 전체를 배열로 반환.
  function parseRow(xml, strings, wanted) {
    const out = wanted ? {} : [];
    let i = 0, seq = 0;
    for (;;) {
      let a = xml.indexOf('<c', i); if (a < 0) break;
      const ch = xml.charCodeAt(a + 2);
      if (ch !== 32 && ch !== 62 && ch !== 47) { i = a + 2; continue; } // <col 등 제외
      const gt = xml.indexOf('>', a);
      const tagOpen = xml.slice(a, gt);
      const r = attr(tagOpen, 'r');
      const col = r ? colIndex(r) : seq;
      seq = col + 1;
      const selfClosing = xml.charCodeAt(gt - 1) === 47;
      let body = '', next = gt + 1;
      if (!selfClosing) { const end = xml.indexOf('</c>', gt); body = xml.slice(gt + 1, end); next = end + 4; }
      i = next;
      if (wanted) { const k = wanted.get(col); if (k !== undefined) out[k] = selfClosing ? '' : cellValue(tagOpen, body, strings); }
      else out[col] = selfClosing ? '' : cellValue(tagOpen, body, strings);
    }
    return out;
  }

  async function parseSheet(stream, strings, options) {
    const reader = stream.getReader();
    let buf = '', inData = false, headers = null, wanted = null, keys = null;
    const rows = [];
    const handleRow = xml => {
      if (!headers) {
        const arr = parseRow(xml, strings, null);
        headers = dedupe(Array.from(arr, v => v ?? ''));
        keys = headers.filter(h => !options.keepColumn || options.keepColumn(h));
        wanted = new Map();
        headers.forEach((h, i) => { if (!options.keepColumn || options.keepColumn(h)) wanted.set(i, h); });
        return;
      }
      const obj = parseRow(xml, strings, wanted);
      let any = false;
      for (const k of keys) { if (obj[k] === undefined) obj[k] = ''; else if (obj[k] !== '') any = true; }
      if (any) rows.push(obj); // sheet_to_json(blankrows:false)와 동일하게 빈 행 제외
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += value;
      if (!inData) {
        const s = buf.indexOf('<sheetData');
        if (s < 0) { if (done) break; continue; }
        const gt = buf.indexOf('>', s); if (gt < 0) { if (done) break; continue; }
        if (buf.charCodeAt(gt - 1) === 47) break; // <sheetData/>
        buf = buf.slice(gt + 1); inData = true;
      }
      let pos = 0;
      for (;;) {
        const a = buf.indexOf('<row', pos); if (a < 0) break;
        const gt = buf.indexOf('>', a); if (gt < 0) break;
        if (buf.charCodeAt(gt - 1) === 47) { pos = gt + 1; continue; } // <row .../> 빈 행
        const end = buf.indexOf('</row>', gt); if (end < 0) break;
        handleRow(buf.slice(gt + 1, end));
        pos = end + 6;
        if (options.headerOnly && headers) { reader.cancel(); return { headers, rows: [] }; }
      }
      buf = buf.slice(pos);
      if (done || buf.indexOf('</sheetData>') >= 0 && buf.indexOf('<row') < 0) { if (done) break; reader.cancel(); break; }
    }
    return { headers: headers || [], rows };
  }

  // SheetJS와 동일한 중복 헤더 규칙: 두 번째부터 '_1', '_2' ...
  function dedupe(raw) {
    const count = new Map();
    return raw.map((h, i) => {
      const base = String(h).trim() === '' ? `__EMPTY${count.has('__EMPTY') ? '_' + count.get('__EMPTY') : ''}` : String(h);
      const key = String(h).trim() === '' ? '__EMPTY' : base;
      if (!count.has(key)) { count.set(key, 1); return base; }
      const n = count.get(key); count.set(key, n + 1);
      return String(h).trim() === '' ? `__EMPTY_${n}` : `${base}_${n}`;
    });
  }

  global.QPSFastXlsx = Object.freeze({ version: '1.0.0', supported, openWorkbook });
})(typeof window !== 'undefined' ? window : globalThis);
