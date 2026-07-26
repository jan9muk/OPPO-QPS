/*
 * QPS cell-allocation rule engine (V2.1 - 0~5C Refinement & B06-B10 Soft Rule Fix)
 *
 * This module deliberately contains the allocation rules, rather than UI code.
 * The host page must expose the existing `allData` shape used by index.html.
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

  const FAMILY_RANK = { gate: 1, flow: 2, flat: 2, shelf: 3, showcase: 3, other: 9 };

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
    const source = `${profile.name} ${profile.group} ${profile.storage}`.toLowerCase();
    const matches = (regexp) => regexp.test(source);
    
    const category = {
      egg: matches(/계란|식용란/),
      tofu: matches(/두부|연두부|순두부/),
      kimchi: matches(/김치/),
      condiment: matches(/된장|쌈장|고추장|양념장|소스|드레싱/),
      mealKit: matches(/밀키트|meal\s*kit/),
      iceCream: matches(/아이스|빙과|빙수|파인트|샤베트|셔벗|젤라또|하드/),
      seafood: matches(/수산|생선|연어|고등어|갈치|참치|새우|오징어|문어|조개|전복|게|꽃게/),
      mincedMeat: matches(/다짐육|민찌|간고기|분쇄육/),
      poultry: matches(/계육|닭고기|닭다리|닭가슴|오리고기|오리육|토종닭|치킨스테이크|안심|정육/), // 닭고기(계육) 정규식 정밀화
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
    
    // ✨ 실무 기준 0~5℃ 보관 대상 재정의: 계육, 수산물, 다짐육, 혹은 '0~5℃ 이하'가 명시된 버터
    const isButterZeroToFive = matches(/버터/) && matches(/0\s*~\s*5|0~5도|0~5℃|이하\s*보관/);
    category.zeroToFive = category.poultry || category.seafood || category.mincedMeat || isButterZeroToFive;

    return category;
  }

  function mapHeaders(rows) {
    if (!rows || !rows.length) return {};
    const map = {};
    const headers = Object.keys(rows[0]);
    const allFields = {
      sku: ['물류상품ID', 'SKU', '상품ID', 'productid'],
      name: ['물류상품명', '상품명', '품명', 'productname'],
      vendor: OPTIONAL_FIELDS.vendor,
      group: OPTIONAL_FIELDS.group,
      boxWeight: OPTIONAL_FIELDS.boxWeight,
      itemWeight: OPTIONAL_FIELDS.itemWeight,
      incomingBoxes: OPTIONAL_FIELDS.incomingBoxes,
      incomingPlan: OPTIONAL_FIELDS.incomingPlan,
      isNew: OPTIONAL_FIELDS.isNew,
      fragile: OPTIONAL_FIELDS.fragile,
      event: OPTIONAL_FIELDS.event,
      storage: OPTIONAL_FIELDS.storage
    };

    for (const [keyName, aliases] of Object.entries(allFields)) {
      let matched = null;
      for (const alias of aliases) {
        const wanted = key(alias);
        matched = headers.find(h => key(h) === wanted);
        if (matched) break;
      }
      if (!matched) {
        for (const alias of aliases) {
          const wanted = key(alias);
          matched = headers.find(h => key(h).includes(wanted) || wanted.includes(key(h)));
          if (matched) break;
        }
      }
      map[keyName] = matched;
    }
    return map;
  }

  function buildProfiles(allData) {
    const bRows = typeof boxRows !== 'undefined' && Array.isArray(boxRows) ? boxRows : [];
    const cRows = typeof cellRows !== 'undefined' && Array.isArray(cellRows) ? cellRows : [];
    
    const boxHeaderMap = mapHeaders(bRows);
    const cellHeaderMap = mapHeaders(cRows);
    
    const skuProfileData = new Map();

    function extractMetadata(rows, map) {
      if (!map.sku) return;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sku = skuId(row[map.sku]);
        if (!sku) continue;
        
        if (!skuProfileData.has(sku)) {
          skuProfileData.set(sku, {
            name: text(row[map.name]),
            group: text(row[map.group]),
            vendor: text(row[map.vendor]),
            boxWeightRaw: text(row[map.boxWeight]),
            itemWeightRaw: text(row[map.itemWeight]),
            incomingBoxes: number(row[map.incomingBoxes]),
            incomingPlan: text(row[map.incomingPlan]),
            isNew: yes(row[map.isNew]),
            fragile: yes(row[map.fragile]),
            event: yes(row[map.event]),
            storage: text(row[map.storage])
          });
        }
      }
    }

    extractMetadata(cRows, cellHeaderMap); 
    extractMetadata(bRows, boxHeaderMap); 

    const profiles = new Map();
    for (const cell of allData.assignedCells) {
      if (!cell.sku || profiles.has(cell.sku)) continue;
      
      const rawP = skuProfileData.get(cell.sku) || {};
      const name = text(cell.productName || (allData.skuMeta.get(cell.sku) || {}).name || rawP.name);
      const group = rawP.group || '';
      
      const profile = {
        sku: cell.sku,
        name,
        group,
        vendor: rawP.vendor || '',
        boxWeightG: weightInGrams(rawP.boxWeightRaw, 'box'),
        itemWeightG: weightInGrams(rawP.itemWeightRaw, 'ea'),
        incomingBoxes: rawP.incomingBoxes || 0,
        hasIncomingPlan: rawP.incomingPlan !== undefined && rawP.incomingPlan !== '',
        noIncomingInTwoWeeks: rawP.incomingPlan !== undefined && rawP.incomingPlan !== '' && hasExplicitNoInbound(rawP.incomingPlan),
        isNew: rawP.isNew || false,
        fragile: rawP.fragile || false,
        event: rawP.event || false,
        storage: rawP.storage || ''
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
    return inRange(loc, 'A02-030101', 'A02-040505') || inRange(loc, 'C05-050101', 'C05-060505') || inRange(loc, 'D03-030101', 'D03-040505');
  }
  function isRemoteShelf(cell) {
    const loc = location(cell);
    return inRange(loc, 'B08-050101', 'B08-080505') || inRange(loc, 'D08-090101', 'D08-120505') || inRange(loc, 'D09-090101', 'D09-120505') || inRange(loc, 'D10-090101', 'D10-120505');
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
    
    // ✨ 0~5도 보관 필요 품목은 D01~D02 전용 유지[cite: 2]
    if (c.zeroToFive && !isChilledDedicated(zone)) return { ok: false, reason: '0~5℃ 보관 필요 품목(계육·수산·다짐육 등)은 D01~D02 전용' };
    
    if (c.tofu && zone !== 'C01') return { ok: false, reason: '두부류는 C01 전용' };
    if (c.kimchi && zone !== 'C09') return { ok: false, reason: '김치류는 C09 플로우랙 전용' };
    if (c.condiment && zone !== 'C08') return { ok: false, reason: '양념류는 C08 전용' };
    if (c.mealKit && zone !== 'E03') return { ok: false, reason: '밀키트류는 E03 전용' };
    if (c.iceCream && zone !== 'E07') return { ok: false, reason: '아이스크림류는 E07 전용' };
    if (c.dry && zone !== 'A01') return { ok: false, reason: '건식품은 A01 전용' };
    if (c.produce && !(CONFIG.productZones.produceA.has(zone) || CONFIG.productZones.produceB.has(zone) || zone === 'D10')) return { ok: false, reason: '과일·채소 허용 구역 외' };
    
    // ✨ B06~B10 구역은 전용 셀이 아니므로 하드 룰 규제(ok: false)를 제거하고 프리하게 풀어줍니다[cite: 2].

    if (CONFIG.productZones.produceA.has(zone) && !c.produce) return { ok: false, reason: 'A02~A07은 과일·채소 전용' };
    // B06~B10 전용 제한 해제 (신규 상품 우선 검토 구역으로만 활용)
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
    
    if (rackFamily(cell) === 'gate' && profile.outboundPcs < 100) return ['게이트랙 부적합 (일 출고 100pcs 미만)'];

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
    
    if (priority >= 0.75 && profile.outboundPcs >= 100) return ['gate'];
    if (priority >= 0.40) return ['flow', 'flat'];
    return ['shelf', 'showcase'];
  }

  function familyScore(cell, preferred) {
    const family = rackFamily(cell);
    if (preferred.includes(family)) return 150;
    const preferredRank = Math.min(...preferred.map((x) => FAMILY_RANK[x] || 9));
    return Math.max(-80, 35 - Math.abs((FAMILY_RANK[family] || 9) - preferredRank) * 45);
  }

  function balanceStats(context, sourceWs, targetWs, touch) {
    if (!context.wsCount || !sourceWs || !targetWs || sourceWs === targetWs) return { before: 0, after: 0, score: 0, compliant: true };
    let maxBefore = 0, maxAfter = 0;
    for (let i = 0; i < context.wsCount; i++) {
      const item = context.wsMetricsArray[i];
      let pcsAfter = item.pcs;
      if (item.ws === sourceWs) pcsAfter -= touch;
      else if (item.ws === targetWs) pcsAfter += touch;

      const devBefore = Math.abs((item.pcs - context.wsAverage) / context.wsAverage);
      const devAfter = Math.abs((pcsAfter - context.wsAverage) / context.wsAverage);
      if (devBefore > maxBefore) maxBefore = devBefore;
      if (devAfter > maxAfter) maxAfter = devAfter;
    }
    return { before: maxBefore, after: maxAfter, score: (maxBefore - maxAfter) * 200, compliant: maxAfter <= CONFIG.wsDeviation || maxAfter <= maxBefore };
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

  function vendorClusterScore(candidate, profile, vendorCounts) {
    if (!profile.vendor || !vendorCounts[profile.vendor]) return 0;
    const count = vendorCounts[profile.vendor][candidate.zone] || 0;
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
    
    // ✨ B06~B10 구역은 신규 상품 등의 우선 검토 구역으로 소프트 가점 부여[cite: 2]
    if (CONFIG.productZones.produceB.has(candidate.zone) && profile.isNew) {
      score += 40; 
    }

    score += vendorClusterScore(candidate, profile, context.vendorCounts);
    
    const balance = balanceStats(context, source.ws, candidate.ws, profile.touch);
    score += balance.score;

    const categoryCheck = categoryZoneAllowed(candidate, profile);
    if (!categoryCheck.ok) {
        score -= 200; 
    }
    const physicalCheck = physicalCellAllowed(candidate, profile);
    if (!physicalCheck.ok) {
        score -= 100; 
    }

    return { score, balance };
  }

  function candidateEvaluation(candidate, source, profile) {
    if (thermalClass(candidate) !== thermalClass(source)) return { ok: false, reason: '온도대 불일치' };
    if (CONFIG.disabledZones.has(text(candidate.zone))) return { ok: false, reason: 'E01~E02는 셀 할당 금지 구역' };
    if (profile.category.livestock && !livestockCellAllowed(candidate)) return { ok: false, reason: '축산물 법정 허가 구역 외' };
    
    if (rackFamily(candidate) === 'gate' && profile.outboundPcs < 100) return { ok: false, reason: '게이트랙은 출고 100pcs 이상 전용' };

    return { ok: true };
  }

  function recommendationReasons(source, target, profile, context, sourceViolations, scoreInfo) {
    const reasons = sourceViolations.slice();
    const preferred = context.preferredFamilies;
    if (preferred.includes(rackFamily(target))) reasons.push(`${rackFamily(target) === 'gate' ? '게이트랙' : rackFamily(target) === 'flow' || rackFamily(target) === 'flat' ? '플로우랙' : '선반랙'} 우선 배치`);
    if (profile.category.egg) reasons.push('계란 전용 A08 2~4단 및 규격별 구역');
    if (profile.category.zeroToFive) reasons.push('0~5℃ 보관 필요 품목(계육·수산·다짐육)');
    if (profile.category.livestock) reasons.push('축산물 법정 허가 구역');
    if (profile.vendor && vendorClusterScore(target, profile, context.vendorCounts) > 0) reasons.push('동일 업체 인접 구역 군집화');
    if (scoreInfo.balance.score > 1) reasons.push('W/S 터치수 편차 완화');
    if (fNearWorkstation(target)) reasons.push('F존 W/S 인접 셀 우선');
    return Array.from(new Set(reasons)).join(' · ');
  }

  function getRepresentativeEmptyCells(emptyCells) {
    const reps = [];
    const sigSet = new Set();
    for (let i = 0; i < emptyCells.length; i++) {
      const cell = emptyCells[i];
      const family = rackFamily(cell);
      const level = levelOf(cell);
      const isBack = isBackSpaceLimited(cell);
      const isRemote = isRemoteShelf(cell);
      const fNear = fNearWorkstation(cell);
      const fTie = fTieOrder(cell);
      
      const sig = `${cell.zone}|${cell.ws || 'none'}|${family}|${level}|${isBack}|${isRemote}|${fNear}|${fTie}`;
      
      if (!sigSet.has(sig)) {
        sigSet.add(sig);
        reps.push(cell); 
      }
    }
    return reps;
  }

  function recommend(allData) {
    if (!allData || !Array.isArray(allData.assignedCells) || !Array.isArray(allData.emptyCells)) return [];
    
    const representativeEmptyCells = getRepresentativeEmptyCells(allData.emptyCells);
    const profiles = buildProfiles(allData);
    const statistics = {
      touches: allData.assignedCells.map((cell) => allData.skuToToteCount.get(cell.sku) || allData.skuToPcs.get(cell.sku) || 0),
      stocks: allData.assignedCells.map((cell) => number(cell.stock))
    };
    
    const wsTouchMetrics = buildWsTouchMetrics(allData);
    const wsMetricsArray = Object.entries(wsTouchMetrics || {}).filter(([ws]) => ws).map(([ws, m]) => ({ ws, pcs: number(m.pcs) }));
    let wsTotalPcs = 0;
    for (let i = 0; i < wsMetricsArray.length; i++) wsTotalPcs += wsMetricsArray[i].pcs;
    const wsCount = wsMetricsArray.length;
    const wsAverage = wsCount ? wsTotalPcs / wsCount : 0;

    const vendorCounts = {};
    for (const cell of allData.assignedCells) {
      const profile = productProfileFor(cell, profiles, allData);
      if (profile.vendor) {
        if (!vendorCounts[profile.vendor]) vendorCounts[profile.vendor] = {};
        vendorCounts[profile.vendor][cell.zone] = (vendorCounts[profile.vendor][cell.zone] || 0) + 1;
      }
    }

    const recommendations = [];
    const seen = new Set();
    const activeSources = [];

    for (const source of allData.assignedCells) {
      if (!source.sku || seen.has(source.sku) || !['chilled', 'frozen'].includes(thermalClass(source))) continue;
      seen.add(source.sku);
      const profile = productProfileFor(source, profiles, allData);
      if (profile.touch <= 0 && profile.outboundPcs <= 0) continue;
      profile.sourceZone = source.zone;
      activeSources.push({ source, profile });
    }

    activeSources.sort((a, b) => b.profile.touch - a.profile.touch);
    const sourcesToProcess = activeSources.slice(0, 1500);

    for (const { source, profile } of sourcesToProcess) {
      const preferredFamilies = desiredFamilies(profile, statistics);
      const sourceViolations = violationReasons(source, profile);
      
      const context = { allData, preferredFamilies, vendorCounts, wsMetricsArray, wsCount, wsAverage };
      const sourceScore = targetScore(source, source, profile, context).score;
      const candidates = [];

      for (const candidate of representativeEmptyCells) {
        const evaluation = candidateEvaluation(candidate, source, profile);
        if (!evaluation.ok) continue; 
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

  global.QPSRuleEngine = Object.freeze({ recommend, version: '1.4.3-poultry-fix' });
  global.buildRecommendations = function (allData) { return recommend(allData); };
})(window);
