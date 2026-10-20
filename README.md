# 공용 장비 대여 현황판 (equipment-loan)

부서 공용 장비의 **대여 가능 여부**와 **내 반납예정일**을 한 화면에서 확인하고 대여·반납하는 웹앱입니다.
AI 리더스 아카데미 과제 「예시 4) 공용물품 대여 장부 (GitHub + Vercel + Supabase)」를 바탕으로, 워크숍 과제 안내서의 규칙(R-01~R-08)까지 반영했습니다.

> 교육용 가상 장비·가상 계정만 사용합니다. 실제 개인정보·업무 자료는 넣지 않습니다.

## 주요 기능

- 이메일·비밀번호 회원가입/로그인 (새로고침해도 유지)
- 장비 목록 + 요약 카드 (로그인 전 3개 → 로그인 후 5개)
- 대여 등록 폼(반납예정일 오늘~7일), 내 대여 표, 각 행의 **반납** 버튼 → 반납 시각을 DB가 기록
- 장비 등록·수정·삭제 (내가 등록한 장비만), 연체 빨간 표시, 이름·위치 검색 + 분류·상태 필터
- 거부 이유 안내: 중복 대여, 8일 대여, 남의 기록 반납, 대여 기록이 있는 장비 삭제 등은 **DB가 거부**하고 화면에 이유 표시

## 파일

| 파일 | 역할 |
|---|---|
| `index.html`, `style.css` | 화면 |
| `logic.js` | 날짜·연체·필터 등 순수 규칙 |
| `app.js` | 화면 이벤트 + Supabase 연결 |
| `config.js` | Supabase 주소·공개용 키 (Vercel에서는 환경변수로 자동 생성) |
| `build-config.js`, `vercel.json` | Vercel 환경변수 → config.js |
| `test.html`, `tests.js` | 로직 테스트 33개 |
| `supabase_setup.sql` | 표 2개·RLS·트리거·가상 장비 10개 |
| `PRD.md`, `CLAUDE.md` | 요구사항 / AI 작업 규칙 |
| `콘솔테스트.md` | 화면을 우회한 DB 권한 확인 방법 |
| `제출양식_초안.md` | 제출 설명 초안 |

## 배포 따라 하기 (약 20분)

### 1) Supabase — DB 만들기
1. supabase.com → 수업에서 만든 **academy** 프로젝트(없으면 New project) 열기
2. **SQL Editor → New query** → `supabase_setup.sql` 전체 붙여 넣기 → **Run**
   - 마지막 결과가 `eqp_items 10 / eqp_loans 0` 이면 성공
   - ⚠ 이 SQL은 `eqp_` 표만 지우고 다시 만듭니다. 재실행하면 대여 기록이 초기화됩니다.
3. **Authentication → Sign In / Providers → Email → Confirm email 끄기** (가상 이메일로 바로 로그인)
4. **Project Settings → API**(Data API)에서 **Project URL**과 **Publishable(anon) 키** 복사
   - Secret / service_role 키는 절대 사용하지 않습니다.

### 2) GitHub — 저장소에 올리기
이 폴더가 이미 GitHub 저장소라면 그대로 사용합니다. 새 저장소로 옮길 때는 빈 저장소를 만든 뒤 push합니다.

### 3) Vercel — 배포하기
1. vercel.com → GitHub로 로그인 → **Add New → Project** → 이 저장소 **Import**
2. Framework Preset: **Other** (빌드 설정은 `vercel.json`이 자동 적용)
3. **Environment Variables** 에 두 개 추가 (과제 요구: 주소와 키를 환경변수로)
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_KEY` = Publishable(anon) 키
4. **Deploy** → Ready가 되면 대표 도메인(`https://○○○.vercel.app`) 접속
5. 시크릿 창에서도 열리는지 확인 → 이 주소를 지원센터에 제출

> 환경변수를 나중에 바꿨다면 Deployments → 최신 배포 → **Redeploy** 해야 반영됩니다.
> 환경변수에 넣어도 공개용 키는 브라우저로 전달됩니다. 권한은 RLS와 DB 규칙이 지킵니다.

### 내 PC에서 먼저 보기 (선택)
`config.js`의 두 값을 직접 채운 뒤 `index.html`을 브라우저로 엽니다. **이 경우 config.js를 커밋하지 마세요** (Vercel은 환경변수를 쓰므로 저장소의 config.js는 예시 값 그대로 두는 것이 안전합니다).

## 확인 체크리스트

- [ ] 로그아웃 상태: 카드 3개, 대여·등록 버튼 없음
- [ ] A 로그인 후 새로고침: 내 이메일·로그아웃·카드 5개 유지
- [ ] A 대여 → B(시크릿 창) 새로 불러오기: 대여중으로 보이고 B의 내 대여엔 A 기록 없음
- [ ] 8일 뒤 반납예정일 / 대여중 장비 재대여: 거부 이유 표시
- [ ] A 반납: 반납 시각 기록, 장비 다시 대여 가능
- [ ] 새 장비 등록·수정, B에게는 수정·삭제 버튼 없음
- [ ] 대여 후 반납한 장비 삭제: "대여 기록이 있는 장비는 삭제할 수 없습니다"
- [ ] `test.html` 모두 PASS

## 검증 기록

- `test.html` / `node tests.js`: 33/33 PASS
- `supabase_setup.sql`: PostgreSQL에서 anon·authenticated 역할과 `auth.uid()`를 흉내 내어 R-01~R-08 시나리오 확인
  (anon 대여 거부, 중복 대여 거부, 8일·이전 날짜 거부, 남의 기록 조회 0건·반납 0건, user_id·대여일·등록자 위조 무시,
  장비 상태 직접 수정 거부, 반납완료 변경 거부, 대여 기록 장비 삭제 거부)
- 실제 Supabase 프로젝트·Vercel 배포는 본인 계정에서 위 순서대로 진행해야 합니다.
