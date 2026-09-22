/*
 * QPS Cell Allocation Rule Engine v2.35.0
 *
 * 개선 사항
 * 1) 중량/계란 규격/W-S 키 문자열 보간 오류 수정
 * 2) 추천 문구가 아닌 구조화된 priorityType·moveType으로 안전/퇴출 쿼터 판정
 * 3) 온도·랙 패밀리·존 단위 공셀 인덱스 사용
 * 4) 필수 제약은 점수 계산 전에 후보에서 제외
 * 5) 추천 불가 항목은 NO_TARGET 상태로 반환
 */
(function (global) {
  'use strict';
  const CONFIG = Object.freeze({
    wsDeviation: 0.10,
    maxRecommendations: 100,
    maxSourceCandidates: 1500,
    evictionQuotaRatio: 0.25,
    disabledZones: new Set(['E01', 'E02']),
    frozenZones: new Set(['E04', 'E05', 'E06', 'E07', 'F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12'])
  });
  const FAMILY_RANK = Object.freeze({ gate: 1, flow: 2, flat: 2, shelf: 3, showcase: 3, other: 9 });
  const DISTANCE_MAP = Object.freeze({
    A01:[['05'],['06'],['01','03'],['02','04']], A02:[['02'],['01'],['03','05'],['04','06']],
    A03:[['05','06'],['01','03'],['02','04']], A04:[['02','03'],['01'],['04','06'],['05','07']],
    A05:[['02','01'],['03','05'],['04','06']], A06:[['05'],['06'],['01','03'],['02','04']],
    A07:[['02'],['01','03'],['04','06'],['05','07']], A08:[['01','03','05','07'],['02','04','06','08']],
    A09:[['010106','010107','010108','010109','010110'],['010104','010105','010111','010112'],['010101','010102','010103','010113','010114']],
    A10:[['010105','010106','010107','010108','010109','010110'],['010101','010102','010103','010104']],
    B01:[['02'],['01'],['03','05'],['04','06']], B02:[['05'],['06'],['01','03'],['02','04']],
    B03:[['02'],['01'],['03','05'],['04','06']], B04:[['05'],['06'],['01','03'],['02','04']],
    B05:[['02'],['01'],['03','05'],['04','06']], B06:[['05'],['06'],['01','03'],['02','04']],
    B07:[['02'],['03'],['01'],['04','06'],['05','07']], B08:[['01','03'],['05','07'],['02','04'],['06','08']],
    B09:[['01','02'],['03','05'],['04','06']], B10:[['05'],['06'],['01','03'],['02','04']],
    C01:[['05'],['06'],['01','03'],['02','04']], C02:[['02'],['01'],['03','05'],['04','06']],
    C03:[['05','06'],['01','03'],['02','04']], C04:[['03'],['02'],['01'],['04','06'],['05','07']],
    C05:[['02'],['01'],['03','05'],['04','06']], C06:[['05'],['06'],['01','03'],['02','04']],
    C07:[['02'],['03'],['01'],['04','06'],['05','07']], C08:[['01','03'],['05','07'],['02','04'],['06','08']],
    C09:[['02','03'],['01','04']], C10:[['010105','010106','010107','010108','010109'],['010103','010104','010110','010111'],['010101','010102']],
    D01:[['03','05'],['04','06'],['01'],['02']], D02:[['01','03'],['05'],['02','04'],['06']],
    D03:[['02'],['01'],['03','05'],['04','06']], D04:[['05'],['06'],['01','03'],['02','04']],
    D05:[['02','01'],['03','05'],['04','06']], D06:[['05'],['06'],['01','03'],['02','04']],
    D07:[['01','02'],['03','05'],['04','06']], D08:[['01','03'],['05','07'],['02','04'],['06','08'],['09','11'],['10','12']],
    D09:[['01','03'],['05','07'],['02','04'],['06','08'],['09','11'],['10','12']], D10:[['05','07'],['01','03'],['06','08'],['02','04'],['09','11'],['10','12']],
    E01:[['01','02'],['03','05'],['04','06']], E02:[['05'],['06'],['01','03'],['02','04']],
    E03:[['01','03'],['02','04'],['05','07'],['06','08']], E04:[['07'],['01','03','05'],['02','04'],['06','08']],
    E05:[['01','03'],['02','04'],['06'],['05','07']], E06:[['01','03','05','07'],['02','04','06','08']],
    E07:[['01','03'],['05'],['02','04'],['06']], F01:[['04'],['03'],['02'],['01']],
    F02:[['04'],['03'],['02'],['01']], F03:[['04'],['03'],['02'],['01']], F04:[['04'],['03'],['02'],['01']],
    F05:[['04'],['03'],['02'],['01']], F06:[['04'],['03'],['02'],['01']], F07:[['03'],['02','04'],['01']],
    F08:[['03'],['02','04'],['01']], F09:[['03'],['02','04'],['01']], F10:[['02'],['01','03'],['04']],
    F11:[['02'],['01','03'],['04']], F12:[['02','03'],['01'],['04']]
  });
  const OPTIONAL_FIELDS = {
    vendor:['업체코드','업체명','공급업체','공급사','거래처','vendor','supplier'],
    group:['중분류','소분류','대분류','카테고리','상품분류','상품군','productgroup','category'],
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
  function categorize(profile) {
    const name = text(profile.name), group = text(profile.group);
    const quail = name.includes('메추리알') || group.includes('메추리알');
    const processedEgg = /연두부|장조림|소시지|소세지|과자|빵|볶음밥|말이|찜/.test(name) || ['두부/묵/콩가공품','반찬','햄/소시지','간편식','가공식품'].includes(group);
    const egg = (group === '계란' || /계란|식용란|유정란|왕란|특란|대란|신선란|구운란/.test(name)) && !processedEgg && !quail;
    const livestock = ['수입육','우육','돈육','계육','양념육'].includes(group);
    const processedChicken = /닭갈비|양념|볶음|훈제/.test(name);
    const seafoodOrPoultry = ['대중선어','구색선어','생선회','갑각류','패류','연체류'].includes(group) || (group === '계육' && !processedChicken);
    return { egg, quailEgg: quail, livestock, kimchi: group.includes('김치') || /김치|섞박지|석박지|깍두기|겉절이|총각무|동치미|무생채|파김치/.test(name), zeroToFive: seafoodOrPoultry || (['수입육','우육','돈육'].includes(group) && name.includes('다짐육')) };
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
    const data = new Map(), rows = [global.cellRows || [], global.boxRows || []];
    rows.forEach(sourceRows => {
      const headers = mapHeaders(sourceRows); if (!headers.sku) return;
      sourceRows.forEach(row => {
        const sku = skuId(row[headers.sku]); if (!sku) return;
        const old = data.get(sku) || {};
        data.set(sku, {
          name:text(row[headers.name]) || old.name, group:text(row[headers.group]) || old.group, vendor:text(row[headers.vendor]) || old.vendor,
          boxWeightRaw:text(row[headers.boxWeight]) || old.boxWeightRaw, itemWeightRaw:text(row[headers.itemWeight]) || old.itemWeightRaw,
          incomingPlan:text(row[headers.incomingPlan]) || old.incomingPlan, fragile:yes(row[headers.fragile]) || old.fragile, event:yes(row[headers.event]) || old.event
        });
      });
    });
    const profiles = new Map();
    allData.assignedCells.forEach(cell => {
      if (!cell.sku || profiles.has(cell.sku)) return;
      const raw = data.get(cell.sku) || {}, name = text(cell.productName || allData.skuMeta.get(cell.sku)?.name || raw.name);
      const profile = { sku:cell.sku, name, group:raw.group || '', vendor:raw.vendor || '', boxWeightG:weightInGrams(raw.boxWeightRaw, 'box'), itemWeightG:weightInGrams(raw.itemWeightRaw, 'ea') || extractWeightFromName(name), incomingPlan:raw.incomingPlan || '', fragile:!!raw.fragile, event:!!raw.event };
      profile.category = categorize(profile);
      const egg = `${name} ${profile.group}`.match(/(?:^|\D)(10|15|20|30)\s*구/);
      profile.eggSize = egg ? Number(egg[1]) : null;
      profiles.set(cell.sku, profile);
    });
    return profiles;
  }
  function makeNode(cell) {
    const loc = text(cell.location);
    return { cell, loc, zone:text(cell.zone), family:rackFamily(cell), temp:thermalClass(cell), level:levelOfLocation(loc), distRack:loc.slice(-6, -4), distSix:loc.slice(-6) };
  }
  function isFlowAllowed(p) {
    return (p.category.quailEgg && p.outboundPcs >= 30 && p.stock >= 60) || p.outboundPcs >= 30 && p.stock >= 50 || p.sourceFamily === 'gate' && p.outboundPcs >= 20 || p.sourceFamily === 'flow' && (p.outboundPcs > 15 || p.stock > 20) || /배추|양배추|무\(통\)|수박/.test(p.name) || p.boxWeightG >= 7000;
  }
  function livestockAllowed(pc) { return inRange(pc.loc, 'D01-010101', 'D06-060505') || inRange(pc.loc, 'D07-030101', 'D07-060505'); }
  function candidateAllowed(pc, source, p) {
    if (pc.temp !== source.temp) return { ok:false, reason:'온도대 불일치' };
    if (CONFIG.disabledZones.has(pc.zone)) return { ok:false, reason:'할당 금지 구역' };
    if (pc.family === 'gate' && p.outboundPcs < 100) return { ok:false, reason:'게이트랙 출고 기준 미달' };
    if (p.temp === 'frozen' && !CONFIG.frozenZones.has(pc.zone)) return { ok:false, reason:'냉동 전용 구역 필요' };
    if (p.temp !== 'frozen' && CONFIG.frozenZones.has(pc.zone)) return { ok:false, reason:'냉동 구역 배정 불가' };
    if (p.category.zeroToFive && p.temp !== 'frozen' && !['D01','D02'].includes(pc.zone)) return { ok:false, reason:'0~5℃ 전용 구역 필요' };
    if (p.category.livestock && p.temp !== 'frozen' && (!p.category.zeroToFive && ['D01','D02'].includes(pc.zone) || !livestockAllowed(pc))) return { ok:false, reason:'축산 허가 구역 조건 불충족' };
    if (p.category.kimchi && !['C08','C09'].includes(pc.zone)) return { ok:false, reason:'김치 전용 구역 필요' };
    if (p.category.kimchi && pc.zone === 'C09' && (p.outboundPcs < 40 || p.stock < 50)) return { ok:false, reason:'저빈도 김치 C09 진입 불가' };
    if (p.category.quailEgg && (p.outboundPcs >= 30 && p.stock >= 60 ? pc.family !== 'flow' : !inRange(pc.loc,'A07-040505','A07-070505'))) return { ok:false, reason:'메추리알 전용 위치 조건 불충족' };
    if (p.category.egg && !eggAllowed(pc,p)) return { ok:false, reason:'계란 전용 위치 조건 불충족' };
    if (!p.category.quailEgg && !p.category.kimchi && pc.family === 'flow' && p.temp !== 'frozen' && !isFlowAllowed(p)) return { ok:false, reason:'플로우랙 물량 기준 미달' };
    if (pc.family === 'flow' && p.itemWeightG > 1000 && ((p.temp !== 'frozen' && pc.level === 4) || (p.temp === 'frozen' && pc.level === 5))) return { ok:false, reason:'플로우랙 중량 단수 제한' };
    if ((p.boxWeightG > 7000 || p.itemWeightG > 3000) && pc.level > 2) return { ok:false, reason:'중량물 하단 보관 안전 수칙' };
    return { ok:true };
  }
  function eggAllowed(pc,p) {
    if ((p.outboundPcs >= 100 || p.stock >= 50) && ['A09','A10'].includes(pc.zone)) return true;
    if (pc.zone !== 'A08') return p.event && pc.zone === 'A09';
    if (![2,3,4].includes(pc.level)) return false;
    const ranges = {10:['A08-010101','A08-020505'],15:['A08-030101','A08-040505'],20:['A08-050101','A08-060505'],30:['A08-070101','A08-080505']};
    return !ranges[p.eggSize] || inRange(pc.loc, ...ranges[p.eggSize]);
  }
  function violations(source,p) {
    const mandatory = [], soft = [], c = p.category, z = source.zone;
    const noInbound = ['0','없음','무','no','n','미정'].includes(key(p.incomingPlan));
    if (z === 'A10' && p.touch < 100 && p.stock <= 100 && p.incomingPlan && noInbound) mandatory.push({type:'POLICY', text:'A10 이동 기준 충족: 출고·재고·입고계획 기준 미달'});
    const own = candidateAllowed(source, source, p); if (!own.ok) mandatory.push({type:own.reason.includes('중량') ? 'SAFETY' : 'COMPLIANCE', text:own.reason});
    if (c.kimchi && z === 'C09' && p.outboundPcs <= 15 && p.stock <= 20) mandatory.push({type:'EVICTION', text:'김치 물량 급감으로 C09 플로우랙 퇴출 필요'});
    if (c.kimchi && z === 'C08' && p.outboundPcs >= 60 && p.stock >= 80) mandatory.push({type:'FORWARD', text:'김치 고빈도 물량 급증으로 C09 전진 배치 필요'});
    if (source.family === 'gate' && p.outboundPcs <= 70 && p.stock <= 50) mandatory.push({type:'EVICTION', text:'게이트랙 기준 미달로 퇴출 필요'});
    if (!c.quailEgg && !c.kimchi && source.family === 'flow' && p.temp !== 'frozen' && p.stock > 0 && !isFlowAllowed(p)) mandatory.push({type:'EVICTION', text:'플로우랙 물량 기준 미달로 퇴출 필요'});
    if (source.family === 'shelf' && p.stock >= 60 && !c.egg && !c.quailEgg && !['A01','B08','C08','D08','D09','D10'].includes(z)) soft.push('현재고 60개 이상으로 선반랙 한계 초과');
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
    if (p.category.kimchi) return p.outboundPcs >= 40 && p.stock >= 50 ? ['flow'] : ['shelf'];
    if (p.category.quailEgg) return isFlowAllowed(p) ? ['flow'] : ['shelf'];
    if (p.boxWeightG >= 7000 && p.stock >= 50) return ['flow','flat'];
    if (p.temp === 'frozen' && /^F/.test(p.sourceZone)) return ['flow','flat'];
    if (p.sourceFamily === 'gate' && p.outboundPcs >= 20) return ['flow','flat'];
    return isFlowAllowed(p) ? ['flow','flat','shelf'] : ['shelf','showcase','flat'];
  }
  function familyScore(family, preferred) { if (preferred.includes(family)) return 150; return Math.max(-80,35-Math.abs((FAMILY_RANK[family]||9)-Math.min(...preferred.map(x=>FAMILY_RANK[x]||9)))*45); }
  function buildWsMap(allData) {
    const map=new Map(), seen=new Set();
    allData.assignedCells.forEach(cell=>{ if(!cell.ws||!cell.sku) return; const pair=`${cell.ws}||${cell.sku}`; if(seen.has(pair)) return; seen.add(pair); const row=map.get(cell.ws)||{pcs:0}; row.pcs+=allData.skuToToteCount.get(cell.sku)||allData.skuToPcs.get(cell.sku)||0; map.set(cell.ws,row); });
    return map;
  }
  function balanceScore(context, from, to, touch) {
    if (!from || !to || from===to || !context.average) return {score:0, compliant:true};
    const a=context.wsMap.get(from), b=context.wsMap.get(to); if(!a||!b) return {score:0, compliant:true};
    const before=Math.max(Math.abs((a.pcs-context.average)/context.average),Math.abs((b.pcs-context.average)/context.average));
    const after=Math.max(Math.abs((a.pcs-touch-context.average)/context.average),Math.abs((b.pcs+touch-context.average)/context.average));
    return {score:(before-after)*200, compliant:after<=CONFIG.wsDeviation || after<=before};
  }
  function score(pc,source,p,context,preferred) {
    const balance=balanceScore(context,source.cell.ws,pc.cell.ws,p.touch);
    let value=familyScore(pc.family,preferred)+distanceScore(pc,p)+zScore(pc,p)+balance.score;
    if(pc.zone===source.zone) value+=30; else if(pc.zone[0]===source.zone[0]) value+=10;
    if(pc.cell.ws && pc.cell.ws===source.cell.ws) value+=20;
    if(pc.zone.startsWith('F')) value+=Number(pc.zone.slice(1))*3;
    if(p.category.kimchi) value+=pc.zone==='C08'?100:pc.zone==='C09'?(p.outboundPcs>=80&&[2,3].includes(pc.level)?200:50):0;
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
  function reasons(source,target,p,violations,preferred,scoreInfo) {
    const list=violations.map(v=>v.text);
    if(preferred.includes(target.family)) list.push(`${target.family==='gate'?'게이트랙':target.family==='flow'||target.family==='flat'?'플로우랙':'선반랙'} 배치 권장`);
    if(p.category.egg) list.push('계란 전용 위치 조건 반영');
    if(p.category.kimchi) list.push('김치 전용(C08/C09) 구역 반영');
    if(p.category.zeroToFive && p.temp!=='frozen') list.push('0~5℃ 전용 보관 조건 반영');
    if(scoreInfo.balance.score>1) list.push('W/S SKU 부하 편차 완화');
    return [...new Set(list)].join(' · ');
  }
  function recommend(allData) {
    if(!allData || !Array.isArray(allData.assignedCells) || !Array.isArray(allData.emptyCells)) return [];
    const profiles=buildProfiles(allData), index=createEmptyIndex(allData.emptyCells), wsMap=buildWsMap(allData);
    let total=0; wsMap.forEach(v=>total+=v.pcs); const context={wsMap,average:wsMap.size?total/wsMap.size:0};
    const active=[], seen=new Set();
    allData.assignedCells.forEach(cell=>{
      if(!cell.sku||seen.has(cell.sku)) return; seen.add(cell.sku);
      const source=makeNode(cell), base=profiles.get(cell.sku)||{sku:cell.sku,name:text(cell.productName),group:'',category:categorize({name:text(cell.productName),group:''}),boxWeightG:0,itemWeightG:0};
      const p={...base,touch:allData.skuToToteCount.get(cell.sku)||allData.skuToPcs.get(cell.sku)||0,outboundPcs:allData.skuToPcs.get(cell.sku)||0,stock:number(cell.stock),temp:source.temp,sourceZone:source.zone,sourceFamily:source.family};
      if(p.stock===0&&p.outboundPcs===0) return;
      const v=violations(source,p), mandatory=v.mandatory.length>0;
      if(p.outboundPcs>0&&p.stock<=p.outboundPcs*.5&&!mandatory) return;
      const urgency= v.mandatory.some(x=>x.type==='SAFETY') ? 10000 : v.mandatory.some(x=>x.type==='FORWARD') ? 2000+p.outboundPcs : v.mandatory.some(x=>x.type==='EVICTION') ? 300+Math.max(0,(10-p.outboundPcs)*10+(20-p.stock)) : mandatory?100:0;
      active.push({source,p,v,mandatory,urgency,sort:p.touch+(mandatory?10000:0)});
    });
    active.sort((a,b)=>b.sort-a.sort);
    const used=new Set(), result=[];
    active.slice(0,CONFIG.maxSourceCandidates).forEach(item=>{
      const preferred=preferredFamilies(item.p), pool=candidatePool(index,item.p,preferred); let best=null;
      for(const pc of pool){ if(used.has(pc.loc)) continue; const allowed=candidateAllowed(pc,item.source,item.p); if(!allowed.ok) continue; const s=score(pc,item.source,item.p,context,preferred); if(!s.balance.compliant&&!item.mandatory) continue; if(!best||s.score>best.scoreInfo.score||(s.score===best.scoreInfo.score&&pc.loc<best.pc.loc)) best={pc,scoreInfo:s}; }
      const sourceScore=score(item.source,item.source,item.p,context,preferred).score;
      if(!best&&!item.mandatory) return; if(best&&!item.mandatory&&best.scoreInfo.score<sourceScore+25) return;
      if(best) used.add(best.pc.loc);
      const priorityType=item.v.mandatory.some(x=>x.type==='SAFETY')?'SAFETY':item.v.mandatory.some(x=>x.type==='COMPLIANCE')?'COMPLIANCE':item.v.mandatory.some(x=>x.type==='FORWARD')?'FORWARD':'OPTIMIZATION';
      const moveType=item.v.mandatory.some(x=>x.type==='EVICTION')?'EVICTION':best?'MOVE':'NO_TARGET';
      result.push({sku:item.source.cell.sku,productName:item.p.name||item.source.cell.productName||'',pcs:item.p.outboundPcs,stock:item.p.stock,toteCount:item.p.touch,temp:item.source.temp,currentCell:item.source.loc,currentRack:text(item.source.cell.rackType)||item.source.family,targetRack:best?(text(best.pc.cell.rackType)||best.pc.family):'공셀 확보 필요',targetCell:best?best.pc.loc:'-',targetWs:best?.pc.cell.ws||'',reason:best?reasons(item.source,best.pc,item.p,[...item.v.mandatory,...item.v.soft],preferred,best.scoreInfo):[...item.v.mandatory.map(x=>x.text),...item.v.soft].join(' · '),mandatory:item.mandatory?1:0,priorityType,moveType,urgency:item.urgency,improvement:best?best.scoreInfo.score-sourceScore:-999,status:best?'READY':'NO_TARGET'});
    });
    result.sort((a,b)=>b.urgency-a.urgency||b.mandatory-a.mandatory||b.improvement-a.improvement||b.toteCount-a.toteCount||b.pcs-a.pcs);
    const final=[], evictionLimit=Math.floor(CONFIG.maxRecommendations*CONFIG.evictionQuotaRatio), evictions={count:0};
    for(const r of result){
      if(r.priorityType==='SAFETY'||r.moveType!=='EVICTION'){ final.push(r); }
      else if(evictions.count<evictionLimit){ final.push(r); evictions.count++; }
      if(final.length>=CONFIG.maxRecommendations) break;
    }
    return final;
  }
  global.QPSRuleEngine=Object.freeze({recommend,version:'2.35.0'});
  global.buildRecommendations=recommend;
})(window);
