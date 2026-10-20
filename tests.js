// tests.js — logic.js 테스트 목록 (test.html에서 실행, node tests.js로도 실행 가능)

if (typeof module !== "undefined" && typeof todayKST === "undefined") {
  Object.assign(globalThis, require("./logic.js"));
}

function runAllTests() {
  const results = [];
  const eq = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, ok, detail: `기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}` });
  };

  const today = "2026-10-20";

  // 날짜 (R-05)
  eq("T-01 한국 날짜: UTC 10/19 15:30은 한국 10/20", todayKST(new Date("2026-10-19T15:30:00Z")), "2026-10-20");
  eq("T-01 한국 날짜: UTC 10/19 14:59는 한국 10/19", todayKST(new Date("2026-10-19T14:59:00Z")), "2026-10-19");
  eq("T-02 날짜 더하기: 월말 넘김", addDays("2026-10-28", 7), "2026-11-04");
  eq("T-02 반납예정일 범위는 오늘~7일 뒤", dueDateRange(today), { min: "2026-10-20", max: "2026-10-27" });
  eq("T-03 7일 뒤 반납예정일 허용", validateDueDate("2026-10-27", today), null);
  eq("T-03 오늘 반납예정일 허용", validateDueDate("2026-10-20", today), null);
  eq("T-04 8일 뒤 반납예정일 거부", validateDueDate("2026-10-28", today), "반납예정일은 대여일부터 7일 이내여야 합니다.");
  eq("T-05 대여일 이전 반납예정일 거부", validateDueDate("2026-10-19", today), "반납예정일은 대여일 이전일 수 없습니다.");
  eq("T-05 빈 반납예정일 거부", validateDueDate("", today), "반납예정일을 선택해 주세요.");

  // 연체
  eq("T-06 어제가 반납예정인 대여중 = 연체", isOverdue({ status: "대여중", due_date: "2026-10-19" }, today), true);
  eq("T-06 오늘까지 반납예정은 연체 아님", isOverdue({ status: "대여중", due_date: "2026-10-20" }, today), false);
  eq("T-06 반납완료 기록은 연체 아님", isOverdue({ status: "반납완료", due_date: "2026-10-01" }, today), false);

  // 내 대여 정렬
  const loans = [
    { id: 1, status: "반납완료", due_date: "2026-10-18", created_at: "a" },
    { id: 2, status: "대여중", due_date: "2026-10-25", created_at: "b" },
    { id: 3, status: "대여중", due_date: "2026-10-21", created_at: "c" },
  ];
  eq("T-07 내 대여: 대여중 먼저, 반납예정일 빠른 순", sortMyLoans(loans).map((l) => l.id), [3, 2, 1]);
  eq("T-07 정렬은 원본 배열을 바꾸지 않음", loans.map((l) => l.id), [1, 2, 3]);

  // 요약 카드
  const items = [
    { name: "가스 측정기", category: "측정", location: "본관 1층", status: "대여중", owner_id: null },
    { name: "노트북 A", category: "노트북", location: "본관 3층", status: "대여 가능", owner_id: "u1" },
    { name: "무전기", category: "통신", location: "설비동 1층", status: "대여 가능", owner_id: null },
  ];
  const myLoans = [
    { status: "대여중", due_date: "2026-10-19" },
    { status: "대여중", due_date: "2026-10-22" },
    { status: "반납완료", due_date: "2026-10-10" },
  ];
  eq("T-08 로그인 전 요약 카드 3개", summarize(items, [], today, false).map((c) => c.value), [3, 2, 1]);
  eq("T-08 로그인 후 요약 카드 5개 (내 대여중 2, 내 연체 1)", summarize(items, myLoans, today, true).map((c) => c.value), [3, 2, 1, 2, 1]);

  // 검색·필터
  const names = (list) => list.map((i) => i.name);
  eq("T-09 이름 검색", names(filterItems(items, { q: "노트북" })), ["노트북 A"]);
  eq("T-09 위치 검색 (앞뒤 공백 무시)", names(filterItems(items, { q: "  본관 " })), ["가스 측정기", "노트북 A"]);
  eq("T-09 분류 + 상태 필터 함께", names(filterItems(items, { category: "측정", status: "대여 가능" })), []);
  eq("T-09 검색 + 상태 필터 함께", names(filterItems(items, { q: "본관", status: "대여 가능" })), ["노트북 A"]);
  eq("T-09 조건을 비우면 전체", filterItems(items, {}).length, 3);

  // 장비 입력·권한 표시
  eq("T-10 정상 장비 입력", validateItemInput({ name: "캠코더", category: "영상", location: "4층" }), null);
  eq("T-10 이름 빈칸 거부", validateItemInput({ name: "  ", category: "영상", location: "4층" }), "장비 이름을 입력해 주세요.");
  eq("T-10 없는 분류 거부", validateItemInput({ name: "드론", category: "항공", location: "4층" }), "분류를 선택해 주세요.");
  eq("T-11 내가 등록한 장비만 수정 버튼", canEditItem({ owner_id: "u1" }, "u1"), true);
  eq("T-11 남이 등록한 장비는 수정 버튼 없음", canEditItem({ owner_id: "u1" }, "u2"), false);
  eq("T-11 기본 장비(등록자 없음)는 누구도 수정 불가", canEditItem({ owner_id: null }, "u1"), false);
  eq("T-11 로그인 전에는 수정 불가", canEditItem({ owner_id: "u1" }, null), false);

  // 거부 이유 안내
  eq("T-12 트리거 거부 이유는 그대로", explainError({ code: "P0001", message: "이미 대여중인 장비입니다." }), "이미 대여중인 장비입니다.");
  eq("T-12 중복 대여(unique) 안내", explainError({ code: "23505", message: "duplicate key" }), "이미 대여중인 장비입니다. (중복 대여 불가)");
  eq("T-12 대여 기록 장비 삭제(외래 키) 안내", explainError({ code: "23503", message: "violates foreign key" }), "대여 기록이 있는 장비는 삭제할 수 없습니다.");
  eq("T-12 RLS 거부 안내", explainError({ code: "42501", message: "new row violates row-level security policy" }), "권한이 없습니다. 본인 것만 처리할 수 있습니다.");

  // 보안
  eq("T-13 HTML 이스케이프", escapeHtml(`<img src=x onerror="a">`), "&lt;img src=x onerror=&quot;a&quot;&gt;");

  return results;
}

if (typeof module !== "undefined" && require.main === module) {
  const results = runAllTests();
  results.forEach((r) => console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : " — " + r.detail}`));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
}
