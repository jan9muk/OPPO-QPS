#!/usr/bin/env node
/*
 * 화면 점검(UI smoke test) — 실제 브라우저(Chromium)로 index.html을 열어 목업 데이터로 화면이 정상인지 확인한다.
 * `node tests/run.js`(엔진·집계 회귀 테스트)는 index.html의 화면 코드를 실행하지 않으므로, 화면 코드의 오타·런타임 오류는
 * 이 점검이 잡는다. GitHub Actions(회귀 테스트 워크플로의 '화면 점검' 작업)에서 PR마다 실행된다.
 *
 * 실행: Playwright가 필요하다(저장소 의존성에는 넣지 않음).
 *   npm i --no-save --no-package-lock playwright@1.56.1 && npx playwright install chromium
 *   node tests/ui/smoke.js
 * 외부 CDN(SheetJS·html2canvas)에 접속할 수 없는 환경에서는 QPS_UI_OFFLINE=1 로 실행한다
 * (SheetJS는 빈 객체로 대체 — 고속 리더를 쓰므로 무관, html2canvas는 HTML2CANVAS_PATH 파일이 있으면 그것을 사용).
 */
'use strict';
process.env.TZ = 'Asia/Seoul';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const OFFLINE = process.env.QPS_UI_OFFLINE === '1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.xlsx': 'application/octet-stream'
};

function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${String((e && e.message) || e).split('\n')[0]}`);
  }
}
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    // 클립보드 권한 거부는 headless 환경의 정상 동작(캡처 버튼 점검에서 의도적으로 발생)
    if (m.type() === 'error' && !/Clipboard|Write permission/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  if (OFFLINE) {
    const h2c =
      process.env.HTML2CANVAS_PATH && fs.existsSync(process.env.HTML2CANVAS_PATH)
        ? fs.readFileSync(process.env.HTML2CANVAS_PATH, 'utf8')
        : '';
    await page.route(/cdnjs\.cloudflare\.com/, r =>
      r.fulfill({
        contentType: 'application/javascript',
        body: /xlsx/.test(r.request().url()) ? 'window.XLSX={utils:{}};' : h2c
      })
    );
  }

  try {
    await check('목업 데이터로 대시보드가 열리고 규칙 엔진이 로드됨', async () => {
      await page.goto(`${base}/index.html`);
      await page.waitForFunction(
        () => window.qpsAllData && window.QPSRuleEngine && document.querySelector('#recommendBody tr'),
        null,
        { timeout: 60000 }
      );
      ok((await page.title()).startsWith('QPS Dashboard v'), '제목에 버전 표기가 없음');
      ok(/연산 완료/.test(await page.textContent('#status')), `상태 문구 이상: ${await page.textContent('#status')}`);
    });

    await check('현장 요약·부하·보충·진척도·추천 영역이 모두 그려짐', async () => {
      const count = sel => page.$$eval(sel, n => n.length);
      ok((await page.textContent('#insightArea')).trim().length > 0, '현장 확인 포인트가 비어 있음');
      ok((await count('#machineSummary .machine-card')) === 3, '호기 요약 카드가 3개가 아님');
      ok((await count('#loadZonesArea .spark-row:not(.blank)')) >= 40, '작업대 부하 막대가 부족함');
      ok((await count('#wsTopArea .card')) === 1, '우선 보충 필요 SKU 섹션이 없음');
      ok((await page.textContent('#progressZonesArea')).trim().length > 0, '피킹 진척도가 비어 있음');
      ok((await count('#recommendBody tr.cat-row')) >= 3, '셀 이동 추천 그룹이 3개 미만');
      ok(!/규칙 엔진.*(실패|오류)/.test(await page.textContent('#recommendBody')), '추천표에 엔진 오류 표시');
    });

    await check('부하 모니터링은 전체 스케일이 기본이고, 체크하면 호기별 스케일', async () => {
      const box = '#loadZonesArea input[type=checkbox]';
      ok(
        (await page.textContent('#loadZonesArea label')).includes('호기별 스케일'),
        "체크박스 이름이 '호기별 스케일'이 아님"
      );
      ok(!(await page.isChecked(box)), '기본이 호기별 스케일로 되어 있음');
      await page.click(box);
      ok(await page.evaluate(() => window.qpsLoadScaleMode === 'machine'), '체크 후 호기별 스케일로 바뀌지 않음');
      await page.click(box);
      ok(await page.evaluate(() => window.qpsLoadScaleMode === 'all'), '체크 해제 후 전체 스케일로 돌아오지 않음');
    });

    await check('피킹 진행 중 데이터: 우선 보충 필요 SKU 표시와 모바일 캡처 이미지 생성', async () => {
      // 목업은 진척률 100%라 잔여가 없으므로, 토트 1/3을 미완료로 바꿔 다시 계산
      await page.evaluate(async () => {
        boxRows.forEach((r, i) => {
          if (i % 3 === 0) for (const k of Object.keys(r)) if (k.includes('WMS배송진행상태')) r[k] = '피킹지시';
        });
        await tryBuild();
      });
      ok((await page.$$eval('#wsTopArea .ws-top-row .ws-top-line', n => n.length)) > 0, '보충 SKU 행이 없음');
      const size = await page.evaluate(async () => {
        if (typeof html2canvas !== 'function') return null;
        const node = buildMobileRefillNode(window.qpsAllData);
        document.body.appendChild(node);
        try {
          const c = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });
          return { w: c.width, h: c.height, nodeW: node.offsetWidth, cards: node.querySelectorAll('.mr-card').length };
        } finally {
          node.remove();
        }
      });
      if (size === null && OFFLINE) return console.log('      (오프라인: html2canvas 없음 — 이미지 생성 점검 생략)');
      ok(size, 'html2canvas 로드 실패');
      ok(
        size.nodeW <= 480 && size.w === size.nodeW * 2 && size.h > 200,
        `모바일 캡처 크기 이상: ${size.w}x${size.h} (노드 폭 ${size.nodeW}px)`
      );
      ok(size.cards >= 1 && size.cards <= 10, `모바일 캡처 작업대 카드 수 이상: ${size.cards}`);
    });

    await check('캡처 버튼이 예외 없이 동작하고 임시 노드를 남기지 않음', async () => {
      await page.click('#captureRefillBtn');
      await page.waitForFunction(
        () =>
          !document.querySelector('#captureRefillBtn').disabled ||
          /완료|실패/.test(document.querySelector('#captureRefillBtn').textContent),
        null,
        { timeout: 30000 }
      );
      ok((await page.$$eval('.mobile-refill', n => n.length)) === 0, '모바일 캡처용 임시 노드가 남음');
    });

    await check('파일 업로드: 두 파일 함께 → 정상, 이후 박스 파일만 → 저장된 셀할당으로 정상', async () => {
      await page.evaluate(() => (document.querySelector('#status').textContent = ''));
      await page.setInputFiles('#multiFile', [path.join(ROOT, 'box_latest.xlsx'), path.join(ROOT, 'cell_latest.xlsx')]);
      await page.waitForFunction(
        () => /연산 완료|실패|오류/.test(document.querySelector('#status').textContent),
        null,
        { timeout: 60000 }
      );
      ok(
        /연산 완료/.test(await page.textContent('#status')),
        `두 파일 업로드 실패: ${await page.textContent('#status')}`
      );
      await page.evaluate(() => (document.querySelector('#status').textContent = ''));
      await page.setInputFiles('#multiFile', [path.join(ROOT, 'box_latest.xlsx')]);
      await page.waitForFunction(
        () => /연산 완료|실패|오류/.test(document.querySelector('#status').textContent),
        null,
        { timeout: 60000 }
      );
      ok(
        /연산 완료/.test(await page.textContent('#status')),
        `박스 파일만 업로드 실패: ${await page.textContent('#status')}`
      );
    });

    await check('페이지 오류 0건', async () => {
      ok(!errors.length, errors.slice(0, 3).join(' | '));
    });
  } finally {
    await browser.close();
    server.close();
  }
  const fail = results.filter(x => !x).length;
  console.log(`\n화면 점검 통과 ${results.length - fail} / 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
