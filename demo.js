// demo.js — 체험 모드 (Supabase 연결 정보가 없을 때만 사용)
// Supabase와 같은 모양의 가짜 클라이언트로, 데이터는 이 브라우저(localStorage)에만 저장된다.
// DB 규칙(R-02~R-08)을 같은 방식으로 흉내 내어 거부 이유도 똑같이 보여 준다.
// 실제 공유·권한 검증은 Supabase를 연결한 정식 모드에서 확인한다.

function createDemoClient() {
  const KEY = "eqp_demo_v1";
  const DEMO_USER = { id: "demo-user-1", email: "test1@example.com", password: "test1234" };

  function seed() {
    const today = todayKST();
    const items = [
      ["가스 측정기 1호", "측정", "본관 1층 안전장비실"],
      ["소음 측정기", "측정", "본관 1층 안전장비실"],
      ["열화상 카메라", "측정", "설비동 2층 점검실"],
      ["업무용 노트북 A", "노트북", "본관 3층 정보화팀"],
      ["업무용 노트북 B", "노트북", "본관 3층 정보화팀"],
      ["빔프로젝터", "영상", "본관 4층 대회의실"],
      ["캠코더", "영상", "본관 4층 홍보팀"],
      ["휴대용 무전기 1번", "통신", "설비동 1층 상황실"],
      ["휴대용 무전기 2번", "통신", "설비동 1층 상황실"],
      ["현장용 접이식 사다리", "기타", "설비동 지하 창고"],
    ].map(([name, category, location], i) => ({
      id: i + 1, name, category, location, status: ITEM_STATUS.AVAILABLE, owner_id: null,
      created_at: new Date(Date.now() - (10 - i) * 1000).toISOString(),
    }));
    // 다른 직원이 빌려 간 장비 1개 (목록에는 대여중, 내 대여에는 안 보임)
    items[5].status = ITEM_STATUS.RENTED;
    const loans = [{
      id: 1, item_id: 6, user_id: "demo-other", start_date: today, due_date: addDays(today, 2),
      status: LOAN_STATUS.ACTIVE, returned_at: null, created_at: new Date().toISOString(),
    }];
    return { items, loans, users: [DEMO_USER], session: null, nextId: 100 };
  }

  let data;
  try {
    data = JSON.parse(localStorage.getItem(KEY)) || seed();
  } catch {
    data = seed();
  }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 저장 불가 시 메모리로만 */ }
  };
  save();

  const listeners = [];
  const emit = (event) => listeners.forEach((f) => f(event, data.session));
  const uid = () => data.session?.user.id || null;
  const fail = (code, message) => ({ data: null, error: { code, message } });
  const copy = (x) => JSON.parse(JSON.stringify(x));

  function query(table) {
    let op = "select", payload = null, single = false;
    const filters = [];
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; },
      single() { single = true; return api; },
      eq(k, v) { filters.push([k, v]); return api; },
      insert(p) { op = "insert"; payload = p; return api; },
      update(p) { op = "update"; payload = p; return api; },
      delete() { op = "delete"; return api; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    const match = (row) => filters.every(([k, v]) => row[k] === v);
    const done = (rows) => { save(); return { data: single ? copy(rows[0] ?? null) : copy(rows), error: null }; };

    function run() {
      const me = uid();
      if (table === "eqp_items") {
        if (op === "select") return done(data.items.filter(match));
        if (!me) return fail("42501", "permission denied for table eqp_items");
        if (op === "insert") {
          const row = { id: data.nextId++, name: payload.name, category: payload.category, location: payload.location,
            status: ITEM_STATUS.AVAILABLE, owner_id: me, created_at: new Date().toISOString() }; // R-03, R-07
          data.items.push(row);
          return done([row]);
        }
        const mine = data.items.filter(match).filter((r) => r.owner_id === me); // R-03
        if (op === "update") {
          if ("status" in payload) return fail("P0001", "장비 상태는 대여·반납으로만 바뀝니다.");
          if ("owner_id" in payload) return fail("P0001", "장비 등록자는 바꿀 수 없습니다.");
          mine.forEach((r) => Object.assign(r, { name: payload.name ?? r.name, category: payload.category ?? r.category, location: payload.location ?? r.location }));
          return done(mine);
        }
        if (op === "delete") {
          if (mine.some((r) => data.loans.some((l) => l.item_id === r.id))) // R-08
            return fail("23503", 'update or delete on table "eqp_items" violates foreign key constraint');
          data.items = data.items.filter((r) => !mine.includes(r));
          return done(mine);
        }
      }

      if (table === "eqp_loans") {
        if (!me) return fail("42501", "permission denied for table eqp_loans"); // R-01
        const own = data.loans.filter((l) => l.user_id === me); // R-02
        if (op === "select") {
          return done(own.filter(match).map((l) => {
            const item = data.items.find((i) => i.id === l.item_id);
            return { ...l, eqp_items: item ? { name: item.name, location: item.location } : null };
          }));
        }
        if (op === "insert") {
          const item = data.items.find((i) => i.id === payload.item_id);
          const start = todayKST(); // R-05 대여일은 한국 날짜
          if (!item) return fail("P0001", "존재하지 않는 장비입니다.");
          if (item.status !== ITEM_STATUS.AVAILABLE) return fail("P0001", "이미 대여중인 장비입니다."); // R-04
          if (!payload.due_date) return fail("P0001", "반납예정일을 선택해 주세요.");
          if (payload.due_date < start) return fail("P0001", `반납예정일은 대여일(${start}) 이전일 수 없습니다.`);
          if (payload.due_date > addDays(start, MAX_LOAN_DAYS)) return fail("P0001", `반납예정일은 대여일(${start})부터 7일 이내여야 합니다.`);
          const row = { id: data.nextId++, item_id: item.id, user_id: me, start_date: start, due_date: payload.due_date,
            status: LOAN_STATUS.ACTIVE, returned_at: null, created_at: new Date().toISOString() };
          data.loans.push(row);
          item.status = ITEM_STATUS.RENTED; // R-07
          return done([row]);
        }
        if (op === "update") {
          const targets = own.filter(match);
          if (targets.some((l) => l.status === LOAN_STATUS.RETURNED)) return fail("P0001", "반납완료된 기록은 다시 변경할 수 없습니다."); // R-06
          if (Object.keys(payload).some((k) => k !== "status") || payload.status !== LOAN_STATUS.RETURNED)
            return fail("P0001", "대여 기록은 반납 처리만 할 수 있습니다.");
          targets.forEach((l) => {
            l.status = LOAN_STATUS.RETURNED;
            l.returned_at = new Date().toISOString();
            const item = data.items.find((i) => i.id === l.item_id);
            if (item) item.status = ITEM_STATUS.AVAILABLE; // R-07
          });
          return done(targets);
        }
        if (op === "delete") return fail("42501", "permission denied for table eqp_loans");
      }
      return fail("42P01", `알 수 없는 표: ${table}`);
    }
    return api;
  }

  return {
    isDemo: true,
    from: query,
    auth: {
      onAuthStateChange(callback) {
        listeners.push(callback);
        setTimeout(() => callback("INITIAL_SESSION", data.session), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signInWithPassword({ email, password }) {
        const user = data.users.find((u) => u.email === email && u.password === password);
        if (!user) return { data: {}, error: { message: "Invalid login credentials" } };
        data.session = { user: { id: user.id, email: user.email } };
        save();
        emit("SIGNED_IN");
        return { data: { session: data.session }, error: null };
      },
      async signUp({ email, password }) {
        if (data.users.some((u) => u.email === email)) return { data: {}, error: { message: "User already registered" } };
        if (!password || password.length < 6) return { data: {}, error: { message: "Password should be at least 6 characters" } };
        const user = { id: `demo-${Date.now()}`, email, password };
        data.users.push(user);
        data.session = { user: { id: user.id, email } };
        save();
        emit("SIGNED_IN");
        return { data: { session: data.session }, error: null };
      },
      async signOut() {
        data.session = null;
        save();
        emit("SIGNED_OUT");
        return { error: null };
      },
    },
    reset() {
      data = seed();
      save();
      emit("SIGNED_OUT");
    },
  };
}
