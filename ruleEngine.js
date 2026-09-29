/*
 * QPS Cell Allocation Rule Engine v2.47.0
 *
 * v2.47.0: 구조 정리(동작 변화 없음). 규칙 함수 곳곳의 현장 기준 수치(플로우랙·게이트랙·김치 C09·계란 구역·
 *   축산 허가 위치·중량물 안전·선반 재고 한계·A10 정책)를 CONFIG로 모으고 주석을 붙임.
 *   DISTANCE_MAP은 qpsCore.js로 이동(히트맵과 공용). 긴 한 줄 코드를 읽기 쉽게 줄바꿈.
 *
 * v2.46.0: 작업대(W/S) 부하 갱신 · 퇴출→진입 연결
 *   - 이동을 하나 확정할 때마다 출발·도착 W/S의 부하(지시 토트 수)를 갱신해, 이후 추천이 같은
 *     저부하 W/S로 몰리지 않게 함. 공셀만 있는 W/S도 부하 0으로 포함.
 *     (부하 정의 = W/S에 할당된 SKU별 지시 토트 수 합계 = 대시보드 '지시 SKU수'와 동일)
 *   - 부하 점수를 '큰 편차 감소'에서 '두 W/S 편차 제곱합 감소'로 변경. 출발 W/S가 과부하면 큰 편차가
 *     항상 출발 쪽이라 도착 W/S 간 차이가 점수에 드러나지 않았음. 허용 기준(10% 이내 또는 개선)은 유지.
 *   - 공셀이 없어 목적지가 없던 필수 추천(NO_TARGET)에, 같은 추천 목록에서 퇴출(EVICTION)로 비게 될
 *     셀을 연결. 상태 'AFTER_EVICTION'으로 표시하고, 먼저 퇴출할 상품을 사유에 명시.
 *
 * v2.45.0: 출고 100 이상(CONFIG.eggGatePriorityOut) 계란은 A09 계란 게이트랙을 우선 탐색하고,
 *   A09에 적정 공셀이 없을 때만 A08 등 나머지를 탐색. A09 밖에 있는 해당 계란은 A09 공셀이 있으면 이동 제안.
 *   출고 100 미만 계란은 재고 50 이상이면 A09 배치가 허용되지만 우선하지 않음(A09 14셀 대비 후보 과다 방지).
 *   계란이 일반 '플로우랙 진입 필요'(ENTRY)로 잡혀 항상 공셀 없음으로 끝나던 문제 수정(계란은 플로우랙 배치 불가).
 *
 * v2.44.1: 회귀 테스트용 내부 함수 노출(_internals), 계란 구수 파싱을 parseEggSize()로 분리. 동작 변화 없음.
 *
 * v2.44.0: 평대(flat)를 플로우랙의 차선으로 분리. 피킹은 동등하나 보충이 불편하므로,
 *   플로우랙 선호 SKU(진입 포함)는 플로우랙 적정 공셀을 먼저 찾고, 없을 때만 평대, 그다음 기타 랙을 탐색.
 *   평대로 배정되면 사유에 '플로우랙 적정 공셀 없어 평대 차선 배치'를 표시.
 *
 * v2.43.1: 추천 사유의 랙 명칭 오표기 수정. 평대(flat: D02-01~02, E04-07~08)를 '플로우랙'으로,
 *   쇼케이스/리치인(showcase)을 '선반랙'으로 표기하던 문제를 FAMILY_LABEL로 정정.
 *
 * v2.43.0: D06 임시 보관 김치를 규정 위반(COMPLIANCE)에서 '이전 계획'(RELOCATION)으로 분리.
 *   CONFIG.kimchiTempZones(D06)에 있는 김치는 C08/C09 이전 대상으로 별도 쿼터
 *   (relocationQuotaRatio)·낮은 urgency(110~189, 출고 많은 순)로 추천. 그 외 구역의 김치는 기존대로 규정 위반.
 *
 * v2.42.0: C08/C09 김치 전용 구역 지정
 *   - C08/C09에 있는 비김치 SKU는 '김치 전용 구역 확보' 퇴출(ZONE_EVICTION)로 추천하고,
 *     C08/C09는 비김치 SKU의 이동 대상에서 제외.
 *   - 전용 쿼터(zoneEvictionQuotaRatio)로 기존 플로우랙 퇴출과 슬롯을 나누지 않음.
 *     urgency는 플로우랙 퇴출(300~)보다 낮은 200~299, 출고가 적은 SKU부터 퇴출.
 *   - 필수 추천 총량 절단(100건) 제거: 쿼터 합이 100을 넘으면 퇴출류가 통째로 잘렸음.
 *     쿼터 카테고리 판정 순서를 화면 분류(priorityType)와 일치시킴.
 *   - 결과에 zoneEviction 플래그 추가(화면의 김치 전용 구역 확보 그룹 표시용).
 *
 * v2.41.0: 구역 재편
 *   - 게이트랙 분리: A09 = 계란 전용 게이트랙(계란 기준: 출고 100 이상 또는 재고 50 이상),
 *     A10 = 비계란 게이트랙(일반 게이트랙 기준: 출고 100 이상). 반대로 배치된 SKU는 규정 위반.
 *   - 메추리알 전용 구역 신설: A07-060101~A07-070505(선반랙 50셀). 플로우랙 진입 기준을 충족한
 *     메추리알은 기존대로 플로우랙. 이 구역은 메추리알 전용으로 예약(타 SKU 추천 대상에서 제외).
 *   - 올가닉 계란(중분류 올가닉신선 / 소분류 올가닉계란)이 v2.40.0에서 계란 판정에서 빠지던 문제 수정.
 *   - 계란 구수 파싱에 'N개입' 표기 추가.
 *
 * v2.40.0: 우선순위·표시 정합성 정리
 *   - 공셀 배정(greedy) 순서를 토트 수가 아닌 urgency 순으로 변경 -> 안전·규정 위반 건이
 *     진입/퇴출 건에 공셀을 먼저 뺏기지 않음.
 *   - urgency 재정의: SAFETY > COMPLIANCE > FORWARD/ENTRY(공셀 있음) > EVICTION > ENTRY(공셀 없음)
 *     > POLICY > 최적화. (기존에는 COMPLIANCE가 100으로 EVICTION/ENTRY보다 낮았음)
 *   - 카테고리 쿼터(COMPLIANCE 50%, ENTRY 25%, EVICTION 25%, 최적화 maxOptimization)를 공셀 배정
 *     단계에서 적용 -> 쿼터 초과 건이 공셀을 선점하지 않음. SAFETY는 무제한.
 *   - 계란·메추리알도 분류 컬럼 우선 판정(계란볶음컵밥·계란옷 완자·메추리알장조림 오분류 수정).
 *   - 계란 구수 파싱 시 '[30구 단위 구매 가능]' 같은 대괄호 판촉 문구 제외.
 *   - candidateAllowed()가 거절 사유 종류(kind: volume/safety)를 반환하고, violations()는 사유
 *     문자열 정규식 대신 kind로 판정. 계란(A09/A10)·메추리알의 물량 기준 미달은 COMPLIANCE가
 *     아닌 EVICTION/ENTRY로 처리(v2.37.0 원칙 확장). 메추리알 진입/퇴출 기준은 CONFIG.quailFlow.
 *   - A10 입고계획 규칙(POLICY)을 priorityType으로 노출.
 *
 * v2.39.0: 일반 축산(수입육/우육/돈육/양념육, 0~5℃ 대상 제외)의 D01~D02 배치를 규정 위반에서
 *   '대체 위치'로 변경. D03~D06 등 비챔버 공셀을 우선 탐색하고 없을 때만 챔버 사용.
 *   챔버에 대체 보관 중인 일반 축산은 비챔버 공셀이 생기면 복귀를 제안.
 *   '볶음탕용 생닭'이 가공 계육으로 분류되어 0~5℃ 대상에서 빠지던 문제 수정.
 *   reasons()에서 보조 사유(soft, 문자열)가 빈 값으로 사라지던 문제 수정.
 *
 * v2.38.0: buildProfiles()가 window.cellRows/boxRows를 읽었으나 index.html은 이를 `let`으로
 *   선언해 window 속성이 아니었음 -> 원본 행이 항상 빈 배열이라 대/중/소분류·중량·입고계획·
 *   행사 등 선택 컬럼이 전부 무시되고 있었음. 이제 allData.cellRows/boxRows로 명시 전달받음.
 *   함께 수정: 김치 판정을 중분류('김치') 우선으로 변경. 분류 컬럼이 없을 때만 상품명으로
 *   판정하며, 김치찌개·동치미냉면·김치만두 등 조리/가공 식품명은 제외.
 *   메추리알은 소분류에만 존재하므로 subGroup(소분류)도 함께 확인.
 *
 * v2.37.0: violations()의 own-check(자기 위치 재검증)가 일반 플로우랙/게이트랙/김치
 *   물량 미달 퇴출과 동일한 조건을 COMPLIANCE로 중복 태깅하던 문제 수정.
 *   -> 이 때문에 정상적인 저빈도 퇴출 대상 대부분이 "안전·규정위반" 카드로 잘못
 *      흡수되어 "퇴출 필요" 카드가 사실상 비어있었음. 이제 물량/출고 기준 미달류
 *      own-check는 중복 태깅하지 않고, 전용 EVICTION 판정에만 맡김. 진짜 규정위반
 *      (냉동구역 오배치, 축산 허가구역 위반, 전용구역 위반 등)은 그대로 COMPLIANCE 유지.
 *
 * 핫픽스 이력:
 * v2.36.1: isFlowAllowed()의 청과류 이름 예외(배추/양배추/무(통)/수박)가 재고 0개인
 *   SKU에도 적용되어 "재고 0개인데 플로우랙 진입 필요"로 잘못 추천되는 문제 수정.
 *   (예: 이름에 "양배추"가 포함된 요거트 제품이 청과류로 오분류) -> stock > 0 조건 추가.
 * v2.36.2: stock > 0 만으로는 부족했음 — "쌈배추(80g)"처럼 실재고는 있지만 소포장인
 *   품목까지 벌크 청과류로 오분류되는 문제 추가 발견. 상품명 파싱 중량(itemWeightG)이
 *   1kg 미만이면 소포장으로 간주해 예외 제외. (임계값 1000g은 조정 가능한 값)
 *
 * 개선 사항
 * 1) 플로우랙 "진입 필요"를 EVICTION과 대칭되는 정식 mandatory 카테고리(ENTRY)로 승격
 *    -> 기존에는 urgency=0(soft 선호도)으로만 반영되어 추천 리스트 하위권에 묻혔음
 * 2) 플로우랙 공셀 실재 여부(flowSpaceByTemp)에 따라 ENTRY urgency를 동적으로 조정
 *    -> 공셀이 있으면 진입을 최우선으로, 공셀이 없으면 저빈도 SKU 퇴출이 먼저 오도록 자연 정렬
 * 3) EVICTION/ENTRY 각각 독립적인 내부 쿼터(evictionQuotaRatio/entryQuotaRatio) 적용
 * 4) v2.35.0의 기존 수정사항 유지(중량/문자열 보간 오류 수정, 구조화 priorityType·moveType,
 *    온도·랙패밀리·존 단위 공셀 인덱스, 필수 제약 사전 필터링, NO_TARGET 상태 반환)
 */
(function (global) {
  'use strict';
  const CONFIG = Object.freeze({
    wsDeviation: 0.10,
    maxRecommendations: 100,   // 카테고리 쿼터 산정 기준 건수(필수 추천 규모는 쿼터 합 + SAFETY/FORWARD/POLICY)
    maxOptimization: 20,       // 최적화 제안(필수 아님) 최대 건수 — 필수 추천과 별도
    maxSourceCandidates: 1500,
    // 필수 추천 내 카테고리별 쿼터(maxRecommendations 대비). SAFETY/FORWARD/POLICY는 무제한.
    // 쿼터는 공셀 배정 단계에서 적용되어, 쿼터를 넘긴 건이 공셀을 선점하지 않는다.
    complianceQuotaRatio: 0.5,
    zoneEvictionQuotaRatio: 0.1,  // 전용 구역(김치 C08/C09) 확보용 비대상 SKU 퇴출
    relocationQuotaRatio: 0.1,    // 임시 보관 구역 → 전용 구역 이전 계획
    evictionQuotaRatio: 0.25,
    entryQuotaRatio: 0.25,
    disabledZones: new Set(['E01', 'E02']),
    // 5℃ 이하 보관 가능한 냉장 챔버(선반랙). 수산물·생닭·다짐육은 반드시 여기에 보관.
    // 일반 축산은 D03~D06이 원칙이며, 적정 공셀이 없을 때만 챔버를 대체 위치로 사용.
    chamberZones: new Set(['D01', 'D02']),
    // 메추리알 플로우랙 진입(출고·재고 모두 이상) / 퇴출(출고·재고 모두 이하) 기준. 사이 구간은 현 위치 유지.
    quailFlow: Object.freeze({ entryOut: 30, entryStock: 60, exitOut: 15, exitStock: 20 }),
    // 메추리알 전용 선반 구역(플로우랙 진입 대상이 아닌 메추리알은 모두 여기로 응집)
    quailZone: Object.freeze(['A07-060101', 'A07-070505']),
    kimchiZones: new Set(['C08', 'C09']),  // 김치 전용 구역(장기적으로 모든 김치 응집)
    kimchiTempZones: new Set(['D06']),     // 김치 임시 보관 구역(규정 위반이 아닌 이전 계획 대상)
    eggGateZone: 'A09',     // 계란 전용 게이트랙
    eggGatePriorityOut: 100, // 이 출고 수량 이상인 계란은 A09를 우선 탐색
    nonEggGateZone: 'A10',  // 비계란 게이트랙
    frozenZones: new Set(['E04', 'E05', 'E06', 'E07', 'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12']),

    // ---------- 현장 기준 수치 (출고 = 지시 PCS, 재고 = 현재고) ----------
    // 플로우랙: 진입은 출고·재고 모두 이상. 이미 플로우랙에 있으면 출고 또는 재고 중 하나만 넘어도 유지(퇴출 방지 완충 구간).
    flow: Object.freeze({ entryOut: 30, entryStock: 50, fromGateOut: 20, residentOut: 15, residentStock: 20, bulkProduceMinG: 1000, heavyBoxG: 7000 }),
    // 게이트랙(비계란): 진입 출고 이상, 퇴출은 출고·재고 모두 이하일 때
    gate: Object.freeze({ entryOut: 100, exitOut: 70, exitStock: 50 }),
    // 김치 C09 플로우랙: 진입(출고·재고 모두 이상), 퇴출(모두 이하), C08 → C09 전진 배치(모두 이상)
    kimchiFlow: Object.freeze({ zone: 'C09', shelfZone: 'C08', entryOut: 40, entryStock: 50, exitOut: 15, exitStock: 20, forwardOut: 60, forwardStock: 80, highOutGoldenLevel: 80 }),
    // 계란: A09 진입(출고 또는 재고 이상), A08 선반 허용 단, 구수별 A08 구역
    egg: Object.freeze({ gateOut: 100, gateStock: 50, shelfZone: 'A08', shelfLevels: Object.freeze([2, 3, 4]),
      sizeRanges: Object.freeze({ 10: ['A08-010101', 'A08-020505'], 15: ['A08-030101', 'A08-040505'], 20: ['A08-050101', 'A08-060505'], 30: ['A08-070101', 'A08-080505'] }) }),
    // 일반 축산 허가 위치
    livestockRanges: Object.freeze([['D01-010101', 'D06-060505'], ['D07-030101', 'D07-060505']]),
    // 중량물 안전: 박스/낱개 중량 초과 시 단수 제한, 플로우랙은 낱개 중량 초과 시 특정 단 금지
    safety: Object.freeze({ heavyBoxG: 7000, heavyItemG: 3000, heavyMaxLevel: 2, flowItemG: 1000, flowBannedLevelChilled: 4, flowBannedLevelFrozen: 5 }),
    // 선반랙 재고 한계(보조 사유). 대용량 선반 존은 제외
    shelfStockLimit: 60,
    shelfStockLimitExemptZones: new Set(['A01', 'B08', 'C08', 'D08', 'D09', 'D10']),
    // A10 정책 이동: 토트·재고 기준 미만이고 입고 계획이 없을 때
    a10Policy: Object.freeze({ zone: 'A10', maxTouch: 100, maxStock: 100 })
  });
  const FAMILY_LABEL = Object.freeze({ gate: '게이트랙', flow: '플로우랙', flat: '평대', shelf: '선반랙', showcase: '쇼케이스/리치인', other: '기타' });
  const FAMILY_RANK = Object.freeze({ gate: 1, flow: 2, flat: 2, shelf: 3, showcase: 3, other: 9 });
  // 존별 W/S 거리 순위는 qpsCore.js(DISTANCE_MAP)에서 관리(히트맵과 공용). qpsCore.js가 먼저 로드되어야 한다.
  if (!global.QPSCore || !global.QPSCore.DISTANCE_MAP) throw new Error('ruleEngine.js: qpsCore.js가 먼저 로드되어야 합니다(DISTANCE_MAP)');
  const DISTANCE_MAP = global.QPSCore.DISTANCE_MAP;
  const OPTIONAL_FIELDS = {
    vendor:['업체코드','업체명','공급업체','공급사','거래처','vendor','supplier'],
    group:['중분류','소분류','대분류','카테고리','상품분류','상품군','productgroup','category'],
    subGroup:['소분류','subcategory'],
    boxWeight:['p박스당중량','pbox중량','박스당중량','박스중량','boxweight','caseweight'],
    itemWeight:['낱개중량','개당중량','단품중량','상품중량','itemweight','unitweight'],
    incomingPlan:['향후2주입고예정','2주입고예정','입고예정','입고계획','inboundplan','incomingplan'],
    fragile:['낙손','파손우려','취급주의','fragile','breakable'], event:['행사','행사여부','프로모션','대량행사','event','promotion']
  };
  const text = value => String(value == null ? '' : value).trim();
  const key = value => text(value).toLowerCase().replace(/[\s_\-()]/g, '');
  const number = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const m = text(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
  };
  const yes = value => ['y','yes','true','1','예','여','적용','대상','행사'].includes(key(value));
  const skuId = value => { const v = text(value).replace(/\.0+$/, '').replace(/\D/g, ''); return v ? v.padStart(13, '0') : ''; };
  const inRange = (value, from, to) => value >= from && value <= to;
  function thermalClass(cell) {
    if (cell.temp === 'frozen' || cell.temp === 'chilled') return cell.temp;
    const zone = text(cell.zone);
    return CONFIG.frozenZones.has(zone) ? 'frozen' : 'chilled';
  }
  function weightInGrams(value, headerHint) {
    const n = number(value);
    if (!n) return 0;
    const source = `${text(value)} ${text(headerHint)}`.toLowerCase();
    return source.includes('kg') || source.includes('킬로') ? n * 1000 : n;
  }
  function extractWeightFromName(name) {
    const m = text(name).match(/(\d+(?:\.\d+)?)\s*(kg|g|킬로|그램|l|ml)/i);
    if (!m) return 0;
    const unit = m[2].toLowerCase();
    return ['kg','킬로','l'].includes(unit) ? Number(m[1]) * 1000 : Number(m[1]);
  }
  function levelOfLocation(loc) { const m = text(loc).match(/(\d{6})$/); return m ? Number(m[1].slice(2, 4)) : 0; }
  function rackFamily(cell) {
    const zone = text(cell.zone), raw = `${text(cell.rackType)} ${zone}`.toLowerCase();
    if (zone === 'A10') return 'gate';
    if (zone === 'C09' || zone === 'C10' || /^F\d{2}$/.test(zone)) return 'flow';
    if (inRange(text(cell.location), 'D02-010101', 'D02-020108') || inRange(text(cell.location), 'E04-070101', 'E04-080108')) return 'flat';
    if (/게이트|gate/.test(raw)) return 'gate'; if (/플로우|flow/.test(raw)) return 'flow';
    if (/평대|flat/.test(raw)) return 'flat'; if (/쇼케이스|다단|오픈|리치인|워크인|showcase/.test(raw)) return 'showcase';
    return /선반|shelf/.test(raw) ? 'shelf' : 'other';
  }
  // 분류 컬럼이 없을 때만 쓰는 상품명 기반 김치 판정.
  // 김치 키워드 '뒤'에 조리/가공 식품어가 오면(김치찌개, 동치미냉면) 제외하고,
  // 앞에 오는 경우(찌개용 김치, 특제육수 포기김치)는 김치로 본다. 만두/교자류는 항상 제외.
  const KIMCHI_NAME = /김치|묵은지|소박이|섞박지|석박지|깍두기|겉절이|총각무|동치미|무생채/;
  const KIMCHI_DISH_NAME = /찌개|찜|전골|짜글이|냉면|냉국수|육수|국수|우동|수제비|라볶이|만두|교자|전병|김치\s*전|볶음밥|덮밥|주먹밥|김밥|양밥|제육|감바스|어묵/;
  function isKimchiByName(name) {
    const m = KIMCHI_NAME.exec(name);
    if (!m) return false;
    return !KIMCHI_DISH_NAME.test(name.slice(m.index)) && !/만두|교자/.test(name);
  }
  function categorize(profile) {
    const name = text(profile.name), group = text(profile.group), subGroup = text(profile.subGroup);
    // 분류 컬럼이 있으면 분류로 판정(메추리알은 소분류, 가공 메추리알은 중분류 '계란' + 이름). 없으면 이름 기반.
    const eggClass = group === '계란' || subGroup.includes('계란'); // 올가닉계란(중분류 올가닉신선) 포함
    const quail = group ? subGroup.includes('메추리알') || group.includes('메추리알') || (eggClass && name.includes('메추리'))
      : name.includes('메추리알') && !/장조림|조림|볶음|샐러드|김밥|꼬치/.test(name);
    const kimchi = group ? group.includes('김치') : isKimchiByName(name);
    const processedEgg = /연두부|장조림|소시지|소세지|과자|빵|볶음밥|말이|찜/.test(name) || ['두부/묵/콩가공품','반찬','햄/소시지','간편식','가공식품'].includes(group);
    const egg = (group ? eggClass : /계란|식용란|유정란|왕란|특란|대란|신선란|구운란/.test(name) && !processedEgg) && !quail;
    const livestock = ['수입육','우육','돈육','계육','양념육'].includes(group);
    const processedChicken = /닭갈비|양념|볶음(?!탕)|훈제/.test(name); // '볶음탕용 생닭'은 원료육
    const seafoodOrPoultry = ['대중선어','구색선어','생선회','갑각류','패류','연체류'].includes(group) || (group === '계육' && !processedChicken);
    return { egg, quailEgg: quail, livestock, kimchi, zeroToFive: seafoodOrPoultry || (['수입육','우육','돈육'].includes(group) && name.includes('다짐육')) };
  }
  // '[30구 단위 구매 가능] … 15구'처럼 대괄호 안의 판촉 문구는 제외하고 구수 파싱
  function parseEggSize(name, group) {
    const m = `${text(name).replace(/\[[^\]]*\]/g, ' ')} ${text(group)}`.match(/(?:^|\D)(10|15|20|30)\s*(?:구|개입)/);
    return m ? Number(m[1]) : null;
  }
  function mapHeaders(rows) {
    if (!rows.length) return {};
    const headers = Object.keys(rows[0]), fields = { sku:['물류상품ID','SKU','상품ID','productid'], name:['물류상품명','상품명','품명','productname'], ...OPTIONAL_FIELDS };
    const result = {};
    Object.entries(fields).forEach(([field, aliases]) => {
      result[field] = aliases.map(alias => headers.find(h => key(h) === key(alias))).find(Boolean) || aliases.map(alias => headers.find(h => key(h).includes(key(alias)) || key(alias).includes(key(h)))).find(Boolean) || null;
    });
    return result;
  }
  function buildProfiles(allData) {
    const data = new Map(), rows = [allData.cellRows || [], allData.boxRows || []];
    rows.forEach(sourceRows => {
      const headers = mapHeaders(sourceRows); if (!headers.sku) return;
      sourceRows.forEach(row => {
        const sku = skuId(row[headers.sku]); if (!sku) return;
        const old = data.get(sku) || {};
        data.set(sku, {
          name:text(row[headers.name]) || old.name, group:text(row[headers.group]) || old.group, subGroup:text(row[headers.subGroup]) || old.subGroup, vendor:text(row[headers.vendor]) || old.vendor,
          boxWeightRaw:text(row[headers.boxWeight]) || old.boxWeightRaw, itemWeightRaw:text(row[headers.itemWeight]) || old.itemWeightRaw,
          incomingPlan:text(row[headers.incomingPlan]) || old.incomingPlan, fragile:yes(row[headers.fragile]) || old.fragile, event:yes(row[headers.event]) || old.event
        });
      });
    });
    const profiles = new Map();
    allData.assignedCells.forEach(cell => {
      if (!cell.sku || profiles.has(cell.sku)) return;
      const raw = data.get(cell.sku) || {}, name = text(cell.productName || allData.skuMeta.get(cell.sku)?.name || raw.name);
      const profile = { sku:cell.sku, name, group:raw.group || '', subGroup:raw.subGroup || '', vendor:raw.vendor || '', boxWeightG:weightInGrams(raw.boxWeightRaw, 'box'), itemWeightG:weightInGrams(raw.itemWeightRaw, 'ea') || extractWeightFromName(name), incomingPlan:raw.incomingPlan || '', fragile:!!raw.fragile, event:!!raw.event };
      profile.category = categorize(profile);
      profile.eggSize = parseEggSize(name, profile.group);
      profiles.set(cell.sku, profile);
    });
    return profiles;
  }
  function makeNode(cell) {
    const loc = text(cell.location);
    return { cell, loc, zone:text(cell.zone), family:rackFamily(cell), temp:thermalClass(cell), level:levelOfLocation(loc), distRack:loc.slice(-6, -4), distSix:loc.slice(-6) };
  }
  function quailFlowEntry(p) { return p.outboundPcs >= CONFIG.quailFlow.entryOut && p.stock >= CONFIG.quailFlow.entryStock; }
  function isFlowAllowed(p) {
    if (p.category.quailEgg) return quailFlowEntry(p) || p.sourceFamily === 'flow' && (p.outboundPcs > CONFIG.quailFlow.exitOut || p.stock > CONFIG.quailFlow.exitStock);
    const f = CONFIG.flow;
    return p.outboundPcs >= f.entryOut && p.stock >= f.entryStock || p.sourceFamily === 'gate' && p.outboundPcs >= f.fromGateOut || p.sourceFamily === 'flow' && (p.outboundPcs > f.residentOut || p.stock > f.residentStock) || (p.stock > 0 && p.itemWeightG >= f.bulkProduceMinG && /배추|양배추|무\(통\)|수박/.test(p.name)) || p.boxWeightG >= f.heavyBoxG;
  }
  function isGeneralLivestock(p) { return p.category.livestock && !p.category.zeroToFive && p.temp !== 'frozen'; }
  function livestockAllowed(pc) { return CONFIG.livestockRanges.some(r => inRange(pc.loc, ...r)); }
  // 거절 시 kind: 'volume'(물량 기준 — 진입/퇴출 판정에 맡김), 'safety'(안전 수칙),
  //   'reserve'(전용 구역 확보 — ZONE_EVICTION으로 처리), 'relocation'(임시 보관 — RELOCATION으로 처리), 없음(위치 규정)
  function candidateAllowed(pc, source, p) {
    if (pc.temp !== source.temp) return { ok:false, reason:'온도대 불일치' };
    if (CONFIG.disabledZones.has(pc.zone)) return { ok:false, reason:'할당 금지 구역' };
    const eggGate = pc.zone === CONFIG.eggGateZone;
    if (eggGate && !p.category.egg) return { ok:false, reason:`${CONFIG.eggGateZone} 계란 전용 게이트랙` };
    if (pc.zone === CONFIG.nonEggGateZone && p.category.egg) return { ok:false, reason:`${CONFIG.nonEggGateZone} 비계란 게이트랙(계란 배치 불가)` };
    // 계란 전용 게이트랙은 아래 계란 기준(eggAllowed)이 진입 여부를 판정
    if (pc.family === 'gate' && !eggGate && p.outboundPcs < CONFIG.gate.entryOut) return { ok:false, reason:'게이트랙 출고 기준 미달', kind:'volume' };
    // 메추리알 전용 구역은 다른 SKU의 이동 대상에서 제외(현재 위치 재검증에는 적용하지 않음)
    if (pc !== source && !p.category.quailEgg && inRange(pc.loc, ...CONFIG.quailZone)) return { ok:false, reason:'메추리알 전용 구역' };
    if (p.temp === 'frozen' && !CONFIG.frozenZones.has(pc.zone)) return { ok:false, reason:'냉동 전용 구역 필요' };
    if (p.temp !== 'frozen' && CONFIG.frozenZones.has(pc.zone)) return { ok:false, reason:'냉동 구역 배정 불가' };
    if (p.category.zeroToFive && p.temp !== 'frozen' && !CONFIG.chamberZones.has(pc.zone)) return { ok:false, reason:'0~5℃ 전용 구역 필요' };
    if (p.category.livestock && p.temp !== 'frozen' && !livestockAllowed(pc)) return { ok:false, reason:'축산 허가 구역 조건 불충족' };
    if (p.category.kimchi && !CONFIG.kimchiZones.has(pc.zone)) return pc === source && CONFIG.kimchiTempZones.has(pc.zone)
      ? { ok:false, reason:'김치 임시 보관 구역', kind:'relocation' } : { ok:false, reason:'김치 전용 구역 필요' };
    if (!p.category.kimchi && CONFIG.kimchiZones.has(pc.zone)) return { ok:false, reason:'김치 전용 구역(C08/C09) 비김치 배치 불가', kind:'reserve' };
    if (p.category.kimchi && pc.zone === CONFIG.kimchiFlow.zone && (p.outboundPcs < CONFIG.kimchiFlow.entryOut || p.stock < CONFIG.kimchiFlow.entryStock)) return { ok:false, reason:'저빈도 김치 C09 진입 불가', kind:'volume' };
    if (p.category.quailEgg) {
      const high = quailFlowEntry(p);
      if (high ? pc.family !== 'flow' : !inRange(pc.loc, ...CONFIG.quailZone)) return { ok:false, reason:'메추리알 전용 위치 조건 불충족', kind:(high || pc.family === 'flow') ? 'volume' : undefined };
    }
    if (p.category.egg && !eggAllowed(pc,p)) return { ok:false, reason:'계란 전용 위치 조건 불충족', kind:pc.zone === CONFIG.eggGateZone ? 'volume' : undefined };
    if (!p.category.quailEgg && !p.category.kimchi && pc.family === 'flow' && p.temp !== 'frozen' && !isFlowAllowed(p)) return { ok:false, reason:'플로우랙 물량 기준 미달', kind:'volume' };
    const sf = CONFIG.safety;
    if (pc.family === 'flow' && p.itemWeightG > sf.flowItemG && ((p.temp !== 'frozen' && pc.level === sf.flowBannedLevelChilled) || (p.temp === 'frozen' && pc.level === sf.flowBannedLevelFrozen))) return { ok:false, reason:'플로우랙 중량 단수 제한', kind:'safety' };
    if ((p.boxWeightG > sf.heavyBoxG || p.itemWeightG > sf.heavyItemG) && pc.level > sf.heavyMaxLevel) return { ok:false, reason:'중량물 하단 보관 안전 수칙', kind:'safety' };
    return { ok:true };
  }
  function eggGateQualified(p) { return p.outboundPcs >= CONFIG.egg.gateOut || p.stock >= CONFIG.egg.gateStock; }
  function eggAllowed(pc,p) {
    const e = CONFIG.egg;
    if (eggGateQualified(p) && pc.zone === CONFIG.eggGateZone) return true;
    if (pc.zone !== e.shelfZone) return p.event && pc.zone === CONFIG.eggGateZone;
    if (!e.shelfLevels.includes(pc.level)) return false;
    const range = e.sizeRanges[p.eggSize];
    return !range || inRange(pc.loc, ...range);
  }
  function violations(source,p) {
    const mandatory = [], soft = [], c = p.category, z = source.zone;
    const noInbound = ['0','없음','무','no','n','미정'].includes(key(p.incomingPlan));
    if (z === CONFIG.a10Policy.zone && p.touch < CONFIG.a10Policy.maxTouch && p.stock <= CONFIG.a10Policy.maxStock && p.incomingPlan && noInbound) mandatory.push({type:'POLICY', text:'A10 이동 기준 충족: 출고·재고·입고계획 기준 미달'});
    const own = candidateAllowed(source, source, p);
    if (!own.ok && own.kind === 'relocation') mandatory.push({type:'RELOCATION', text:`${z} 임시 보관 김치 · C08/C09 이전 계획`});
    else if (!own.ok && own.kind === 'reserve') mandatory.push({type:'ZONE_EVICTION', text:'김치 전용 구역(C08/C09) 확보를 위한 비김치 퇴출 필요'});
    else if (!own.ok && own.kind !== 'volume') mandatory.push({type:own.kind === 'safety' ? 'SAFETY' : 'COMPLIANCE', text:own.reason});
    const kf = CONFIG.kimchiFlow;
    if (c.kimchi && z === kf.zone && p.outboundPcs <= kf.exitOut && p.stock <= kf.exitStock) mandatory.push({type:'EVICTION', text:'김치 물량 급감으로 C09 플로우랙 퇴출 필요'});
    if (c.kimchi && z === kf.shelfZone && p.outboundPcs >= kf.forwardOut && p.stock >= kf.forwardStock) mandatory.push({type:'FORWARD', text:'김치 고빈도 물량 급증으로 C09 전진 배치 필요'});
    if (source.family === 'gate' && p.outboundPcs <= CONFIG.gate.exitOut && p.stock <= CONFIG.gate.exitStock) mandatory.push({type:'EVICTION', text:'게이트랙 기준 미달로 퇴출 필요'});
    if (c.quailEgg && source.family === 'flow' && p.outboundPcs <= CONFIG.quailFlow.exitOut && p.stock <= CONFIG.quailFlow.exitStock) mandatory.push({type:'EVICTION', text:'메추리알 물량 급감으로 플로우랙 퇴출 필요'});
    if (c.quailEgg && source.family !== 'flow' && p.temp !== 'frozen' && quailFlowEntry(p)) mandatory.push({type:'ENTRY', text:'메추리알 고빈도 물량으로 플로우랙 진입 필요'});
    if (!c.quailEgg && !c.kimchi && source.family === 'flow' && p.temp !== 'frozen' && p.stock > 0 && !isFlowAllowed(p)) mandatory.push({type:'EVICTION', text:'플로우랙 물량 기준 미달로 퇴출 필요'});
    // 계란은 플로우랙 배치 불가(A08/A09 전용)이므로 일반 진입 대상에서 제외 — 고빈도 계란은 A09 우선 탐색으로 처리
    if (!c.quailEgg && !c.kimchi && !c.egg && ['shelf','showcase'].includes(source.family) && p.temp !== 'frozen' && isFlowAllowed(p)) mandatory.push({type:'ENTRY', text:'고빈도 SKU 플로우랙 진입 필요 (선반랙 대비 보충·피킹 생산성 저하)'});
    if (isGeneralLivestock(p) && CONFIG.chamberZones.has(z)) soft.push('일반 축산 5℃ 챔버(D01~D02) 대체 보관 중 · D03~D06 공셀 확보 시 복귀 권장');
    if (source.family === 'shelf' && p.stock >= CONFIG.shelfStockLimit && !c.egg && !c.quailEgg && !CONFIG.shelfStockLimitExemptZones.has(z)) soft.push(`현재고 ${CONFIG.shelfStockLimit}개 이상으로 선반랙 한계 초과`);
    return { mandatory, soft };
  }
  function distanceScore(pc,p) {
    const rows = DISTANCE_MAP[pc.zone] || []; let rank = 4;
    for (let i=0; i<rows.length; i++) if (rows[i].includes(pc.distRack) || rows[i].includes(pc.distSix)) { rank=i; break; }
    if (p.outboundPcs >= 30) return [60,30,0,-30,-30][rank] || -30;
    if (p.outboundPcs <= 10) return [-60,-30,10,30,30][rank] || 30;
    return -rank * 15;
  }
  function zScore(pc,p) {
    let score=0, golden=false, dead=false;
    if (pc.family === 'flow') golden = p.temp === 'chilled' ? [2,3].includes(pc.level) : [2,3,4].includes(pc.level);
    else if (pc.family === 'shelf') { golden=[2,3,4].includes(pc.level); dead=pc.level===1 || pc.level>=5; }
    else if (pc.family === 'showcase') golden = p.temp === 'chilled' ? pc.level>=1 && pc.level<=4 : [1,3,5].includes(pc.level);
    if (golden) score += p.outboundPcs >= 30 ? 30 : p.outboundPcs <= 10 ? -30 : 0;
    if (dead) score += p.outboundPcs <= 10 ? 20 : p.outboundPcs >= 30 ? -30 : 0;
    if (p.itemWeightG > 0 && p.itemWeightG <= 500 && pc.family === 'shelf') score += pc.level===5 ? 60 : pc.level===4 ? 30 : pc.level===1 ? -60 : 0;
    return score;
  }
  function preferredFamilies(p) {
    if (p.category.kimchi) return p.outboundPcs >= CONFIG.kimchiFlow.entryOut && p.stock >= CONFIG.kimchiFlow.entryStock ? ['flow'] : ['shelf'];
    if (p.category.quailEgg) return isFlowAllowed(p) ? ['flow'] : ['shelf'];
    if (p.category.egg) return eggGateQualified(p) ? ['gate','shelf'] : ['shelf']; // A09 계란 게이트랙 / A08 선반
    if (p.boxWeightG >= CONFIG.flow.heavyBoxG && p.stock >= CONFIG.flow.entryStock) return ['flow','flat'];
    if (p.temp === 'frozen' && /^F/.test(p.sourceZone)) return ['flow','flat'];
    if (p.sourceFamily === 'gate' && p.outboundPcs >= CONFIG.flow.fromGateOut) return ['flow','flat'];
    return isFlowAllowed(p) ? ['flow','flat','shelf'] : ['shelf','showcase','flat'];
  }
  function familyScore(family, preferred) { if (preferred.includes(family)) return 150; return Math.max(-80,35-Math.abs((FAMILY_RANK[family]||9)-Math.min(...preferred.map(x=>FAMILY_RANK[x]||9)))*45); }
  // W/S 부하 = W/S에 할당된 SKU별 지시 토트 수 합계(대시보드 '지시 SKU수'와 같은 정의). 공셀만 있는 W/S는 0.
  function buildWsMap(allData) {
    const map=new Map(), seen=new Set();
    allData.emptyCells.forEach(cell=>{ if(cell.ws&&!map.has(cell.ws)) map.set(cell.ws,{touches:0}); });
    allData.assignedCells.forEach(cell=>{ if(!cell.ws||!cell.sku) return; const pair=`${cell.ws}||${cell.sku}`; if(seen.has(pair)) return; seen.add(pair); const row=map.get(cell.ws)||{touches:0}; row.touches+=allData.skuToToteCount.get(cell.sku)||0; map.set(cell.ws,row); });
    return map;
  }
  // 이동 확정 시 부하를 옮긴다(총량 불변이므로 평균도 불변)
  function applyWsMove(context, from, to, touch) {
    if (!from || !to || from===to || !touch) return;
    const a=context.wsMap.get(from), b=context.wsMap.get(to); if(!a||!b) return;
    a.touches-=touch; b.touches+=touch;
  }
  function balanceScore(context, from, to, touch) {
    if (!from || !to || from===to || !context.average) return {score:0, compliant:true};
    const a=context.wsMap.get(from), b=context.wsMap.get(to); if(!a||!b) return {score:0, compliant:true};
    const avg=context.average, dev=v=>(v-avg)/avg;
    // 허용 여부: 두 W/S 중 큰 편차가 기준(10%) 이내이거나 개선되면 허용(기존 기준 유지)
    const before=Math.max(Math.abs(dev(a.touches)),Math.abs(dev(b.touches)));
    const after=Math.max(Math.abs(dev(a.touches-touch)),Math.abs(dev(b.touches+touch)));
    // 점수: 두 W/S 편차 제곱합의 감소량. 큰 편차만 보면 출발 W/S가 과부하일 때 도착 W/S의 부하 차이가
    // 점수에 반영되지 않아, 이미 추천이 몰린 W/S와 빈 W/S를 구분하지 못했음.
    const sq=(x,y)=>dev(x)**2+dev(y)**2;
    return {score:(sq(a.touches,b.touches)-sq(a.touches-touch,b.touches+touch))*40, compliant:after<=CONFIG.wsDeviation || after<=before};
  }
  function score(pc,source,p,context,preferred) {
    const balance=balanceScore(context,source.cell.ws,pc.cell.ws,p.touch);
    let value=familyScore(pc.family,preferred)+distanceScore(pc,p)+zScore(pc,p)+balance.score;
    if(pc.zone===source.zone) value+=30; else if(pc.zone[0]===source.zone[0]) value+=10;
    if(pc.cell.ws && pc.cell.ws===source.cell.ws) value+=20;
    if(pc.zone.startsWith('F')) value+=Number(pc.zone.slice(1))*3;
    const kf=CONFIG.kimchiFlow;
    if(p.category.kimchi) value+=pc.zone===kf.shelfZone?100:pc.zone===kf.zone?(p.outboundPcs>=kf.highOutGoldenLevel&&[2,3].includes(pc.level)?200:50):0;
    return {score:value,balance};
  }
  function createEmptyIndex(cells) {
    const index={byTemp:{chilled:[],frozen:[]}, byTempFamily:new Map(), byTempZone:new Map()};
    cells.map(makeNode).forEach(node=>{ if(!index.byTemp[node.temp]) return; index.byTemp[node.temp].push(node); const tf=`${node.temp}|${node.family}`, tz=`${node.temp}|${node.zone}`; if(!index.byTempFamily.has(tf)) index.byTempFamily.set(tf,[]); if(!index.byTempZone.has(tz)) index.byTempZone.set(tz,[]); index.byTempFamily.get(tf).push(node); index.byTempZone.get(tz).push(node); });
    return index;
  }
  function candidatePool(index,p,preferred) {
    const pools=preferred.map(f=>index.byTempFamily.get(`${p.temp}|${f}`)||[]).filter(x=>x.length);
    return pools.length ? pools.flat() : (index.byTemp[p.temp]||[]);
  }
  function reasons(source,target,p,violations,preferred,scoreInfo,flowTiered) {
    const list=violations.map(v=>typeof v==='string'?v:v.text);
    if(flowTiered&&target.family==='flat') list.push('플로우랙 적정 공셀 없어 평대 차선 배치');
    else if(preferred.includes(target.family)) list.push(`${FAMILY_LABEL[target.family]||'기타'} 배치 권장`);
    if(p.category.egg&&target.zone===CONFIG.eggGateZone&&p.outboundPcs>=CONFIG.eggGatePriorityOut) list.push(`고빈도 계란(출고 ${CONFIG.eggGatePriorityOut} 이상) ${CONFIG.eggGateZone} 게이트랙 우선 배치`);
    if(p.category.egg) list.push('계란 전용 위치 조건 반영');
    if(p.category.kimchi) list.push('김치 전용(C08/C09) 구역 반영');
    if(p.category.zeroToFive && p.temp!=='frozen') list.push('0~5℃ 전용 보관 조건 반영');
    if(scoreInfo.balance.score>1) list.push('W/S SKU 부하 편차 완화');
    return [...new Set(list)].join(' · ');
  }
  function recommend(allData) {
    if(!allData || !Array.isArray(allData.assignedCells) || !Array.isArray(allData.emptyCells)) return [];
    const profiles=buildProfiles(allData), index=createEmptyIndex(allData.emptyCells), wsMap=buildWsMap(allData);
    let total=0; wsMap.forEach(v=>total+=v.touches); const context={wsMap,average:wsMap.size?total/wsMap.size:0};
    const flowSpaceByTemp={chilled:(index.byTempFamily.get('chilled|flow')||[]).length,frozen:(index.byTempFamily.get('frozen|flow')||[]).length};
    const active=[], seen=new Set();
    allData.assignedCells.forEach(cell=>{
      if(!cell.sku||seen.has(cell.sku)) return; seen.add(cell.sku);
      const source=makeNode(cell), base=profiles.get(cell.sku)||{sku:cell.sku,name:text(cell.productName),group:'',category:categorize({name:text(cell.productName),group:''}),boxWeightG:0,itemWeightG:0};
      const p={...base,touch:allData.skuToToteCount.get(cell.sku)||allData.skuToPcs.get(cell.sku)||0,outboundPcs:allData.skuToPcs.get(cell.sku)||0,stock:number(cell.stock),temp:source.temp,sourceZone:source.zone,sourceFamily:source.family};
      if(p.stock===0&&p.outboundPcs===0) return;
      const v=violations(source,p), mandatory=v.mandatory.length>0;
      if(p.outboundPcs>0&&p.stock<=p.outboundPcs*.5&&!mandatory) return;
      const hasFlowSpace=flowSpaceByTemp[p.temp]>0;
      const urgency= v.mandatory.some(x=>x.type==='SAFETY') ? 100000
        : v.mandatory.some(x=>x.type==='COMPLIANCE') ? 50000+Math.min(9999,p.outboundPcs)
        : v.mandatory.some(x=>x.type==='FORWARD') ? 2000+p.outboundPcs
        : v.mandatory.some(x=>x.type==='ENTRY') ? (hasFlowSpace ? 1800+p.outboundPcs : 150+Math.min(150,p.outboundPcs))
        : v.mandatory.some(x=>x.type==='EVICTION') ? 300+Math.max(0,(10-p.outboundPcs)*10+(20-p.stock))
        : v.mandatory.some(x=>x.type==='ZONE_EVICTION') ? 200+(99-Math.min(99,p.outboundPcs))
        : v.mandatory.some(x=>x.type==='RELOCATION') ? 110+Math.min(79,p.outboundPcs)
        : mandatory?100:0;
      active.push({source,p,v,mandatory,urgency});
    });
    // 공셀은 이 순서대로 선점되므로 반드시 urgency 순(동률이면 토트 수 순)으로 처리
    active.sort((a,b)=>b.urgency-a.urgency||b.p.touch-a.p.touch);
    const used=new Set(), result=[], vacating=[], waiting=[];
    const quotaLimits={COMPLIANCE:Math.floor(CONFIG.maxRecommendations*CONFIG.complianceQuotaRatio),ZONE_EVICTION:Math.floor(CONFIG.maxRecommendations*CONFIG.zoneEvictionQuotaRatio),RELOCATION:Math.floor(CONFIG.maxRecommendations*CONFIG.relocationQuotaRatio),EVICTION:Math.floor(CONFIG.maxRecommendations*CONFIG.evictionQuotaRatio),ENTRY:Math.floor(CONFIG.maxRecommendations*CONFIG.entryQuotaRatio),OPTIMIZATION:CONFIG.maxOptimization};
    const quotaCounts={COMPLIANCE:0,ZONE_EVICTION:0,RELOCATION:0,EVICTION:0,ENTRY:0,OPTIMIZATION:0};
    const has=(item,type)=>item.v.mandatory.some(x=>x.type===type);
    // 쿼터 카테고리는 화면 분류(priorityType)와 같은 우선순서로 판정: ENTRY이면서 퇴출 표시가 붙은 건은 ENTRY 쿼터
    const quotaKeyOf=item=>!item.mandatory?'OPTIMIZATION':has(item,'SAFETY')?null:has(item,'COMPLIANCE')?'COMPLIANCE':has(item,'FORWARD')?null:has(item,'ENTRY')?'ENTRY':has(item,'EVICTION')?'EVICTION':has(item,'ZONE_EVICTION')?'ZONE_EVICTION':has(item,'RELOCATION')?'RELOCATION':null;
    active.slice(0,CONFIG.maxSourceCandidates).forEach(item=>{
      const quotaKey=quotaKeyOf(item);
      if(quotaKey&&quotaCounts[quotaKey]>=quotaLimits[quotaKey]) return;
      const isEntryItem=item.v.mandatory.some(x=>x.type==='ENTRY');
      const preferred=isEntryItem?['flow','flat']:preferredFamilies(item.p);
      const pool=isEntryItem
        ? [...(index.byTempFamily.get(`${item.p.temp}|flow`)||[]),...(index.byTempFamily.get(`${item.p.temp}|flat`)||[])]
        : candidatePool(index,item.p,preferred);
      // 일반 축산은 D03~D06 등 비챔버 공셀을 먼저 찾고, 없을 때만 5℃ 챔버(D01~D02)를 사용
      const generalLivestock=isGeneralLivestock(item.p);
      // 평대는 피킹은 플로우랙과 동등하지만 보충이 불편하므로, 플로우랙 선호 SKU는
      // 플로우랙 → 평대 → 그 외 순으로 단계 탐색(앞 단계에 적정 공셀이 없을 때만 다음 단계)
      // 고빈도 계란은 A09(계란 게이트랙) → 그 외 순으로 단계 탐색
      const flowTiered=preferred.includes('flow');
      const eggGateFirst=item.p.category.egg&&item.p.outboundPcs>=CONFIG.eggGatePriorityOut;
      const tiers=flowTiered
        ? [pool.filter(pc=>pc.family==='flow'),pool.filter(pc=>pc.family==='flat'),pool.filter(pc=>pc.family!=='flow'&&pc.family!=='flat')]
        : eggGateFirst ? [pool.filter(pc=>pc.zone===CONFIG.eggGateZone),pool.filter(pc=>pc.zone!==CONFIG.eggGateZone)]
        : [pool];
      const pickBest=allowChamber=>{ for(const tier of tiers){ const best=pickTier(tier,allowChamber); if(best) return best; } return null; };
      const pickTier=(tier,allowChamber)=>{ let best=null;
      for(const pc of tier){ if(used.has(pc.loc)) continue; if(!allowChamber&&CONFIG.chamberZones.has(pc.zone)) continue; const allowed=candidateAllowed(pc,item.source,item.p); if(!allowed.ok) continue; const s=score(pc,item.source,item.p,context,preferred); if(!s.balance.compliant&&!item.mandatory) continue; if(!best||s.score>best.scoreInfo.score||(s.score===best.scoreInfo.score&&pc.loc<best.pc.loc)) best={pc,scoreInfo:s}; }
      return best; };
      let best=pickBest(!generalLivestock);
      if(!best&&generalLivestock) best=pickBest(true);
      const chamberReturn=generalLivestock&&CONFIG.chamberZones.has(item.source.zone)&&best&&!CONFIG.chamberZones.has(best.pc.zone);
      const eggGateMove=eggGateFirst&&item.source.zone!==CONFIG.eggGateZone&&best&&best.pc.zone===CONFIG.eggGateZone;
      const sourceScore=score(item.source,item.source,item.p,context,preferred).score;
      if(!best&&!item.mandatory) return; if(best&&!item.mandatory&&!chamberReturn&&!eggGateMove&&best.scoreInfo.score<sourceScore+25) return;
      if(best){ used.add(best.pc.loc); applyWsMove(context,item.source.cell.ws,best.pc.cell.ws,item.p.touch); }
      if(quotaKey) quotaCounts[quotaKey]++;
      const priorityType=item.v.mandatory.some(x=>x.type==='SAFETY')?'SAFETY':item.v.mandatory.some(x=>x.type==='COMPLIANCE')?'COMPLIANCE':item.v.mandatory.some(x=>x.type==='FORWARD')?'FORWARD':item.v.mandatory.some(x=>x.type==='ENTRY')?'ENTRY':item.v.mandatory.some(x=>x.type==='RELOCATION')?'RELOCATION':item.v.mandatory.some(x=>x.type==='POLICY')?'POLICY':'OPTIMIZATION';
      const moveType=item.v.mandatory.some(x=>x.type==='EVICTION'||x.type==='ZONE_EVICTION')?'EVICTION':best?'MOVE':'NO_TARGET';
      const rec={sku:item.source.cell.sku,productName:item.p.name||item.source.cell.productName||'',pcs:item.p.outboundPcs,stock:item.p.stock,toteCount:item.p.touch,temp:item.source.temp,currentCell:item.source.loc,currentRack:text(item.source.cell.rackType)||item.source.family,targetRack:best?(text(best.pc.cell.rackType)||best.pc.family):'공셀 확보 필요',targetCell:best?best.pc.loc:'-',targetWs:best?.pc.cell.ws||'',reason:best?reasons(item.source,best.pc,item.p,[...item.v.mandatory,...item.v.soft],preferred,best.scoreInfo,flowTiered):[...item.v.mandatory.map(x=>x.text),...item.v.soft].join(' · '),mandatory:item.mandatory?1:0,priorityType,moveType,zoneEviction:has(item,'ZONE_EVICTION')&&!has(item,'EVICTION')?1:0,urgency:item.urgency,improvement:best?best.scoreInfo.score-sourceScore:-999,status:best?'READY':'NO_TARGET'};
      result.push(rec);
      if(best&&moveType==='EVICTION') vacating.push({item,rec});
      if(!best&&item.mandatory) waiting.push({item,rec,preferred,flowTiered});
    });
    // 퇴출→진입 연결: 목적지가 없던 필수 추천에, 퇴출로 비게 될 셀을 긴급도 순으로 배정
    const vacantNodes=vacating.map(v=>({node:makeNode({...v.item.source.cell,sku:'',isEmpty:true,stock:0,productName:''}),by:v}));
    waiting.sort((a,b)=>b.item.urgency-a.item.urgency||b.item.p.touch-a.item.p.touch);
    for(const w of waiting){
      let best=null;
      for(const v of vacantNodes){ if(v.taken) continue; const allowed=candidateAllowed(v.node,w.item.source,w.item.p); if(!allowed.ok) continue; const s=score(v.node,w.item.source,w.item.p,context,w.preferred); if(!best||s.score>best.scoreInfo.score||(s.score===best.scoreInfo.score&&v.node.loc<best.v.node.loc)) best={v,scoreInfo:s}; }
      if(!best) continue;
      best.v.taken=true;
      const {node,by}=best.v, r=w.rec;
      applyWsMove(context,w.item.source.cell.ws,node.cell.ws,w.item.p.touch);
      Object.assign(r,{targetCell:node.loc,targetRack:text(node.cell.rackType)||node.family,targetWs:node.cell.ws||'',moveType:'MOVE',status:'AFTER_EVICTION',
        dependsOnSku:by.rec.sku,dependsOnCell:node.loc,
        reason:`${reasons(w.item.source,node,w.item.p,[...w.item.v.mandatory,...w.item.v.soft],w.preferred,best.scoreInfo,w.flowTiered)} · 퇴출 예정 셀 사용: '${by.rec.productName}' 먼저 퇴출 후 진행`});
      by.rec.reason+=` · 비운 셀은 '${r.productName}' 배치에 사용`;
    }
    result.sort((a,b)=>b.urgency-a.urgency||b.mandatory-a.mandatory||b.improvement-a.improvement||b.toteCount-a.toteCount||b.pcs-a.pcs);
    // 카테고리 쿼터가 배정 단계에서 이미 건수를 제한하므로 별도의 총량 절단은 하지 않는다
    // (총량 절단 시 urgency가 낮은 퇴출류가 쿼터와 무관하게 통째로 잘리는 문제가 있었음).
    return result;
  }
  // _internals: 회귀 테스트(tests/)용. 화면 코드에서는 쓰지 않는다.
  global.QPSRuleEngine=Object.freeze({recommend,version:'2.47.0',CONFIG,_internals:Object.freeze({categorize,parseEggSize,rackFamily,thermalClass})});
  global.buildRecommendations=recommend;
})(window);
