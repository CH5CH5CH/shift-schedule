/* 교대근무 일정 — 계산 규칙 (docs/spec.md 3~6장)
   시간은 모두 "절대 분" = (1970-01-01부터 날짜 수) × 1440 + 그날의 분.
   벽시계 시각만 다루므로 시간대·서머타임 영향을 받지 않는다. */
(function (root) {
  'use strict';

  // 근무조 고정값 (그날 00:00 기준 분). C조 끝·퇴근버스는 다음 날로 넘어간다.
  const SHIFTS = {
    A: { start: 6 * 60, end: 14 * 60, bus: 4 * 60 + 15, back: 14 * 60 + 30 },
    B: { start: 14 * 60, end: 22 * 60, bus: 12 * 60 + 15, back: 22 * 60 + 30 },
    C: { start: 22 * 60, end: 30 * 60, bus: 20 * 60 + 15, back: 30 * 60 + 30 },
  };
  const OT_MIN = 210; // OT 길이 3시간 30분(전OT·후OT 모두, QA-006 v10). OT 시각은 모두 이 값으로 계산
  const RANGE_START = '2026-11-01';
  const RANGE_END = '2027-06-30';
  const ANCHOR = { key: '2026-11-22', shift: 'C', nth: 1 }; // 11/22가 C조 첫날
  const ORDER = 'ABC';

  const p2 = n => String(n).padStart(2, '0');
  const mod = (a, n) => ((a % n) + n) % n;

  function keyToDay(k) {
    const [y, m, d] = k.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 864e5);
  }
  function dayToKey(n) {
    const d = new Date(n * 864e5);
    return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  }
  function nowAbs(dt) {
    return Math.round(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 864e5) * 1440
      + dt.getHours() * 60 + dt.getMinutes();
  }
  function fmt(abs) {
    const m = mod(abs, 1440);
    return p2(Math.floor(m / 60)) + ':' + p2(m % 60);
  }
  function dur(m) {
    m = Math.round(m);
    if (m <= 0) return '0분';
    const h = Math.floor(m / 60), r = m % 60;
    return (h ? h + '시간' : '') + (r ? (h ? ' ' : '') + r + '분' : '');
  }

  // 24일 주기: A×6, 휴무×2, B×6, 휴무×2, C×6, 휴무×2
  const CYCLE = [...ORDER].flatMap(x => [x, x, x, x, x, x, 'off', 'off']);

  /* 한 번에 채우기: 기준 날짜 + 그날 근무조 + 며칠째(1~6)로 전체 범위를 채운다.
     이미 넣은 OT는 유지하고, 휴무가 된 날의 OT만 지운다. */
  function fillRoster(roster, baseKey, shift, nth) {
    const i0 = ORDER.indexOf(shift) * 8 + (nth - 1);
    const b = keyToDay(baseKey), s0 = keyToDay(RANGE_START), s1 = keyToDay(RANGE_END);
    for (let d = s0; d <= s1; d++) {
      const k = dayToKey(d), s = CYCLE[mod(d - b + i0, 24)], prev = roster[k];
      roster[k] = { s, ot: s === 'off' ? '' : (prev && prev.ot) || '' };
    }
    return roster;
  }
  const defaultRoster = () => fillRoster({}, ANCHOR.key, ANCHOR.shift, ANCHOR.nth);

  /* 일찍 나가기는 v12에서 삭제(친구 UT 11/24: 헷갈림) — 항상 0분. 저장된 early 값은 읽어도 무시한다(롤백 대비로 지우지는 않음) */
  const earlyFor = () => 0;
  const defaultMode = (s, ot) => (s === 'A' || ot === 'pre') ? 'taxi' : 'bus';

  /* 이동수단 선택지와 각 출발 시각 (spec 5장) */
  function depOptions(day, s, ot, move, early) {
    const S = SHIFTS[s], b = day * 1440, e = earlyFor(ot, early);
    if (ot === 'pre') {
      const t = b + S.start - OT_MIN - move.car - e;
      return [{ k: 'taxi', label: '택시로 회사', dep: t }, { k: 'car', label: '차로 회사', dep: t }];
    }
    return [
      { k: 'bus', label: '시내버스', dep: b + S.bus - move.bus - e },
      { k: 'taxi', label: '택시', dep: b + S.bus - move.taxi - e },
      { k: 'car', label: '차로 회사', dep: b + S.start - move.car - e },
    ];
  }
  /* 집 도착 = 퇴근버스 + 70분. 후OT 날은 (근무 끝 + OT_MIN) + 택시·차(50분) */
  function homeArrival(day, s, ot, move) {
    const S = SHIFTS[s], b = day * 1440;
    return ot === 'post' ? b + S.end + OT_MIN + move.car : b + S.back + move.ride;
  }
  function workStart(day, s, ot) { return day * 1440 + SHIFTS[s].start - (ot === 'pre' ? OT_MIN : 0); }
  function workEnd(day, s, ot) { return day * 1440 + SHIFTS[s].end + (ot === 'post' ? OT_MIN : 0); }

  /* 날짜별 상태(할 일·이동수단·밥·휴무 옵션) — v11: st.days[날짜 키]. 근무일 = 근무 시작 날짜, 휴무 = 그 날짜(달력 날짜 키, 사용자 결정 11/23)
     st.days가 없으면 v10 형식(st.today 하나, 계산 대상 근무 키)으로 읽는다 — v10 점검과 롤백 호환 */
  function dayOf(st, k) {
    if (st.days) return st.days[k] || null;
    return st.today && st.today.key === k ? st.today : null;
  }
  const sumM = tasks => tasks.reduce((a, x) => a + (Number.isFinite(x.m) ? x.m : 0), 0);

  /* ── v12 주간 플래너 (spec 7-1장) ──
     plan(별도 저장 키, v11이 읽지 않음): rules 반복 규칙, memos 주간 메모, days[날짜] 주간 표시(w 주간 항목 이름, r 이름→규칙 id, cf 이름→이월한 날짜, skip 이 날만 지운 규칙 id),
     wk 주간에 보이는 기본 목록 이름, ui 마지막 보기. 같은 날 같은 이름은 하나뿐이라 (날짜, 이름)으로 항목을 구분한다 */
  const PLAN_WK = ['공부', '헬스']; // 주간에 보이기 기본값(사용자 결정 11/24): 잠 깨기·밥 끔, 공부·헬스 켬
  function planDefault() { return { v: 1, rules: [], memos: {}, days: {}, wk: PLAN_WK.slice(), ui: { week: 'week' } }; }
  const weekday = d => { const w = new Date(d * 864e5).getUTCDay(); return w === 0 ? 7 : w; }; // 1=월 … 7=일
  const weekStart = d => d - (weekday(d) - 1);                                                  // 그 주 월요일
  function weekLabel(mon) { const th = dayToKey(mon + 3).split('-').map(Number); return `${th[1]}월 ${Math.ceil(th[2] / 7)}주`; }
  /* 반복 규칙이 그날에 해당하는가: daily 매일, wd 고른 요일, work·off 근무표 기준(근무일·휴무일) */
  function ruleOn(st, rule, d) {
    const k = dayToKey(d);
    if (k < rule.from || (rule.until && k > rule.until)) return false;
    if (rule.kind === 'daily') return true;
    if (rule.kind === 'wd') return Array.isArray(rule.wd) && rule.wd.includes(weekday(d));
    const r = st.roster[k];
    if (rule.kind === 'work') return !!r && !!SHIFTS[r.s];
    if (rule.kind === 'off') return !!r && r.s === 'off';
    return false;
  }
  const planDay = (pl, k) => (pl && pl.days && pl.days[k]) || null;
  /* 그날 목록(오늘 탭·주간 탭·수면 계산이 모두 쓰는 한 곳).
     저장된 목록(없으면 기본 목록) + 그날 해당 반복 규칙 항목(같은 이름이 있거나 이 날만 지웠으면 넣지 않음, 규칙 만든 순서) */
  function dayItems(st, k) {
    const t = dayOf(st, k);
    const own = t ? t.tasks : st.base;
    const out = own.map(x => ({ n: x.n, m: x.m, done: !!x.done, bh: !!x.bh })); // bh: 집 오기 전(v13 예약, 계산에 안 씀)
    const pl = st.plan;
    if (!pl || !Array.isArray(pl.rules) || !pl.rules.length) return out;
    const names = new Set(out.map(x => x.n)), pd = planDay(pl, k), skip = (pd && pd.skip) || [], d = keyToDay(k);
    pl.rules.forEach(r => {
      if (skip.includes(r.id) || names.has(r.n) || !ruleOn(st, r, d)) return;
      names.add(r.n); out.push({ n: r.n, m: r.m, done: false, bh: false, rule: r.id });
    });
    return out;
  }
  /* 주간에 보이는 항목: 주간에서 넣은 것(w) + 반복 항목 + 「주간에 보이기」가 켜진 기본 목록 이름. 각 항목에 rule·carried 표시를 붙인다 */
  function weekItems(st, k) {
    const pl = st.plan || planDefault(), pd = planDay(pl, k) || {}, w = pd.w || [], r = pd.r || {}, cf = pd.cf || {}, wk = pl.wk || [];
    return dayItems(st, k).map(x => Object.assign(x, { rule: x.rule || r[x.n] || null, carried: cf[x.n] || null }))
      .filter(x => w.includes(x.n) || x.rule || wk.includes(x.n));
  }
  /* 이월 후보: 어제(달력 날짜) 주간 항목 중 체크 안 됨 · 반복 아님 · 이미 이월 안 함 · 오늘 같은 이름 없음. 자동으로 옮기지 않는다 */
  function carryList(st, today) {
    const names = new Set(dayItems(st, dayToKey(today)).map(x => x.n));
    return weekItems(st, dayToKey(today - 1)).filter(x => !x.done && !x.rule && !x.carried && !names.has(x.n));
  }
  /* 지난 날 주간 표시·메모 정리: 오늘 − 13일보다 앞선 날짜, 그 주 일요일이 그보다 앞선 메모(v11 days와 같은 14일 기준) */
  function prunePlan(pl, now) {
    const minD = Math.floor(now / 1440) - 13, min = dayToKey(minD);
    let n = 0;
    Object.keys(pl.days || {}).forEach(k => { if (k < min) { delete pl.days[k]; n++; } });
    Object.keys(pl.memos || {}).forEach(k => { if (keyToDay(k) + 6 < minD) { delete pl.memos[k]; n++; } });
    (pl.rules || []).slice().forEach(r => { if (r.until && r.until < min) { pl.rules.splice(pl.rules.indexOf(r), 1); n++; } });
    return n;
  }

  /* 계산 대상 = 지금 이후 가장 먼저 오는 출발 (spec 9장 해석, 사용자 확인 2026-11-23) */
  function findTarget(st, now) {
    const today = Math.floor(now / 1440);
    for (let d = today - 1; d <= today + 62; d++) {
      const k = dayToKey(d), r = st.roster[k];
      if (!r || r.s === 'off' || !SHIFTS[r.s]) continue;
      const opts = depOptions(d, r.s, r.ot, st.move, st.early);
      const sd = dayOf(st, k), saved = sd ? sd.mode : null;
      const o = opts.find(x => x.k === saved) || opts.find(x => x.k === defaultMode(r.s, r.ot));
      if (o.dep > now) return { day: d, key: k, s: r.s, ot: r.ot, opts, mode: o.k, dep: o.dep };
    }
    return null;
  }

  /* 연속 휴무 며칠째인지 (오늘이 휴무일 때) */
  function offNth(st, day) {
    let n = 0;
    while (st.roster[dayToKey(day - n)] && st.roster[dayToKey(day - n)].s === 'off') n++;
    return n;
  }

  /* 오늘 화면 계산 (spec 6장) */
  /* 진행 중인 근무: 출발이 지났고(계산 대상보다 앞선 근무일) 아직 집 도착 전 (QA-001, 11/23) */
  function inProgress(st, now, T) {
    const today = Math.floor(now / 1440);
    for (let d = today; d >= today - 1; d--) {
      if (T && d >= T.day) continue;
      const r = st.roster[dayToKey(d)];
      if (!r || r.s === 'off' || !SHIFTS[r.s]) continue;
      const home = homeArrival(d, r.s, r.ot, st.move);
      if (home > now) return { day: d, key: dayToKey(d), s: r.s, ot: r.ot, home };
    }
    return null;
  }

  function computeToday(st, now) {
    const T = findTarget(st, now);
    const today = Math.floor(now / 1440);
    const todayRec = st.roster[dayToKey(today)];
    const todayOff = !!todayRec && todayRec.s === 'off';
    const prog = inProgress(st, now, T);
    if (!T) return { type: 'none', key: 'none', now, todayOff, prog };

    // 휴무 화면은 오늘이 휴무이고 다음 출발까지 24시간 이상 남았을 때만. 근무일에는 절대 나오지 않음 (QA-001, 11/23)
    const offScreen = todayOff && T.dep - now >= 1440;
    // 상태 키: 근무일 계산은 근무 시작 날짜(T.key), 휴무 화면은 오늘 날짜(v11). v10 형식이면 둘 다 T.key
    const key = offScreen && st.days ? dayToKey(today) : T.key;
    const t = dayOf(st, key);
    const tasks = dayItems(st, key);
    const total = sumM(tasks);
    const meal = t ? t.meal : 60, eat = t ? !!t.eat : false;
    const base = { key, now, today, todayOff, offN: todayOff ? offNth(st, today) : 0, total, target: T, prog, tasks };

    if (offScreen) {
      const y = st.roster[dayToKey(today - 1)];
      const home = y && y.s === 'C' ? homeArrival(today - 1, 'C', y.ot, st.move) : null;
      const bed = home != null ? Math.max(now, home) : now; // 잠들기 = max(지금, 집 도착)
      const wakeClock = t && t.wake != null ? t.wake : (home != null ? 15 * 60 : 10 * 60);
      let wake = Math.floor(bed / 1440) * 1440 + wakeClock;
      while (wake < bed + 30) wake += 1440;
      return Object.assign(base, {
        type: 'off', home, bed, wakeClock, wake, end: wake + total, sleep: wake - bed,
        rest: t ? !!t.rest : false,
      });
    }

    /* 근무일 계산 (spec 6장)
       집 도착: 대상 근무의 전날이 C조면 그 C조의 집 도착(근무조와 무관 — 연차·대근으로 C조 다음 날이 A·B조인 날 포함).
       그 밖에 진행 중인 근무가 있으면 그 근무의 집 도착(근무 중 시간을 잠으로 세지 않음, QA-001). 자기 전 밥은 전날 C조일 때만
       잠들기: 전날 C조(「집에 오면」 선택지가 있는 날)는 바로 자기 = 집 도착, 밥 먹고 자기 = 집 도착 + 밥으로 고정 (QA-004, v8).
       지금이 그 시각을 지났고 기상 전이면 nowSleep(지금 자면)을 따로 준다(기상 이후면 null). 그 밖의 날은 max(지금, 집 도착), 집 도착이 없으면 지금 */
    const p = st.roster[dayToKey(T.day - 1)];
    const prevC = !!p && p.s === 'C';
    const home = prevC ? homeArrival(T.day - 1, 'C', p.ot, st.move) : prog ? prog.home : null;
    const bed = prevC ? home + (eat ? meal : 0) : home != null ? Math.max(now, home) : now;
    const wake = T.dep - total;
    // 「지금 자면」: 지금이 잠들기 시각을 지났고 (기상 − 지금) > 0일 때만. 기상 이후면 숨김(부족 표시 없음)
    const late = now > bed && wake - now > 0;
    const S = SHIFTS[T.s];
    return Object.assign(base, {
      type: 'work', prevC, home, eat, meal, bed, wake, sleep: wake - bed, late, nowSleep: late ? wake - now : null,
      dep: T.dep, mode: T.mode, opts: T.opts, early: earlyFor(T.ot, st.early),
      start: workStart(T.day, T.s, T.ot), shiftStart: T.day * 1440 + S.start,
      end: workEnd(T.day, T.s, T.ot), bus: T.day * 1440 + S.bus,
      homeAfter: homeArrival(T.day, T.s, T.ot, st.move),
    });
  }

  /* 일주일 슬라이드(v11): 오늘이 아닌 날짜 d의 페이지 계산 (spec 6-1장)
     근무일 = 그날 근무. 잠들기는 전날 C조일 때만 집 도착(+밥) 고정, 그 밖은 기준 없음(sleep null → 「그날이 되면 보여요」)
     휴무 = 휴무 화면. 전날 C조면 집 도착부터, 아니면 기준 없음. 「지금」은 쓰지 않는다 */
  function nextWork(st, d) {
    for (let x = d + 1; x <= d + 62; x++) {
      const r = st.roster[dayToKey(x)];
      if (r && SHIFTS[r.s]) return { day: x, key: dayToKey(x), s: r.s, ot: r.ot };
    }
    return null;
  }
  function computeDay(st, now, d) {
    const key = dayToKey(d), r = st.roster[key], today = Math.floor(now / 1440);
    const common = { key, day: d, now, today, future: true, prog: null, late: false, nowSleep: null };
    if (!r || !(r.s === 'off' || SHIFTS[r.s])) return Object.assign(common, { type: 'none' });
    const t = st.days ? st.days[key] || null : null;
    const tasks = dayItems(st, key), total = sumM(tasks);
    const p = st.roster[dayToKey(d - 1)], prevC = !!p && p.s === 'C';
    const home = prevC ? homeArrival(d - 1, 'C', p.ot, st.move) : null;
    if (r.s === 'off') {
      const wakeClock = t && t.wake != null ? t.wake : (home != null ? 15 * 60 : 10 * 60);
      let wake;
      if (home != null) { wake = Math.floor(home / 1440) * 1440 + wakeClock; while (wake < home + 30) wake += 1440; }
      else wake = d * 1440 + wakeClock;
      return Object.assign(common, {
        type: 'off', todayOff: true, offN: offNth(st, d), target: nextWork(st, d), tasks, total,
        home, bed: home, wakeClock, wake, end: wake + total, sleep: home != null ? wake - home : null, rest: t ? !!t.rest : false,
      });
    }
    const opts = depOptions(d, r.s, r.ot, st.move, st.early);
    const saved = t ? t.mode : null;
    const o = opts.find(x => x.k === saved) || opts.find(x => x.k === defaultMode(r.s, r.ot));
    const T = { day: d, key, s: r.s, ot: r.ot, opts, mode: o.k, dep: o.dep };
    const meal = t ? t.meal : 60, eat = t ? !!t.eat : false;
    const bed = prevC ? home + (eat ? meal : 0) : null;
    const wake = T.dep - total, S = SHIFTS[r.s];
    return Object.assign(common, {
      type: 'work', todayOff: false, offN: 0, target: T, tasks, total, prevC, home, eat, meal, bed, wake,
      sleep: bed != null ? wake - bed : null,
      dep: T.dep, mode: T.mode, opts, early: earlyFor(r.ot, st.early),
      start: workStart(d, r.s, r.ot), shiftStart: d * 1440 + S.start,
      end: workEnd(d, r.s, r.ot), bus: d * 1440 + S.bus, homeAfter: homeArrival(d, r.s, r.ot, st.move),
    });
  }

  /* v10 → v11 저장 이전: today(계산 대상 근무 키 하나) → days[today.key]. 할 일에 done:false.
     v10 휴무 화면 상태는 다음 근무 키에 있었으므로, 지금 오늘 화면이 그 휴무 화면이면 오늘 날짜 키에도 복사(친구 화면 그대로 유지).
     st를 직접 바꾸고, 옮긴 것이 있으면 true */
  function migrateToday(st, now) {
    if (!st.days || typeof st.days !== 'object') st.days = {};
    const old = st.today;
    delete st.today;
    if (!old || typeof old.key !== 'string' || !Array.isArray(old.tasks)) return false;
    const conv = () => ({
      tasks: old.tasks.map(x => ({ n: x.n, m: x.m, done: false, bh: false })),
      removed: Array.isArray(old.removed) ? old.removed.map(x => ({ n: x.n, m: x.m })) : [],
      mode: old.mode == null ? null : old.mode, eat: !!old.eat, meal: Number.isFinite(old.meal) ? old.meal : 60,
      rest: !!old.rest, wake: old.wake == null ? null : old.wake,
    });
    if (!st.days[old.key]) st.days[old.key] = conv();
    const v = computeToday(Object.assign({}, st, { days: null, today: old }), now);
    const tk = dayToKey(Math.floor(now / 1440));
    if (v.type === 'off' && v.target && v.target.key === old.key && !st.days[tk]) st.days[tk] = conv();
    return true;
  }
  /* 지난 날짜 정리: 오늘 − 13일보다 앞선 키를 지운다(사용 기록과 같은 14일 기준). 지운 개수 */
  function pruneDays(st, now) {
    const min = dayToKey(Math.floor(now / 1440) - 13);
    let n = 0;
    Object.keys(st.days || {}).forEach(k => { if (k < min) { delete st.days[k]; n++; } });
    return n;
  }

  const api = {
    SHIFTS, OT_MIN, RANGE_START, RANGE_END, ANCHOR, ORDER, CYCLE,
    keyToDay, dayToKey, nowAbs, fmt, dur, fillRoster, defaultRoster, earlyFor, defaultMode,
    depOptions, homeArrival, workStart, workEnd, findTarget, offNth, inProgress, computeToday,
    dayOf, sumM, nextWork, computeDay, migrateToday, pruneDays,
    PLAN_WK, planDefault, weekday, weekStart, weekLabel, ruleOn, dayItems, weekItems, carryList, prunePlan,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
