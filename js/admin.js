/* 밈 생성기 — 관리자 모드 (템플릿 게시)
 *
 * GitHub Pages 는 정적 호스팅이라 서버가 없다. 그래서 "게시"는 저장소에
 * 커밋하는 것으로 구현한다. 커밋되면 Pages 가 다시 배포되고, 그때부터
 * 누구나 그 템플릿을 본다.
 *
 * 주소(admin.html)는 잠금장치가 아니다 — 누구나 열 수 있다.
 * 실제 권한은 GitHub 토큰이 쥐고 있고, 토큰은 이 브라우저의 localStorage
 * 에만 있다. 저장소에는 절대 들어가지 않는다.
 *
 * 순차 요청이 많아 이 파일만 async/await 를 쓴다.
 */
(function (global) {
  'use strict';

  var MG = (global.MG = global.MG || {});

  var REPO = 'dhlee0903/memeGen';
  var BRANCH = 'main';
  var TOKEN_KEY = 'memegen.gh.token';
  var API = 'https://api.github.com/repos/' + REPO;

  MG.isAdmin = function () {
    return /[?&]admin\b/.test(location.search) || /\/admin(\.html)?$/.test(location.pathname);
  };

  /* ── 토큰 ──────────────────────────────────────────── */
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(v) {
    try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* noop */ }
  }

  /** 토큰 입력 창. 취소하면 null */
  function askToken() {
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="tk-title">' +
        '<h3 id="tk-title">GitHub 토큰</h3>' +
        '<p class="hint">게시는 저장소에 커밋하는 방식입니다. 쓰기 권한이 있는 토큰이 필요합니다.<br>' +
        'GitHub → Settings → Developer settings → <b>Fine-grained tokens</b> 에서 이 저장소만 고르고 ' +
        '<b>Contents: Read and write</b> 권한으로 발급하세요.</p>' +
        '<input type="password" class="input" id="tk-input" placeholder="github_pat_..." autocomplete="off" />' +
        '<p class="hint">토큰은 이 브라우저에만 저장되고 저장소에는 올라가지 않습니다.</p>' +
        '<div class="modal-actions">' +
        '<button class="btn ghost" id="tk-cancel">취소</button>' +
        '<button class="btn primary" id="tk-ok">저장</button>' +
        '</div></div>';
      document.body.appendChild(back);

      var input = back.querySelector('#tk-input');
      input.value = getToken();
      input.focus();

      function close(val) {
        document.body.removeChild(back);
        resolve(val);
      }
      back.querySelector('#tk-cancel').addEventListener('click', function () { close(null); });
      back.querySelector('#tk-ok').addEventListener('click', function () {
        var v = input.value.trim();
        if (!v) { close(null); return; }
        setToken(v);
        close(v);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') back.querySelector('#tk-ok').click();
        if (e.key === 'Escape') close(null);
      });
      back.addEventListener('click', function (e) { if (e.target === back) close(null); });
    });
  }

  async function ensureToken() {
    return getToken() || await askToken();
  }

  /* ── GitHub API ────────────────────────────────────── */
  async function api(path, opts) {
    var res = await fetch(API + path, Object.assign({
      // 캐시된 응답을 쓰면 오래된 sha 로 커밋하게 되어 409 가 난다
      cache: 'no-store'
    }, opts, {
      headers: Object.assign({
        'Authorization': 'Bearer ' + getToken(),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // 인증된 GitHub API 응답은 max-age=60 으로 내려온다. 그대로 캐시되면
        // 1분 동안 옛 sha 를 들고 커밋하게 된다.
        'Cache-Control': 'no-cache'
      }, (opts && opts.headers) || {})
    }));
    return res;
  }

  /** 한글이 섞인 문자열을 base64 로 (btoa 는 라틴1만 받는다) */
  function b64utf8(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function getFile(path) {
    var r = await api('/contents/' + path + '?ref=' + BRANCH);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(await describe(r));
    return r.json();
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* 409 는 "보낸 sha 가 지금 파일과 다르다"는 뜻이다.
   * 게시 한 번에 파일 두세 개를 연달아 커밋하는데, 앞 커밋으로 브랜치가
   * 움직인 직후라 GitHub 이 잠깐 이전 상태를 돌려주는 일이 있다.
   * 그럴 때는 sha 를 다시 읽어 재시도하면 된다. */
  var RETRIES = 3;

  async function putFile(path, contentB64, message) {
    for (var attempt = 0; ; attempt++) {
      var existing = await getFile(path);
      var r = await api('/contents/' + path, {
        method: 'PUT',
        body: JSON.stringify({
          message: message,
          content: contentB64,
          branch: BRANCH,
          sha: existing ? existing.sha : undefined
        })
      });
      if (r.ok) return r.json();
      if (r.status !== 409 || attempt >= RETRIES - 1) throw new Error(await describe(r));
      await wait(700 * (attempt + 1));
    }
  }

  async function deleteFile(path, message) {
    for (var attempt = 0; ; attempt++) {
      var existing = await getFile(path);
      if (!existing) return;
      var r = await api('/contents/' + path, {
        method: 'DELETE',
        body: JSON.stringify({ message: message, branch: BRANCH, sha: existing.sha })
      });
      if (r.ok) return;
      if (r.status !== 409 || attempt >= RETRIES - 1) throw new Error(await describe(r));
      await wait(700 * (attempt + 1));
    }
  }

  async function describe(res) {
    var body = '';
    try { body = (await res.json()).message || ''; } catch (e) { /* noop */ }
    // GitHub 이 알려주는 사유를 덮어쓰지 않는다. 원인 파악에 그게 제일 중요하다.
    var tail = body ? ' (GitHub: ' + body + ')' : '';
    if (res.status === 401) return '토큰이 올바르지 않거나 만료됐습니다. "토큰" 버튼으로 다시 넣어주세요.' + tail;
    if (res.status === 403) return '쓰기 권한이 없습니다. 토큰의 Contents 를 Read and write 로 바꾸세요.' + tail;
    if (res.status === 404) return '이 토큰으로는 저장소가 보이지 않습니다. Repository access 에서 memeGen 을 골랐는지 확인하세요.' + tail;
    if (res.status === 409) return '저장소가 그 사이 바뀌어 몇 번 다시 시도했지만 안 됐습니다. 잠시 뒤 다시 눌러주세요.' + tail;
    return 'GitHub ' + res.status + tail;
  }

  /**
   * 게시 전에 토큰이 실제로 쓸 수 있는지 확인한다.
   * 파일을 반쯤 쓰다 실패하는 것보다 먼저 걸러내는 편이 낫다.
   */
  async function checkAccess() {
    var r = await api('');
    if (!r.ok) throw new Error(await describe(r));

    var repo = await r.json();
    // fine-grained 토큰은 Repository access 를 "Public repositories (read-only)"
    // 로 두면 읽기만 된다. 가장 흔한 실수라 여기서 잡는다.
    if (repo.permissions && repo.permissions.push === false) {
      throw new Error('이 토큰은 읽기 전용입니다. 토큰 설정에서 ' +
        'Repository access → Only select repositories → memeGen 을 고르고, ' +
        'Permissions → Contents 를 Read and write 로 바꾸세요.');
    }
    return repo;
  }

  MG.adminCheck = checkAccess;

  var MANIFEST_PATH = 'assets/templates/index.json';
  var USER_DIR = 'assets/templates/user/';
  var TRASH_DIR = 'assets/templates/trash/';

  async function readManifest() {
    var f = await getFile(MANIFEST_PATH);
    var data = { templates: [], trash: [] };
    if (f) {
      try {
        var text = new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\n/g, '')), function (c) { return c.charCodeAt(0); }));
        data = JSON.parse(text);
      } catch (e) { /* 깨졌으면 빈 것으로 시작 */ }
    }
    if (!Array.isArray(data.templates)) data.templates = [];
    if (!Array.isArray(data.trash)) data.trash = [];

    // 예전 형식(hidden: [id])을 휴지통으로 옮긴다
    if (Array.isArray(data.hidden)) {
      data.hidden.forEach(function (id) {
        if (!data.trash.some(function (t) { return t.id === id; })) {
          data.trash.push({ id: id, name: id, builtin: true });
        }
      });
    }
    delete data.hidden;
    return data;
  }

  /** GitHub API 에는 이동이 없다. 읽어서 새 경로에 쓰고 원래 것을 지운다. */
  async function moveFile(from, to, message) {
    var f = await getFile(from);
    if (!f) return false;
    await putFile(to, f.content.replace(/\n/g, ''), message);
    await deleteFile(from, message);
    return true;
  }

  function writeManifest(manifest, message) {
    return putFile(MANIFEST_PATH, b64utf8(JSON.stringify(manifest, null, 2)), message);
  }

  /* ── 게시 / 게시 취소 ──────────────────────────────── */
  /* 파일 경로에는 아스키만 쓴다. 한글 이름을 그대로 경로에 넣으면 URL 인코딩이
   * 끼어들어 매니페스트 경로와 실제 요청이 어긋나기 쉽다.
   * 보이는 이름은 JSON 안에 따로 저장되므로 한글 그대로 유지된다. */
  function slugify(name, fallback) {
    var s = String(name || '').trim().toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    return s || fallback;
  }

  MG.admin = {
    /**
     * 지금 편집 중인 템플릿을 게시한다.
     * @param {object} tpl  현재 템플릿
     * @param {string} title 게시 이름
     * @param {string} desc  한 줄 설명
     */
    /**
     * 템플릿을 게시한다.
     * @param {string} [forceId] 이 id 로 덮어쓴다. 내장 템플릿 id 를 주면
     *                           갤러리에서 그 자리를 대체한다(원본 수정 효과).
     */
    publish: async function (tpl, title, desc, forceId) {
      if (!await ensureToken()) throw new Error('취소했습니다.');
      await checkAccess();

      var id = forceId || tpl.publishedId || ('user-' + slugify(title, Date.now().toString(36)));
      var builtin = MG.isBuiltin(id);

      var packed = MG.packAssets(tpl);
      packed.id = id;
      packed.name = title;
      packed.desc = desc || '';
      delete packed.publishedId;
      delete packed.builtin;
      delete packed.overridden;
      delete packed.hidden;
      delete packed.published;

      // 배경이 내장 이미지가 아니면(직접 올린 그림) 그대로 data URI 로 담긴다.
      var path = USER_DIR + id + '.json';
      await putFile(path, b64utf8(JSON.stringify(packed, null, 2)),
        (builtin ? 'feat(template): ' + title + ' 수정' : 'feat(template): ' + title + ' 게시'));

      var manifest = await readManifest();
      var entry = { id: id, name: title, desc: packed.desc, file: path };
      if (builtin) entry.overrides = true;
      var i = manifest.templates.findIndex(function (t) { return t.id === id; });
      if (i === -1) manifest.templates.push(entry); else manifest.templates[i] = entry;
      // 휴지통에 있던 것을 다시 게시하면 휴지통에서 뺀다
      manifest.trash = manifest.trash.filter(function (t) { return t.id !== id; });
      await writeManifest(manifest, 'chore(template): 게시 목록 갱신 (' + title + ')');

      MG.removeFromTrash(id);
      return id;
    },

    /** 수정(덮어쓰기)만 취소하고 원래 내장 템플릿으로 되돌린다 */
    revert: async function (id) {
      if (!await ensureToken()) throw new Error('취소했습니다.');
      await checkAccess();
      var manifest = await readManifest();
      var entry = manifest.templates.filter(function (t) { return t.id === id; })[0];
      manifest.templates = manifest.templates.filter(function (t) { return t.id !== id; });
      await writeManifest(manifest, 'chore(template): ' + id + ' 수정 취소');
      if (entry && entry.file) await deleteFile(entry.file, 'chore(template): ' + id + ' 덮어쓴 버전 삭제');
    },

    /**
     * 템플릿을 휴지통으로 옮긴다.
     * 게시본은 파일을 trash 폴더로 옮기고, 내장 템플릿은 기록만 남긴다.
     * @returns {object} 휴지통 항목
     */
    trash: async function (id, meta) {
      if (!await ensureToken()) throw new Error('취소했습니다.');
      await checkAccess();
      meta = meta || {};

      var manifest = await readManifest();
      var entry = manifest.templates.filter(function (t) { return t.id === id; })[0];
      manifest.templates = manifest.templates.filter(function (t) { return t.id !== id; });

      var rec = {
        id: id,
        name: meta.name || (entry && entry.name) || id,
        desc: meta.desc || (entry && entry.desc) || '',
        builtin: !!meta.builtin,
        deletedAt: new Date().toISOString()
      };

      if (entry && entry.file) {
        var to = TRASH_DIR + id + '.json';
        await moveFile(entry.file, to, 'chore(template): ' + rec.name + ' 휴지통으로');
        rec.file = to;
        if (entry.overrides) rec.overrides = true;
      }

      manifest.trash = manifest.trash.filter(function (t) { return t.id !== id; });
      manifest.trash.push(rec);
      await writeManifest(manifest, 'chore(template): ' + rec.name + ' 휴지통으로');

      MG.addToTrash(rec);
      return rec;
    },

    /** 휴지통에서 되살린다 */
    restore: async function (id) {
      if (!await ensureToken()) throw new Error('취소했습니다.');
      await checkAccess();

      var manifest = await readManifest();
      var rec = manifest.trash.filter(function (t) { return t.id === id; })[0];
      if (!rec) throw new Error('휴지통에 없는 템플릿입니다.');
      manifest.trash = manifest.trash.filter(function (t) { return t.id !== id; });

      if (rec.file) {
        var to = USER_DIR + id + '.json';
        await moveFile(rec.file, to, 'chore(template): ' + rec.name + ' 복원');
        var entry = { id: id, name: rec.name, desc: rec.desc || '', file: to };
        if (rec.overrides) entry.overrides = true;
        manifest.templates.push(entry);
      }

      await writeManifest(manifest, 'chore(template): ' + rec.name + ' 복원');
      MG.removeFromTrash(id);
      return rec;
    },

    /** 휴지통에서 완전히 지운다 (내장 템플릿에는 쓰지 않는다) */
    purge: async function (id) {
      if (!await ensureToken()) throw new Error('취소했습니다.');
      await checkAccess();

      var manifest = await readManifest();
      var rec = manifest.trash.filter(function (t) { return t.id === id; })[0];
      manifest.trash = manifest.trash.filter(function (t) { return t.id !== id; });
      await writeManifest(manifest, 'chore(template): ' + ((rec && rec.name) || id) + ' 완전 삭제');
      if (rec && rec.file) await deleteFile(rec.file, 'chore(template): ' + id + ' 파일 삭제');
      MG.removeFromTrash(id);
    },

    /** 토큰을 새로 입력받는다 */
    askToken: async function () { return await askToken(); },

    /** 지금 토큰으로 정말 쓸 수 있는지 확인 */
    check: async function () {
      if (!getToken()) throw new Error('토큰이 없습니다. 먼저 입력해주세요.');
      var repo = await checkAccess();
      return repo.full_name;
    },

    forgetToken: function () { setToken(''); },
    hasToken: function () { return !!getToken(); }
  };
})(window);
