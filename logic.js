// logic.js — 화면과 DB에 의존하지 않는 규칙 (test.html에서 검증)
// 최종 허용·거부는 DB가 판정한다. 여기 함수는 화면 안내와 표시용이다.

const CATEGORIES = ["노트북", "영상", "측정", "통신", "기타"];
const ITEM_STATUS = { AVAILABLE: "대여 가능", RENTED: "대여중" };
const LOAN_STATUS = { ACTIVE: "대여중", RETURNED: "반납완료" };
const MAX_LOAN_DAYS = 7;

// 한국 날짜 기준 오늘 (YYYY-MM-DD)
function todayKST(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// "YYYY-MM-DD" + n일
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// 반납예정일 선택 범위 (R-05)
function dueDateRange(today) {
  return { min: today, max: addDays(today, MAX_LOAN_DAYS) };
}

// 반납예정일 검사 — 문제가 있으면 안내 문구, 없으면 null (R-05)
function validateDueDate(due, today) {
  if (!due) return "반납예정일을 선택해 주세요.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return "날짜 형식이 올바르지 않습니다.";
  const { min, max } = dueDateRange(today);
  if (due < min) return "반납예정일은 대여일 이전일 수 없습니다.";
  if (due > max) return `반납예정일은 대여일부터 ${MAX_LOAN_DAYS}일 이내여야 합니다.`;
  return null;
}

// 연체: 대여중이고 반납예정일이 오늘보다 이전 (오늘까지 반납예정은 연체 아님)
function isOverdue(loan, today) {
  return loan.status === LOAN_STATUS.ACTIVE && loan.due_date < today;
}

// 내 대여 정렬: 대여중 먼저, 반납예정일 빠른 순, 같으면 최근 대여 먼저
function sortMyLoans(loans) {
  return [...loans].sort((a, b) => {
    const aActive = a.status === LOAN_STATUS.ACTIVE ? 0 : 1;
    const bActive = b.status === LOAN_STATUS.ACTIVE ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

// 요약 카드: 로그인 전 3개, 로그인 후 5개
function summarize(items, myLoans, today, loggedIn) {
  const rented = items.filter((i) => i.status === ITEM_STATUS.RENTED).length;
  const cards = [
    { key: "total", label: "전체 장비", value: items.length },
    { key: "available", label: "대여 가능", value: items.length - rented },
    { key: "rented", label: "대여중", value: rented },
  ];
  if (loggedIn) {
    const active = myLoans.filter((l) => l.status === LOAN_STATUS.ACTIVE);
    cards.push({ key: "myActive", label: "내 대여중", value: active.length });
    cards.push({
      key: "myOverdue",
      label: "내 연체",
      value: active.filter((l) => isOverdue(l, today)).length,
    });
  }
  return cards;
}

// 검색·필터: 이름·위치 검색 + 분류 + 상태 (함께 적용)
function filterItems(items, { q = "", category = "", status = "" } = {}) {
  const keyword = q.trim().toLowerCase();
  return items.filter((item) => {
    if (category && item.category !== category) return false;
    if (status && item.status !== status) return false;
    if (keyword) {
      const hay = `${item.name} ${item.location}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });
}

// 장비 등록·수정 입력 검사
function validateItemInput({ name, category, location }) {
  const n = (name || "").trim();
  const l = (location || "").trim();
  if (!n) return "장비 이름을 입력해 주세요.";
  if (n.length > 40) return "장비 이름은 40자 이내로 입력해 주세요.";
  if (!CATEGORIES.includes(category)) return "분류를 선택해 주세요.";
  if (!l) return "보관 위치를 입력해 주세요.";
  if (l.length > 40) return "보관 위치는 40자 이내로 입력해 주세요.";
  return null;
}

// 수정·삭제 버튼 표시 여부 (R-03) — 기본 장비(owner_id null)는 누구도 불가
function canEditItem(item, userId) {
  return Boolean(userId) && Boolean(item.owner_id) && item.owner_id === userId;
}

// DB 오류를 사용자에게 보여 줄 이유로 바꾼다
function explainError(error) {
  if (!error) return "";
  const code = error.code || "";
  const msg = error.message || "";
  if (code === "P0001" && msg) return msg; // 트리거가 보낸 이유 그대로
  if (code === "23505") return "이미 대여중인 장비입니다. (중복 대여 불가)";
  if (code === "23503") return "대여 기록이 있는 장비는 삭제할 수 없습니다.";
  if (code === "23514") {
    if (msg.includes("due")) return `반납예정일은 대여일부터 ${MAX_LOAN_DAYS}일 이내, 대여일 이후여야 합니다.`;
    return "입력값이 DB 규칙에 맞지 않습니다.";
  }
  if (code === "42501" || /row-level security|permission denied/i.test(msg))
    return "권한이 없습니다. 본인 것만 처리할 수 있습니다.";
  if (/Invalid login credentials/i.test(msg)) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (/already registered/i.test(msg)) return "이미 가입된 이메일입니다. 로그인해 주세요.";
  if (/Password should be at least/i.test(msg)) return "비밀번호는 6자 이상이어야 합니다.";
  if (/Email not confirmed/i.test(msg)) return "이메일 확인이 꺼져 있는지 Supabase 설정을 확인해 주세요.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "서버에 연결할 수 없습니다. 인터넷과 config.js를 확인해 주세요.";
  return msg || "알 수 없는 오류가 발생했습니다.";
}

// HTML 이스케이프 (사용자 입력을 화면에 넣을 때)
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Node(테스트 자동 실행)에서도 불러올 수 있게
if (typeof module !== "undefined") {
  module.exports = {
    CATEGORIES, ITEM_STATUS, LOAN_STATUS, MAX_LOAN_DAYS,
    todayKST, addDays, dueDateRange, validateDueDate, isOverdue, sortMyLoans,
    summarize, filterItems, validateItemInput, canEditItem, explainError, escapeHtml,
  };
}
