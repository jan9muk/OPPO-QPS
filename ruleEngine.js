/*
 * QPS cell-allocation rule engine (Soft-Rule Applied Version)
 *
 * This module deliberately contains the allocation rules, rather than UI code.
 * The host page must expose the existing `allData` shape used by index.html.
 * Optional RAW columns are detected by their header name.  Rules whose source
 * facts are absent (weight, inbound plan, vendor, event, fragile flag) are not
 * guessed and therefore do not generate a false recommendation.
 */
(function (global) {
  'use strict';

  const CONFIG = {
    wsDeviation: 0.10,
    maxRecommendations: 20,
    disabledZones: new Set(['E01', 'E02']),
    a10OddCellsOnly: true,
    priorityPenalty: 70,
    productZones: {
      produceA: new Set(['A02', 'A03', 'A04', 'A05', 'A06', 'A07']),
      produceB: new Set(['B06', 'B07', 'B08', 'B09', 'B10']),
      frozen: new Set(['E04', 'E05', 'E06', 'E07', 'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12'])
    }
  };

  // Article 5: common priority.  Flat racks inherit Flow Rack priority and
  // showcases inherit Shelf Rack priority where the article says so.
  const FAMILY_RANK = { gate: 1, flow: 2, flat: 2, shelf: 3, showcase: 3, other: 9 };
  const SPECIAL_ZONES = new Set(['A01', 'A08', 'A10', 'C01', 'C08', 'C09', 'C10', 'D01', 'D02', 'D07', 'D08', 'D09', 'D10', 'E03', 'E04', 'E05', 'E06', 'E07']);

  const OPTIONAL_FIELDS = {
    vendor: ['업체코드', '업체명', '공급업체', '공급사', '거래처', 'vendor', 'supplier'],
    group: ['상품군', '상품분류', '카테고리', '대분류', '중분류', '소분류', 'productgroup', 'category'],
    boxWeight: ['p박스당중량', 'pbox중량', '박스당중량', '박스중량', 'boxweight', 'caseweight'],
    itemWeight: ['낱개중량', '개당중량', '단품중량', '상품중량', 'itemweight', 'unitweight'],
    incomingBoxes: ['입고량box', '입고박스수', '입고예정box', '입고수량box', 'inboundboxes', 'incomingboxes'],
    incomingPlan: ['향후2주입고예정', '2주입고예정', '입고예정', '입고계획', 'inboundplan', 'incomingplan'],
    isNew: ['신규상품', '신상품', '신규여부', 'newproduct', 'isnew'],
    fragile: ['낙손', '파손우려', '취급주의', 'fragile', 'breakable'],
    event: ['행사', '행사여부', '프로모션', '대량행사', 'event', 'promotion'],
    storage: ['보관온도', '보관조건', '온도조건', 'storagecondition', 'storagetemp']
  };

  function text(value) { return String(value == null ? '' : value).trim(); }
  function key(value) { return text(value).toLowerCase().replace(/[\s_\-()]/g, ''); }
  function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const match = text(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }
  function yes(value) {
    const normalized = key(value);
    return ['y', 'yes', 'true', '1', '예', '여', '적용', '대상', '행사'].includes(normalized);
  }
  function skuId(value) {
    const digits = text(value).replace(/\.0+$/, '').replace(/\D/g, '');
    return digits ? digits.padStart(13, '0') : '';
  }
  function location(cell) { return text(cell && cell.location); }
  function inRange(value, from, to) { return value >= from && value <= to; }
  function thermalClass(cell) {
    const declared = text(cell && cell.temp);
    if (declared === 'chilled' || declared === 'frozen') return declared;
    const zone = text(cell && cell.zone);
    if (/^F(?:0[1-9]|1[0-2])$/.test(zone) || ['E04', 'E05', 'E06', 'E07'].includes(zone)) return 'frozen';
    if (/^[A-D](?:0[1-9]|10)$/.test(zone) || zone === 'E03') return 'chilled';
    return 'unknown';
  }
  function levelOf(cell) {
    const suffix = location(cell).match(/(\d{6})$/);
    return suffix ? Number(suffix[1][3]) : null; 
  }
  function zoneNumber(zone) {
    const match = text(zone).match(/^[A-Z](\d{2})$/);
    return match ? Number(match[1]) : -1;
  }
  function field(row, aliases) {
    if (!row || typeof row !== 'object') return '';
    const headers = Object.keys(row);
    for (const alias of aliases) {
      const wanted = key(alias);
      const header = headers.find((candidate) => key(candidate) === wanted);
      if (header != null && text(row[header]) !== '') return row[header];
    }
    for (const alias of aliases) {
      const wanted = key(alias);
      const header = headers.find((candidate) => key(candidate).includes(wanted) || wanted.includes(key(candidate)));
      if (header != null && text(row[header]) !== '') return row[header];
    }
    return '';
  }
  function nameFromRow(row) {
    return text(field(row, ['물류상품명', '상품명', '품명', 'productname']));
  }
  function rawRows() {
    const boxes = typeof boxRows !== 'undefined' && Array.isArray(boxRows) ? boxRows : [];
    const cells = typeof cellRows !== 'undefined' && Array.isArray(cellRows) ? cellRows : [];
    return boxes.concat(cells);
  }

  function firstValue(rows, aliases) {
    for (const row of rows) {
      const value = field(row, aliases);
      if (text(value) !== '') return value;
    }
    return '';
  }
  function weightInGrams(value, headerHint) {
    const n = number(value);
    if (!n) return 0;
    const source = `${text(value)} ${text(headerHint)}`.toLowerCase();
    return source.includes('kg') || source.includes('킬로') ? n * 1000 : n;
  }
  function hasExplicitNoInbound(value) {
    const normalized = key(value);
    return normalized === '0' || ['없음', '무', 'no', 'n', '미정'].includes(normalized);
  }

  function categorize(profile) {
    const source = `${profile.name} ${profile.group}`.toLowerCase();
    const matches = (regexp) => regexp.test(source);
    const category = {
      egg: matches(/계란|식용란/),
      tofu: matches(/두부|연두부|순두부/),
      kimchi: matches(/김치/),
      condiment: matches(/된장|쌈장|고추장|양념장|소스|드레싱/),
      mealKit: matches(/밀키트|meal\s*kit/),
      iceCream: matches(/아이스크림|빙과|아이스바|아이스콘/),
      seafood: matches(/수산|생선|연어|고등어|갈치|참치|새우|오징어|문어|조개|전복|게|꽃게/),
      mincedMeat: matches(/다짐육|민찌|간고기|분쇄육/),
      poultry: matches(/계육|닭고기|닭다리|닭가슴|오리고기|오리육/),
      dairy: matches(/유제품|우유|치즈|요거트|요구르트|버터|생크림/),
      organic: matches(/유기농|친환경|올가닉|organic/),
      produce: matches(/과일|채소|야채|사과|배|감귤|포도|딸기|토마토|오이|호박|양파|감자|고구마|상추|버섯|브로콜리|파프리카|대파|마늘/),
      dry: matches(/건식|상온|dry/),
      processedMeat: matches(/양념육|훈제|햄|소시지|베이컨/),
      deli: matches(/델리|디저트|반찬|즉석/),
      wetBakery: matches(/베이커리|빵|케이크|페이스트리/),
      frozenMeat: matches(/냉동/) && matches(/소고기|돼지고기|닭|오리|육|갈비|목살|삼겹/),
      seasonal: matches(/시즌|명절|행사|대량/)
    };
    category.livestock = category.mincedMeat || category.poultry || matches(/축산|소고기|돼지고기|한우|돈육|우육|갈비|목살|삼겹|육류/);
    category.zeroToFive = category.seafood || category.mincedMeat || category.poultry || (category.dairy && /0\s*[~〜-]\s*5|0to5/.test(source));
    return category;
  }

  function buildProfiles(allData) {
    const rowsBySku = new Map();
    for (const row of rawRows()) {
      const sku = skuId(field(row, ['물류상품ID', 'SKU', '상품ID', 'productid']));
      if (!sku) continue;
      if (!rowsBySku.has(sku)) rowsBySku.set(sku, []);
      rowsBySku.get(sku).push(row);
    }
    const profiles = new Map();
    for (const cell of allData.assignedCells) {
      if (!cell.sku || profiles.has(cell.sku)) continue;
      const rows = rowsBySku.get(cell.sku) || [];
      const name = text(cell.productName || (allData.skuMeta.get(cell.sku) || {}).name || firstValue(rows, ['물류상품명', '상품명']));
      const group = text(firstValue(rows, OPTIONAL_FIELDS.group));
      const boxWeightRaw = firstValue(rows, OPTIONAL_FIELDS.boxWeight);
      const itemWeightRaw = firstValue(rows, OPTIONAL_FIELDS.itemWeight);
      const incomingRaw = firstValue(rows, OPTIONAL_FIELDS.incomingPlan);
      const profile = {
        sku: cell.sku,
        name,
        group,
        vendor: text(firstValue(rows, OPTIONAL_FIELDS.vendor)),
        boxWeightG: weightInGrams(boxWeightRaw, OPTIONAL_FIELDS.boxWeight.join(' ')),
        itemWeightG: weightInGrams(itemWeightRaw, OPTIONAL_FIELDS.itemWeight.join(' ')),
        incomingBoxes: number(firstValue(rows, OPTIONAL_FIELDS.incomingBoxes)),
        hasIncomingPlan: text(incomingRaw) !== '',
        noIncomingInTwoWeeks: text(incomingRaw) !== '' && hasExplicitNoInbound(incomingRaw),
        isNew: yes(firstValue(rows, OPTIONAL_FIELDS.isNew)),
        fragile: yes(firstValue(rows, OPTIONAL_FIELDS.fragile)),
        event: yes(firstValue(rows, OPTIONAL_FIELDS.event)),
        storage: text(firstValue(rows, OPTIONAL_FIELDS.storage))
      };
      profile.category = categorize(profile);
      const eggSize = `${name} ${group}`.match(/(?:^|\D)(10|15|20|30)\s*구/);
      profile.eggSize = eggSize ? Number(eggSize[1]) : null;
      profiles.set(cell.sku, profile);
    }
    return profiles;
  }

  function rackFamily(cell) {
    const zone = text(cell.zone);
    const raw = `${text(cell.rackType)} ${zone}`.toLowerCase();
    if (zone === 'A10') return 'gate';
    if (zone === 'C09' || zone === 'C10' || /^F\d{2}$/.test(zone)) return 'flow';
    if (inRange(location(cell), 'D02-010101', 'D02-020108') || inRange(location(cell), 'E04-070101', 'E04-080108')) return 'flat';
    if (/게이트|gate/.test(raw)) return 'gate';
    if (/플로우|flow/.test(raw)) return 'flow';
    if (/평대|flat/.test(raw)) return 'flat';
    if (/쇼케이스|다단|오픈|리치인|워크인|showcase/.test(raw)) return 'showcase';
    if (/선반|shelf/.test(raw)) return 'shelf';
    return 'other';
  }
  function hasFamily(cell, families) { return families.includes(rackFamily(cell)); }
  function isFZone(zone) { return /^F(?:0[1-9]|1[0-2])$/.test(zone); }
  function isChilledDedicated(zone) { return ['D01', 'D02'].includes(zone); }
  function isFrozenDedicated(zone) { return CONFIG.productZones.frozen.has(zone); }
  function isBackSpaceLimited(cell) {
    const loc = location(cell);
    return inRange(loc, 'A02-030101', 'A02-040505') ||
      inRange(loc, 'C05-050101', 'C05-060505') ||
      inRange(loc, 'D03-030101', 'D03-040505');
  }
  function isRemoteShelf(cell) {
    const loc = location(cell);
    return inRange(loc, 'B08-050101', 'B08-080505') ||
      inRange(loc, 'D08-090101', 'D08-120505') ||
      inRange(loc, 'D09-090101', 'D09-120505') ||
      inRange(loc, 'D10-090101', 'D10-120505');
  }
  function fNearWorkstation(cell) {
    const loc = location(cell), zone = text(cell.zone);
    if (/^F0[1-9]$/.test(zone)) return inRange(loc, `${zone}-030101`, `${zone}-040506`);
    if (/^F1[0-2]$/.test(zone)) return inRange(loc, `${zone}-020101`, `${zone}-030506`);
    return false;
  }
  function fTieOrder(cell) { return isFZone(cell.zone) ? zoneNumber(cell.zone) : 0; }

  function eggCellAllowed(cell, profile) {
    const loc = location(cell), level = levelOf(cell);
    if (inRange(loc, 'A08-010101', 'A08-080505')) {
      if (![2, 3, 4].includes(level)) return false; 
      const ranges = {
        10: ['A08-010101', 'A08-020505'],
        15: ['A08-030101', 'A08-040505'],
        20: ['A08-050101', 'A08-060505'],
        30: ['A08-070101', 'A08-080505']
      };
      const range = ranges[profile.eggSize];
      return !range || inRange(loc, range[0], range[1]);
    }
    return profile.event && inRange(loc, 'A09-010101', 'A09-010114');
  }
  function livestockCellAllowed(cell) {
    const loc = location(cell);
    return (inRange(loc, 'D01-010101', 'D06-060505') || inRange(loc, 'D07-030101', 'D07-060505'));
  }

  function categoryZoneAllowed(cell, profile) {
    const zone = text(cell.zone), c = profile.category;
    if (profile.temp === 'frozen' && !isFrozenDedicated(zone)) return { ok: false, reason: '냉동 상품은 E04~E07 또는 F존에만 배치' };
    if (profile.temp !== 'frozen' && isFrozenDedicated(zone)) return { ok: false, reason: '냉장/상온 상품은 냉동 전용 구역 제외' };
    if (c.egg) return eggCellAllowed(cell, profile) ? { ok: true } : { ok: false, reason: '계란은 A08 전용 구역의 2~4단(행사 시 A09 예외)' };
    if (c.zeroToFive && !isChilledDedicated(zone)) return { ok: false, reason: '0~5℃ 보관 필요 품목은 D01~D02' };
    if (c.tofu && zone !== 'C01') return { ok: false, reason: '두부류는 C01 전용' };
    if (c.kimchi && zone !== 'C09') return { ok: false, reason: '김치류는 C09 플로우랙 전용' };
    if (c.condiment && zone !== 'C08') return { ok: false, reason: '양념류는 C08 전용' };
    if (c.mealKit && zone !== 'E03') return { ok: false, reason: '밀키트류는 E03 전용' };
    if (c.iceCream && zone !== 'E07') return { ok: false, reason: '아이스크림류는 E07 전용' };
    if (c.dry && zone !== 'A01') return { ok: false, reason: '건식품은 A01 전용' };
    if (c.produce && !(CONFIG.productZones.produceA.has(zone) || CONFIG.productZones.produceB.has(zone) || zone === 'D10')) return { ok: false, reason: '과일·채소 허용 구역 외' };
    if ((c.dairy || c.organic) && !CONFIG.productZones.produceB.has(zone) && !c.zeroToFive) return { ok: false, reason: '유제품·친환경 상품은 B06~B10 우선 구역' };

    if (CONFIG.productZones.produceA.has(zone) && !c.produce) return { ok: false, reason: 'A02~A07은 과일·채소 전용' };
    if (CONFIG.productZones.produceB.has(zone) && !(c.produce || c.dairy || c.organic)) return { ok: false, reason: 'B06~B10은 채소·유제품·친환경 상품 전용' };
    if (['D07', 'D08', 'D09'].includes(zone) && !(c.processedMeat || c.deli || c.wetBakery)) return { ok: false, reason: 'D07~D09는 양념·훈제육, 델리·반찬, WET 베이커리 전용' };
    if (zone === 'D10' && !(c.produce || c.wetBakery)) return { ok: false, reason: 'D10은 지정 대량 출고 품목·WET 냉장 베이커리 전용' };

    if (zone === 'A01' && !c.dry) return { ok: false, reason: 'A01은 건식품 전용' };
    if (zone === 'A08') return { ok: false, reason: 'A08은 계란 전용' };
    if (zone === 'C01' && !c.tofu) return { ok: false, reason: 'C01은 두부류 전용' };
    if (zone === 'C08' && !c.condiment) return { ok: false, reason: 'C08은 양념류 전용' };
    if (zone === 'C09' && !c.kimchi) return { ok: false, reason: 'C09은 김치류 전용' };
    if (zone === 'E03' && !c.mealKit) return { ok: false, reason: 'E03은 밀키트류 전용' };
    if (zone === 'E07' && !c.iceCream) return { ok: false, reason: 'E07은 아이스크림류 전용' };
    if (isChilledDedicated(zone) && !c.zeroToFive) return { ok: false, reason: 'D01~D02는 0~5℃ 보관 필요 품목 전용' };
    return { ok: true };
  }

  function a10Eligible(profile, touch, stock) {
    return profile.category.seasonal || profile.event || touch >= 100 || stock > 100;
  }
  function physicalCellAllowed(cell, profile) {
    const loc = location(cell), zone = text(cell.zone), level = levelOf(cell), family = rackFamily(cell);
    if (zone === 'A10' && CONFIG.a10OddCellsOnly && /[02468]$/.test(loc)) return { ok: false, reason: 'A10은 끝자리가 홀수인 셀만 사용' };
    if (zone === 'A10' && !a10Eligible(profile, profile.touch, profile.stock)) return { ok: false, reason: 'A10은 대량 출고·대량 재고 품목 우선' };
    if (zone === 'C09' && family !== 'flow') return { ok: false, reason: 'C09는 플로우랙 전용' };
    if (zone === 'C10' && family !== 'flow') return { ok: false, reason: 'C10은 플로우랙 전용' };
    if (zone === 'C10' && !a10Eligible(profile, profile.touch, profile.stock)) return { ok: false, reason: 'C10은 상시 대량 출고 품목 우선' };
    if (isFZone(zone) && family !== 'flow') return { ok: false, reason: 'F존은 냉동 플로우랙 전용' };
    if (zone === 'D01' && family !== 'showcase') return { ok: false, reason: 'D01은 냉장쇼케이스 전용' };
    if (zone === 'D02' && !((inRange(loc, 'D02-010101', 'D02-020108') && family === 'flat') || (inRange(loc, 'D02-030101', 'D02-060507') && family === 'showcase'))) return { ok: false, reason: 'D02 랙 구성 범위와 불일치' };
    if (zone === 'E04' && !((inRange(loc, 'E04-010101', 'E04-060507') && family === 'showcase') || (inRange(loc, 'E04-070101', 'E04-080108') && family === 'flat'))) return { ok: false, reason: 'E04 랙 구성 범위와 불일치' };
    if (['E05', 'E06', 'E07'].includes(zone) && family !== 'showcase') return { ok: false, reason: `${zone}은 냉동쇼케이스 전용` };
    if (zone === 'B08' && family !== 'shelf') return { ok: false, reason: 'B08은 선반랙 전용' };
    if (zone === 'C08' && family !== 'shelf') return { ok: false, reason: 'C08은 선반랙 전용' };
    if (['D08', 'D09', 'D10'].includes(zone) && family !== 'shelf') return { ok: false, reason: `${zone}은 선반랙 전용` };

    if (profile.fragile && profile.category.frozenMeat && level !== 1) return { ok: false, reason: '낙손 우려 냉동 육류는 1단 배치' };
    if (!profile.fragile && profile.boxWeightG >= 7000 && profile.stock >= 50 && (family !== 'flow' || level !== 2)) return { ok: false, reason: '7kg 이상·재고 50PCS 이상은 플로우랙 2단' };
    if (!profile.fragile && profile.itemWeightG >= 500 && !(level === 1 || level === 2)) return { ok: false, reason: '500g 이상 낱개 상품은 1~2단' };
    if (profile.isNew && profile.incomingBoxes >= 10 && !hasFamily(cell, ['flow', 'flat'])) return { ok: false, reason: '신규·입고 10Box 이상은 플로우랙' };
    if (profile.isNew && profile.incomingBoxes > 0 && profile.incomingBoxes < 10 && !hasFamily(cell, ['shelf', 'showcase'])) return { ok: false, reason: '신규·입고 10Box 미만은 선반랙' };
    return { ok: true };
  }

  function productProfileFor(cell, profiles, allData) {
    const base = profiles.get(cell.sku) || { sku: cell.sku, name: text(cell.productName), group: '', category: categorize({ name: text(cell.productName), group: '' }) };
    return Object.assign({}, base, {
      touch: allData.skuToToteCount.get(cell.sku) || allData.skuToPcs.get(cell.sku) || 0,
      outboundPcs: allData.skuToPcs.get(cell.sku) || 0,
      stock: number(cell.stock),
      temp: thermalClass(cell)
    });
  }
  function violationReasons(cell, profile) {
    const a10MustMove = cell.zone === 'A10' && profile.touch < 100 && profile.stock <= 100 && profile.hasIncomingPlan && profile.noIncomingInTwoWeeks;
    if (a10MustMove) return ['A10 이동 기준 충족: 일 출고 100건 미만·재고 100PCS 이하·2주 입고 예정 없음'];
    const category = categoryZoneAllowed(cell, profile);
    if (!category.ok) return [category.reason];
    const physical = physicalCellAllowed(cell, profile);
    if (!physical.ok) return [physical.reason];
    return [];
  }

  function percentile(value, values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => b - a);
    const index = sorted.findIndex((x) => value >= x);
    return index < 0 ? 0 : 1 - (index / Math.max(1, sorted.length - 1));
  }
  function desiredFamilies(profile, statistics) {
    if (profile.fragile && profile.category.frozenMeat) return ['shelf', 'showcase', 'flow'];
    if (profile.boxWeightG >= 7000 && profile.stock >= 50) return ['flow', 'flat'];
    if (profile.isNew && profile.incomingBoxes >= 10) return ['flow', 'flat'];
    if (profile.isNew && profile.incomingBoxes > 0 && profile.incomingBoxes < 10) return ['shelf', 'showcase'];
    if (profile.category.kimchi || profile.temp === 'frozen' && /^F/.test(profile.sourceZone || '')) return ['flow', 'flat'];
    const demand = percentile(profile.touch, statistics.touches);
    const inventory = percentile(profile.stock, statistics.stocks);
    const priority = demand * 0.70 + inventory * 0.30;
    if (priority >= 0.75) return ['gate'];
    if (priority >= 0.40) return ['flow', 'flat'];
    return ['shelf', 'showcase'];
  }
  function familyScore(cell, preferred) {
    const family = rackFamily(cell);
    if (preferred.includes(family)) return 150;
    const preferredRank = Math.min(...preferred.map((x) => FAMILY_RANK[x] || 9));
    return Math.max(-80, 35 - Math.abs((FAMILY_RANK[family] || 9) - preferredRank) * 45);
  }

  function balanceStats(metrics, sourceWs, targetWs, touch) {
    const values = Object.entries(metrics || {}).filter(([ws]) => ws).map(([ws, metric]) => ({ ws, pcs: number(metric.pcs) }));
    if (!values.length || !sourceWs || !targetWs || sourceWs === targetWs) return { before: 0, after: 0, score: 0, compliant: true };
    const average = values.reduce((sum, item) => sum + item.pcs, 0) / values.length;
    if (!average) return { before: 0, after: 0, score: 0, compliant: true };
    const deviation = (adjust) => Math.max(...values.map((item) => Math.abs(((item.pcs + (adjust[item.ws] || 0)) - average) / average)));
    const before = deviation({});
    const after = deviation({ [sourceWs]: -touch, [targetWs]: touch });
    return { before, after, score: (before - after) * 200, compliant: after <= CONFIG.wsDeviation || after <= before };
  }
  function buildWsTouchMetrics(allData) {
    const result = {};
    const seen = new Set();
    for (const cell of allData.assignedCells) {
      if (!cell.ws || !cell.sku) continue;
      const pair = `${cell.ws}||${cell.sku}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      if (!result[cell.ws]) result[cell.ws] = { pcs: 0 };
      result[cell.ws].pcs += allData.skuToToteCount.get(cell.sku) || allData.skuToPcs.get(cell.sku) || 0;
    }
    return result;
  }
  function vendorClusterScore(cell, profile, assignedProfiles) {
    if (!profile.vendor) return 0;
    let count = 0;
    for (const item of assignedProfiles) if (item.zone === cell.zone && item.vendor === profile.vendor) count += 1;
    return Math.min(40, count * 8);
  }

  function targetScore(candidate, source, profile, context) {
    let score = familyScore(candidate, context.preferredFamilies);
    if (candidate.zone === source.zone) score += 30;
    else if (text(candidate.zone).slice(0, 1) === text(source.zone).slice(0, 1)) score += 10;
    if (candidate.ws && candidate.ws === source.ws) score += 20;
    if (isBackSpaceLimited(candidate) || isRemoteShelf(candidate)) score -= CONFIG.priorityPenalty;
    if (fNearWorkstation(candidate)) score += 55;
    if (isFZone(candidate.zone)) score += fTieOrder(candidate) * 2; 
    score += vendorClusterScore(candidate, profile, context.assignedProfiles);
    const balance = balanceStats(context.wsTouchMetrics, source.ws, candidate.ws, profile.touch);
    score += balance.score;

    // [소프트 룰 페널티 로직]
    const categoryCheck = categoryZoneAllowed(candidate, profile);
    if (!categoryCheck.ok) {
        score -= 200; // 전용 구역 등 제약 위반 시 강력한 감점 처리
    }
    const physicalCheck = physicalCellAllowed(candidate, profile);
    if (!physicalCheck.ok) {
        score -= 100; // 물리적 제약 (단수 등) 위반 시 감점 처리
    }

    return { score, balance };
  }

  // ✨ 하드 룰 (절대 조건) 필터링 영역 ✨
  function candidateEvaluation(candidate, source, profile) {
    // 1. 온도대(냉장/냉동) 불일치는 절대 타협 불가
    if (thermalClass(candidate) !== thermalClass(source)) return { ok: false, reason: '온도대 불일치' };
    // 2. 물리적 사용 금지 구역 배제
    if (CONFIG.disabledZones.has(text(candidate.zone))) return { ok: false, reason: 'E01~E02는 셀 할당 금지 구역' };
    // 3. 축산물 법정 허가 구역 외 배치 불가 (절대 타협 불가)
    if (profile.category.livestock && !livestockCellAllowed(candidate)) return { ok: false, reason: '축산물 법정 허가 구역 외' };
    
    // 나머지 조건은 targetScore 함수의 소프트 룰(감점)로 처리됨
    return { ok: true };
  }

  function recommendationReasons(source, target, profile, context, sourceViolations, scoreInfo) {
    const reasons = sourceViolations.slice();
    const preferred = context.preferredFamilies;
    if (preferred.includes(rackFamily(target))) reasons.push(`${rackFamily(target) === 'gate' ? '게이트랙' : rackFamily(target) === 'flow' || rackFamily(target) === 'flat' ? '플로우랙' : '선반랙'} 우선 배치`);
    if (profile.category.egg) reasons.push('계란 전용 A08 2~4단 및 규격별 구역');
    if (profile.category.zeroToFive) reasons.push('0~5℃ 보관 필요 품목 D01~D02');
    if (profile.category.livestock) reasons.push('축산물 법정 허가 구역');
    if (profile.vendor && vendorClusterScore(target, profile, context.assignedProfiles) > 0) reasons.push('동일 업체 인접 구역 군집화');
    if (scoreInfo.balance.score > 1) reasons.push('W/S 터치수 편차 완화');
    if (fNearWorkstation(target)) reasons.push('F존 W/S 인접 셀 우선');
    return Array.from(new Set(reasons)).join(' · ');
  }

  function recommend(allData) {
    if (!allData || !Array.isArray(allData.assignedCells) || !Array.isArray(allData.emptyCells)) return [];
    const profiles = buildProfiles(allData);
    const statistics = {
      touches: allData.assignedCells.map((cell) => allData.skuToToteCount.get(cell.sku) || allData.skuToPcs.get(cell.sku) || 0),
      stocks: allData.assignedCells.map((cell) => number(cell.stock))
    };
    const wsTouchMetrics = buildWsTouchMetrics(allData);
    const assignedProfiles = allData.assignedCells.map((cell) => {
      const profile = productProfileFor(cell, profiles, allData);
      return { zone: cell.zone, vendor: profile.vendor };
    });
    const recommendations = [];
    const seen = new Set();

    for (const source of allData.assignedCells) {
      if (!source.sku || seen.has(source.sku) || !['chilled', 'frozen'].includes(thermalClass(source))) continue;
      seen.add(source.sku);
      const profile = productProfileFor(source, profiles, allData);
      if (profile.touch <= 0 && profile.outboundPcs <= 0) continue;
      profile.sourceZone = source.zone;
      const preferredFamilies = desiredFamilies(profile, statistics);
      const sourceViolations = violationReasons(source, profile);
      const context = { allData, preferredFamilies, assignedProfiles, wsTouchMetrics };
      const sourceScore = targetScore(source, source, profile, context).score;
      const candidates = [];

      for (const candidate of allData.emptyCells) {
        const evaluation = candidateEvaluation(candidate, source, profile);
        if (!evaluation.ok) continue; // 하드 룰 통과 실패 시에만 필터링
        const scoreInfo = targetScore(candidate, source, profile, context);
        
        const articleFiveOverride = preferredFamilies.includes(rackFamily(candidate));
        if (!scoreInfo.balance.compliant && !articleFiveOverride && !sourceViolations.length) continue;
        candidates.push({ cell: candidate, scoreInfo });
      }
      candidates.sort((a, b) => b.scoreInfo.score - a.scoreInfo.score || location(a.cell).localeCompare(location(b.cell)));
      const best = candidates[0];
      const mandatory = sourceViolations.length > 0;
      const materiallyBetter = best && best.scoreInfo.score >= sourceScore + 25;
      if (!best && !mandatory) continue;
      if (!mandatory && !materiallyBetter) continue;

      const target = best && best.cell;
      recommendations.push({
        sku: source.sku,
        productName: profile.name || source.productName || '',
        pcs: profile.outboundPcs,
        toteCount: profile.touch,
        temp: thermalClass(source),
        currentCell: location(source),
        currentRack: text(source.rackType) || rackFamily(source),
        currentRank: FAMILY_RANK[rackFamily(source)] || 9,
        targetRack: target ? (text(target.rackType) || rackFamily(target)) : '적합 공셀 없음',
        targetCell: target ? location(target) : '-',
        reason: target
          ? recommendationReasons(source, target, profile, context, sourceViolations, best.scoreInfo)
          : sourceViolations.join(' · '),
        mandatory: mandatory ? 1 : 0,
        improvement: best ? best.scoreInfo.score - sourceScore : -999
      });
    }
    return recommendations
      .sort((a, b) => (b.mandatory - a.mandatory) || (b.improvement - a.improvement) || (b.toteCount - a.toteCount) || (b.pcs - a.pcs))
      .slice(0, CONFIG.maxRecommendations);
  }

  global.QPSRuleEngine = Object.freeze({ recommend, version: '1.1.0' });
  global.buildRecommendations = function (allData) { return recommend(allData); };
})(window);