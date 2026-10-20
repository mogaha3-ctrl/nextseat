# CLAUDE.md · AI 작업 방식

이 저장소는 교육용 「공용 장비 대여 현황판」입니다. 요구사항은 PRD.md, 이 파일은 작업 규칙입니다.

## 작업 방식

1. 한 번에 전체를 만들지 않는다. PRD의 Phase 단위로 **계획 → 사용자 "승인" → 구현 → 확인** 순서로 진행한다.
2. 계획에는 바꿀 파일·함수, 구현할 F 번호, 확인할 T 번호를 적는다.
3. Phase 1 작업 중에는 Phase 2 기능을 미리 넣지 않는다.
4. 사용자가 "고치지 마"라고 한 파일(supabase_setup.sql, config.js 등)은 수정하지 않고 필요한 변경을 제안만 한다.
5. 수정 후에는 test.html을 열어 모두 PASS인지, 다시 확인할 기능이 무엇인지 알려 준다.
6. 설명은 비전공자가 따라 할 수 있게 쉬운 말로, 원인 2~3줄 먼저.

## 반드시 지킬 것

- 허용·거부의 최종 판정은 DB(RLS·제약·트리거)가 한다. 화면 검사는 안내용이다.
- 대여일·빌린 사람·등록자·장비 상태·반납 시각은 화면에서 보내지 않는다. DB가 정한다.
- 수정·삭제·반납 결과가 0건이면 성공으로 처리하지 말고 "본인 것만 처리할 수 있습니다"를 보여 준다.
- DB 오류는 `explainError()`로 바꿔 화면에 이유를 보여 준다.
- 사용자 입력을 화면에 넣을 때는 `escapeHtml()`을 쓴다.
- 표 이름은 `eqp_` 로 시작한다. 수업의 `edu_`, 부록의 `inq_` 표를 지우거나 바꾸는 SQL을 만들지 않는다.

## 금지

- Secret / service_role 키, DB 비밀번호를 코드·config.js·커밋에 넣지 않는다. 브라우저에는 Publishable(anon) 키만.
- 문제 해결을 위해 RLS를 끄거나 Secret 키로 우회하지 않는다.
- 실제 개인정보·내부 자료·실설비 데이터를 넣지 않는다. 이름·연락처 칸을 만들지 않는다.
- `.env` 파일을 커밋하지 않는다. 커밋 전에 바뀐 파일을 보여 준다.

## 이름 표

| 구분 | 이름 | 설명 |
|---|---|---|
| 표 | `eqp_items`, `eqp_loans` | 장비, 대여 |
| DB 함수 | `eqp_today()` | 한국 날짜 오늘 |
| 트리거 함수 | `eqp_items_before_write`, `eqp_loans_before_insert`, `eqp_loans_before_update`, `eqp_loans_after_write` | R-03·R-07, R-02·R-04·R-05, R-06, R-07 |
| 설정 상수 | `SUPABASE_URL`, `SUPABASE_KEY` | config.js |
| 클라이언트 | `db` | `supabase.createClient(...)` 결과, 연결 정보가 없으면 `createDemoClient()` (demo.js) |
| 상태 | `state` | session, items, myLoans, filters, selectedItemId, editingItemId |
| logic.js | `todayKST`, `addDays`, `dueDateRange`, `validateDueDate`, `isOverdue`, `sortMyLoans`, `summarize`, `filterItems`, `validateItemInput`, `canEditItem`, `explainError`, `escapeHtml` | 화면·DB 무관 규칙 |
| app.js 데이터 | `loadItems`, `loadMyLoans`, `refreshAll` | 불러오기 |
| app.js 화면 | `render`, `renderHeader`, `renderSummary`, `renderSide`, `renderItems`, `renderMyLoans`, `showNotice` | 그리기 |
| app.js 동작 | `login`, `signup`, `logout`, `selectForRent`, `rentItem`, `returnLoan`, `saveItem`, `startEdit`, `deleteItem` | 이벤트 |
| 상수 | `CATEGORIES`, `ITEM_STATUS`, `LOAN_STATUS`, `MAX_LOAN_DAYS` | 분류·상태·7일 |

## 오류 기록 방법

1. 화면 오류는 F12 → Console, 배포 실패는 Vercel → Deployments → Logs를 먼저 본다.
2. [오류 수정 요청] 양식(무엇을 하다가 / 기대 / 실제 / 오류 메시지 / 최근 바꾼 것)으로 받는다.
3. 해결하면 아래 표에 한 줄을 추가하고, 이후 코드를 만들 때 그 규칙을 지킨다.

## 자주 발생한 오류와 해결

| 증상 | 원인 | 재발 방지 규칙 |
|---|---|---|
| 로그인 직후 화면이 멈춤 | `onAuthStateChange` 콜백 안에서 바로 다른 Supabase 요청을 await함 | 콜백 안에서는 `setTimeout(refreshAll, 0)`처럼 다음 차례로 미룬다 |
| 목록이 비어 있음 | config.js가 예시 값 그대로 | 앱이 "Supabase 연결 정보가 없습니다"를 띄우면 config.js 또는 Vercel 환경변수를 채운다 |
| 작업 버튼 칸 테두리가 어긋남 | `<td>`에 `display:flex`를 줌 | 표 칸 안에 `<div class="actions-wrap">`를 두고 그 div에 flex를 준다 |
| 새로고침 후 "대여" 안내 문구가 사라짐 | `classList.toggle(이름, undefined)`는 켜고 끄기를 뒤집음 | toggle의 두 번째 값은 `Boolean(...)`으로 감싸 true/false만 넘긴다 |
| 아래쪽에서 삭제하면 거부 이유가 안 보임 | 알림이 페이지 맨 위에만 있음 | 알림 상자는 `position: sticky`로 화면 상단에 붙인다 |
