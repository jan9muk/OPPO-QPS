/*
 * QPS cell-allocation rule engine (V2.19.6 - Fix Smoked Meat & Zero-Stock Eviction Priority)
 *
 * This module deliberately contains the allocation rules, rather than UI code.
 * The host page must expose the existing `allData` shape used by index.html.
 */
(function (global) {  'use strict';

  const CONFIG = {
    wsDeviation: 0.10,
    maxRecommendations: 100, 
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

  const DISTANCE_MAP = {
    'A01': [['05'], ['06'], ['01','03'], ['02','04']],
    'A02': [['02'], ['01'], ['03','05'], ['04','06']],
    'A03': [['05','06'], ['01','03'], ['02','04']],
    'A04': [['02','03'], ['01'], ['04','06'], ['05','07']],
    'A05': [['02','01'], ['03','05'], ['04','06']],
    'A06': [['05'], ['06'], ['01','03'], ['02','04']],
    'A07': [['02'], ['01','03'], ['04','06'], ['05','07']],
    'A08': [['01','03','05','07'], ['02','04','06','08']],
    'A09': [['010106','010107','010108','010109','010110'], ['010104','010105','010111','010112'], ['010101','010102','010103','010113','010114']],
    'A10': [['010105','010106','010107','010108','010109','010110'], ['010101','010102','010103','010104']],
    'B01': [['02'], ['01'], ['03','05'], ['04','06']],
    'B02': [['05'], ['06'], ['01','03'], ['02','04']],
    'B03': [['02'], ['01'], ['03','05'], ['04','06']],
    'B04': [['05'], ['06'], ['01','03'], ['02','04']],
    'B05': [['02'], ['01'], ['03','05'], ['04','06']],
    'B06': [['05'], ['06'], ['01','03'], ['02','04']],
    'B07': [['02'], ['03'], ['01'], ['04','06'], ['05','07']],
    'B08': [['01','03'], ['05','07'], ['02','04'], ['06','08']],
    'B09': [['01','02'], ['03','05'], ['04','06']],
    'B10': [['05'], ['06'], ['01','03'], ['02','04']],
    'C01': [['05'], ['06'], ['01','03'], ['02','04']],
    'C02': [['02'], ['01'], ['03','05'], ['04','06']],
    'C03': [['05','06'], ['01','03'], ['02','04']],
    'C04': [['03'], ['02'], ['01'], ['04','06'], ['05','07']],
    'C05': [['02'], ['01'], ['03','05'], ['04','06']],
    'C06': [['05'], ['06'], ['01','03'], ['02','04']],
    'C07': [['02'], ['03'], ['01'], ['04','06'], ['05','07']],
    'C08': [['01','03'], ['05','07'], ['02','04'], ['06','08']],
    'C09': [['02','03'], ['01','04']],
    'C10': [['010105','010106','010107','010108','010109'], ['010103','010104','010110','010111'], ['010101','010102']],
    'D01': [['03','05'], ['04','06'], ['01'], ['02']],
    'D02': [['01','03'], ['05'], ['02','04'], ['06']],
    'D03': [['02'], ['01'], ['03','05'], ['04','06']],
    'D04': [['05'], ['06'], ['01','03'], ['02','04']],
    'D05': [['02','01'], ['03','05'], ['04','06']],
    'D06': [['05'], ['06'], ['01','03'], ['02','04']],
    'D07': [['01','02'], ['03','05'], ['04','06']],
    'D08': [['01','03'], ['05','07'], ['02','04'], ['06','08'], ['09','11'], ['10','12']],
    'D09': [['01','03'], ['05','07'], ['02','04'], ['06','08'], ['09','11'], ['10','12']],
    'D10': [['05','07'], ['01','03'], ['06','08'], ['02','04'], ['09','11'], ['10','12']],
    'E01': [['01','02'], ['03','05'], ['04','06']],
    'E02': [['05'], ['06'], ['01','03'], ['02','04']],
    'E03': [['01','03'], ['02','04'], ['05','07'], ['06','08']],
    'E04': [['07'], ['01','03','05'], ['02','04'], ['06','08']],
    'E05': [['01','03'], ['02','04'], ['06'], ['05','07']],
    'E06': [['01','03','05','07'], ['02','04','06','08']],
    'E07': [['01','03'], ['05'], ['02','04'], ['06']],
    'F01': [['04'], ['03'], ['02'], ['01']],
    'F02': [['04'], ['03'], ['02'], ['01']],
    'F03': [['04'], ['03'], ['02'], ['01']],
    'F04': [['04'], ['03'], ['02'], ['01']],
    'F05': [['04'], ['03'], ['02'], ['01']],
    'F06': [['04'], ['03'], ['02'], ['01']],
    'F07': [['03'], ['02','04'], ['01']],
    'F08': [['03'], ['02','04'], ['01']],
    'F09': [['03'], ['02','04'], ['01']],
    'F10': [['02'], ['01','03'], ['04']],
    'F11': [['02'], ['01','03'], ['04']],
    'F12': [['02','03'], ['01'], ['04']]
  };

  const OPTIONAL_FIELDS = {
    vendor: ['업체코드', '업체명', '공급업체', '공급사', '거래처', 'vendor', 'supplier'],
    group: ['중분류', '소분류', '대분류', '카테고리', '상품분류', '상품군', 'productgroup', 'category'],
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
    return 'chilled';
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
  
  function extractWeightFromName(name) {
    const match = text(name).match(/(\d+(?:\.\d+)?)\s*(kg|g|킬로|그램|l|ml)/i);
    if (!match) return 0;
    let val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 'kg' || unit === '킬로' || unit === 'l') val *= 1000;
    return val;
  }

  function hasExplicitNoInbound(value) {
    const normalized = key(value);
    return normalized === '0' || ['없음', '무', 'no', 'n', '미정'].includes(normalized);
  }

  function categorize(profile) {
    const group = text(profile.group); 
    const name = text(profile.name);   

    const isQuailEgg = name.includes('메추리알') || group.includes('메추리알');
    const isEggByName = /계란|식용란|유정란|왕란|특란|대란|신선란|구운란/.test(name);
    const isProcessedEgg = /연두부|장조림|소시지|소세지|과자|빵|볶음밥|말이|찜/.test(name) || ['두부/묵/콩가공품', '반찬', '햄/소시지', '간편식', '가공식품'].includes(group);
    
    const isProcessedChicken = /닭갈비|양념|볶음|훈제/.test(name);

    const category = {
      egg: (group === '계란' || isEggByName) && !isProcessedEgg && !isQuailEgg,
      quailEgg: isQuailEgg,
      iceCream: group === '아이스크림', 
      // [수정점] 가공육인 '훈제육'을 원육(축산물 허가구역) 로직에서 제외
      livestock: ['수입육', '우육', '돈육', '계육', '양념육'].includes(group)
    };
    
    const isSeafoodOrPoultry = ['대중선어', '구색선어', '생선회', '갑각류', '패류', '연체류'].includes(group) || (group === '계육' && !isProcessedChicken);
    const isMincedMeat = ['수입육', '우육', '돈육'].includes(group) && name.includes('다짐육');
    
    category.zeroToFive = isSeafoodOrPoultry || isMincedMeat;

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
        
        const existing = skuProfileData.get(sku) || {};
        skuProfileData.set(sku, {
          name: text(row[map.name]) || existing.name,
          group: text(row[map.group]) || existing.group,
          vendor: text(row[map.vendor]) || existing.vendor,
          boxWeightRaw: text(row[map.boxWeight]) || existing.boxWeightRaw,
          itemWeightRaw: text(row[map.itemWeight]) || existing.itemWeightRaw,
          incomingBoxes: number(row[map.incomingBoxes]) || existing.incomingBoxes,
          incomingPlan: text(row[map.incomingPlan]) || existing.incomingPlan,
          isNew: yes(row[map.isNew]) || existing.isNew,
          fragile: yes(row[map.fragile]) || existing.fragile,
          event: yes(row[map.event]) || existing.event,
          storage: text(row[map.storage]) || existing.storage
        });
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
        itemWeightG: weightInGrams(rawP.itemWeightRaw, 'ea') || extractWeightFromName(name),
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

  function getDistanceScore(cell) {
    const loc = location(cell);
    if (loc.length < 10) return -99;
    
    const zone = loc.substring(0, 3);
    const rack = loc.slice(-6, -4);
    const level = loc.slice(-4, -2);
    const bay = loc.slice(-2);
    
    const zoneMap = DISTANCE_MAP[zone];
    if (!zoneMap) return -99;

    const sixDigitMatch = rack + level + bay;
    for (let i = 0; i < zoneMap.length; i++) {
      if (zoneMap[i].includes(sixDigitMatch)) {
        return -(i * 15);
      }
    }

    for (let i = 0; i < zoneMap.length; i++) {
      if (zoneMap[i].includes(rack)) {
        return -(i * 15);
      }
    }

    return -99;
  }

  function getZAxisScore(cell) {
    const family = rackFamily(cell);
    const temp = thermalClass(cell);
    const loc = location(cell); 
    if (loc.length < 10) return 0;

    const rack = loc.slice(-6, -4);
    const level = Number(loc.slice(-4, -2));
    
    let score = 0;

    if (family === 'flow') {
      if (temp === 'chilled' && (level === 2 || level === 3)) score += 30;
      else if (temp === 'frozen' && (level >= 2 && level <= 4)) score += 30;
    } 
    else if (family === 'shelf') {
      if (level >= 2 && level <= 4) score += 30;
    } 
    else if (family === 'showcase') {
      if (temp === 'chilled' && (level >= 1 && level <= 4)) {
        score += 30;
      } else if (temp === 'frozen') {
        if (level === 1 || level === 3 || level === 5) score += 30;
      }
    } 
    else if (family === 'flat') {
      if (temp === 'frozen' && rack === '07' && level === 1) score += 30;
    }

    return score;
  }

  function eggCellAllowed(cell, profile) {
    const loc = location(cell), level = levelOf(cell), zone = text(cell.zone);
    
    if ((profile.outboundPcs >= 100 || profile.stock >= 50) && (zone === 'A09' || zone === 'A10')) {
        return true;
    }

    if (zone === 'A08') {
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
    return profile.event && zone === 'A09';
  }
  
  function livestockCellAllowed(cell) {
    const loc = location(cell);
    return (inRange(loc, 'D01-010101', 'D06-060505') || inRange(loc, 'D07-030101', 'D07-060505'));
  }

  function categoryZoneAllowed(cell, profile) {
    const zone = text(cell.zone), c = profile.category;
    if (profile.temp === 'frozen' && !isFrozenDedicated(zone)) return { ok: false, reason: '냉동 상품은 냉동 전용 구역에 배치 필요' };
    if (profile.temp !== 'frozen' && isFrozenDedicated(zone)) return { ok: false, reason: '냉장/상온 상품은 냉동 전용 구역 제외' };
    
    if (c.egg && !eggCellAllowed(cell, profile)) return { ok: false, reason: '계란은 A08 전용 구역(행사/대량 시 A09, A10) 및 규격별 단수 제한' };
    
    if (c.quailEgg) {
        const highVolume = profile.outboundPcs >= 30 && profile.stock >= 60;
        const lowVolume = profile.outboundPcs <= 10 && profile.stock <= 20;
        if (highVolume && rackFamily(cell) !== 'flow') return { ok: false, reason: '메추리알 대량(출고 30 & 재고 60 이상)은 플로우랙 전용' };
        if (lowVolume && !inRange(location(cell), 'A07-040505', 'A07-070505')) return { ok: false, reason: '메추리알 소량(출고 10 & 재고 20 이하)은 A07 선반랙 전용' };
    }

    if (c.iceCream && zone !== 'E07') return { ok: false, reason: '아이스크림류는 E07 전용 구역 배치 필요' };
    if (!c.iceCream && zone === 'E07') return { ok: false, reason: 'E07은 아이스크림 전용 구역이므로 일반 냉동 상품 불가' };

    if (c.zeroToFive && profile.temp !== 'frozen' && !isChilledDedicated(zone)) return { ok: false, reason: '0~5℃ 보관 필요 품목은 D01~D02 권장' };
    
    if (c.livestock && profile.temp !== 'frozen' && !livestockCellAllowed(cell)) return { ok: false, reason: '냉장 축산물 법정 허가 구역 외' };

    return { ok: true };
  }

  function a10Eligible(profile, touch, stock) {
    return profile.category.seasonal || profile.event || touch >= 100 || stock > 100;
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
    const mandatory = [];
    const soft = [];
    
    const a10MustMove = cell.zone === 'A10' && profile.touch < 100 && profile.stock <= 100 && profile.hasIncomingPlan && profile.noIncomingInTwoWeeks;
    if (a10MustMove) mandatory.push('A10 이동 기준 충족: 일 출고 100건 미만·재고 100PCS 이하·2주 입고 예정 없음');
    
    const category = categoryZoneAllowed(cell, profile);
    if (!category.ok) mandatory.push(category.reason);

    if (rackFamily(cell) === 'gate' && profile.outboundPcs < 100 && profile.stock < 50) {
      mandatory.push('게이트랙 부적합 (일 출고 100 미만 & 현 재고 50 미만)');
    }

    const deadStock = profile.outboundPcs <= 10 && profile.stock <= 20;
    if (!profile.category.quailEgg && rackFamily(cell) === 'flow' && profile.temp !== 'frozen' && deadStock) {
      mandatory.push('플로우랙 부적합 (출고 10 이하 & 재고 20 이하로 퇴출 필요)');
    }

    const loc = location(cell);
    const level = loc.length >= 10 ? Number(loc.slice(-4, -2)) : 0;
    
    if (rackFamily(cell) === 'flow' && profile.itemWeightG > 1000) {
      if (profile.temp !== 'frozen' && level === 4) {
        mandatory.push('플로우랙 4단 중량(1kg) 초과');
      } else if (profile.temp === 'frozen' && level === 5) {
        mandatory.push('냉동 플로우랙 5단 중량(1kg) 초과');
      }
    }

    if ((profile.boxWeightG > 7000 || profile.itemWeightG > 3000) && level > 2) {
      mandatory.push('중량물(박스 7kg 또는 단품 3kg 초과) 안전 수칙: 1~2단 하단 보관 필수');
    }

    const zone = text(cell.zone);
    if (rackFamily(cell) === 'shelf' && profile.stock >= 50 && !profile.category.egg && !profile.category.quailEgg && !['A01', 'B08', 'C08', 'D08', 'D09', 'D10'].includes(zone)) {
      soft.push('현재고 50개 이상으로 선반랙 부적합');
    }

    return { mandatory, soft };
  }

  function percentile(value, values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => b - a);
    const index = sorted.findIndex((x) => value >= x);
    return index < 0 ? 0 : 1 - (index / Math.max(1, sorted.length - 1));
  }

  function desiredFamilies(profile, statistics) {
    const flowAllowed = profile.outboundPcs >= 30 && profile.stock >= 60;

    if (profile.category.quailEgg) {
        return flowAllowed ? ['flow'] : ['shelf'];
    }

    if (profile.fragile && profile.category.frozenMeat) return ['shelf', 'showcase', 'flow'];
    if (profile.boxWeightG >= 7000 && profile.stock >= 50) return ['flow', 'flat'];
    if (profile.category.kimchi || (profile.temp === 'frozen' && /^F/.test(profile.sourceZone || ''))) return ['flow', 'flat'];
    
    const flowNotAllowed = !profile.category.quailEgg && profile.temp !== 'frozen' && !flowAllowed;

    const demand = percentile(profile.touch, statistics.touches);
    const inventory = percentile(profile.stock, statistics.stocks);
    const priority = demand * 0.70 + inventory * 0.30;
    
    if (priority >= 0.75 && profile.outboundPcs >= 100) return ['gate'];
    if (priority >= 0.40) {
        return flowNotAllowed ? ['shelf', 'showcase', 'flat'] : ['flow', 'flat'];
    }
    return flowNotAllowed ? ['shelf', 'showcase'] : ['shelf', 'showcase', 'flow'];
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
    
    score += vendorClusterScore(candidate, profile, context.vendorCounts);
    
    score += getDistanceScore(candidate);
    score += getZAxisScore(candidate);

    const balance = balanceStats(context, source.ws, candidate.ws, profile.touch);
    score += balance.score;

    const zone = text(candidate.zone);
    if (rackFamily(candidate) === 'shelf' && profile.stock >= 50 && !profile.category.egg && !['A01', 'B08', 'C08', 'D08', 'D09', 'D10'].includes(zone)) {
      score -= 50;
    }

    const categoryCheck = categoryZoneAllowed(candidate, profile);
    if (!categoryCheck.ok) {
        score -= 200; 
    }

    return { score, balance };
  }

  function candidateEvaluation(candidate, source, profile) {
    if (thermalClass(candidate) !== thermalClass(source)) return { ok: false, reason: '온도대 불일치' };
    if (CONFIG.disabledZones.has(text(candidate.zone))) return { ok: false, reason: 'E01~E02는 셀 할당 금지 구역' };
    
    if (profile.category.livestock && profile.temp !== 'frozen' && !livestockCellAllowed(candidate)) return { ok: false, reason: '냉장 축산물 법정 허가 구역 외' };
    
    if (rackFamily(candidate) === 'gate' && profile.outboundPcs < 100) return { ok: false, reason: '게이트랙은 출고 100pcs 이상 전용' };

    const c = profile.category;
    if (c.iceCream && text(candidate.zone) !== 'E07') return { ok: false, reason: '아이스크림은 E07 전용' };
    if (!c.iceCream && text(candidate.zone) === 'E07') return { ok: false, reason: 'E07은 아이스크림 전용 셀' };

    if (c.egg && !eggCellAllowed(candidate, profile)) return { ok: false, reason: '계란은 A08 전용 구역(행사 시 A09, A10) 및 규격별 단수 제한' };

    const flowAllowedForTarget = profile.outboundPcs >= 30 && profile.stock >= 60;

    if (c.quailEgg) {
        if (flowAllowedForTarget) {
            if (rackFamily(candidate) !== 'flow') return { ok: false, reason: '메추리알 대량(출고 30 & 재고 60 이상)은 플로우랙 전용' };
        } else {
            if (!inRange(location(candidate), 'A07-040505', 'A07-070505')) return { ok: false, reason: '메추리알 소량은 A07 선반랙 전용' };
        }
    }

    if (!c.quailEgg && rackFamily(candidate) === 'flow' && profile.temp !== 'frozen' && !flowAllowedForTarget) {
      return { ok: false, reason: '플로우랙 진입 불가 (출고 30 미만 또는 재고 60 미만)' };
    }

    const loc = location(candidate);
    const level = loc.length >= 10 ? Number(loc.slice(-4, -2)) : 0;

    if (rackFamily(candidate) === 'flow' && profile.itemWeightG > 1000) {
      if (profile.temp !== 'frozen' && level === 4) {
        return { ok: false, reason: '플로우랙 4단 중량(1kg) 초과 상품' };
      } else if (profile.temp === 'frozen' && level === 5) {
        return { ok: false, reason: '냉동 플로우랙 5단 중량(1kg) 초과 상품' };
      }
    }

    if ((profile.boxWeightG > 7000 || profile.itemWeightG > 3000) && level > 2) {
      return { ok: false, reason: '중량물(박스 7kg 또는 단품 3kg 초과) 안전 수칙: 1~2단 하단 보관 필수' };
    }

    return { ok: true };
  }

  function recommendationReasons(source, target, profile, context, sourceViolations, scoreInfo) {
    const reasons = sourceViolations.slice();
    const preferred = context.preferredFamilies;
    
    if (preferred.includes(rackFamily(target))) {
        let rName = rackFamily(target) === 'gate' ? '게이트랙' : rackFamily(target) === 'flow' || rackFamily(target) === 'flat' ? '플로우랙' : '선반랙';
        reasons.push(`${rName} 배치 권장`);
    }
    
    if (profile.category.iceCream) reasons.push('E07 아이스크림 전용 구역 유지');
    if (profile.category.egg) reasons.push('계란 전용 A08 2~4단 및 규격별 구역');
    if (profile.category.zeroToFive && profile.temp !== 'frozen') reasons.push('0~5℃ 보관 권장 품목');
    if (profile.vendor && vendorClusterScore(target, profile, context.vendorCounts) > 0) reasons.push('동일 업체 인접 구역 군집화');
    if (scoreInfo.balance.score > 1) reasons.push('W/S SKU수 편차 완화');
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
      
      // [수정점] 공갈 재고(출고0, 재고0)라도 프리미엄 랙/잘못된 온도대 점유 중이면 방을 빼도록 필터링 완화
      if (profile.touch <= 0 && profile.outboundPcs <= 0) {
          const fam = rackFamily(source);
          const needsEviction = ['gate', 'flow', 'flat'].includes(fam) ||
                                (profile.temp !== 'frozen' && isFrozenDedicated(source.zone)) ||
                                (profile.temp === 'frozen' && !isFrozenDedicated(source.zone));
          if (!needsEviction) continue; // 일반 선반랙의 악성 재고는 무시
      }

      profile.sourceZone = source.zone;
      activeSources.push({ source, profile });
    }

    activeSources.sort((a, b) => b.profile.touch - a.profile.touch);
    const sourcesToProcess = activeSources.slice(0, 1500);
    
    const usedTargetCells = new Set();

    for (const { source, profile } of sourcesToProcess) {
      const preferredFamilies = desiredFamilies(profile, statistics);
      
      const violationsObj = violationReasons(source, profile);
      const sourceViolations = [...violationsObj.mandatory, ...violationsObj.soft];
      const isMandatoryMove = violationsObj.mandatory.length > 0;
      
      const context = { allData, preferredFamilies, vendorCounts, wsMetricsArray, wsCount, wsAverage };
      const sourceScore = targetScore(source, source, profile, context).score;
      const candidates = [];

      for (const candidate of allData.emptyCells) {
        if (usedTargetCells.has(location(candidate))) continue;

        const evaluation = candidateEvaluation(candidate, source, profile);
        if (!evaluation.ok) continue; 
        
        const scoreInfo = targetScore(candidate, source, profile, context);
        const articleFiveOverride = preferredFamilies.includes(rackFamily(candidate));
        
        if (!scoreInfo.balance.compliant && !articleFiveOverride && !sourceViolations.length) continue;
        
        candidates.push({ cell: candidate, scoreInfo });
      }
      
      candidates.sort((a, b) => b.scoreInfo.score - a.scoreInfo.score || location(a.cell).localeCompare(location(b.cell)));
      const best = candidates[0];
      const materiallyBetter = best && best.scoreInfo.score >= sourceScore + 25;
      
      if (!best && !isMandatoryMove && !sourceViolations.length) continue;
      if (!isMandatoryMove && !materiallyBetter) continue;

      const target = best && best.cell;
      
      if (target) {
          usedTargetCells.add(location(target));
      }

      let targetCellFmt = '-';
      if (target) {
        targetCellFmt = location(target);
      }
      
      const zScore = getZAxisScore(source);
      let rankNum = FAMILY_RANK[rackFamily(source)] || 9;
      if (zScore > 0) rankNum = Math.max(1, rankNum - 1); 

      // [수정점] 퇴출 우선순위 가중치 (출고/재고가 0에 가까울수록 시급도 대폭 상승)
      let urgency = 0;
      if (isMandatoryMove) {
          if (sourceViolations.some(v => v.includes('퇴출 필요'))) {
              urgency = Math.max(0, (10 - profile.outboundPcs) * 10 + (20 - profile.stock));
          } else if (sourceViolations.some(v => v.includes('게이트랙 부적합'))) {
              urgency = Math.max(0, (100 - profile.outboundPcs) + (50 - profile.stock));
          }
      }

      recommendations.push({
        sku: source.sku,
        productName: profile.name || source.productName || '',
        pcs: profile.outboundPcs,
        stock: profile.stock, 
        toteCount: profile.touch,
        temp: thermalClass(source),
        currentCell: location(source),
        currentRack: text(source.rackType) || rackFamily(source),
        currentRank: rankNum,
        targetRack: target ? (text(target.rackType) || rackFamily(source)) : '적합 공셀 없음',
        targetCell: targetCellFmt,
        reason: target
          ? recommendationReasons(source, target, profile, context, sourceViolations, best.scoreInfo)
          : sourceViolations.join(' · '),
        mandatory: isMandatoryMove ? 1 : 0,
        urgency: urgency,
        improvement: best ? best.scoreInfo.score - sourceScore : -999
      });
    }
    
    // [수정점] 정렬 시 urgency(시급도)를 점수 개선도보다 우선적으로 판단
    return recommendations
      .sort((a, b) => 
        (b.mandatory - a.mandatory) || 
        (b.urgency - a.urgency) || 
        (b.improvement - a.improvement) || 
        (b.toteCount - a.toteCount) || 
        (b.pcs - a.pcs)
      )
      .slice(0, CONFIG.maxRecommendations);
  }

  global.QPSRuleEngine = Object.freeze({ recommend, version: '2.19.6-smoked-meat-and-urgency' });
  global.buildRecommendations = function (allData) { return recommend(allData); };
})(window);
