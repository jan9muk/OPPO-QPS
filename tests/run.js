#!/usr/bin/env node
/*
 * QPS 회귀 테스트 실행기 (외부 의존성 없음, Node 20+)
 *
 *   node tests/run.js            전체 테스트 실행
 *   node tests/run.js --update   전체 결과 기준값(tests/baseline/snapshot.json) 갱신
 *   node tests/run.js cases      파일명에 'cases'가 들어간 테스트만 실행
 */
'use strict';
process.env.TZ = 'Asia/Seoul'; // 날짜 문자열 해석을 현장(한국) 시간 기준으로 고정

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
global.UPDATE_BASELINE = args.includes('--update');
const filter = args.find(a => !a.startsWith('--'));

const tests = [];
global.test = (name, fn) => tests.push({ name, fn, file: global.__currentFile });

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js') && (!filter || f.includes(filter))).sort();
for (const f of files) { global.__currentFile = f; require(path.join(dir, f)); }

(async () => {
  let pass = 0, fail = 0;
  const started = Date.now();
  for (const t of tests) {
    const t0 = Date.now();
    try {
      await t.fn();
      pass++;
      console.log(`  ✓ ${t.name} (${Date.now() - t0}ms)`);
    } catch (e) {
      fail++;
      console.log(`  ✗ ${t.name}\n      ${String(e && e.message || e).split('\n').join('\n      ')}`);
    }
  }
  console.log(`\n통과 ${pass} / 실패 ${fail} · ${((Date.now() - started) / 1000).toFixed(1)}초`);
  process.exit(fail ? 1 : 0);
})();
