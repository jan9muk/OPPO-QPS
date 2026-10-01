/*
 * ① 개별 사례 테스트 — 확정된 현장 운영 기준과 과거에 고친 버그를 하나씩 고정한다.
 * 규칙을 의도적으로 바꾼 경우에는 해당 테스트의 기대값도 함께 고치고, 커밋 메시지에 사유를 남긴다.
 */
'use strict';
const assert = require('assert/strict');
const { loadApp, cell, run } = require('./lib');
const { engine, core } = loadApp();
const { categorize, parseEggSize } = engine._internals;
const cat = (name, group = '', subGroup = '') => categorize({ name, group, subGroup });

// ---------------- 상품 분류 ----------------
test('김치: 중분류 김치는 김치, 김치를 재료로 쓴 조리식품은 김치 아님 (v2.38.0)', () => {
  assert.equal(cat('종가 포기김치 1kg', '김치').kimchi, true);
  assert.equal(cat('묵은지 김치찌개650g', '냉장편의식').kimchi, false);
  assert.equal(cat('동치미물냉면 1,880g', '냉장면').kimchi, false);
  assert.equal(cat('CJ 비비고 김치만두 400G', '냉동만두').kimchi, false);
});
test('김치: 분류 컬럼이 없을 때 상품명 판정 (김치 키워드 뒤의 요리명만 제외)', () => {
  assert.equal(cat('찌개용 김치 500g').kimchi, true);
  assert.equal(cat('조선호텔특제육수 포기김치 1kg').kimchi, true);
  assert.equal(cat('프리미엄 오이소박이 650g').kimchi, true);
  assert.equal(cat('묵은지 김치찌개650g').kimchi, false);
  assert.equal(cat('동치미 육수 300g').kimchi, false);
  assert.equal(cat('CJ 김치왕교자 315g').kimchi, false);
  assert.equal(cat('묵은지참치 김밥 230g').kimchi, false);
});
test('축산: 볶음탕용 생닭은 0~5℃ 대상, 양념·닭갈비는 아님 (v2.39.0)', () => {
  assert.equal(cat('[하림] 냉장 볶음탕용 생닭 (1kg)', '계육').zeroToFive, true);
  assert.equal(cat('[하림] 춘천식 닭갈비 (순한맛)', '계육').zeroToFive, false);
  assert.equal(cat('[냉장] 한우 부채살 250g', '우육').zeroToFive, false);
  assert.equal(cat('[냉장] 한우 부채살 250g', '우육').livestock, true);
  assert.equal(cat('호주청정우 다짐육 300g', '우육').zeroToFive, true);
  assert.equal(cat('고등어 필렛', '대중선어').zeroToFive, true);
});
test('계란: 올가닉계란(중분류 올가닉신선)도 계란, 가공식품은 계란 아님 (v2.41.0)', () => {
  assert.equal(cat('[1번사육] 동물복지 신선유정란 15개입', '올가닉신선', '올가닉계란').egg, true);
  assert.equal(cat('우리집 신선계란 15구', '계란', '일반란').egg, true);
  assert.equal(cat('노브랜드 끼니 계란볶음컵밥 230g', '냉동편의식').egg, false);
  assert.equal(cat('CJ 계란옷 입은 고기완자 480G', '냉동조리육').egg, false);
});
test('메추리알: 소분류 메추리알·메추리 계란류는 메추리알, 장조림은 아님 (v2.40.0~2.41.0)', () => {
  assert.equal(cat('깐메추리알 500g', '계란', '메추리알').quailEgg, true);
  assert.equal(cat('하림 무항생제 메추리 유정란 56구', '계란', '특허란').quailEgg, true);
  assert.equal(cat('우리 아이가 좋아하는 깐메추리알 270g', '올가닉신선', '올가닉계란').quailEgg, true);
  assert.equal(cat('우리 아이가 좋아하는 깐메추리알 270g', '올가닉신선', '올가닉계란').egg, false);
  assert.equal(cat('풍림 메추리알 장조림 400g', '반찬', '포장반찬').quailEgg, false);
});
test('계란 구수: 대괄호 판촉 문구 제외, N개입 표기 인식 (v2.40.0~2.41.0)', () => {
  assert.equal(parseEggSize('[30구 단위 구매 가능] 무항생제 신선계란 15구', '계란'), 15);
  assert.equal(parseEggSize('행복한 대란 30구 (15구 X 2ea, 1560g)', '계란'), 30);
  assert.equal(parseEggSize('[1번사육] 동물복지 신선유정란 20개입 (760g)', '올가닉신선'), 20);
  assert.equal(parseEggSize('동물복지 유정란 6개입', '올가닉신선'), null);
});

// ---------------- 구역 규칙 시나리오 ----------------
test('일반 축산: D01~D02 보관은 규정 위반 아님, D03~D06 공셀이 있으면 복귀 제안 (v2.39.0)', () => {
  const r = run([cell('D01-010101', { name: '한우 부채살', group: '우육', out: 5, stock: 20 }), cell('D03-010101')]);
  const rec = r.of('한우 부채살');
  assert.ok(rec, '복귀 추천이 있어야 함');
  assert.notEqual(rec.priorityType, 'COMPLIANCE');
  assert.equal(rec.targetCell, 'D03-010101');
});
test('일반 축산: 허가 구역 밖이면 D03~D06 우선, 없을 때만 D01~D02 (v2.39.0)', () => {
  let r = run([cell('B01-010101', { name: '한우 등심', group: '우육', out: 5 }), cell('D01-010101'), cell('D03-010101')]);
  assert.equal(r.of('한우 등심').priorityType, 'COMPLIANCE');
  assert.equal(r.of('한우 등심').targetCell, 'D03-010101');
  r = run([cell('B01-010101', { name: '한우 등심', group: '우육', out: 5 }), cell('D01-010101')]);
  assert.equal(r.of('한우 등심').targetCell, 'D01-010101');
});
test('0~5℃ 상품(생닭)은 D01~D02로만 이동 (v2.39.0)', () => {
  const r = run([cell('D03-010101', { name: '[하림] 냉장 볶음탕용 생닭 (1kg)', group: '계육', out: 5 }), cell('D04-010101'), cell('D01-010101')]);
  const rec = r.of('[하림] 냉장 볶음탕용 생닭 (1kg)');
  assert.equal(rec.priorityType, 'COMPLIANCE');
  assert.equal(rec.targetCell, 'D01-010101');
});
test('김치 전용 구역: C08/C09의 비김치는 퇴출, 비김치는 C08/C09로 보내지 않음 (v2.42.0)', () => {
  const r = run([cell('C08-010101', { name: '냉장 쌈장', group: '냉장양념', out: 3 }), cell('C08-010102'), cell('C07-010101')]);
  const rec = r.of('냉장 쌈장');
  assert.equal(rec.zoneEviction, 1);
  assert.equal(rec.moveType, 'EVICTION');
  assert.equal(rec.targetCell, 'C07-010101');
});
test('김치: D06 임시 보관분은 이전 계획, 그 외 구역은 규정 위반 (v2.43.0)', () => {
  const r = run([cell('D06-010101', { name: '종가 갓김치', group: '김치', out: 5 }), cell('C03-010101', { name: '종가 파김치', group: '김치', out: 5 }),
    cell('C08-010101'), cell('C08-010102'), cell('D06-010102')]);
  assert.equal(r.of('종가 갓김치').priorityType, 'RELOCATION');
  assert.match(r.of('종가 갓김치').targetCell, /^C08-/);
  assert.equal(r.of('종가 파김치').priorityType, 'COMPLIANCE');
});
test('김치찌개 같은 비김치는 김치 규정 위반이 아님', () => {
  const r = run([cell('C03-010101', { name: '묵은지 김치찌개650g', group: '냉장편의식', out: 5 }), cell('C08-010101')]);
  const rec = r.of('묵은지 김치찌개650g');
  assert.ok(!rec || !/김치 전용 구역 필요/.test(rec.reason));
  assert.ok(!rec || !/^C0[89]/.test(rec.targetCell));
});
test('게이트랙: A10의 계란은 규정 위반, A09의 비계란은 규정 위반 (v2.41.0)', () => {
  const r = run([cell('A10-010101', { name: '행복한 대란 30구', group: '계란', sub: '일반란', rack: 'Gate Rack', out: 150, stock: 700 }),
    cell('A10-010102', { rack: 'Gate Rack' }), cell('A09-010101', { rack: 'Gate Rack' }), cell('A01-010201'),
    cell('A09-010102', { name: '손질배추 (통)', group: '엽/양채소', rack: 'Gate Rack', out: 30, stock: 40 })]);
  assert.equal(r.of('행복한 대란 30구').priorityType, 'COMPLIANCE');
  assert.equal(r.of('행복한 대란 30구').targetCell, 'A09-010101');
  assert.equal(r.of('손질배추 (통)').priorityType, 'COMPLIANCE');
  assert.match(r.of('손질배추 (통)').reason, /A09 계란 전용/);
});
test('계란: 출고 100 이상은 A09 우선, A09가 차면 A08 구수 구역 (v2.45.0)', () => {
  let r = run([cell('A10-010101', { name: '행복한 대란 30구', group: '계란', sub: '일반란', rack: 'Gate Rack', out: 150, stock: 700 }),
    cell('A09-010101', { rack: 'Gate Rack' }), cell('A08-070201'), cell('A08-080201')]);
  assert.equal(r.of('행복한 대란 30구').targetCell, 'A09-010101');
  assert.match(r.of('행복한 대란 30구').reason, /A09 게이트랙 우선 배치/);
  r = run([cell('A10-010101', { name: '행복한 대란 30구', group: '계란', sub: '일반란', rack: 'Gate Rack', out: 150, stock: 700 }),
    cell('A08-070201'), cell('A08-010201')]);
  assert.equal(r.of('행복한 대란 30구').targetCell, 'A08-070201', '30구 계란은 30구 구역(A08-07~08)으로');
});
test('계란은 플로우랙 진입(ENTRY) 대상이 아님 (v2.45.0)', () => {
  const r = run([cell('A08-040205', { name: '하얀계란 15구', group: '계란', sub: '일반란', out: 69, stock: 113 }), cell('A07-020101', { rack: 'Flow Rack' })]);
  const rec = r.of('하얀계란 15구');
  assert.ok(!rec || rec.priorityType !== 'ENTRY', '계란이 플로우랙 진입으로 추천됨');
});
test('계란: A08의 출고 100 이상 계란은 A09 공셀이 있으면 이동 제안, 100 미만은 제안 없음 (v2.45.0)', () => {
  const r = run([cell('A08-050203', { name: '순수백색 유정란 20구', group: '계란', sub: '유정란', out: 124, stock: 234 }),
    cell('A08-040305', { name: '풀무원 동물복지 왕란 15구', group: '계란', sub: '특허란', out: 52, stock: 236 }),
    cell('A09-010101', { rack: 'Gate Rack' }), cell('A09-010102', { rack: 'Gate Rack' })]);
  assert.equal(r.of('순수백색 유정란 20구').targetCell, 'A09-010101');
  const low = r.of('풀무원 동물복지 왕란 15구');
  assert.ok(!low || !/^A09-/.test(low.targetCell), '출고 100 미만 계란을 A09로 우선 이동시키면 안 됨');
});
test('메추리알: 저빈도는 A07-060101~070505 전용 구역으로 (v2.41.0)', () => {
  const r = run([cell('B05-030204', { name: '깐메추리알 1kg', group: '계란', sub: '메추리알', out: 5, stock: 16 }), cell('B05-030205'), cell('A07-060101')]);
  assert.equal(r.of('깐메추리알 1kg').targetCell, 'A07-060101');
});
test('메추리알: 고빈도(출고 30·재고 60 이상)는 플로우랙 진입 (v2.40.0)', () => {
  const r = run([cell('A08-030101', { name: '5K 깐메추리알 500g', group: '계란', sub: '메추리알', out: 40, stock: 80 }),
    cell('A07-060101'), cell('A07-020101', { rack: 'Flow Rack' })]);
  const rec = r.of('5K 깐메추리알 500g');
  assert.equal(rec.priorityType, 'ENTRY');
  assert.equal(rec.targetCell, 'A07-020101');
});
test('메추리알 전용 구역은 다른 상품의 이동 대상이 아님 (v2.41.0)', () => {
  const r = run([cell('C08-010101', { name: '냉장 쌈장', group: '냉장양념', out: 3 }), cell('A07-060101')]);
  assert.equal(r.of('냉장 쌈장').status, 'NO_TARGET');
});

test('상품명 중량 파싱: 묶음 표기(*2입, X2)는 곱하고 천 단위 쉼표 인식 (v2.48.0)', () => {
  const w = engine._internals.extractWeightFromName;
  assert.equal(w('하루채소 오이맛고추 (80g)'), 80);
  assert.equal(w('노브랜드 국산콩두부300g*2입'), 600);
  assert.equal(w('맛있는 왕교자김치 (468GX2)'), 936);
  assert.equal(w('피코크 에이클래스 체다 슬라이스치즈 210g (30gX7)'), 210);
  assert.equal(w('동치미육수 1,000ml'), 1000, '천 단위 쉼표');
  assert.equal(w('동치미물냉면 1,880g (4인분)'), 1880);
  assert.equal(w('수박 5kg'), 5000);
});
test('경량 상품(300g 이하)은 냉장 플로우랙 4단 우대, 무거우면 골든존(2~3단) (v2.48.0)', () => {
  let r = run([cell('B08-010405', { name: '하루채소 오이맛고추 (80g)', group: '간편채소', out: 56, stock: 177 }),
    cell('B09-020203', { rack: 'Flow Rack' }), cell('B09-020403', { rack: 'Flow Rack' })]);
  assert.equal(r.of('하루채소 오이맛고추 (80g)').targetCell, 'B09-020403');
  r = run([cell('B08-010405', { name: '국산콩 두부 (400g)', group: '두부/묵/콩가공품', out: 56, stock: 177 }),
    cell('B09-020203', { rack: 'Flow Rack' }), cell('B09-020403', { rack: 'Flow Rack' })]);
  assert.equal(r.of('국산콩 두부 (400g)').targetCell, 'B09-020203', '300g 초과는 골든존');
  r = run([cell('B08-010405', { name: '하루채소 오이맛고추 (80g)', group: '간편채소', out: 56, stock: 177 }),
    cell('B09-020203', { rack: 'Flow Rack' })]);
  assert.equal(r.of('하루채소 오이맛고추 (80g)').targetCell, 'B09-020203', '4단 공셀이 없으면 골든존');
});
test('경량 상품(300g 이하)은 냉동 플로우랙 5단 우대 (v2.48.0)', () => {
  const r = run([cell('F01-010101', { name: '냉동 미니 딤섬 (150g)', group: '냉동만두', rack: 'Flow Rack', temp: 'WET 냉동', out: 40, stock: 60 }),
    cell('F01-010301', { rack: 'Flow Rack' }), cell('F01-010501', { rack: 'Flow Rack' })]);
  assert.equal(r.of('냉동 미니 딤섬 (150g)').targetCell, 'F01-010501');
});

test('현재 위치 근접: 조건이 같으면 존 번호가 가까운 셀로 (C08 → C07, C01 아님) (v2.49.0)', () => {
  const r = run([cell('C08-010102', { name: '저당 굴소스 290g', group: '냉장양념', out: 0, stock: 21 }),
    cell('C01-040505'), cell('C07-040505'), cell('C05-040505')]);
  assert.equal(r.of('저당 굴소스 290g').targetCell, 'C07-040505');
});
test('현재 위치 근접은 구역 규칙을 뒤집지 않음: 김치는 멀어도 C08/C09로 (v2.49.0)', () => {
  const r = run([cell('C01-010101', { name: '종가 포기김치', group: '김치', out: 5 }), cell('C02-010101'), cell('C08-010101')]);
  assert.equal(r.of('종가 포기김치').targetCell, 'C08-010101');
});

// ---------------- 우선순위 ----------------
test('공셀 배정은 긴급도 순: 규정 위반이 이전 계획보다 먼저 공셀을 차지 (v2.40.0)', () => {
  // 이전 계획 건의 토트 수가 더 많아도(과거 정렬 기준) 규정 위반 건이 먼저 배정되어야 함
  const r = run([cell('C03-010101', { name: '종가 파김치', group: '김치', out: 1, totes: 1 }),
    cell('D06-010101', { name: '종가 갓김치', group: '김치', out: 60, totes: 30 }), cell('C08-010101')]);
  assert.equal(r.of('종가 파김치').targetCell, 'C08-010101');
  assert.equal(r.of('종가 갓김치').status, 'NO_TARGET');
});
test('추천 목록은 긴급도 내림차순, 같은 셀을 두 번 추천하지 않음', () => {
  const r = run([cell('C03-010101', { name: '김치A', group: '김치', out: 3 }), cell('C04-010101', { name: '김치B', group: '김치', out: 9 }),
    cell('C08-010101', { name: '쌈장', group: '냉장양념', out: 2 }), cell('C08-010102'), cell('C08-010103'), cell('C07-010101')]);
  const m = r.recs.filter(x => x.mandatory);
  m.forEach((x, i) => { if (i) assert.ok(m[i - 1].urgency >= x.urgency, '긴급도 정렬 위반'); });
  const targets = r.recs.map(x => x.targetCell).filter(t => t !== '-');
  assert.equal(new Set(targets).size, targets.length, '같은 공셀이 중복 추천됨');
});

test('W/S 부하: 이동을 확정할 때마다 부하를 갱신해 같은 W/S로 몰리지 않음 (v2.46.0)', () => {
  // 규정 위반 김치 2건이 같은 조건의 C08 공셀 3개(APS2-02 2칸, APS2-03 1칸) 중 고른다.
  // 부하 갱신이 없으면 두 건 모두 APS2-02로 가고, 갱신하면 두 번째 건은 APS2-03으로 간다.
  const r = run([cell('C03-010101', { name: '김치A', group: '김치', out: 10, totes: 10, ws: 'APS2-01' }),
    cell('C03-010102', { name: '김치B', group: '김치', out: 10, totes: 10, ws: 'APS2-01' }),
    cell('C01-010101', { name: '고빈도 상품', group: '냉장양념', out: 40, totes: 40, ws: 'APS2-01' }),
    cell('C08-010101', { ws: 'APS2-02' }), cell('C08-010102', { ws: 'APS2-02' }), cell('C08-010103', { ws: 'APS2-03' })]);
  const ws = [r.of('김치A').targetWs, r.of('김치B').targetWs].sort();
  assert.deepEqual(ws, ['APS2-02', 'APS2-03']);
});
test('퇴출→진입 연결: 공셀이 없으면 퇴출로 비게 될 플로우랙 셀을 진입에 사용 (v2.46.0)', () => {
  const r = run([cell('C02-010101', { name: '저빈도 두부', group: '두부/묵/콩가공품', rack: 'Flow Rack', out: 2, stock: 5 }),
    cell('C04-010101', { name: '고빈도 우유', group: '멸균우유/유제품', out: 60, stock: 80 }),
    cell('C03-010101')]);
  const out = r.of('저빈도 두부'), entry = r.of('고빈도 우유');
  assert.equal(out.moveType, 'EVICTION');
  assert.equal(out.targetCell, 'C03-010101');
  assert.equal(entry.priorityType, 'ENTRY');
  assert.equal(entry.status, 'AFTER_EVICTION');
  assert.equal(entry.targetCell, 'C02-010101');
  assert.equal(entry.dependsOnSku, out.sku);
  assert.match(entry.reason, /저빈도 두부.*먼저 퇴출/);
  assert.match(out.reason, /비운 셀은 '고빈도 우유'/);
});
test('퇴출→진입 연결: 퇴출 대상에 목적지가 없으면 그 셀은 쓰지 않음', () => {
  const r = run([cell('C02-010101', { name: '저빈도 두부', group: '두부/묵/콩가공품', rack: 'Flow Rack', out: 2, stock: 5 }),
    cell('C04-010101', { name: '고빈도 우유', group: '멸균우유/유제품', out: 60, stock: 80 })]);
  assert.equal(r.of('저빈도 두부').status, 'NO_TARGET');
  assert.equal(r.of('고빈도 우유').status, 'NO_TARGET');
});

test('진입+안전 위반: 플로우랙·평대 공셀이 없으면 안전한 선반 공셀로 위반 해소 (v2.50.0)', () => {
  const r = run([cell('B05-030401', { name: '고빈도 세제 3.5kg', out: 80, stock: 90, totes: 40 }), cell('B05-030101', {})]);
  const rec = r.of('고빈도 세제 3.5kg');
  assert.equal(rec.priorityType, 'SAFETY');
  assert.equal(rec.targetCell, 'B05-030101');
  assert.match(rec.reason, /위반 해소 우선/);
});
test('진입+규정 위반: 허가 구역 밖 고빈도 축산은 허가 구역 선반 공셀로 이동 (v2.50.0)', () => {
  const r = run([cell('E03-030402', { name: '양념 소불고기 500g', group: '양념육', out: 80, stock: 90, totes: 40 }), cell('D05-030301', {})]);
  const rec = r.of('양념 소불고기 500g');
  assert.equal(rec.priorityType, 'COMPLIANCE');
  assert.equal(rec.targetCell, 'D05-030301');
});
test('순수 진입(위반 없음)은 선반 공셀로 옮기지 않음', () => {
  const r = run([cell('B05-030201', { name: '고빈도 우유 900ml', out: 80, stock: 90, totes: 40 }), cell('B05-030301', {})]);
  assert.equal(r.of('고빈도 우유 900ml').status, 'NO_TARGET');
});

test('C09 김치: 진입~퇴출 사이 완충 구간이면 C08 선반 이동을 제안하지 않음 (v2.51.0)', () => {
  const r = run([cell('C09-020105', { name: '포기김치 3.5kg', group: '김치', rack: 'Flow Rack', out: 36, stock: 117, totes: 34 }), cell('C08-030205', {})]);
  assert.equal(r.of('포기김치 3.5kg'), undefined);
});
test('C09 김치: 퇴출 기준(출고 15·재고 20 이하)이면 C08로 퇴출', () => {
  const r = run([cell('C09-020105', { name: '포기김치 1kg', group: '김치', rack: 'Flow Rack', out: 5, stock: 10 }), cell('C08-030205', {})]);
  const rec = r.of('포기김치 1kg');
  assert.equal(rec.moveType, 'EVICTION');
  assert.equal(rec.targetCell, 'C08-030205');
});

// ---------------- 데이터 처리(qpsCore) ----------------
test('셀 파일 병합: 같은 보관위치가 서로 다르면 오류, 같으면 중복 제거', () => {
  const a = { '작업대': 'APS2-01', '보관위치': 'A01-010101', '랙유형': 'Shelf Rack', '물류분류코드': 'WET 냉장', '물류상품ID': '1', '현재고': '5' };
  const ok = core.mergeAndValidateCellRows([{ file: { name: 'a' }, rows: [a] }, { file: { name: 'b' }, rows: [{ ...a }] }]);
  assert.equal(ok.rows.length, 1);
  assert.throws(() => core.mergeAndValidateCellRows([{ file: { name: 'a' }, rows: [a] }, { file: { name: 'b' }, rows: [{ ...a, '현재고': '9' }] }]), /셀 데이터 충돌/);
});
test('파일 유형 판별과 필요 컬럼 보관', () => {
  assert.equal(core.detectType(['작업대', '물류상품ID', '보관위치', '랙유형', '물류분류코드', '현재고']), 'cell');
  assert.equal(core.detectType(['물류상품ID', '피킹지시수량']), 'box');
  assert.equal(core.detectType(['a', 'b']), null);
  const keep = core.keepColumnFor('box');
  assert.ok(keep('WMS배송진행상태_1') && keep('수정일시') && keep('P박스당중량'));
  assert.ok(!keep('운송장번호') && !keep('피킹작업자'));
});
test('작업대별 보충 우선 SKU: 지시 PCS 상위 3개와 셀·현재고 (qpsCore v1.2.0)', () => {
  const r = run([
    cell('A01-010101', { name: '상품A', ws: 'APS1-01', out: 10, totes: 10, stock: 50 }),
    cell('A01-010102', { name: '상품B', ws: 'APS1-01', out: 60, totes: 20, stock: 40 }),
    cell('A01-010103', { name: '상품C', ws: 'APS1-01', out: 30, totes: 30, stock: 30 }),
    cell('A01-010104', { name: '상품D', ws: 'APS1-01', out: 5, totes: 5 }),
    cell('A02-010101', { name: '상품E', ws: 'APS1-02', out: 90, totes: 50 })
  ]);
  const top = r.data.wsTopSkus['APS1-01'];
  assert.deepEqual(top.map(x => [x.name, x.pcs, x.totes, x.stock, x.cells.join()]), [
    ['상품B', 60, 20, 40, 'A01-010102'], ['상품C', 30, 30, 30, 'A01-010103'], ['상품A', 10, 10, 50, 'A01-010101']]);
  assert.equal(top[0].remainPcs, 60); // 테스트 데이터는 모두 '피킹지시' 상태(미완료)
});
test('우선 보충 필요 SKU: 잔여 지시 PCS 순, 피킹 완료 SKU 제외', () => {
  const c = (loc, sku, stock) => ({ '작업대': 'APS1-01', '보관위치': loc, '랙유형': 'Shelf Rack', '물류분류코드': 'WET 냉장', '물류상품ID': sku, '물류상품명': 'P' + sku, '현재고': String(stock) });
  const b = (sku, no, pcs, status) => ({ '물류상품ID': sku, '피킹지시수량': String(pcs), '배송번호': no, '배송박스순번': '1', 'WMS배송진행상태': status });
  const d = core.buildAllData(
    [b('1', 'a', 100, '피킹완료'), b('2', 'b', 30, '피킹지시'), b('2', 'c', 20, '피킹완료'), b('3', 'd', 40, '피킹지시')],
    [c('A01-010101', '1', 10), c('A01-010102', '2', 5), c('A01-010103', '3', 50)]
  );
  assert.deepEqual(d.wsTopSkus['APS1-01'].map(x => [x.sku.slice(-1), x.remainPcs, x.pcs, x.stock]), [['3', 40, 40, 50], ['2', 30, 50, 5]]);
});
test('엑셀 날짜 일련번호는 현지 시각으로 해석', () => {
  const d = core.parseExcelDate(46292.5); // 2026-09-27 12:00 (현지)
  assert.equal(d.getFullYear(), 2026); assert.equal(d.getMonth(), 8); assert.equal(d.getDate(), 27); assert.equal(d.getHours(), 12);
});
