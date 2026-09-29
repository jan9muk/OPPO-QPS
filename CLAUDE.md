# OPPO-QPS 대시보드

물류센터 QPS 피킹 진척도·작업대 부하 대시보드와 셀 이동 추천 자동화. 빌드 도구 없이 GitHub Pages(main 브랜치)로 배포되는 정적 페이지다.

## 파일 구조
| 파일 | 역할 |
|---|---|
| `index.html` | 화면(DOM)·업로드·캐시(IndexedDB)·렌더링 |
| `qpsCore.js` | 화면과 무관한 데이터 처리: 엑셀 시트 선택·컬럼 정리, 검증, 집계(`buildAllData`) |
| `xlsxFastReader.js` | 고속 XLSX 리더(스트리밍, 필요한 컬럼만). 실패 시 index.html이 SheetJS로 대체 |
| `ruleEngine.js` | 셀 이동 추천 규칙 엔진. 구역·쿼터 설정은 상단 `CONFIG` |
| `box_latest.xlsx` / `cell_latest.xlsx` | **시연용 목업 데이터**(캐시 없는 외부 사용자용). 실데이터 아님 |
| `tests/` | 회귀 테스트(`node tests/run.js`, 외부 의존성 없음) |

## 배포 루틴 (중요 수정 배포 시, 하루 1회 기준)
1. 작업 브랜치에서 수정한다. main에 직접 푸시하지 않는다.
2. `node tests/run.js` 실행 → 전부 통과해야 한다.
   - 규칙을 추가·변경했다면 `tests/cases.test.js`에 사례를 추가·수정한다.
   - 전체 결과 비교가 실패하면 출력된 차이 요약을 읽는다.
     - 의도한 변화: `node tests/run.js --update`로 기준값 갱신, 커밋 메시지와 PR에 사유와 차이 요약을 남긴다.
     - 의도하지 않은 변화: 버그다. 코드를 고친다.
   - 목업 xlsx를 교체했다면 기준값도 갱신한다.
3. 버전을 올린다(`tests/release.test.js`가 불일치를 잡는다).
   - `index.html` 제목·헤더의 `QPS Dashboard vX.Y.Z`
   - `ruleEngine.js` 상단 변경 이력 + `version`
   - 수정한 스크립트(`qpsCore.js`, `xlsxFastReader.js`)의 파일 내 version과 `index.html`의 `?v=`
4. PR을 만든다(체크리스트 템플릿 자동 적용) → "회귀 테스트" 체크가 초록색인지 확인 → merge.
5. Actions의 "pages build and deployment" 완료 후 사이트에서 버전 표기를 확인한다(옛 화면이면 Ctrl+F5).

## 현장 운영 기준 (ruleEngine.js에 반영됨, tests/cases.test.js로 고정)
- 수산물·생닭·다짐육: D01~D02(5℃ 챔버)만. 일반 축산: D03~D06 우선, 공셀 없을 때만 D01~D02.
- 김치: C08/C09 전용(비김치는 퇴출 추천). D06은 임시 보관 → '이전 계획'.
- 게이트랙: A09 계란 전용, A10 비계란. 출고 100 이상 계란은 A09 우선(A09가 차면 A08 구수 구역).
- 계란은 플로우랙 진입 대상이 아니다.
- 메추리알: A07-060101~070505 전용 구역. 플로우랙 진입 기준(출고 30·재고 60 이상) 충족 시 플로우랙.
- 평대(D02-01~02, E04-07~08): 플로우랙 선호 SKU의 차선. 플로우랙 적정 공셀이 없을 때만 배정.
- 상품 분류는 셀 파일의 중/소분류 우선, 없을 때만 상품명으로 판정.
