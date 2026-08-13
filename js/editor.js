/* 밈 생성기 — 캔버스 편집기
 * 선택 / 이동 / 크기조절 / 확대축소 / 키보드 조작을 담당한다.
 */
(function (global) {
  'use strict';

  var MG = (global.MG = global.MG || {});

  var CURSORS = {
    nw: 'nwse-resize', se: 'nwse-resize',
    ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize',
    e: 'ew-resize', w: 'ew-resize'
  };
  var MIN_SIZE = 24;

  function Editor() {
    this.canvas = null;
    this.ctx = null;
    this.wrap = null;
    this.hooks = null;
    this.zoom = 1;        // 사용자 배율
    this.fitScale = 1;    // 컨테이너에 맞춘 배율
    this.showGuides = true;
    this.drag = null;
    this._raf = 0;
  }

  Editor.prototype.attach = function (canvas, wrap, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrap = wrap;
    this.hooks = hooks;

    var self = this;
    canvas.addEventListener('pointerdown', function (e) { self.onPointerDown(e); });
    canvas.addEventListener('pointermove', function (e) { self.onPointerMove(e); });
    canvas.addEventListener('pointerup', function (e) { self.onPointerUp(e); });
    canvas.addEventListener('pointercancel', function (e) { self.onPointerUp(e); });
    canvas.addEventListener('dblclick', function (e) { self.onDoubleClick(e); });

    // 사진 칸에 파일 드롭
    canvas.addEventListener('dragover', function (e) { e.preventDefault(); });
    canvas.addEventListener('drop', function (e) { self.onDrop(e); });

    window.addEventListener('resize', function () { self.updateFit(); self.requestDraw(); });
    document.addEventListener('keydown', function (e) { self.onKeyDown(e); });
  };

  /* ── 좌표 변환 ─────────────────────────────────────── */
  Editor.prototype.scale = function () { return this.fitScale * this.zoom; };

  Editor.prototype.toTemplateCoords = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var s = this.scale();
    return {
      x: (e.clientX - rect.left) / s,
      y: (e.clientY - rect.top) / s
    };
  };

  /* ── 캔버스 크기 ───────────────────────────────────── */
  Editor.prototype.updateFit = function () {
    var tpl = this.hooks.getTemplate();
    if (!tpl || !this.wrap) return;
    var padding = 32;
    var availW = Math.max(120, this.wrap.clientWidth - padding);
    var availH = Math.max(120, this.wrap.clientHeight - padding);
    this.fitScale = Math.min(availW / tpl.width, availH / tpl.height);
    if (!isFinite(this.fitScale) || this.fitScale <= 0) this.fitScale = 1;
    if (this.hooks.onZoom) this.hooks.onZoom(this.zoom);
  };

  Editor.prototype.setZoom = function (z) {
    this.zoom = Math.max(0.2, Math.min(4, z));
    this.requestDraw();
    if (this.hooks.onZoom) this.hooks.onZoom(this.zoom);
  };

  Editor.prototype.zoomFit = function () {
    this.updateFit();
    this.setZoom(1);
  };

  /* ── 그리기 ────────────────────────────────────────── */
  Editor.prototype.requestDraw = function () {
    if (this._raf) return;
    var self = this;
    this._raf = requestAnimationFrame(function () {
      self._raf = 0;
      self.draw();
    });
  };

  Editor.prototype.draw = function () {
    var tpl = this.hooks.getTemplate();
    if (!tpl) return;
    var dpr = window.devicePixelRatio || 1;
    var s = this.scale();

    var cssW = Math.round(tpl.width * s);
    var cssH = Math.round(tpl.height * s);
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(s * dpr, s * dpr);

    MG.render(ctx, tpl, {
      selectedId: this.hooks.getSelectedId(),
      showGuides: this.showGuides,
      scale: s
    });
  };

  /* ── 히트 테스트 ───────────────────────────────────── */
  Editor.prototype.hitHandle = function (pt) {
    var tpl = this.hooks.getTemplate();
    var id = this.hooks.getSelectedId();
    if (!id) return null;
    var slot = tpl.slots.filter(function (s) { return s.id === id; })[0];
    if (!slot) return null;
    var size = 14 / this.scale();
    var hs = MG.handleRects(slot, size);
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (pt.x >= h.x && pt.x <= h.x + h.w && pt.y >= h.y && pt.y <= h.y + h.h) return h.key;
    }
    return null;
  };

  Editor.prototype.hitSlot = function (pt) {
    var slots = this.hooks.getTemplate().slots;
    // 그려지는 순서는 사진 → 대사. 위에 있는 것부터(대사의 마지막 항목부터) 검사한다.
    var texts = slots.filter(function (s) { return s.type === 'text'; }).reverse();
    var images = slots.filter(function (s) { return s.type === 'image'; }).reverse();
    var order = texts.concat(images);
    for (var i = 0; i < order.length; i++) {
      var s = order[i];
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) return s;
    }
    return null;
  };

  /* ── 포인터 ────────────────────────────────────────── */
  Editor.prototype.onPointerDown = function (e) {
    var pt = this.toTemplateCoords(e);
    var handle = this.hitHandle(pt);
    var tpl = this.hooks.getTemplate();

    if (handle) {
      var selId = this.hooks.getSelectedId();
      var sel = tpl.slots.filter(function (s) { return s.id === selId; })[0];
      this.drag = {
        mode: 'resize', handle: handle, start: pt,
        orig: { x: sel.x, y: sel.y, w: sel.w, h: sel.h }, slot: sel
      };
    } else {
      var slot = this.hitSlot(pt);
      this.hooks.setSelectedId(slot ? slot.id : null);
      if (slot) {
        this.drag = {
          mode: 'move', start: pt,
          orig: { x: slot.x, y: slot.y, w: slot.w, h: slot.h }, slot: slot
        };
      }
    }
    if (this.drag) {
      this.canvas.setPointerCapture(e.pointerId);
      this.hooks.beginChange && this.hooks.beginChange();
    }
    this.requestDraw();
  };

  Editor.prototype.onPointerMove = function (e) {
    var pt = this.toTemplateCoords(e);

    if (!this.drag) {
      var h = this.hitHandle(pt);
      this.canvas.style.cursor = h ? CURSORS[h] : (this.hitSlot(pt) ? 'move' : 'default');
      return;
    }

    var d = this.drag;
    var dx = pt.x - d.start.x;
    var dy = pt.y - d.start.y;
    var s = d.slot;

    if (d.mode === 'move') {
      // Shift: 더 많이 움직인 쪽 축으로만 이동한다
      if (e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
      }
      s.x = Math.round(d.orig.x + dx);
      s.y = Math.round(d.orig.y + dy);
    } else {
      var o = d.orig;
      var H = d.handle;
      var left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
      if (H.indexOf('w') !== -1) left = Math.min(o.x + dx, right - MIN_SIZE);
      if (H.indexOf('e') !== -1) right = Math.max(o.x + o.w + dx, left + MIN_SIZE);
      if (H.indexOf('n') !== -1) top = Math.min(o.y + dy, bottom - MIN_SIZE);
      if (H.indexOf('s') !== -1) bottom = Math.max(o.y + o.h + dy, top + MIN_SIZE);

      // Shift: 원래 가로세로 비율을 지킨다
      if (e.shiftKey && o.w > 0 && o.h > 0) {
        var ratio = o.w / o.h;
        var nw = right - left;
        var nh = bottom - top;

        if (H.length === 2) {
          // 모서리 — 더 많이 바뀐 쪽을 기준으로 나머지를 맞춘다
          if (Math.abs(nw - o.w) >= Math.abs(nh - o.h)) nh = nw / ratio;
          else nw = nh * ratio;
        } else if (H === 'e' || H === 'w') {
          nh = nw / ratio;
        } else {
          nw = nh * ratio;
        }
        nw = Math.max(MIN_SIZE, nw);
        nh = Math.max(MIN_SIZE, nh);

        // 잡지 않은 쪽 모서리를 고정한 채 다시 배치
        if (H.indexOf('w') !== -1) left = right - nw; else right = left + nw;
        if (H.indexOf('n') !== -1) top = bottom - nh; else bottom = top + nh;

        // 변 손잡이는 반대 축을 중심 기준으로 늘린다
        if (H === 'e' || H === 'w') {
          var cy = o.y + o.h / 2;
          top = cy - nh / 2;
          bottom = top + nh;
        } else if (H === 'n' || H === 's') {
          var cx = o.x + o.w / 2;
          left = cx - nw / 2;
          right = left + nw;
        }
      }

      s.x = Math.round(left);
      s.y = Math.round(top);
      s.w = Math.round(right - left);
      s.h = Math.round(bottom - top);
    }
    this.hooks.onSlotGeometry && this.hooks.onSlotGeometry(s);
    this.requestDraw();
  };

  Editor.prototype.onPointerUp = function (e) {
    if (!this.drag) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    this.drag = null;
    this.hooks.commitChange && this.hooks.commitChange();
  };

  Editor.prototype.onDoubleClick = function (e) {
    var pt = this.toTemplateCoords(e);
    var slot = this.hitSlot(pt);
    if (!slot) return;
    this.hooks.setSelectedId(slot.id);
    if (slot.type === 'image') this.hooks.requestImage(slot);
    else this.hooks.focusText(slot);
  };

  Editor.prototype.onDrop = function (e) {
    e.preventDefault();
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || !/^image\//.test(file.type)) return;
    var pt = this.toTemplateCoords(e);
    var slot = this.hitSlot(pt);
    if (!slot || slot.type !== 'image') {
      // 사진 칸이 아니면 그 자리에 있는 사진 칸을 찾는다
      var imgs = this.hooks.getTemplate().slots.filter(function (s) {
        return s.type === 'image' && pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h;
      });
      slot = imgs[imgs.length - 1];
    }
    if (!slot) { this.hooks.toast('사진 칸 위에 놓아주세요.'); return; }
    this.hooks.setSelectedId(slot.id);
    this.hooks.applyImageFile(slot, file);
  };

  /* ── 키보드 ────────────────────────────────────────── */
  Editor.prototype.onKeyDown = function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var id = this.hooks.getSelectedId();
    if (!id) return;
    var slot = this.hooks.getTemplate().slots.filter(function (s) { return s.id === id; })[0];
    if (!slot) return;

    var step = e.shiftKey ? 10 : 1;
    var moved = false;

    switch (e.key) {
      case 'ArrowLeft': slot.x -= step; moved = true; break;
      case 'ArrowRight': slot.x += step; moved = true; break;
      case 'ArrowUp': slot.y -= step; moved = true; break;
      case 'ArrowDown': slot.y += step; moved = true; break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.hooks.deleteSlot(slot.id);
        return;
      case 'Escape':
        this.hooks.setSelectedId(null);
        this.requestDraw();
        return;
      default: return;
    }

    if (moved) {
      e.preventDefault();
      this.hooks.onSlotGeometry && this.hooks.onSlotGeometry(slot);
      this.hooks.commitChange && this.hooks.commitChange();
      this.requestDraw();
    }
  };

  MG.editor = new Editor();
})(window);
