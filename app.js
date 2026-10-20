// app.js — 화면 이벤트와 Supabase 연결
// 규칙 계산은 logic.js, 최종 허용·거부는 DB(supabase_setup.sql)가 맡는다.

let db = null; // Supabase 클라이언트

const state = {
  session: null,
  items: [],
  myLoans: [],
  filters: { q: "", category: "", status: "" },
  selectedItemId: null, // 대여 패널에 선택된 장비
  editingItemId: null,  // 수정 중인 장비
};

const $ = (id) => document.getElementById(id);
const currentUserId = () => state.session?.user?.id || null;
const isLoggedIn = () => Boolean(currentUserId());

// ---------- 알림 ----------
let noticeTimer = null;
function showNotice(message, type = "error") {
  const box = $("notice");
  box.textContent = message;
  box.className = `notice ${type}`;
  clearTimeout(noticeTimer);
  if (type !== "error") noticeTimer = setTimeout(() => box.classList.add("hidden"), 4000);
}
function clearNotice() {
  $("notice").className = "notice hidden";
}

// 버튼을 잠시 잠그고 작업 실행 (연속 클릭 방지)
async function withBusy(button, task) {
  if (button) button.disabled = true;
  try {
    await task();
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------- 데이터 불러오기 ----------
async function loadItems() {
  const { data, error } = await db
    .from("eqp_items")
    .select("id, name, category, location, status, owner_id, created_at")
    .order("id", { ascending: true });
  if (error) throw error;
  state.items = data;
}

async function loadMyLoans() {
  if (!isLoggedIn()) {
    state.myLoans = [];
    return;
  }
  const { data, error } = await db
    .from("eqp_loans")
    .select("id, item_id, user_id, start_date, due_date, status, returned_at, created_at, eqp_items(name, location)")
    .eq("user_id", currentUserId())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  state.myLoans = data;
}

async function refreshAll() {
  try {
    await Promise.all([loadItems(), loadMyLoans()]);
  } catch (error) {
    console.error(error);
    showNotice(`목록을 불러오지 못했습니다: ${explainError(error)}`);
  }
  render();
}

// ---------- 화면 그리기 ----------
function render() {
  renderHeader();
  renderSummary();
  renderSide();
  renderItems();
  renderMyLoans();
}

function renderHeader() {
  const header = $("appHeader");
  const info = $("headerInfo");
  if (isLoggedIn()) {
    header.className = "app-header logged-in";
    info.innerHTML = `
      <span class="header-email">${escapeHtml(state.session.user.email)}</span>
      <button type="button" id="logoutBtn" class="btn small light">로그아웃</button>`;
    $("logoutBtn").addEventListener("click", logout);
  } else {
    header.className = "app-header logged-out";
    info.innerHTML = `<span class="badge-view">보기만 가능 · 로그인하면 대여할 수 있습니다</span>`;
  }
}

function renderSummary() {
  const cards = summarize(state.items, state.myLoans, todayKST(), isLoggedIn());
  $("summary").innerHTML = cards
    .map((c) => {
      const cls = c.key === "myOverdue" ? "card mine overdue" : c.key.startsWith("my") ? "card mine" : "card";
      return `<div class="${cls}"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`;
    })
    .join("");
}

function renderSide() {
  const loggedIn = isLoggedIn();
  $("authPanel").classList.toggle("hidden", loggedIn);
  $("loanPanel").classList.toggle("hidden", !loggedIn);
  $("itemPanel").classList.toggle("hidden", !loggedIn);
  if (!loggedIn) return;

  // 대여 패널
  const item = state.items.find((i) => i.id === state.selectedItemId);
  const selectable = Boolean(item && item.status === ITEM_STATUS.AVAILABLE);
  if (!selectable) state.selectedItemId = null;
  $("loanEmpty").classList.toggle("hidden", selectable);
  $("loanForm").classList.toggle("hidden", !selectable);
  if (selectable) {
    $("loanItemName").textContent = `${item.name} (${item.location})`;
    const { min, max } = dueDateRange(todayKST());
    const due = $("loanDue");
    due.min = min;
    due.max = max;
    if (!due.value || due.value < min || due.value > max) due.value = min;
  }

  // 등록·수정 폼
  const editing = state.editingItemId !== null;
  $("itemFormTitle").textContent = editing ? "장비 수정" : "장비 등록";
  $("itemSubmitBtn").textContent = editing ? "수정 저장" : "등록";
  $("itemCancelBtn").classList.toggle("hidden", !editing);
}

function statusBadge(status) {
  const cls = status === ITEM_STATUS.AVAILABLE ? "available" : "rented";
  return `<span class="status ${cls}">${escapeHtml(status)}</span>`;
}

function renderItems() {
  const userId = currentUserId();
  const rows = filterItems(state.items, state.filters);
  document.querySelector(".col-actions").classList.toggle("hidden", !isLoggedIn());

  $("itemRows").innerHTML = rows
    .map((item) => {
      const mine = canEditItem(item, userId);
      const actions = [];
      if (isLoggedIn() && item.status === ITEM_STATUS.AVAILABLE)
        actions.push(`<button class="btn small primary" data-action="rent" data-id="${item.id}">대여</button>`);
      if (mine) {
        actions.push(`<button class="btn small" data-action="edit" data-id="${item.id}">수정</button>`);
        actions.push(`<button class="btn small danger" data-action="delete" data-id="${item.id}">삭제</button>`);
      }
      return `<tr>
        <td>${escapeHtml(item.name)}${mine ? '<span class="mine-tag">내 등록</span>' : ""}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.location)}</td>
        <td>${statusBadge(item.status)}</td>
        ${isLoggedIn() ? `<td><div class="actions-wrap">${actions.join("")}</div></td>` : ""}
      </tr>`;
    })
    .join("");
  $("itemEmpty").classList.toggle("hidden", rows.length > 0);
}

function renderMyLoans() {
  const box = $("myLoans");
  if (!isLoggedIn()) {
    box.innerHTML = `<p class="hint">로그인하면 볼 수 있습니다.</p>`;
    return;
  }
  if (state.myLoans.length === 0) {
    box.innerHTML = `<p class="hint">아직 대여한 장비가 없습니다.</p>`;
    return;
  }
  const today = todayKST();
  const rows = sortMyLoans(state.myLoans)
    .map((loan) => {
      const overdue = isOverdue(loan, today);
      const active = loan.status === LOAN_STATUS.ACTIVE;
      const badge = overdue
        ? `<span class="status overdue">연체</span>`
        : `<span class="status ${active ? "rented" : "returned"}">${escapeHtml(loan.status)}</span>`;
      const returned = loan.returned_at ? new Date(loan.returned_at).toLocaleString("ko-KR") : "-";
      const action = active
        ? `<button class="btn small primary" data-action="return" data-id="${loan.id}">반납</button>`
        : "";
      return `<tr class="${overdue ? "overdue" : ""}">
        <td>${escapeHtml(loan.eqp_items?.name ?? `장비 #${loan.item_id}`)}</td>
        <td>${loan.start_date}</td>
        <td>${loan.due_date}</td>
        <td>${badge}</td>
        <td>${returned}</td>
        <td>${action}</td>
      </tr>`;
    })
    .join("");
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>장비</th><th>대여일</th><th>반납예정일</th><th>상태</th><th>반납 시각</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---------- 로그인 ----------
function readAuthForm() {
  return { email: $("authEmail").value.trim(), password: $("authPassword").value };
}

async function login(event) {
  event.preventDefault();
  const { email, password } = readAuthForm();
  await withBusy($("loginBtn"), async () => {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) return showNotice(explainError(error));
    $("authForm").reset();
    showNotice("로그인했습니다.", "ok");
  });
}

async function signup() {
  const { email, password } = readAuthForm();
  if (!email || password.length < 6) return showNotice("이메일과 6자 이상 비밀번호를 입력해 주세요.");
  await withBusy($("signupBtn"), async () => {
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) return showNotice(explainError(error));
    if (!data.session) return showNotice("가입했지만 바로 로그인되지 않았습니다. Supabase에서 Confirm email을 꺼 주세요.", "info");
    $("authForm").reset();
    showNotice("가입하고 로그인했습니다.", "ok");
  });
}

async function logout() {
  await db.auth.signOut();
  state.selectedItemId = null;
  state.editingItemId = null;
  showNotice("로그아웃했습니다. 보기 전용 화면입니다.", "info");
}

// ---------- 대여·반납 ----------
function selectForRent(itemId) {
  state.selectedItemId = itemId;
  clearNotice();
  renderSide();
  $("loanDue").focus();
}

async function rentItem(event) {
  event.preventDefault();
  const itemId = state.selectedItemId;
  const due = $("loanDue").value;
  const problem = validateDueDate(due, todayKST());
  if (problem) return showNotice(problem);

  await withBusy(event.submitter, async () => {
    // 빌린 사람·대여일·장비 상태는 DB가 정한다 (R-02, R-05, R-07)
    const { error } = await db.from("eqp_loans").insert({ item_id: itemId, due_date: due }).select().single();
    if (error) {
      showNotice(`대여할 수 없습니다: ${explainError(error)}`);
    } else {
      state.selectedItemId = null;
      $("loanDue").value = "";
      showNotice("대여했습니다. 내 대여에서 반납할 수 있습니다.", "ok");
    }
    await refreshAll();
  });
}

async function returnLoan(loanId, button) {
  await withBusy(button, async () => {
    const { data, error } = await db
      .from("eqp_loans")
      .update({ status: LOAN_STATUS.RETURNED })
      .eq("id", loanId)
      .eq("status", LOAN_STATUS.ACTIVE)
      .select();
    if (error) showNotice(`반납할 수 없습니다: ${explainError(error)}`);
    else if (data.length === 0) showNotice("본인의 대여중 기록만 반납할 수 있습니다. (변경 0건)");
    else showNotice("반납했습니다. 장비는 다시 대여 가능합니다.", "ok");
    await refreshAll();
  });
}

// ---------- 장비 등록·수정·삭제 ----------
function readItemForm() {
  return {
    name: $("itemName").value.trim(),
    category: $("itemCategory").value,
    location: $("itemLocation").value.trim(),
  };
}

function resetItemForm() {
  state.editingItemId = null;
  $("itemForm").reset();
  renderSide();
}

function startEdit(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;
  state.editingItemId = itemId;
  $("itemName").value = item.name;
  $("itemCategory").value = item.category;
  $("itemLocation").value = item.location;
  renderSide();
  $("itemName").focus();
}

async function saveItem(event) {
  event.preventDefault();
  const input = readItemForm();
  const problem = validateItemInput(input);
  if (problem) return showNotice(problem);

  await withBusy($("itemSubmitBtn"), async () => {
    if (state.editingItemId === null) {
      // 등록자·상태는 DB가 기록 (R-03, R-07)
      const { error } = await db.from("eqp_items").insert(input).select().single();
      if (error) return showNotice(`등록할 수 없습니다: ${explainError(error)}`);
      showNotice("장비를 등록했습니다.", "ok");
    } else {
      const { data, error } = await db.from("eqp_items").update(input).eq("id", state.editingItemId).select();
      if (error) return showNotice(`수정할 수 없습니다: ${explainError(error)}`);
      if (data.length === 0) return showNotice("본인이 등록한 장비만 수정할 수 있습니다. (변경 0건)");
      showNotice("장비 정보를 수정했습니다.", "ok");
    }
    resetItemForm();
    await refreshAll();
  });
}

async function deleteItem(itemId, button) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item || !confirm(`'${item.name}'을(를) 삭제할까요?`)) return;
  await withBusy(button, async () => {
    const { data, error } = await db.from("eqp_items").delete().eq("id", itemId).select();
    if (error) showNotice(`삭제할 수 없습니다: ${explainError(error)}`);
    else if (data.length === 0) showNotice("본인이 등록한 장비만 삭제할 수 있습니다. (변경 0건)");
    else {
      if (state.editingItemId === itemId) resetItemForm();
      showNotice("장비를 삭제했습니다.", "ok");
    }
    await refreshAll();
  });
}

// ---------- 이벤트 연결 ----------
function fillCategorySelects() {
  const options = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  $("itemCategory").innerHTML = `<option value="">분류 선택</option>${options}`;
  $("categoryFilter").innerHTML = `<option value="">전체 분류</option>${options}`;
}

function bindEvents() {
  $("authForm").addEventListener("submit", login);
  $("signupBtn").addEventListener("click", signup);
  $("loanForm").addEventListener("submit", rentItem);
  $("loanCancelBtn").addEventListener("click", () => {
    state.selectedItemId = null;
    renderSide();
  });
  $("itemForm").addEventListener("submit", saveItem);
  $("itemCancelBtn").addEventListener("click", resetItemForm);
  $("refreshBtn").addEventListener("click", async (e) => {
    await withBusy(e.currentTarget, refreshAll);
    showNotice("최신 상태를 불러왔습니다.", "info");
  });

  $("searchInput").addEventListener("input", (e) => {
    state.filters.q = e.target.value;
    renderItems();
  });
  $("categoryFilter").addEventListener("change", (e) => {
    state.filters.category = e.target.value;
    renderItems();
  });
  $("statusFilter").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    renderItems();
  });
  $("filterResetBtn").addEventListener("click", () => {
    state.filters = { q: "", category: "", status: "" };
    $("searchInput").value = "";
    $("categoryFilter").value = "";
    $("statusFilter").value = "";
    renderItems();
  });

  // 목록·내 대여 버튼 (이벤트 위임)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === "rent") selectForRent(id);
    if (btn.dataset.action === "edit") startEdit(id);
    if (btn.dataset.action === "delete") deleteItem(id, btn);
    if (btn.dataset.action === "return") returnLoan(id, btn);
  });
}

function isConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    typeof SUPABASE_KEY === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    !SUPABASE_URL.includes("YOUR-") &&
    !SUPABASE_KEY.includes("YOUR-")
  );
}

function showDemoBanner() {
  const banner = $("demoBanner");
  banner.classList.remove("hidden");
  $("demoResetBtn").addEventListener("click", () => {
    if (!confirm("체험 데이터를 처음 상태로 되돌릴까요?")) return;
    db.reset();
    showNotice("체험 데이터를 처음 상태로 되돌렸습니다.", "info");
  });
}

function init() {
  fillCategorySelects();
  bindEvents();
  render();

  if (isConfigured() && window.supabase) {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    // Supabase 연결 정보가 없으면 체험 모드 (이 브라우저에만 저장)
    db = createDemoClient();
    showDemoBanner();
  }

  // 로그인 상태가 바뀔 때마다 (처음 열 때 포함) 다시 그린다. 새로고침해도 로그인 유지.
  db.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    // 콜백 안에서 바로 다른 Supabase 요청을 기다리면 멈출 수 있어 다음 차례로 미룬다
    setTimeout(refreshAll, 0);
  });
}

document.addEventListener("DOMContentLoaded", init);
