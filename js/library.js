/* 밈 생성기 — 게시된 템플릿 불러오기
 *
 * 저장소가 곧 데이터베이스다. 별도 서버 없이 다음 두 가지만 읽는다.
 *   assets/templates/index.json        게시 목록(매니페스트)
 *   assets/templates/user/<id>.json    템플릿 하나
 *
 * 매니페스트가 없거나(아직 아무것도 게시 안 함) file:// 로 열어 fetch 가
 * 막히면 조용히 넘어간다. 내장 템플릿만으로도 앱은 정상 동작해야 한다.
 */
(function (global) {
  'use strict';

  var MG = (global.MG = global.MG || {});

  MG.LIBRARY = {
    manifest: 'assets/templates/index.json',
    dir: 'assets/templates/user/'
  };

  /* 배경이 내장 이미지면 파일을 새로 올리지 않고 'asset:<키>' 로만 적어 둔다.
   * 게시 파일이 작아지고, 같은 그림이 저장소에 여러 벌 쌓이지 않는다. */
  function resolveAssets(tpl) {
    (tpl.slots || []).forEach(function (s) {
      if (s.type === 'image' && typeof s.src === 'string' && s.src.indexOf('asset:') === 0) {
        var key = s.src.slice(6);
        s.src = (MG.ASSETS && MG.ASSETS[key]) || null;
      }
    });
    return tpl;
  }

  /** 게시할 때 쓰는 역방향 변환 — 내장 이미지는 'asset:<키>' 로 바꾼다 */
  MG.packAssets = function (tpl) {
    var copy = JSON.parse(JSON.stringify(tpl));
    var keys = Object.keys(MG.ASSETS || {});
    copy.slots.forEach(function (s) {
      if (s.type !== 'image' || !s.src) return;
      for (var i = 0; i < keys.length; i++) {
        if (s.src === MG.ASSETS[keys[i]]) { s.src = 'asset:' + keys[i]; return; }
      }
    });
    return copy;
  };

  MG.resolveAssets = resolveAssets;

  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return r.json();
    });
  }

  /** 매니페스트를 읽어 게시된 템플릿을 모두 등록한다. 실패해도 reject 하지 않는다. */
  MG.loadLibrary = function () {
    if (typeof fetch !== 'function') return Promise.resolve([]);
    // file:// 에서는 fetch 가 CORS 로 막힌다. 시도하면 콘솔만 지저분해진다.
    if (location.protocol === 'file:') return Promise.resolve([]);

    return getJson(MG.LIBRARY.manifest).then(function (data) {
      var list = (data && data.templates) || [];
      return Promise.all(list.map(function (entry) {
        var url = entry.file || (MG.LIBRARY.dir + entry.id + '.json');
        return getJson(url)
          .then(function (tpl) { MG.addTemplate(resolveAssets(tpl)); return tpl.id; })
          .catch(function () { return null; });   // 한 개가 깨져도 나머지는 살린다
      }));
    }).then(function (ids) {
      return ids.filter(Boolean);
    }).catch(function () {
      return [];   // 매니페스트 없음 = 아직 게시된 템플릿이 없다는 뜻
    });
  };
})(window);
