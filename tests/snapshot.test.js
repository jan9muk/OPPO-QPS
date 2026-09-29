/*
 * ② 전체 결과 비교 테스트 — 저장소의 시연용 목업 데이터(box_latest.xlsx / cell_latest.xlsx)로
 * 화면과 같은 경로(고속 리더 → 컬럼 정리 → buildAllData → recommend)를 실행하고, 기준값과 비교한다.
 *
 * 결과가 달라지면 실패하며 무엇이 바뀌었는지 요약을 출력한다.
 *  - 의도한 변화: `node tests/run.js --update`로 기준값을 갱신하고, 커밋 메시지에 사유를 남긴다.
 *  - 의도하지 않은 변화: 버그. 코드를 고친다.
 * 목업 xlsx를 교체한 경우에도 기준값을 갱신해야 한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { ROOT, loadApp } = require('./lib');

const BASELINE = path.join(__dirname, 'baseline', 'snapshot.json');

async function parse(file, type) {
  const { core } = loadApp();
  const b = fs.readFileSync(path.join(ROOT, file));
  const r = await core.parseWorkbookFast(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), type, type);
  assert.equal(r.type, type, `${file}: 유형 판별 실패`);
  return r.rows;
}

let cached = null;
async function snapshot() {
  if (cached) return cached;
  const { core, engine } = loadApp();
  const [boxRows, cellRows] = await Promise.all([parse('box_latest.xlsx', 'box'), parse('cell_latest.xlsx', 'cell')]);
  const d = core.buildAllData(boxRows, cellRows);
  d.cellRows = cellRows; d.boxRows = boxRows;
  const recs = engine.recommend(d);
  const round = n => Math.round(n * 1e6) / 1e6;
  return cached = {
    input: { boxRows: boxRows.length, cellRows: cellRows.length, boxColumns: Object.keys(boxRows[0]), cellColumns: Object.keys(cellRows[0]) },
    aggregates: {
      totalDirectedTouches: d.totalDirectedTouches, totalCompleteTouches: d.totalCompleteTouches,
      total2FTotes: d.total2FTotes, comp2FTotes: d.comp2FTotes, latestDataTime: new Date(d.latestDataTimeMs).toISOString(),
      assignedCells: d.assignedCells.length, emptyCells: d.emptyCells.length,
      allSplitRate: round(d.allSplitRate), eqSplitRate: round(d.eqSplitRate),
      zoneStats: core.computeZoneStats(d.wsMetrics), wsMetrics: d.wsMetrics
    },
    recommendations: recs.map(r => ({ sku: r.sku, name: r.productName, priorityType: r.priorityType, moveType: r.moveType, status: r.status,
      zoneEviction: r.zoneEviction, from: r.currentCell, to: r.targetCell, urgency: r.urgency, reason: r.reason }))
  };
}

function describeDiff(base, cur) {
  const lines = [];
  for (const k of Object.keys(cur.input)) if (JSON.stringify(base.input[k]) !== JSON.stringify(cur.input[k])) lines.push(`입력 ${k}: ${JSON.stringify(base.input[k])} → ${JSON.stringify(cur.input[k])}`);
  for (const k of Object.keys(cur.aggregates)) if (JSON.stringify(base.aggregates[k]) !== JSON.stringify(cur.aggregates[k])) lines.push(`집계 ${k} 변경`);
  const count = list => list.reduce((m, r) => (m[r.priorityType + '/' + r.moveType] = (m[r.priorityType + '/' + r.moveType] || 0) + 1, m), {});
  const bc = count(base.recommendations), cc = count(cur.recommendations);
  for (const k of new Set([...Object.keys(bc), ...Object.keys(cc)])) if (bc[k] !== cc[k]) lines.push(`추천 ${k}: ${bc[k] || 0} → ${cc[k] || 0}건`);
  const bm = new Map(base.recommendations.map(r => [r.sku, r])), cm = new Map(cur.recommendations.map(r => [r.sku, r]));
  const detail = [];
  for (const [sku, r] of cm) {
    const b = bm.get(sku);
    if (!b) detail.push(`+ ${r.name} ${r.from}→${r.to} [${r.priorityType}] ${r.reason.split(' · ')[0]}`);
    else if (JSON.stringify(b) !== JSON.stringify(r)) {
      const f = Object.keys(r).filter(k => JSON.stringify(b[k]) !== JSON.stringify(r[k])).map(k => `${k}: ${JSON.stringify(b[k])} → ${JSON.stringify(r[k])}`);
      detail.push(`~ ${r.name} ${f.join(', ')}`);
    }
  }
  for (const [sku, r] of bm) if (!cm.has(sku)) detail.push(`- ${r.name} ${r.from}→${r.to} [${r.priorityType}]`);
  if (detail.length) lines.push(`추천 변경 ${detail.length}건:`, ...detail.slice(0, 20).map(x => '  ' + x), ...(detail.length > 20 ? [`  … 외 ${detail.length - 20}건`] : []));
  return lines.join('\n');
}

test('목업 데이터 전체 결과가 기준값과 동일', async () => {
  const cur = await snapshot();
  if (global.UPDATE_BASELINE || !fs.existsSync(BASELINE)) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(cur, null, 1) + '\n');
    console.log(`    기준값 저장: ${path.relative(ROOT, BASELINE)} (추천 ${cur.recommendations.length}건)`);
    return;
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  if (JSON.stringify(base) !== JSON.stringify(cur)) {
    throw new Error(`기준값과 결과가 다릅니다. 의도한 변화라면 'node tests/run.js --update'로 갱신하세요.\n${describeDiff(base, cur)}`);
  }
});

test('전체 결과 불변 조건: 긴급도 정렬·공셀 중복 없음·비김치의 C08/C09 이동 없음·메추리알 구역 보호', async () => {
  const { recommendations: recs } = await snapshot();
  const targets = recs.map(r => r.to).filter(t => t !== '-');
  assert.equal(new Set(targets).size, targets.length, '같은 공셀이 중복 추천됨');
  for (const r of recs) {
    if (/^C0[89]/.test(r.to)) assert.match(r.reason, /김치/, `비김치가 C08/C09로 추천됨: ${r.name}`);
    if (r.to >= 'A07-060101' && r.to <= 'A07-070505') assert.match(r.name, /메추리/, `메추리알 구역에 다른 상품 추천: ${r.name}`);
  }
  const safetyFirst = recs.findIndex(r => !['SAFETY', 'COMPLIANCE'].includes(r.priorityType));
  assert.ok(recs.slice(safetyFirst).every(r => !['SAFETY', 'COMPLIANCE'].includes(r.priorityType)), '안전·규정 위반이 다른 추천보다 뒤에 있음');
});
