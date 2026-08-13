/* 밈 생성기 — 캔버스 렌더러
 * 템플릿 정의를 받아 2D 컨텍스트에 그린다. 편집용/내보내기용 모두 같은 경로를 쓴다.
 */
(function (global) {
  'use strict';

  var MG = (global.MG = global.MG || {});

  var FONT_STACK = '"Pretendard","Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo","맑은 고딕",sans-serif';

  /* 로드된 이미지 캐시: dataURL/URL -> HTMLImageElement */
  var imageCache = Object.create(null);

  MG.loadImage = function (src) {
    if (!src) return Promise.resolve(null);
    var cached = imageCache[src];
    if (cached && cached.complete && cached.naturalWidth) return Promise.resolve(cached);
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { imageCache[src] = img; resolve(img); };
      img.onerror = function () { reject(new Error('이미지를 불러오지 못했습니다.')); };
      img.src = src;
    });
  };

  MG.getCachedImage = function (src) {
    if (!src) return null;
    var img = imageCache[src];
    return img && img.complete && img.naturalWidth ? img : null;
  };

  /** 템플릿 안의 모든 이미지 슬롯을 미리 로드 */
  MG.preloadTemplate = function (tpl) {
    var jobs = tpl.slots
      .filter(function (s) { return s.type === 'image' && s.src; })
      .map(function (s) { return MG.loadImage(s.src).catch(function () { return null; }); });
    return Promise.all(jobs);
  };

  /* ── 경로 헬퍼 ─────────────────────────────────────── */
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function ellipsePath(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  }

  /* ── 텍스트 줄바꿈 (한글: 글자 단위, 영문: 단어 단위) ── */
  function isLatin(ch) { return /[A-Za-z0-9'"()\-]/.test(ch); }

  MG.wrapText = function (ctx, text, maxWidth) {
    var lines = [];
    var paragraphs = String(text == null ? '' : text).split('\n');

    for (var p = 0; p < paragraphs.length; p++) {
      var para = paragraphs[p];
      if (para === '') { lines.push(''); continue; }
      var line = '';
      var chars = Array.from(para);

      for (var i = 0; i < chars.length; i++) {
        var ch = chars[i];
        var test = line + ch;
        if (line !== '' && ctx.measureText(test).width > maxWidth) {
          // 영문 단어 중간이면 마지막 공백까지 되돌린다
          var breakAt = line.length;
          if (isLatin(ch) && isLatin(line[line.length - 1])) {
            var sp = line.lastIndexOf(' ');
            if (sp > 0) breakAt = sp;
          }
          var head = line.slice(0, breakAt).replace(/\s+$/, '');
          var tail = line.slice(breakAt).replace(/^\s+/, '');
          lines.push(head);
          line = tail + ch;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
    return lines;
  };

  /** 상자 안에 들어가는 폰트 크기를 찾는다 */
  function fitFontSize(ctx, slot, boxW, boxH) {
    var size = slot.fontSize;
    var weight = slot.bold ? '700' : '400';
    var min = 8;
    while (size > min) {
      ctx.font = weight + ' ' + size + 'px ' + FONT_STACK;
      var lines = MG.wrapText(ctx, slot.text, boxW);
      var lh = size * 1.22;
      var widest = 0;
      for (var i = 0; i < lines.length; i++) {
        widest = Math.max(widest, ctx.measureText(lines[i]).width);
      }
      if (lines.length * lh <= boxH && widest <= boxW) return { size: size, lines: lines, lineHeight: lh };
      size -= 1;
    }
    ctx.font = weight + ' ' + min + 'px ' + FONT_STACK;
    return { size: min, lines: MG.wrapText(ctx, slot.text, boxW), lineHeight: min * 1.22 };
  }

  /* ── 말풍선 꼬리 ───────────────────────────────────── */
  function drawTail(ctx, slot) {
    if (!slot.tail || slot.tail === 'none') return;
    var cx = slot.x + slot.w / 2;
    var cy = slot.y + slot.h / 2;
    var rx = slot.w / 2;
    var ry = slot.h / 2;
    var len = Math.max(18, Math.min(slot.w, slot.h) * 0.42);

    var angles = {
      'left': Math.PI,
      'right': 0,
      'bottom': Math.PI / 2,
      'bottom-left': Math.PI * 0.75,
      'bottom-right': Math.PI * 0.25
    };
    var a = angles[slot.tail];
    if (a === undefined) return;

    var spread = 0.22; // 꼬리 밑변 각도
    function pointOn(angle) {
      if (slot.bubble === 'round' || slot.bubble === 'none') {
        // 사각형 테두리 위의 점
        var dx = Math.cos(angle), dy = Math.sin(angle);
        var t = Math.min(Math.abs(rx / (dx || 1e-6)), Math.abs(ry / (dy || 1e-6)));
        return [cx + dx * t, cy + dy * t];
      }
      return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
    }

    var p1 = pointOn(a - spread);
    var p2 = pointOn(a + spread);
    var tip = [cx + Math.cos(a) * (rx + len), cy + Math.sin(a) * (ry + len)];

    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#111111';
    // 밑변은 말풍선 안쪽이므로 두 변만 그린다
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  }

  /* ── 이미지 배치 ───────────────────────────────────── */
  MG.drawImageFit = function (ctx, img, slot) {
    var x = slot.x, y = slot.y, w = slot.w, h = slot.h;
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return;

    ctx.save();
    if (slot.radius > 0) roundRectPath(ctx, x, y, w, h, slot.radius);
    else { ctx.beginPath(); ctx.rect(x, y, w, h); }
    ctx.clip();

    if (slot.fit === 'fill') {
      ctx.drawImage(img, x, y, w, h);
    } else {
      var base = slot.fit === 'contain'
        ? Math.min(w / iw, h / ih)
        : Math.max(w / iw, h / ih);
      var s = base * (slot.scale || 1);
      var dw = iw * s, dh = ih * s;
      var dx = x + (w - dw) / 2 + (slot.offsetX || 0) * w / 2;
      var dy = y + (h - dh) / 2 + (slot.offsetY || 0) * h / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    ctx.restore();
  };

  function drawImagePlaceholder(ctx, slot) {
    ctx.save();
    if (slot.radius > 0) roundRectPath(ctx, slot.x, slot.y, slot.w, slot.h, slot.radius);
    else { ctx.beginPath(); ctx.rect(slot.x, slot.y, slot.w, slot.h); }
    // 배경 그림 위에 놓인 빈 사진 칸도 아래가 비쳐 보이도록 반투명하게 그린다
    ctx.fillStyle = 'rgba(233,237,242,.72)';
    ctx.fill();
    ctx.clip();

    // 대각 스트라이프
    ctx.strokeStyle = 'rgba(180,193,209,.55)';
    ctx.lineWidth = 8;
    var step = 28;
    for (var i = -slot.h; i < slot.w; i += step) {
      ctx.beginPath();
      ctx.moveTo(slot.x + i, slot.y);
      ctx.lineTo(slot.x + i + slot.h, slot.y + slot.h);
      ctx.stroke();
    }

    var label = slot.name || '사진';
    var size = Math.max(12, Math.min(22, slot.h * 0.16));
    ctx.font = '600 ' + size + 'px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    roundRectPath(ctx, slot.x + slot.w / 2 - tw / 2 - 12, slot.y + slot.h / 2 - size,
      tw + 24, size * 2, size);
    ctx.fill();
    ctx.fillStyle = '#6b7684';
    ctx.fillText(label, slot.x + slot.w / 2, slot.y + slot.h / 2);
    ctx.restore();
  }

  /* ── 대사 칸 ───────────────────────────────────────── */
  function drawTextSlot(ctx, slot) {
    var padX, padY;
    if (slot.bubble === 'ellipse') { padX = slot.w * 0.14; padY = slot.h * 0.16; }
    else if (slot.bubble === 'round') { padX = 14; padY = 12; }
    else { padX = 4; padY = 2; }

    var boxW = Math.max(10, slot.w - padX * 2);
    var boxH = Math.max(10, slot.h - padY * 2);

    // 말풍선 배경
    if (slot.bubble !== 'none') {
      drawTail(ctx, slot);
      if (slot.bubble === 'ellipse') ellipsePath(ctx, slot.x, slot.y, slot.w, slot.h);
      else roundRectPath(ctx, slot.x, slot.y, slot.w, slot.h, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#111111';
      ctx.stroke();
    }

    if (!slot.text) return;

    var weight = slot.bold ? '700' : '400';
    var fitted;
    if (slot.autoFit) {
      fitted = fitFontSize(ctx, slot, boxW, boxH);
    } else {
      ctx.font = weight + ' ' + slot.fontSize + 'px ' + FONT_STACK;
      fitted = {
        size: slot.fontSize,
        lines: MG.wrapText(ctx, slot.text, boxW),
        lineHeight: slot.fontSize * 1.22
      };
    }
    ctx.font = weight + ' ' + fitted.size + 'px ' + FONT_STACK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = slot.align || 'center';

    var tx = slot.x + slot.w / 2;
    if (slot.align === 'left') tx = slot.x + padX;
    else if (slot.align === 'right') tx = slot.x + slot.w - padX;

    var total = fitted.lines.length * fitted.lineHeight;
    var startY = slot.y + slot.h / 2 - total / 2 + fitted.lineHeight / 2;

    ctx.save();
    for (var i = 0; i < fitted.lines.length; i++) {
      var ly = startY + i * fitted.lineHeight;
      if (slot.stroke) {
        ctx.lineWidth = Math.max(3, fitted.size * 0.14);
        ctx.strokeStyle = '#000000';
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(fitted.lines[i], tx, ly);
      }
      ctx.fillStyle = slot.color || '#111111';
      ctx.fillText(fitted.lines[i], tx, ly);
    }
    ctx.restore();
  }

  /* ── 선택 표시 / 핸들 ──────────────────────────────── */
  MG.HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  MG.handleRects = function (slot, size) {
    var s = size;
    var half = s / 2;
    var cx = slot.x + slot.w / 2, cy = slot.y + slot.h / 2;
    var pos = {
      nw: [slot.x, slot.y], n: [cx, slot.y], ne: [slot.x + slot.w, slot.y],
      e: [slot.x + slot.w, cy], se: [slot.x + slot.w, slot.y + slot.h],
      s: [cx, slot.y + slot.h], sw: [slot.x, slot.y + slot.h], w: [slot.x, cy]
    };
    return MG.HANDLES.map(function (k) {
      return { key: k, x: pos[k][0] - half, y: pos[k][1] - half, w: s, h: s };
    });
  };

  function drawSelection(ctx, slot, scale) {
    var lw = 2 / scale;
    ctx.save();
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.lineWidth = lw;
    ctx.strokeStyle = '#2f6bff';
    ctx.strokeRect(slot.x, slot.y, slot.w, slot.h);
    ctx.setLineDash([]);

    var hs = 10 / scale;
    MG.handleRects(slot, hs).forEach(function (h) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2f6bff';
      ctx.lineWidth = lw;
      ctx.fillRect(h.x, h.y, h.w, h.h);
      ctx.strokeRect(h.x, h.y, h.w, h.h);
    });
    ctx.restore();
  }

  function drawGuide(ctx, slot, scale) {
    ctx.save();
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = slot.type === 'text' ? 'rgba(47,107,255,.35)' : 'rgba(255,120,60,.4)';
    ctx.setLineDash([4 / scale, 4 / scale]);
    ctx.strokeRect(slot.x, slot.y, slot.w, slot.h);
    ctx.restore();
  }

  /* ── 메인 렌더 ─────────────────────────────────────── */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} tpl 템플릿
   * @param {object} opts { selectedId, showGuides, scale }
   */
  MG.render = function (ctx, tpl, opts) {
    opts = opts || {};
    var scale = opts.scale || 1;

    ctx.save();
    ctx.clearRect(0, 0, tpl.width, tpl.height);
    ctx.fillStyle = tpl.background || '#ffffff';
    ctx.fillRect(0, 0, tpl.width, tpl.height);

    // 만화 칸 배경
    (tpl.panels || []).forEach(function (p) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(p.x, p.y, p.w, p.h);
    });

    // 사진 칸
    tpl.slots.forEach(function (slot) {
      if (slot.type !== 'image') return;
      var img = MG.getCachedImage(slot.src);
      if (img) MG.drawImageFit(ctx, img, slot);
      else if (opts.placeholders !== false) drawImagePlaceholder(ctx, slot);
    });

    // 만화 칸 테두리(사진 위에)
    (tpl.panels || []).forEach(function (p) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#111111';
      ctx.strokeRect(p.x, p.y, p.w, p.h);
    });

    // 대사 칸
    tpl.slots.forEach(function (slot) {
      if (slot.type === 'text') drawTextSlot(ctx, slot);
    });

    // 편집 보조선
    if (opts.showGuides) {
      tpl.slots.forEach(function (slot) {
        if (slot.id !== opts.selectedId) drawGuide(ctx, slot, scale);
      });
    }
    if (opts.selectedId) {
      var sel = tpl.slots.filter(function (s) { return s.id === opts.selectedId; })[0];
      if (sel) drawSelection(ctx, sel, scale);
    }
    ctx.restore();
  };

  /** 갤러리용 썸네일 dataURL */
  MG.makeThumb = function (tpl, maxW, maxH) {
    var scale = Math.min(maxW / tpl.width, maxH / tpl.height);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(tpl.width * scale));
    c.height = Math.max(1, Math.round(tpl.height * scale));
    var ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    MG.render(ctx, tpl, { showGuides: false });
    return c.toDataURL('image/png');
  };

  /** 내보내기용 고해상도 렌더 */
  MG.renderToCanvas = function (tpl, pixelScale) {
    var s = pixelScale || 2;
    var c = document.createElement('canvas');
    c.width = Math.round(tpl.width * s);
    c.height = Math.round(tpl.height * s);
    var ctx = c.getContext('2d');
    ctx.scale(s, s);
    // 내보내기에서는 비어 있는 사진 칸의 안내 무늬를 그리지 않는다
    MG.render(ctx, tpl, { showGuides: false, placeholders: false });
    return c;
  };

  MG.FONT_STACK = FONT_STACK;
})(window);
