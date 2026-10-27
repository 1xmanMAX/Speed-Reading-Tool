/* Lectura Veloz — OCR con Indra (Datalab), portado a JavaScript.
 *
 * Indra OCR (https://github.com/datalab-to/indra, código Apache 2.0, modelos
 * OpenRAIL-M modificada: gratis para uso personal) lee páginas escaneadas en la CPU:
 *   1. endereza la página (inclinación y giros de 90°/180°, orient.onnx),
 *   2. detecta las líneas de texto (det.onnx),
 *   3. lee cada línea con un reconocedor CTC (rec.onnx),
 *   4. ordena las líneas y las agrupa en bloques con su tipo (order.onnx):
 *      párrafo, título, lista, tabla, cabecera o pie de página.
 * Es una traducción del pipeline de Python (indra_ocr 1.1.2, modelos v1.1.0) para el
 * reconocedor latino; sin modelos de lenguaje ni reconocedores CJK/RTL.
 *
 * Funciona en una página web, en un Web Worker y en Node: recibe `ort`
 * (onnxruntime-web o onnxruntime-node) y los bytes de los modelos.
 *
 *   const ocr = await IndraOCR.create(ort, { det, rec, order, orient, meta });
 *   const page = await ocr.read({ width, height, data: Uint8Array /* gris *\/ });
 *   page.text        // párrafos separados por una línea en blanco
 *   page.blocks      // [{ label, text }] en orden de lectura
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ constantes (pipeline.py)
  var ADAPTIVE_MIN_H = 9.0;
  var ADAPTIVE_TARGET_H = 12.0;
  var ADAPTIVE_MAX_SIDE = 2048;
  var SPLIT_GAP = 3.0;
  var CELL_GAP = 1.8;
  var GUTTER_GAP = 1.6;
  var GUTTER_EDGES = 3;
  var ORIENT_SIDE = 768;
  var ORIENT_MIN = 0.95;
  var MIN_CONF = 0.5;
  var DESKEW_MAX = 45.0;
  var DESKEW_MIN = 0.3;
  var PREVIEW_SIDE = 1600;
  // det_post.py
  var CORE_X_SHRINK = 0.15;
  var OUT_STRIDE = 2;
  var INPUT_MULTIPLE = 32;
  // rec_preproc.py
  var PAD_Y = 0.2;
  var PAD_X = 0.3;
  var WIDTH_MULTIPLE = 8;
  // order_post.py
  var BLOCK_CLASSES = ['Text', 'Section-Header', 'Page-Header', 'Page-Footer', 'List-Group',
    'Table', 'Caption', 'Footnote', 'Table-Of-Contents', 'Form'];
  var GRID = [5, 8, 9]; // Table, Table-Of-Contents, Form
  var SENTENCE_END = '.!?:;。！？：；．';
  var LEADER_CHARS = '.·…‥_-–—=';
  var DASHES = '-–—';
  var BULLETS = '•◦▪▫●○■□‣⁃∙*';
  var ENUMERATOR = /^(?:(?:\d{1,3}|[A-Za-z])[.)]|\((?:\d{1,3}|[A-Za-z]|[ivxlcIVXLC]{1,5})\))$/;
  var MARKER_GAP = 2.5;
  var ITEM = /^\s*([•\-–▪◦*·→]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])(\s|$)/;

  // ------------------------------------------------------------ imágenes en gris
  // Una imagen es { w, h, d } con d: Uint8Array (0 = negro, 255 = blanco) o Float32Array.

  function img(w, h, d) { return { w: w, h: h, d: d }; }

  // Pesos de una dimensión para el remuestreo por área (cv2.INTER_AREA al reducir).
  function areaTaps(src, dst) {
    var s = src / dst, taps = new Array(dst);
    for (var i = 0; i < dst; i++) {
      var a = i * s, b = Math.min(src, a + s), idx = [], wt = [];
      for (var j = Math.floor(a); j < b; j++) {
        var c = Math.min(j + 1, b) - Math.max(j, a);
        if (c > 1e-9) { idx.push(j); wt.push(c / s); }
      }
      taps[i] = { idx: idx, wt: wt };
    }
    return taps;
  }

  // Pesos de una dimensión para el remuestreo bilineal (cv2.INTER_LINEAR).
  function linearTaps(src, dst) {
    var s = src / dst, taps = new Array(dst);
    for (var i = 0; i < dst; i++) {
      var x = (i + 0.5) * s - 0.5;
      if (x < 0) x = 0;
      var x0 = Math.floor(x), x1 = Math.min(x0 + 1, src - 1), f = x - x0;
      if (x0 >= src - 1) { x0 = src - 1; x1 = src - 1; f = 0; }
      taps[i] = f > 0 ? { idx: [x0, x1], wt: [1 - f, f] } : { idx: [x0], wt: [1] };
    }
    return taps;
  }

  // Redimensiona (separable). area: reducir por área; si no, bilineal.
  function resize(im, nw, nh, area) {
    var tx = (area && nw < im.w ? areaTaps : linearTaps)(im.w, nw);
    var ty = (area && nh < im.h ? areaTaps : linearTaps)(im.h, nh);
    var tmp = new Float32Array(nw * im.h), src = im.d, x, y, k, t, acc;
    for (y = 0; y < im.h; y++) {
      var row = y * im.w, orow = y * nw;
      for (x = 0; x < nw; x++) {
        t = tx[x]; acc = 0;
        for (k = 0; k < t.idx.length; k++) acc += src[row + t.idx[k]] * t.wt[k];
        tmp[orow + x] = acc;
      }
    }
    var out = new Float32Array(nw * nh);
    for (y = 0; y < nh; y++) {
      t = ty[y];
      var o = y * nw;
      for (k = 0; k < t.idx.length; k++) {
        var r = t.idx[k] * nw, wk = t.wt[k];
        for (x = 0; x < nw; x++) out[o + x] += tmp[r + x] * wk;
      }
    }
    return img(nw, nh, out);
  }

  function toU8(im) {
    var d = new Uint8Array(im.w * im.h), s = im.d;
    for (var i = 0; i < d.length; i++) { var v = Math.round(s[i]); d[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    return img(im.w, im.h, d);
  }

  function scaled(im, side) {
    var s = side / Math.max(im.w, im.h);
    return [Math.max(1, Math.round(im.w * s)), Math.max(1, Math.round(im.h * s))];
  }

  // cv2.getRotationMatrix2D + warpAffine (bilineal). border: 'replicate' o un valor.
  function rotate(im, deg, border) {
    var w = im.w, h = im.h, src = im.d;
    var rad = deg * Math.PI / 180, a = Math.cos(rad), b = Math.sin(rad);
    var cx = w / 2, cy = h / 2;
    // M = [[a, b, (1-a)cx - b cy], [-b, a, b cx + (1-a) cy]]; dst(x, y) = src(M⁻¹(x, y))
    var m02 = (1 - a) * cx - b * cy, m12 = b * cx + (1 - a) * cy;
    var out = new (src instanceof Uint8Array ? Uint8Array : Float32Array)(w * h);
    var rep = border === 'replicate', fill = rep ? 0 : (border || 0);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = x - m02, dy = y - m12;
        var sx = a * dx - b * dy, sy = b * dx + a * dy;
        var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        var v00, v01, v10, v11;
        if (x0 >= 0 && y0 >= 0 && x0 + 1 < w && y0 + 1 < h) {
          var p = y0 * w + x0;
          v00 = src[p]; v01 = src[p + 1]; v10 = src[p + w]; v11 = src[p + w + 1];
        } else {
          if (!rep && (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h)) { out[y * w + x] = fill; continue; }
          v00 = px(src, w, h, x0, y0, rep, fill); v01 = px(src, w, h, x0 + 1, y0, rep, fill);
          v10 = px(src, w, h, x0, y0 + 1, rep, fill); v11 = px(src, w, h, x0 + 1, y0 + 1, rep, fill);
        }
        out[y * w + x] = (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy;
      }
    }
    return img(w, h, out);
  }

  function px(src, w, h, x, y, rep, fill) {
    if (x < 0 || y < 0 || x >= w || y >= h) {
      if (!rep) return fill;
      x = x < 0 ? 0 : x >= w ? w - 1 : x;
      y = y < 0 ? 0 : y >= h ? h - 1 : y;
    }
    return src[y * w + x];
  }

  // np.rot90(im, -k): k cuartos de vuelta en sentido horario.
  function rot90cw(im, k) {
    k = ((k % 4) + 4) % 4;
    for (var t = 0; t < k; t++) {
      var w = im.w, h = im.h, s = im.d, d = new s.constructor(w * h);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) d[x * h + (h - 1 - y)] = s[y * w + x];
      im = img(h, w, d);
    }
    return im;
  }

  // ------------------------------------------------------------ inclinación (estimate_skew)

  function inkThumb(gray, side) {
    var sz = scaled(gray, side);
    var small = toU8(resize(gray, sz[0], sz[1], true));
    for (var i = 0; i < small.d.length; i++) small.d[i] = 255 - small.d[i];
    return small;
  }

  // La miniatura con un borde de 1 px a cero: el muestreo bilineal no comprueba límites.
  function padded(ink) {
    var pw = ink.w + 2, out = new Uint8Array(pw * (ink.h + 2));
    for (var y = 0; y < ink.h; y++) out.set(ink.d.subarray(y * ink.w, (y + 1) * ink.w), (y + 1) * pw + 1);
    return { w: ink.w, h: ink.h, pw: pw, d: out };
  }

  // Cuánto cambia de una fila a otra el perfil horizontal de tinta, girado `a` grados.
  function rowSharpness(pad, a) {
    var w = pad.w, h = pad.h, pw = pad.pw, src = pad.d;
    var rad = a * Math.PI / 180, ca = Math.cos(rad), sa = Math.sin(rad);
    var cx = w / 2, cy = h / 2;
    var m02 = (1 - ca) * cx - sa * cy, m12 = sa * cx + (1 - ca) * cy;
    var prev = 0, total = 0;
    for (var y = 0; y < h; y++) {
      var sum = 0, dy = y - m12;
      var sx = -ca * m02 - sa * dy, sy = -sa * m02 + ca * dy; // x = 0
      for (var x = 0; x < w; x++, sx += ca, sy += sa) {
        if (sx < -1 || sy < -1 || sx >= w || sy >= h) continue;
        var x0 = ((sx + 1) | 0) - 1, y0 = ((sy + 1) | 0) - 1; // floor, con sx, sy >= -1
        var fx = sx - x0, fy = sy - y0, p = (y0 + 1) * pw + x0 + 1;
        var top = src[p] + (src[p + 1] - src[p]) * fx, bot = src[p + pw] + (src[p + pw + 1] - src[p + pw]) * fx;
        sum += (top + (bot - top) * fy + 0.5) | 0;
      }
      if (y > 0) { var dd = sum - prev; total += dd * dd; }
      prev = sum;
    }
    return total;
  }

  function range(a, b, step) {
    var out = [];
    for (var v = a; v <= b + 1e-6; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }

  function estimateSkew(gray, side) {
    side = side || 800;
    var fine = inkThumb(gray, side);
    var mean = 0;
    for (var i = 0; i < fine.d.length; i++) mean += fine.d[i];
    if (mean / fine.d.length < 0.003 * 255) return 0;
    var coarse = padded(inkThumb(gray, side >> 1));
    fine = padded(fine);
    var grid = range(-DESKEW_MAX, DESKEW_MAX, 2);
    var scores = grid.map(function (a) { return rowSharpness(coarse, a); });
    var top = grid.map(function (a, k) { return k; }).sort(function (p, q) { return scores[p] - scores[q]; }).slice(-2);
    var starts = [0].concat(top.map(function (k) { return grid[k]; }));
    var seen = new Map(), near = [];
    starts.forEach(function (a0) {
      range(a0 - 2, a0 + 2, 0.5).forEach(function (a) { near.push(a); });
    });
    near.forEach(function (a) { if (!seen.has(a)) seen.set(a, rowSharpness(fine, a)); });
    var a1 = near[0];
    near.forEach(function (a) { if (seen.get(a) > seen.get(a1)) a1 = a; });
    var best = a1, bestV = -1;
    range(a1 - 0.5, a1 + 0.5, 0.1).forEach(function (a) {
      var v = rowSharpness(fine, a);
      if (v > bestV) { bestV = v; best = a; }
    });
    return best;
  }

  // ------------------------------------------------------------ componentes conexas

  // Etiquetas 4-conexas de una máscara (Uint8Array). Devuelve { n, lab }.
  function components(mask, w, h) {
    var lab = new Int32Array(w * h), n = 0, stack = new Int32Array(w * h);
    for (var i = 0; i < mask.length; i++) {
      if (!mask[i] || lab[i]) continue;
      n++;
      var sp = 0;
      stack[sp++] = i; lab[i] = n;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p - x) / w;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = n; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = n; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = n; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = n; stack[sp++] = p + w; }
      }
    }
    return { n: n, lab: lab };
  }

  // ------------------------------------------------------------ detección (det_post.py)

  function pageToInput(gray, longSide) {
    var scale = longSide / Math.max(gray.w, gray.h);
    var nh = Math.max(1, Math.round(gray.h * scale)), nw = Math.max(1, Math.round(gray.w * scale));
    var r = (nw !== gray.w || nh !== gray.h) ? resize(gray, nw, nh, scale < 1) : gray;
    var ph = Math.ceil(nh / INPUT_MULTIPLE) * INPUT_MULTIPLE, pw = Math.ceil(nw / INPUT_MULTIPLE) * INPUT_MULTIPLE;
    var out = new Float32Array(ph * pw);
    for (var y = 0; y < nh; y++) {
      for (var x = 0; x < nw; x++) {
        var v = Math.round(r.d[y * nw + x]);
        out[y * pw + x] = 1 - (v < 0 ? 0 : v > 255 ? 255 : v) / 255;
      }
    }
    return { x: out, w: pw, h: ph, scale: scale };
  }

  // out: Float32Array [C, h, w] (logit del núcleo, distancia arriba, distancia abajo, …)
  function decodeDet(out, h, w) {
    var hw = h * w, mask = new Uint8Array(hw), prob = new Float32Array(hw);
    for (var i = 0; i < hw; i++) {
      prob[i] = 1 / (1 + Math.exp(-out[i]));
      mask[i] = prob[i] > 0.5 ? 1 : 0;
    }
    var cc = components(mask, w, h);
    var n = cc.n + 1, lab = cc.lab;
    var cnt = new Float64Array(n), top = new Float64Array(n), bot = new Float64Array(n), sc = new Float64Array(n);
    var minx = new Int32Array(n).fill(w), maxx = new Int32Array(n).fill(-1);
    for (i = 0; i < hw; i++) {
      var l = lab[i];
      if (!l) continue;
      var x = i % w, y = (i - x) / w, ys = (y + 0.5) * OUT_STRIDE;
      cnt[l]++;
      top[l] += ys - out[hw + i];
      bot[l] += ys + out[2 * hw + i];
      sc[l] += prob[i];
      if (x < minx[l]) minx[l] = x;
      if (x > maxx[l]) maxx[l] = x;
    }
    var boxes = [];
    for (l = 1; l < n; l++) {
      if (cnt[l] < 2) continue;
      var y0 = top[l] / cnt[l], y1 = bot[l] / cnt[l];
      var lh = Math.max(1, y1 - y0), ex = Math.min(CORE_X_SHRINK * lh, 0.5 * lh);
      boxes.push([minx[l] * OUT_STRIDE - ex, y0, (maxx[l] + 1) * OUT_STRIDE + ex, y1, sc[l] / cnt[l]]);
    }
    return boxes;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ------------------------------------------------------------ recorte de líneas (rec_preproc.py)

  // np.percentile (lineal) de los píxeles de un recorte, desde su histograma.
  function percentiles(gray, x0, y0, x1, y1, qs) {
    var hist = new Float64Array(256), n = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { hist[gray.d[y * gray.w + x]]++; n++; }
    var cum = new Float64Array(256), c = 0;
    for (var v = 0; v < 256; v++) { c += hist[v]; cum[v] = c; }
    function search(t) { // searchsorted(cum, t, side='right')
      for (var k = 0; k < 256; k++) if (cum[k] > t) return k;
      return 256;
    }
    return qs.map(function (q) {
      var xq = q * (n - 1), i = Math.floor(xq), g = xq - i;
      var lo = search(i), hi = search(Math.min(i + 1, n - 1)), d = hi - lo;
      return g >= 0.5 ? hi - d * (1 - g) : lo + d * g;
    });
  }

  function isDarkLine(gray, box) {
    var x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
    var x1 = Math.min(gray.w, Math.floor(box[2]) + 1), y1 = Math.min(gray.h, Math.floor(box[3]) + 1);
    if (x1 <= x0 || y1 <= y0) return false;
    var p = percentiles(gray, x0, y0, x1, y1, [0.02, 0.5, 0.98]);
    return p[2] - p[1] > 2 * (p[1] - p[0]) + 8;
  }

  // Anchura del recorte de una línea (ventana 1) como la mide crop_line.
  function cropGeom(box, height, window) {
    var padY = (window * (1 + 2 * PAD_Y) - 1) / 2;
    var H = height * window;
    var h = Math.max(1, box[3] - box[1]);
    var ix0 = Math.floor(box[0] - PAD_X * h), iy0 = Math.floor(box[1] - padY * h);
    var ix1 = Math.ceil(box[2] + PAD_X * h), iy1 = Math.ceil(box[3] + padY * h);
    var cw = Math.max(1, ix1 - ix0), ch = Math.max(1, iy1 - iy0);
    var outW = Math.max(WIDTH_MULTIPLE, Math.min(4096, Math.round(cw * H / ch)));
    return { ix0: ix0, iy0: iy0, cw: cw, ch: ch, outW: outW, H: H };
  }

  // Recorte de una línea como mapa de tinta Float32 [H, outW] (1 = tinta).
  function cropLine(gray, box, height, window, dark) {
    var g = cropGeom(box, height, window);
    var crop = new Uint8Array(g.cw * g.ch).fill(dark ? 0 : 255);
    var sx0 = Math.max(0, g.ix0), sy0 = Math.max(0, g.iy0);
    var sx1 = Math.min(gray.w, g.ix0 + g.cw), sy1 = Math.min(gray.h, g.iy0 + g.ch);
    for (var y = sy0; y < sy1; y++) {
      var srow = y * gray.w, drow = (y - g.iy0) * g.cw - g.ix0;
      for (var x = sx0; x < sx1; x++) crop[drow + x] = gray.d[srow + x];
    }
    var r = resize(img(g.cw, g.ch, crop), g.outW, g.H, g.ch > g.H);
    var out = new Float32Array(r.d.length);
    for (var i = 0; i < out.length; i++) {
      var v = Math.round(r.d[i]);
      v = (v < 0 ? 0 : v > 255 ? 255 : v) / 255;
      out[i] = dark ? v : 1 - v;
    }
    return { w: g.outW, h: g.H, d: out };
  }

  function widthBatches(widths, maxBatch, maxRatio, minWidth, maxArea) {
    maxBatch = maxBatch || 64; maxRatio = maxRatio || 1.3; minWidth = minWidth || 64; maxArea = maxArea || 64 * 640;
    var order = widths.map(function (w, i) { return i; }).sort(function (a, b) { return widths[a] - widths[b] || a - b; });
    var batches = [];
    order.forEach(function (i) {
      var last = batches[batches.length - 1];
      if (last && last.length < maxBatch &&
        Math.max(widths[i], minWidth) <= maxRatio * Math.max(widths[last[0]], minWidth) &&
        (last.length + 1) * Math.max(widths[i], minWidth) <= maxArea) last.push(i);
      else batches.push([i]);
    });
    return batches;
  }

  // ------------------------------------------------------------ orden de lectura (order_post.py)

  function isWide(c) {
    var o = c.codePointAt(0);
    return (o >= 0x1100 && o <= 0x115F) || (o >= 0x2E80 && o <= 0xA4CF) || (o >= 0xAC00 && o <= 0xD7A3) ||
      (o >= 0xF900 && o <= 0xFAFF) || (o >= 0xFE30 && o <= 0xFE4F) || (o >= 0xFF00 && o <= 0xFF60) ||
      (o >= 0xFFE0 && o <= 0xFFE6) || (o >= 0x20000 && o <= 0x3FFFD);
  }

  function isUpper(c) { return c !== c.toLowerCase() && c === c.toUpperCase(); }
  function isDigit(c) { return /\p{Nd}/u.test(c); }

  function lineFeatures(boxes, W, H, texts) {
    var n = boxes.length, f = new Float32Array(n * 16);
    var hs = boxes.map(function (b) { return Math.max(b[3] - b[1], 1e-3); });
    var medH = median(hs);
    for (var i = 0; i < n; i++) {
      var b = boxes[i], w = Math.max(b[2] - b[0], 1e-3), h = hs[i], o = i * 16;
      f[o] = b[0] / W; f[o + 1] = b[1] / H; f[o + 2] = b[2] / W; f[o + 3] = b[3] / H;
      f[o + 4] = (b[0] + b[2]) / (2 * W); f[o + 5] = (b[1] + b[3]) / (2 * H);
      f[o + 6] = w / W; f[o + 7] = Math.log(h / medH); f[o + 8] = Math.log(w / h) / 4; f[o + 9] = medH / H * 20;
      var t = (texts && texts[i] || '').trim();
      if (!t) continue;
      var chars = Array.from(t), len = 0, digits = 0;
      chars.forEach(function (c) { len += isWide(c) ? 2 : 1; if (isDigit(c)) digits++; });
      f[o + 10] = Math.log1p(len) / 5;
      f[o + 11] = digits / chars.length;
      var head = chars.slice(0, 3).join('').replace(/[.)]+$/, '');
      f[o + 12] = ('•-–▪◦*·→'.indexOf(chars[0]) >= 0 || (/^\d+$/.test(head) && chars.length > 3)) ? 1 : 0;
      f[o + 13] = t.endsWith('-') ? 1 : 0;
      f[o + 14] = SENTENCE_END.indexOf(chars[chars.length - 1]) >= 0 ? 1 : 0;
      f[o + 15] = isUpper(chars[0]) ? 1 : 0;
    }
    return f;
  }

  // a: Float32Array n×n (a[i][j] > 0: i antes que j).
  function decodeOrder(a, n, sweeps) {
    if (n <= 1) return n ? [0] : [];
    sweeps = sweeps || 4;
    var lp = new Float64Array(n * n), i, j;
    for (i = 0; i < n * n; i++) { var v = a[i]; lp[i] = -(Math.max(0, -v) + Math.log1p(Math.exp(-Math.abs(v)))); }
    var key = new Float64Array(n);
    for (i = 0; i < n; i++) {
      var rs = 0, cs = 0;
      for (j = 0; j < n; j++) { rs += lp[i * n + j]; cs += lp[j * n + i]; }
      key[i] = -rs + cs;
    }
    var order = Array.from({ length: n }, function (_, k) { return k; }).sort(function (p, q) { return key[p] - key[q] || p - q; });
    for (var s = 0; s < sweeps; s++) {
      var improved = false;
      var snapshot = order.slice();
      for (var xi = 0; xi < snapshot.length; xi++) {
        var x = snapshot[xi];
        var rest = order.filter(function (v) { return v !== x; });
        var m = rest.length, gains = new Float64Array(m + 1);
        var suffix = new Float64Array(m + 1);
        for (j = m - 1; j >= 0; j--) suffix[j] = suffix[j + 1] + lp[x * n + rest[j]];
        var pre = 0;
        for (j = 0; j <= m; j++) {
          gains[j] = pre + suffix[j];
          if (j < m) pre += lp[rest[j] * n + x];
        }
        var k = 0;
        for (j = 1; j <= m; j++) if (gains[j] > gains[k]) k = j;
        var cur = order.indexOf(x);
        if (gains[k] > gains[cur] + 1e-6) {
          rest.splice(k, 0, x);
          order = rest;
          improved = true;
        }
      }
      if (!improved) break;
    }
    return order;
  }

  function pyRound(v) { // redondeo a par, como round() de Python
    var r = Math.round(v);
    return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r;
  }

  function orderTopDown(boxes) {
    if (!boxes.length) return [];
    var h = median(boxes.map(function (b) { return b[3] - b[1]; }));
    var q = Math.max(h * 0.5, 1e-3);
    return boxes.map(function (b, i) { return i; }).sort(function (p, r) {
      var kp = pyRound((boxes[p][1] + boxes[p][3]) / 2 / q), kr = pyRound((boxes[r][1] + boxes[r][3]) / 2 / q);
      return kp - kr || boxes[p][0] - boxes[r][0] || p - r;
    });
  }

  function bestCut(boxes, ids, axis) {
    var lo = axis === 1 ? 1 : 0, hi = axis === 1 ? 3 : 2;
    var o = ids.map(function (v, k) { return k; }).sort(function (p, q) { return boxes[ids[p]][lo] - boxes[ids[q]][lo] || p - q; });
    var end = boxes[ids[o[0]]][hi], bestGap = 0, bestK = -1;
    for (var k = 1; k < o.length; k++) {
      var gap = boxes[ids[o[k]]][lo] - end;
      if (gap > bestGap) { bestGap = gap; bestK = k; }
      end = Math.max(end, boxes[ids[o[k]]][hi]);
    }
    return { gap: bestGap, k: bestK, o: o };
  }

  function orderXycut(boxes) {
    function rec(ids) {
      if (ids.length <= 1) return ids.slice();
      var cy = bestCut(boxes, ids, 1), cx = bestCut(boxes, ids, 0);
      if (cy.k < 0 && cx.k < 0) {
        return orderTopDown(ids.map(function (i) { return boxes[i]; })).map(function (k) { return ids[k]; });
      }
      var c = cy.gap >= cx.gap ? cy : cx;
      return rec(c.o.slice(0, c.k).map(function (k) { return ids[k]; }))
        .concat(rec(c.o.slice(c.k).map(function (k) { return ids[k]; })));
    }
    return rec(boxes.map(function (b, i) { return i; }));
  }

  // Agrupamiento por enlace medio de los logits «mismo grupo» (n×n).
  function cluster(logits, n) {
    if (!n) return [];
    var S = new Float64Array(n * n), i, j;
    for (i = 0; i < n * n; i++) S[i] = logits[i];
    for (i = 0; i < n; i++) S[i * n + i] = 0;
    var size = new Float64Array(n).fill(1), alive = new Uint8Array(n).fill(1);
    var members = Array.from({ length: n }, function (_, k) { return [k]; });
    var M = new Float64Array(S);
    for (i = 0; i < n; i++) M[i * n + i] = -Infinity;
    var best = new Int32Array(n), bestV = new Float64Array(n);
    function rowArgmax(r) {
      var bi = 0, bv = -Infinity;
      for (var c = 0; c < n; c++) if (M[r * n + c] > bv) { bv = M[r * n + c]; bi = c; }
      best[r] = bi; bestV[r] = bv;
    }
    for (i = 0; i < n; i++) rowArgmax(i);
    for (var it = 0; it < n - 1; it++) {
      var a = 0;
      for (i = 1; i < n; i++) if (bestV[i] > bestV[a]) a = i;
      var b = best[a];
      if (!(bestV[a] > 0)) break;
      if (a > b) { var t = a; a = b; b = t; }
      for (j = 0; j < n; j++) S[a * n + j] += S[b * n + j];
      for (j = 0; j < n; j++) S[j * n + a] += S[j * n + b];
      S[a * n + a] = 0;
      size[a] += size[b];
      alive[b] = 0;
      members[a] = members[a].concat(members[b]);
      var row = new Float64Array(n);
      for (j = 0; j < n; j++) row[j] = alive[j] && j !== a ? S[a * n + j] / (size[a] * size[j]) : -Infinity;
      for (j = 0; j < n; j++) { M[a * n + j] = row[j]; M[j * n + a] = row[j]; M[b * n + j] = -Infinity; M[j * n + b] = -Infinity; }
      bestV[b] = -Infinity;
      var ba = 0;
      for (j = 1; j < n; j++) if (row[j] > row[ba]) ba = j;
      best[a] = ba; bestV[a] = row[ba];
      for (j = 0; j < n; j++) {
        if (!alive[j] || j === a) continue;
        if (best[j] === a || best[j] === b) rowArgmax(j);
        else if (row[j] > bestV[j]) { best[j] = a; bestV[j] = row[j]; }
      }
    }
    var out = [];
    for (i = 0; i < n; i++) if (alive[i]) out.push(members[i].slice().sort(function (p, q) { return p - q; }));
    return out;
  }

  function clsArgmax(cls, ids) {
    var C = BLOCK_CLASSES.length, sum = new Float64Array(C);
    ids.forEach(function (i) { for (var c = 0; c < C; c++) sum[c] += cls[i * C + c]; });
    var k = 0;
    for (var c = 1; c < C; c++) if (sum[c] > sum[k]) k = c;
    return k;
  }

  function decodeBlocksOrder(a, same, boxes, cls) {
    var n = boxes.length;
    if (n <= 1) return n ? [0] : [];
    var blocks = cluster(same, n);
    var inner = blocks.map(function (b) {
      var bx = b.map(function (i) { return boxes[i]; });
      var local = GRID.indexOf(clsArgmax(cls, b)) >= 0 ? orderTopDown(bx) : orderXycut(bx);
      return local.map(function (k) { return b[k]; });
    });
    var m = blocks.length, ab = new Float32Array(m * m);
    for (var p = 0; p < m; p++) {
      for (var q = p + 1; q < m; q++) {
        var s = 0;
        blocks[p].forEach(function (i) { blocks[q].forEach(function (j) { s += a[i * n + j]; }); });
        s /= blocks[p].length * blocks[q].length;
        ab[p * m + q] = s; ab[q * m + p] = -s;
      }
    }
    var out = [];
    decodeOrder(ab, m).forEach(function (k) { out = out.concat(inner[k]); });
    return out;
  }

  // ------------------------------------------------------------ texto de los bloques (layout_post.py)

  function isAlpha(c) { return !!c && /\p{L}/u.test(c); }
  function isLower(c) { return !!c && c !== c.toUpperCase() && c === c.toLowerCase(); }
  function isCjk(c) {
    var o = c.codePointAt(0);
    return (o >= 0x3000 && o <= 0x30FF) || (o >= 0x3400 && o <= 0x9FFF) || (o >= 0xF900 && o <= 0xFAFF) ||
      (o >= 0xFF00 && o <= 0xFFEF) || (o >= 0x20000 && o <= 0x2FA1F);
  }

  function joinLines(texts) {
    var out = '';
    texts.forEach(function (t) {
      t = t.trim();
      if (!t) return;
      if (out.length > 1 && out.endsWith('-') && isAlpha(out[out.length - 2]) && isAlpha(t[0]) && isLower(t[0])) {
        out = out.slice(0, -1) + t;
      } else if (out && isCjk(out[out.length - 1]) && isCjk(t[0])) out += t;
      else out = out ? out + ' ' + t : t;
    });
    return out;
  }

  function splitBlocks(order, same, n) {
    var blocks = [];
    order.forEach(function (i) {
      var last = blocks[blocks.length - 1];
      if (last && same[last[last.length - 1] * n + i] > 0) last.push(i);
      else blocks.push([i]);
    });
    return blocks;
  }

  function tableRows(boxes, ids) {
    var cy = {}, hs = [];
    ids.forEach(function (i) { cy[i] = (boxes[i][1] + boxes[i][3]) / 2; hs.push(boxes[i][3] - boxes[i][1]); });
    var h = median(hs), rows = [];
    ids.slice().sort(function (p, q) { return cy[p] - cy[q]; }).forEach(function (i) {
      var last = rows[rows.length - 1];
      if (last) {
        var m = last.reduce(function (s, k) { return s + cy[k]; }, 0) / last.length;
        if (Math.abs(cy[i] - m) < 0.5 * h) { last.push(i); return; }
      }
      rows.push([i]);
    });
    return rows.map(function (r) { return r.sort(function (p, q) { return boxes[p][0] - boxes[q][0]; }); });
  }

  // ------------------------------------------------------------ el lector

  function IndraOCR(ort, sessions, meta) {
    this.ort = ort;
    this.det = sessions.det;
    this.rec = sessions.rec;
    this.order = sessions.order || null;
    this.orient = sessions.orient || null;
    var vocab = typeof meta.vocab === 'string' ? JSON.parse(meta.vocab) : meta.vocab;
    this.chars = vocab.chars;
    this.space = this.chars.indexOf(' ') + 1;
    this.longSide = meta.det_long_side || 1024;
    this.height = meta.rec_height || 32;
    this.window = meta.rec_window || 1;
  }

  /** models: { det, rec, order?, orient?: ArrayBuffer|Uint8Array, meta: objeto o texto JSON } */
  IndraOCR.create = async function (ort, models, opts) {
    opts = opts || {};
    var so = Object.assign({ graphOptimizationLevel: 'all' }, opts.sessionOptions || {});
    async function open(buf) {
      if (!buf) return null;
      return ort.InferenceSession.create(buf instanceof Uint8Array ? buf : new Uint8Array(buf), so);
    }
    var meta = typeof models.meta === 'string' ? JSON.parse(models.meta) : models.meta;
    var s = {};
    s.det = await open(models.det);
    s.rec = await open(models.rec);
    s.order = await open(models.order);
    s.orient = await open(models.orient);
    return new IndraOCR(ort, s, meta);
  };

  IndraOCR.FILES = ['det.onnx', 'rec.onnx', 'order.onnx', 'orient.onnx', 'meta.json'];

  var P = IndraOCR.prototype;

  P._tensor = function (type, data, dims) { return new this.ort.Tensor(type, data, dims); };

  P._detectAt = async function (gray, longSide) {
    var inp = pageToInput(gray, longSide);
    var res = await this.det.run({ x: this._tensor('float32', inp.x, [1, 1, inp.h, inp.w]) });
    var out = res[this.det.outputNames[0]];
    return { boxes: decodeDet(out.data, out.dims[2], out.dims[3]), s: inp.scale };
  };

  P.detect = async function (gray) {
    var r = await this._detectAt(gray, this.longSide);
    if (r.boxes.length >= 8) {
      var medH = median(r.boxes.map(function (b) { return b[3] - b[1]; }));
      if (medH < ADAPTIVE_MIN_H) {
        var ls = Math.floor(Math.floor(Math.min(ADAPTIVE_MAX_SIDE, this.longSide * ADAPTIVE_TARGET_H / Math.max(medH, 1))) / 32) * 32;
        if (ls > this.longSide) r = await this._detectAt(gray, ls);
      }
    }
    var s = r.s;
    return r.boxes.map(function (b) {
      return [
        Math.min(Math.max(b[0] / s, 0), gray.w), Math.min(Math.max(b[1] / s, 0), gray.h),
        Math.min(Math.max(b[2] / s, 0), gray.w), Math.min(Math.max(b[3] / s, 0), gray.h)
      ];
    });
  };

  P.orientation = async function (gray) {
    if (!this.orient) return 0;
    var sz = scaled(gray, ORIENT_SIDE);
    var small = resize(gray, sz[0], sz[1], true);
    var x = new Float32Array(ORIENT_SIDE * ORIENT_SIDE);
    for (var y = 0; y < sz[1]; y++) {
      for (var xx = 0; xx < sz[0]; xx++) {
        var v = Math.round(small.d[y * sz[0] + xx]);
        x[y * ORIENT_SIDE + xx] = 1 - (v < 0 ? 0 : v > 255 ? 255 : v) / 255;
      }
    }
    var res = await this.orient.run({ x: this._tensor('float32', x, [1, 1, ORIENT_SIDE, ORIENT_SIDE]) });
    var p = res[this.orient.outputNames[0]].data;
    var k = 0;
    for (var i = 1; i < p.length; i++) if (p[i] > p[k]) k = i;
    // 4 = columnas verticales (chino, japonés): sin reconocedor CJK se lee como está.
    return p[k] > ORIENT_MIN && k < 4 ? k : 0;
  };

  P.recognize = async function (gray, boxes, onProgress) {
    var self = this, window = this.window, height = this.height;
    var n = boxes.length, out = new Array(n);
    var dark = boxes.map(function (b) { return isDarkLine(gray, b); });
    var widths = boxes.map(function (b) { return cropGeom(b, height, window).outW; });
    var batches = widthBatches(widths);
    var done = 0;
    for (var bi = 0; bi < batches.length; bi++) {
      var idx = batches[bi];
      var crops = idx.map(function (j) { return cropLine(gray, boxes[j], height, window, dark[j]); });
      var H = crops[0].h;
      var Wm = Math.ceil(Math.max.apply(null, crops.map(function (c) { return c.w; })) / WIDTH_MULTIPLE) * WIDTH_MULTIPLE;
      var arr = new Float32Array(idx.length * H * Wm), wid = new BigInt64Array(idx.length);
      crops.forEach(function (c, k) {
        for (var y = 0; y < H; y++) arr.set(c.d.subarray(y * c.w, (y + 1) * c.w), k * H * Wm + y * Wm);
        wid[k] = BigInt(c.w);
      });
      var res = await this.rec.run({
        x: this._tensor('float32', arr, [idx.length, 1, H, Wm]),
        widths: this._tensor('int64', wid, [idx.length])
      }, ['ids', 'conf', 'lengths']);
      var ids = res.ids, T = ids.dims[1], best = ids.data, pmax = res.conf.data, lens = res.lengths.data;
      var stride = Wm / Math.max(T, 1);
      idx.forEach(function (j, k) {
        var len = Number(lens[k]), b = boxes[j], h = Math.max(1, b[3] - b[1]);
        var g1 = cropGeom(b, height, 1);
        var ix0 = Math.floor(b[0] - PAD_X * h), cw = Math.ceil(b[2] + PAD_X * h) - ix0;
        var f = cw / g1.outW;
        var toks = [], confSum = 0, prev = -1;
        for (var t = 0; t < len; t++) {
          var id = Number(best[k * T + t]);
          if (id !== 0 && id !== prev) {
            toks.push([id, ix0 + (t + 0.5) * stride * f]);
            confSum += pmax[k * T + t];
          }
          prev = id;
        }
        var conf = toks.length ? confSum / toks.length : 0;
        out[j] = conf >= MIN_CONF ? [self.decode(toks), conf, toks] : ['', conf, []];
      });
      done += idx.length;
      if (onProgress) onProgress(done / n);
    }
    return out;
  };

  P.decode = function (toks) {
    var chars = this.chars, s = '';
    for (var k = 0; k < toks.length; k++) {
      var c = chars[toks[k][0] - 1];
      if (c == null) continue;
      s += c;
      if (c.length > 2 && c[0] === '\\' && /^[A-Za-z]+$/.test(c.slice(1))) {
        var nx = toks[k + 1] && chars[toks[k + 1][0] - 1];
        if (nx && isAlpha(nx[0])) s += ' ';
      }
    }
    return s;
  };

  P.gutterCuts = function (boxes, rec) {
    var space = this.space;
    return boxes.map(function (b, i) {
      var h = Math.max(1, b[3] - b[1]);
      var xs = rec[i][2].filter(function (tk) { return tk[0] !== space; }).map(function (tk) { return tk[1]; });
      var mine = [];
      for (var k = 0; k + 1 < xs.length; k++) {
        var a = xs[k], c = xs[k + 1];
        if (c - a <= GUTTER_GAP * h) continue;
        var gl = a + 0.35 * h, gr = c - 0.35 * h, near = 0;
        for (var j = 0; j < boxes.length; j++) {
          if (j !== i && (Math.abs(boxes[j][2] - gl) < 0.5 * h || Math.abs(boxes[j][0] - gr) < 0.5 * h)) near++;
        }
        if (near >= GUTTER_EDGES) mine.push((a + c) / 2);
      }
      return mine;
    });
  };

  P.splitLine = function (box, toks, gap, at) {
    var self = this, h = Math.max(1, box[3] - box[1]);
    var segs = [[]], prev = null;
    at = (at || []).slice().sort(function (p, q) { return p - q; });
    toks.forEach(function (tk) {
      var x = tk[1];
      if (tk[0] !== self.space) {
        var cut = prev !== null && (x - prev > gap * h || at.some(function (c) { return prev < c && c < x; }));
        if (cut) segs.push([]);
        prev = x;
      }
      segs[segs.length - 1].push(tk);
    });
    if (segs.length === 1) return [[box.slice(0, 4), this.decode(toks), toks]];
    var out = [];
    segs.forEach(function (sg) {
      var text = self.decode(sg).trim();
      var xs = sg.filter(function (tk) { return tk[0] !== self.space; }).map(function (tk) { return tk[1]; });
      if (text && xs.length) {
        out.push([[Math.max(box[0], Math.min.apply(null, xs) - 0.35 * h), box[1],
          Math.min(box[2], Math.max.apply(null, xs) + 0.35 * h), box[3]], text, sg]);
      }
    });
    return out;
  };

  // Quita líneas de puntos y rayas, y une una viñeta suelta a su elemento (tidy_lines).
  P.tidyLines = function (boxes, rec) {
    var keep = rec.map(function () { return true; }), space = this.space;
    rec = rec.slice();
    boxes = boxes.map(function (b) { return b.slice(); });
    function only(s, set) { for (var k = 0; k < s.length; k++) if (set.indexOf(s[k]) < 0) return false; return true; }
    rec.forEach(function (r, i) {
      var core = r[0].replace(/ /g, '');
      if (core && only(core, LEADER_CHARS)) {
        var wide = boxes[i][2] - boxes[i][0] >= 3 * (boxes[i][3] - boxes[i][1]);
        var hasDash = Array.from(core).some(function (c) { return DASHES.indexOf(c) >= 0; });
        if (core.length >= 3 || wide || !hasDash) keep[i] = false;
      }
    });
    rec.forEach(function (r, i) {
      var t = r[0].trim();
      if (!keep[i] || !(t && (BULLETS.indexOf(t) >= 0 && t.length === 1 || ENUMERATOR.test(t)))) return;
      var hi = boxes[i][3] - boxes[i][1], bestJ = -1, bestGap = null;
      for (var j = 0; j < rec.length; j++) {
        if (j === i || !keep[j] || !rec[j][0].trim()) continue;
        var hj = boxes[j][3] - boxes[j][1];
        var ov = Math.min(boxes[i][3], boxes[j][3]) - Math.max(boxes[i][1], boxes[j][1]);
        if (ov < 0.5 * Math.min(hi, hj)) continue;
        var gap = boxes[j][0] - boxes[i][2];
        if (gap >= -0.3 * hi && gap <= MARKER_GAP * Math.max(hi, hj) && (bestGap === null || gap < bestGap)) {
          bestJ = j; bestGap = gap;
        }
      }
      if (bestJ < 0) return;
      var rj = rec[bestJ], kj = rj[2];
      if (r[2].length && kj.length && space) {
        var x = (boxes[i][2] + boxes[bestJ][0]) / 2;
        kj = r[2].concat([[space, x]], kj);
      }
      rec[bestJ] = [t + ' ' + rj[0].trim(), rj[1], kj];
      var a = boxes[i], b = boxes[bestJ];
      boxes[bestJ] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
      keep[i] = false;
    });
    var nb = [], nr = [];
    keep.forEach(function (k, i) { if (k) { nb.push(boxes[i]); nr.push(rec[i]); } });
    return { boxes: nb, rec: nr };
  };

  P.readingOrder = async function (boxes, texts, W, H) {
    var n = boxes.length;
    if (n < 2 || !this.order) return { order: n ? orderXycut(boxes) : [], layout: null };
    var res = await this.order.run({
      feats: this._tensor('float32', lineFeatures(boxes, W, H, texts), [1, n, 16]),
      mask: this._tensor('bool', new Uint8Array(n).fill(1), [1, n])
    });
    var a = res.a.data;
    if (!res.cls || !res.same) return { order: decodeOrder(a, n), layout: null };
    var cls = res.cls.data, same = res.same.data;
    return { order: decodeBlocksOrder(a, same, boxes, cls), layout: { cls: cls, same: same } };
  };

  /** Lee una página en gris { width, height, data: Uint8Array }. */
  P.read = async function (page, onProgress) {
    var report = function (p, stage) { if (onProgress) onProgress(Math.max(0, Math.min(1, p)), stage); };
    var gray = img(page.width, page.height, page.data);
    report(0, 'enderezando');
    var sz = scaled(gray, PREVIEW_SIDE);
    var small = Math.max(gray.w, gray.h) > PREVIEW_SIDE ? toU8(resize(gray, sz[0], sz[1], true)) : gray;
    var a = estimateSkew(small);
    var k = await this.orientation(Math.abs(a) >= DESKEW_MIN ? toU8(rotate(small, a, 'replicate')) : small);
    if (k) {
      gray = rot90cw(gray, k);
      if (k === 1 || k === 3) a = estimateSkew(rot90cw(small, k));
    }
    if (Math.abs(a) >= DESKEW_MIN) gray = toU8(rotate(gray, a, 'replicate'));
    else a = 0;
    report(0.1, 'detectando');
    var boxes = await this.detect(gray);
    report(0.2, 'leyendo');
    var rec = boxes.length ? await this.recognize(gray, boxes, function (f) { report(0.2 + 0.7 * f, 'leyendo'); }) : [];
    report(0.92, 'ordenando');
    var result = await this.assemble(gray.w, gray.h, boxes, rec);
    result.rotation = 90 * k;
    result.skew = Math.round(a * 100) / 100;
    report(1, 'listo');
    return result;
  };

  P.assemble = async function (W, H, boxes, rec) {
    var self = this, nb = [], nrec = [];
    var cuts = boxes.length ? this.gutterCuts(boxes, rec) : [];
    boxes.forEach(function (b, i) {
      self.splitLine(b, rec[i][2], SPLIT_GAP, cuts[i]).forEach(function (p) { nb.push(p[0]); nrec.push([p[1], rec[i][1], p[2]]); });
    });
    var tidy = this.tidyLines(nb, nrec);
    boxes = tidy.boxes; rec = tidy.rec;
    var texts = rec.map(function (r) { return r[0]; });
    var ro = await this.readingOrder(boxes, texts, W, H);
    if (ro.layout) {
      // Las líneas de tabla se cortan en celdas y se vuelve a ordenar (como Indra).
      var C = BLOCK_CLASSES.length, isTable = boxes.map(function (b, i) { return clsArgmax(ro.layout.cls, [i]) === 5; });
      if (isTable.some(Boolean)) {
        var tb = [], tr = [];
        boxes.forEach(function (b, i) {
          var parts = isTable[i] ? self.splitLine(b, rec[i][2], CELL_GAP) : [[b, rec[i][0], rec[i][2]]];
          parts.forEach(function (p) { tb.push(p[0]); tr.push([p[1], rec[i][1], p[2]]); });
        });
        if (tb.length !== boxes.length) {
          boxes = tb; rec = tr;
          texts = rec.map(function (r) { return r[0]; });
          ro = await this.readingOrder(boxes, texts, W, H);
        }
      }
      void C;
    }
    var n = boxes.length, order = ro.order;
    var lines = order.map(function (i) { return { box: boxes[i].map(function (v) { return Math.round(v * 10) / 10; }), text: rec[i][0], conf: rec[i][1] }; });
    var blocks = [];
    if (ro.layout) {
      splitBlocks(order, ro.layout.same, n).forEach(function (blk) {
        var label = BLOCK_CLASSES[clsArgmax(ro.layout.cls, blk)];
        var bt = blk.map(function (i) { return texts[i]; }), text;
        if (label === 'List-Group') {
          var items = [];
          bt.forEach(function (t) { if (!items.length || ITEM.test(t)) items.push([t]); else items[items.length - 1].push(t); });
          text = items.map(joinLines).join('\n');
        } else if (label === 'Table' && blk.length > 1) {
          text = tableRows(boxes, blk).map(function (r) {
            return r.map(function (i) { return texts[i].trim(); }).filter(Boolean).join(' · ');
          }).join('\n');
        } else text = joinLines(bt);
        if (text.trim()) blocks.push({ label: label, text: text });
      });
    } else if (n) {
      blocks.push({ label: 'Text', text: joinLines(order.map(function (i) { return texts[i]; })) });
    }
    // Para leer: sin cabeceras ni pies de página (títulos corridos, números de página).
    var body = blocks.filter(function (b) { return b.label !== 'Page-Header' && b.label !== 'Page-Footer'; });
    return {
      lines: lines,
      blocks: blocks,
      paragraphs: body.map(function (b) { return b.text; }),
      text: body.map(function (b) { return b.text; }).join('\n\n')
    };
  };

  IndraOCR._internal = {
    resize: resize, rotate: rotate, rot90cw: rot90cw, estimateSkew: estimateSkew, decodeDet: decodeDet,
    pageToInput: pageToInput, cropLine: cropLine, decodeOrder: decodeOrder, cluster: cluster,
    orderXycut: orderXycut, lineFeatures: lineFeatures, joinLines: joinLines
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = IndraOCR;
  else root.IndraOCR = IndraOCR;
})(typeof self !== 'undefined' ? self : this);
