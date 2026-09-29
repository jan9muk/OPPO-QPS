/*
 * 배포 점검 — 배포 루틴(CLAUDE.md)에서 사람이 빠뜨리기 쉬운 항목을 자동 확인한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { ROOT, loadApp } = require('./lib');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('index.html의 스크립트 버전 쿼리가 각 파일 버전과 일치 (브라우저 캐시 무효화)', () => {
  const { core, fast } = loadApp();
  assert.ok(html.includes(`qpsCore.js?v=${core.version}`), `index.html의 qpsCore.js?v= 를 ${core.version}로 맞추세요`);
  assert.ok(html.includes(`xlsxFastReader.js?v=${fast.version}`), `index.html의 xlsxFastReader.js?v= 를 ${fast.version}로 맞추세요`);
});

test('대시보드 버전 표기가 제목과 헤더에서 일치', () => {
  const versions = [...html.matchAll(/QPS Dashboard v(\d+\.\d+\.\d+)/g)].map(m => m[1]);
  assert.ok(versions.length >= 2, '제목/헤더에서 버전 표기를 찾지 못함');
  assert.equal(new Set(versions).size, 1, `버전 표기가 서로 다름: ${versions.join(', ')}`);
});

test('규칙 엔진 버전이 파일 상단 변경 이력의 최신 버전과 일치', () => {
  const { engine } = loadApp();
  const src = fs.readFileSync(path.join(ROOT, 'ruleEngine.js'), 'utf8');
  const header = src.match(/Rule Engine v(\d+\.\d+\.\d+)/);
  assert.ok(header, '파일 상단 버전 표기를 찾지 못함');
  assert.equal(engine.version, header[1], `QPSRuleEngine.version(${engine.version})과 상단 표기(${header[1]})가 다름`);
});
