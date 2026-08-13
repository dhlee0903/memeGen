/* 밈 생성기 — 내장 템플릿 정의
 *
 * 템플릿 구조
 *   { id, name, desc, width, height, background,
 *     panels: [ {x,y,w,h} ],            // 만화 칸(흰 배경 + 검은 테두리)
 *     slots:  [ 슬롯 ] }
 *
 * 슬롯 공통: { id, type:'text'|'image', name, x, y, w, h }
 *   text  : { text, fontSize, autoFit, bold, align, color, bubble, tail, stroke }
 *             bubble: 'ellipse' | 'round' | 'none'
 *             tail  : 'none' | 'left' | 'right' | 'bottom' | 'bottom-left' | 'bottom-right'
 *   image : { src, fit:'cover'|'contain'|'fill', scale, offsetX, offsetY, radius }
 */
(function (global) {
  'use strict';

  var uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return (prefix || 's') + '_' + Date.now().toString(36) + '_' + uidCounter;
  }

  /** 대사 칸 기본값 */
  function textSlot(o) {
    return Object.assign({
      id: uid('t'),
      type: 'text',
      name: '대사',
      x: 0, y: 0, w: 200, h: 90,
      text: '대사를 입력하세요',
      fontSize: 26,
      autoFit: true,
      bold: true,
      align: 'center',
      color: '#111111',
      bubble: 'ellipse',
      tail: 'none',
      stroke: false
    }, o || {});
  }

  /** 사진 칸 기본값 */
  function imageSlot(o) {
    return Object.assign({
      id: uid('i'),
      type: 'image',
      name: '사진',
      x: 0, y: 0, w: 240, h: 200,
      src: null,
      fit: 'cover',
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      radius: 0
    }, o || {});
  }

  /* ── 격자 계산 유틸 ─────────────────────────────────── */
  function grid(cols, rows, width, height, margin, gutter) {
    var cells = [];
    var cw = (width - margin * 2 - gutter * (cols - 1)) / cols;
    var ch = (height - margin * 2 - gutter * (rows - 1)) / rows;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        cells.push({
          x: Math.round(margin + c * (cw + gutter)),
          y: Math.round(margin + r * (ch + gutter)),
          w: Math.round(cw),
          h: Math.round(ch)
        });
      }
    }
    return cells;
  }

  /* ── 1) 만화 8컷 : "이거 다 똑같은 거 아니에요?" 형식 ── */
  function comicGrid(id, name, desc, cols, rows, width, height, sampleLines) {
    return function () {
      var cells = grid(cols, rows, width, height, 16, 12);
      var slots = [];
      cells.forEach(function (cell, i) {
        slots.push(imageSlot({
          name: (i + 1) + '컷 사진',
          x: cell.x, y: cell.y, w: cell.w, h: cell.h
        }));
      });
      cells.forEach(function (cell, i) {
        var bw = Math.round(cell.w * 0.52);
        var bh = Math.round(Math.min(cell.h * 0.42, 96));
        slots.push(textSlot({
          name: (i + 1) + '컷 대사',
          x: cell.x + 10,
          y: cell.y + 10,
          w: bw, h: bh,
          text: (sampleLines && sampleLines[i]) || ('대사 ' + (i + 1)),
          fontSize: 24,
          tail: i % 2 === 0 ? 'bottom-right' : 'bottom-left'
        }));
      });
      return {
        id: id, name: name, desc: desc,
        width: width, height: height,
        background: '#ffffff',
        panels: cells,
        slots: slots
      };
    };
  }

  /* ── 2) 비교 2단 ────────────────────────────────────── */
  function compare2() {
    var W = 800, H = 800, m = 16, g = 12;
    var rowH = Math.round((H - m * 2 - g) / 2);
    var leftW = Math.round((W - m * 2 - g) * 0.42);
    var rightW = W - m * 2 - g - leftW;
    var panels = [
      { x: m, y: m, w: leftW, h: rowH },
      { x: m + leftW + g, y: m, w: rightW, h: rowH },
      { x: m, y: m + rowH + g, w: leftW, h: rowH },
      { x: m + leftW + g, y: m + rowH + g, w: rightW, h: rowH }
    ];
    return {
      id: 'compare-2', name: '비교 2단', desc: '왼쪽 반응 · 오른쪽 내용',
      width: W, height: H, background: '#ffffff', panels: panels,
      slots: [
        imageSlot({ name: '위 반응 사진', x: panels[0].x, y: panels[0].y, w: panels[0].w, h: panels[0].h }),
        imageSlot({ name: '아래 반응 사진', x: panels[2].x, y: panels[2].y, w: panels[2].w, h: panels[2].h }),
        textSlot({
          name: '위 내용', bubble: 'none', color: '#111111', autoFit: true,
          x: panels[1].x + 24, y: panels[1].y + 24,
          w: panels[1].w - 48, h: panels[1].h - 48,
          text: '싫어하는 것', fontSize: 44
        }),
        textSlot({
          name: '아래 내용', bubble: 'none', color: '#111111', autoFit: true,
          x: panels[3].x + 24, y: panels[3].y + 24,
          w: panels[3].w - 48, h: panels[3].h - 48,
          text: '좋아하는 것', fontSize: 44
        })
      ]
    };
  }

  /* ── 3) 4분할 비교 (사진 + 아래 캡션) ───────────────── */
  function quad() {
    var W = 800, H = 800;
    var cells = grid(2, 2, W, H, 16, 12);
    var slots = [];
    cells.forEach(function (c, i) {
      slots.push(imageSlot({
        name: (i + 1) + '번 사진',
        x: c.x, y: c.y, w: c.w, h: Math.round(c.h - 74)
      }));
    });
    cells.forEach(function (c, i) {
      slots.push(textSlot({
        name: (i + 1) + '번 설명', bubble: 'none', autoFit: true, fontSize: 30,
        x: c.x + 8, y: c.y + c.h - 68, w: c.w - 16, h: 60,
        text: '설명 ' + (i + 1)
      }));
    });
    return {
      id: 'quad-4', name: '4분할 비교', desc: '사진 4장 + 각각 설명',
      width: W, height: H, background: '#ffffff', panels: cells, slots: slots
    };
  }

  /* ── 4) 기본 밈 (위/아래 임팩트 텍스트) ─────────────── */
  function classic() {
    var W = 800, H = 800;
    return {
      id: 'classic-top-bottom', name: '기본 밈', desc: '사진 한 장 + 위/아래 흰 글씨',
      width: W, height: H, background: '#000000', panels: [],
      slots: [
        imageSlot({ name: '배경 사진', x: 0, y: 0, w: W, h: H }),
        textSlot({
          name: '위 문구', x: 40, y: 30, w: W - 80, h: 120,
          text: '위쪽 문구', fontSize: 64, color: '#ffffff',
          bubble: 'none', stroke: true, autoFit: true
        }),
        textSlot({
          name: '아래 문구', x: 40, y: H - 150, w: W - 80, h: 120,
          text: '아래쪽 문구', fontSize: 64, color: '#ffffff',
          bubble: 'none', stroke: true, autoFit: true
        })
      ]
    };
  }

  /* ── 5) 말풍선 3개 ──────────────────────────────────── */
  function bubbles3() {
    var W = 800, H = 600;
    return {
      id: 'bubbles-3', name: '말풍선 3개', desc: '사진 한 장에 대사 세 개',
      width: W, height: H, background: '#ffffff',
      panels: [{ x: 12, y: 12, w: W - 24, h: H - 24 }],
      slots: [
        imageSlot({ name: '배경 사진', x: 12, y: 12, w: W - 24, h: H - 24 }),
        textSlot({ name: '대사 1', x: 40, y: 40, w: 260, h: 110, text: '첫 번째 대사', tail: 'bottom-right' }),
        textSlot({ name: '대사 2', x: 470, y: 120, w: 280, h: 110, text: '두 번째 대사', tail: 'bottom-left' }),
        textSlot({ name: '대사 3', x: 240, y: 420, w: 300, h: 120, text: '세 번째 대사', tail: 'bottom' })
      ]
    };
  }

  /* ── 6) 빈 캔버스 ───────────────────────────────────── */
  function blank() {
    return {
      id: 'blank', name: '빈 캔버스', desc: '처음부터 자유롭게',
      width: 800, height: 800, background: '#ffffff', panels: [], slots: []
    };
  }

  var BUILDERS = [
    comicGrid('comic-8', '만화 8컷', '2열 × 4행 · "이거 다 똑같은 거 아니에요?"', 2, 4, 800, 1000,
      ['이건 A', '이건 B', '이건 C', '이건 D', '전부 똑같은 거 아니에요?', '이건 E', '이래서 알못들은!', '다르다니까!!']),
    comicGrid('comic-4', '만화 4컷', '2열 × 2행 기본 만화', 2, 2, 800, 620,
      ['이건 A', '이건 B', '똑같은데요?', '다르다니까!']),
    compare2,
    quad,
    classic,
    bubbles3,
    blank
  ];

  global.MG = global.MG || {};
  global.MG.uid = uid;
  global.MG.textSlot = textSlot;
  global.MG.imageSlot = imageSlot;

  /** 매번 새 인스턴스를 만들어 반환(슬롯 id 중복 방지) */
  global.MG.buildTemplate = function (id) {
    for (var i = 0; i < BUILDERS.length; i++) {
      var t = BUILDERS[i]();
      if (t.id === id) return t;
    }
    return null;
  };

  /** 갤러리 표시용 목록 */
  global.MG.listTemplates = function () {
    return BUILDERS.map(function (b) { return b(); });
  };

  /** 업로드한 배경 이미지로 만드는 커스텀 템플릿 */
  global.MG.templateFromImage = function (dataUrl, iw, ih) {
    var maxSide = 1200;
    var scale = Math.min(1, maxSide / Math.max(iw, ih));
    var W = Math.round(iw * scale);
    var H = Math.round(ih * scale);
    return {
      id: 'custom-' + uid('c'),
      name: '내 이미지',
      desc: '업로드한 배경',
      width: W, height: H,
      background: '#ffffff',
      panels: [],
      slots: [
        imageSlot({ name: '배경 사진', x: 0, y: 0, w: W, h: H, src: dataUrl, fit: 'cover' })
      ]
    };
  };
})(window);
