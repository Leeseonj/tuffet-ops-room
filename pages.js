// 운영실의 홈 밖 페이지들 — 보고서·알림·PR·빌드·콘텐츠·문서. app.js의 라우터가 render(경로, 자리, ctx)로 부른다.
// 마크다운은 GitHub이 렌더해 준 HTML을 그대로 쓴다(GitHub이 정제하고, index.html의 CSP가 스크립트 실행을 막는다).
(function () {
  'use strict';

  const OPS = 'tuffet-ops';
  const WF = { release: '빌드·제출', deploy: '서버 배포', sync: '보호 동기화', tick: '정기 점검', 'publish-social': 'SNS 게시', 'refresh-social': 'SNS 토큰 갱신', watch: '감시', 'constitution-guard': '헌법 감시', 'report-to-issue': '보고 → 이슈', 'agent-pr': '에이전트 PR' };
  const EVENT = { schedule: '예약', push: '반영', workflow_dispatch: '수동', issues: '이슈', pull_request: 'PR' };
  const LABEL = { alert: '🚨 알림', constitution: '🛑 헌법·보호', 'daily-report': '매일 보고' };
  const REPO_KO = { 'tuffet-app': '앱', 'tuffet-functions': '서버' };

  let seq = 0; // 늦게 도착한 이전 페이지 응답이 새 페이지를 덮지 않게

  function render(route, el, c) {
    const my = ++seq;
    const live = () => my === seq;
    const { h } = c;
    const parts = route.split('/').filter(Boolean);
    const put = (...kids) => { if (live()) el.replaceChildren(...kids); };
    const fail = (e, what) => {
      if (e && e.status === 401) return c.authFail();
      put(h('h2', {}, what), h('div', { class: 'notice warn' }, h('p', {}, e && e.status === 404 ? '없거나 토큰에 이 저장소 읽기 권한이 없다(404).' : `못 읽음 — ${(e && e.message) || e}`)));
    };
    put(h('p', { class: 'muted' }, '읽는 중…'));
    const views = { reports, issues, prs, runs, content, docs };
    const v = views[parts[0]];
    if (!v) return put(h('h2', {}, '없는 페이지'), h('p', {}, h('a', { href: '#/' }, '홈으로')));
    v(parts.slice(1), { ...c, put, fail, live }).catch((e) => fail(e, '읽기 실패'));
  }

  // ---------- 공용 ----------
  const sortDesc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);
  function md(c, html, basePath) {
    const box = c.h('div', { class: 'md' });
    box.innerHTML = html;
    for (const a of box.querySelectorAll('a.anchor, a[aria-label^="Permalink"]')) a.remove(); // 제목 옆 🔗 아이콘
    for (const a of box.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (href.startsWith('#')) { a.removeAttribute('href'); continue; } // 제목 앵커 — 라우터와 충돌
      if (/^[a-z]+:/i.test(href)) { a.rel = 'noopener'; continue; }
      // 저장소 안 상대 경로 → 문서 페이지
      const resolved = resolvePath(basePath || '', href.split('#')[0]);
      a.setAttribute('href', `#/docs/${resolved}`);
    }
    for (const img of box.querySelectorAll('img')) img.replaceWith(c.h('span', { class: 'muted' }, `[이미지: ${img.getAttribute('alt') || '표시 안 함'}]`));
    return box;
  }
  function resolvePath(base, rel) {
    const out = base.split('/').slice(0, -1);
    for (const p of rel.split('/')) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    return out.join('/');
  }
  const crumbs = (c, items) => c.h('nav', { class: 'crumbs', 'aria-label': '위치' }, ...items.flatMap((it, i) => [i ? ' / ' : '', it[1] ? c.h('a', { href: it[1] }, it[0]) : c.h('span', {}, it[0])]));
  const ghLink = (c, url, text) => c.h('a', { href: url, rel: 'noopener', class: 'out' }, text || 'GitHub에서 열기 ↗');
  const ul = (c, items, empty) => c.h('ul', { class: 'list' }, ...(items.length ? items : [c.row('', c.h('span', { class: 'muted' }, empty))]));
  const chips = (c, items) => c.h('div', { class: 'chips' }, ...items);
  const dir = (c, repo, path) => c.gh(`/repos/${c.OWNER}/${repo}/contents/${path}`).then((d) => (Array.isArray(d) ? d.filter((f) => f.name !== '.gitkeep') : []));

  // ---------- 보고서 ----------
  async function reports(args, c) {
    const { h } = c;
    const files = (await dir(c, OPS, 'reports')).filter((f) => f.name.endsWith('.md')).map((f) => f.name).sort(sortDesc);
    if (!files.length) return c.put(h('h2', {}, '매일 보고서'), h('p', { class: 'muted' }, '아직 보고서가 없다. 매일 09:07에 생긴다.'));
    const name = args[0] && files.includes(args[0]) ? args[0] : files[0];
    const html = await c.gh(`/repos/${c.OWNER}/${OPS}/contents/reports/${encodeURIComponent(name)}`, 'html');
    c.put(
      h('h2', {}, '매일 보고서'),
      chips(c, files.slice(0, 31).map((f) => h('a', { href: `#/reports/${f}`, class: 'chip', ...(f === name ? { 'aria-current': 'page' } : {}) }, f.replace(/\.md$/, '')))),
      h('div', { class: 'doc' }, h('div', { class: 'dochead' }, h('h3', {}, name.replace(/\.md$/, '')), ghLink(c, `https://github.com/${c.OWNER}/${OPS}/blob/main/reports/${name}`)), md(c, html, `reports/${name}`)),
    );
  }

  // ---------- 알림·이슈 ----------
  async function issues(args, c) {
    const { h } = c;
    if (args[0] && /^\d+$/.test(args[0])) return issueOne(args[0], c);
    const state = args[0] === 'closed' ? 'closed' : 'open';
    const list = (await c.gh(`/repos/${c.OWNER}/${OPS}/issues?state=${state}&per_page=50`)).filter((i) => !i.pull_request);
    const labelOf = (i) => (i.labels || []).map((l) => LABEL[l.name] || l.name).join(' · ');
    c.put(
      h('h2', {}, '알림·이슈'),
      chips(c, [h('a', { href: '#/issues', class: 'chip', ...(state === 'open' ? { 'aria-current': 'page' } : {}) }, '열림'), h('a', { href: '#/issues/closed', class: 'chip', ...(state === 'closed' ? { 'aria-current': 'page' } : {}) }, '닫힘(최근 50)')]),
      h('div', { class: 'panel' }, ul(c, list.map((i) => {
        const names = (i.labels || []).map((l) => l.name);
        const cls = names.includes('alert') ? 'crit' : names.includes('constitution') ? 'warn' : '';
        return c.row(state === 'open' ? cls : '', [h('span', { class: 'muted' }, `#${i.number} `), h('a', { href: `#/issues/${i.number}` }, i.title), labelOf(i) ? h('small', { class: 'tag' }, labelOf(i)) : null], c.ago(i.created_at));
      }), state === 'open' ? '열린 이슈 없음' : '닫힌 이슈 없음')),
    );
  }
  async function issueOne(n, c) {
    const { h } = c;
    const [i, comments] = await Promise.all([
      c.gh(`/repos/${c.OWNER}/${OPS}/issues/${n}`, 'htmljson'),
      c.gh(`/repos/${c.OWNER}/${OPS}/issues/${n}/comments?per_page=50`, 'htmljson'),
    ]);
    c.put(
      crumbs(c, [['알림·이슈', '#/issues'], [`#${n}`]]),
      h('div', { class: 'doc' },
        h('div', { class: 'dochead' }, h('h2', {}, i.title), ghLink(c, i.html_url)),
        h('p', { class: 'meta' }, c.pill(i.state === 'open' ? 'warn' : 'idle', i.state === 'open' ? '열림' : '닫힘'), ` ${c.kst.format(new Date(i.created_at))} KST · ${(i.labels || []).map((l) => LABEL[l.name] || l.name).join(' · ')}`),
        md(c, i.body_html || '<p>(본문 없음)</p>'),
        ...comments.map((cm) => h('div', { class: 'comment' }, h('p', { class: 'meta' }, `${cm.user && cm.user.login} · ${c.ago(cm.created_at)}`), md(c, cm.body_html || ''))),
      ),
    );
  }

  // ---------- PR ----------
  async function prs(args, c) {
    const { h } = c;
    if (args[0] && args[1]) return prOne(args[0], args[1], c);
    const res = await Promise.allSettled(['tuffet-app', 'tuffet-functions'].map((r) => c.gh(`/repos/${c.OWNER}/${r}/pulls?state=all&per_page=20`)));
    if (res.some((r) => r.status === 'rejected' && r.reason.status === 401)) return c.authFail();
    const rows = [];
    const errs = [];
    res.forEach((r, k) => {
      const repo = k ? 'tuffet-functions' : 'tuffet-app';
      if (r.status === 'rejected') return errs.push(c.why(r.reason, repo));
      for (const p of r.value) rows.push({ ...p, repo });
    });
    rows.sort((a, b) => sortDesc(a.created_at, b.created_at));
    const state = (p) => (p.merged_at ? ['ok', '병합됨'] : p.state === 'closed' ? ['idle', '닫힘'] : p.draft ? ['idle', '초안'] : ['warn', '승인 대기']);
    c.put(
      h('h2', {}, '코드 승인(PR)'),
      h('p', { class: 'lede' }, '사람이 승인하는 건 이것뿐이다. 병합 = 승인, 닫으면 거절 — 버튼은 GitHub에 있다(이 사이트 토큰은 읽기 전용).'),
      h('div', { class: 'panel' }, ul(c, [
        ...rows.map((p) => { const [cls, txt] = state(p); return c.row(cls, [h('span', { class: 'muted' }, `${REPO_KO[p.repo]} #${p.number} `), h('a', { href: `#/prs/${p.repo}/${p.number}` }, p.title), h('small', { class: 'tag' }, txt)], c.ago(p.created_at)); }),
        ...errs.map((m) => c.row('', h('span', { class: 'muted' }, m))),
      ], '아직 PR이 없다')),
    );
  }
  async function prOne(repo, n, c) {
    const { h } = c;
    if (!REPO_KO[repo] || !/^\d+$/.test(n)) return c.put(h('p', {}, '잘못된 PR 주소'));
    const [p, files] = await Promise.all([
      c.gh(`/repos/${c.OWNER}/${repo}/pulls/${n}`, 'htmljson'),
      c.gh(`/repos/${c.OWNER}/${repo}/pulls/${n}/files?per_page=100`),
    ]);
    const st = p.merged_at ? c.pill('ok', '병합됨') : p.state === 'closed' ? c.pill('idle', '닫힘') : c.pill('warn', '승인 대기');
    c.put(
      crumbs(c, [['코드 승인(PR)', '#/prs'], [`${REPO_KO[repo]} #${n}`]]),
      h('div', { class: 'doc' },
        h('div', { class: 'dochead' }, h('h2', {}, p.title), ghLink(c, p.html_url, p.state === 'open' ? 'GitHub에서 승인·거절 ↗' : 'GitHub에서 열기 ↗')),
        h('p', { class: 'meta' }, st, ` ${c.kst.format(new Date(p.created_at))} KST · ${p.user && p.user.login} · 파일 ${p.changed_files}개 +${p.additions} −${p.deletions}`),
        md(c, p.body_html || '<p>(설명 없음)</p>'),
        h('h3', {}, '바뀐 파일'),
        ul(c, files.map((f) => c.row(f.status === 'added' ? 'ok' : f.status === 'removed' ? 'crit' : '', h('span', { class: 'mono' }, f.filename), `+${f.additions} −${f.deletions}`)), '없음'),
      ),
    );
  }

  // ---------- 빌드·배포·감시 ----------
  async function runs(args, c) {
    const { h } = c;
    const [g, o] = await Promise.allSettled([
      c.gh(`/repos/${c.OWNER}/tuffet-guard/actions/runs?per_page=30`),
      c.gh(`/repos/${c.OWNER}/${OPS}/actions/runs?per_page=30`),
    ]);
    if ([g, o].some((r) => r.status === 'rejected' && r.reason.status === 401)) return c.authFail();
    // 실패한 실행은 어느 단계에서 멈췄는지 한 번 더 읽는다(최근 8건까지 — 요청 수 제한).
    const failedStep = new Map();
    const failed = [g, o].flatMap((r, k) => (r.status === 'fulfilled' ? r.value.workflow_runs.filter((x) => x.conclusion === 'failure').map((x) => [k ? OPS : 'tuffet-guard', x]) : [])).slice(0, 8);
    await Promise.all(failed.map(([repo, x]) => c.gh(`/repos/${c.OWNER}/${repo}/actions/runs/${x.id}/jobs`).then((j) => {
      const step = (j.jobs || []).flatMap((jb) => jb.steps || []).find((s) => s.conclusion === 'failure');
      if (step) failedStep.set(x.id, step.name);
    }).catch(() => {})));
    const section = (title, sub, r, repo) => {
      if (r.status === 'rejected') return h('div', { class: 'panel' }, h('h3', {}, title), h('p', { class: 'muted' }, c.why(r.reason, repo)));
      const list = r.value.workflow_runs || [];
      return h('div', { class: 'panel' },
        h('div', { class: 'head' }, h('h3', {}, title, ' ', h('span', { class: 'muted' }, sub)), h('small', {}, ghLink(c, `https://github.com/${c.OWNER}/${repo}/actions`, '전체 ↗'))),
        ul(c, list.map((x) => {
          const cls = x.status !== 'completed' ? 'warn' : x.conclusion === 'success' ? 'ok' : x.conclusion === 'failure' ? 'crit' : '';
          const st = x.status !== 'completed' ? '진행 중' : x.conclusion === 'success' ? '성공' : x.conclusion === 'failure' ? '실패' : x.conclusion === 'skipped' ? '건너뜀' : (x.conclusion || x.status);
          return c.row(cls, [c.link(x.html_url, `${WF[x.name] || x.name} · ${st}`), h('span', { class: 'muted' }, ` · ${EVENT[x.event] || x.event}`), failedStep.has(x.id) ? h('small', { class: 'tag crit-t' }, `멈춘 단계: ${failedStep.get(x.id)}`) : null], c.ago(x.created_at));
        }), '실행 기록 없음'));
    };
    c.put(
      h('h2', {}, '빌드·배포·감시'),
      h('p', { class: 'lede' }, '정기 점검(tick)이 새 코드가 있을 때만 빌드·배포를 불러낸다. 출시 전에는 3시간마다·빌드 쉼(수동 실행은 됨), 출시 후 매시간. 실패하면 🚨 이슈가 따로 열린다.'),
      h('div', { class: 'cols' }, section('빌드·제출·배포', '(tuffet-guard)', g, 'tuffet-guard'), section('감시·작업자', '(tuffet-ops)', o, OPS)),
    );
  }

  // ---------- 콘텐츠 ----------
  async function content(args, c) {
    const { h } = c;
    const [log, drafts, seo] = await Promise.allSettled([
      c.gh(`/repos/${c.OWNER}/${OPS}/contents/content/log.md`, 'html'),
      dir(c, OPS, 'content/drafts'),
      dir(c, OPS, 'content/seo-drafts'),
    ]);
    if ([log, drafts, seo].some((r) => r.status === 'rejected' && r.reason.status === 401)) return c.authFail();
    const files = (r, empty) => (r.status === 'rejected' ? h('p', { class: 'muted' }, c.why(r.reason, OPS))
      : ul(c, r.value.filter((f) => f.type === 'file').sort((a, b) => sortDesc(a.name, b.name)).map((f) => c.row('', h('a', { href: `#/docs/${f.path}` }, f.name.replace(/\.md$/, '')))), empty));
    c.put(
      h('h2', {}, '콘텐츠'),
      h('p', { class: 'lede' }, '출시 전이라 게시는 코드가 막고 있고, 초안과 검토 기록만 쌓인다. 출시 후엔 게시물마다 반응(조회·좋아요)도 여기에 붙인다.'),
      h('div', { class: 'cols' },
        h('div', { class: 'panel' }, h('h3', {}, '인스타·스레드 초안'), files(drafts, '초안 없음')),
        h('div', { class: 'panel' }, h('h3', {}, '검색 유입용 글(SEO) 초안'), files(seo, '초안 없음')),
      ),
      h('div', { class: 'doc' }, h('div', { class: 'dochead' }, h('h3', {}, '게시 기록'), ghLink(c, `https://github.com/${c.OWNER}/${OPS}/blob/main/content/log.md`)),
        log.status === 'fulfilled' ? md(c, log.value, 'content/log.md') : h('p', { class: 'muted' }, c.why(log.reason, OPS))),
      h('p', { class: 'muted' }, '이미지는 아직 저장소에 남기지 않는다(만든 뒤 게시 단계에서만 씀).'),
    );
  }

  // ---------- 문서(운영 저장소) ----------
  const SHELF = [
    ['헌법', 'constitution/CONSTITUTION.md', '에이전트가 넘지 못하는 선'],
    ['사명', 'constitution/charter.md', '무엇을 위해 일하나'],
    ['전략', 'strategy.md', '지금의 운영 전략'],
    ['확인된 사실', 'memory/facts.md', '에이전트가 믿고 쓰는 사실'],
    ['일지', 'memory/journal', '에이전트들이 매번 남기는 기록'],
    ['플레이북', 'memory/playbooks', '반복 작업 요령·알려진 문제'],
    ['루틴 지시문', 'routines', '매일 보고·콘텐츠·개발 루틴이 받는 지시'],
    ['다음 버전 스토어 정보', 'store/next.json', '다음 제출 때 자동 적용'],
    ['작업 대기열', 'tasks', '개발·작업자 할 일'],
  ];
  async function docs(args, c) {
    const { h } = c;
    const path = args.join('/');
    if (!path) {
      return c.put(
        h('h2', {}, '문서'),
        h('p', { class: 'lede' }, '운영 저장소(tuffet-ops)의 기록. 루틴의 대화 전문은 claude.ai에만 있어서 여기선 일지로 대신한다 — ', h('a', { href: 'https://claude.ai/code/routines', rel: 'noopener', class: 'out' }, '루틴 실행 전문 ↗')),
        h('div', { class: 'links' }, ...SHELF.map(([t, p, d]) => h('a', { href: `#/docs/${p}` }, t, h('span', {}, d)))),
      );
    }
    const trail = [['문서', '#/docs'], ...args.map((seg, i) => [seg, i < args.length - 1 ? `#/docs/${args.slice(0, i + 1).join('/')}` : null])];
    const meta = await c.gh(`/repos/${c.OWNER}/${OPS}/contents/${path.split('/').map(encodeURIComponent).join('/')}`);
    if (Array.isArray(meta)) {
      const items = meta.filter((f) => f.name !== '.gitkeep').sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : path.includes('journal') || path.startsWith('reports') ? sortDesc(a.name, b.name) : a.name.localeCompare(b.name)));
      return c.put(crumbs(c, trail), h('div', { class: 'panel' }, ul(c, items.map((f) => c.row('', h('a', { href: `#/docs/${f.path}` }, f.type === 'dir' ? `${f.name}/` : f.name), f.type === 'file' ? `${Math.max(1, Math.round(f.size / 1024))}KB` : '')), '비어 있음')));
    }
    const isMd = /\.md$/i.test(path);
    const body = isMd ? md(c, await c.gh(`/repos/${c.OWNER}/${OPS}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, 'html'), path)
      : meta.size > 400_000 ? h('p', { class: 'muted' }, '파일이 커서 여기선 안 보여 준다.')
        : h('pre', { class: 'raw' }, await c.gh(`/repos/${c.OWNER}/${OPS}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, 'raw'));
    c.put(crumbs(c, trail), h('div', { class: 'doc' }, h('div', { class: 'dochead' }, h('h3', {}, meta.name), ghLink(c, meta.html_url)), body));
  }

  window.OpsRoomPages = { render };
})();
