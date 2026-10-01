// Tuffet 운영실 — 공개 페이지라 데이터는 하나도 담지 않는다.
// 파운더가 이 기기에 넣은 읽기 전용 GitHub 토큰으로 비공개 저장소를 직접 읽는다(index.html의 CSP가 api.github.com 외 연결을 막는다).
// 숫자(출시·매출·오류 등) = tuffet-ops `status` 브랜치의 status.json(매시 17분 watch가 씀). 이슈·PR·빌드 = 여는 순간의 GitHub 값.
(function () {
  'use strict';

  const OWNER = 'Leeseonj';
  const KEY = 'tuffet-ops-room.token';
  const POLL_MS = 2 * 60_000;
  // watch 간격: 출시 전 3시간, 출시 후 매시간(guard tick이 전환) — 간격의 1.5배 넘게 안 바뀌면 멈춘 것
  const staleMin = (s) => (s.now && s.now.store && s.now.store.live ? 90 : 270);

  const $ = (id) => document.getElementById(id);
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs || {}) { if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  };
  const kst = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const minsAgo = (iso) => Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const ago = (iso) => {
    if (!iso || isNaN(Date.parse(iso))) return '—';
    const m = minsAgo(iso);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    if (m < 60 * 36) return `${Math.floor(m / 60)}시간 전`;
    return `${Math.floor(m / 1440)}일 전`;
  };
  const pill = (cls, text) => h('span', { class: `pill ${cls}` }, text);
  const link = (url, text) => (url && /^https:\/\//.test(url) ? h('a', { href: url, rel: 'noopener' }, text) : text);
  const row = (dotCls, content, right) => h('li', {}, h('span', { class: `dot ${dotCls || ''}` }), h('span', { class: 'txt' }, content), h('span', { class: 't' }, right || ''));
  const setList = (id, items, emptyText) => $(id).replaceChildren(...(items.length ? items : [row('', h('span', { class: 'muted' }, emptyText))]));
  const setCell = (key, value, p) => {
    const v = $(`n-${key}`); v.textContent = value; v.classList.remove('skel');
    $(`p-${key}`).replaceChildren(p || '');
  };
  const setFresh = (cls, label, text) => { $('fresh').className = `pill ${cls}`; $('fresh').textContent = label; $('freshText').textContent = text; };

  // ---------- 토큰 ----------
  const store = {
    get() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } },
    set(v) { try { localStorage.setItem(KEY, v); return true; } catch (e) { return false; } },
    clear() { try { localStorage.removeItem(KEY); } catch (e) { /* 없음 */ } },
  };
  let memToken = ''; // 저장소가 막힌 브라우저(사생활 모드 등)에선 이 탭 동안만 쓴다

  // ---------- GitHub ----------
  class GhError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  // mode: undefined → JSON · 'raw' → 파일 원문 · 'html' → GitHub이 렌더한 마크다운(HTML 텍스트) · 'htmljson' → body_html이 붙은 JSON
  const ACCEPT = { raw: 'application/vnd.github.raw+json', html: 'application/vnd.github.html+json', htmljson: 'application/vnd.github.html+json' };
  async function gh(path, mode) {
    if (mode === true) mode = 'raw';
    let res;
    try {
      res = await fetch('https://api.github.com' + path, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token()}`, Accept: ACCEPT[mode] || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
    } catch (e) { throw new GhError(0, '네트워크 연결 실패'); }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch (e) { /* 본문 없음 */ }
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') msg = 'GitHub 요청 한도 초과 — 잠시 뒤 자동으로 다시 읽는다';
      throw new GhError(res.status, msg || `HTTP ${res.status}`);
    }
    return mode === 'raw' || mode === 'html' ? res.text() : res.json();
  }
  const token = () => store.get() || memToken;
  const why = (e, repo) => {
    if (e.status === 404 || e.status === 403) return `못 읽음 — 토큰에 ${repo} 읽기 권한이 없다(${e.status}).`;
    return `못 읽음 — ${e.message}`;
  };

  // ---------- 그리기 ----------
  const REVIEW = {
    WAITING_FOR_REVIEW: ['심사 대기', 'idle'], IN_REVIEW: ['심사 중', 'warn'], PENDING_DEVELOPER_RELEASE: ['출시 대기', 'ok'],
    READY_FOR_SALE: ['판매 중', 'ok'], REJECTED: ['반려', 'crit'], METADATA_REJECTED: ['정보 반려', 'crit'],
    PREPARE_FOR_SUBMISSION: ['제출 준비', 'idle'], DEVELOPER_REJECTED: ['제출 철회', 'warn'], PROCESSING_FOR_APP_STORE: ['처리 중', 'idle'],
  };
  const WF = { release: '빌드·제출', deploy: '서버 배포', sync: '보호 동기화' };
  const EVENT = { schedule: '예약', push: '반영', workflow_dispatch: '수동' };

  function renderStatus(s, attn) {
    const n = s.now || {};
    const stale = minsAgo(s.at) > staleMin(s);
    if (stale) attn.push(['warn', `숫자가 ${ago(s.at)} 이후 안 바뀜`, '감시(watch)가 멈췄다. tuffet-ops Actions의 watch 실행 로그를 본다.', `https://github.com/${OWNER}/tuffet-ops/actions/workflows/watch.yml`]);

    const st = n.store;
    if (!st) setCell('store', '못 읽음', pill('idle', '수집 실패'));
    else setCell('store', st.live ? `출시됨 v${st.version ?? '?'}` : '아직 출시 전', pill(st.live ? 'ok' : 'idle', st.live ? '판매 중' : '미출시'));
    const rv = Array.isArray(n.review) ? n.review : null;
    if (rv && rv.length) {
      const m = rv.map((r) => REVIEW[r.state] || [r.state, 'idle']);
      setCell('review', rv.map((r, i) => `v${r.version} ${m[i][0]}`).join(', '), pill(m[0][1], m[0][0]));
      rv.forEach((r, i) => { if (m[i][1] === 'crit') attn.push(['crit', `v${r.version} ${m[i][0]}`, 'App Store Connect에서 반려 사유를 확인한다.', 'https://appstoreconnect.apple.com/apps']); });
    } else setCell('review', rv ? '진행 중인 버전 없음' : '못 읽음', pill('idle', rv ? '없음' : '수집 실패'));
    const unknown = [n.subs, n.trials, n.mrr].some((x) => x === '—' || x == null);
    setCell('money', unknown ? '못 읽음' : `${n.subs} · ${n.trials} · $${n.mrr}`, pill(Number(n.subs) > 0 ? 'ok' : 'idle', unknown ? '수집 실패' : Number(n.subs) > 0 ? '매출 있음' : '아직 0'));
    if (n.usage) {
      $('k-usage').textContent = `최근 사용 (${n.usage.day})`;
      setCell('usage', `세션 ${n.usage.sessions ?? '—'} · 사용자 ${n.usage.users ?? '—'}`, pill(Number(n.usage.users) > 0 ? 'ok' : 'idle', Number(n.usage.users) > 0 ? '사용 중' : '0명'));
    } else setCell('usage', '못 읽음', pill('idle', '수집 실패'));
    if (n.serverErrors == null) setCell('err', '못 읽음', pill('idle', '수집 실패'));
    else setCell('err', `${n.serverErrors}건`, pill(n.serverErrors >= 5 ? 'crit' : n.serverErrors > 0 ? 'warn' : 'ok', n.serverErrors >= 5 ? '급증' : n.serverErrors > 0 ? '조금 있음' : '조용함'));
    if (n.pushTokens == null) setCell('push', '못 읽음', pill('idle', '수집 실패'));
    else setCell('push', `${n.pushTokens}대`, pill(n.pushTokens > 0 ? 'ok' : 'warn', n.pushTokens > 0 ? '받는 중' : '0대'));
    for (const a of n.alerts || []) attn.push(['crit', a.title, '이번 시간 감시가 잡은 이상 신호. 같은 제목의 🚨 이슈에 자세한 내용이 있다.', `https://github.com/${OWNER}/tuffet-ops/issues?q=is%3Aopen+label%3Aalert`]);
    const bad = (n.sources || []).filter((x) => x.status === 'error').map((x) => x.source);
    if (bad.length && !(n.alerts || []).length) attn.push(['warn', `수집 실패: ${bad.join(', ')}`, '이 출처의 숫자는 "못 읽음"으로 표시된다.']);

    const ag = s.agents || {};
    const w = ag.worker || {};
    setList('agents', [
      row(ag.report ? 'ok' : '', ['매일 보고 ', h('span', { class: 'muted' }, '09:07 · '), ag.report ? link(`https://github.com/${OWNER}/tuffet-ops/blob/main/reports/${encodeURIComponent(ag.report)}`, ag.report) : '아직 없음']),
      row(ag.content ? 'ok' : '', ['콘텐츠 ', h('span', { class: 'muted' }, '22:07·08:07 · '), ag.content ? ag.content.replace(/^\|\s*/, '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 3).join(' · ') : '아직 없음 (출시 전 게시 잠김)']),
      row(ag.dev && ag.dev.open ? 'warn' : '', ['개발 ', h('span', { class: 'muted' }, '13:07 · '), `대기 ${ag.dev?.open ?? '—'} · 처리됨 ${ag.dev?.other ?? '—'}`]),
      row(w.todayCalls >= w.cap ? 'warn' : 'ok', ['작업자 ', h('span', { class: 'muted' }, '매시간 · '), `오늘 호출 ${w.todayCalls ?? '—'}/${w.cap ?? 6}`]),
    ], '');
    $('worker-count').textContent = `대기 ${w.open ?? '—'} · 끝남 ${w.other ?? '—'}`;
    setList('queue', (w.queue || []).map((q) => {
      const [file, st2 = ''] = String(q).split(' — ');
      const open = /^open/.test(st2);
      return row(open ? 'warn' : 'ok', link(`https://github.com/${OWNER}/tuffet-ops/blob/main/tasks/worker/${encodeURIComponent(file)}`, file.replace(/\.md$/, '')), open ? '대기' : st2.split(' ')[0]);
    }), '작업 없음');
    const j = (s.journal || []).map((l) => String(l).replace(/^-\s*/, ''));
    $('journal').replaceChildren(...(j.length ? j.slice().reverse().map((l) => h('li', {}, l)) : [h('li', { class: 'muted' }, '없음')]));
    return stale;
  }

  function renderRuns(runs, attn) {
    setList('runs', runs.slice(0, 8).map((r) => {
      const cls = r.status !== 'completed' ? 'warn' : r.conclusion === 'success' ? 'ok' : r.conclusion === 'failure' ? 'crit' : '';
      const state = r.status !== 'completed' ? '진행 중' : r.conclusion === 'success' ? '성공' : r.conclusion === 'failure' ? '실패' : (r.conclusion || r.status);
      return row(cls, [h('a', { href: '#/runs' }, `${WF[r.name] || r.name} · ${state}`), h('span', { class: 'muted' }, ` · ${EVENT[r.event] || r.event}`)], ago(r.created_at));
    }), '실행 기록 없음');
    const latest = {};
    for (const r of runs) if (!latest[r.name] && r.status === 'completed') latest[r.name] = r;
    for (const [wf, r] of Object.entries(latest)) if (r.conclusion === 'failure') attn.push(['crit', `${WF[wf] || wf} 최근 실행 실패`, `${ago(r.created_at)} · 🚨 이슈가 따로 열렸는지 확인한다.`, r.html_url]);
    if (runs.length >= 5 && !runs.some((r) => r.event === 'schedule')) attn.push(['warn', `guard 예약 실행 0회 (최근 ${runs.length}회 중)`, 'tick 예약이 안 돌고 있다. 계속 0이면 빌드·배포가 자동으로 안 나간다 — tick을 수동 실행한다.', `https://github.com/${OWNER}/tuffet-guard/actions/workflows/tick.yml`]);
  }

  function renderIssues(issues, attn) {
    setList('issues', issues.map((i) => {
      const labels = (i.labels || []).map((l) => l.name);
      const cls = labels.includes('alert') ? 'crit' : labels.includes('constitution') ? 'warn' : '';
      return row(cls, [h('span', { class: 'muted' }, `#${i.number} `), h('a', { href: `#/issues/${i.number}` }, i.title)], ago(i.created_at));
    }), '열린 이슈 없음');
    const has = (i, l) => (i.labels || []).some((x) => x.name === l);
    const alerts = issues.filter((i) => has(i, 'alert'));
    const cons = issues.filter((i) => has(i, 'constitution'));
    if (alerts.length) attn.push(['crit', `열린 🚨 알림 이슈 ${alerts.length}개`, alerts.map((i) => `#${i.number}`).join(' '), '#/issues']);
    if (cons.length) attn.push(['idle', `열린 헌법·보호 이슈 ${cons.length}개`, '기록용이면 설명 달고 닫아도 된다.', `https://github.com/${OWNER}/tuffet-ops/issues?q=is%3Aopen+label%3Aconstitution`]);
  }

  function renderAttn(attn) {
    const order = { crit: 0, warn: 1, idle: 2, ok: 3 };
    attn.sort((a, b) => order[a[0]] - order[b[0]]);
    $('attn').replaceChildren(...(attn.length
      ? attn.map(([cls, title, detail, url]) => h('div', { class: 'row' }, pill(cls, cls === 'crit' ? '지금' : cls === 'warn' ? '확인' : '참고'), h('p', {}, url ? link(url, title) : title, detail ? h('small', {}, detail) : null)))
      : [h('div', { class: 'row' }, pill('ok', '없음'), h('p', {}, '지금 손댈 것 없음', h('small', {}, '알림·승인 대기·실패가 생기면 여기에 모인다.')))]));
  }

  // ---------- 불러오기 ----------
  let busy = false;
  async function load() {
    if (busy || !token()) return;
    busy = true;
    $('refresh').disabled = true;
    const attn = [];
    const results = await Promise.allSettled([
      gh(`/repos/${OWNER}/tuffet-ops/contents/status.json?ref=status`, true).then((t) => JSON.parse(t)),
      gh(`/repos/${OWNER}/tuffet-guard/actions/runs?per_page=15`).then((d) => d.workflow_runs || []),
      gh(`/repos/${OWNER}/tuffet-ops/issues?state=open&per_page=30`).then((d) => d.filter((i) => !i.pull_request)),
      gh(`/repos/${OWNER}/tuffet-app/pulls?state=open&per_page=30`),
      gh(`/repos/${OWNER}/tuffet-functions/pulls?state=open&per_page=30`),
    ]);
    busy = false;
    $('refresh').disabled = false;

    // 토큰 자체가 틀리면(401) 섹션별 오류 대신 다시 넣게 한다.
    if (results.some((r) => r.status === 'rejected' && r.reason.status === 401)) {
      store.clear(); memToken = '';
      return showSetup('토큰이 거절됐다(만료됐거나 잘못 붙여 넣음). 새로 만들어 넣는다.');
    }
    const [status, runs, issues, appPrs, fnPrs] = results;

    let stale = false;
    if (status.status === 'fulfilled') stale = renderStatus(status.value, attn);
    else {
      const e = status.reason;
      const msg = e.status === 404 ? '아직 status.json이 없다 — 다음 매시 17분 감시부터 생긴다.' : why(e, 'tuffet-ops');
      for (const k of ['store', 'review', 'money', 'usage', 'err', 'push']) setCell(k, '—', pill('idle', '못 읽음'));
      setList('agents', [], msg); setList('queue', [], msg);
      attn.push(['warn', '숫자(status.json)를 못 읽음', msg]);
    }
    if (runs.status === 'fulfilled') renderRuns(runs.value, attn);
    else { setList('runs', [], why(runs.reason, 'tuffet-guard')); attn.push(['warn', '빌드 기록을 못 읽음', why(runs.reason, 'tuffet-guard')]); }
    if (issues.status === 'fulfilled') renderIssues(issues.value, attn);
    else setList('issues', [], why(issues.reason, 'tuffet-ops'));

    const prs = [];
    const prErr = [];
    for (const [r, name, label] of [[appPrs, 'tuffet-app', '앱'], [fnPrs, 'tuffet-functions', '서버']]) {
      if (r.status === 'fulfilled') prs.push(...r.value.map((p) => ({ ...p, repo: label })));
      else prErr.push(why(r.reason, name));
    }
    setList('prs', [
      ...prs.map((p) => row(p.draft ? '' : 'warn', [h('span', { class: 'muted' }, `${p.repo} #${p.number} `), h('a', { href: `#/prs/${p.base.repo.name}/${p.number}` }, p.title)], ago(p.created_at))),
      ...prErr.map((m) => row('', h('span', { class: 'muted' }, m))),
    ], '승인 기다리는 코드 없음');
    const ready = prs.filter((p) => !p.draft);
    if (ready.length) attn.push(['warn', `코드 승인 대기 PR ${ready.length}개`, '병합 = 승인, 닫으면 거절. 이것만 파운더 몫이다.', ready.length === 1 ? `#/prs/${ready[0].base.repo.name}/${ready[0].number}` : '#/prs']);
    if (prErr.length) attn.push(['warn', 'PR 목록 일부를 못 읽음', prErr.join(' ')]);

    renderAttn(attn);
    const failed = results.filter((r) => r.status === 'rejected').length;
    const at = status.status === 'fulfilled' ? status.value.at : null;
    setFresh(failed || stale ? 'warn' : 'ok', failed ? '일부 못 읽음' : stale ? '숫자 멈춤' : '최신',
      `${at ? `숫자 ${kst.format(new Date(at))} KST (${ago(at)}) · ` : ''}이슈·PR·빌드 ${kst.format(new Date())} 기준 · 2분마다 다시 읽음`);
  }

  // ---------- 설정 화면 ----------
  function showSetup(err) {
    $('setup').hidden = false;
    $('forget').hidden = true;
    $('refresh').disabled = true;
    setFresh('idle', '토큰 필요', '이 기기에 읽기 전용 토큰을 한 번 넣으면 상태가 보인다.');
    const p = $('setupErr');
    p.hidden = !err; p.textContent = err || '';
    $('token').focus();
  }
  $('tokenForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = $('token').value.trim();
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(v)) { $('setupErr').hidden = false; $('setupErr').textContent = '토큰 형식이 아니다 — github_pat_ 으로 시작하는 값을 그대로 붙여 넣는다.'; return; }
    if (!store.set(v)) memToken = v; // 저장이 막혔으면 이 탭에서만
    $('token').value = '';
    $('setup').hidden = true;
    $('forget').hidden = false;
    setFresh('idle', '읽는 중', 'GitHub에서 읽는 중…');
    route();
  });
  $('forget').addEventListener('click', () => { store.clear(); memToken = ''; showSetup(); });

  // ---------- 페이지 이동(#/경로) ----------
  const current = () => { try { return decodeURIComponent(location.hash.replace(/^#/, '')) || '/'; } catch (e) { return '/'; } };
  const isHome = () => current() === '/';
  const ctx = { OWNER, gh, h, ago, kst, pill, link, row, why, authFail: () => { store.clear(); memToken = ''; showSetup('토큰이 거절됐다(만료됐거나 잘못 붙여 넣음). 새로 만들어 넣는다.'); } };
  function route() {
    const r = current();
    for (const a of document.querySelectorAll('#tabs a')) {
      const t = a.getAttribute('href').slice(1);
      if (t === '/' ? r === '/' : r === t || r.startsWith(t + '/')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (!token()) return showSetup();
    $('home').hidden = !isHome();
    $('page').hidden = isHome();
    if (isHome()) return load();
    window.scrollTo(0, 0);
    window.OpsRoomPages.render(r, $('page'), ctx);
  }
  window.addEventListener('hashchange', route);
  $('refresh').addEventListener('click', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isHome()) load(); });
  setInterval(() => { if (!document.hidden && isHome()) load(); }, POLL_MS);

  if (token()) { $('forget').hidden = false; setFresh('idle', '읽는 중', 'GitHub에서 읽는 중…'); }
  route();
})();
