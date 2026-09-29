/*
 * 테스트 공용 도우미
 * - 브라우저와 같은 방식(클래식 스크립트, 전역 공유)으로 xlsxFastReader.js · qpsCore.js · ruleEngine.js를 로드
 * - 가상의 셀/출고 데이터로 시나리오를 만들어 실제 파이프라인(buildAllData → recommend)을 실행
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let loaded = false;
function loadApp() {
  if (!loaded) {
    globalThis.window = globalThis;
    for (const f of ['xlsxFastReader.js', 'qpsCore.js', 'ruleEngine.js']) {
      vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
    }
    loaded = true;
  }
  return { core: globalThis.QPSCore, engine: globalThis.QPSRuleEngine, fast: globalThis.QPSFastXlsx };
}

// ---------- 시나리오 데이터 ----------
let skuSeq = 0;
const nextSku = () => String(++skuSeq).padStart(13, '0');

// 할당 셀: cell('D01-010101', {name, group, sub, stock, out, rack})
// 공셀:    cell('D03-010101', {rack})
function cell(location, o = {}) {
  const sku = o.name ? (o.sku || nextSku()) : '';
  return {
    sku, out: o.out || 0, totes: o.totes,
    row: {
      '작업대': o.ws || 'APS2-01', '보관위치': location, '랙유형': o.rack || 'Shelf Rack',
      '물류분류코드': sku ? (o.temp || 'WET 냉장') : '', '물류상품ID': sku, '물류상품명': o.name || '',
      '현재고': String(o.stock ?? (sku ? 20 : '')), '대분류': '', '중분류': o.group || '', '소분류': o.sub || ''
    }
  };
}

// 출고 지시(박스상품 상세정보) 행 생성: pcs를 totes개의 토트로 나눔
function orderRows(sku, pcs, totes) {
  const rows = [], n = Math.max(1, totes || Math.min(pcs, 20));
  for (let i = 0; i < n; i++) {
    const q = Math.floor(pcs / n) + (i < pcs % n ? 1 : 0);
    if (!q) continue;
    rows.push({ '물류상품ID': sku, '물류상품명': '', '피킹지시수량': String(q), '배송번호': `D${sku}${i}`, '배송박스순번': '1',
      'WMS배송진행상태': '피킹지시', '박스설비라인상세유형': 'APS2F_Only', '수정일시': '2026-09-27 15:00:00' });
  }
  return rows;
}

// 시나리오 실행 → { data, recs, of(name) : 해당 상품의 추천(없으면 undefined) }
function run(cells) {
  const { core, engine } = loadApp();
  const cellRows = cells.map(c => c.row);
  const boxRows = cells.filter(c => c.sku && c.out).flatMap(c => orderRows(c.sku, c.out, c.totes));
  if (!boxRows.length) boxRows.push(...orderRows('9999999999999', 1, 1)); // 박스 파일이 비지 않도록
  const data = core.buildAllData(boxRows, cellRows);
  data.cellRows = cellRows; data.boxRows = boxRows;
  const recs = engine.recommend(data);
  const byName = new Map(cells.filter(c => c.sku).map(c => [c.row['물류상품명'], c.sku]));
  return { data, recs, of: name => recs.find(r => r.sku === byName.get(name)) };
}

module.exports = { ROOT, loadApp, cell, run };
