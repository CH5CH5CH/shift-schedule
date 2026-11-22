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
  const PRESET_E = [0, 10, 15, 20, 30, 40, 50, 60];
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
      base: [{ n: '잠 깨기', m: 20 }, { n: '공부', m: 60 }, { n: '헬스', m: 120, sub: '이동 포함' }, { n: '밥', m: 60 }],
      tpl: [{ n: '공부 준비', m: 10 }, { n: '홈트', m: 60 }, { n: '씻기', m: 20 }, { n: '자유시간', m: 30 }, { n: '장보기', m: 30 }],
      move: { bus: 40, taxi: 20, car: 50, ride: 70 },
      early: { m: 40, sc: 'ot' },
      theme: { c: 'p2', d: 'd' },
      today: null,
    };
  }
  const isList = a => Array.isArray(a) && a.every(x => x && typeof x.n === 'string' && Number.isFinite(x.m));
  function load() {
    const d = defaults();
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (!s || s.v !== 1) return d;
      return {
        v: 1,
        roster: Object.assign(d.roster, s.roster && typeof s.roster === 'object' ? s.roster : {}),
        base: isList(s.base) ? s.base : d.base,
        tpl: isList(s.tpl) ? s.tpl : d.tpl,
        move: Object.assign(d.move, s.move),
        early: Object.assign(d.early, s.early),
        theme: Object.assign(d.theme, s.theme),
        today: s.today && isList(s.today.tasks) ? Object.assign({ removed: [] }, s.today) : null,
      };
    } catch (e) { return d; }
  }
  let saveFailed = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); saveFailed = false; }
    catch (e) { saveFailed = true; }
  }
  const S = load();
  const freshToday = key => ({ key, tasks: clone(S.base).map(t => ({ n: t.n, m: t.m })), removed: [], mode: null, eat: false, meal: 60, rest: false, wake: null });

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
          it.classList.remove('dragging'); list.classList.remove('sorting');
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
      const h = `<div class="tk${i === freshIdx ? ' new' : ''}" data-i="${i}"><span class="tm num">${fmt(t)}</span><div class="card">${GRIP}<div class="nm"><b>${esc(k.n)}</b><span class="rng num">~${fmt(t + k.m)}까지</span></div><div class="ctl"><button class="tpill num hit" data-act="dur" data-i="${i}">${dur(k.m)}</button><button class="x hit" data-act="del" data-i="${i}" aria-label="빼기">×</button></div></div></div>`;
      t += k.m; return h;
    }).join('');
  }
  function spareHTML() {
    const rm = S.today.removed || [], names = new Set(rm.map(x => x.n));
    return rm.map((x, i) => `<button data-act="back" data-i="${i}">+ ${esc(x.n)} ${dur(x.m)}</button>`).join('')
      + S.tpl.map((x, i) => names.has(x.n) ? '' : `<button data-act="tpl" data-i="${i}">+ ${esc(x.n)} ${dur(x.m)}</button>`).join('')
      + '<button class="addbtn" data-act="add">+ 새 할 일</button>';
  }

  /* ───────── ① 오늘 ───────── */
  const todayEl = $('#today'), todayView = todayEl.closest('.view'), restfx = $('#restfx');
  let freshIdx = -1, lastVM = null;

  function computeVM() {
    const now = nowAbs();
    let v = C.computeToday(S, now);
    if (!S.today || S.today.key !== v.key) { S.today = freshToday(v.key); save(); v = C.computeToday(S, now); }
    return v;
  }

  function renderToday(animate = true) {
    const v = lastVM = computeVM();
    let h = '';
    if (v.type === 'none') {
      todayView.classList.remove('resting');
      h = `<div class="head a1"><div><div class="label num">지금 ${fmt(v.now)}</div><div class="shift">다음 근무가 없어요</div></div><button class="golink" data-act="roster">근무·OT 바꾸기 ›</button></div>
        <div class="glass hero a2 empty"><b>근무표에 다음 근무가 없어요</b><span class="label">근무표 탭에서 근무조를 채우면 여기서 잘 수 있는 시간을 계산해요.</span></div>`;
      todayEl.innerHTML = h; return;
    }
    if (v.type === 'off') h = offHTML(v); else h = workHTML(v);
    todayEl.innerHTML = h;
    const big = $('[data-sleep]', todayEl);
    if (big) countSleep(big, v.sleep, animate);
    freshIdx = -1;
    const tt = $('.tt', todayEl);
    if (tt) sortable(tt, '.tk', (f, t) => { moveItem(S.today.tasks, f, t); save(); renderToday(); });
    const resting = v.type === 'off' && v.rest;
    todayView.classList.toggle('resting', resting);
    if (resting && !restfx.children.length) restfx.innerHTML = PHRASES.map((p, i) => `<span class="ph p${i}">${p}</span>`).join('');
  }

  function workHTML(v) {
    const T = v.target, t = S.today;
    const otTxt = T.ot === 'pre' ? '전OT' : T.ot === 'post' ? '후OT' : '';
    const dayWord = T.day === v.today ? '오늘' : T.day === v.today + 1 ? '내일' : md(T.key);
    let h = '';
    if (T.ot) h += `<button class="otbanner" data-act="roster"><span class="ico">OT</span><div><b>${dayWord}은 ${otTxt} 날이에요</b><small>${T.ot === 'pre'
      ? `평소보다 3시간 일찍 · ${fmt(v.start)}부터 근무 · 출근 버스 없음`
      : `평소보다 3시간 늦게 · ${fmt(v.end)}까지 근무 · 퇴근 버스 없음`}</small></div><span class="more">근무표 ›</span></button>`;
    const lab = v.prevC ? `${fmt(v.home)} 집 도착 · 다음 근무` : `지금 ${fmt(v.now)} · ${v.todayOff ? `휴무 ${v.offN}일째` : '다음 근무'}`;
    h += `<div class="head a1"><div><div class="label num">${lab}</div><div class="shift">${dayWord} ${T.s}조 · ${fmt(v.start)} 출근${otTxt ? `<span class="otbadge">${otTxt}</span>` : ''}</div></div><button class="golink" data-act="roster">근무·OT 바꾸기 ›</button></div>`;
    if (v.todayOff) h += `<div class="evenote a2" style="margin-top:14px"><b>근무일 계산으로 바뀌었어요</b><small>다음 출발까지 24시간이 안 남았어요 · 휴무 화면은 그 전까지</small></div>`;
    const parts = [];
    if (v.prevC && v.eat) parts.push({ cls: 't', m: v.meal, txt: '밥' });
    parts.push({ cls: 's', m: v.sleep, txt: '잠' });
    t.tasks.forEach(k => parts.push({ cls: 't', m: k.m, txt: k.n }));
    h += `<div class="glass hero a2"><div class="label">오늘 잘 수 있는 시간</div><div class="big num" data-sleep></div>
      <div class="pair"><div class="pill wake"><small>일어나기</small><b class="num" data-wake>${v.sleep < 0 ? '—' : fmt(v.wake)}</b></div><div class="pill"><small>집에서 출발</small><b class="num" data-dep>${fmt(v.dep)}</b></div></div>
      <div class="bar">${barHTML(parts)}</div><div class="ticks num"><span>${v.prevC ? '집 도착 ' + fmt(v.home) : '지금 ' + fmt(v.now)}</span><span>출발 ${fmt(v.dep)}</span></div></div>`;
    if (v.prevC) h += `<div class="sec a3"><span class="label">집에 오면</span><div class="seg glass">${[[0, '바로 자기', fmt(v.home)], [1, '밥 먹고 자기', fmt(v.home + v.meal)]]
      .map(([k, l, tm]) => `<button data-act="eat" data-k="${k}" class="${+v.eat === k ? 'on' : ''}">${l}<small class="num">${tm} 잠들기</small></button>`).join('')}</div></div>`;
    h += `<div class="sec a3"><span class="label">오늘 어떻게 가요?</span><div class="seg glass">${v.opts
      .map(o => `<button data-act="mode" data-k="${o.k}" class="${o.k === v.mode ? 'on' : ''}">${o.label}<small class="num">${fmt(o.dep)} 출발</small></button>`).join('')}</div></div>`;
    // 시간표
    let tt = '';
    if (v.prevC) {
      tt += ev('', fmt(v.home), `집 도착<small>C조 퇴근</small>`);
      if (v.eat) tt += ev('meal', fmt(v.home), `밥 먹기<small>~${fmt(v.home + v.meal)}까지</small>`, `<button class="tpill num hit" data-act="meal">${dur(v.meal)}</button>`);
    }
    tt += ev('', fmt(v.bed), `잠들기<small>${v.sleep > 0 ? dur(v.sleep) + ' 자요' : ''}</small>`);
    tt += ev('key', v.sleep < 0 ? '—' : fmt(v.wake), '일어나기');
    tt += tasksHTML(t.tasks, v.wake, freshIdx);
    const how = { bus: '시내버스로', taxi: T.ot === 'pre' ? '택시로 회사까지' : '택시로', car: '차로 회사까지' }[v.mode];
    tt += ev('key', fmt(v.dep), `집에서 출발<small>${how}${v.early ? ` · 여유 ${v.early}분` : ''}</small>`);
    if (v.mode !== 'car' && T.ot !== 'pre') tt += ev('', fmt(v.bus), '통근버스 타기');
    if (T.ot === 'pre') tt += ev('ot', fmt(v.start), `<b>전OT 시작</b><small>${T.s}조 근무는 ${fmt(v.shiftStart)}부터</small>`);
    else tt += ev('', fmt(v.start), `${T.s}조 근무 시작`);
    if (T.ot === 'post') tt += ev('ot', fmt(v.end), `<b>후OT 끝</b><small>${T.s}조 근무는 ${fmt(v.end - C.OT_MIN)}까지</small>`);
    const nextDay = Math.floor(v.homeAfter / 1440) > T.day;
    tt += ev('home', fmt(v.homeAfter), `집 도착<small>${T.ot === 'post' ? '택시·차로' : '퇴근버스로'}${nextDay ? ' · 다음 날' : ''}</small>`);
    h += `<div class="sec a4"><div class="sec-t"><span class="label">오늘 시간표</span><span class="hint">⠿ 끌어서 순서 · 시간 눌러 변경</span></div>
      <div class="glass tt">${tt}</div><div class="spare">${spareHTML()}</div></div>`;
    return h;
  }

  function offHTML(v) {
    const T = v.target, t = S.today;
    const lab = `${v.home != null ? fmt(v.home) + ' 집 도착' : '지금 ' + fmt(v.now)} · ${v.todayOff ? `휴무 ${v.offN}일째` : '오늘 근무 끝'}`;
    let h = `<div class="head a1"><div><div class="label num">${lab}</div><div class="shift">${v.todayOff ? '오늘은 쉬는 날' : '오늘 근무 끝 · 쉬는 시간'}</div></div><button class="golink" data-act="roster">근무·OT 바꾸기 ›</button></div>`;
    h += `<div class="sec a2 restsec"><div class="seg glass">${[[0, '계획 세우기', '일어날 시간 정하기'], [1, '아무것도 안 정할래', '알람 없는 날']]
      .map(([k, l, s]) => `<button data-act="rest" data-k="${k}" class="${+v.rest === k ? 'on' : ''}">${l}<small>${s}</small></button>`).join('')}</div></div>`;
    if (v.rest) return h;
    const parts = [{ cls: 's', m: v.sleep, txt: '잠' }].concat(t.tasks.map(k => ({ cls: 't', m: k.m, txt: k.n })));
    h += `<div class="glass hero a2" style="margin-top:0"><div class="label">오늘 잘 수 있는 시간</div><div class="big num" data-sleep></div>
      <div class="pair"><button class="pill wake" data-act="wake"><small>일어나기</small><b class="num" data-wake>${fmt(v.wake)}</b></button><div class="pill"><small>할 일 끝</small><b class="num" data-dep>${fmt(v.end)}</b></div></div>
      <div class="bar">${barHTML(parts)}</div><div class="ticks num"><span>${v.home != null ? '집 도착 ' + fmt(v.home) : '지금 ' + fmt(v.now)}</span><span>할 일 끝 ${fmt(v.end)}</span></div></div>`;
    let tt = '';
    if (v.home != null) tt += ev('', fmt(v.home), '집 도착<small>C조 마지막 근무 끝</small>');
    tt += ev('', fmt(v.bed), `잠들기<small>${dur(v.sleep)} 자요</small>`);
    tt += ev('key', fmt(v.wake), '일어나기', `<button class="tpill num hit" data-act="wake">${fmt(v.wake)}</button>`);
    tt += tasksHTML(t.tasks, v.wake, freshIdx);
    tt += ev('key', fmt(v.end), `할 일 끝<small>그다음은 자유 · 다음 근무 ${md(T.key)} ${T.s}조</small>`);
    h += `<div class="sec a4"><div class="sec-t"><span class="label">오늘 시간표</span><span class="hint">⠿ 끌어서 순서 · 시간 눌러 변경</span></div>
      <div class="glass tt">${tt}</div><div class="spare">${spareHTML()}</div></div>`;
    return h;
  }

  function addTaskSheet() {
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
        S.today.tasks.push({ n, m: pm }); freshIdx = S.today.tasks.length - 1; save(); closeSheet(); renderToday();
      } else if (b.hasAttribute('data-x')) closeSheet();
    });
    draw();
  }

  todayEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, i = +b.dataset.i, t = S.today, v = lastVM;
    const done = () => { save(); renderToday(); };
    if (a === 'roster') { go('roster'); if (v && v.target && v.type === 'work') Roster.openDay(v.target.key); else Roster.showDay(C.dayToKey(Math.floor(nowAbs() / 1440))); }
    else if (a === 'mode') { t.mode = b.dataset.k; done(); }
    else if (a === 'eat') { t.eat = b.dataset.k === '1'; done(); }
    else if (a === 'rest') { t.rest = b.dataset.k === '1'; done(); }
    else if (a === 'meal') timeSheet({ title: '자기 전 밥', val: t.meal, presets: PRESET_T, max: 240, onChange: x => { t.meal = x; done(); } });
    else if (a === 'dur') { const k = t.tasks[i]; timeSheet({ title: k.n + ' 시간', val: k.m, presets: PRESET_T, onChange: x => { k.m = x; done(); } }); }
    else if (a === 'del') { t.removed.push(t.tasks.splice(i, 1)[0]); done(); }
    else if (a === 'back') { t.tasks.push(t.removed.splice(i, 1)[0]); freshIdx = t.tasks.length - 1; done(); }
    else if (a === 'tpl') { const k = S.tpl[i]; t.tasks.push({ n: k.n, m: k.m }); freshIdx = t.tasks.length - 1; done(); }
    else if (a === 'add') addTaskSheet();
    else if (a === 'wake') timeSheet({ title: '일어날 시간', val: v.wakeClock, presets: WAKES, step: 10, wrap: true, show: m => fmt(m), onChange: x => { t.wake = x; done(); } });
  });

  /* ───────── ② 근무표 ───────── */
  const Roster = (function () {
    const el = $('#roster');
    const MONTHS = [];
    for (let i = 0; i < 8; i++) { const d = new Date(2026, 10 + i, 1); MONTHS.push([d.getFullYear(), d.getMonth()]); }
    const T = { A: [6, 14], B: [14, 22], C: [22, 30] }, f = h => String(mod(h, 24)).padStart(2, '0') + ':00';
    const keyOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const monthOf = k => MONTHS.findIndex(([y, m]) => k.startsWith(keyOf(y, m, 1).slice(0, 8)));
    let mode = 'ot', brush = 'B', cur = null, mi = 0, built = false, todayKey = '';
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
      track.addEventListener('scroll', () => {
        clearTimeout(st);
        st = setTimeout(() => { const i = Math.round(track.scrollLeft / track.clientWidth); if (i !== mi && i >= 0 && i < MONTHS.length) { mi = i; drawSide(); } }, 80);
      }, { passive: true });
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
      $$('[data-r="dots"] i', el).forEach((x, i) => x.classList.toggle('on', i === mi));
      const pn = r('track').children[mi]; if (pn) r('track').style.height = pn.offsetHeight + 'px';
      r('prev').disabled = mi === 0; r('next').disabled = mi === MONTHS.length - 1;
      $$('[data-r="mode"] button', el).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
      r('fill').style.display = mode === 'shift' ? '' : 'none';
      r('pal').innerHTML = mode === 'shift' ? [['A', 'A'], ['B', 'B'], ['C', 'C'], ['off', '휴무']].map(([k, l]) => `<button data-brush="${k}" class="${k === brush ? 'on' : ''}">${l}</button>`).join('') : '';
      r('pal').style.display = mode === 'shift' ? '' : 'none';
      r('hint').textContent = mode === 'shift'
        ? '처음엔 「한 번에 채우기」로 6월까지 채우고, 동료와 바꾼 날만 근무조를 고른 뒤 그 날짜를 누르세요.'
        : 'OT가 있는 날짜를 누르고 전OT·후OT를 고르면 저장돼요. 좌우로 밀면 다른 달로 넘어가요.';
      r('otlist').innerHTML = ks.length ? ks.map(k => {
        const v = S.roster[k], [a, b] = T[v.s];
        return `<div class="row2"><span>${md(k)} (${dow(k)}) · ${v.s}조<span class="when num">${f(v.ot === 'pre' ? a - 3 : a)}~${f(v.ot === 'post' ? b + 3 : b)}</span></span><span class="tag">${v.ot === 'pre' ? '전OT' : '후OT'}</span></div>`;
      }).join('') : '<div class="row2"><span style="color:var(--muted)">이 달은 OT가 없어요</span></div>';
    }
    function drawAll() { MONTHS.forEach((_, i) => drawMonth(i)); drawSide(); }
    function goMonth(i, smooth = true) {
      mi = clamp(i, 0, MONTHS.length - 1);
      const tr = r('track');
      tr.scrollTo({ left: mi * tr.clientWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' });
      drawSide();
    }
    function flash(sel) { $$(sel, el).forEach(c => { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }); }

    function openOT(k) {
      const prev = cur; cur = k;
      const v = S.roster[k], [a, b] = T[v.s];
      const draw = () => setSheet(`<h3>${md(k)} (${dow(k)}) · ${v.s}조 ${f(a)}~${f(b)}</h3><span class="label">시간은 앱이 계산해요 · 같은 버튼을 다시 누르면 취소</span>
        <div class="btns"><button data-ot="pre" class="${v.ot === 'pre' ? 'on' : ''}">전OT<small class="num">${f(a - 3)}부터 근무</small></button><button data-ot="post" class="${v.ot === 'post' ? 'on' : ''}">후OT<small class="num">${f(b + 3)}까지 근무</small></button></div>
        <button class="close" data-x>닫기</button>`);
      openSheet('', e => {
        const bt = e.target.closest('button'); if (!bt) return;
        if (bt.dataset.ot) { v.ot = v.ot === bt.dataset.ot ? '' : bt.dataset.ot; save(); draw(); drawMonth(monthOf(k)); drawSide(); }
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
        } else if (v.s !== 'off') openOT(k);
        return;
      }
      const b = e.target.closest('button,[data-i]'); if (!b) return;
      if (b.dataset.m) { mode = b.dataset.m; closeSheet(); cur = null; drawAll(); }
      else if (b.dataset.brush) { brush = b.dataset.brush; drawSide(); }
      else if (b.dataset.r === 'prev') goMonth(mi - 1);
      else if (b.dataset.r === 'next') goMonth(mi + 1);
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
      openDay(k) { render(); mode = 'ot'; drawAll(); const i = monthOf(k); if (i >= 0) { goMonth(i, false); if (S.roster[k] && S.roster[k].s !== 'off') openOT(k); } },
      showDay(k) { render(); const i = monthOf(k); if (i >= 0) goMonth(i, false); },
      relayout() { if (built) { goMonth(mi, false); } },
    };
  })();

  /* ───────── ③ 할 일 설정 ───────── */
  const tasksEl = $('#tasks');
  let freshBase = -1;
  function renderTasks() {
    const E = S.early, M = S.move;
    const moves = [['bus', '시내버스', '집 → 통근버스 정류장'], ['taxi', '택시', '집 → 통근버스 정류장'], ['car', '택시 · 차', '집 ↔ 회사 · 출퇴근 같음 · OT 날'], ['ride', '퇴근버스 → 집', '퇴근버스 출발부터 집 도착까지']];
    tasksEl.innerHTML = `<div class="month a1"><h2>할 일 설정</h2></div>
      <div class="sec a2"><div class="sec-t"><span class="label">매일 기본으로 넣을 할 일</span><span class="hint">⠿ 끌어서 순서 바꾸기</span></div>
        <div class="glass setlist" data-base>${S.base.map((k, i) => `<div class="srow${i === freshBase ? ' flashrow' : ''}" data-i="${i}">${GRIP}<span class="nm2">${esc(k.n)}${k.sub ? `<small>${esc(k.sub)}</small>` : ''}</span><button class="tpill num hit" data-act="bdur" data-i="${i}">${dur(k.m)}</button><button class="x hit" data-act="bdel" data-i="${i}" aria-label="빼기">×</button></div>`).join('')}
        <button class="addrow" data-act="addbase">+ 템플릿에서 기본으로 넣기</button></div></div>
      <div class="sec a3"><div class="sec-t"><span class="label">템플릿</span><span class="hint">오늘 화면에서 한 번에 추가</span></div>
        <div class="tpls">${S.tpl.map((t, i) => `<button data-act="tpl" data-i="${i}">${esc(t.n)}<small>${dur(t.m)}</small></button>`).join('')}<button class="new" data-act="newtpl">+ 템플릿 만들기</button></div></div>
      <div class="sec a4"><div class="sec-t"><span class="label">이동 시간</span><span class="hint">통근버스 정류장·회사까지</span></div>
        <div class="glass setlist">${moves.map(([k, n, sub]) => `<div class="srow"><span class="nm2">${n}<small>${sub}</small></span><button class="tpill num hit" data-act="move" data-k="${k}">${M[k]}분</button></div>`).join('')}</div></div>
      <div class="sec a4"><div class="sec-t"><span class="label">일찍 나가기</span><span class="hint">기상 시각도 그만큼 당겨져요</span></div>
        <div class="glass setlist"><div class="srow"><span class="nm2">일찍 나가기<small>계산된 출발보다 이만큼 먼저 나가요</small></span><button class="tpill num hit" data-act="early">${E.m ? E.m + '분' : '안 함'}</button></div>
        <div class="seg glass earlysc">${[['ot', 'OT로 직접 가는 날만'], ['all', '모든 날']].map(([k, l]) => `<button data-act="esc" data-k="${k}" class="${E.sc === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
      <div class="sec a4 themesec"><div class="sec-t"><span class="label">테마</span><span class="hint">누르면 바로 바뀌어요</span></div>
        <div class="seg glass">${THEMES.map(([k, l]) => `<button data-act="tc" data-k="${k}" class="${S.theme.c === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="seg glass">${[['l', '라이트'], ['d', '다크']].map(([k, l]) => `<button data-act="td" data-k="${k}" class="${S.theme.d === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <p class="credit">보름달 이미지: NASA's Scientific Visualization Studio (CGI Moon Kit, LRO 색 지도)${saveFailed ? '<br><b style="color:var(--accent)">저장 공간에 쓰지 못했어요. 사파리 개인정보 보호 모드인지 확인해 주세요.</b>' : ''}</p>`;
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
    else if (a === 'early') timeSheet({ title: '일찍 나가기', val: S.early.m, presets: PRESET_E, min: 0, max: 180, show: x => x ? x + '분' : '안 함', onChange: x => { S.early.m = x; done(); } });
    else if (a === 'esc') { S.early.sc = b.dataset.k; done(); }
    else if (a === 'tc') { S.theme.c = b.dataset.k; applyTheme(); done(); }
    else if (a === 'td') { S.theme.d = b.dataset.k; applyTheme(); done(); }
  });

  /* ───────── 탭 · 패럴랙스 · 시계 ───────── */
  const app = $('#app');
  const screens = { today: todayEl, roster: $('#roster'), tasks: tasksEl };
  function enter(sc) { sc.classList.add('enter'); clearTimeout(sc._t); sc._t = setTimeout(() => sc.classList.remove('enter'), 1100); }
  function go(tab) {
    closeSheet();
    app.dataset.tab = tab;
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'today') renderToday(); else if (tab === 'roster') Roster.render(); else renderTasks();
    enter(screens[tab]);
    app.style.setProperty('--sy', screens[tab].scrollTop);
  }
  $$('.tabbar button').forEach(b => (b.onclick = () => go(b.dataset.tab)));
  Object.entries(screens).forEach(([k, sc]) => sc.addEventListener('scroll', () => { if (app.dataset.tab === k) app.style.setProperty('--sy', sc.scrollTop); }, { passive: true }));
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
    if (d !== lastDay) { lastDay = d; Roster.render(); }
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
