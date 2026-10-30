/* importers.js — convierte archivos de documentos en texto plano con imágenes.
 * Script clásico (no módulo). Expone window.LV.importers.
 *
 * Formatos: TXT, Markdown, HTML, EPUB, DOCX, ODT/ODS/ODP, RTF, FB2, MOBI/AZW/AZW3/PRC,
 * PPTX, XLSX, CSV/TSV, SRT/VTT, JSON, PDF e imágenes (OCR).
 *
 * importFile(file, onProgress?) resuelve a:
 *   {
 *     title, text,                 // text: párrafos separados por "\n\n"
 *     images?: [{ blob, alt, width?, height? }],
 *     pageOffsets?: number[],      // solo PDF: desplazamiento en `text` donde empieza cada página
 *     original?: { blob, type: 'pdf' }
 *   }
 * Donde aparece una imagen en el documento, `text` contiene un párrafo que es
 * exactamente "￼" (OBJECT REPLACEMENT CHARACTER). images[k] corresponde
 * al k-ésimo "￼" del texto. onProgress(pct, mensaje) informa del avance.
 */
(function () {
  'use strict';

  window.LV = window.LV || {};
  var LV = window.LV;

  // Las librerías van dentro de la app (web/vendor, scripts/vendor.mjs): funciona sin conexión y
  // no se pide nada a terceros. Solo Tesseract (respaldo del OCR en el navegador) viene de una CDN.
  var VENDOR = new URL('../vendor/', (document.currentScript && document.currentScript.src) || location.href).href;
  var CDN = {
    jszip: VENDOR + 'jszip/jszip.min.js',
    pdfjs: VENDOR + 'pdfjs/pdf.min.js',
    pdfWorker: VENDOR + 'pdfjs/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    mammoth: VENDOR + 'mammoth/mammoth.browser.min.js'
  };

  var EXT = {
    txt: 'txt', text: 'txt', log: 'txt',
    md: 'md', markdown: 'md', mdown: 'md', mkd: 'md',
    html: 'html', htm: 'html', xhtml: 'html',
    epub: 'epub',
    docx: 'docx', docm: 'docx', dotx: 'docx',
    odt: 'odf', ods: 'odf', odp: 'odf', ott: 'odf',
    rtf: 'rtf',
    fb2: 'fb2',
    mobi: 'mobi', azw: 'mobi', azw3: 'mobi', prc: 'mobi', pdb: 'mobi', kf8: 'mobi',
    pptx: 'pptx', ppsx: 'pptx', pptm: 'pptx',
    xlsx: 'xlsx', xlsm: 'xlsx',
    csv: 'csv', tsv: 'csv', tab: 'csv',
    srt: 'subs', vtt: 'subs',
    json: 'json',
    pdf: 'pdf',
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', bmp: 'image', gif: 'image'
  };

  var MIME = {
    'text/plain': 'txt',
    'text/markdown': 'md', 'text/x-markdown': 'md',
    'text/html': 'html', 'application/xhtml+xml': 'html',
    'application/epub+zip': 'epub',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.oasis.opendocument.text': 'odf',
    'application/vnd.oasis.opendocument.spreadsheet': 'odf',
    'application/vnd.oasis.opendocument.presentation': 'odf',
    'application/rtf': 'rtf', 'text/rtf': 'rtf',
    'application/x-fictionbook+xml': 'fb2', 'application/x-fictionbook': 'fb2',
    'application/x-mobipocket-ebook': 'mobi', 'application/vnd.amazon.ebook': 'mobi',
    'application/vnd.amazon.mobi8-ebook': 'mobi',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/csv': 'csv', 'text/tab-separated-values': 'csv',
    'application/x-subrip': 'subs', 'text/vtt': 'subs',
    'application/json': 'json',
    'application/pdf': 'pdf',
    'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image',
    'image/bmp': 'image', 'image/gif': 'image'
  };

  // Formatos que reconocemos solo para dar un mensaje útil.
  var LEGACY = {
    doc: 'Los documentos .doc antiguos de Word no son compatibles. Ábrelo en Word, LibreOffice o Google Docs y guárdalo como .docx o PDF.',
    dot: 'Las plantillas .dot antiguas de Word no son compatibles. Guárdala como .docx o PDF.',
    pages: 'Los documentos de Pages no son compatibles. En Pages, usa Archivo › Exportar a › Word (.docx) o PDF.',
    key: 'Las presentaciones de Keynote no son compatibles. Exporta a PowerPoint (.pptx) o PDF.',
    numbers: 'Las hojas de Numbers no son compatibles. Exporta a Excel (.xlsx) o CSV.',
    xls: 'Las hojas .xls antiguas de Excel no son compatibles. Guárdala como .xlsx o CSV.',
    ppt: 'Las presentaciones .ppt antiguas no son compatibles. Guárdala como .pptx o PDF.',
    djvu: 'Los archivos DjVu no son compatibles. Conviértelo a PDF o EPUB.',
    cbz: 'Los cómics (.cbz/.cbr) no son compatibles.',
    cbr: 'Los cómics (.cbz/.cbr) no son compatibles.',
    lit: 'Los libros .lit no son compatibles. Conviértelo a EPUB con Calibre.',
    kfx: 'Los libros KFX de Kindle no son compatibles. Conviértelo a EPUB con Calibre (si no tiene DRM).'
  };

  var ACCEPT = [
    '.txt', '.md', '.markdown', '.html', '.htm', '.xhtml', '.epub', '.docx', '.odt', '.ods', '.odp',
    '.rtf', '.fb2', '.mobi', '.azw', '.azw3', '.prc', '.pptx', '.xlsx', '.csv', '.tsv', '.srt', '.vtt',
    '.json', '.pdf', '.png', '.jpg', '.jpeg', '.webp',
    'text/plain', 'text/markdown', 'text/html', 'application/epub+zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text', 'application/rtf', 'text/csv',
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp'
  ].join(',');

  var FORMATS_MSG = 'TXT, Markdown, HTML, EPUB, Word (DOCX), OpenDocument (ODT, ODS, ODP), RTF, FB2, ' +
    'Kindle (MOBI, AZW, AZW3), PowerPoint (PPTX), Excel (XLSX), CSV/TSV, subtítulos (SRT, VTT), JSON, PDF ' +
    'o una imagen (PNG, JPG, WEBP)';

  var OBJ = '￼';                 // marcador de imagen en el texto final
  var MAX_IMAGES = 300;
  var MIN_IMG = 48;
  var MAX_SIDE = 1600;
  var JPEG_Q = 0.82;
  var MAX_ROWS = 5000;

  // Marcadores internos (zona de uso privado), sustituidos en finish().
  var IM_A = '', IM_B = '', PG_A = '', PG_B = '';
  function imgMarker(i) { return IM_A + i + IM_B; }
  function pageMarker(i) { return PG_A + i + PG_B; }
  // Quita de un texto de origen los caracteres que usamos como marcadores.
  function san(s) { return String(s == null ? '' : s).replace(/[-￼]/g, ''); }

  // ---------------------------------------------------------------- utilidades

  function extOf(name) {
    var m = /\.([^./\\]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function baseName(name) {
    var n = String(name || '').replace(/^.*[\\/]/, '');
    var stripped = n.replace(/\.[^.]+$/, '');
    return (stripped || n || 'Sin título').trim();
  }

  function kindOf(file) {
    if (!file) return null;
    var byExt = EXT[extOf(file.name)];
    if (byExt) return byExt;
    var type = String(file.type || '').toLowerCase().split(';')[0].trim();
    if (MIME[type]) return MIME[type];
    if (/^image\//.test(type)) return 'image';
    return null;
  }

  function cleanInline(s) {
    return String(s == null ? '' : s)
      .replace(/­/g, '')
      .replace(/[​-‍⁠﻿]/g, '')
      .replace(/[  -   　\t\f\v]/g, ' ');
  }

  // Une palabras cortadas con guion al final de línea: "pala-\nbra" -> "palabra".
  // Solo cuando la siguiente parte empieza en minúscula (evita "Norte-\nSur").
  function joinHyphens(s) {
    return s
      .replace(/(\p{L})[-‐‑]\s*\n\s*(\p{Ll})/gu, '$1$2')
      .replace(/(\p{L})[-‐‑]\s*\n\s*(\p{Lu}|\d)/gu, '$1-$2'); // compuestos: "Norte-Sur"
  }

  function normalizeParagraph(p) {
    p = joinHyphens(cleanInline(p).replace(/\r\n?/g, '\n'));
    return p.replace(/\s+/g, ' ').trim();
  }

  // Texto con párrafos separados por línea(s) en blanco -> salida normalizada.
  function normalizeText(text) {
    var t = cleanInline(text).replace(/\r\n?/g, '\n');
    return t.split(/\n[ \t]*\n+/)
      .map(normalizeParagraph)
      .filter(Boolean)
      .join('\n\n');
  }

  function splitParagraphs(text) {
    return cleanInline(text).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
  }

  function joinParagraphs(paras) {
    return paras.map(normalizeParagraph).filter(Boolean).join('\n\n');
  }

  function hasWords(text) {
    return !!(text && text.replace(/￼/g, '').trim());
  }

  function ensureText(text, emptyMsg) {
    if (!hasWords(text)) {
      throw new Error(emptyMsg || 'No se encontró texto legible en el archivo.');
    }
    return text;
  }

  function readAsArrayBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function decodeBytes(buf) {
    var bytes = new Uint8Array(buf);
    // BOM UTF-16
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    var s;
    try {
      s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      s = new TextDecoder('windows-1252').decode(bytes);
    }
    return s.replace(/^﻿/, '');
  }

  function safeDecoder(label, fallback) {
    try { return new TextDecoder(label); } catch (e) { return new TextDecoder(fallback || 'windows-1252'); }
  }

  function makeReporter(onProgress) {
    var fn = typeof onProgress === 'function' ? onProgress : null;
    return function (pct, msg) {
      if (!fn) return;
      try { fn(Math.max(0, Math.min(100, Math.round(pct))), msg); } catch (e) { /* ignorar */ }
    };
  }

  // Carga perezosa de scripts externos (una sola vez por URL).
  var scriptPromises = {};
  function loadScript(url, globalName, errMsg) {
    if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
    if (!scriptPromises[url]) {
      scriptPromises[url] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.onload = function () {
          if (!globalName || window[globalName]) resolve(window[globalName]);
          else fail();
        };
        s.onerror = fail;
        function fail() {
          delete scriptPromises[url];
          if (s.parentNode) s.parentNode.removeChild(s);
          reject(new Error(errMsg));
        }
        document.head.appendChild(s);
      });
    }
    return scriptPromises[url];
  }

  function loadZip(buf, badMsg) {
    return loadScript(CDN.jszip, 'JSZip', 'No se pudo cargar el lector de archivos comprimidos. Revisa tu conexión.')
      .then(function (JSZip) {
        return JSZip.loadAsync(buf).catch(function () { throw new Error(badMsg); });
      });
  }

  function zipFile(zip, path) {
    var f = zip.file(path);
    if (f) return f;
    var lower = path.toLowerCase();
    var found = null;
    zip.forEach(function (p, entry) { if (!found && p.toLowerCase() === lower) found = entry; });
    return found;
  }

  function zipText(zip, path) {
    var e = path && zipFile(zip, path);
    return e ? e.async('string') : Promise.resolve('');
  }

  function resolvePath(baseDir, href) {
    var path = String(href || '').split('#')[0].split('?')[0];
    try { path = decodeURIComponent(path); } catch (e) { /* dejar tal cual */ }
    if (path.charAt(0) === '/') path = path.slice(1);
    else path = baseDir + path;
    var out = [];
    path.split('/').forEach(function (seg) {
      if (seg === '..') out.pop();
      else if (seg && seg !== '.') out.push(seg);
    });
    return out.join('/');
  }

  function dirOf(path) { return path.indexOf('/') >= 0 ? path.replace(/[^/]*$/, '') : ''; }

  var IMG_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', svgz: 'image/svg+xml', avif: 'image/avif'
  };
  function mimeFromPath(p) { return IMG_MIME[extOf(p)] || ''; }

  // Blob de imagen desde una entrada del ZIP (o null).
  function zipImage(zip, path) {
    var e = path && zipFile(zip, path);
    if (!e) return Promise.resolve(null);
    return e.async('uint8array').then(function (u8) {
      return new Blob([u8], { type: sniffImageType(u8) || mimeFromPath(path) || 'application/octet-stream' });
    }).catch(function () { return null; });
  }

  function sniffImageType(u8) {
    if (!u8 || u8.length < 4) return '';
    if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'image/jpeg';
    if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'image/png';
    if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) return 'image/gif';
    if (u8[0] === 0x42 && u8[1] === 0x4D) return 'image/bmp';
    if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
      u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'image/webp';
    return '';
  }

  function base64ToBytes(b64) {
    var bin = atob(String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, ''));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function parseXml(str) {
    var d = new DOMParser().parseFromString(str, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) return null;
    return d;
  }

  function byLocal(root, name) {
    return root ? Array.prototype.slice.call(root.getElementsByTagNameNS('*', name)) : [];
  }

  function firstByLocalName(doc, name) {
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if ((all[i].localName || '').toLowerCase() === name) return all[i];
    }
    return null;
  }

  function childrenByLocal(el, name) {
    var out = [];
    for (var c = el && el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.localName === name) out.push(c);
    }
    return out;
  }

  function textOf(el) {
    return el ? normalizeParagraph(el.textContent || '') : '';
  }

  var XLINK = 'http://www.w3.org/1999/xlink';
  function hrefOf(el) {
    return (el.getAttributeNS && el.getAttributeNS(XLINK, 'href')) ||
      el.getAttribute('xlink:href') || el.getAttribute('l:href') || el.getAttribute('href') || '';
  }

  function withTimeout(promise, ms, onTimeout) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { if (onTimeout) onTimeout(); resolve(null); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // ---------------------------------------------------------------- imágenes

  function decodeViaImg(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      var done = function (v) { URL.revokeObjectURL(url); resolve(v); };
      var t = setTimeout(function () { done(null); }, 10000);
      img.onload = function () {
        clearTimeout(t);
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { done(null); return; }
        // decode() garantiza que se pueda dibujar después de revocar la URL.
        var dec = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
        dec.then(function () { resolve({ src: img, width: w, height: h }); setTimeout(function () { URL.revokeObjectURL(url); }, 0); });
      };
      img.onerror = function () { clearTimeout(t); done(null); };
      img.src = url;
    });
  }

  function decodeImage(blob) {
    var isSvg = /svg/.test(blob.type || '');
    if (!isSvg && typeof createImageBitmap === 'function') {
      return createImageBitmap(blob).then(function (bm) {
        return { src: bm, width: bm.width, height: bm.height, close: function () { if (bm.close) bm.close(); } };
      }, function () { return decodeViaImg(blob); });
    }
    return decodeViaImg(blob);
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === 'function') {
      try {
        var oc = new OffscreenCanvas(w, h);
        if (oc.getContext('2d')) return oc;
      } catch (e) { /* usar canvas del DOM */ }
    }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function canvasToBlob(canvas, type, quality) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type: type, quality: quality });
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
  }

  function hasAlpha(ctx, w, h) {
    try {
      var data = ctx.getImageData(0, 0, w, h).data;
      var step = Math.max(1, Math.floor(data.length / 4 / 250000)) * 4;
      for (var i = 3; i < data.length; i += step) if (data[i] < 250) return true;
    } catch (e) { /* lienzo contaminado */ }
    return false;
  }

  // Dibuja `src` (bitmap, <img> o <canvas>) reducido a MAX_SIDE y lo codifica.
  async function encodeSource(src, w, h, alt, allowPng) {
    var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
    var canvas = makeCanvas(tw, th);
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (allowPng) {
      ctx.drawImage(src, 0, 0, tw, th);
      if (hasAlpha(ctx, tw, th)) {
        var png = await canvasToBlob(canvas, 'image/png');
        if (png && png.size <= 900 * 1024) return { blob: png, alt: alt, width: tw, height: th };
      }
      ctx.clearRect(0, 0, tw, th);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(src, 0, 0, tw, th);
    var jpg = await canvasToBlob(canvas, 'image/jpeg', JPEG_Q);
    if (!jpg) return null;
    return { blob: jpg, alt: alt, width: tw, height: th };
  }

  // Normaliza una imagen: descarta las pequeñas, reduce/recodifica las grandes.
  async function prepareImage(blob, alt) {
    if (!blob || !blob.size) return null;
    var head = new Uint8Array(await readAsArrayBuffer(blob.slice(0, 16)));
    var type = sniffImageType(head);
    if (!type && /svg/.test(blob.type || '')) type = 'image/svg+xml';
    if (!type && /^\s*</.test(new TextDecoder().decode(head))) {
      type = 'image/svg+xml';
    }
    var typed = type && type !== blob.type ? new Blob([blob], { type: type }) : blob;
    var dec = await decodeImage(typed);
    if (!dec) return null;
    try {
      var w = dec.width, h = dec.height;
      if (w < MIN_IMG || h < MIN_IMG) return null;
      var small = Math.max(w, h) <= MAX_SIDE;
      if (small && type === 'image/jpeg' && blob.size <= 500 * 1024) return { blob: typed, alt: alt, width: w, height: h };
      if (small && /png|gif|webp/.test(type) && blob.size <= 350 * 1024) return { blob: typed, alt: alt, width: w, height: h };
      return await encodeSource(dec.src, w, h, alt, type !== 'image/jpeg' && type !== 'image/bmp');
    } finally {
      if (dec.close) dec.close();
    }
  }

  // Recoge candidatas a imagen durante la extracción. add() devuelve un
  // marcador que se coloca en el texto; finish() lo sustituye por "￼"
  // si la imagen se conserva, o lo elimina si no.
  function Collector() { this.cands = []; }
  Collector.prototype.add = function (blobOrPromise, alt, prepared) {
    var i = this.cands.length;
    var p = Promise.resolve(blobOrPromise).catch(function () { return null; });
    if (p.catch) p.catch(function () {});
    alt = normalizeParagraph(san(alt || ''));
    // Textos alternativos que solo son el nombre del archivo ("image1.png") no aportan nada.
    if (/^[\w\-. ()]+\.(png|jpe?g|gif|bmp|webp|svg|tiff?|emf|wmf|avif)$/i.test(alt)) alt = '';
    this.cands.push({ p: p, alt: alt, prepared: !!prepared });
    return imgMarker(i);
  };
  Collector.prototype.resolve = async function (i) {
    var c = this.cands[i];
    if (!c) return null;
    try {
      var v = await c.p;
      if (!v) return null;
      if (c.prepared) return v;
      return await prepareImage(v, c.alt);
    } catch (e) {
      return null;
    }
  };

  // Construye el resultado final a partir de párrafos con marcadores.
  async function finish(paras, col, report, opts) {
    opts = opts || {};
    var list = [];
    for (var i = 0; i < paras.length; i++) {
      var p = normalizeParagraph(String(paras[i] == null ? '' : paras[i]).replace(/￼/g, ''));
      if (p) list.push(p);
    }
    var out = [], images = [], pageOffsets = [], pending = [];
    var textLen = 0;
    var total = col ? col.cands.length : 0, seen = 0;

    function emit(s, marks) {
      var lead = s.length - s.replace(/^\s+/, '').length;
      var t = s.replace(/\s+/g, ' ').trim();
      if (!t) { marks.forEach(function (m) { pending.push(m.page); }); return; }
      var start = textLen + (out.length ? 2 : 0);
      pending.forEach(function (pg) { pageOffsets[pg] = start; });
      pending = [];
      marks.forEach(function (m) {
        var pos = Math.max(0, m.pos - lead);
        if (pos >= t.length) pending.push(m.page);
        else pageOffsets[m.page] = start + pos;
      });
      out.push(t);
      textLen = start + t.length;
    }

    var re = /\s*(\d+)\s*|(\d+)/g;
    for (var k = 0; k < list.length; k++) {
      var s = list[k];
      var seg = '', marks = [], last = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(s))) {
        seg += s.slice(last, m.index);
        last = re.lastIndex;
        if (m[2] != null) { marks.push({ page: +m[2], pos: seg.length }); continue; }
        var img = null;
        seen++;
        if (col && images.length < MAX_IMAGES) {
          if (report && total > 3) report(opts.imgBase == null ? 90 : opts.imgBase, 'Procesando imágenes (' + seen + ' de ' + total + ')…');
          img = await col.resolve(+m[1]);
        }
        if (img) {
          emit(seg, marks); seg = ''; marks = [];
          emit(OBJ, []);
          images.push(img);
        } else if (seg && !/\s$/.test(seg)) {
          seg += ' ';
        }
      }
      seg += s.slice(last);
      emit(seg, marks);
    }
    var text = out.join('\n\n');
    var res = { title: opts.title, text: text };
    if (images.length) res.images = images;
    if (opts.pages) {
      pending.forEach(function (pg) { pageOffsets[pg] = text.length; });
      var next = text.length;
      for (var n = opts.pages - 1; n >= 0; n--) {
        if (typeof pageOffsets[n] !== 'number') pageOffsets[n] = next;
        next = pageOffsets[n];
      }
      for (var q = 1; q < opts.pages; q++) if (pageOffsets[q] < pageOffsets[q - 1]) pageOffsets[q] = pageOffsets[q - 1];
      pageOffsets.length = opts.pages;
      res.pageOffsets = pageOffsets;
    }
    return res;
  }

  // Obtiene un Blob a partir de un src de <img> en HTML/Markdown sueltos.
  function fetchImageSrc(src) {
    src = String(src || '').trim();
    if (/^data:image\//i.test(src) || /^blob:/i.test(src)) {
      return fetch(src).then(function (r) { return r.ok ? r.blob() : null; }).catch(function () { return null; });
    }
    if (/^https?:\/\//i.test(src)) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var p = fetch(src, { mode: 'cors', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .catch(function () { return null; });
      return withTimeout(p, 5000, function () { if (ctrl) ctrl.abort(); }).catch(function () { return null; });
    }
    return Promise.resolve(null); // rutas relativas: no se pueden resolver
  }

  // ---------------------------------------------------------------- DOM -> párrafos

  var BLOCK_TAGS = {
    address: 1, article: 1, aside: 1, blockquote: 1, dd: 1, div: 1, dl: 1, dt: 1,
    fieldset: 1, figcaption: 1, figure: 1, form: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
    hr: 1, li: 1, main: 1, ol: 1, p: 1, pre: 1, section: 1, table: 1, tbody: 1, thead: 1,
    tfoot: 1, tr: 1, ul: 1, body: 1, center: 1, details: 1, summary: 1, caption: 1
  };
  var SKIP_TAGS = {
    script: 1, style: 1, noscript: 1, template: 1, nav: 1, header: 1, footer: 1,
    iframe: 1, object: 1, svg: 1, canvas: 1, head: 1, button: 1, select: 1, textarea: 1,
    input: 1, math: 1, video: 1, audio: 1, guide: 1
  };

  function isDecorative(el) {
    var role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'presentation' || role === 'none') return true;
    var w = parseInt(el.getAttribute('width'), 10), h = parseInt(el.getAttribute('height'), 10);
    if (w > 0 && h > 0 && (w < MIN_IMG || h < MIN_IMG)) return true;
    return false;
  }

  // ctx.img(el) -> marcador de imagen ('' para ignorarla). Opcional.
  function domToParagraphs(root, ctx) {
    var paras = [];
    var buf = '';
    function flush() {
      var t = buf.replace(/\s+/g, ' ').trim();
      if (t) paras.push(t);
      buf = '';
    }
    function addImg(el) {
      if (!ctx || !ctx.img || isDecorative(el)) return;
      var mk = ctx.img(el);
      if (mk) buf += ' ' + mk + ' ';
    }
    function walk(node) {
      if (node.nodeType === 3 || node.nodeType === 4) { // texto / CDATA
        buf += san(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = (node.localName || node.nodeName || '').toLowerCase();
      if (tag === 'svg') { // solo nos interesan sus <image>
        if (ctx && ctx.img) byLocal(node, 'image').forEach(addImg);
        return;
      }
      if (SKIP_TAGS[tag]) return;
      if (node.getAttribute && (node.getAttribute('hidden') != null || node.getAttribute('aria-hidden') === 'true')) return;
      var epubType = node.getAttribute && (node.getAttribute('epub:type') || '');
      if (/\b(pagebreak|footnote|endnote|noteref)\b/.test(epubType) && tag !== 'a') return;
      if (tag === 'br') { buf += ' '; return; }
      if (tag === 'img' || tag === 'image') { addImg(node); return; }
      var block = !!BLOCK_TAGS[tag];
      var cell = tag === 'td' || tag === 'th';
      if (block) flush();
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
      if (block) flush();
      else if (cell) buf += ' ';
    }
    walk(root);
    flush();
    return paras;
  }

  function parseMarkup(str, preferXml) {
    var parser = new DOMParser();
    if (preferXml) {
      var x = parser.parseFromString(str, 'application/xhtml+xml');
      if (!x.getElementsByTagName('parsererror').length) return x;
    }
    return parser.parseFromString(str, 'text/html');
  }

  // ---------------------------------------------------------------- TXT

  function importTxt(file) {
    return readAsArrayBuffer(file).then(function (buf) {
      var text = normalizeText(san(decodeBytes(buf)));
      return { title: baseName(file.name), text: ensureText(text, 'El archivo de texto está vacío.') };
    });
  }

  // ---------------------------------------------------------------- Markdown

  function stripInlineMd(s) {
    return s
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                 // imágenes
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
      .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1') // [texto](url)
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')              // [texto][ref]
      .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')       // autolinks
      .replace(/<\/?[A-Za-z][^>]*>/g, '')                    // HTML en línea
      .replace(/(`+)([\s\S]*?)\1/g, '$2')                     // código en línea
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')        // negrita
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')               // tachado
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2') // *cursiva*
      .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?![\w])/g, '$1$2') // _cursiva_
      .replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, '$1');        // escapes
  }

  // Sustituye ![alt](src) y <img src> por marcadores de imagen.
  function mdImages(line, col) {
    if (!col) return line;
    return line
      .replace(/!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g, function (all, alt, src) {
        return ' ' + col.add(fetchImageSrc(src), alt) + ' ';
      })
      .replace(/<img\b[^>]*>/gi, function (tag) {
        var src = /\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
        var alt = /\salt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
        if (!src) return '';
        return ' ' + col.add(fetchImageSrc(src[2] || src[3] || src[4]), alt ? (alt[2] || alt[3]) : '') + ' ';
      });
  }

  function mdToParagraphs(src, col) {
    var lines = cleanInline(san(src)).replace(/\r\n?/g, '\n').split('\n');
    var paras = [];
    var cur = [];
    var title = '';
    function flush() {
      if (cur.length) paras.push(cur.join('\n'));
      cur = [];
    }
    var inFence = false, fenceMark = '';
    // Front matter YAML
    if (/^---\s*$/.test(lines[0] || '')) {
      for (var k = 1; k < lines.length; k++) {
        if (/^(---|\.\.\.)\s*$/.test(lines[k])) { lines = lines.slice(k + 1); break; }
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var fm = /^\s*(`{3,}|~{3,})/.exec(line);
      if (inFence) {
        if (fm && fm[1].charAt(0) === fenceMark.charAt(0) && fm[1].length >= fenceMark.length) {
          inFence = false; flush();
        } else {
          cur.push(line);
        }
        continue;
      }
      if (fm) { flush(); inFence = true; fenceMark = fm[1]; continue; }

      if (/^\s*$/.test(line)) { flush(); continue; }
      if (/^\s*\[[^\]]+\]:\s*\S+/.test(line)) continue;                 // definición de referencia
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); continue; } // regla horizontal
      if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue; // separador de tabla

      var h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) {
        flush();
        var ht = stripInlineMd(h[2]);
        if (!title && h[1].length === 1) title = normalizeParagraph(ht);
        paras.push(ht);
        continue;
      }
      // Encabezado setext
      var next = lines[i + 1];
      if (cur.length === 0 && next != null && /^\s{0,3}(=+|-+)\s*$/.test(next) && line.trim()) {
        var st = stripInlineMd(line.trim());
        if (!title && /=/.test(next)) title = normalizeParagraph(st);
        paras.push(st);
        i++;
        continue;
      }

      line = line.replace(/^\s{0,3}(>\s?)+/, '');                    // citas
      var li = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
      if (li) { flush(); line = li[1]; }                              // cada ítem = párrafo
      if (/\|/.test(line) && /^\s*\|.*\|\s*$/.test(line)) {
        line = line.replace(/^\s*\||\|\s*$/g, '').split('|').map(function (c) { return c.trim(); }).join(' ');
      }
      cur.push(stripInlineMd(mdImages(line, col)));
    }
    flush();
    return { title: title, paras: paras };
  }

  function importMd(file, report) {
    return readAsArrayBuffer(file).then(function (buf) {
      var col = new Collector();
      var res = mdToParagraphs(decodeBytes(buf), col);
      return finish(res.paras, col, report, { title: res.title || baseName(file.name) });
    }).then(function (r) { ensureText(r.text); return r; });
  }

  // ---------------------------------------------------------------- HTML

  function htmlToParagraphs(str, ctx) {
    var doc = parseMarkup(str, false);
    var title = textOf(doc.querySelector('title'));
    var h1 = doc.querySelector('h1');
    if (!title && h1) title = textOf(h1);
    var root = doc.querySelector('article') || doc.querySelector('main') || doc.body || doc.documentElement;
    // Si <article>/<main> es muy pequeño respecto al body, usar el body.
    if (doc.body && root !== doc.body && (root.textContent || '').length < (doc.body.textContent || '').length * 0.3) {
      root = doc.body;
    }
    return { title: san(title), paras: domToParagraphs(root, ctx) };
  }

  function importHtml(file, report) {
    return readAsArrayBuffer(file).then(function (buf) {
      var col = new Collector();
      var res = htmlToParagraphs(decodeBytes(buf), {
        img: function (el) { return col.add(fetchImageSrc(el.getAttribute('src') || hrefOf(el)), el.getAttribute('alt')); }
      });
      return finish(res.paras, col, report, { title: res.title || baseName(file.name) });
    }).then(function (r) { ensureText(r.text); return r; });
  }

  // ---------------------------------------------------------------- EPUB

  async function importEpub(file, report) {
    report(2, 'Abriendo EPUB…');
    var zip = await readAsArrayBuffer(file).then(function (buf) {
      return loadZip(buf, 'El archivo EPUB está dañado o no es válido.');
    });
    var opfPath = null;
    var containerXml = await zipText(zip, 'META-INF/container.xml');
    if (containerXml) {
      var cd = new DOMParser().parseFromString(containerXml, 'application/xml');
      var rf = firstByLocalName(cd, 'rootfile');
      opfPath = rf ? rf.getAttribute('full-path') : null;
    }
    if (!opfPath || !zipFile(zip, opfPath)) {
      opfPath = null;
      zip.forEach(function (p) { if (!opfPath && /\.opf$/i.test(p)) opfPath = p; });
    }
    if (!opfPath) throw new Error('El archivo EPUB no es válido (falta el índice del libro).');
    var opf = new DOMParser().parseFromString(await zipText(zip, opfPath), 'application/xml');
    var baseDir = dirOf(opfPath);
    var title = textOf(firstByLocalName(opf, 'title'));

    var manifest = {};
    byLocal(opf, 'item').forEach(function (it) {
      manifest[it.getAttribute('id')] = {
        href: it.getAttribute('href') || '',
        type: it.getAttribute('media-type') || '',
        props: it.getAttribute('properties') || ''
      };
    });
    // Portada: properties="cover-image" (EPUB 3) o <meta name="cover" content="id"> (EPUB 2).
    var coverPath = '';
    Object.keys(manifest).forEach(function (id) {
      if (!coverPath && /\bcover-image\b/.test(manifest[id].props)) coverPath = resolvePath(baseDir, manifest[id].href);
    });
    if (!coverPath) {
      byLocal(opf, 'meta').forEach(function (m) {
        if (coverPath || (m.getAttribute('name') || '').toLowerCase() !== 'cover') return;
        var it = manifest[m.getAttribute('content')];
        if (it && /^image\//.test(it.type)) coverPath = resolvePath(baseDir, it.href);
      });
    }

    var hrefs = [];
    byLocal(opf, 'itemref').forEach(function (ref) {
      if (ref.getAttribute('linear') === 'no') return;
      var it = manifest[ref.getAttribute('idref')];
      if (!it || /\bnav\b/.test(it.props)) return;
      if (it.type && !/html|xml/.test(it.type)) return;
      hrefs.push(resolvePath(baseDir, it.href));
    });
    if (!hrefs.length) throw new Error('El EPUB no contiene capítulos legibles.');

    var col = new Collector();
    var paras = [];
    if (coverPath && zipFile(zip, coverPath)) paras.push(col.add(zipImage(zip, coverPath), 'Portada'));
    var seenImg = {};
    if (coverPath) seenImg[coverPath.toLowerCase()] = 1;

    for (var i = 0; i < hrefs.length; i++) {
      if (hrefs.length > 5) report(5 + (i / hrefs.length) * 60, 'Leyendo capítulo ' + (i + 1) + ' de ' + hrefs.length + '…');
      var src = await zipText(zip, hrefs[i]);
      if (!src) continue;
      var d = parseMarkup(src, true);
      var body = d.body || firstByLocalName(d, 'body') || d.documentElement;
      var chDir = dirOf(hrefs[i]);
      paras = paras.concat(domToParagraphs(body, {
        img: function (el) {
          var href = el.getAttribute('src') || hrefOf(el);
          if (!href || /^(https?:|data:)/i.test(href)) {
            return /^data:image\//i.test(href || '') ? col.add(fetchImageSrc(href), el.getAttribute('alt')) : '';
          }
          var path = resolvePath(chDir, href);
          if (seenImg[path.toLowerCase()] && path.toLowerCase() === coverPath.toLowerCase()) return '';
          seenImg[path.toLowerCase()] = 1;
          return col.add(zipImage(zip, path), el.getAttribute('alt') || el.getAttribute('title') || '');
        }
      }));
    }
    var res = await finish(paras, col, report, { title: title || baseName(file.name), imgBase: 75 });
    ensureText(res.text, 'El EPUB no contiene texto legible (¿quizá solo imágenes?).');
    report(100, 'Listo');
    return res;
  }

  // ---------------------------------------------------------------- DOCX (Word)

  // Título desde docProps/core.xml (<dc:title>). Opcional: si falla, devuelve ''.
  function docxTitle(buf) {
    return loadScript(CDN.jszip, 'JSZip', 'No se pudo cargar JSZip.')
      .then(function (JSZip) { return JSZip.loadAsync(buf); })
      .then(function (zip) { return coreTitle(zip); })
      .catch(function () { return ''; });
  }

  function coreTitle(zip) {
    return zipText(zip, 'docProps/core.xml').then(function (xml) {
      if (!xml) return '';
      var d = new DOMParser().parseFromString(xml, 'application/xml');
      var t = textOf(firstByLocalName(d, 'title'));
      if (/^(untitled|sin título|documento\d*|document\d*|título|title|presentación\d*|presentation\d*|libro\d*|book\d*)$/i.test(t)) t = '';
      return san(t);
    }).catch(function () { return ''; });
  }

  function importDocx(file, report) {
    return readAsArrayBuffer(file).then(function (buf) {
      var titleP = docxTitle(buf);
      var col = new Collector();
      var parasP = loadScript(CDN.mammoth, 'mammoth', 'No se pudo cargar el lector de Word (DOCX). Revisa tu conexión.')
        .then(function (mammoth) {
          return Promise.resolve(mammoth.convertToHtml({ arrayBuffer: buf }, {
            convertImage: mammoth.images.imgElement(function (image) {
              var blobP = Promise.resolve(image.read()).then(function (data) {
                return new Blob([data], { type: image.contentType || '' });
              });
              var mk = col.add(blobP, image.altText || '');
              return Promise.resolve({ src: 'lvimg:' + mk.slice(1, -1) });
            })
          })).catch(function () {
            throw new Error('El archivo DOCX está dañado o no es válido.');
          });
        })
        .then(function (res) {
          var doc = parseMarkup('<!DOCTYPE html><html><body>' + ((res && res.value) || '') + '</body></html>', false);
          // Quitar llamadas a notas ("[1]") y enlaces de vuelta ("↑"); las notas quedan al final.
          Array.prototype.forEach.call(
            doc.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"], a[href^="#comment-"]'),
            function (a) {
              var sup = a.parentNode && a.parentNode.nodeName === 'SUP' && a.parentNode.childNodes.length === 1 ? a.parentNode : a;
              if (sup.parentNode) sup.parentNode.removeChild(sup);
            });
          // Mammoth envuelve cada celda en <p>: aplanarlas para que cada fila sea un párrafo.
          Array.prototype.forEach.call(doc.querySelectorAll('td p, th p'), function (pEl) {
            var span = doc.createElement('span');
            while (pEl.firstChild) span.appendChild(pEl.firstChild);
            span.appendChild(doc.createTextNode(' '));
            pEl.parentNode.replaceChild(span, pEl);
          });
          return domToParagraphs(doc.body, {
            img: function (el) {
              var m = /^lvimg:(\d+)$/.exec(el.getAttribute('src') || '');
              return m ? imgMarker(+m[1]) : '';
            }
          });
        });
      return Promise.all([parasP, titleP]).then(function (r) {
        return finish(r[0], col, report, { title: r[1] || baseName(file.name) });
      }).then(function (res) {
        ensureText(res.text, 'El documento de Word no contiene texto legible.');
        return res;
      });
    });
  }

  // ---------------------------------------------------------------- OpenDocument (ODT/ODS/ODP)

  async function importOdf(file, report) {
    var buf = await readAsArrayBuffer(file);
    var zip = await loadZip(buf, 'El documento OpenDocument está dañado o no es válido.');
    var contentXml = await zipText(zip, 'content.xml');
    var doc = contentXml && parseXml(contentXml);
    if (!doc) throw new Error('El documento OpenDocument está dañado o no es válido (falta content.xml).');
    var title = '';
    var metaXml = await zipText(zip, 'meta.xml');
    var meta = metaXml && parseXml(metaXml);
    if (meta) title = textOf(byLocal(meta, 'title')[0]);

    var col = new Collector();
    var paras = [];
    var buf2 = '';
    var rows = 0;
    var slide = 0;
    function flush() { if (buf2.trim()) paras.push(buf2); buf2 = ''; }
    var SKIP = { note: 1, annotation: 1, 'tracked-changes': 1, 'sequence-decls': 1, forms: 1, desc: 1, title: 1, notes: 1, 'variable-decls': 1, 'user-field-decls': 1 };

    function imageOf(frame, img) {
      var href = hrefOf(img);
      if (!href || /^https?:/i.test(href)) return '';
      var alt = '';
      if (frame) {
        var t = childrenByLocal(frame, 'title')[0] || childrenByLocal(frame, 'desc')[0];
        alt = t ? t.textContent : (frame.getAttribute('draw:name') || '');
      }
      if (/^data:/i.test(href)) return col.add(fetchImageSrc(href), alt);
      return col.add(zipImage(zip, resolvePath('', href)), alt);
    }

    function cellText(cell) {
      var saved = buf2; buf2 = '';
      for (var c = cell.firstChild; c; c = c.nextSibling) walk(c, true);
      var t = buf2.replace(/\s+/g, ' ').trim();
      buf2 = saved;
      return t;
    }

    function walk(node, inline) {
      if (node.nodeType === 3 || node.nodeType === 4) { buf2 += san(node.nodeValue); return; }
      if (node.nodeType !== 1) return;
      var name = node.localName;
      if (SKIP[name]) return;
      if (name === 's') { buf2 += ' '; return; }
      if (name === 'tab' || name === 'line-break') { buf2 += ' '; return; }
      if (name === 'frame') {
        var imgs = childrenByLocal(node, 'image');
        if (imgs.length) {
          // Varias <draw:image> en un marco son alternativas (p. ej. SVG + PNG): usar una.
          var pick = imgs.filter(function (im) { return !/\.(svm|wmf|emf)$/i.test(hrefOf(im)); })[0] || imgs[0];
          var mk = imageOf(node, pick);
          if (mk) buf2 += ' ' + mk + ' ';
          // Texto dentro de la imagen (cuadros de texto anidados)
          imgs.forEach(function (im) { for (var c = im.firstChild; c; c = c.nextSibling) walk(c, inline); });
          return;
        }
      }
      if (name === 'image') { var mk2 = imageOf(null, node); if (mk2) buf2 += ' ' + mk2 + ' '; return; }
      if (name === 'table-row') {
        if (inline) { for (var cc = node.firstChild; cc; cc = cc.nextSibling) walk(cc, true); return; }
        if (rows >= MAX_ROWS) return;
        var cells = [];
        childrenByLocal(node, 'table-cell').forEach(function (cell) {
          var t = cellText(cell);
          if (t) cells.push(t);
        });
        if (cells.length) { flush(); paras.push(cells.join(' · ')); rows++; }
        return;
      }
      if (name === 'page' && !inline) {
        flush();
        slide++;
        paras.push('Diapositiva ' + slide);
      }
      var block = !inline && (name === 'p' || name === 'h' || name === 'list-item' || name === 'page' || name === 'table');
      if (block) flush();
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c, inline);
      if (block) flush();
      else if (inline && (name === 'p' || name === 'h')) buf2 += ' ';
    }

    var body = byLocal(doc, 'body')[0] || doc.documentElement;
    // ODS: nombre de hoja como encabezado si hay varias.
    var sheets = byLocal(body, 'spreadsheet').length ? byLocal(body, 'table').filter(function (t) {
      return t.parentNode && t.parentNode.localName === 'spreadsheet';
    }) : [];
    if (sheets.length) {
      sheets.slice(0, 10).forEach(function (t) {
        if (sheets.length > 1) paras.push(t.getAttribute('table:name') || '');
        walk(t, false);
        flush();
      });
    } else {
      walk(body, false);
    }
    flush();
    var res = await finish(paras, col, report, { title: san(title) || baseName(file.name) });
    ensureText(res.text, 'El documento OpenDocument no contiene texto legible.');
    return res;
  }

  // ---------------------------------------------------------------- RTF

  var RTF_SKIP_DEST = {
    fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1, header: 1, headerl: 1, headerr: 1, headerf: 1,
    footer: 1, footerl: 1, footerr: 1, footerf: 1, footnote: 1, fldinst: 1, object: 1, objdata: 1,
    listtable: 1, listoverridetable: 1, rsidtbl: 1, generator: 1, themedata: 1, colorschememapping: 1,
    datastore: 1, latentstyles: 1, xmlnstbl: 1, filetbl: 1, revtbl: 1, pgdsctbl: 1, nonshppict: 1,
    shppict: 1, shp: 1, shpinst: 1, sp: 1, bkmkstart: 1, bkmkend: 1, xe: 1, tc: 1, private: 1,
    annotation: 1, atnid: 1, atnauthor: 1, mmathPr: 1, wgrffmtfilter: 1, docvar: 1, ftnsep: 1,
    ftnsepc: 1, aftnsep: 1, aftnsepc: 1, listtext: 1, pntext: 1, pntxta: 1, pntxtb: 1, userprops: 1
  };
  var RTF_CHARS = {
    emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“',
    rdblquote: '”', bullet: '•', emspace: ' ', enspace: ' ', qmspace: ' ', tab: ' ', line: '\n',
    cell: ' · ', zwj: '', zwnj: ''
  };
  var RTF_BREAK = { par: 1, sect: 1, page: 1, row: 1, column: 1 };

  function rtfToText(s) {
    var out = '', titleBuf = '';
    var st = { skip: false, dest: '', uc: 1, enc: 'windows-1252' };
    var stack = [];
    var pendingSkip = 0;
    var bytes = [];
    var groupStart = false; // justo después de '{'
    var starDest = false;
    var decoder = safeDecoder('windows-1252');
    var defaultCp = 'windows-1252';

    function flushBytes() {
      if (!bytes.length) return;
      var str = decoder.decode(new Uint8Array(bytes));
      bytes = [];
      emit(str);
    }
    function emit(str) {
      if (st.skip) return;
      if (st.dest === 'title') titleBuf += str;
      else if (!st.dest) out += str;
    }
    var i = 0, n = s.length;
    while (i < n) {
      var ch = s.charAt(i);
      if (ch === '{') {
        flushBytes();
        stack.push(st);
        st = { skip: st.skip, dest: st.dest, uc: st.uc };
        pendingSkip = 0;
        groupStart = true; starDest = false;
        i++; continue;
      }
      if (ch === '}') {
        flushBytes();
        st = stack.pop() || st;
        pendingSkip = 0;
        groupStart = false;
        i++; continue;
      }
      if (ch === '\\') {
        var nx = s.charAt(i + 1);
        if (/[a-zA-Z]/.test(nx)) {
          var m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(s.slice(i + 1, i + 48));
          var word = m[1], param = m[2] != null ? parseInt(m[2], 10) : null;
          i += 1 + m[0].length;
          var wasStart = groupStart;
          groupStart = false;
          if (word === 'bin' && param > 0) { flushBytes(); i += param; continue; }
          if (pendingSkip > 0) { pendingSkip--; continue; }
          if (word !== 'u' && word !== 'uc') flushBytes();
          if (wasStart || starDest) {
            if (word === 'info') { st.dest = 'info'; starDest = false; continue; }
            if (word === 'title' && st.dest === 'info') { st.dest = 'title'; starDest = false; continue; }
            if (RTF_SKIP_DEST[word] || starDest) { st.skip = true; starDest = false; continue; }
          }
          if (word === 'ansicpg' && param) {
            defaultCp = 'windows-' + param;
            if (param === 65001) defaultCp = 'utf-8';
            if (param === 10000) defaultCp = 'macintosh';
            decoder = safeDecoder(defaultCp);
            continue;
          }
          if (word === 'mac') { decoder = safeDecoder('macintosh'); continue; }
          if (word === 'uc') { st.uc = param == null ? 1 : param; continue; }
          if (word === 'u') {
            flushBytes();
            var code = param < 0 ? param + 65536 : param;
            emit(String.fromCharCode(code));
            pendingSkip = st.uc;
            continue;
          }
          if (RTF_BREAK[word]) { emit('\n\n'); continue; }
          if (RTF_CHARS[word] != null) { emit(RTF_CHARS[word]); continue; }
          continue;
        }
        if (nx === "'") {
          var hex = s.substr(i + 2, 2);
          i += 4;
          groupStart = false;
          if (pendingSkip > 0) { pendingSkip--; continue; }
          var b = parseInt(hex, 16);
          if (!isNaN(b)) bytes.push(b);
          continue;
        }
        i += 2;
        if (nx === '*') { if (groupStart) starDest = true; continue; }
        groupStart = false;
        if (pendingSkip > 0) { pendingSkip--; continue; }
        flushBytes();
        if (nx === '~') emit(' ');
        else if (nx === '_') emit('‑');
        else if (nx === '-') { /* guion opcional */ }
        else if (nx === '\\' || nx === '{' || nx === '}') emit(nx);
        else if (nx === '\n' || nx === '\r') emit('\n\n');
        else if (nx === '\t') emit(' ');
        continue;
      }
      if (ch === '\r' || ch === '\n') { i++; continue; }
      groupStart = false;
      if (pendingSkip > 0) { pendingSkip--; i++; continue; }
      var code2 = ch.charCodeAt(0);
      if (code2 >= 0x80) bytes.push(code2 & 0xFF);
      else { flushBytes(); emit(ch); }
      i++;
    }
    flushBytes();
    return { text: out, title: titleBuf };
  }

  function importRtf(file, report) {
    return readAsArrayBuffer(file).then(function (buf) {
      var u8 = new Uint8Array(buf);
      var head = String.fromCharCode.apply(null, u8.subarray(0, 5));
      if (head !== '{\\rtf') throw new Error('El archivo RTF no es válido.');
      // Cadena "binaria": un carácter por byte.
      var s = '';
      for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
      var r;
      try { r = rtfToText(s); } catch (e) { throw new Error('No se pudo leer el archivo RTF. Puede estar dañado.'); }
      return finish(splitParagraphs(san(r.text)), null, report, { title: normalizeParagraph(san(r.title)) || baseName(file.name) });
    }).then(function (res) { ensureText(res.text, 'El archivo RTF no contiene texto legible.'); return res; });
  }

  // ---------------------------------------------------------------- FB2 (FictionBook)

  async function importFb2(file, report) {
    var buf = await readAsArrayBuffer(file);
    var u8 = new Uint8Array(buf);
    var head = new TextDecoder('latin1').decode(u8.subarray(0, 300));
    var encM = /encoding=["']([\w-]+)["']/i.exec(head);
    var str = encM && !/utf-?8/i.test(encM[1]) ? safeDecoder(encM[1].toLowerCase(), 'utf-8').decode(u8) : decodeBytes(buf);
    var doc = parseXml(str.replace(/^﻿/, ''));
    if (!doc || !byLocal(doc, 'body').length) throw new Error('El archivo FB2 está dañado o no es válido.');

    var titleInfo = byLocal(doc, 'title-info')[0];
    var title = titleInfo ? textOf(byLocal(titleInfo, 'book-title')[0]) : '';

    var binaries = {};
    byLocal(doc, 'binary').forEach(function (b) {
      binaries[b.getAttribute('id')] = { type: b.getAttribute('content-type') || '', data: b.textContent };
    });
    var col = new Collector();
    function imgFor(el) {
      var href = hrefOf(el).replace(/^#/, '');
      var bin = binaries[href];
      if (!bin) return '';
      var blobP = Promise.resolve().then(function () {
        var bytes = base64ToBytes(bin.data);
        return new Blob([bytes], { type: sniffImageType(bytes) || bin.type });
      });
      return col.add(blobP, el.getAttribute('alt') || el.getAttribute('title') || '');
    }

    var paras = [];
    var coverImg = titleInfo && byLocal(byLocal(titleInfo, 'coverpage')[0] || titleInfo, 'image')[0];
    if (coverImg && byLocal(titleInfo, 'coverpage').length) {
      var mk = imgFor(coverImg);
      if (mk) paras.push(mk);
    }
    function inline(el) {
      var s = '';
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3 || c.nodeType === 4) s += san(c.nodeValue);
        else if (c.nodeType === 1) {
          if (c.localName === 'image') { var m = imgFor(c); if (m) s += ' ' + m + ' '; }
          else s += inline(c);
        }
      }
      return s;
    }
    function walk(el) {
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var n = c.localName;
        if (n === 'p' || n === 'v' || n === 'subtitle' || n === 'text-author' || n === 'td' || n === 'th') {
          paras.push(inline(c));
        } else if (n === 'tr') {
          paras.push(childrenByLocal(c, 'td').concat(childrenByLocal(c, 'th')).map(inline).filter(function (t) { return t.trim(); }).join(' · '));
        } else if (n === 'image') {
          var m = imgFor(c);
          if (m) paras.push(m);
        } else if (n === 'empty-line') {
          /* nada */
        } else {
          walk(c); // section, title, epigraph, cite, poem, stanza, annotation, table...
        }
      }
    }
    byLocal(doc, 'body').forEach(function (b) { walk(b); });
    var res = await finish(paras, col, report, { title: san(title) || baseName(file.name) });
    ensureText(res.text, 'El libro FB2 no contiene texto legible.');
    return res;
  }

  // ---------------------------------------------------------------- MOBI / AZW / AZW3 / PRC

  var MOBI_DRM_MSG = 'Este libro de Kindle está protegido con DRM o usa una compresión no compatible. ' +
    'Si es tuyo y no tiene DRM, conviértelo a EPUB con Calibre e impórtalo de nuevo.';

  function palmDocDecompress(src) {
    var out = new Uint8Array(Math.max(4096, src.length * 8));
    var o = 0;
    function grow(need) {
      if (o + need <= out.length) return;
      var n = new Uint8Array(Math.max(out.length * 2, o + need));
      n.set(out.subarray(0, o));
      out = n;
    }
    var i = 0;
    while (i < src.length) {
      var c = src[i++];
      if (c >= 1 && c <= 8) {
        grow(c);
        for (var k = 0; k < c && i < src.length; k++) out[o++] = src[i++];
      } else if (c < 0x80) {
        grow(1);
        out[o++] = c;
      } else if (c >= 0xC0) {
        grow(2);
        out[o++] = 0x20;
        out[o++] = c ^ 0x80;
      } else {
        if (i >= src.length) break;
        var pair = (c << 8) | src[i++];
        var dist = (pair >> 3) & 0x7FF;
        var len = (pair & 7) + 3;
        grow(len);
        if (dist < 1 || dist > o) continue;
        for (var j = 0; j < len; j++) { out[o] = out[o - dist]; o++; }
      }
    }
    return out.subarray(0, o);
  }

  function trailingSize(data, flags) {
    var size = data.length;
    function entry(sz) {
      var bitpos = 0, result = 0;
      if (sz <= 0) return 0;
      for (;;) {
        var v = data[sz - 1];
        result |= (v & 0x7F) << bitpos;
        bitpos += 7;
        sz--;
        if ((v & 0x80) !== 0 || bitpos >= 28 || sz === 0) return result;
      }
    }
    var num = 0;
    var tf = flags >> 1;
    while (tf) {
      if (tf & 1) num += entry(size - num);
      tf >>= 1;
    }
    if (flags & 1) {
      var idx = size - num - 1;
      if (idx >= 0) num += (data[idx] & 0x3) + 1;
    }
    return Math.min(num, size);
  }

  function mobiReadHeader(rec, base) {
    var r0 = rec(base);
    if (!r0 || r0.length < 16) return null;
    var dv = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
    var h = {
      base: base,
      compression: dv.getUint16(0),
      textLength: dv.getUint32(4),
      recCount: dv.getUint16(8),
      encryption: dv.getUint16(12),
      encoding: 1252, version: 0, firstImage: 0xFFFFFFFF, extraFlags: 0, fdst: 0xFFFFFFFF,
      fullName: '', exth: {}, hasMobi: false
    };
    if (r0.length >= 0x84 && String.fromCharCode(r0[16], r0[17], r0[18], r0[19]) === 'MOBI') {
      h.hasMobi = true;
      var hlen = dv.getUint32(20);
      h.encoding = dv.getUint32(28);
      h.version = dv.getUint32(36);
      var fnOff = dv.getUint32(84), fnLen = dv.getUint32(88);
      h.firstImage = dv.getUint32(108);
      var exthFlags = dv.getUint32(128);
      if (hlen >= 0xE4 && r0.length >= 0xF4) h.extraFlags = dv.getUint16(0xF2);
      if (h.version >= 8 && r0.length >= 0xC4) h.fdst = dv.getUint32(0xC0);
      var dec = safeDecoder(h.encoding === 65001 ? 'utf-8' : 'windows-1252');
      if (fnOff && fnLen && fnOff + fnLen <= r0.length) h.fullName = dec.decode(r0.subarray(fnOff, fnOff + fnLen));
      var eo = 16 + hlen;
      if ((exthFlags & 0x40) && eo + 12 <= r0.length &&
        String.fromCharCode(r0[eo], r0[eo + 1], r0[eo + 2], r0[eo + 3]) === 'EXTH') {
        var count = dv.getUint32(eo + 8);
        var p = eo + 12;
        for (var k = 0; k < count && p + 8 <= r0.length; k++) {
          var type = dv.getUint32(p), len = dv.getUint32(p + 4);
          if (len < 8 || p + len > r0.length) break;
          var data = r0.subarray(p + 8, p + len);
          if (!h.exth[type]) h.exth[type] = data;
          p += len;
        }
      }
      h.decoder = dec;
    } else {
      h.decoder = safeDecoder('windows-1252');
    }
    return h;
  }

  function exthNum(h, type) {
    var d = h.exth[type];
    if (!d || d.length < 4) return null;
    return ((d[0] << 24) >>> 0) + (d[1] << 16) + (d[2] << 8) + d[3];
  }

  function mobiText(rec, h) {
    if (h.encryption !== 0) throw new Error(MOBI_DRM_MSG);
    if (h.compression !== 1 && h.compression !== 2) throw new Error(MOBI_DRM_MSG);
    var parts = [], total = 0;
    for (var i = 1; i <= h.recCount; i++) {
      var d = rec(h.base + i);
      if (!d) break;
      if (h.extraFlags) d = d.subarray(0, d.length - trailingSize(d, h.extraFlags));
      if (h.compression === 2) d = palmDocDecompress(d);
      parts.push(d);
      total += d.length;
    }
    var all = new Uint8Array(total), o = 0;
    parts.forEach(function (p) { all.set(p, o); o += p.length; });
    if (h.textLength && h.textLength < all.length) all = all.subarray(0, h.textLength);
    // KF8: el flujo 0 (FDST) es el texto; los siguientes son CSS/SVG.
    if (h.version >= 8 && h.fdst !== 0xFFFFFFFF) {
      var f = rec(h.base + h.fdst);
      if (f && f.length >= 20 && String.fromCharCode(f[0], f[1], f[2], f[3]) === 'FDST') {
        var fdv = new DataView(f.buffer, f.byteOffset, f.byteLength);
        var end0 = fdv.getUint32(16);
        if (end0 > 0 && end0 <= all.length) all = all.subarray(0, end0);
      }
    }
    return h.decoder.decode(all);
  }

  function isGarbage(text) {
    if (!text) return true;
    var visible = text.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
    if (visible.length < 40) return true;
    var bad = (visible.match(/[�\u0000-\u0008\u000E-\u001F]/g) || []).length;
    return bad / visible.length > 0.05;
  }

  async function importMobi(file, report) {
    report(5, 'Abriendo libro de Kindle…');
    var buf = await readAsArrayBuffer(file);
    var u8 = new Uint8Array(buf);
    if (u8.length < 86) throw new Error('El archivo de Kindle está dañado o no es válido.');
    var dv = new DataView(buf);
    var kind = String.fromCharCode.apply(null, u8.subarray(60, 68));
    if (kind === 'TPZ0' || /^TPZ/.test(String.fromCharCode(u8[0], u8[1], u8[2]))) throw new Error('Los libros Topaz de Kindle no son compatibles. ' + MOBI_DRM_MSG);
    if (kind !== 'BOOKMOBI' && kind !== 'TEXtREAd') {
      throw new Error('El archivo no es un libro de Kindle (MOBI/AZW) válido. Si es un KFX, conviértelo a EPUB con Calibre.');
    }
    var n = dv.getUint16(76);
    var offs = [];
    for (var i = 0; i < n && 78 + 8 * i + 4 <= u8.length; i++) offs.push(dv.getUint32(78 + 8 * i));
    n = offs.length;
    offs.push(u8.length);
    function rec(k) {
      if (k < 0 || k >= n) return null;
      var a = offs[k], b = offs[k + 1];
      if (a > u8.length || b > u8.length || b < a) return null;
      return u8.subarray(a, b);
    }
    var pdbName = new TextDecoder('latin1').decode(u8.subarray(0, 32)).replace(/\0.*$/, '');

    var h = mobiReadHeader(rec, 0);
    if (!h) throw new Error('El archivo de Kindle está dañado o no es válido.');
    if (h.compression === 17480 || h.encryption !== 0) throw new Error(MOBI_DRM_MSG);
    report(15, 'Descomprimiendo texto…');
    var html = '';
    try { html = mobiText(rec, h); } catch (e) { if (e.message === MOBI_DRM_MSG) throw e; html = ''; }

    // Archivo combinado MOBI6 + KF8, o KF8 puro con un MOBI6 vacío: probar desde el límite KF8.
    var k8 = exthNum(h, 121);
    if (isGarbage(html) && k8 && k8 < n) {
      var h8 = mobiReadHeader(rec, k8);
      if (h8 && h8.hasMobi) {
        if (h8.compression === 17480 || h8.encryption !== 0) throw new Error(MOBI_DRM_MSG);
        try {
          var html8 = mobiText(rec, h8);
          if (!isGarbage(html8)) { html = html8; h8.exth = Object.keys(h8.exth).length ? h8.exth : h.exth; h = h8; }
        } catch (e2) { /* seguir con lo que haya */ }
      }
    }
    if (isGarbage(html)) {
      throw new Error('No se pudo leer el texto de este libro de Kindle. Prueba a convertirlo a EPUB con Calibre.');
    }
    report(45, 'Procesando texto…');

    var titleBytes = h.exth[503];
    var title = titleBytes ? h.decoder.decode(titleBytes) : (h.fullName || pdbName.replace(/_/g, ' '));

    var col = new Collector();
    var usedRec = {};
    function imageRecord(idx) { // idx: 1-based relativo a la primera imagen
      if (!(idx >= 1) || h.firstImage === 0xFFFFFFFF) return null;
      var cands = [h.base + h.firstImage + idx - 1, h.firstImage + idx - 1];
      for (var c = 0; c < cands.length; c++) {
        var r = rec(cands[c]);
        var t = r && sniffImageType(r);
        if (t) return { k: cands[c], blob: new Blob([r], { type: t }) };
      }
      return null;
    }
    var paras = [];
    var coverOff = exthNum(h, 201);
    if (coverOff != null && coverOff !== 0xFFFFFFFF) {
      var cov = imageRecord(coverOff + 1);
      if (cov) { usedRec[cov.k] = 1; paras.push(col.add(cov.blob, 'Portada')); }
    }

    if (!h.hasMobi) { // PalmDOC simple (texto)
      paras = paras.concat(splitParagraphs(san(html)));
    } else {
      html = html.replace(/<mbp:pagebreak[^>]*>/gi, '<hr>').replace(/<\/?mbp:[^>]*>/gi, '');
      var res0 = htmlToParagraphs(html, {
        img: function (el) {
          var ri = el.getAttribute('recindex') || el.getAttribute('hirecindex') || el.getAttribute('lorecindex');
          var idx = ri ? parseInt(ri, 10) : NaN;
          var src = el.getAttribute('src') || '';
          var km = /kindle:embed:([0-9A-Va-v]+)/.exec(src);
          if (km) idx = parseInt(km[1], 32);
          var r = imageRecord(idx);
          if (!r || usedRec[r.k]) return '';
          usedRec[r.k] = 1;
          return col.add(r.blob, el.getAttribute('alt') || '');
        }
      });
      paras = paras.concat(res0.paras);
    }
    var res = await finish(paras, col, report, { title: normalizeParagraph(san(title)) || baseName(file.name) });
    ensureText(res.text, 'El libro de Kindle no contiene texto legible.');
    report(100, 'Listo');
    return res;
  }

  // ---------------------------------------------------------------- PPTX (PowerPoint)

  function relsMap(xml, dir) {
    var map = {};
    var d = xml && parseXml(xml);
    if (!d) return map;
    byLocal(d, 'Relationship').forEach(function (r) {
      if (r.getAttribute('TargetMode') === 'External') return;
      map[r.getAttribute('Id')] = resolvePath(dir, r.getAttribute('Target') || '');
    });
    return map;
  }

  function relsPathFor(path) { return dirOf(path) + '_rels/' + path.replace(/^.*\//, '') + '.rels'; }

  var REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function relAttr(el, name) {
    return el.getAttributeNS(REL_NS, name) || el.getAttribute('r:' + name) || '';
  }

  async function importPptx(file, report) {
    var buf = await readAsArrayBuffer(file);
    var zip = await loadZip(buf, 'La presentación de PowerPoint está dañada o no es válida.');
    var slides = [];
    var presXml = await zipText(zip, 'ppt/presentation.xml');
    var pres = presXml && parseXml(presXml);
    if (pres) {
      var rels = relsMap(await zipText(zip, 'ppt/_rels/presentation.xml.rels'), 'ppt/');
      byLocal(pres, 'sldId').forEach(function (s) {
        var t = rels[relAttr(s, 'id')];
        if (t && zipFile(zip, t)) slides.push(t);
      });
    }
    if (!slides.length) {
      zip.forEach(function (p) { if (/^ppt\/slides\/slide\d+\.xml$/i.test(p)) slides.push(p); });
      slides.sort(function (a, b) { return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10); });
    }
    if (!slides.length) throw new Error('La presentación de PowerPoint no contiene diapositivas.');
    var title = await coreTitle(zip);
    var col = new Collector();
    var paras = [];
    for (var i = 0; i < slides.length; i++) {
      if (slides.length > 10) report((i / slides.length) * 70, 'Leyendo diapositiva ' + (i + 1) + ' de ' + slides.length + '…');
      var d = parseXml(await zipText(zip, slides[i]));
      if (!d) continue;
      var srels = relsMap(await zipText(zip, relsPathFor(slides[i])), dirOf(slides[i]));
      paras.push('Diapositiva ' + (i + 1));
      byLocal(d, 'p').forEach(function (p) {
        if (p.namespaceURI && !/drawingml/.test(p.namespaceURI)) return; // solo a:p
        var s = '';
        (function walk(el) {
          for (var c = el.firstChild; c; c = c.nextSibling) {
            if (c.nodeType !== 1) continue;
            if (c.localName === 't') s += san(c.textContent);
            else if (c.localName === 'br' || c.localName === 'tab') s += ' ';
            else if (c.localName === 'r' || c.localName === 'fld') walk(c);
          }
        })(p);
        if (s.trim()) paras.push(s);
      });
      byLocal(d, 'pic').forEach(function (pic) {
        var blip = byLocal(pic, 'blip')[0];
        var id = blip && relAttr(blip, 'embed');
        var target = id && srels[id];
        if (!target) return;
        var nv = byLocal(pic, 'cNvPr')[0];
        var alt = nv ? (nv.getAttribute('descr') || nv.getAttribute('title') || '') : '';
        paras.push(col.add(zipImage(zip, target), alt));
      });
    }
    var res = await finish(paras, col, report, { title: title || baseName(file.name) });
    ensureText(res.text, 'La presentación no contiene texto legible.');
    return res;
  }

  // ---------------------------------------------------------------- XLSX (Excel)

  async function importXlsx(file, report) {
    var buf = await readAsArrayBuffer(file);
    var zip = await loadZip(buf, 'La hoja de cálculo de Excel está dañada o no es válida.');
    var shared = [];
    var ssXml = await zipText(zip, 'xl/sharedStrings.xml');
    var ss = ssXml && parseXml(ssXml);
    if (ss) {
      byLocal(ss, 'si').forEach(function (si) {
        var s = '';
        byLocal(si, 't').forEach(function (t) {
          if (t.parentNode && t.parentNode.localName === 'rPh') return; // fonética
          s += t.textContent;
        });
        shared.push(san(s));
      });
    }
    var sheets = [];
    var wb = parseXml(await zipText(zip, 'xl/workbook.xml'));
    if (wb) {
      var rels = relsMap(await zipText(zip, 'xl/_rels/workbook.xml.rels'), 'xl/');
      byLocal(wb, 'sheet').forEach(function (s) {
        var t = rels[relAttr(s, 'id')];
        if (t && zipFile(zip, t)) sheets.push({ name: s.getAttribute('name') || '', path: t });
      });
    }
    if (!sheets.length) {
      zip.forEach(function (p) { if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(p)) sheets.push({ name: '', path: p }); });
    }
    if (!sheets.length) throw new Error('La hoja de cálculo no contiene hojas legibles.');
    sheets = sheets.slice(0, 5);
    var paras = [];
    var rows = 0;
    for (var i = 0; i < sheets.length && rows < MAX_ROWS; i++) {
      report((i / sheets.length) * 90, 'Leyendo hoja ' + (i + 1) + ' de ' + sheets.length + '…');
      var d = parseXml(await zipText(zip, sheets[i].path));
      if (!d) continue;
      if (sheets.length > 1 && sheets[i].name) paras.push(san(sheets[i].name));
      var rowEls = byLocal(d, 'row');
      for (var r = 0; r < rowEls.length && rows < MAX_ROWS; r++) {
        var cells = [];
        childrenByLocal(rowEls[r], 'c').forEach(function (c) {
          var t = c.getAttribute('t');
          var v = childrenByLocal(c, 'v')[0];
          var val = '';
          if (t === 's') val = v ? (shared[parseInt(v.textContent, 10)] || '') : '';
          else if (t === 'inlineStr') val = byLocal(c, 't').map(function (x) { return x.textContent; }).join('');
          else if (t === 'b') val = v ? (v.textContent === '1' ? 'VERDADERO' : 'FALSO') : '';
          else val = v ? v.textContent : '';
          val = normalizeParagraph(san(val));
          if (val) cells.push(val);
        });
        if (cells.length) { paras.push(cells.join(' · ')); rows++; }
      }
    }
    var res = await finish(paras, null, report, { title: (await coreTitle(zip)) || baseName(file.name) });
    ensureText(res.text, 'La hoja de cálculo está vacía.');
    return res;
  }

  // ---------------------------------------------------------------- CSV / TSV

  function parseDelimited(src, delim) {
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      if (q) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { field += '"'; i++; } else q = false;
        } else field += ch;
        continue;
      }
      if (ch === '"' && field.trim() === '') { q = true; field = ''; continue; }
      if (ch === delim) { row.push(field); field = ''; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src.charAt(i + 1) === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
        if (rows.length >= MAX_ROWS * 2) break;
        continue;
      }
      field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function guessDelimiter(src) {
    var first = src.split(/\r?\n/).slice(0, 5).join('\n').replace(/"[^"]*"/g, '');
    var best = ',', bestN = 0;
    [',', ';', '\t', '|'].forEach(function (d) {
      var n = first.split(d).length - 1;
      if (n > bestN) { best = d; bestN = n; }
    });
    return best;
  }

  function importCsv(file, report) {
    return readAsArrayBuffer(file).then(function (buf) {
      var src = san(decodeBytes(buf));
      var ext = extOf(file.name);
      var delim = ext === 'tsv' || ext === 'tab' || /tab-separated/.test(file.type || '') ? '\t' : guessDelimiter(src);
      var rows = parseDelimited(src, delim);
      var paras = [];
      for (var i = 0; i < rows.length && paras.length < MAX_ROWS; i++) {
        var cells = rows[i].map(function (c) { return normalizeParagraph(c); }).filter(Boolean);
        if (cells.length) paras.push(cells.join(' · '));
      }
      return finish(paras, null, report, { title: baseName(file.name) });
    }).then(function (res) { ensureText(res.text, 'El archivo CSV está vacío.'); return res; });
  }

  // ---------------------------------------------------------------- Subtítulos (SRT / VTT)

  function parseTime(t) {
    var m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/.exec(t);
    if (!m) return null;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +('0.' + m[4]) : 0);
  }

  function subsToParagraphs(src) {
    var blocks = san(src).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
    var paras = [], cur = [], count = 0, lastEnd = null;
    function flush() { if (cur.length) paras.push(cur.join(' ')); cur = []; count = 0; }
    blocks.forEach(function (b) {
      var lines = b.split('\n').filter(function (l) { return l.trim(); });
      if (!lines.length) return;
      if (/^WEBVTT/.test(lines[0])) lines.shift();
      if (lines.length && /^(NOTE|STYLE|REGION)\b/.test(lines[0])) return;
      var ti = -1;
      for (var i = 0; i < lines.length; i++) if (/-->/.test(lines[i])) { ti = i; break; }
      var start = null, end = null;
      if (ti >= 0) {
        var parts = lines[ti].split('-->');
        start = parseTime(parts[0]); end = parseTime(parts[1] || '');
        lines = lines.slice(ti + 1);
      } else if (lines.length && /^\d+$/.test(lines[0].trim())) {
        lines.shift();
      }
      var text = lines.join(' ')
        .replace(/<[^>]*>/g, '')
        .replace(/\{\\[^}]*\}/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .trim();
      if (!text) return;
      if (cur.length && ((start != null && lastEnd != null && start - lastEnd > 2) || count >= 5)) flush();
      cur.push(text);
      count++;
      if (end != null) lastEnd = end;
    });
    flush();
    return paras;
  }

  function importSubs(file, report) {
    return readAsArrayBuffer(file).then(function (buf) {
      return finish(subsToParagraphs(decodeBytes(buf)), null, report, { title: baseName(file.name) });
    }).then(function (res) { ensureText(res.text, 'El archivo de subtítulos no contiene texto.'); return res; });
  }

  // ---------------------------------------------------------------- JSON

  function importJson(file, report) {
    return readAsArrayBuffer(file).then(function (buf) {
      var data;
      try { data = JSON.parse(decodeBytes(buf)); } catch (e) { throw new Error('El archivo JSON no es válido.'); }
      var paras = [], title = '';
      (function walk(v, key) {
        if (paras.length > 20000) return;
        if (typeof v === 'string') {
          if (!title && /^(title|titulo|título|name|nombre)$/i.test(key || '') && v.length < 200) title = v;
          if (v.trim().length > 20) paras = paras.concat(splitParagraphs(san(v)));
        } else if (Array.isArray(v)) v.forEach(function (x) { walk(x, key); });
        else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k], k); });
      })(data, '');
      return finish(paras, null, report, { title: normalizeParagraph(san(title)) || baseName(file.name) });
    }).then(function (res) { ensureText(res.text, 'El archivo JSON no contiene textos largos que leer.'); return res; });
  }

  // ---------------------------------------------------------------- OCR (Tesseract, respaldo)

  var OCR_STATUS = {
    'loading tesseract core': 'Cargando motor de OCR…',
    'initializing tesseract': 'Inicializando OCR…',
    'initialized tesseract': 'OCR inicializado',
    'loading language traineddata': 'Descargando idiomas (español e inglés)…',
    'loaded language traineddata': 'Idiomas cargados',
    'initializing api': 'Preparando reconocimiento…',
    'initialized api': 'Listo para reconocer',
    'recognizing text': 'Reconociendo texto…'
  };

  // Crea un worker de Tesseract (spa+eng). logger recibe los mensajes de progreso.
  function createOcrWorker(logger) {
    return loadScript(CDN.tesseract, 'Tesseract', 'No se pudo cargar el reconocimiento de texto (OCR). Revisa tu conexión.')
      .then(function (Tesseract) {
        return Promise.resolve(Tesseract.createWorker('spa+eng', 1, { logger: function (m) { if (m && logger) logger(m); } }))
          .catch(function () { throw new Error('No se pudo iniciar el OCR. Revisa tu conexión.'); });
      });
  }

  // ---------------------------------------------------------------- OCR (motor)
  // Motor principal: Indra (Datalab, js/indra.js en un Web Worker): endereza la
  // página, respeta columnas y quita cabeceras y números de página. Si no se puede
  // cargar (sin conexión la primera vez, navegador sin WebAssembly), Tesseract.
  //
  //   engine = await createOcrEngine(onStatus)        onStatus(mensaje)
  //   { text } = await engine.recognize(canvas|blob, onProgress)   onProgress(0..1)
  //   engine.terminate()

  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;
  var OCR_MAX_SIDE = 4000;


  async function sourceCanvas(source) {
    if (source && source.getContext) return source;
    var bmp = null;
    if (typeof createImageBitmap === 'function') {
      try { bmp = await createImageBitmap(source); } catch (e) { bmp = null; }
    }
    if (!bmp) {
      bmp = await new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(source), im = new Image();
        im.onload = function () { URL.revokeObjectURL(url); resolve(im); };
        im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen. Prueba con otro formato (PNG o JPG).')); };
        im.src = url;
      });
    }
    var w = bmp.width, h = bmp.height, s = Math.min(1, OCR_MAX_SIDE / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; // las transparencias, sobre papel blanco
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }

  // Página en gris (0 = negro) como la lee Indra: { width, height, data }.
  async function grayPage(source) {
    var c = await sourceCanvas(source);
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var g = new Uint8Array(c.width * c.height);
    for (var i = 0, j = 0; j < g.length; i += 4, j++) {
      g[j] = (d[i] * 4899 + d[i + 1] * 9617 + d[i + 2] * 1868 + 8192) >> 14; // como cv2 (BT.601)
    }
    return { width: c.width, height: c.height, data: g };
  }

  function createIndraEngine(onStatus) {
    var worker;
    try {
      worker = new Worker(new URL('ocr-worker.js', SCRIPT_URL).href);
    } catch (e) {
      return Promise.reject(e);
    }
    var seq = 0, pending = new Map();
    worker.onmessage = function (e) {
      var m = e.data || {}, p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { if (p.progress) p.progress(m); return; }
      pending.delete(m.id);
      if (m.type === 'done') p.resolve(m.result);
      else p.reject(new Error(m.message || 'Error del OCR'));
    };
    worker.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      pending.forEach(function (p) { p.reject(new Error('El OCR se detuvo.')); });
      pending.clear();
    };
    function call(msg, progress, transfer) {
      return new Promise(function (resolve, reject) {
        msg.id = ++seq;
        pending.set(msg.id, { resolve: resolve, reject: reject, progress: progress });
        worker.postMessage(msg, transfer || []);
      });
    }
    var engine = {
      name: 'indra',
      recognize: function (source, onProgress) {
        return grayPage(source).then(function (page) {
          return call({ type: 'read', page: page }, function (m) {
            if (onProgress && typeof m.frac === 'number') onProgress(m.frac);
          }, [page.data.buffer]);
        });
      },
      terminate: function () { worker.terminate(); }
    };
    return call({ type: 'init' }, function (m) {
      if (!onStatus) return;
      if (m.stage === 'download') {
        onStatus('Cargando OCR Indra…');
      } else if (m.stage === 'load') onStatus('Cargando OCR Indra…');
      else if (m.stage === 'prepare') onStatus('Preparando OCR Indra…');
    }).then(function () { return engine; }, function (err) {
      worker.terminate();
      throw err;
    });
  }

  function createTesseractEngine(onStatus) {
    var current = null;
    return createOcrWorker(function (m) {
      if (m.status === 'recognizing text') { if (current) current(m.progress || 0); }
      else if (OCR_STATUS[m.status] && onStatus) onStatus(OCR_STATUS[m.status]);
    }).then(function (worker) {
      return {
        name: 'tesseract',
        recognize: function (source, onProgress) {
          current = onProgress;
          return worker.recognize(source).then(function (res) {
            return { text: (res && res.data && res.data.text) || '' };
          }, function () {
            throw new Error('No se pudo leer la imagen. Prueba con otro formato (PNG o JPG).');
          });
        },
        terminate: function () { return worker.terminate(); }
      };
    });
  }

  // Indra, y Tesseract si Indra no arranca o falla en una página.
  function createOcrEngine(onStatus) {
    var inner = null;
    function fallback(err) {
      if (window.console) console.warn('OCR Indra no disponible, se usa Tesseract:', err && err.message);
      if (onStatus) onStatus('Cargando OCR alternativo…');
      return createTesseractEngine(onStatus).then(function (t) { inner = t; return t; });
    }
    // En la app (Android, Windows…) no hay respaldo: Indra va dentro y Tesseract se bajaría de una CDN.
    var native = !!window.__TAURI__;
    var start = LV.ocrEngine === 'tesseract' && !native ? createTesseractEngine(onStatus)
      : createIndraEngine(onStatus).catch(native ? function (e) { throw e; } : fallback);
    return start.then(function (e) {
      inner = e;
      return {
        get name() { return inner.name; },
        recognize: function (source, onProgress) {
          return inner.recognize(source, onProgress).then(function (res) {
            LV.lastOcrEngine = inner.name; // para depurar y para las pruebas
            return res;
          }).catch(function (err) {
            if (inner.name !== 'indra' || native) throw err;
            try { inner.terminate(); } catch (e2) { /* nada */ }
            return fallback(err).then(function (t) {
              return t.recognize(source, onProgress).then(function (res) { LV.lastOcrEngine = t.name; return res; });
            });
          });
        },
        terminate: function () { try { return inner.terminate(); } catch (e) { return null; } }
      };
    });
  }

  // ---------------------------------------------------------------- PDF

  function loadPdfJs() {
    return loadScript(CDN.pdfjs, 'pdfjsLib', 'No se pudo cargar el lector de PDF. Revisa tu conexión.')
      .then(function (lib) {
        if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
        return lib;
      });
  }

  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Devuelve una lista de líneas {text, y, x, h} a partir de los items de pdf.js.
  function pdfItemsToLines(items) {
    var lines = [];
    var cur = null;
    var forceNew = false;
    function push() {
      if (cur && cur.text.trim()) lines.push(cur);
      cur = null;
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (typeof it.str !== 'string') continue; // marked content
      var str = san(it.str);
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      var x = tr[4], y = tr[5];
      var h = Math.abs(it.height || tr[3] || Math.hypot(tr[2], tr[3])) || 10;
      if (str === '') {
        if (it.hasEOL) forceNew = true;
        continue;
      }
      var sameLine = cur && !forceNew && Math.abs(y - cur.y) <= Math.max(cur.h, h) * 0.5;
      if (!sameLine) {
        push();
        cur = { text: str, y: y, x: x, h: h, endX: x + (it.width || 0) };
      } else {
        var gap = x - cur.endX;
        if (gap > h * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(str)) cur.text += ' ';
        cur.text += str;
        cur.endX = x + (it.width || 0);
        cur.h = Math.max(cur.h, h);
      }
      forceNew = !!it.hasEOL;
    }
    push();
    return lines;
  }

  // Agrupa líneas en párrafos según el espacio vertical entre ellas.
  function pdfLinesToParagraphs(lines) {
    // Eliminar números de página aislados al inicio/fin
    while (lines.length && /^\s*[-–—]?\s*\d{1,4}\s*[-–—]?\s*$/.test(lines[0].text)) lines.shift();
    while (lines.length && /^\s*[-–—]?\s*\d{1,4}\s*[-–—]?\s*$/.test(lines[lines.length - 1].text)) lines.pop();
    if (!lines.length) return [];

    // Espaciado relativo a la altura de la fuente, para no confundir líneas de
    // títulos grandes con saltos de párrafo.
    function ratio(a, b) { return (a.y - b.y) / Math.max(a.h, b.h, 1); }
    var ratios = [];
    for (var i = 1; i < lines.length; i++) {
      var g = ratio(lines[i - 1], lines[i]);
      if (g > 0) ratios.push(g);
    }
    var med = median(ratios) || 1.2;
    var hMed = median(lines.map(function (l) { return l.h; })) || 10;
    var leftMargin = median(lines.map(function (l) { return l.x; }));

    var paras = [];
    var cur = [lines[0].text];
    for (var j = 1; j < lines.length; j++) {
      var prev = lines[j - 1], ln = lines[j];
      var gap = ratio(prev, ln);
      var brk = false;
      if (gap <= 0 || gap > med * 1.4) brk = true;                        // gran espacio o cambio de columna
      else if (Math.abs(ln.h - prev.h) > hMed * 0.3) brk = true;           // cambio de tamaño (títulos)
      else if (ln.x - leftMargin > hMed * 1.2 && ln.x - prev.x > hMed * 1.2 &&
        /[.!?:»"”)]\s*$/.test(prev.text)) brk = true;                     // sangría tras fin de frase
      if (brk) { paras.push(cur.join('\n')); cur = []; }
      cur.push(ln.text);
    }
    paras.push(cur.join('\n'));
    return paras;
  }

  // Fracción de la página cubierta por imágenes (aprox., sumando áreas).
  function pdfImageCoverage(ops, OPS, pageArea) {
    var ctm = [1, 0, 0, 1, 0, 0], stack = [];
    var area = 0, count = 0;
    function mul(m, t) {
      return [
        t[0] * m[0] + t[1] * m[2], t[0] * m[1] + t[1] * m[3],
        t[2] * m[0] + t[3] * m[2], t[2] * m[1] + t[3] * m[3],
        t[4] * m[0] + t[5] * m[2] + m[4], t[4] * m[1] + t[5] * m[3] + m[5]
      ];
    }
    var fn = ops.fnArray, args = ops.argsArray;
    for (var i = 0; i < fn.length; i++) {
      var f = fn[i], a = args[i];
      if (f === OPS.save) stack.push(ctm);
      else if (f === OPS.restore) ctm = stack.pop() || ctm;
      else if (f === OPS.transform) ctm = mul(ctm, a);
      else if (f === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        if (a && Array.isArray(a[0]) && a[0].length === 6) ctm = mul(ctm, a[0]);
      } else if (f === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (f === OPS.paintImageXObject || f === OPS.paintJpegXObject || f === OPS.paintInlineImageXObject) {
        var w = 0, h = 0;
        if (f === OPS.paintInlineImageXObject) { w = a && a[0] && a[0].width; h = a && a[0] && a[0].height; }
        else { w = a && a[1]; h = a && a[2]; }
        if (w && h && (w < MIN_IMG || h < MIN_IMG)) continue; // iconos, degradados de 1 px
        count++;
        area += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
      }
    }
    if (!count) return 0;
    var cov = pageArea > 0 ? area / pageArea : 0;
    if (!isFinite(cov) || cov <= 0) cov = 0.05; // sin geometría fiable: suponer relevante
    return Math.min(1, cov);
  }

  async function renderPage(page, scale) {
    var vp1 = page.getViewport({ scale: 1 });
    scale = Math.min(scale, 2600 / Math.max(vp1.width, vp1.height));
    var vp = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    var ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  }

  async function importPdf(file, report) {
    report(1, 'Abriendo PDF…');
    var pdfjsLib = await loadPdfJs();
    var buf = await readAsArrayBuffer(file);
    var pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('El PDF está protegido con contraseña.');
      throw new Error('No se pudo abrir el PDF. Puede estar dañado.');
    }
    var OPS = pdfjsLib.OPS;
    var metaP = pdf.getMetadata().catch(function () { return null; });
    var N = pdf.numPages;
    var col = new Collector();
    var worker = null, workerFailed = false, ocrPage = 0, ocrUsed = false;
    var pages = []; // [{paras: [...], image: marker|null}]
    try {
      for (var num = 1; num <= N; num++) {
        var base = ((num - 1) / N) * 92;
        report(base, 'Leyendo página ' + num + ' de ' + N + '…');
        var page = await pdf.getPage(num);
        var tc = await page.getTextContent();
        var paras = pdfLinesToParagraphs(pdfItemsToLines(tc.items));
        var chars = paras.join('').replace(/\s+/g, '').length;
        var coverage = 0;
        try {
          var opList = await page.getOperatorList();
          var vb = page.view || [0, 0, 0, 0];
          coverage = pdfImageCoverage(opList, OPS, Math.abs((vb[2] - vb[0]) * (vb[3] - vb[1])));
        } catch (e) { coverage = 0; }
        var imageMk = null;
        var scanned = chars < 20 && coverage >= 0.15;
        var roomForImages = col.cands.length < MAX_IMAGES;
        if (scanned || (coverage >= 0.04 && roomForImages)) {
          var canvas = null;
          try { canvas = await renderPage(page, scanned ? 2 : 1.5); } catch (e) { canvas = null; }
          var addImage = !!canvas;
          if (canvas && scanned && !workerFailed) {
            try {
              if (!worker) {
                report(base, 'Cargando OCR para páginas escaneadas…');
                worker = await createOcrEngine(function (msg) {
                  report(((Math.max(ocrPage, num) - 1) / N) * 92, msg);
                });
              }
              ocrPage = num;
              report(base, 'Reconociendo texto (OCR) en la página ' + num + ' de ' + N + '…');
              var ocr = await worker.recognize(canvas, function (f) {
                report(((ocrPage - 1 + f) / N) * 92, 'Reconociendo texto (OCR) en la página ' + ocrPage + ' de ' + N + '…');
              });
              ocrUsed = true;
              var otext = normalizeText(san((ocr && ocr.text) || ''));
              if (otext.replace(/\s+/g, '').length > chars) paras = otext.split('\n\n');
              addImage = otext.replace(/\s+/g, '').length < 40;
            } catch (e) {
              workerFailed = true;
              if (worker) { try { await worker.terminate(); } catch (e2) { /* nada */ } worker = null; }
            }
          }
          if (addImage && roomForImages) {
            var c = canvas;
            imageMk = col.add(encodeSource(c, c.width, c.height, 'Página ' + num, false), 'Página ' + num, true);
          }
        }
        pages.push({ paras: paras, image: imageMk });
        if (page.cleanup) page.cleanup();
      }
    } finally {
      if (worker) { try { await worker.terminate(); } catch (e) { /* nada */ } }
    }
    var meta = await metaP;

    // Unir párrafos que continúan en la página siguiente y marcar el inicio de cada página.
    var out = [];
    var pend = '';
    function isMarkerOnly(s) { return /^\s*\d+\s*$/.test(s || ''); }
    pages.forEach(function (pg, pi) {
      var pm = pageMarker(pi);
      var first = true;
      pg.paras.forEach(function (p) {
        var last = out[out.length - 1];
        if (first && last != null && !isMarkerOnly(last) && !pend) {
          var trimmed = last.replace(/\s+$/, '');
          if (/\p{L}[-‐‑]$/u.test(trimmed) && /^\s*\p{Ll}/u.test(p)) {
            out[out.length - 1] = trimmed.slice(0, -1) + pm + p.replace(/^\s+/, '');
            first = false;
            return;
          }
          if (!/[.!?:;»"”)\]]$/.test(trimmed) && /^\s*\p{Ll}/u.test(p)) {
            out[out.length - 1] = trimmed + ' ' + pm + p.replace(/^\s+/, '');
            first = false;
            return;
          }
        }
        out.push((first ? pend + pm : '') + p);
        if (first) pend = '';
        first = false;
      });
      if (first) pend += pm; // página sin texto: su inicio es lo que venga después
      if (pg.image) {
        if (pend) { out.push(pend + pg.image); pend = ''; } else out.push(pg.image);
      }
    });
    if (pend) out.push(pend);
    if (pdf.destroy) pdf.destroy();
    var title = meta && meta.info && typeof meta.info.Title === 'string' ? normalizeParagraph(san(meta.info.Title)) : '';
    if (/^(untitled|sin título|documento\d*)$|^microsoft word - /i.test(title)) title = '';
    var res = await finish(out, col, report, { title: title || baseName(file.name), pages: N, imgBase: 95 });
    if (!hasWords(res.text)) {
      throw new Error(ocrUsed || workerFailed
        ? 'No se pudo reconocer texto en este PDF escaneado.'
        : 'Este PDF no contiene texto seleccionable (parece escaneado). Prueba a importar una captura de pantalla de sus páginas.');
    }
    res.original = { blob: file.slice(0, file.size, 'application/pdf'), type: 'pdf' };
    report(100, 'Listo');
    return res;
  }

  // ---------------------------------------------------------------- Imágenes (OCR)

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function captureTitle(d) {
    d = d || new Date();
    return 'Captura ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function importImage(blob, onProgress) {
    var safeReport = makeReporter(onProgress);
    safeReport(0, 'Cargando OCR…');
    // Progreso global: carga 0–30 %, reconocimiento 30–100 %.
    return createOcrEngine(function (msg) { safeReport(10, msg); })
      .then(function (engine) {
        safeReport(30, 'Reconociendo texto…');
        return engine.recognize(blob, function (f) {
          safeReport(Math.round(30 + f * 70), 'Reconociendo texto…');
        }).then(function (res) {
          return Promise.resolve(engine.terminate()).catch(function () {}).then(function () { return res; });
        }, function (err) {
          return Promise.resolve(engine.terminate()).catch(function () {}).then(function () { throw err; });
        });
      })
      .then(function (res) {
        safeReport(100, 'Texto reconocido');
        var raw = (res && res.text) || '';
        var text = normalizeText(san(raw));
        return {
          title: captureTitle(new Date()),
          text: ensureText(text, 'No se reconoció texto en la imagen.')
        };
      });
  }

  // ---------------------------------------------------------------- API pública

  function isSupported(file) {
    return !!kindOf(file);
  }

  function importFile(file, onProgress) {
    var report = makeReporter(onProgress);
    return Promise.resolve().then(function () {
      if (!file) throw new Error('No se seleccionó ningún archivo.');
      var kind = kindOf(file);
      if (!kind) {
        var ext = extOf(file.name);
        if (LEGACY[ext]) throw new Error(LEGACY[ext]);
        throw new Error('Formato no compatible' + (ext ? ' (.' + ext + ')' : '') + '. Usa ' + FORMATS_MSG + '.');
      }
      if (file.size === 0) throw new Error('El archivo está vacío.');
      switch (kind) {
        case 'txt': return importTxt(file);
        case 'md': return importMd(file, report);
        case 'html': return importHtml(file, report);
        case 'epub': return importEpub(file, report);
        case 'docx': return importDocx(file, report);
        case 'odf': return importOdf(file, report);
        case 'rtf': return importRtf(file, report);
        case 'fb2': return importFb2(file, report);
        case 'mobi': return importMobi(file, report);
        case 'pptx': return importPptx(file, report);
        case 'xlsx': return importXlsx(file, report);
        case 'csv': return importCsv(file, report);
        case 'subs': return importSubs(file, report);
        case 'json': return importJson(file, report);
        case 'pdf': return importPdf(file, report);
        case 'image': return importImage(file, onProgress);
      }
    });
  }

  LV.importers = {
    importFile: importFile,
    importImage: importImage,
    accept: ACCEPT,
    isSupported: isSupported,
    formats: FORMATS_MSG,
    // Utilidades expuestas por si otros módulos las necesitan.
    normalizeText: normalizeText
  };
})();
