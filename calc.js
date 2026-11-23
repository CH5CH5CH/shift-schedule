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
  const OT_MIN = 180;
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

  /* 일찍 나가기 적용 여부: 전OT 날(회사로 직접 가는 날)은 항상, 그 밖은 「모든 날」일 때만 */
  const earlyFor = (ot, early) => (ot === 'pre' || early.sc === 'all') ? early.m : 0;
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
  /* 집 도착 = 퇴근버스 + 70분. 후OT 날은 (근무 끝 + 3시간) + 50분 */
  function homeArrival(day, s, ot, move) {
    const S = SHIFTS[s], b = day * 1440;
    return ot === 'post' ? b + S.end + OT_MIN + move.car : b + S.back + move.ride;
  }
  function workStart(day, s, ot) { return day * 1440 + SHIFTS[s].start - (ot === 'pre' ? OT_MIN : 0); }
  function workEnd(day, s, ot) { return day * 1440 + SHIFTS[s].end + (ot === 'post' ? OT_MIN : 0); }

  /* 계산 대상 = 지금 이후 가장 먼저 오는 출발 (spec 9장 해석, 사용자 확인 2026-11-23) */
  function findTarget(st, now) {
    const today = Math.floor(now / 1440);
    for (let d = today - 1; d <= today + 62; d++) {
      const k = dayToKey(d), r = st.roster[k];
      if (!r || r.s === 'off' || !SHIFTS[r.s]) continue;
      const opts = depOptions(d, r.s, r.ot, st.move, st.early);
      const saved = st.today && st.today.key === k ? st.today.mode : null;
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

    const t = st.today && st.today.key === T.key ? st.today : null;
    const tasks = t ? t.tasks : st.base;
    const total = tasks.reduce((a, x) => a + x.m, 0);
    const meal = t ? t.meal : 60, eat = t ? !!t.eat : false;
    const base = { key: T.key, now, today, todayOff, offN: todayOff ? offNth(st, today) : 0, total, target: T, prog };

    // 휴무 화면은 오늘이 휴무이고 다음 출발까지 24시간 이상 남았을 때만. 근무일에는 절대 나오지 않음 (QA-001, 11/23)
    if (todayOff && T.dep - now >= 1440) {
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

    /* 근무일 계산. 잠들기 = max(지금, 집 도착 + 자기 전 밥) (spec 6장, 11/23 통일)
       집 도착: 대상 근무의 전날이 C조면 그 C조의 집 도착(근무조와 무관 — 연차·대근으로 C조 다음 날이 A·B조인 날 포함).
       그 밖에 진행 중인 근무가 있으면 그 근무의 집 도착(근무 중 시간을 잠으로 세지 않음, QA-001). 자기 전 밥은 전날 C조일 때만 */
    const p = st.roster[dayToKey(T.day - 1)];
    const prevC = !!p && p.s === 'C';
    const home = prevC ? homeArrival(T.day - 1, 'C', p.ot, st.move) : prog ? prog.home : null;
    const bed = home != null ? Math.max(now, home + (prevC && eat ? meal : 0)) : now;
    const wake = T.dep - total;
    const S = SHIFTS[T.s];
    return Object.assign(base, {
      type: 'work', prevC, home, eat, meal, bed, wake, sleep: wake - bed,
      dep: T.dep, mode: T.mode, opts: T.opts, early: earlyFor(T.ot, st.early),
      start: workStart(T.day, T.s, T.ot), shiftStart: T.day * 1440 + S.start,
      end: workEnd(T.day, T.s, T.ot), bus: T.day * 1440 + S.bus,
      homeAfter: homeArrival(T.day, T.s, T.ot, st.move),
    });
  }

  const api = {
    SHIFTS, OT_MIN, RANGE_START, RANGE_END, ANCHOR, ORDER, CYCLE,
    keyToDay, dayToKey, nowAbs, fmt, dur, fillRoster, defaultRoster, earlyFor, defaultMode,
    depOptions, homeArrival, workStart, workEnd, findTarget, offNth, inProgress, computeToday,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
