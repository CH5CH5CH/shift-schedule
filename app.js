/* 교대근무 일정 — 화면 (오늘 · 근무표 · 할 일) */
(function () {
  'use strict';
  const C = window.ShiftCalc, fmt = C.fmt, dur = C.dur;
  const KEY = 'shift-schedule';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (a, n) => ((a % n) + n) % n;

  const PRESET_T = [10, 20, 30, 45, 60, 90, 120, 180];
  const PRESET_M = [10, 15, 20, 25, 30, 40, 50, 60];
  const WAKES = [9, 10, 11, 12, 13, 14, 15, 16].map(h => h * 60);
  const PHRASES = ['오늘은 쉬어요~', '오늘은 푹 자요~', '알람 없는 날', '아무것도 안 정해도 괜찮아요', '천천히 일어나요', '달도 쉬어 가는 날'];
  const THEMES = [['p0', '오로라 퍼플'], ['p1', '봄 핑크'], ['p2', '샴페인 문라이트']];
  const W = '일월화수목금토';
  const NAME_MAX = 10;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GRIP = '<button class="grip hit" aria-label="끌어서 순서 바꾸기"><svg viewBox="0 0 14 14"><g fill="currentColor"><circle cx="4.5" cy="3" r="1.3"/><circle cx="9.5" cy="3" r="1.3"/><circle cx="4.5" cy="7" r="1.3"/><circle cx="9.5" cy="7" r="1.3"/><circle cx="4.5" cy="11" r="1.3"/><circle cx="9.5" cy="11" r="1.3"/></g></svg></button>';

  /* ───────── 저장 ───────── */
  function defaults() {
    return {
      v: 1,
      roster: C.defaultRoster(),
      base: [{ n: '잠 깨기', m: 20, bh: false }, { n: '공부', m: 60, bh: false }, { n: '헬스', m: 120, sub: '이동 포함', bh: false }, { n: '밥', m: 60, bh: false }],
      tpl: [{ n: '공부 준비', m: 10 }, { n: '홈트', m: 60 }, { n: '씻기', m: 20 }, { n: '자유시간', m: 30 }, { n: '장보기', m: 30 }],
      move: { bus: 40, taxi: 20, car: 50, ride: 70 },
      early: { m: 40, sc: 'ot' },
      theme: { c: 'p2', d: 'd' },
      days: {}, // 날짜 키별 할 일·이동수단·밥·휴무 옵션(v11). 손대지 않은 날은 없음
      usage: [], // 오늘 탭이 화면에 보인 날짜(YYYY-MM-DD), 최근 14일만. 서버 전송 없음
    };
  }
  const isList = a => Array.isArray(a) && a.every(x => x && typeof x.n === 'string' && Number.isFinite(x.m));
  /* v11 날짜별 상태: 항목 이름, 시간(분, 선택), 순서(배열 순서), 체크 상태(done — 화면은 아직 없음) */
  const isTask = x => x && typeof x.n === 'string' && (x.m === undefined || Number.isFinite(x.m));
  function readDays(d) {
    const out = {};
    if (!d || typeof d !== 'object') return out;
    Object.keys(d).forEach(k => {
      const v = d[k];
      if (!isDayKey(k) || !v || !Array.isArray(v.tasks) || !v.tasks.every(isTask)) return;
      out[k] = {
        tasks: v.tasks.map(x => ({ n: x.n, m: x.m, done: !!x.done, bh: !!x.bh })), // bh: 집 오기 전(v13 예약, 아직 안 씀)
        removed: Array.isArray(v.removed) ? v.removed.filter(isTask).map(x => ({ n: x.n, m: x.m })) : [],
        mode: typeof v.mode === 'string' ? v.mode : null, eat: !!v.eat, meal: Number.isFinite(v.meal) ? v.meal : 60,
        rest: !!v.rest, wake: Number.isFinite(v.wake) ? v.wake : null,
      };
    });
    return out;
  }
  const isDayKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
  /* 데이터 보존 원칙 3번: 읽지 못한 저장값은 지우지 않고 다른 키에 백업한 뒤 기본값으로 시작 */
  let backedUp = '', migrated = false;
  function backup(raw, notify = true) { // notify=false: v11 이전용 백업(읽기 실패가 아니므로 안내 문구를 띄우지 않음)
    const n = new Date(), p = x => String(x).padStart(2, '0');
    const k = `${KEY}-backup-${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
    try { localStorage.setItem(k, raw); if (notify) backedUp = k; } catch (e) { if (notify) backedUp = ''; }
  }
  function load() {
    const d = defaults();
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return d; }
    if (raw == null) return d;
    let s = null;
    try { s = JSON.parse(raw); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || s.v !== 1) { backup(raw); return d; }
    try {
      const o = {
        v: 1,
        roster: Object.assign(d.roster, s.roster && typeof s.roster === 'object' ? s.roster : {}),
        base: (isList(s.base) ? s.base : d.base).map(x => Object.assign({}, x, { bh: !!x.bh })), // bh: 집 오기 전(v13 예약)
        tpl: isList(s.tpl) ? s.tpl : d.tpl,
        move: Object.assign(d.move, s.move),
        early: Object.assign(d.early, s.early), // v12: 계산에 쓰지 않음(일찍 나가기 삭제). 롤백 대비로 값은 보존
        theme: Object.assign(d.theme, s.theme),
        days: readDays(s.days),
        // v10 형식 오늘 상태 — 아래에서 days로 옮기고 지운다(저장 형식 번호는 1 그대로, 롤백 호환)
        today: s.today && isList(s.today.tasks) ? Object.assign({ removed: [] }, s.today) : null,
        usage: Array.isArray(s.usage) ? s.usage.filter(isDayKey) : [],
      };
      const now = C.nowAbs(new Date());
      if (o.today) { backup(raw, false); migrated = C.migrateToday(o, now); } else delete o.today;
      if (C.pruneDays(o, now)) migrated = true;
      return o;
    } catch (e) { backup(raw); return d; }
  }
  let saveFailed = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); saveFailed = false; }
    catch (e) { saveFailed = true; }
  }
  const S = load();
  if (migrated) save(); // 이전·정리 결과를 바로 저장(원본은 백업 키에 있음)

  /* v12 플래너 저장: 반복 규칙·주간 메모·날짜별 주간 표시는 별도 키(PKEY). v11은 이 키를 읽지도 쓰지도 않아 롤백했다 돌아와도 남는다.
     본 키(days)에는 v11이 읽는 칸(이름·시간·체크)만 둔다. 같은 날 같은 이름은 하나뿐이라 (날짜, 이름)으로 항목을 구분 */
  const PKEY = KEY + '-plan';
  const isStrArr = a => Array.isArray(a) && a.every(x => typeof x === 'string');
  function loadPlan() {
    const d = C.planDefault();
    let raw = null;
    try { raw = localStorage.getItem(PKEY); } catch (e) { return d; }
    if (raw == null) return d;
    let s = null;
    try { s = JSON.parse(raw); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || s.v !== 1) { backup(raw); return d; }
    const KINDS = ['daily', 'wd', 'work', 'off'];
    d.rules = Array.isArray(s.rules) ? s.rules.filter(r => r && typeof r.id === 'string' && typeof r.n === 'string' && KINDS.includes(r.kind) && isDayKey(r.from) && (r.until == null || isDayKey(r.until)) && (r.m === undefined || Number.isFinite(r.m)))
      .map(r => ({ id: r.id, n: r.n, m: r.m, kind: r.kind, wd: Array.isArray(r.wd) ? r.wd.filter(x => x >= 1 && x <= 7) : [], from: r.from, until: r.until || null })) : [];
    if (s.memos && typeof s.memos === 'object') Object.keys(s.memos).forEach(k => { if (isDayKey(k) && typeof s.memos[k] === 'string') d.memos[k] = s.memos[k]; });
    if (s.days && typeof s.days === 'object') Object.keys(s.days).forEach(k => {
      const v = s.days[k]; if (!isDayKey(k) || !v || typeof v !== 'object') return;
      const obj = o => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
      d.days[k] = { w: isStrArr(v.w) ? v.w : [], r: obj(v.r), cf: obj(v.cf), skip: isStrArr(v.skip) ? v.skip : [] };
    });
    if (isStrArr(s.wk)) d.wk = s.wk;
    if (s.ui && (s.ui.week === 'week' || s.ui.week === 'day')) d.ui.week = s.ui.week;
    return d;
  }
  const PL = loadPlan();
  function savePlan() { try { localStorage.setItem(PKEY, JSON.stringify(PL)); } catch (e) { saveFailed = true; } }
  if (C.prunePlan(PL, C.nowAbs(new Date()))) savePlan();
  const ST = () => Object.assign({}, S, { plan: PL }); // 계산에 넘기는 상태(본 저장값 + 플래너)
  const pmark = k => PL.days[k] || (PL.days[k] = { w: [], r: {}, cf: {}, skip: [] });
  function unmark(k, n) { const m = PL.days[k]; if (!m) return; m.w = m.w.filter(x => x !== n); delete m.r[n]; }
  const hasName = (k, n) => C.dayItems(ST(), k).some(x => x.n === n);
  /* 그날을 바꾸는 순간: 지금 보이는 목록(기본 목록 + 반복 항목) 그대로 저장한 뒤 바꾼다. 이미 저장된 날도 새 반복 항목을 같은 순서로 붙인다 */
  function dayEdit(k) {
    const items = C.dayItems(ST(), k);
    if (!S.days[k]) S.days[k] = { tasks: [], removed: [], mode: null, eat: false, meal: 60, rest: false, wake: null };
    const t = S.days[k], have = new Set(t.tasks.map(x => x.n));
    items.forEach(x => {
      if (have.has(x.n)) return;
      have.add(x.n); t.tasks.push({ n: x.n, m: x.m, done: !!x.done, bh: !!x.bh });
      if (x.rule) pmark(k).r[x.n] = x.rule;
    });
    return t;
  }
  /* 그날에서 항목 빼기(어느 화면이든 같은 규칙): 반복 항목이면 그날만 건너뛰게 skip에 넣고, 시간 있는 항목은 오늘 탭 「다시 넣기」 칩에 남긴다 */
  function removeItem(k, n) {
    const t = dayEdit(k), i = t.tasks.findIndex(x => x.n === n); if (i < 0) return null;
    const it = t.tasks.splice(i, 1)[0], rid = PL.days[k] && PL.days[k].r[n];
    if (rid) { const m = pmark(k); if (!m.skip.includes(rid)) m.skip.push(rid); }
    if (Number.isFinite(it.m)) t.removed.push({ n: it.n, m: it.m });
    unmark(k, n);
    return it;
  }
  /* 같은 날 같은 이름은 어떤 경로로든 넣지 않는다(사용자 결정 11/24) — 넣었으면 true */
  function addItem(k, it, weekly) {
    if (hasName(k, it.n)) return false;
    dayEdit(k).tasks.push({ n: it.n, m: it.m, done: false, bh: false });
    if (weekly) { const m = pmark(k); if (!m.w.includes(it.n)) m.w.push(it.n); }
    return true;
  }

  /* ───────── 테마 ───────── */
  function applyTheme() {
    const t = S.theme.c + S.theme.d;
    document.documentElement.dataset.theme = t;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg1').trim();
    const meta = $('meta[name=theme-color]'); if (meta && bg) meta.content = bg;
  }

  /* ───────── 바텀시트 (한 번에 하나) ───────── */
  const sheet = $('#sheet');
  let onSheetClose = null;
  function openSheet(html, onClick, onClose) {
    if (onSheetClose) { const f = onSheetClose; onSheetClose = null; f(); }
    sheet.innerHTML = '<div class="grab"></div>' + html;
    sheet.onclick = onClick; onSheetClose = onClose || null;
    sheet.scrollTop = 0;
    requestAnimationFrame(() => sheet.classList.add('show'));
  }
  function setSheet(html) { sheet.innerHTML = '<div class="grab"></div>' + html; }
  function closeSheet() {
    sheet.classList.remove('show');
    if (onSheetClose) { const f = onSheetClose; onSheetClose = null; f(); }
  }
  const sheetOpen = () => sheet.classList.contains('show');

  /* 시간 고르기 시트: 프리셋 한 번 누르면 바로 적용·닫힘, ±는 미세 조정 */
  function timeSheet({ title, val, presets, step = 5, min = 5, max = 720, show = dur, wrap = false, onChange }) {
    let v = val;
    const draw = () => setSheet(`<h3>${esc(title)}</h3><div class="tsv num">${show(v)}</div>
      <div class="label">자주 쓰는 시간 · 누르면 바로 적용</div>
      <div class="opts tsp">${presets.map((m, i) => `<button data-i="${i}" class="num${m === v ? ' on' : ''}">${show(m)}</button>`).join('')}</div>
      <div class="fine"><button data-d="-1">− ${step}분</button><span>${step}분씩 조정</span><button data-d="1">+ ${step}분</button></div>
      <button class="close" data-x>완료</button>`);
    const set = nv => { v = wrap ? mod(nv, 1440) : clamp(nv, min, max); onChange(v); draw(); };
    openSheet('', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.i != null) { set(presets[+b.dataset.i]); setTimeout(closeSheet, 180); }
      else if (b.dataset.d) set(v + step * +b.dataset.d);
      else if (b.hasAttribute('data-x')) closeSheet();
    });
    draw();
  }

  /* ───────── 끌어서 순서 바꾸기 (⠿ 손잡이) ───────── */
  let dragging = false;
  const moveItem = (a, f, t) => a.splice(t, 0, a.splice(f, 1)[0]);
  /* 시간 있는 항목끼리만 순서 바꾸기(f·t는 시간표에 보이는 순서). 시간 없는 항목은 제자리 */
  function moveTimed(list, f, t) {
    const idx = list.map((x, i) => (Number.isFinite(x.m) ? i : -1)).filter(i => i >= 0), timed = idx.map(i => list[i]);
    moveItem(timed, f, t);
    idx.forEach((i, j) => { list[i] = timed[j]; });
  }
  function sortable(list, itemSel, onMove) {
    $$(itemSel + ' .grip', list).forEach(g => {
      g.onclick = e => e.stopPropagation();
      g.onpointerdown = e => {
        if (e.button > 0) return;
        e.preventDefault();
        const items = $$(itemSel, list), it = g.closest(itemSel), from = items.indexOf(it);
        const rects = items.map(x => x.getBoundingClientRect()), y0 = e.clientY, h = rects[from].height;
        let to = from;
        try { g.setPointerCapture(e.pointerId); } catch (_) {}
        dragging = true; it.classList.add('dragging'); list.classList.add('sorting');
        const trk = list.closest('.dtrack'); if (trk) trk.classList.add('lock'); // 손잡이에서 시작한 드래그는 넘기기 금지(v11)
        g.onpointermove = ev => {
          const dy = ev.clientY - y0;
          it.style.transform = `translateY(${dy}px) scale(1.02)`;
          const c = rects[from].top + h / 2 + dy; to = from;
          items.forEach((x, i) => {
            if (i === from) return;
            const m = rects[i].top + rects[i].height / 2;
            if (i > from && c > m) to = Math.max(to, i);
            if (i < from && c < m) to = Math.min(to, i);
          });
          items.forEach((x, i) => {
            if (i === from) return;
            let s = 0;
            if (from < to && i > from && i <= to) s = -h;
            if (from > to && i < from && i >= to) s = h;
            x.style.transform = s ? `translateY(${s}px)` : '';
          });
        };
        const end = () => {
          g.onpointermove = g.onpointerup = g.onpointercancel = null;
          dragging = false;
          items.forEach(x => (x.style.transform = ''));
          it.classList.remove('dragging'); list.classList.remove('sorting'); if (trk) trk.classList.remove('lock');
          if (to !== from) onMove(from, to);
        };
        g.onpointerup = end; g.onpointercancel = end;
      };
    });
  }

  /* ───────── 공통 조각 ───────── */
  const md = k => { const [, m, d] = k.split('-').map(Number); return `${m}월 ${d}일`; };
  const dow = k => { const [y, m, d] = k.split('-').map(Number); return W[new Date(y, m - 1, d).getDay()]; };
  const nowAbs = () => C.nowAbs(new Date());
  function sleepHTML(v) {
    const a = Math.abs(v), h = Math.floor(a / 60), m = a % 60;
    if (v < 0) return (h ? `${h}<span>시간</span>` : '') + `${m}<span>분 부족</span>`;
    return `${h}<span>시간</span>${m}<span>분</span>`;
  }
  const durSigned = v => { const a = Math.abs(v), h = Math.floor(a / 60), m = a % 60; return v < 0 ? `${h ? h + '시간 ' : ''}${m}분 부족` : `${h}시간 ${m}분`; };
  let shown = null;
  function countSleep(el, t, animate) {
    const paint = n => { el.innerHTML = sleepHTML(n); el.classList.toggle('short', n < 0); };
    if (reduce || !animate || shown === null || shown === t) { shown = t; paint(t); return; }
    const f = shown, t0 = performance.now(); shown = t;
    const k = n => { const p = Math.min(1, (n - t0) / 600), e = 1 - Math.pow(1 - p, 3); paint(Math.round(f + (t - f) * e)); if (p < 1) requestAnimationFrame(k); };
    requestAnimationFrame(k);
  }
  function barHTML(parts) {
    const span = parts.reduce((a, p) => a + Math.max(0, p.m), 0) || 1;
    return parts.filter(p => p.m > 0).map(p => `<div class="sg ${p.cls}" style="--w:${(p.m / span * 100).toFixed(3)}%">${p.m / span < 0.07 ? '' : esc(p.txt)}</div>`).join('');
  }
  const ev = (cls, tm, tx, extra = '') => `<div class="ev ${cls}"><span class="dot"></span><span class="tm num">${tm}</span><span class="tx">${tx}</span>${extra}</div>`;
  function tasksHTML(tasks, from, freshIdx) {
    let t = from;
    return tasks.map((k, i) => {
      if (!Number.isFinite(k.m)) return ''; // 시간 없는 항목은 오늘 시간표에 보이지 않음(v12). data-i는 전체 목록 기준
      const m = k.m;
      const h = `<div class="tk${i === freshIdx ? ' new' : ''}" data-i="${i}"><span class="tm num">${fmt(t)}</span><div class="card">${GRIP}<div class="nm"><b>${esc(k.n)}</b><span class="rng num">~${fmt(t + m)}까지</span></div><div class="ctl"><button class="tpill num hit" data-act="dur" data-i="${i}">${dur(m)}</button><button class="x hit" data-act="del" data-i="${i}" aria-label="빼기">×</button></div></div></div>`;
      t += m; return h;
    }).join('');
  }
  function spareHTML(key, list) {
    const d = key ? S.days[key] : null, rm = d ? d.removed : [], names = new Set(rm.map(x => x.n)), have = new Set((list || []).map(x => x.n));
    // 이미 그날 목록에 있는 이름은 칩을 보이지 않는다(같은 날 같은 이름 금지)
    return rm.map((x, i) => have.has(x.n) || !Number.isFinite(x.m) ? '' : `<button data-act="back" data-i="${i}">+ ${esc(x.n)} ${dur(x.m)}</button>`).join('')
      + S.tpl.map((x, i) => names.has(x.n) || have.has(x.n) ? '' : `<button data-act="tpl" data-i="${i}">+ ${esc(x.n)} ${dur(x.m)}</button>`).join('')
      + '<button class="addbtn" data-act="add">+ 새 할 일</button>';
  }

  /* ───────── ① 오늘 (v11: 오늘~6일 뒤 7페이지) ───────── */
  // 페이지 0 = #today(오늘 페이지, v10과 같은 계산). 1~6 = 미래 날짜(C.computeDay). spec 6-1장
  const DAYS = 7;
  const todayEl = $('#today'), todayView = todayEl.closest('.view'), restfx = $('#restfx');
  const dtrack = $('#dtrack'), ddots = $('#ddots');
  for (let i = 1; i < DAYS; i++) { const p = document.createElement('div'); p.className = 'screen dpage'; p.dataset.i = i; dtrack.appendChild(p); }
  const pageEls = $$('.dpage', dtrack);
  ddots.innerHTML = pageEls.map((_, i) => `<i data-i="${i}"></i>`).join('');
  let fresh = { page: -1, idx: -1 }, lastVM = null, pages = [], curPage = 0;

  /* 사용 기록: 오늘 탭이 화면에 보인 날만, 최근 14일 보관 */
  function recordUse() {
    if (document.hidden || document.getElementById('app').dataset.tab !== 'today') return;
    const d = Math.floor(nowAbs() / 1440), k = C.dayToKey(d), min = C.dayToKey(d - 13);
    const u = S.usage.filter(x => x >= min && x <= k);
    if (!u.includes(k)) u.push(k);
    u.sort();
    if (u.join() !== S.usage.join()) { S.usage = u; save(); }
  }
  function usedDays7() {
    const d = Math.floor(nowAbs() / 1440), from = C.dayToKey(d - 6), to = C.dayToKey(d);
    return S.usage.filter(x => x >= from && x <= to).length;
  }

  /* 페이지 계산: 오늘 = computeToday. 오늘 페이지가 이미 계산 중인 근무의 날짜면 같은 숫자(②), 그 밖은 computeDay */
  function computePages() {
    const now = nowAbs(), today = Math.floor(now / 1440);
    const v0 = C.computeToday(ST(), now);
    return pageEls.map((_, i) => {
      const d = today + i, date = C.dayToKey(d);
      let vm, dup = false;
      if (i === 0) vm = v0;
      else if (v0.type === 'work' && v0.target.key === date) { vm = v0; dup = true; }
      else vm = C.computeDay(ST(), now, d);
      // 상태 키: 근무 계산은 근무 시작 날짜, 휴무 화면은 그 페이지 날짜(오늘 페이지는 오늘), 없음은 null
      const key = vm.type === 'work' ? vm.target.key : vm.type === 'off' ? vm.key : null;
      return { i, d, date, vm, dup, key, isToday: i === 0 };
    });
  }

  const REL = ['오늘', '내일', '모레'];
  function dheadHTML(P) {
    return `<div class="month dhead a1"><h2 class="num" data-dtitle>${md(P.date)} (${dow(P.date)})${REL[P.i] ? `<span class="rel"> · ${REL[P.i]}</span>` : ''}</h2>${P.isToday ? '' : '<button class="golink" data-act="gotoday">오늘로</button>'}</div>`;
  }

  function renderToday(animate = true) {
    recordUse();
    pages = computePages();
    lastVM = pages[0].vm;
    pages.forEach(P => {
      const el = pageEls[P.i], v = P.vm;
      let h = dheadHTML(P);
      if (v.type === 'none') {
        if (P.isToday) h += `<div class="head a1"><div><div class="label num">${v.prog ? `근무 중 · 집 도착 ${fmt(v.prog.home)}` : `지금 ${fmt(v.now)}`}</div><div class="shift">다음 근무가 없어요</div></div><button class="golink" data-act="roster">근무·OT 바꾸기 ›</button></div>
        <div class="glass hero a2 empty"><b>근무표에 다음 근무가 없어요</b><span class="label">근무표 탭에서 근무조를 채우면 여기서 잘 수 있는 시간을 계산해요.</span></div>`;
        else h += `<div class="glass hero a2 empty"><b>이 날은 근무표에 없어요</b><span class="label">근무표는 2026년 11월 ~ 2027년 6월이에요.</span></div>`;
        el.innerHTML = h; return;
      }
      h += v.type === 'off' ? offHTML(v, P) : workHTML(v, P);
      el.innerHTML = h;
      const big = $('[data-sleep]', el);
      if (big) { if (P.isToday) countSleep(big, v.sleep, animate); else big.innerHTML = sleepHTML(v.sleep); big.classList.toggle('short', v.sleep < 0); }
      const tt = $('.tt', el);
      if (tt) sortable(tt, '.tk', (f, t) => { moveTimed(dayEdit(P.key).tasks, f, t); save(); savePlan(); renderToday(); });
    });
    fresh = { page: -1, idx: -1 };
    applyPage(pendingPage != null ? curPage : pageFromScroll());
  }

  /* 넘기기(QA-007, v12): 현재 페이지 번호는 스크롤이 멈춘 뒤 반올림한 값 한 곳(applyPage)에서만 정하고, 점 7개는 그 값으로 매번 다시 그린다.
     점·「오늘로」로 이동할 때는 스크롤만 요청하고, 목표에 닿을 때까지(최대 1.5초) 중간 페이지를 확정하지 않는다 */
  let pendingPage = null, pendingUntil = 0;
  const pageFromScroll = () => { const w = dtrack.clientWidth; return w ? clamp(Math.round(dtrack.scrollLeft / w), 0, DAYS - 1) : curPage; };
  function applyPage(i) {
    curPage = i;
    ddots.innerHTML = pageEls.map((_, k) => `<i data-i="${k}"${k === i ? ' class="on"' : ''}></i>`).join('');
    const P = pages[curPage], resting = !!P && P.vm.type === 'off' && P.vm.rest;
    todayView.classList.toggle('resting', resting);
    if (resting && !restfx.children.length) restfx.innerHTML = PHRASES.map((p, k) => `<span class="ph p${k}">${p}</span>`).join('');
    todayView.dataset.page = curPage;
    if (document.getElementById('app').dataset.tab === 'today' && pageEls[curPage]) document.getElementById('app').style.setProperty('--sy', pageEls[curPage].scrollTop);
  }
  function setPage(i) {
    i = clamp(i, 0, DAYS - 1);
    const w = dtrack.clientWidth;
    if (!w || Math.abs(dtrack.scrollLeft - i * w) < 1) { pendingPage = null; applyPage(pageFromScroll()); return; }
    pendingPage = i; pendingUntil = Date.now() + 1500;
    dtrack.scrollTo({ left: i * w, behavior: reduce ? 'auto' : 'smooth' });
  }
  let dscroll;
  function settlePage() {
    const i = pageFromScroll();
    if (pendingPage != null && i !== pendingPage && Date.now() < pendingUntil) { dscroll = setTimeout(settlePage, Math.max(30, pendingUntil - Date.now())); return; }
    pendingPage = null; applyPage(i);
  }
  dtrack.addEventListener('scroll', () => { clearTimeout(dscroll); dscroll = setTimeout(settlePage, 80); }, { passive: true });
  ddots.addEventListener('click', e => { const x = e.target.closest('i'); if (x) setPage(+x.dataset.i); });

  function workHTML(v, P) {
    const T = v.target, t = P.key ? S.days[P.key] : null, tasks = v.tasks, today = P.isToday;
    const otTxt = T.ot === 'pre' ? '전OT' : T.ot === 'post' ? '후OT' : '';
    const dayWord = T.day === v.today ? '오늘' : T.day === v.today + 1 ? '내일' : md(T.key);
    let h = '';
    if (T.ot) h += `<button class="otbanner" data-act="roster"><span class="ico">OT</span><div><b>${dayWord}은 ${otTxt} 날이에요</b><small>${T.ot === 'pre'
      ? `평소보다 ${dur(C.OT_MIN)} 일찍 · ${fmt(v.start)}부터 근무 · 출근 버스 없음`
      : `평소보다 ${dur(C.OT_MIN)} 늦게 · ${fmt(v.end)}까지 근무 · 퇴근 버스 없음`}</small></div><span class="more">근무표 ›</span></button>`;
    const lab = v.future ? (v.prevC ? `${fmt(v.home)} 집 도착 · 다음 근무` : '다음 근무')
      : v.prog ? `근무 중 · 집 도착 ${fmt(v.prog.home)}` : v.prevC ? `${fmt(v.home)} 집 도착 · 다음 근무` : `지금 ${fmt(v.now)} · ${v.todayOff ? `휴무 ${v.offN}일째` : '다음 근무'}`;
    h += `<div class="head a1"><div><div class="label num">${lab}</div><div class="shift">${dayWord} ${T.s}조 · ${fmt(v.start)} 출근${otTxt ? `<span class="otbadge">${otTxt}</span>` : ''}</div></div><button class="golink" data-act="roster">근무·OT 바꾸기 ›</button></div>`;
    if (today && v.todayOff) h += `<div class="evenote a2" style="margin-top:14px"><b>근무일 계산으로 바뀌었어요</b><small>다음 출발까지 24시간이 안 남았어요 · 휴무 화면은 그 전까지</small></div>`;
    const noBed = v.sleep == null; // 미래 페이지, 전날 C조가 아님 → 잠들기 기준 없음(①)
    // 전날 C조면 잠들기는 집 도착(+밥)으로 고정(QA-004). 그 밖에 지금이 집 도착보다 늦으면 막대는 지금부터
    const fromNow = !v.prevC && (v.home == null || v.now >= v.home);
    const parts = [];
    if (!fromNow && v.prevC && v.eat) parts.push({ cls: 't', m: v.meal, txt: '밥' });
    parts.push({ cls: 's', m: v.sleep, txt: '잠' });
    tasks.forEach(k => { if (Number.isFinite(k.m)) parts.push({ cls: 't', m: k.m, txt: k.n }); });
    h += `<div class="glass hero a2"><div class="label">${today ? '오늘 잘 수 있는 시간' : '잘 수 있는 시간'}</div>${noBed ? '<p class="label dwait" data-sleepwait>잘 수 있는 시간은 그날이 되면 보여요</p>' : '<div class="big num" data-sleep></div>'}
      <div class="pair"><div class="pill wake"><small>일어나기</small><b class="num" data-wake>${!noBed && v.sleep < 0 ? '—' : fmt(v.wake)}</b></div><div class="pill"><small>집에서 출발</small><b class="num" data-dep>${fmt(v.dep)}</b></div></div>
      ${noBed ? '' : `<div class="bar">${barHTML(parts)}</div><div class="ticks num"><span>${fromNow ? '지금 ' + fmt(v.now) : '집 도착 ' + fmt(v.home)}</span><span>출발 ${fmt(v.dep)}</span></div>`}</div>`;
    if (today && v.prevC && v.nowSleep > 0) h += `<p class="nowline label num a2" data-nowsleep>지금 자면 ${durSigned(v.nowSleep)}</p>`;
    if (v.prevC) h += `<div class="sec a3"><span class="label">집에 오면</span><div class="seg glass">${[[0, '바로 자기', fmt(v.home)], [1, '밥 먹고 자기', fmt(v.home + v.meal)]]
      .map(([k, l, tm]) => `<button data-act="eat" data-k="${k}" class="${+v.eat === k ? 'on' : ''}">${l}<small class="num">${tm} 잠들기</small></button>`).join('')}</div></div>`;
    h += `<div class="sec a3"><span class="label">${today ? '오늘 어떻게 가요?' : '어떻게 가요?'}</span><div class="seg glass">${v.opts
      .map(o => `<button data-act="mode" data-k="${o.k}" class="${o.k === v.mode ? 'on' : ''}">${o.label}<small class="num">${fmt(o.dep)} 출발</small></button>`).join('')}</div></div>`;
    // 시간표
    let tt = '';
    if (v.home != null) tt += ev('', fmt(v.home), `집 도착<small>${v.prevC ? 'C' : v.prog.s}조 퇴근</small>`);
    if (v.prevC) {
      if (v.eat) tt += ev('meal', fmt(v.home), `밥 먹기<small>~${fmt(v.home + v.meal)}까지</small>`, `<button class="tpill num hit" data-act="meal">${dur(v.meal)}</button>`);
    }
    if (!noBed) tt += ev('', fmt(v.bed), `잠들기<small>${v.sleep > 0 ? dur(v.sleep) + ' 자요' : ''}</small>`);
    tt += ev('key', !noBed && v.sleep < 0 ? '—' : fmt(v.wake), '일어나기');
    tt += tasksHTML(tasks, v.wake, fresh.page === P.i ? fresh.idx : -1);
    const how = { bus: '시내버스로', taxi: T.ot === 'pre' ? '택시로 회사까지' : '택시로', car: '차로 회사까지' }[v.mode];
    tt += ev('key', fmt(v.dep), `집에서 출발<small>${how}</small>`);
    if (v.mode !== 'car' && T.ot !== 'pre') tt += ev('', fmt(v.bus), '통근버스 타기');
    if (T.ot === 'pre') tt += ev('ot', fmt(v.start), `<b>전OT 시작</b><small>${T.s}조 근무는 ${fmt(v.shiftStart)}부터</small>`);
    else tt += ev('', fmt(v.start), `${T.s}조 근무 시작`);
    if (T.ot === 'post') tt += ev('ot', fmt(v.end), `<b>후OT 끝</b><small>${T.s}조 근무는 ${fmt(v.end - C.OT_MIN)}까지</small>`);
    const nextDay = Math.floor(v.homeAfter / 1440) > T.day;
    tt += ev('home', fmt(v.homeAfter), `집 도착<small>${T.ot === 'post' ? '택시·차로' : '퇴근버스로'}${nextDay ? ' · 다음 날' : ''}</small>`);
    h += `<div class="sec a4"><div class="sec-t"><span class="label">${today ? '오늘 시간표' : '시간표'}</span><span class="hint">⠿ 끌어서 순서 · 시간 눌러 변경</span></div>
      <div class="glass tt">${tt}</div><div class="spare">${spareHTML(P.key, v.tasks)}</div></div>`;
    return h;
  }

  function offHTML(v, P) {
    const T = v.target, tasks = v.tasks, today = P.isToday;
    const lab = v.future ? `${v.home != null ? fmt(v.home) + ' 집 도착 · ' : ''}휴무 ${v.offN}일째`
      : v.prog ? `근무 중 · 집 도착 ${fmt(v.prog.home)}` : `${v.home != null ? fmt(v.home) + ' 집 도착' : '지금 ' + fmt(v.now)} · ${v.todayOff ? `휴무 ${v.offN}일째` : '오늘 근무 끝'}`;
    let h = `<div class="head a1"><div><div class="label num">${lab}</div><div class="shift">${!today ? '쉬는 날' : v.todayOff ? '오늘은 쉬는 날' : '오늘 근무 끝 · 쉬는 시간'}</div></div><button class="golink" data-act="roster">근무·OT 바꾸기 ›</button></div>`;
    h += `<div class="sec a2 restsec"><div class="seg glass">${[[0, '계획 세우기', '일어날 시간 정하기'], [1, '아무것도 안 정할래', '알람 없는 날']]
      .map(([k, l, s]) => `<button data-act="rest" data-k="${k}" class="${+v.rest === k ? 'on' : ''}">${l}<small>${s}</small></button>`).join('')}</div></div>`;
    if (v.rest) return h;
    const noBed = v.sleep == null;
    const parts = [{ cls: 's', m: v.sleep, txt: '잠' }].concat(tasks.filter(k => Number.isFinite(k.m)).map(k => ({ cls: 't', m: k.m, txt: k.n })));
    h += `<div class="glass hero a2" style="margin-top:0"><div class="label">${today ? '오늘 잘 수 있는 시간' : '잘 수 있는 시간'}</div>${noBed ? '<p class="label dwait" data-sleepwait>잘 수 있는 시간은 그날이 되면 보여요</p>' : '<div class="big num" data-sleep></div>'}
      <div class="pair"><button class="pill wake" data-act="wake"><small>일어나기</small><b class="num" data-wake>${fmt(v.wake)}</b></button><div class="pill"><small>할 일 끝</small><b class="num" data-dep>${fmt(v.end)}</b></div></div>
      ${noBed ? '' : `<div class="bar">${barHTML(parts)}</div><div class="ticks num"><span>${v.home != null && v.bed === v.home ? '집 도착 ' + fmt(v.home) : '지금 ' + fmt(v.now)}</span><span>할 일 끝 ${fmt(v.end)}</span></div>`}</div>`;
    let tt = '';
    if (v.home != null) tt += ev('', fmt(v.home), '집 도착<small>C조 마지막 근무 끝</small>');
    if (!noBed) tt += ev('', fmt(v.bed), `잠들기<small>${dur(v.sleep)} 자요</small>`);
    tt += ev('key', fmt(v.wake), '일어나기', `<button class="tpill num hit" data-act="wake">${fmt(v.wake)}</button>`);
    tt += tasksHTML(tasks, v.wake, fresh.page === P.i ? fresh.idx : -1);
    tt += ev('key', fmt(v.end), `할 일 끝<small>그다음은 자유${T ? ` · 다음 근무 ${md(T.key)} ${T.s}조` : ''}</small>`);
    h += `<div class="sec a4"><div class="sec-t"><span class="label">${today ? '오늘 시간표' : '시간표'}</span><span class="hint">⠿ 끌어서 순서 · 시간 눌러 변경</span></div>
      <div class="glass tt">${tt}</div><div class="spare">${spareHTML(P.key, v.tasks)}</div></div>`;
    return h;
  }

  function addTaskSheet(P) {
    const names = [...new Set([...S.tpl, ...S.base].map(x => x.n))];
    const lookup = n => ([...S.tpl, ...S.base].find(x => x.n === n) || { m: 30 }).m;
    let pn = names[0] || '', pm = lookup(pn), custom = !names.length, typed = '';
    const draw = () => {
      setSheet(`<h3>할 일 추가</h3><span class="label">무엇을</span>
        <div class="opts">${names.map((n, i) => `<button data-n="${i}" class="${!custom && n === pn ? 'on' : ''}">${esc(n)}</button>`).join('')}<button data-custom class="${custom ? 'on' : ''}">직접 입력</button></div>
        ${custom ? `<input class="nmin" data-typed maxlength="${NAME_MAX}" placeholder="예: 스트레칭" value="${esc(typed)}">` : ''}
        <span class="label" style="margin-top:12px">얼마나</span>
        <div class="opts">${PRESET_T.map((m, i) => `<button data-m="${i}" class="${m === pm ? 'on' : ''}">${dur(m)}</button>`).join('')}</div>
        <button class="go" data-go>시간표에 넣기</button><button class="close" data-x>닫기</button>`);
      const inp = $('[data-typed]', sheet);
      if (inp) inp.oninput = () => { typed = inp.value; };
    };
    openSheet('', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.n != null) { custom = false; pn = names[+b.dataset.n]; pm = lookup(pn); draw(); }
      else if (b.hasAttribute('data-custom')) { custom = true; draw(); const i = $('[data-typed]', sheet); if (i) i.focus(); }
      else if (b.dataset.m != null) { pm = PRESET_T[+b.dataset.m]; draw(); }
      else if (b.hasAttribute('data-go')) {
        const n = (custom ? typed.trim() : pn).slice(0, NAME_MAX) || '새 할 일';
        if (!addItem(P.key, { n, m: pm })) { const g = $('[data-go]', sheet); if (g) { g.textContent = `「${n}」은 이미 있어요`; g.disabled = true; } return; }
        fresh = { page: P.i, idx: S.days[P.key].tasks.length - 1 }; save(); savePlan(); closeSheet(); renderToday();
      } else if (b.hasAttribute('data-x')) closeSheet();
    });
    draw();
  }

  dtrack.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const pg = b.closest('.dpage'); if (!pg) return;
    const P = pages[+pg.dataset.i]; if (!P) return;
    const a = b.dataset.act, i = +b.dataset.i, v = P.vm;
    if (a === 'gotoday') { setPage(0); return; }
    // 근무일 계산이면 그 근무 날짜, 휴무 화면·다음 근무 없음이면 그 페이지 날짜의 시트를 연다(QA-003: 휴무 날도 시트가 열림)
    if (a === 'roster') { go('roster'); Roster.openDay(v && v.target && v.type === 'work' ? v.target.key : P.date); return; }
    if (!P.key) return;
    const t = () => dayEdit(P.key); // 손대는 순간 그 날짜 상태를 만든다(손대지 않은 날은 저장하지 않음)
    const done = () => { save(); savePlan(); renderToday(); };
    if (a === 'mode') { t().mode = b.dataset.k; done(); }
    else if (a === 'eat') { t().eat = b.dataset.k === '1'; done(); }
    else if (a === 'rest') { t().rest = b.dataset.k === '1'; done(); }
    else if (a === 'meal') timeSheet({ title: '자기 전 밥', val: v.meal, presets: PRESET_T, max: 240, onChange: x => { t().meal = x; done(); } });
    else if (a === 'dur') { const k = v.tasks[i]; timeSheet({ title: k.n + ' 시간', val: k.m, presets: PRESET_T, onChange: x => { t().tasks[i].m = x; done(); } }); }
    else if (a === 'del') { const it = t().tasks[i]; if (it) removeItem(P.key, it.n); done(); }
    else if (a === 'back') { const d = t(), it = d.removed[i]; if (it && addItem(P.key, it)) { d.removed.splice(i, 1); fresh = { page: P.i, idx: d.tasks.length - 1 }; } done(); }
    else if (a === 'tpl') { const k = S.tpl[i]; if (addItem(P.key, { n: k.n, m: k.m })) fresh = { page: P.i, idx: S.days[P.key].tasks.length - 1 }; done(); }
    else if (a === 'add') addTaskSheet(P);
    else if (a === 'wake') timeSheet({ title: '일어날 시간', val: v.wakeClock, presets: WAKES, step: 10, wrap: true, show: m => fmt(m), onChange: x => { t().wake = x; done(); } });
  });

  /* ───────── ② 근무표 ───────── */
  const Roster = (function () {
    const el = $('#roster');
    const MONTHS = [];
    for (let i = 0; i < 8; i++) { const d = new Date(2026, 10 + i, 1); MONTHS.push([d.getFullYear(), d.getMonth()]); }
    // 근무 시작·끝(시). OT 길이는 calc.js OT_MIN 하나만 쓴다(QA-006). f는 30분 단위도 HH:MM으로
    const T = { A: [6, 14], B: [14, 22], C: [22, 30] }, OTH = C.OT_MIN / 60, f = h => fmt(Math.round(h * 60));
    const keyOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const monthOf = k => MONTHS.findIndex(([y, m]) => k.startsWith(keyOf(y, m, 1).slice(0, 8)));
    let mode = 'ot', brush = 'B', cur = null, mi = 0, built = false, todayKey = '', pendingM = null, pendingMUntil = 0;
    let fk, fs, fn;

    function build() {
      el.innerHTML = `<div class="month a1"><h2 data-r="title"></h2><div class="mnav"><span class="label num" data-r="count"></span><button class="hit" data-r="prev" aria-label="이전 달">‹</button><button class="hit" data-r="next" aria-label="다음 달">›</button></div></div>
        <div class="seg glass a2" data-r="mode"><button data-m="shift">근무조 입력</button><button data-m="ot">OT 입력</button></div>
        <p class="rhint a2" data-r="hint"></p>
        <div class="legend a2"><span><i class="lg A"></i>A 아침</span><span><i class="lg B"></i>B 오후</span><span><i class="lg C"></i>C 밤</span><span><i class="lg off"></i>휴무</span></div>
        <div class="mtrack a3" data-r="track">${MONTHS.map((_, i) => `<div class="mpanel"><div class="grid" data-mg="${i}"></div></div>`).join('')}</div>
        <div class="mdots" data-r="dots">${MONTHS.map((_, i) => `<i data-i="${i}"></i>`).join('')}</div>
        <div class="palette a3" data-r="pal"></div><button class="fillrow a3" data-r="fill">⟳ 규칙대로 한 번에 채우기</button>
        <div class="otlist glass a4"><div class="label" data-r="otlabel"></div><div data-r="otlist"></div></div>`;
      const track = r('track');
      let st;
      // QA-007(v12): 달 번호는 스크롤이 멈춘 뒤 반올림한 값 한 곳에서만 정하고, 점은 drawSide에서 매번 다시 그린다
      const settle = () => {
        const w = track.clientWidth, i = w ? clamp(Math.round(track.scrollLeft / w), 0, MONTHS.length - 1) : mi;
        if (pendingM != null && i !== pendingM && Date.now() < pendingMUntil) { st = setTimeout(settle, Math.max(30, pendingMUntil - Date.now())); return; }
        pendingM = null; mi = i; drawSide();
      };
      track.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(settle, 80); }, { passive: true });
      el.addEventListener('click', onClick);
      built = true;
    }
    const r = n => $(`[data-r="${n}"]`, el);

    function drawMonth(i) {
      const [y, m] = MONTHS[i], n = new Date(y, m + 1, 0).getDate();
      let h = [...W].map(x => `<div class="dow">${x}</div>`).join('') + '<div></div>'.repeat(new Date(y, m, 1).getDay());
      for (let d = 1; d <= n; d++) {
        const k = keyOf(y, m, d), v = S.roster[k] || { s: 'off', ot: '' };
        h += `<div class="day ${v.s}${k === todayKey ? ' today' : ''}${k === cur ? ' pick' : ''}" data-k="${k}"><span class="n num">${d}</span><span class="c">${v.s === 'off' ? '휴무' : v.s}</span>${v.ot ? `<span class="otp">${v.ot === 'pre' ? '전OT' : '후OT'}</span>` : ''}</div>`;
      }
      $(`[data-mg="${i}"]`, el).innerHTML = h;
    }
    function drawSide() {
      const [y, m] = MONTHS[mi], pre = keyOf(y, m, 1).slice(0, 8);
      const ks = Object.keys(S.roster).filter(k => k.startsWith(pre) && S.roster[k].ot && S.roster[k].s !== 'off').sort();
      r('title').textContent = `${m + 1}월 근무표`;
      r('count').textContent = `${y} · OT ${ks.length}일`;
      r('otlabel').textContent = `${m + 1}월 OT`;
      r('dots').innerHTML = MONTHS.map((_, i) => `<i data-i="${i}"${i === mi ? ' class="on"' : ''}></i>`).join('');
      const pn = r('track').children[mi]; if (pn) r('track').style.height = pn.offsetHeight + 'px';
      r('prev').disabled = mi === 0; r('next').disabled = mi === MONTHS.length - 1;
      $$('[data-r="mode"] button', el).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
      r('fill').style.display = mode === 'shift' ? '' : 'none';
      r('pal').innerHTML = mode === 'shift' ? [['A', 'A'], ['B', 'B'], ['C', 'C'], ['off', '휴무']].map(([k, l]) => `<button data-brush="${k}" class="${k === brush ? 'on' : ''}">${l}</button>`).join('') : '';
      r('pal').style.display = mode === 'shift' ? '' : 'none';
      r('hint').textContent = mode === 'shift'
        ? '근무조를 고르고 날짜를 누르세요'
        : '날짜를 눌러 근무조·OT 바꾸기';
      r('otlist').innerHTML = ks.length ? ks.map(k => {
        const v = S.roster[k], [a, b] = T[v.s];
        return `<div class="row2"><span>${md(k)} (${dow(k)}) · ${v.s}조<span class="when num">${f(v.ot === 'pre' ? a - OTH : a)}~${f(v.ot === 'post' ? b + OTH : b)}</span></span><span class="tag">${v.ot === 'pre' ? '전OT' : '후OT'}</span></div>`;
      }).join('') : '<div class="row2"><span style="color:var(--muted)">이 달은 OT가 없어요</span></div>';
    }
    function drawAll() { MONTHS.forEach((_, i) => drawMonth(i)); drawSide(); }
    function goMonth(i, smooth = true) {
      i = clamp(i, 0, MONTHS.length - 1);
      const tr = r('track'), w = tr.clientWidth;
      if (!smooth || reduce || !w || Math.abs(tr.scrollLeft - i * w) < 1) { pendingM = null; mi = i; tr.scrollTo({ left: i * w, behavior: 'auto' }); drawSide(); return; }
      pendingM = i; pendingMUntil = Date.now() + 1500; // 목표 달에 닿으면 settle이 번호·점을 정한다
      tr.scrollTo({ left: i * w, behavior: 'smooth' });
    }
    function flash(sel) { $$(sel, el).forEach(c => { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }); }

    /* 날짜 시트: 근무조(A·B·C·휴무) 줄 + OT 버튼. 휴무 날도 열린다(QA-003, v8) */
    function openOT(k) {
      const prev = cur; cur = k;
      const v = S.roster[k];
      const draw = () => {
        const off = v.s === 'off', [a, b] = off ? [0, 0] : T[v.s];
        setSheet(`<h3>${md(k)} (${dow(k)}) · ${off ? '휴무' : `${v.s}조 ${f(a)}~${f(b)}`}</h3>
        <span class="label">근무조 · 누르면 바로 바뀌어요</span>
        <div class="opts f4" data-r="shiftrow">${[['A', 'A조'], ['B', 'B조'], ['C', 'C조'], ['off', '휴무']].map(([s, l]) => `<button data-shift="${s}" class="${v.s === s ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${off ? '<span class="label">휴무 날은 OT를 넣을 수 없어요</span>'
          : `<span class="label">OT · 같은 버튼을 다시 누르면 취소</span>
        <div class="btns"><button data-ot="pre" class="${v.ot === 'pre' ? 'on' : ''}">전OT<small class="num">${f(a - OTH)}부터 근무</small></button><button data-ot="post" class="${v.ot === 'post' ? 'on' : ''}">후OT<small class="num">${f(b + OTH)}까지 근무</small></button></div>`}
        <button class="close" data-x>닫기</button>`);
      };
      openSheet('', e => {
        const bt = e.target.closest('button'); if (!bt) return;
        if (bt.dataset.ot) { v.ot = v.ot === bt.dataset.ot ? '' : bt.dataset.ot; save(); draw(); drawMonth(monthOf(k)); drawSide(); }
        else if (bt.dataset.shift) {
          if (v.s !== bt.dataset.shift) { v.s = bt.dataset.shift; if (v.s === 'off') v.ot = ''; save(); }
          draw(); drawMonth(monthOf(k)); drawSide(); flash(`.day[data-k="${k}"]`);
        }
        else if (bt.hasAttribute('data-x')) closeSheet();
      }, () => { cur = null; drawMonth(monthOf(k)); });
      draw();
      if (prev && monthOf(prev) !== monthOf(k)) drawMonth(monthOf(prev));
      drawMonth(monthOf(k));
    }

    /* 규칙대로 한 번에 채우기 */
    function nthOf(k) {
      const v = S.roster[k]; if (!v || v.s === 'off') return ['A', 1];
      let n = 1, d = C.keyToDay(k);
      while (n < 6 && S.roster[C.dayToKey(d - n)] && S.roster[C.dayToKey(d - n)].s === v.s) n++;
      return [v.s, n];
    }
    function openFill() {
      fk = S.roster[todayKey] ? todayKey : C.RANGE_START;
      [fs, fn] = nthOf(fk);
      const s0 = C.keyToDay(C.RANGE_START), s1 = C.keyToDay(C.RANGE_END);
      const draw = () => {
        const i0 = C.ORDER.indexOf(fs) * 8 + fn - 1, nx = [];
        let j = i0;
        for (let c = 0; c < 4; c++) { const s = C.CYCLE[j % 24]; nx.push(s === 'off' ? '휴무' : s + '조'); while (C.CYCLE[(j + 1) % 24] === s) j++; j++; }
        setSheet(`<h3>규칙대로 한 번에 채우기</h3>
          <span class="label">기준 날짜</span><div class="fdate"><button data-fd="-1" aria-label="하루 전">‹</button><b class="num">${md(fk)} (${dow(fk)})</b><button data-fd="1" aria-label="하루 뒤">›</button></div>
          <span class="label">이날 근무조</span><div class="opts f3">${['A', 'B', 'C'].map(x => `<button data-fs="${x}" class="${x === fs ? 'on' : ''}">${x}조</button>`).join('')}</div>
          <span class="label">그 근무조의 며칠째 날</span><div class="opts f6">${[1, 2, 3, 4, 5, 6].map(n => `<button data-fn="${n}" class="${n === fn ? 'on' : ''}">${n}일째</button>`).join('')}</div>
          <p class="fprev">이날부터 <b>${nx.join(' → ')}</b> … 순서로 (A → B → C)<br>2026년 11월 1일 ~ 2027년 6월 30일을 모두 채워요. 동료와 바꾼 날도 규칙대로 덮어써요. OT는 그대로 남아요(휴무가 된 날의 OT만 지워요).</p>
          <button class="go" data-go>채우기</button><button class="close" data-x>취소</button>`);
      };
      openSheet('', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.fd) { const d = clamp(C.keyToDay(fk) + +b.dataset.fd, s0, s1); fk = C.dayToKey(d); draw(); }
        else if (b.dataset.fs) { fs = b.dataset.fs; draw(); }
        else if (b.dataset.fn) { fn = +b.dataset.fn; draw(); }
        else if (b.hasAttribute('data-go')) { C.fillRoster(S.roster, fk, fs, fn); save(); closeSheet(); drawAll(); flash(`[data-mg="${mi}"] .day`); }
        else if (b.hasAttribute('data-x')) closeSheet();
      });
      draw();
    }

    function onClick(e) {
      const day = e.target.closest('.day');
      if (day) {
        const k = day.dataset.k, v = S.roster[k]; if (!v) return;
        if (mode === 'shift') {
          v.s = brush; if (brush === 'off') v.ot = ''; save(); drawMonth(monthOf(k)); drawSide();
          flash(`.day[data-k="${k}"]`);
        } else openOT(k);
        return;
      }
      const b = e.target.closest('button,[data-i]'); if (!b) return;
      if (b.dataset.m) { mode = b.dataset.m; closeSheet(); cur = null; drawAll(); }
      else if (b.dataset.brush) { brush = b.dataset.brush; drawSide(); }
      else if (b.dataset.r === 'prev') goMonth((pendingM != null ? pendingM : mi) - 1);
      else if (b.dataset.r === 'next') goMonth((pendingM != null ? pendingM : mi) + 1);
      else if (b.dataset.r === 'fill') openFill();
      else if (b.closest('[data-r="dots"]')) goMonth(+b.dataset.i);
    }

    function render() {
      if (!built) build();
      const tk = C.dayToKey(Math.floor(nowAbs() / 1440));
      const first = !todayKey; todayKey = tk;
      drawAll();
      if (first) { const i = monthOf(tk); requestAnimationFrame(() => goMonth(i >= 0 ? i : 0, false)); }
    }
    return {
      render,
      openDay(k) { render(); mode = 'ot'; drawAll(); const i = monthOf(k); if (i >= 0) { goMonth(i, false); if (S.roster[k]) openOT(k); } },
      relayout() { if (built) { goMonth(mi, false); } },
    };
  })();

  /* ───────── ③ 할 일 설정 ───────── */
  const tasksEl = $('#tasks');
  let freshBase = -1;
  function renderTasks() {
    const M = S.move;
    const moves = [['bus', '시내버스', '집 → 통근버스 정류장'], ['taxi', '택시', '집 → 통근버스 정류장'], ['car', '택시 · 차', '집 ↔ 회사 · 출퇴근 같음 · OT 날'], ['ride', '퇴근버스 → 집', '퇴근버스 출발부터 집 도착까지']];
    tasksEl.innerHTML = `<div class="month a1"><h2>할 일 설정</h2></div>
      <div class="sec a2"><div class="sec-t"><span class="label">매일 기본으로 넣을 할 일</span><span class="hint">⠿ 끌어서 순서 바꾸기</span></div>
        <div class="glass setlist" data-base>${S.base.map((k, i) => `<div class="srow${i === freshBase ? ' flashrow' : ''}" data-i="${i}">${GRIP}<span class="nm2">${esc(k.n)}${k.sub ? `<small>${esc(k.sub)}</small>` : ''}</span><button class="tpill num hit" data-act="bdur" data-i="${i}">${dur(k.m)}</button><button class="x hit" data-act="bdel" data-i="${i}" aria-label="빼기">×</button></div>`).join('')}
        <button class="addrow" data-act="addbase">+ 템플릿에서 기본으로 넣기</button></div></div>
      <div class="sec a3"><div class="sec-t"><span class="label">템플릿</span><span class="hint">오늘 화면에서 한 번에 추가</span></div>
        <div class="tpls">${S.tpl.map((t, i) => `<button data-act="tpl" data-i="${i}">${esc(t.n)}<small>${dur(t.m)}</small></button>`).join('')}<button class="new" data-act="newtpl">+ 템플릿 만들기</button></div></div>
      <div class="sec a4"><div class="sec-t"><span class="label">이동 시간</span><span class="hint">통근버스 정류장·회사까지</span></div>
        <div class="glass setlist">${moves.map(([k, n, sub]) => `<div class="srow"><span class="nm2">${n}<small>${sub}</small></span><button class="tpill num hit" data-act="move" data-k="${k}">${M[k]}분</button></div>`).join('')}</div></div>
      <div class="sec a4 themesec"><div class="sec-t"><span class="label">테마</span><span class="hint">누르면 바로 바뀌어요</span></div>
        <div class="seg glass">${THEMES.map(([k, l]) => `<button data-act="tc" data-k="${k}" class="${S.theme.c === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="seg glass">${[['l', '라이트'], ['d', '다크']].map(([k, l]) => `<button data-act="td" data-k="${k}" class="${S.theme.d === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <p class="usage label num">최근 7일 사용 ${usedDays7()}일</p>
      <p class="credit">보름달 이미지: NASA's Scientific Visualization Studio (CGI Moon Kit, LRO 색 지도)${saveFailed ? '<br><b style="color:var(--ink,var(--accent))">저장 공간에 쓰지 못했어요. 사파리 개인정보 보호 모드인지 확인해 주세요.</b>' : ''}${backedUp ? '<br><b style="color:var(--ink,var(--accent))">저장된 기록을 읽지 못해 따로 보관해 두었어요. 지우지 말고 알려 주세요.</b>' : ''}</p>`;
    freshBase = -1;
    sortable($('[data-base]', tasksEl), '.srow', (f, t) => { moveItem(S.base, f, t); save(); renderTasks(); });
  }
  function tplSheet(i) {
    const t = i >= 0 ? S.tpl[i] : { n: '', m: 30 };
    let m = t.m, name = t.n;
    const draw = () => {
      setSheet(`<h3>${i >= 0 ? '템플릿 고치기' : '템플릿 만들기'}</h3><span class="label">이름</span><input class="nmin" data-nm placeholder="예: 스트레칭" maxlength="${NAME_MAX}" value="${esc(name)}">
        <span class="label" style="margin-top:12px">기본 시간</span><div class="opts">${PRESET_T.map((x, j) => `<button data-m="${j}" class="${x === m ? 'on' : ''}">${dur(x)}</button>`).join('')}</div>
        <button class="go" data-save>저장</button>${i >= 0 ? '<button class="close" data-del>삭제</button>' : ''}<button class="close" data-x>취소</button>`);
      const inp = $('[data-nm]', sheet); inp.oninput = () => { name = inp.value; };
    };
    openSheet('', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.m != null) { m = PRESET_T[+b.dataset.m]; draw(); }
      else if (b.hasAttribute('data-save')) {
        const n = name.trim().slice(0, NAME_MAX) || '새 할 일';
        if (i >= 0) S.tpl[i] = { n, m }; else S.tpl.push({ n, m });
        save(); closeSheet(); renderTasks();
      } else if (b.hasAttribute('data-del')) { S.tpl.splice(i, 1); save(); closeSheet(); renderTasks(); }
      else if (b.hasAttribute('data-x')) closeSheet();
    });
    draw();
  }
  function addBaseSheet() {
    const draw = () => setSheet(`<h3>기본 할 일에 넣기</h3><span class="label">템플릿에서 고르면 매일 기본 목록으로 옮겨요</span>
      <div class="opts">${S.tpl.length ? S.tpl.map((t, i) => `<button data-i="${i}">${esc(t.n)} ${dur(t.m)}</button>`).join('') : '<span class="label">템플릿이 없어요. 먼저 템플릿을 만들어 주세요.</span>'}</div>
      <button class="close" data-x>닫기</button>`);
    openSheet('', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.i != null) { S.base.push(S.tpl.splice(+b.dataset.i, 1)[0]); freshBase = S.base.length - 1; save(); closeSheet(); renderTasks(); }
      else if (b.hasAttribute('data-x')) closeSheet();
    });
    draw();
  }
  tasksEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, i = +b.dataset.i;
    const done = () => { save(); renderTasks(); };
    if (a === 'bdur') { const k = S.base[i]; timeSheet({ title: k.n + ' 기본 시간', val: k.m, presets: PRESET_T, onChange: x => { k.m = x; done(); } }); }
    else if (a === 'bdel') { S.tpl.push(S.base.splice(i, 1)[0]); done(); }
    else if (a === 'addbase') addBaseSheet();
    else if (a === 'tpl') tplSheet(i);
    else if (a === 'newtpl') tplSheet(-1);
    else if (a === 'move') { const k = b.dataset.k; timeSheet({ title: b.closest('.srow').querySelector('.nm2').firstChild.textContent + ' 이동 시간', val: S.move[k], presets: PRESET_M, max: 240, onChange: x => { S.move[k] = x; done(); } }); }
    else if (a === 'tc') { S.theme.c = b.dataset.k; applyTheme(); done(); }
    else if (a === 'td') { S.theme.d = b.dataset.k; applyTheme(); done(); }
  });

  /* ───────── ② 주간 (v12, spec 7-1장) ─────────
     한 주(2칸 × 4줄, 마지막 칸 메모) / 하루(요일 띠 + 고른 날). 시간은 표시하지 않는다. 새 화면 없이 시트 하나로 추가·지우기·메모 */
  const Week = (function () {
    const el = $('#week');
    let wk0 = null, sel = null, seenDay = null;
    const tday = () => Math.floor(nowAbs() / 1440);
    const K = d => C.dayToKey(d);
    const limits = () => [C.weekStart(tday() - 13), C.weekStart(C.keyToDay(C.RANGE_END))];
    const SNAME = { A: 'A조', B: 'B조', C: 'C조', off: '휴무' };
    function badge(k) {
      const r = S.roster[k]; if (!r) return '';
      return `<span class="sb ${r.s}">${SNAME[r.s] || r.s}</span>` + (r.ot && r.s !== 'off' ? `<span class="sb ot">${r.ot === 'pre' ? '전OT' : '후OT'}</span>` : '');
    }
    function summary(mon) {
      const n = { A: 0, B: 0, C: 0, off: 0 };
      for (let i = 0; i < 7; i++) { const r = S.roster[K(mon + i)]; if (r && n[r.s] != null) n[r.s]++; }
      return ['A', 'B', 'C', 'off'].filter(s => n[s]).map(s => `${SNAME[s]} ${n[s]}일`).join(' · ');
    }
    const md2 = k => { const [, m, d] = k.split('-').map(Number); return `${m}/${d}`; };
    function itemHTML(k, x, big) {
      return `<div class="item${x.done ? ' done' : ''}${x.carried ? ' carried' : ''}"><button class="ib hit" data-act="chk" data-k="${k}" data-n="${esc(x.n)}"${x.carried ? ' disabled' : ''}><span class="cb"></span><span class="nm">${esc(x.n)}</span>${x.rule ? '<span class="rep" aria-label="매주 반복">↻</span>' : ''}${x.carried ? '<small>→ 오늘</small>' : ''}</button>${big && !x.carried ? `<button class="x hit" data-act="wdel" data-k="${k}" data-n="${esc(x.n)}" aria-label="빼기">×</button>` : ''}</div>`;
    }
    function cellHTML(d, big) {
      const k = K(d), items = C.weekItems(ST(), k), past = d < tday();
      return `<div class="dc glass${big ? ' focus' : ''}${d === tday() ? ' tdy' : ''}" data-k="${k}"><div class="dhd"><span class="d">${dow(k)} <small>${md2(k)}</small></span>${badge(k)}</div>
        <div class="items">${items.map(x => itemHTML(k, x, big)).join('')}</div>${past ? '' : `<button class="addi" data-act="add" data-k="${k}">+ 추가</button>`}</div>`;
    }
    function render() {
      const t = tday();
      if (seenDay !== t) { seenDay = t; wk0 = C.weekStart(t); sel = null; }
      const [lo, hi] = limits(); wk0 = clamp(wk0, lo, hi);
      if (sel == null || sel < wk0 || sel > wk0 + 6) sel = t >= wk0 && t <= wk0 + 6 ? t : wk0;
      const view = PL.ui.week, mk = K(wk0), carry = wk0 === C.weekStart(t) ? C.carryList(ST(), t) : [];
      let h = `<div class="month a1"><h2 data-wtitle>${C.weekLabel(wk0)}</h2><div class="mnav"><button class="hit" data-act="prev" aria-label="이전 주"${wk0 <= lo ? ' disabled' : ''}>‹</button><button class="hit" data-act="next" aria-label="다음 주"${wk0 >= hi ? ' disabled' : ''}>›</button></div></div>
        <p class="rhint a2 num" data-wsum>${md2(mk)}~${md2(K(wk0 + 6))}${summary(wk0) ? ' · ' + summary(wk0) : ''}</p>`;
      if (carry.length) h += `<div class="carry a2" data-carry><span>어제 못 한 일 <b>${carry.length}개</b></span><button data-act="carry">오늘로 가져오기</button></div>`;
      h += `<div class="seg glass vseg a2" data-wview>${[['week', '한 주'], ['day', '하루']].map(([k, l]) => `<button data-act="view" data-k="${k}" class="${view === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      if (view === 'week') {
        let g = '';
        for (let i = 0; i < 7; i++) g += cellHTML(wk0 + i, false);
        const memo = PL.memos[mk] || '';
        g += `<button class="dc glass memo" data-act="memo"><span class="label">이번 주 메모</span><p>${memo ? esc(memo) : '<span class="hint">눌러서 적기</span>'}</p></button>`;
        h += `<div class="g2 a3" data-wgrid>${g}</div>`;
      } else {
        let s = '';
        for (let i = 0; i < 7; i++) {
          const d = wk0 + i, k = K(d), it = C.weekItems(ST(), k), r = S.roster[k];
          s += `<button class="sd${d === sel ? ' sel' : ''}${d === t ? ' tdy' : ''}" data-act="sel" data-d="${d}"><span class="w">${dow(k)}</span><span class="n2 num">${Number(k.slice(8))}</span><span class="st ${r ? r.s : ''}"></span><span class="pg num">${it.filter(x => x.done).length}/${it.length}</span></button>`;
        }
        h += `<div class="strip a3" data-wstrip>${s}</div>${cellHTML(sel, true)}`;
      }
      el.innerHTML = h;
    }
    const done = () => { save(); savePlan(); render(); };

    /* 「+ 추가」 시트(W3): 이름 → 넣을 날 → 요일 → 매주 반복 → 추가. 같은 이름이 있는 날·지난 날은 건너뜀 */
    function addSheet(k0) {
      const d0 = C.keyToDay(k0), mon = C.weekStart(d0), t = tday();
      const days = Array.from({ length: 7 }, (_, i) => mon + i), future = days.filter(d => d >= t);
      const chips = [...new Map([...S.tpl, ...S.base].map(x => [x.n, x])).values()];
      let pick = -1, typed = '', custom = false, mode = 'one', picked = new Set([d0]), quick = null, rep = false;
      const name = () => (custom ? typed.trim() : pick >= 0 ? chips[pick].n : '').slice(0, NAME_MAX);
      const mins = () => (!custom && pick >= 0 ? chips[pick].m : undefined); // 칩을 고르면 그 시간, 직접 입력은 시간 없음
      const targets = () => (mode === 'one' ? [d0] : mode === 'all' ? future : future.filter(d => picked.has(d)));
      const will = () => { const n = name(); return n ? targets().filter(d => !hasName(K(d), n)) : []; };
      const isWork = d => { const r = S.roster[K(d)]; return !!r && r.s !== 'off'; };
      const draw = () => {
        const n = name(), w = will(), tg = targets();
        const label = !n ? '이름을 골라 주세요' : !tg.length ? '날을 골라 주세요' : !w.length ? '이미 모두 있어요' : `${w.length}일에 추가${rep ? ' · 매주 반복' : ''}`;
        setSheet(`<h3>할 일 추가 · ${C.weekLabel(mon)}</h3>
          <span class="label">이름</span>
          <div class="opts" data-chips>${chips.map((x, i) => `<button data-c="${i}" class="${!custom && pick === i ? 'on' : ''}">${esc(x.n)}</button>`).join('')}<button data-custom class="${custom ? 'on' : ''}">직접 입력</button></div>
          ${custom ? `<input class="nmin" data-typed maxlength="${NAME_MAX}" placeholder="예: SKCT 1회" value="${esc(typed)}">` : ''}
          <span class="label" style="margin-top:12px">넣을 날</span>
          <div class="opts f3" data-mode>${[['one', '이 날만'], ['all', '일주일 전부'], ['pick', '요일 고르기']].map(([k, l]) => `<button data-mode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="opts f3" data-quick><button data-quick="work" class="${quick === 'work' ? 'on' : ''}">근무일만</button><button data-quick="off" class="${quick === 'off' ? 'on' : ''}">휴무일만</button></div>
          <div class="days7" data-days>${days.map(d => { const k = K(d), r = S.roster[k], on = tg.includes(d); return `<button data-d="${d}" class="${on ? 'on' : ''}"${d < t ? ' disabled' : ''}>${dow(k)}<small>${r ? (r.s === 'off' ? '휴무' : r.s) : ''}</small></button>`; }).join('')}</div>
          <button class="rowopt" data-rep><span>매주 반복 ↻<small>다음 주에도 ${mode === 'all' ? '매일' : quick === 'work' ? '근무일마다' : quick === 'off' ? '휴무일마다' : '같은 요일에'} 들어가요</small></span><span class="tgl${rep ? '' : ' no'}"></span></button>
          <button class="go" data-go${n && w.length ? '' : ' disabled'}>${label}</button><button class="close" data-x>닫기</button>`);
        const inp = $('[data-typed]', sheet);
        if (inp) inp.oninput = () => { typed = inp.value; const g = $('[data-go]', sheet), ww = will(), nn = name(); g.disabled = !(nn && ww.length); g.textContent = !nn ? '이름을 골라 주세요' : !ww.length ? (targets().length ? '이미 모두 있어요' : '날을 골라 주세요') : `${ww.length}일에 추가${rep ? ' · 매주 반복' : ''}`; };
      };
      openSheet('', e => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.c != null) { custom = false; pick = +b.dataset.c; draw(); }
        else if (b.hasAttribute('data-custom')) { custom = true; pick = -1; draw(); const i = $('[data-typed]', sheet); if (i) i.focus(); }
        else if (b.dataset.mode) { mode = b.dataset.mode; quick = null; if (mode === 'pick') picked = new Set(future.filter(d => d === d0)); draw(); }
        else if (b.dataset.quick) { quick = quick === b.dataset.quick ? null : b.dataset.quick; mode = 'pick'; picked = new Set(quick ? future.filter(d => (quick === 'work') === isWork(d)) : []); draw(); }
        else if (b.dataset.d != null) { const d = +b.dataset.d; if (mode !== 'pick') { picked = new Set(targets()); mode = 'pick'; } quick = null; picked.has(d) ? picked.delete(d) : picked.add(d); draw(); }
        else if (b.hasAttribute('data-rep')) { rep = !rep; draw(); }
        else if (b.hasAttribute('data-go')) {
          const n = name(), m = mins(), w = will(); if (!n || !w.length) return;
          if (rep) {
            // 반복은 규칙으로 저장(날짜마다 복사하지 않음). 근무일만·휴무일만은 근무표 기준 규칙, 오늘 이전에는 넣지 않음
            const tg = targets(), kind = quick || (mode === 'all' ? 'daily' : 'wd');
            // 시작일: 매일·근무표 기준 규칙은 오늘(미래 주면 그 주 월요일)부터, 요일 규칙은 고른 첫날부터
            const from = K(kind === 'wd' ? Math.max(t, Math.min(...tg)) : Math.max(t, mon));
            PL.rules.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), n, m, kind, wd: kind === 'wd' ? [...new Set(tg.map(C.weekday))].sort() : [], from, until: null });
          } else w.forEach(d => addItem(K(d), { n, m }, true));
          closeSheet(); done(); if (typeof renderToday === 'function') renderToday(false);
        } else if (b.hasAttribute('data-x')) closeSheet();
      });
      draw();
    }
    /* 반복 항목 지우기: 이 날만 / 앞으로 전부 */
    function delSheet(k, n) {
      const rid = (PL.days[k] && PL.days[k].r[n]) || (C.dayItems(ST(), k).find(x => x.n === n) || {}).rule;
      if (!rid) { removeItem(k, n); done(); return; }
      openSheet(`<h3>「${esc(n)}」 빼기</h3><span class="label">매주 반복하는 할 일이에요</span>
        <div class="btns"><button data-one>이 날만<small>${md(k)}</small></button><button data-all>앞으로 전부<small>${md(k)}부터</small></button></div><button class="close" data-x>취소</button>`, e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-one')) { removeItem(k, n); const m = pmark(k); if (!m.skip.includes(rid)) m.skip.push(rid); closeSheet(); done(); }
        else if (b.hasAttribute('data-all')) {
          const ru = PL.rules.find(r => r.id === rid);
          if (ru) { ru.until = K(C.keyToDay(k) - 1); if (ru.until < ru.from) PL.rules.splice(PL.rules.indexOf(ru), 1); }
          // 그날 이후 저장된 날짜에서 그 반복 항목을 지운다(지난 날은 그대로)
          Object.keys(S.days).forEach(dk => { if (dk >= k && PL.days[dk] && PL.days[dk].r[n] === rid) { const t = S.days[dk], i = t.tasks.findIndex(x => x.n === n); if (i >= 0) t.tasks.splice(i, 1); unmark(dk, n); } });
          closeSheet(); done();
        } else if (b.hasAttribute('data-x')) closeSheet();
      });
    }
    function memoSheet() {
      const mk = K(wk0);
      openSheet(`<h3>이번 주 메모 · ${C.weekLabel(wk0)}</h3><textarea class="nmin memoin" data-memo maxlength="300" placeholder="예: 12월부터 ADSP 준비">${esc(PL.memos[mk] || '')}</textarea>
        <button class="go" data-save>저장</button><button class="close" data-x>닫기</button>`, e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-save')) { const v = $('[data-memo]', sheet).value.trim(); if (v) PL.memos[mk] = v; else delete PL.memos[mk]; closeSheet(); done(); }
        else if (b.hasAttribute('data-x')) closeSheet();
      });
    }
    /* 이월: 누를 때만. 어제 못 한 주간 항목을 오늘 끝에 복사하고 어제 칸에 「→ 오늘」 */
    function carry() {
      const t = tday(), tk = K(t), yk = K(t - 1);
      C.carryList(ST(), t).forEach(x => { if (addItem(tk, { n: x.n, m: x.m }, true)) pmark(yk).cf[x.n] = tk; });
      done();
    }
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      const a = b.dataset.act, [lo, hi] = limits();
      if (a === 'prev') { wk0 = Math.max(lo, wk0 - 7); sel = null; render(); }
      else if (a === 'next') { wk0 = Math.min(hi, wk0 + 7); sel = null; render(); }
      else if (a === 'view') { PL.ui.week = b.dataset.k; savePlan(); render(); }
      else if (a === 'sel') { sel = +b.dataset.d; render(); }
      else if (a === 'chk') { const k = b.dataset.k, n = b.dataset.n, it = dayEdit(k).tasks.find(x => x.n === n); if (it) it.done = !it.done; done(); }
      else if (a === 'add') addSheet(b.dataset.k);
      else if (a === 'wdel') delSheet(b.dataset.k, b.dataset.n);
      else if (a === 'memo') memoSheet();
      else if (a === 'carry') carry();
    });
    return { render };
  })();

  /* ───────── 탭 · 패럴랙스 · 시계 ───────── */
  const app = $('#app');
  const screens = { today: todayEl, week: $('#week'), roster: $('#roster'), tasks: tasksEl };
  function enter(sc) { sc.classList.add('enter'); clearTimeout(sc._t); sc._t = setTimeout(() => sc.classList.remove('enter'), 1100); }
  function go(tab) {
    closeSheet();
    app.dataset.tab = tab;
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'today') renderToday(); else if (tab === 'week') Week.render(); else if (tab === 'roster') Roster.render(); else renderTasks();
    enter(screens[tab]);
    app.style.setProperty('--sy', (tab === 'today' ? pageEls[curPage] : screens[tab]).scrollTop);
  }
  $$('.tabbar button').forEach(b => (b.onclick = () => go(b.dataset.tab)));
  Object.entries(screens).forEach(([k, sc]) => sc.addEventListener('scroll', () => { if (app.dataset.tab === k && (k !== 'today' || curPage === 0)) app.style.setProperty('--sy', sc.scrollTop); }, { passive: true }));
  // v11: 미래 페이지도 그 페이지의 세로 스크롤로 달을 움직인다(달이 카드 뒤에 남지 않게)
  pageEls.slice(1).forEach((pe, i) => pe.addEventListener('scroll', () => { if (app.dataset.tab === 'today' && curPage === i + 1) app.style.setProperty('--sy', pe.scrollTop); }, { passive: true }));
  app.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const rc = app.getBoundingClientRect(), x = (e.clientX - rc.left) / rc.width - 0.5;
    app.style.setProperty('--mx', (-x * 14).toFixed(1) + 'px');
  });
  app.addEventListener('pointerleave', () => app.style.setProperty('--mx', '0px'));

  let lastDay = Math.floor(nowAbs() / 1440);
  function tick() {
    if (document.hidden || dragging) return;
    const d = Math.floor(nowAbs() / 1440);
    if (app.dataset.tab === 'today') renderToday(true);
    else if (app.dataset.tab === 'week' && d !== lastDay && !sheetOpen()) Week.render(); // 주간은 날짜가 바뀔 때만 다시 그림(누르는 중에 화면이 바뀌지 않게)
    if (d !== lastDay) { lastDay = d; if (C.pruneDays(S, nowAbs())) save(); if (C.prunePlan(PL, nowAbs())) savePlan(); curPage = 0; dtrack.scrollLeft = 0; Roster.render(); if (app.dataset.tab === 'today') renderToday(false); }
  }
  setInterval(tick, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('resize', () => Roster.relayout());

  /* ───────── 시작 ───────── */
  applyTheme();
  renderToday(false);
  Roster.render();
  renderTasks();
  enter(todayEl);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
