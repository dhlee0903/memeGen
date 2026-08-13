/* 밈 생성기 — 앱 글루 코드
 * 상태 관리 / 템플릿 갤러리 / 속성 패널 / 저장·불러오기 / 내보내기
 */
(function (global) {
  'use strict';

  var MG = (global.MG = global.MG || {});

  var STORAGE_KEY = 'memegen.projects.v1';
  var MAX_IMAGE_SIDE = 1600;   // 업로드 이미지 다운스케일 기준
  var HISTORY_LIMIT = 30;

  var state = {
    template: null,
    selectedId: null,
    title: '내 밈'
  };

  var history = { stack: [], index: -1 };
  var els = {};
  var pendingImageSlotId = null;
  var textCommitTimer = 0;

  /* ── 유틸 ──────────────────────────────────────────── */
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var toastTimer = 0;
  function toast(msg) {
    var t = els.toast;
    t.textContent = msg;
    t.hidden = false;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.hidden = true; }, 250);
    }, 2200);
  }

  /** 파일 → (필요시 축소된) dataURL */
  function fileToDataUrl(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('파일을 읽지 못했습니다.')); };
      reader.onload = function () {
        var url = reader.result;
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          if (scale >= 1) { resolve({ url: url, width: img.naturalWidth, height: img.naturalHeight }); return; }
          var c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * scale);
          c.height = Math.round(img.naturalHeight * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var type = /image\/(png|webp)/.test(file.type) ? 'image/png' : 'image/jpeg';
          resolve({ url: c.toDataURL(type, 0.9), width: c.width, height: c.height });
        };
        img.onerror = function () { reject(new Error('이미지 형식을 인식하지 못했습니다.')); };
        img.src = url;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ── 히스토리 ──────────────────────────────────────── */
  function pushHistory() {
    var snap = JSON.stringify(state.template);
    if (history.index >= 0 && history.stack[history.index] === snap) return;
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(snap);
    if (history.stack.length > HISTORY_LIMIT) history.stack.shift();
    history.index = history.stack.length - 1;
    updateHistoryButtons();
  }

  function restoreHistory(idx) {
    if (idx < 0 || idx >= history.stack.length) return;
    history.index = idx;
    state.template = JSON.parse(history.stack[idx]);
    if (state.selectedId && !state.template.slots.some(function (s) { return s.id === state.selectedId; })) {
      state.selectedId = null;
    }
    MG.preloadTemplate(state.template).then(function () {
      buildSlotList();
      buildDocProps();
      MG.editor.updateFit();
      MG.editor.requestDraw();
    });
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    els.undo.disabled = history.index <= 0;
    els.redo.disabled = history.index >= history.stack.length - 1;
  }

  /* ── 템플릿 적용 ───────────────────────────────────── */
  function setTemplate(tpl, opts) {
    state.template = tpl;
    state.selectedId = null;
    history.stack = [];
    history.index = -1;
    return MG.preloadTemplate(tpl).then(function () {
      buildDocProps();
      buildSlotList();
      MG.editor.updateFit();
      MG.editor.setZoom(1);
      MG.editor.requestDraw();
      pushHistory();
      if (!opts || !opts.silent) toast('템플릿을 불러왔어요: ' + tpl.name);
      markActiveTemplate(tpl.id);
      if (tpl.published) tpl.publishedId = tpl.id;
      updateAdminButtons();
    });
  }

  function markActiveTemplate(id) {
    Array.prototype.forEach.call(els.gallery.children, function (card) {
      card.classList.toggle('active', card.dataset.templateId === id);
    });
  }

  /* ── 갤러리 ────────────────────────────────────────── */

  /** 내장 템플릿이 쓰는 이미지를 미리 로드 (썸네일이 빈 칸으로 그려지지 않도록) */
  function preloadBuiltinAssets() {
    var srcs = {};
    MG.listTemplates().forEach(function (tpl) {
      tpl.slots.forEach(function (s) {
        if (s.type === 'image' && s.src) srcs[s.src] = true;
      });
    });
    return Promise.all(Object.keys(srcs).map(function (src) {
      return MG.loadImage(src).catch(function () { return null; });
    }));
  }

  function buildGallery() {
    var list = MG.listTemplates();
    els.gallery.innerHTML = '';
    var admin = MG.isAdmin && MG.isAdmin();

    list.forEach(function (tpl) {
      // 삭제 버튼을 품어야 해서 카드는 button 이 아니라 div 다(버튼 중첩 불가)
      var card = el('div', 'tpl-card');
      card.dataset.templateId = tpl.id;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');

      var thumb = el('div', 'tpl-thumb');
      var img = new Image();
      img.alt = tpl.name;
      img.src = MG.makeThumb(tpl, 240, 240);
      thumb.appendChild(img);

      var meta = el('div', 'tpl-meta');
      meta.appendChild(el('strong', null, tpl.name));
      meta.appendChild(el('span', null, tpl.desc));

      card.appendChild(thumb);
      card.appendChild(meta);

      function open() {
        var fresh = MG.buildTemplate(tpl.id);
        if (fresh) setTemplate(fresh);
      }
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });

      // 게시된 템플릿만 지울 수 있다. 내장 템플릿은 코드에 있어 지울 수 없다.
      if (admin && tpl.published) {
        var del = el('button', 'tpl-del', '✕');
        del.type = 'button';
        del.title = '이 템플릿 삭제';
        del.setAttribute('aria-label', tpl.name + ' 삭제');
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          deletePublished(tpl.id, tpl.name);
        });
        card.appendChild(del);
      }

      els.gallery.appendChild(card);
    });
  }

  /** 게시된 템플릿을 저장소에서 지운다 */
  function deletePublished(id, name) {
    if (!confirm('"' + name + '" 템플릿을 삭제할까요?\n사이트에서 사라지고 되돌릴 수 없습니다.')) return;

    toast('삭제하는 중…');
    var wasOpen = state.template && (state.template.publishedId || state.template.id) === id;

    MG.admin.unpublish(id).then(function () {
      MG.removeTemplate(id);
      buildGallery();
      toast('삭제했어요. 사이트 반영까지 1분쯤 걸립니다.');
      // 지금 열려 있던 템플릿이면 기본 템플릿으로 돌아간다
      if (wasOpen) return setTemplate(MG.buildTemplate('comic-page-8'), { silent: true });
      markActiveTemplate(state.template.id);
    }).catch(function (err) {
      toast(err.message || '삭제하지 못했습니다.');
    });
  }

  /* ── 문서 속성 ─────────────────────────────────────── */
  function buildDocProps() {
    var box = els.docProps;
    box.innerHTML = '';
    var tpl = state.template;
    if (!tpl) return;

    box.appendChild(el('h3', null, '전체 설정'));

    var nameRow = el('label', 'field');
    nameRow.appendChild(el('span', 'field-label', '제목(파일 이름)'));
    var nameInput = el('input', 'input');
    nameInput.type = 'text';
    nameInput.value = state.title;
    nameInput.addEventListener('input', function () { state.title = nameInput.value; });
    nameRow.appendChild(nameInput);
    box.appendChild(nameRow);

    var sizeRow = el('div', 'field');
    sizeRow.appendChild(el('span', 'field-label', '캔버스 크기 (px)'));
    var grid = el('div', 'grid-2');
    ['width', 'height'].forEach(function (k) {
      var inp = el('input', 'input');
      inp.type = 'number';
      inp.min = 100; inp.max = 4000; inp.step = 10;
      inp.value = tpl[k];
      inp.addEventListener('change', function () {
        var v = Math.max(100, Math.min(4000, parseInt(inp.value, 10) || tpl[k]));
        tpl[k] = v;
        inp.value = v;
        MG.editor.updateFit();
        MG.editor.requestDraw();
        pushHistory();
      });
      grid.appendChild(inp);
    });
    sizeRow.appendChild(grid);
    box.appendChild(sizeRow);

    var bgRow = el('label', 'field');
    bgRow.appendChild(el('span', 'field-label', '배경색'));
    var bg = el('input', 'input color');
    bg.type = 'color';
    bg.value = tpl.background || '#ffffff';
    bg.addEventListener('input', function () {
      tpl.background = bg.value;
      MG.editor.requestDraw();
    });
    bg.addEventListener('change', pushHistory);
    bgRow.appendChild(bg);
    box.appendChild(bgRow);
  }

  /* ── 속성 패널 (선택한 칸만) ───────────────────────── */

  /** 칸이 겹쳐 캔버스로 고르기 어려운 경우를 위한 목록 */
  function slotPicker() {
    var tpl = state.template;
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field-label', '칸 고르기'));

    var sel = el('select', 'input');
    var none = el('option', null, '— 선택 안 함 —');
    none.value = '';
    sel.appendChild(none);

    tpl.slots.forEach(function (slot) {
      var opt = el('option', null, (slot.type === 'text' ? '💬 ' : '🖼 ') + (slot.name || '이름 없음'));
      opt.value = slot.id;
      sel.appendChild(opt);
    });
    sel.value = state.selectedId || '';
    sel.addEventListener('change', function () {
      select(sel.value || null);
      MG.editor.requestDraw();
    });

    wrap.appendChild(sel);
    return wrap;
  }

  function buildSlotList() {
    var list = els.slotList;
    list.innerHTML = '';
    var tpl = state.template;
    if (!tpl) return;

    var hasSlots = tpl.slots.length > 0;
    if (hasSlots) list.appendChild(slotPicker());

    var index = -1;
    if (state.selectedId) {
      index = tpl.slots.findIndex(function (s) { return s.id === state.selectedId; });
    }

    if (index === -1) {
      els.emptyNote.hidden = false;
      els.emptyNote.textContent = hasSlots
        ? '캔버스에서 칸을 누르거나 위 목록에서 골라주세요.'
        : '칸이 없습니다. 위의 ＋ 대사 칸 / ＋ 사진 칸 버튼으로 추가하세요.';
      return;
    }

    els.emptyNote.hidden = true;
    var slot = tpl.slots[index];
    list.appendChild(slot.type === 'text' ? textCard(slot, index) : imageCard(slot, index));
  }

  function cardHeader(slot, index) {
    var head = el('div', 'slot-head');
    var badge = el('span', 'badge ' + slot.type, slot.type === 'text' ? '대사' : '사진');
    var name = el('input', 'slot-name');
    name.type = 'text';
    name.value = slot.name || (slot.type === 'text' ? '대사' : '사진');
    name.addEventListener('input', function () { slot.name = name.value; MG.editor.requestDraw(); });
    name.addEventListener('change', pushHistory);

    var actions = el('div', 'slot-actions');

    var up = el('button', 'icon-btn', '↑');
    up.title = '순서 위로';
    up.addEventListener('click', function () { moveSlot(index, -1); });

    var down = el('button', 'icon-btn', '↓');
    down.title = '순서 아래로';
    down.addEventListener('click', function () { moveSlot(index, 1); });

    var dup = el('button', 'icon-btn', '⧉');
    dup.title = '복제';
    dup.addEventListener('click', function () { duplicateSlot(slot); });

    var del = el('button', 'icon-btn danger', '✕');
    del.title = '삭제';
    del.addEventListener('click', function () { deleteSlot(slot.id); });

    actions.append(up, down, dup, del);
    head.append(badge, name, actions);
    return head;
  }

  function geometryFields(slot) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('span', 'field-label', '위치 · 크기'));
    var grid = el('div', 'grid-4');
    [['x', 'X'], ['y', 'Y'], ['w', '너비'], ['h', '높이']].forEach(function (pair) {
      var box = el('div', 'mini-field');
      var inp = el('input', 'input');
      inp.type = 'number';
      inp.step = 1;
      inp.value = Math.round(slot[pair[0]]);
      inp.dataset.geo = pair[0];
      inp.addEventListener('input', function () {
        var v = parseInt(inp.value, 10);
        if (isNaN(v)) return;
        slot[pair[0]] = v;
        MG.editor.requestDraw();
      });
      inp.addEventListener('change', pushHistory);
      box.appendChild(inp);
      box.appendChild(el('span', 'mini-label', pair[1]));
      grid.appendChild(box);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function makeCard(slot, index) {
    var card = el('div', 'slot-card selected');
    card.dataset.slotId = slot.id;
    card.appendChild(cardHeader(slot, index));
    return card;
  }

  function rangeField(labelText, slot, key, min, max, step, format) {
    var wrap = el('label', 'field');
    var label = el('span', 'field-label');
    label.textContent = labelText;
    var val = el('b', 'field-value');
    val.textContent = format ? format(slot[key]) : slot[key];
    label.appendChild(val);
    wrap.appendChild(label);

    var input = el('input', 'range');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = slot[key];
    input.addEventListener('input', function () {
      slot[key] = parseFloat(input.value);
      val.textContent = format ? format(slot[key]) : slot[key];
      MG.editor.requestDraw();
    });
    input.addEventListener('change', pushHistory);
    wrap.appendChild(input);
    return wrap;
  }

  function selectField(labelText, slot, key, options, afterChange) {
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', 'field-label', labelText));
    var sel = el('select', 'input');
    options.forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      sel.appendChild(opt);
    });
    sel.value = slot[key];
    sel.addEventListener('change', function () {
      slot[key] = sel.value;
      MG.editor.requestDraw();
      pushHistory();
      if (afterChange) afterChange();
    });
    wrap.appendChild(sel);
    return wrap;
  }

  /** 정렬 아이콘 (막대 네 줄의 치우침으로 방향을 보여준다) */
  function alignIcon(kind) {
    var rows = [14, 9, 14, 7];
    var svg = '<svg viewBox="0 0 18 15" width="16" height="14" aria-hidden="true" focusable="false">';
    rows.forEach(function (w, i) {
      var x = kind === 'left' ? 2 : (kind === 'right' ? 16 - w : (18 - w) / 2);
      svg += '<rect x="' + x + '" y="' + (i * 3.5 + 1.2) + '" width="' + w +
        '" height="1.9" rx=".95" fill="currentColor"/>';
    });
    return svg + '</svg>';
  }

  function alignField(slot) {
    var wrap = el('div', 'field');
    wrap.appendChild(el('span', 'field-label', '정렬'));

    var seg = el('div', 'seg');
    [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].forEach(function (o) {
      var btn = el('button', 'seg-btn');
      btn.type = 'button';
      btn.title = o[1];
      btn.setAttribute('aria-label', o[1]);
      btn.setAttribute('aria-pressed', String(slot.align === o[0]));
      btn.innerHTML = alignIcon(o[0]);
      btn.classList.toggle('active', slot.align === o[0]);
      btn.addEventListener('click', function () {
        slot.align = o[0];
        Array.prototype.forEach.call(seg.children, function (b) {
          var on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        MG.editor.requestDraw();
        pushHistory();
      });
      seg.appendChild(btn);
    });

    wrap.appendChild(seg);
    return wrap;
  }

  function checkField(labelText, slot, key) {
    var wrap = el('label', 'check');
    var input = el('input');
    input.type = 'checkbox';
    input.checked = !!slot[key];
    input.addEventListener('change', function () {
      slot[key] = input.checked;
      MG.editor.requestDraw();
      pushHistory();
    });
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(' ' + labelText));
    return wrap;
  }

  function textCard(slot, index) {
    var card = makeCard(slot, index);

    var ta = el('textarea', 'textarea');
    ta.rows = 3;
    ta.value = slot.text;
    ta.placeholder = '대사를 입력하세요 (Enter로 줄바꿈)';
    ta.dataset.role = 'text';
    ta.addEventListener('input', function () {
      slot.text = ta.value;
      MG.editor.requestDraw();
      clearTimeout(textCommitTimer);
      textCommitTimer = setTimeout(pushHistory, 600);
    });
    card.appendChild(ta);

    var row1 = el('div', 'row');
    row1.appendChild(selectField('말풍선', slot, 'bubble', [
      ['ellipse', '둥근 말풍선'], ['round', '사각 말풍선'],
      ['box', '흰 박스(테두리 없음)'], ['none', '없음(글자만)']
    ]));
    row1.appendChild(selectField('꼬리', slot, 'tail', [
      ['none', '없음'], ['bottom', '아래'], ['bottom-left', '왼쪽 아래'],
      ['bottom-right', '오른쪽 아래'], ['left', '왼쪽'], ['right', '오른쪽']
    ]));
    card.appendChild(row1);

    var row2 = el('div', 'row');
    row2.appendChild(alignField(slot));
    var colorWrap = el('label', 'field');
    colorWrap.appendChild(el('span', 'field-label', '글자색'));
    var color = el('input', 'input color');
    color.type = 'color';
    color.value = slot.color;
    color.addEventListener('input', function () { slot.color = color.value; MG.editor.requestDraw(); });
    color.addEventListener('change', pushHistory);
    colorWrap.appendChild(color);
    row2.appendChild(colorWrap);
    card.appendChild(row2);

    card.appendChild(rangeField('글자 크기', slot, 'fontSize', 10, 120, 1, function (v) { return v + 'px'; }));

    var checks = el('div', 'check-row');
    checks.appendChild(checkField('칸에 맞춰 자동 축소', slot, 'autoFit'));
    checks.appendChild(checkField('굵게', slot, 'bold'));
    checks.appendChild(checkField('검은 외곽선', slot, 'stroke'));
    card.appendChild(checks);

    card.appendChild(geometryFields(slot));
    return card;
  }

  function imageCard(slot, index) {
    var card = makeCard(slot, index);

    var picker = el('div', 'img-picker');
    var preview = el('div', 'img-preview');
    if (slot.src) {
      var pimg = new Image();
      pimg.src = slot.src;
      preview.appendChild(pimg);
    } else {
      preview.appendChild(el('span', 'img-empty', '없음'));
    }

    var pickBtn = el('button', 'btn small', slot.src ? '사진 바꾸기' : '사진 선택');
    pickBtn.addEventListener('click', function () { requestImage(slot); });

    var clearBtn = el('button', 'btn small ghost', '비우기');
    clearBtn.disabled = !slot.src;
    clearBtn.addEventListener('click', function () {
      slot.src = null;
      MG.editor.requestDraw();
      pushHistory();
      buildSlotList();
    });

    var btns = el('div', 'img-btns');
    btns.append(pickBtn, clearBtn);
    picker.append(preview, btns);
    card.appendChild(picker);

    // 채우기 방식에 따라 아래 슬라이더 구성이 달라지므로 목록을 다시 그린다
    card.appendChild(selectField('채우기 방식', slot, 'fit', [
      ['cover', '꽉 채우기(잘림)'], ['contain', '전체 보이기'], ['fill', '늘리기']
    ], buildSlotList));

    if (slot.fit !== 'fill') {
      card.appendChild(rangeField('확대', slot, 'scale', 0.2, 3, 0.01, function (v) { return Math.round(v * 100) + '%'; }));
      card.appendChild(rangeField('좌우 위치', slot, 'offsetX', -1, 1, 0.01, function (v) { return v.toFixed(2); }));
      card.appendChild(rangeField('상하 위치', slot, 'offsetY', -1, 1, 0.01, function (v) { return v.toFixed(2); }));
    }
    card.appendChild(rangeField('모서리 둥글기', slot, 'radius', 0, 120, 1, function (v) { return v + 'px'; }));
    card.appendChild(geometryFields(slot));
    return card;
  }

  /* ── 슬롯 조작 ─────────────────────────────────────── */
  function select(id) {
    if (state.selectedId === id) return;
    state.selectedId = id;
    buildSlotList();
    MG.editor.requestDraw();
  }

  function moveSlot(index, dir) {
    var slots = state.template.slots;
    var to = index + dir;
    if (to < 0 || to >= slots.length) return;
    var tmp = slots[index];
    slots[index] = slots[to];
    slots[to] = tmp;
    buildSlotList();
    MG.editor.requestDraw();
    pushHistory();
  }

  function duplicateSlot(slot) {
    var copy = clone(slot);
    copy.id = MG.uid(slot.type === 'text' ? 't' : 'i');
    copy.x += 16;
    copy.y += 16;
    copy.name = (slot.name || '') + ' 복사';
    state.template.slots.push(copy);
    state.selectedId = copy.id;
    buildSlotList();
    MG.editor.requestDraw();
    pushHistory();
  }

  function deleteSlot(id) {
    var slots = state.template.slots;
    var i = slots.findIndex(function (s) { return s.id === id; });
    if (i === -1) return;
    slots.splice(i, 1);
    if (state.selectedId === id) state.selectedId = null;
    buildSlotList();
    MG.editor.requestDraw();
    pushHistory();
  }

  function addSlot(type) {
    var tpl = state.template;
    var w = type === 'text' ? Math.round(tpl.width * 0.34) : Math.round(tpl.width * 0.4);
    var h = type === 'text' ? Math.round(tpl.height * 0.12) : Math.round(tpl.height * 0.3);
    var base = {
      x: Math.round((tpl.width - w) / 2),
      y: Math.round((tpl.height - h) / 2),
      w: w, h: h,
      name: type === 'text' ? '대사 ' + (countType('text') + 1) : '사진 ' + (countType('image') + 1)
    };
    var slot = type === 'text' ? MG.textSlot(base) : MG.imageSlot(base);
    tpl.slots.push(slot);
    state.selectedId = slot.id;
    buildSlotList();
    MG.editor.requestDraw();
    pushHistory();
  }

  /* ── 말풍선 자동 찾기 ──────────────────────────────── */

  /** 캔버스 대부분을 덮는 사진 칸 = 배경 */
  function findBackgroundSlot() {
    var tpl = state.template;
    var canvasArea = tpl.width * tpl.height;
    var best = null;
    tpl.slots.forEach(function (s) {
      if (s.type !== 'image' || !s.src) return;
      var ratio = (s.w * s.h) / canvasArea;
      if (ratio < 0.5) return;
      if (!best || s.w * s.h > best.w * best.h) best = s;
    });
    return best;
  }

  /**
   * @param {boolean} afterUpload 배경 업로드 직후 자동 실행인지(안내 문구가 달라진다)
   * @returns {number} 만들어진 대사 칸 수
   */
  function detectBubbles(afterUpload) {
    var bg = findBackgroundSlot();
    if (!bg) {
      toast('먼저 만화 페이지를 배경 사진으로 올려주세요.');
      return 0;
    }
    var img = MG.getCachedImage(bg.src);
    if (!img) { toast('배경 이미지를 아직 불러오는 중입니다.'); return 0; }

    var found = MG.detectBubbles(img);
    if (!found.length) {
      toast(afterUpload
        ? '배경을 올렸어요. "＋ 대사 칸"으로 말풍선을 추가해보세요.'
        : '말풍선을 찾지 못했어요. 대사 칸을 직접 추가해주세요.');
      return 0;
    }

    // 정규화 좌표를 배경 칸 위치에 맞춰 되돌린다
    found.forEach(function (r, i) {
      var pad = 0.1;   // 타원 안쪽에 글자가 들어가도록 살짝 줄인다
      var x = bg.x + r.x * bg.w;
      var y = bg.y + r.y * bg.h;
      var w = r.w * bg.w;
      var h = r.h * bg.h;
      state.template.slots.push(MG.textSlot({
        name: '대사 ' + (i + 1),
        x: Math.round(x + w * pad),
        y: Math.round(y + h * pad),
        w: Math.round(w * (1 - pad * 2)),
        h: Math.round(h * (1 - pad * 2)),
        text: '',
        bubble: 'none',      // 말풍선은 이미 그림에 그려져 있다
        tail: 'none',
        fontSize: 24,
        autoFit: true
      }));
    });

    state.selectedId = null;
    buildSlotList();
    MG.editor.requestDraw();
    pushHistory();
    toast('말풍선 ' + found.length + '개를 찾았어요. 오른쪽에서 대사를 채워보세요.');
    return found.length;
  }

  function countType(type) {
    return state.template.slots.filter(function (s) { return s.type === type; }).length;
  }

  /* ── 이미지 넣기 ───────────────────────────────────── */
  function requestImage(slot) {
    pendingImageSlotId = slot.id;
    els.imageInput.value = '';
    els.imageInput.click();
  }

  function applyImageFile(slot, file) {
    return fileToDataUrl(file, MAX_IMAGE_SIDE).then(function (res) {
      slot.src = res.url;
      slot.scale = 1;
      slot.offsetX = 0;
      slot.offsetY = 0;
      return MG.loadImage(res.url);
    }).then(function () {
      buildSlotList();
      MG.editor.requestDraw();
      pushHistory();
    }).catch(function (err) {
      toast(err.message || '이미지를 넣지 못했습니다.');
    });
  }

  /* ── 저장 / 불러오기 ───────────────────────────────── */
  function readProjects() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function writeProjects(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      toast('저장 공간이 부족합니다. 오래된 작업을 지워주세요.');
      return false;
    }
  }

  function saveProject() {
    var name = prompt('저장할 이름을 입력하세요.', state.title || '내 밈');
    if (name === null) return;
    name = name.trim() || '이름 없음';
    var list = readProjects();
    var entry = {
      id: 'p_' + Date.now().toString(36),
      name: name,
      savedAt: new Date().toISOString(),
      template: state.template
    };
    list.unshift(entry);
    if (writeProjects(list)) {
      state.title = name;
      buildDocProps();
      buildSavedList();
      toast('저장했어요: ' + name);
    }
  }

  function buildSavedList() {
    var box = els.savedList;
    box.innerHTML = '';
    var list = readProjects();
    if (!list.length) {
      box.appendChild(el('p', 'hint', '저장된 작업이 없습니다.'));
      return;
    }
    list.forEach(function (p) {
      var row = el('div', 'saved-item');
      var btn = el('button', 'saved-open');
      btn.type = 'button';
      btn.appendChild(el('strong', null, p.name));
      btn.appendChild(el('span', null, new Date(p.savedAt).toLocaleString('ko-KR')));
      btn.addEventListener('click', function () {
        state.title = p.name;
        setTemplate(clone(p.template));
      });

      var del = el('button', 'icon-btn danger', '✕');
      del.title = '삭제';
      del.addEventListener('click', function () {
        var next = readProjects().filter(function (x) { return x.id !== p.id; });
        writeProjects(next);
        buildSavedList();
      });

      row.append(btn, del);
      box.appendChild(row);
    });
  }

  function exportJson() {
    var data = JSON.stringify({ title: state.title, template: state.template }, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    downloadBlob(blob, safeFileName(state.title) + '.memegen.json');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var tpl = parsed.template || parsed;
        if (!tpl || !Array.isArray(tpl.slots)) throw new Error('형식이 올바르지 않습니다.');
        state.title = parsed.title || tpl.name || '내 밈';
        setTemplate(tpl);
      } catch (e) {
        toast('JSON을 읽지 못했습니다: ' + e.message);
      }
    };
    reader.readAsText(file);
  }

  /* ── 내보내기 ──────────────────────────────────────── */
  function safeFileName(s) {
    return String(s || 'meme').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'meme';
  }

  /** 호스트가 파일 저장 API를 제공하는 환경(브라우저 다운로드가 막힌 샌드박스 등) */
  function hostSave(blob, filename) {
    var host = window.claude;
    if (!host || !host.downloads || typeof host.downloads.save !== 'function') return false;
    host.downloads.save({ filename: filename, data: blob }).then(function () {
      toast('저장했어요: ' + filename);
    }).catch(function (err) {
      var code = err && err.code;
      if (code === 'declined') return;                       // 사용자가 취소한 경우
      if (code === 'rate_limited') toast('잠시 후 다시 시도해주세요.');
      else if (code === 'too_large') toast('파일이 너무 큽니다. 캔버스 크기를 줄여보세요.');
      else toast('저장하지 못했습니다: ' + ((err && err.message) || code || '알 수 없는 오류'));
    });
    return true;
  }

  function downloadBlob(blob, filename) {
    if (hostSave(blob, filename)) return;

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // 브라우저가 다운로드를 시작하기 전에 앵커가 사라지면 파일 이름이 무시될 수 있다
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
    toast('저장했어요: ' + filename);
  }

  function downloadPng() {
    var canvas = MG.renderToCanvas(state.template, 2);
    var name = safeFileName(state.title) + '.png';
    canvas.toBlob(function (blob) {
      if (!blob) { toast('이미지를 만들지 못했습니다.'); return; }
      downloadBlob(blob, name);
    }, 'image/png');
  }

  /* ── 초기화 ────────────────────────────────────────── */
  function cacheEls() {
    els.gallery = $('#gallery');
    els.slotList = $('#slot-list');
    els.docProps = $('#doc-props');
    els.emptyNote = $('#empty-note');
    els.savedList = $('#saved-list');
    els.canvas = $('#canvas');
    els.canvasWrap = $('#canvas-wrap');
    els.toast = $('#toast');
    els.imageInput = $('#hidden-image-input');
    els.jsonInput = $('#hidden-json-input');
    els.zoomLabel = $('#zoom-label');
    els.undo = $('#btn-undo');
    els.redo = $('#btn-redo');
  }

  function bindUi() {
    $('#btn-add-text').addEventListener('click', function () { addSlot('text'); });
    $('#btn-add-image').addEventListener('click', function () { addSlot('image'); });
    $('#btn-detect').addEventListener('click', detectBubbles);

    $('#btn-zoom-in').addEventListener('click', function () { MG.editor.setZoom(MG.editor.zoom * 1.2); });
    $('#btn-zoom-out').addEventListener('click', function () { MG.editor.setZoom(MG.editor.zoom / 1.2); });
    $('#btn-zoom-fit').addEventListener('click', function () { MG.editor.zoomFit(); });

    $('#chk-guides').addEventListener('change', function (e) {
      MG.editor.showGuides = e.target.checked;
      MG.editor.requestDraw();
    });

    $('#btn-download').addEventListener('click', downloadPng);
    $('#btn-save').addEventListener('click', saveProject);
    $('#btn-load').addEventListener('click', function () {
      buildSavedList();
      els.savedList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('왼쪽 아래 "저장된 작업"에서 골라주세요.');
    });
    $('#btn-export-json').addEventListener('click', exportJson);
    $('#btn-import-json').addEventListener('click', function () {
      els.jsonInput.value = '';
      els.jsonInput.click();
    });

    els.undo.addEventListener('click', function () { restoreHistory(history.index - 1); });
    els.redo.addEventListener('click', function () { restoreHistory(history.index + 1); });

    els.imageInput.addEventListener('change', function () {
      var file = els.imageInput.files && els.imageInput.files[0];
      if (!file || !pendingImageSlotId) return;
      var slot = state.template.slots.filter(function (s) { return s.id === pendingImageSlotId; })[0];
      pendingImageSlotId = null;
      if (slot) applyImageFile(slot, file);
    });

    els.jsonInput.addEventListener('change', function () {
      var file = els.jsonInput.files && els.jsonInput.files[0];
      if (file) importJson(file);
    });

    $('#custom-bg').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      fileToDataUrl(file, MAX_IMAGE_SIDE).then(function (res) {
        var tpl = MG.templateFromImage(res.url, res.width, res.height);
        state.title = '내 밈';
        return setTemplate(tpl);
      }).then(function () {
        // 만화 페이지라면 빈 말풍선을 바로 찾아 대사 칸으로 만들어 준다
        detectBubbles(true);
      }).catch(function (err) { toast(err.message || '이미지를 불러오지 못했습니다.'); });
      e.target.value = '';
    });

    // 패널 접기
    Array.prototype.forEach.call(document.querySelectorAll('.panel-toggle'), function (btn) {
      btn.addEventListener('click', function () {
        var panel = document.getElementById(btn.dataset.target);
        panel.classList.toggle('collapsed');
        MG.editor.updateFit();
        MG.editor.requestDraw();
      });
    });

    // 전역 단축키
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      var k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) restoreHistory(history.index + 1);
        else restoreHistory(history.index - 1);
      } else if (k === 's') {
        e.preventDefault();
        saveProject();
      } else if (k === 'e') {
        e.preventDefault();
        downloadPng();
      }
    });
  }

  function attachEditor() {
    MG.editor.attach(els.canvas, els.canvasWrap, {
      getTemplate: function () { return state.template; },
      getSelectedId: function () { return state.selectedId; },
      setSelectedId: function (id) {
        if (state.selectedId === id) return;
        state.selectedId = id;
        buildSlotList();
      },
      onSlotGeometry: function (slot) {
        var card = els.slotList.querySelector('[data-slot-id="' + slot.id + '"]');
        if (!card) return;
        ['x', 'y', 'w', 'h'].forEach(function (k) {
          var inp = card.querySelector('[data-geo="' + k + '"]');
          if (inp && document.activeElement !== inp) inp.value = Math.round(slot[k]);
        });
      },
      commitChange: pushHistory,
      deleteSlot: deleteSlot,
      requestImage: requestImage,
      applyImageFile: applyImageFile,
      focusText: function (slot) {
        var card = els.slotList.querySelector('[data-slot-id="' + slot.id + '"]');
        if (!card) return;
        var ta = card.querySelector('[data-role="text"]');
        if (ta) { ta.focus(); ta.select(); }
      },
      onZoom: function (z) { els.zoomLabel.textContent = Math.round(z * MG.editor.fitScale * 100) + '%'; },
      toast: toast
    });
  }

  /* ── 관리자 모드 (게시) ────────────────────────────── */
  function setupAdmin() {
    if (!MG.isAdmin || !MG.isAdmin()) return;
    document.body.classList.add('is-admin');

    var group = $('#admin-tools');
    group.hidden = false;

    $('#btn-publish').addEventListener('click', function () {
      var tpl = state.template;
      var title = prompt('게시할 템플릿 이름', tpl.publishedId ? tpl.name : state.title);
      if (title === null) return;
      title = title.trim();
      if (!title) { toast('이름을 입력해주세요.'); return; }
      var desc = prompt('한 줄 설명 (비워도 됩니다)', tpl.desc || '');
      if (desc === null) return;

      toast('게시하는 중…');
      MG.admin.publish(tpl, title, desc).then(function (id) {
        tpl.publishedId = id;
        // 배포를 기다리지 않고 갤러리에 바로 반영한다
        var entry = clone(tpl);
        entry.id = id;
        entry.name = title;
        entry.desc = desc;
        MG.addTemplate(entry);
        buildGallery();
        markActiveTemplate(id);
        toast('게시했어요. 사이트 반영까지 1분쯤 걸립니다.');
        updateAdminButtons();
      }).catch(function (err) {
        toast(err.message || '게시하지 못했습니다.');
      });
    });

    $('#btn-token').addEventListener('click', function () {
      if (!MG.admin.hasToken()) {
        MG.admin.askToken().then(function () { updateAdminButtons(); });
        return;
      }
      toast('토큰 확인 중…');
      MG.admin.check().then(function (repo) {
        toast('토큰 정상 — ' + repo + ' 에 쓸 수 있습니다.');
      }).catch(function (err) {
        toast(err.message || '토큰을 확인하지 못했습니다.');
        if (confirm(err.message + '\n\n지금 토큰을 새로 넣을까요?')) {
          MG.admin.forgetToken();
          MG.admin.askToken().then(function () { updateAdminButtons(); });
        }
      });
    });
  }

  function updateAdminButtons() {
    if (!MG.isAdmin || !MG.isAdmin()) return;
    $('#btn-token').textContent = MG.admin.hasToken() ? '토큰 점검' : '토큰 입력';
  }

  function init() {
    cacheEls();
    bindUi();
    attachEditor();
    buildSavedList();
    setupAdmin();

    Promise.all([preloadBuiltinAssets(), MG.loadLibrary()]).then(function () {
      // 게시된 템플릿이 배경 이미지를 쓰면 썸네일 전에 로드해 둔다
      return preloadBuiltinAssets();
    }).then(function () {
      buildGallery();
      return setTemplate(MG.buildTemplate('comic-page-8'), { silent: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
