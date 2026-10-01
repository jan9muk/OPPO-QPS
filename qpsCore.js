/*
 * QPS Core v1.2.0 — 화면(DOM)과 무관한 데이터 처리 로직
 *
 * index.html(화면)과 tests/(회귀 테스트)가 같은 코드를 쓰도록 분리한 파일.
 * v1.2.0: buildAllData()가 작업대별 잔여 지시 PCS 상위 SKU(wsTopSkus: 셀·현재고·지시/잔여 PCS·토트)를 함께 계산
 *   (현장 요약의 '작업대별 보충 우선 SKU' 표시용).
 *
 * 클래식 스크립트로 로드되며, 여기서 선언한 함수·상수는 index.html의 메인 스크립트에서 그대로 쓴다.
 * 이 파일을 수정하면 index.html의 <script src="qpsCore.js?v=..."> 버전도 함께 올릴 것(브라우저 캐시 무효화).
 */
'use strict';

// ---------- 상태·설비 레이아웃 ----------
const COMPLETE_STATUS = new Set(['피킹완료', '패킹완료', '출하완료']);
const EXCLUDE_STATUS = new Set(['전체취소', '전체결품']);
const machineList = ['APS1', 'APS2', 'APS3'];
const WS_TOP_SKU_COUNT = 3; // 작업대별 우선 보충 필요 SKU(잔여 지시 PCS 상위) 표시 수
// prettier-ignore
const zoneDefs={APS1:{label:'1호기',cols:[{zone:'A존',order:['APS1-01','APS1-02','APS1-03','APS1-04','APS1-05','APS1-06','APS1-07','APS1-08','APS1-09','APS1-10']},{zone:'B존',order:['APS1-20','APS1-19','APS1-18','APS1-17','APS1-16','APS1-15','APS1-14','APS1-13','APS1-12','APS1-11']}]},APS2:{label:'2호기',cols:[{zone:'C존',order:['APS2-01','APS2-02','APS2-03','APS2-04','APS2-05','APS2-06','APS2-07','APS2-08','APS2-09','APS2-10']},{zone:'D존',order:['APS2-20','APS2-19','APS2-18','APS2-17','APS2-16','APS2-15','APS2-14','APS2-13','APS2-12','APS2-11']}]},APS3:{label:'3호기',cols:[{zone:'E존',order:[null,'APS3-07','APS3-06','APS3-05','APS3-04',null,null,'APS3-03','APS3-02','APS3-01',null,null]},{zone:'F존',order:['APS3-08','APS3-09','APS3-10','APS3-11','APS3-12','APS3-13','APS3-14','APS3-15','APS3-16','APS3-17','APS3-18','APS3-19']} ]}};

// 존별 작업대(W/S) 거리 순위: 존 → [1선 랙번호들, 2선, ...]. 6자리 값은 랙+단+칸(예: 010106) 단위.
// 히트맵의 'W/S 최인접' 표시와 규칙 엔진의 거리 점수가 이 표 하나를 함께 쓴다.
// prettier-ignore
const DISTANCE_MAP=Object.freeze({A01:[['05'],['06'],['01','03'],['02','04']],A02:[['02'],['01'],['03','05'],['04','06']],A03:[['05','06'],['01','03'],['02','04']],A04:[['02','03'],['01'],['04','06'],['05','07']],A05:[['02','01'],['03','05'],['04','06']],A06:[['05'],['06'],['01','03'],['02','04']],A07:[['02'],['01','03'],['04','06'],['05','07']],A08:[['01','03','05','07'],['02','04','06','08']],A09:[['010106','010107','010108','010109','010110'],['010104','010105','010111','010112'],['010101','010102','010103','010113','010114']],A10:[['010105','010106','010107','010108','010109','010110'],['010101','010102','010103','010104']],B01:[['02'],['01'],['03','05'],['04','06']],B02:[['05'],['06'],['01','03'],['02','04']],B03:[['02'],['01'],['03','05'],['04','06']],B04:[['05'],['06'],['01','03'],['02','04']],B05:[['02'],['01'],['03','05'],['04','06']],B06:[['05'],['06'],['01','03'],['02','04']],B07:[['02'],['03'],['01'],['04','06'],['05','07']],B08:[['01','03'],['05','07'],['02','04'],['06','08']],B09:[['01','02'],['03','05'],['04','06']],B10:[['05'],['06'],['01','03'],['02','04']],C01:[['05'],['06'],['01','03'],['02','04']],C02:[['02'],['01'],['03','05'],['04','06']],C03:[['05','06'],['01','03'],['02','04']],C04:[['03'],['02'],['01'],['04','06'],['05','07']],C05:[['02'],['01'],['03','05'],['04','06']],C06:[['05'],['06'],['01','03'],['02','04']],C07:[['02'],['03'],['01'],['04','06'],['05','07']],C08:[['01','03'],['05','07'],['02','04'],['06','08']],C09:[['02','03'],['01','04']],C10:[['010105','010106','010107','010108','010109'],['010103','010104','010110','010111'],['010101','010102']],D01:[['03','05'],['04','06'],['01'],['02']],D02:[['01','03'],['05'],['02','04'],['06']],D03:[['02'],['01'],['03','05'],['04','06']],D04:[['05'],['06'],['01','03'],['02','04']],D05:[['02','01'],['03','05'],['04','06']],D06:[['05'],['06'],['01','03'],['02','04']],D07:[['01','02'],['03','05'],['04','06']],D08:[['01','03'],['05','07'],['02','04'],['06','08'],['09','11'],['10','12']],D09:[['01','03'],['05','07'],['02','04'],['06','08'],['09','11'],['10','12']],D10:[['05','07'],['01','03'],['06','08'],['02','04'],['09','11'],['10','12']],E01:[['01','02'],['03','05'],['04','06']],E02:[['05'],['06'],['01','03'],['02','04']],E03:[['01','03'],['02','04'],['05','07'],['06','08']],E04:[['07'],['01','03','05'],['02','04'],['06','08']],E05:[['01','03'],['02','04'],['06'],['05','07']],E06:[['01','03','05','07'],['02','04','06','08']],E07:[['01','03'],['05'],['02','04'],['06']],F01:[['04'],['03'],['02'],['01']],F02:[['04'],['03'],['02'],['01']],F03:[['04'],['03'],['02'],['01']],F04:[['04'],['03'],['02'],['01']],F05:[['04'],['03'],['02'],['01']],F06:[['04'],['03'],['02'],['01']],F07:[['03'],['02','04'],['01']],F08:[['03'],['02','04'],['01']],F09:[['03'],['02','04'],['01']],F10:[['02'],['01','03'],['04']],F11:[['02'],['01','03'],['04']],F12:[['02','03'],['01'],['04']]});

// ---------- 값 정규화 ----------
function toNumber(v) {
  const n = Number(
    String(v ?? '')
      .replace(/,/g, '')
      .trim()
  );
  return Number.isFinite(n) ? n : 0;
}
function normalizeSku(v) {
  const s = String(v ?? '')
    .trim()
    .replace(/\.0+$/, '')
    .replace(/\D/g, '');
  return s ? s.padStart(13, '0') : '';
}
function normalizeWs(v) {
  const m = String(v ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .match(/APS([123])[- ]?(\d{1,2})/);
  return m ? `APS${m[1]}-${m[2].padStart(2, '0')}` : null;
}
function normalizeTemp(v) {
  const s = String(v ?? '').trim();
  return s === 'WET 냉동' ? 'frozen' : s === 'WET 일반' || s === 'WET 냉장' ? 'chilled' : 'unknown';
}
function getProductName(r) {
  return String(r['물류상품명'] || r['상품명'] || '').trim();
}
function normalizeSheetName(v) {
  return String(v || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}
function headersOfRows(rows) {
  return rows?.length ? Object.keys(rows[0]) : [];
}

// ---------- 엑셀 해석: 시트 선택·필요 컬럼만 보관 ----------
// xlsxFastReader.js(스트리밍, 필요한 컬럼만 추출)를 쓰고, 실패 시 index.html이 SheetJS로 대체한다.
// 대시보드·규칙 엔진이 쓰는 컬럼만 보관해 메모리·캐시 크기와 로딩 시간을 줄인다.
function findStatusColumns(headers) {
  const a = headers.filter(h => String(h).includes('WMS배송진행상태'));
  return { all: a, primary: a.at(-1) || null };
}
const REQUIRED_HEADERS = {
  box: ['물류상품ID', '피킹지시수량'],
  cell: ['작업대', '물류상품ID', '보관위치', '랙유형', '물류분류코드', '현재고']
};
const PREFERRED_SHEETS = { box: ['박스상품상세정보'], cell: ['셀할당현황', '셀할당 현황'] };
const KEEP_COLUMNS = {
  box: new Set([
    '물류상품ID',
    '물류상품명',
    '상품명',
    '피킹지시수량',
    '배송번호',
    '배송박스순번',
    '수정일시',
    '박스설비라인상세유형'
  ]),
  cell: new Set([
    '작업대',
    '물류상품ID',
    '보관위치',
    '랙유형',
    '물류분류코드',
    '현재고',
    '물류상품명',
    '상품명',
    '대분류',
    '중분류',
    '소분류'
  ])
};
// ruleEngine.js OPTIONAL_FIELDS(업체·분류·중량·입고예정·파손·행사)에 해당할 수 있는 컬럼은 함께 보관
const ENGINE_OPTIONAL_COLUMN =
  /중량|입고|행사|프로모션|낙손|파손|취급주의|업체|공급|거래처|카테고리|상품분류|상품군|vendor|supplier|weight|event|promotion|fragile|category|inbound|incoming/i;
function keepColumnFor(type) {
  const keep = KEEP_COLUMNS[type];
  return h => {
    const k = String(h).replace(/\s/g, '');
    return (
      keep.has(k) ||
      k.includes('WMS배송진행상태') ||
      k.includes('박스설비라인상세유형') ||
      ENGINE_OPTIONAL_COLUMN.test(k)
    );
  };
}
function pruneRows(rows, type) {
  if (!rows?.length || !type) return rows || [];
  const keep = keepColumnFor(type),
    cols = headersOfRows(rows).filter(keep);
  return rows.map(r => {
    const o = {};
    for (const c of cols) o[c] = r[c];
    return o;
  });
}
function detectType(headers) {
  if (REQUIRED_HEADERS.cell.every(h => headers.includes(h))) return 'cell';
  if (REQUIRED_HEADERS.box.every(h => headers.includes(h))) return 'box';
  return null;
}
function pickSheet(sheets, type, fallbackType) {
  let fallback = null;
  for (const s of sheets) {
    const t = detectType(s.headers);
    if (t && (!type || t === type)) return { name: s.name, type: t };
    const ft = type || fallbackType;
    if (!fallback && ft && PREFERRED_SHEETS[ft].some(p => normalizeSheetName(s.name).includes(normalizeSheetName(p))))
      fallback = { name: s.name, type: ft };
  }
  return fallback;
}
async function parseWorkbookFast(buf, type, fallbackType) {
  const wb = await QPSFastXlsx.openWorkbook(buf),
    sheets = [];
  for (const name of wb.sheetNames) {
    const { headers } = await wb.readSheet(name, { headerOnly: true });
    sheets.push({ name, headers });
    if (detectType(headers) && (!type || detectType(headers) === type)) break;
  }
  const pick = pickSheet(sheets, type, fallbackType);
  if (!pick) return { sheetName: null, rows: [], type: null };
  const { rows } = await wb.readSheet(pick.name, { keepColumn: keepColumnFor(pick.type) });
  return { sheetName: pick.name, rows, type: detectType(headersOfRows(rows)) };
}

// ---------- 입력 검증 ----------
function validateRows(rows, type) {
  if (!rows?.length) return `${type} 시트에 데이터가 없습니다.`;
  const h = headersOfRows(rows),
    required =
      type === '박스상품 상세정보'
        ? ['물류상품ID', '피킹지시수량', '배송번호', '배송박스순번']
        : ['작업대', '물류상품ID', '보관위치', '랙유형', '물류분류코드', '현재고'];
  for (const col of required) if (!h.includes(col)) return `${type} 시트에 "${col}" 컬럼이 없습니다.`;
  if (type === '박스상품 상세정보' && !findStatusColumns(h).primary)
    return `${type} 시트에 "WMS배송진행상태" 컬럼을 찾지 못했습니다.`;
  return null;
}
function normalizeCellRecord(row) {
  return {
    location: String(row['보관위치'] || '').trim(),
    sku: normalizeSku(row['물류상품ID']),
    ws: normalizeWs(row['작업대']),
    stock: toNumber(row['현재고']),
    rack: String(row['랙유형'] || '').trim(),
    temp: String(row['물류분류코드'] || '').trim()
  };
}
function mergeAndValidateCellRows(results) {
  const byLocation = new Map(),
    warnings = [];
  for (const result of results) {
    for (const row of result.rows) {
      const v = normalizeCellRecord(row);
      if (!v.location) {
        warnings.push(`${result.file.name}: 보관위치가 빈 행 1건 제외`);
        continue;
      }
      const old = byLocation.get(v.location);
      if (!old) {
        byLocation.set(v.location, { row, file: result.file.name, normalized: v });
        continue;
      }
      const same =
        old.normalized.sku === v.sku &&
        old.normalized.ws === v.ws &&
        old.normalized.stock === v.stock &&
        old.normalized.rack === v.rack &&
        old.normalized.temp === v.temp;
      if (!same)
        throw new Error(
          `셀 데이터 충돌: 보관위치 ${v.location}이(가) "${old.file}" 및 "${result.file.name}"에 서로 다르게 존재합니다. 파일을 정정한 뒤 다시 업로드하세요.`
        );
      warnings.push(`중복 동일 셀 제거: ${v.location}`);
    }
  }
  return { rows: [...byLocation.values()].map(x => x.row), warnings };
}

// ---------- 집계 ----------
function makeToteKey(row) {
  const d = String(row['배송번호'] || '').trim(),
    b = String(row['배송박스순번'] || '').trim();
  return d && b ? `${d}__${b}` : '';
}
function parseExcelDate(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return new Date(d.getTime() + d.getTimezoneOffset() * 6e4);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function buildAllData(bRows, cRows) {
  const headers = headersOfRows(bRows),
    statusCol = findStatusColumns(headers).primary,
    updateDateCol = headers.find(h => String(h).replace(/\s/g, '') === '수정일시'),
    routingCol = headers.find(h => String(h).replace(/\s/g, '').includes('박스설비라인상세유형')),
    valid2F = new Set(['APS2F_Only', 'AS_APS2F', 'AS_APS3M_APS2F', 'APS3M_APS2F']);
  const skuToPcs = new Map(),
    skuMeta = new Map(),
    skuToToteCount = new Map(),
    skuToWsSet = new Map(),
    assignedCells = [],
    emptyCells = [],
    zonesFound = new Set(),
    wsMetrics = new Map();
  for (const row of cRows) {
    const ws = normalizeWs(row['작업대']),
      sku = normalizeSku(row['물류상품ID']),
      location = String(row['보관위치'] || '').trim(),
      zone = location.slice(0, 3),
      cell = {
        ws,
        sku,
        location,
        zone,
        rackType: String(row['랙유형'] || '').trim(),
        temp: normalizeTemp(row['물류분류코드']),
        stock: toNumber(row['현재고']),
        isEmpty: !sku,
        productName: getProductName(row)
      };
    if (zone.length === 3) zonesFound.add(zone);
    if (cell.isEmpty) emptyCells.push(cell);
    else {
      assignedCells.push(cell);
      if (!skuToWsSet.has(sku)) skuToWsSet.set(sku, new Set());
      if (ws) skuToWsSet.get(sku).add(ws);
      if (ws && !wsMetrics.has(ws))
        wsMetrics.set(ws, { inboundTotes: new Set(), totalTouches: 0, completeTouches: 0, totalTouchPcs: 0 });
    }
  }
  const touchMap = new Map(),
    toteStatusMap = new Map(),
    wsToteToSkus = new Map(),
    allOrders = new Set(),
    allTotes = new Set(),
    eqOrders = new Set(),
    eqTotes = new Set();
  let latestDataTimeMs = 0;
  for (const row of bRows) {
    const sku = normalizeSku(row['물류상품ID']),
      toteKey = makeToteKey(row),
      deliveryNo = String(row['배송번호'] || '').trim();
    if (!sku || !toteKey) continue;
    const pcs = toNumber(row['피킹지시수량']),
      status = String(statusCol ? row[statusCol] : '').trim();
    if (EXCLUDE_STATUS.has(status)) continue;
    const route = String(routingCol ? row[routingCol] : '').trim(),
      is2F = routingCol ? valid2F.has(route) : true,
      isBypass = /bypass|바이패스|직행/i.test(route);
    if (deliveryNo) {
      allOrders.add(deliveryNo);
      allTotes.add(toteKey);
      if (!isBypass) {
        eqOrders.add(deliveryNo);
        eqTotes.add(toteKey);
      }
    }
    let time = 0;
    if (updateDateCol) {
      const d = parseExcelDate(row[updateDateCol]);
      if (d) {
        time = d.getTime();
        latestDataTimeMs = Math.max(latestDataTimeMs, time);
      }
    }
    if (!skuMeta.has(sku)) skuMeta.set(sku, { name: getProductName(row) });
    skuToPcs.set(sku, (skuToPcs.get(sku) || 0) + pcs);
    if (!toteStatusMap.has(toteKey)) toteStatusMap.set(toteKey, { isComplete: true, is2F: false, completionTime: 0 });
    const tote = toteStatusMap.get(toteKey);
    if (is2F) tote.is2F = true;
    if (!COMPLETE_STATUS.has(status)) tote.isComplete = false;
    tote.completionTime = Math.max(tote.completionTime, time);
    const key = `${toteKey}||${sku}`;
    if (!touchMap.has(key)) {
      touchMap.set(key, { pcs: 0, isComplete: true, wsSet: new Set() });
      skuToToteCount.set(sku, (skuToToteCount.get(sku) || 0) + 1);
    }
    const entry = touchMap.get(key);
    entry.pcs += pcs;
    if (!COMPLETE_STATUS.has(status)) entry.isComplete = false;
    for (const ws of skuToWsSet.get(sku) || []) {
      entry.wsSet.add(ws);
      const wk = `${ws}||${toteKey}`;
      if (!wsToteToSkus.has(wk)) wsToteToSkus.set(wk, new Set());
      wsToteToSkus.get(wk).add(sku);
    }
  }
  let total2FTotes = 0,
    comp2FTotes = 0;
  const comp2FTimes = [];
  for (const t of toteStatusMap.values())
    if (t.is2F) {
      total2FTotes++;
      if (t.isComplete) {
        comp2FTotes++;
        if (t.completionTime) comp2FTimes.push(t.completionTime);
      }
    }
  let totalDirectedTouches = 0,
    totalCompleteTouches = 0;
  const wsSkuStats = new Map(); // ws → (sku → { totes, pcs, remainPcs })
  for (const [key, entry] of touchMap) {
    const [toteKey, sku] = key.split('||');
    for (const ws of entry.wsSet) {
      if (!wsSkuStats.has(ws)) wsSkuStats.set(ws, new Map());
      const bySku = wsSkuStats.get(ws),
        st = bySku.get(sku) || { totes: 0, pcs: 0, remainPcs: 0 };
      st.totes++;
      st.pcs += entry.pcs;
      if (!entry.isComplete) st.remainPcs += entry.pcs;
      bySku.set(sku, st);
      const m = wsMetrics.get(ws);
      if (!m) continue;
      m.inboundTotes.add(toteKey);
      m.totalTouches++;
      m.totalTouchPcs += entry.pcs;
      totalDirectedTouches++;
      if (entry.isComplete) {
        m.completeTouches++;
        totalCompleteTouches++;
      }
    }
  }
  // 작업대별 잔여(미완료) 지시 PCS 상위 SKU(우선 보충 대상): 이 작업대의 보관위치·현재고와 지시·잔여 PCS
  const skuCellsByWs = new Map(),
    cellNames = new Map();
  for (const c of assignedCells) {
    if (!c.ws) continue;
    const k = `${c.ws}||${c.sku}`;
    if (!skuCellsByWs.has(k)) skuCellsByWs.set(k, { cells: [], stock: 0 });
    const v = skuCellsByWs.get(k);
    v.cells.push(c.location);
    v.stock += c.stock;
    if (c.productName && !cellNames.has(c.sku)) cellNames.set(c.sku, c.productName);
  }
  const wsTopSkus = {};
  for (const [ws, bySku] of wsSkuStats)
    wsTopSkus[ws] = [...bySku]
      .filter(([, st]) => st.remainPcs > 0) // 피킹이 끝난 SKU는 보충 대상 아님
      .sort((a, b) => b[1].remainPcs - a[1].remainPcs || b[1].pcs - a[1].pcs || (a[0] < b[0] ? -1 : 1))
      .slice(0, WS_TOP_SKU_COUNT)
      .map(([sku, st]) => {
        const at = skuCellsByWs.get(`${ws}||${sku}`) || { cells: [], stock: 0 };
        return {
          sku,
          name: cellNames.get(sku) || skuMeta.get(sku)?.name || '',
          cells: at.cells.sort(),
          stock: at.stock,
          ...st
        };
      });
  const wsResult = {};
  for (const [ws, m] of wsMetrics)
    wsResult[ws] = {
      inboundToteCount: m.inboundTotes.size,
      totalTouches: m.totalTouches,
      completeTouches: m.completeTouches,
      totalTouchPcs: m.totalTouchPcs,
      progressRate: m.totalTouches ? m.completeTouches / m.totalTouches : 0,
      pcsPerTouch: m.totalTouches ? m.totalTouchPcs / m.totalTouches : 0
    };
  const skuIncompleteTotes = new Map(),
    wsIncompleteTotes = new Map(),
    wsIncompleteComplexTotes = new Map();
  for (const [wk, skus] of wsToteToSkus) {
    const [ws, toteKey] = wk.split('||'),
      t = toteStatusMap.get(toteKey);
    if (!t || t.isComplete) continue;
    if (!wsIncompleteTotes.has(ws)) wsIncompleteTotes.set(ws, new Set());
    wsIncompleteTotes.get(ws).add(toteKey);
    for (const sku of skus) {
      if (!skuIncompleteTotes.has(sku)) skuIncompleteTotes.set(sku, new Set());
      skuIncompleteTotes.get(sku).add(toteKey);
    }
    if (skus.size >= 2) {
      if (!wsIncompleteComplexTotes.has(ws)) wsIncompleteComplexTotes.set(ws, new Set());
      wsIncompleteComplexTotes.get(ws).add(toteKey);
    }
  }
  return {
    skuToPcs,
    skuToToteCount,
    skuMeta,
    wsMetrics: wsResult,
    wsTopSkus,
    emptyCells,
    assignedCells,
    totalDirectedTouches,
    totalCompleteTouches,
    total2FTotes,
    comp2FTotes,
    comp2FTimes,
    latestDataTimeMs,
    skuIncompleteTotes,
    wsIncompleteTotes,
    wsIncompleteComplexTotes,
    skuToWsSet,
    zonesFound: [...zonesFound].sort(),
    allSplitRate: allOrders.size ? allTotes.size / allOrders.size : 0,
    eqSplitRate: eqOrders.size ? eqTotes.size / eqOrders.size : 0
  };
}
function computeZoneStats(metrics) {
  const result = {};
  for (const machine of machineList) {
    let mi = 0,
      mt = 0,
      mc = 0,
      mp = 0;
    result[machine] = { zones: {} };
    for (const col of zoneDefs[machine].cols) {
      let i = 0,
        t = 0,
        c = 0,
        p = 0;
      for (const ws of col.order) {
        if (!ws) continue;
        const m = metrics[ws] || {};
        i += m.inboundToteCount || 0;
        t += m.totalTouches || 0;
        c += m.completeTouches || 0;
        p += m.totalTouchPcs || 0;
        mi += m.inboundToteCount || 0;
        mt += m.totalTouches || 0;
        mc += m.completeTouches || 0;
        mp += m.totalTouchPcs || 0;
      }
      result[machine].zones[col.zone] = {
        inboundTotes: i,
        totalTouches: t,
        completeTouches: c,
        progressRate: t ? c / t : 0,
        pcsPerTouch: t ? p / t : 0
      };
    }
    result[machine] = {
      ...result[machine],
      inboundTotes: mi,
      totalTouches: mt,
      completeTouches: mc,
      progressRate: mt ? mc / mt : 0,
      pcsPerTouch: mt ? mp / mt : 0
    };
  }
  return result;
}

// 테스트(Node)에서 명시적으로 접근하기 위한 묶음. 브라우저에서는 위 전역 선언을 그대로 사용한다.
globalThis.QPSCore = Object.freeze({
  version: '1.2.0',
  DISTANCE_MAP,
  COMPLETE_STATUS,
  EXCLUDE_STATUS,
  machineList,
  zoneDefs,
  toNumber,
  normalizeSku,
  normalizeWs,
  normalizeTemp,
  getProductName,
  normalizeSheetName,
  headersOfRows,
  findStatusColumns,
  REQUIRED_HEADERS,
  KEEP_COLUMNS,
  keepColumnFor,
  pruneRows,
  detectType,
  pickSheet,
  parseWorkbookFast,
  validateRows,
  normalizeCellRecord,
  mergeAndValidateCellRows,
  makeToteKey,
  parseExcelDate,
  buildAllData,
  computeZoneStats
});
