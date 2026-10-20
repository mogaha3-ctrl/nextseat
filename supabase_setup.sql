-- =====================================================================
-- 공용 장비 대여 현황판 (equipment-loan) · supabase_setup.sql
-- Supabase academy 프로젝트 → SQL Editor → 새 쿼리에 붙여 넣고 Run
--
-- ⚠ 이 SQL은 eqp_ 로 시작하는 표만 지우고 처음 상태로 다시 만듭니다.
--   수업의 edu_ 표, 부록의 inq_ 표는 건드리지 않습니다.
--   재실행하면 과제 앱에서 만든 대여·등록 데이터가 사라집니다.
-- =====================================================================

-- 0. 초기화 (여러 번 실행해도 처음 상태로) ------------------------------
drop table if exists public.eqp_loans cascade;
drop table if exists public.eqp_items cascade;
drop function if exists public.eqp_items_before_write() cascade;
drop function if exists public.eqp_loans_before_insert() cascade;
drop function if exists public.eqp_loans_before_update() cascade;
drop function if exists public.eqp_loans_after_write() cascade;
drop function if exists public.eqp_today() cascade;

-- 한국 날짜 (R-05: 대여일은 DB가 한국 날짜로 결정)
create function public.eqp_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 1. 장비 표 -----------------------------------------------------------
create table public.eqp_items (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  category   text not null check (category in ('노트북', '영상', '측정', '통신', '기타')),
  location   text not null check (char_length(btrim(location)) between 1 and 40),
  status     text not null default '대여 가능' check (status in ('대여 가능', '대여중')),
  owner_id   uuid references auth.users (id) on delete set null,  -- 등록한 사람 (기본 장비는 null)
  created_at timestamptz not null default now()
);

-- 2. 대여 표 -----------------------------------------------------------
create table public.eqp_loans (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.eqp_items (id) on delete restrict,  -- R-08 대여 기록이 있는 장비는 삭제 불가
  user_id     uuid not null references auth.users (id) on delete cascade,          -- 빌린 사람
  start_date  date not null default public.eqp_today(),
  due_date    date not null,
  status      text not null default '대여중' check (status in ('대여중', '반납완료')),
  returned_at timestamptz,
  created_at  timestamptz not null default now(),
  -- R-05 반납예정일은 대여일 이전 불가, 대여일부터 7일 이내
  constraint eqp_loans_due_not_before check (due_date >= start_date),
  constraint eqp_loans_due_within_7 check (due_date <= start_date + 7),
  -- 반납완료이면 반납 시각이 반드시 있고, 대여중이면 없음
  constraint eqp_loans_returned_pair check ((status = '반납완료') = (returned_at is not null))
);

-- R-04 장비 하나에 '대여중' 기록은 한 건만
create unique index eqp_loans_one_active_per_item
  on public.eqp_loans (item_id) where status = '대여중';

create index eqp_loans_user_idx on public.eqp_loans (user_id, status, due_date);

-- 3. 장비 표 트리거 ------------------------------------------------------
-- R-03 등록자는 DB가 기록 / R-07 장비 상태는 화면에서 직접 바꿀 수 없음
create function public.eqp_items_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id   := auth.uid();      -- 등록자 = 로그인한 사람 (SQL Editor 기본 장비는 null)
    new.status     := '대여 가능';     -- R-07 새 장비는 항상 대여 가능
    new.created_at := now();
    return new;
  end if;

  -- UPDATE: 일반 사용자(anon/authenticated)의 요청만 제한.
  -- 대여·반납 트리거(security definer)가 바꾸는 상태 변경은 허용된다.
  if current_user in ('anon', 'authenticated') then
    if new.status is distinct from old.status then
      raise exception '장비 상태는 대여·반납으로만 바뀝니다.' using errcode = 'P0001';  -- R-07
    end if;
    if new.owner_id is distinct from old.owner_id then
      raise exception '장비 등록자는 바꿀 수 없습니다.' using errcode = 'P0001';        -- R-03
    end if;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger eqp_items_before_write
  before insert or update on public.eqp_items
  for each row execute function public.eqp_items_before_write();

-- 4. 대여 표 트리거 ------------------------------------------------------
-- 대여 등록 전: 빌린 사람·대여일·상태는 DB가 결정 (R-02, R-05, R-04)
create function public.eqp_loans_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_status text;
begin
  if auth.uid() is null then
    raise exception '로그인한 직원만 대여할 수 있습니다.' using errcode = 'P0001';     -- R-01
  end if;

  new.user_id     := auth.uid();        -- R-02 빌린 사람은 로그인한 본인
  new.start_date  := public.eqp_today(); -- R-05 대여일은 한국 날짜 오늘
  new.status      := '대여중';
  new.returned_at := null;
  new.created_at  := now();

  -- R-04 대여 가능 장비만 (동시에 두 사람이 눌러도 한 건만 통과하도록 잠금)
  select status into v_item_status
    from public.eqp_items
   where id = new.item_id
   for update;

  if not found then
    raise exception '존재하지 않는 장비입니다.' using errcode = 'P0001';
  end if;
  if v_item_status <> '대여 가능' then
    raise exception '이미 대여중인 장비입니다.' using errcode = 'P0001';
  end if;

  -- R-05 이해하기 쉬운 거부 이유 (check 제약이 한 번 더 지킴)
  if new.due_date is null then
    raise exception '반납예정일을 선택해 주세요.' using errcode = 'P0001';
  end if;
  if new.due_date < new.start_date then
    raise exception '반납예정일은 대여일(%) 이전일 수 없습니다.', new.start_date using errcode = 'P0001';
  end if;
  if new.due_date > new.start_date + 7 then
    raise exception '반납예정일은 대여일(%)부터 7일 이내여야 합니다.', new.start_date using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger eqp_loans_before_insert
  before insert on public.eqp_loans
  for each row execute function public.eqp_loans_before_insert();

-- 대여 수정 전: 반납완료 기록은 고칠 수 없음(R-06), 사용자는 '반납'만 가능
create function public.eqp_loans_before_update()
returns trigger
language plpgsql
as $$
begin
  if old.status = '반납완료' then
    raise exception '반납완료된 기록은 다시 변경할 수 없습니다.' using errcode = 'P0001';  -- R-06
  end if;

  if current_user in ('anon', 'authenticated') then
    if new.item_id    is distinct from old.item_id
    or new.user_id    is distinct from old.user_id
    or new.start_date is distinct from old.start_date
    or new.due_date   is distinct from old.due_date
    or new.created_at is distinct from old.created_at then
      raise exception '대여 기록은 반납 처리만 할 수 있습니다.' using errcode = 'P0001';
    end if;
  end if;

  if new.status = '반납완료' then
    new.returned_at := now();  -- 반납 시각은 DB가 기록
  else
    new.returned_at := null;
  end if;
  return new;
end;
$$;

create trigger eqp_loans_before_update
  before update on public.eqp_loans
  for each row execute function public.eqp_loans_before_update();

-- 대여·반납 후: 장비 상태는 DB가 바꿈 (R-07)
create function public.eqp_loans_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = '대여중' then
    update public.eqp_items set status = '대여중' where id = new.item_id;
  elsif tg_op = 'UPDATE' and old.status = '대여중' and new.status = '반납완료' then
    update public.eqp_items set status = '대여 가능' where id = new.item_id;
  end if;
  return null;
end;
$$;

create trigger eqp_loans_after_write
  after insert or update on public.eqp_loans
  for each row execute function public.eqp_loans_after_write();

-- 5. 권한 (GRANT) ---------------------------------------------------------
-- R-01 로그인 전(anon)은 eqp_items 읽기만, 대여 표는 아무것도 못 함
revoke all on public.eqp_items from anon, authenticated;
revoke all on public.eqp_loans from anon, authenticated;
grant select on public.eqp_items to anon;
grant select, insert, update, delete on public.eqp_items to authenticated;
grant select, insert, update on public.eqp_loans to authenticated;   -- 삭제 권한 없음 (반납은 삭제가 아님)

-- 6. RLS 정책 --------------------------------------------------------------
alter table public.eqp_items enable row level security;
alter table public.eqp_loans enable row level security;

-- R-01 장비 목록은 누구나 읽기
create policy eqp_items_select_all on public.eqp_items
  for select to anon, authenticated using (true);

-- R-03 등록은 로그인한 직원, 등록자는 본인으로 기록
create policy eqp_items_insert_own on public.eqp_items
  for insert to authenticated with check (owner_id = auth.uid());

-- R-03 수정·삭제는 등록자 본인만 (기본 장비는 owner_id가 null이라 누구도 불가)
create policy eqp_items_update_own on public.eqp_items
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy eqp_items_delete_own on public.eqp_items
  for delete to authenticated using (owner_id = auth.uid());

-- R-02 대여 기록은 본인 것만 조회·대여·반납
create policy eqp_loans_select_own on public.eqp_loans
  for select to authenticated using (user_id = auth.uid());

create policy eqp_loans_insert_own on public.eqp_loans
  for insert to authenticated with check (user_id = auth.uid());

create policy eqp_loans_update_own on public.eqp_loans
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 7. 가상 장비 10개 (교육용 · 등록자 없음) --------------------------------
insert into public.eqp_items (name, category, location) values
  ('가스 측정기 1호',      '측정',   '본관 1층 안전장비실'),
  ('소음 측정기',          '측정',   '본관 1층 안전장비실'),
  ('열화상 카메라',        '측정',   '설비동 2층 점검실'),
  ('업무용 노트북 A',      '노트북', '본관 3층 정보화팀'),
  ('업무용 노트북 B',      '노트북', '본관 3층 정보화팀'),
  ('빔프로젝터',           '영상',   '본관 4층 대회의실'),
  ('캠코더',               '영상',   '본관 4층 홍보팀'),
  ('휴대용 무전기 1번',    '통신',   '설비동 1층 상황실'),
  ('휴대용 무전기 2번',    '통신',   '설비동 1층 상황실'),
  ('현장용 접이식 사다리', '기타',   '설비동 지하 창고');

-- 8. 실행 뒤 확인 ----------------------------------------------------------
-- 아래 결과가 "eqp_items 10 / eqp_loans 0" 이면 성공입니다.
select 'eqp_items' as 표, count(*) as 행수 from public.eqp_items
union all
select 'eqp_loans', count(*) from public.eqp_loans;
