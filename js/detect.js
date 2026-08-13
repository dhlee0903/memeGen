/* 밈 생성기 — 말풍선 자동 인식
 *
 * 배경으로 올린 만화 페이지에서 "검은 윤곽선으로 둘러싸인 흰 덩어리"를 찾아
 * 대사 칸 후보로 돌려준다. 스크린톤(회색 점)과 검은 선은 흰색이 아니므로 걸러지고,
 * 페이지 여백·칸 사이 흰 공간은 서로 이어져 하나의 거대한 덩어리가 되므로
 * 면적 상한으로 걸러진다.
 */
(function (global) {
  'use strict';

  var MG = (global.MG = global.MG || {});

  var ANALYSIS_MAX_SIDE = 900;   // 분석용 축소 기준
  var WHITE_THRESHOLD = 232;     // 이 값 이상이면 흰색으로 본다

  /** 흰색 연결 요소를 찾아 [{minX,minY,maxX,maxY,area}] 반환 */
  function connectedWhiteBlobs(white, w, h) {
    var visited = new Uint8Array(w * h);
    var stack = new Int32Array(w * h);
    var blobs = [];

    for (var start = 0; start < w * h; start++) {
      if (!white[start] || visited[start]) continue;

      var top = 0;
      stack[top++] = start;
      visited[start] = 1;

      var minX = w, minY = h, maxX = -1, maxY = -1, area = 0;

      while (top > 0) {
        var idx = stack[--top];
        var x = idx % w;
        var y = (idx - x) / w;

        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        // 4방향 이웃
        if (x > 0 && white[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; stack[top++] = idx - 1; }
        if (x < w - 1 && white[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; stack[top++] = idx + 1; }
        if (y > 0 && white[idx - w] && !visited[idx - w]) { visited[idx - w] = 1; stack[top++] = idx - w; }
        if (y < h - 1 && white[idx + w] && !visited[idx + w]) { visited[idx + w] = 1; stack[top++] = idx + w; }
      }

      blobs.push({ minX: minX, minY: minY, maxX: maxX, maxY: maxY, area: area });
    }
    return blobs;
  }

  /**
   * 이미지에서 말풍선으로 보이는 영역을 찾는다.
   * @returns {Array<{x,y,w,h}>} 0~1 로 정규화된 상대 좌표
   */
  MG.detectBubbles = function (img) {
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return [];

    var s = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(iw, ih));
    var w = Math.max(1, Math.round(iw * s));
    var h = Math.max(1, Math.round(ih * s));

    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    var data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return [];   // 다른 출처 이미지로 캔버스가 오염된 경우
    }

    var total = w * h;
    var white = new Uint8Array(total);
    for (var i = 0, p = 0; i < total; i++, p += 4) {
      if (data[p] >= WHITE_THRESHOLD && data[p + 1] >= WHITE_THRESHOLD && data[p + 2] >= WHITE_THRESHOLD) {
        white[i] = 1;
      }
    }

    var blobs = connectedWhiteBlobs(white, w, h);

    var minArea = total * 0.0012;   // 너무 작은 건 글자 사이 여백
    var maxArea = total * 0.07;     // 너무 큰 건 페이지 여백 / 칸 사이 공백
    var out = [];

    for (var b = 0; b < blobs.length; b++) {
      var blob = blobs[b];
      if (blob.area < minArea || blob.area > maxArea) continue;

      var bw = blob.maxX - blob.minX + 1;
      var bh = blob.maxY - blob.minY + 1;
      if (bw < 22 || bh < 16) continue;

      // 말풍선은 속이 꽉 찬 둥근 덩어리다. 가늘고 긴 여백이나 갈라진 배경을 배제한다.
      var fill = blob.area / (bw * bh);
      if (fill < 0.62) continue;

      var aspect = bw / bh;
      if (aspect < 0.3 || aspect > 3.6) continue;

      out.push({
        x: blob.minX / w,
        y: blob.minY / h,
        w: bw / w,
        h: bh / h
      });
    }

    // 읽는 순서(위 → 아래, 같은 줄이면 왼쪽 → 오른쪽)로 정렬
    out.sort(function (a, z) {
      var rowGap = Math.min(a.h, z.h) * 0.6;
      if (Math.abs(a.y - z.y) > rowGap) return a.y - z.y;
      return a.x - z.x;
    });

    return out;
  };
})(window);
