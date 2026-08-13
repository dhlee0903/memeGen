/* 밈 생성기 — 배경 지우기(누끼)
 *
 * 가장자리에서 시작해 비슷한 색이 이어지는 만큼을 배경으로 보고 지운다.
 * 흰 배경 제품 사진처럼 배경이 단색이고 피사체가 가운데 있는 사진에 잘 맞는다.
 * 배경이 복잡한 사진(풍경, 실내)은 잘 안 된다 — 그건 학습 모델이 필요한데,
 * 한글 모델은 수십 MB라 이 앱에 담기 어렵다.
 *
 * 브라우저에서 다 처리하므로 사진이 밖으로 나가지 않는다.
 */
(function (global) {
  'use strict';

  var MG = (global.MG = global.MG || {});

  var MAX_SIDE = 1600;      // 처리 상한
  var DEFAULT_TOLERANCE = 32;

  /** 두 색의 거리(0~441) */
  function dist(r1, g1, b1, r2, g2, b2) {
    var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /** 가장자리 픽셀에서 가장 흔한 색을 배경색으로 본다 */
  function edgeColor(data, w, h) {
    var buckets = Object.create(null);
    var best = null, bestN = 0;

    function add(x, y) {
      var i = (y * w + x) * 4;
      // 24단계로 뭉뚱그려 비슷한 색끼리 모은다
      var key = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4);
      var b = buckets[key];
      if (!b) b = buckets[key] = { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      if (b.n > bestN) { bestN = b.n; best = b; }
    }

    for (var x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (var y = 0; y < h; y++) { add(0, y); add(w - 1, y); }

    if (!best) return [255, 255, 255];
    return [best.r / best.n, best.g / best.n, best.b / best.n];
  }

  /**
   * 배경을 지우고 PNG data URI 를 돌려준다.
   * @param {HTMLImageElement} img
   * @param {object} [opts] { tolerance }
   * @returns {{url:string, removed:number}} removed 는 지워진 픽셀 비율(0~1)
   */
  MG.removeBackground = function (img, opts) {
    opts = opts || {};
    var tol = opts.tolerance || DEFAULT_TOLERANCE;

    var iw = img.naturalWidth, ih = img.naturalHeight;
    var scale = Math.min(1, MAX_SIDE / Math.max(iw, ih));
    var w = Math.max(1, Math.round(iw * scale));
    var h = Math.max(1, Math.round(ih * scale));

    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    var imageData = ctx.getImageData(0, 0, w, h);
    var data = imageData.data;
    var bg = edgeColor(data, w, h);

    // 가장자리에서 시작하는 너비 우선 탐색. 배경색과 가까운 픽셀만 번져 나간다.
    var total = w * h;
    var mask = new Uint8Array(total);       // 1 = 배경
    var queue = new Int32Array(total);
    var head = 0, tail = 0;

    function seed(idx) {
      if (mask[idx]) return;
      var p = idx * 4;
      if (dist(data[p], data[p + 1], data[p + 2], bg[0], bg[1], bg[2]) > tol) return;
      mask[idx] = 1;
      queue[tail++] = idx;
    }

    for (var x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }

    while (head < tail) {
      var idx = queue[head++];
      var cx = idx % w;
      var cy = (idx - cx) / w;
      if (cx > 0) seed(idx - 1);
      if (cx < w - 1) seed(idx + 1);
      if (cy > 0) seed(idx - w);
      if (cy < h - 1) seed(idx + w);
    }

    /* 경계를 부드럽게. 배경으로 지운 칸에 닿아 있는 픽셀은 배경색에 가까운
     * 만큼 반투명하게 만든다. 안 하면 테두리에 원래 배경색 띠가 남는다. */
    var alpha = new Uint8Array(total);
    for (var i = 0; i < total; i++) alpha[i] = mask[i] ? 0 : 255;

    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        var k = yy * w + xx;
        if (mask[k]) continue;
        var touching =
          (xx > 0 && mask[k - 1]) || (xx < w - 1 && mask[k + 1]) ||
          (yy > 0 && mask[k - w]) || (yy < h - 1 && mask[k + w]);
        if (!touching) continue;
        var q = k * 4;
        var d = dist(data[q], data[q + 1], data[q + 2], bg[0], bg[1], bg[2]);
        // 배경색과 가까울수록 더 투명하게
        var a = Math.max(0, Math.min(1, (d - tol * 0.4) / (tol * 1.2)));
        alpha[k] = Math.round(a * 255);
      }
    }

    var removed = 0;
    for (var j = 0; j < total; j++) {
      data[j * 4 + 3] = alpha[j];
      if (alpha[j] === 0) removed++;
    }

    ctx.putImageData(imageData, 0, 0);
    return { url: c.toDataURL('image/png'), removed: removed / total };
  };
})(window);
