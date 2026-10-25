/* importers.js — convierte archivos (txt, md, html, epub, docx, pdf, imágenes) en texto plano.
 * Script clásico (no módulo). Expone window.LV.importers.
 *
 * Salida: { title, text } donde text son párrafos separados por "\n\n".
 */
(function () {
  'use strict';

  window.LV = window.LV || {};
  var LV = window.LV;

  var CDN = {
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js'
  };

  var EXT = {
    txt: 'txt', text: 'txt',
    md: 'md', markdown: 'md', mdown: 'md', mkd: 'md',
    html: 'html', htm: 'html', xhtml: 'html',
    epub: 'epub',
    docx: 'docx',
    pdf: 'pdf',
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', bmp: 'image', gif: 'image'
  };

  var MIME = {
    'text/plain': 'txt',
    'text/markdown': 'md', 'text/x-markdown': 'md',
    'text/html': 'html', 'application/xhtml+xml': 'html',
    'application/epub+zip': 'epub',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/pdf': 'pdf',
    'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image',
    'image/bmp': 'image', 'image/gif': 'image'
  };

  var ACCEPT = '.txt,.md,.markdown,.html,.htm,.xhtml,.epub,.docx,.pdf,.png,.jpg,.jpeg,.webp,' +
    'text/plain,text/markdown,text/html,application/epub+zip,' +
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/pdf,image/png,image/jpeg,image/webp';

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
      .replace(/\u00AD/g, '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000\t\f\v]/g, ' ');
  }

  // Une palabras cortadas con guion al final de línea: "pala-\nbra" -> "palabra".
  // Solo cuando la siguiente parte empieza en minúscula (evita "Norte-\nSur").
  function joinHyphens(s) {
    return s
      .replace(/(\p{L})[-\u2010\u2011]\s*\n\s*(\p{Ll})/gu, '$1$2')
      .replace(/(\p{L})[-\u2010\u2011]\s*\n\s*(\p{Lu}|\d)/gu, '$1-$2'); // compuestos: "Norte-Sur"
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

  function joinParagraphs(paras) {
    return paras.map(normalizeParagraph).filter(Boolean).join('\n\n');
  }

  function ensureText(text, emptyMsg) {
    if (!text || !text.trim()) {
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
    return s.replace(/^\uFEFF/, '');
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
    input: 1, math: 1, video: 1, audio: 1
  };

  function domToParagraphs(root) {
    var paras = [];
    var buf = '';
    function flush() {
      var t = buf.replace(/\s+/g, ' ').trim();
      if (t) paras.push(t);
      buf = '';
    }
    function walk(node) {
      if (node.nodeType === 3 || node.nodeType === 4) { // texto / CDATA
        buf += node.nodeValue;
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = (node.localName || node.nodeName || '').toLowerCase();
      if (SKIP_TAGS[tag]) return;
      if (node.getAttribute && (node.getAttribute('hidden') != null || node.getAttribute('aria-hidden') === 'true')) return;
      var epubType = node.getAttribute && (node.getAttribute('epub:type') || '');
      if (/\b(pagebreak|footnote|endnote|noteref)\b/.test(epubType) && tag !== 'a') return;
      if (tag === 'br') { buf += ' '; return; }
      if (tag === 'img') return; // las imágenes se omiten
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

  function firstByLocalName(doc, name) {
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if ((all[i].localName || '').toLowerCase() === name) return all[i];
    }
    return null;
  }

  function textOf(el) {
    return el ? normalizeParagraph(el.textContent || '') : '';
  }

  // ---------------------------------------------------------------- TXT

  function importTxt(file) {
    return readAsArrayBuffer(file).then(function (buf) {
      var text = normalizeText(decodeBytes(buf));
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

  function mdToParagraphs(src) {
    var lines = cleanInline(src).replace(/\r\n?/g, '\n').split('\n');
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
      cur.push(stripInlineMd(line));
    }
    flush();
    return { title: title, paras: paras };
  }

  function importMd(file) {
    return readAsArrayBuffer(file).then(function (buf) {
      var res = mdToParagraphs(decodeBytes(buf));
      var text = joinParagraphs(res.paras);
      return { title: res.title || baseName(file.name), text: ensureText(text) };
    });
  }

  // ---------------------------------------------------------------- HTML

  function htmlStringToResult(str, fallbackTitle) {
    var doc = parseMarkup(str, false);
    var title = textOf(doc.querySelector('title'));
    var h1 = doc.querySelector('h1');
    if (!title && h1) title = textOf(h1);
    var root = doc.querySelector('article') || doc.querySelector('main') || doc.body || doc.documentElement;
    // Si <article>/<main> es muy pequeño respecto al body, usar el body.
    if (doc.body && root !== doc.body && (root.textContent || '').length < (doc.body.textContent || '').length * 0.3) {
      root = doc.body;
    }
    var text = joinParagraphs(domToParagraphs(root));
    return { title: title || fallbackTitle, text: ensureText(text) };
  }

  function importHtml(file) {
    return readAsArrayBuffer(file).then(function (buf) {
      return htmlStringToResult(decodeBytes(buf), baseName(file.name));
    });
  }

  // ---------------------------------------------------------------- EPUB

  function resolvePath(baseDir, href) {
    var path = href.split('#')[0].split('?')[0];
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

  function zipFile(zip, path) {
    var f = zip.file(path);
    if (f) return f;
    var lower = path.toLowerCase();
    var found = null;
    zip.forEach(function (p, entry) { if (!found && p.toLowerCase() === lower) found = entry; });
    return found;
  }

  function importEpub(file) {
    return loadScript(CDN.jszip, 'JSZip', 'No se pudo cargar el lector de EPUB. Revisa tu conexión.')
      .then(function (JSZip) { return readAsArrayBuffer(file).then(function (buf) { return JSZip.loadAsync(buf); }); })
      .catch(function (e) {
        if (/conexi\u00F3n/.test(e.message)) throw e;
        throw new Error('El archivo EPUB está dañado o no es válido.');
      })
      .then(function (zip) {
        var container = zipFile(zip, 'META-INF/container.xml');
        var opfPathP = container
          ? container.async('string').then(function (xml) {
            var d = new DOMParser().parseFromString(xml, 'application/xml');
            var rf = firstByLocalName(d, 'rootfile');
            return rf ? rf.getAttribute('full-path') : null;
          })
          : Promise.resolve(null);
        return opfPathP.then(function (opfPath) {
          if (!opfPath) {
            zip.forEach(function (p) { if (!opfPath && /\.opf$/i.test(p)) opfPath = p; });
          }
          var opfEntry = opfPath && zipFile(zip, opfPath);
          if (!opfEntry) throw new Error('El archivo EPUB no es válido (falta el índice del libro).');
          return opfEntry.async('string').then(function (opfXml) {
            var opf = new DOMParser().parseFromString(opfXml, 'application/xml');
            var baseDir = opfPath.indexOf('/') >= 0 ? opfPath.replace(/[^/]*$/, '') : '';
            var titleEl = firstByLocalName(opf, 'title');
            var title = textOf(titleEl);

            var manifest = {};
            Array.prototype.forEach.call(opf.getElementsByTagNameNS('*', 'item'), function (it) {
              manifest[it.getAttribute('id')] = {
                href: it.getAttribute('href') || '',
                type: it.getAttribute('media-type') || '',
                props: it.getAttribute('properties') || ''
              };
            });
            var hrefs = [];
            Array.prototype.forEach.call(opf.getElementsByTagNameNS('*', 'itemref'), function (ref) {
              if (ref.getAttribute('linear') === 'no') return;
              var it = manifest[ref.getAttribute('idref')];
              if (!it || /\bnav\b/.test(it.props)) return;
              if (it.type && !/html|xml/.test(it.type)) return;
              hrefs.push(resolvePath(baseDir, it.href));
            });
            if (!hrefs.length) throw new Error('El EPUB no contiene capítulos legibles.');

            return Promise.all(hrefs.map(function (p) {
              var e = zipFile(zip, p);
              return e ? e.async('string') : Promise.resolve('');
            })).then(function (docs) {
              var paras = [];
              docs.forEach(function (src) {
                if (!src) return;
                var d = parseMarkup(src, true);
                var body = d.body || firstByLocalName(d, 'body') || d.documentElement;
                paras = paras.concat(domToParagraphs(body));
              });
              var text = joinParagraphs(paras);
              return { title: title || baseName(file.name), text: ensureText(text, 'El EPUB no contiene texto legible (¿quizá solo imágenes?).') };
            });
          });
        });
      });
  }

  // ---------------------------------------------------------------- DOCX (Word)

  // Título desde docProps/core.xml (<dc:title>). Opcional: si falla, devuelve ''.
  function docxTitle(buf) {
    return loadScript(CDN.jszip, 'JSZip', 'No se pudo cargar JSZip.')
      .then(function (JSZip) { return JSZip.loadAsync(buf); })
      .then(function (zip) {
        var core = zipFile(zip, 'docProps/core.xml');
        return core ? core.async('string') : '';
      })
      .then(function (xml) {
        if (!xml) return '';
        var d = new DOMParser().parseFromString(xml, 'application/xml');
        var t = textOf(firstByLocalName(d, 'title'));
        if (/^(untitled|sin título|documento\d*|document\d*|título|title)$/i.test(t)) t = '';
        return t;
      })
      .catch(function () { return ''; });
  }

  function importDocx(file) {
    return readAsArrayBuffer(file).then(function (buf) {
      var titleP = docxTitle(buf);
      var textP = loadScript(CDN.mammoth, 'mammoth', 'No se pudo cargar el lector de Word (DOCX). Revisa tu conexión.')
        .then(function (mammoth) {
          return Promise.resolve(mammoth.convertToHtml({ arrayBuffer: buf }, {
            // Las imágenes no se usan: evitar convertirlas a base64.
            convertImage: mammoth.images.imgElement(function () { return Promise.resolve({ src: '' }); })
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
          return joinParagraphs(domToParagraphs(doc.body));
        });
      return Promise.all([textP, titleP]).then(function (r) {
        return {
          title: r[1] || baseName(file.name),
          text: ensureText(r[0], 'El documento de Word no contiene texto legible.')
        };
      });
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
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      var x = tr[4], y = tr[5];
      var h = Math.abs(it.height || tr[3] || Math.hypot(tr[2], tr[3])) || 10;
      if (it.str === '') {
        if (it.hasEOL) forceNew = true;
        continue;
      }
      var sameLine = cur && !forceNew && Math.abs(y - cur.y) <= Math.max(cur.h, h) * 0.5;
      if (!sameLine) {
        push();
        cur = { text: it.str, y: y, x: x, h: h, endX: x + (it.width || 0) };
      } else {
        var gap = x - cur.endX;
        if (gap > h * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
        cur.text += it.str;
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
    while (lines.length && /^\s*[-\u2013\u2014]?\s*\d{1,4}\s*[-\u2013\u2014]?\s*$/.test(lines[0].text)) lines.shift();
    while (lines.length && /^\s*[-\u2013\u2014]?\s*\d{1,4}\s*[-\u2013\u2014]?\s*$/.test(lines[lines.length - 1].text)) lines.pop();
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
        /[.!?:\u00BB"\u201D)]\s*$/.test(prev.text)) brk = true;                     // sangría tras fin de frase
      if (brk) { paras.push(cur.join('\n')); cur = []; }
      cur.push(ln.text);
    }
    paras.push(cur.join('\n'));
    return paras;
  }

  function importPdf(file) {
    return loadPdfJs().then(function (pdfjsLib) {
      return readAsArrayBuffer(file).then(function (buf) {
        return pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
      }).catch(function (e) {
        if (e && e.name === 'PasswordException') throw new Error('El PDF está protegido con contraseña.');
        throw new Error('No se pudo abrir el PDF. Puede estar dañado.');
      }).then(function (pdf) {
        var metaP = pdf.getMetadata().catch(function () { return null; });
        var pages = [];
        var chain = Promise.resolve();
        for (var n = 1; n <= pdf.numPages; n++) {
          (function (num) {
            chain = chain.then(function () {
              return pdf.getPage(num).then(function (page) {
                return page.getTextContent().then(function (tc) {
                  pages.push(pdfLinesToParagraphs(pdfItemsToLines(tc.items)));
                  if (page.cleanup) page.cleanup();
                });
              });
            });
          })(n);
        }
        return Promise.all([chain, metaP]).then(function (r) {
          var meta = r[1];
          // Unir párrafos que continúan en la página siguiente.
          var paras = [];
          pages.forEach(function (pp) {
            pp.forEach(function (p, idx) {
              var last = paras[paras.length - 1];
              if (idx === 0 && last != null) {
                var trimmed = last.replace(/\s+$/, '');
                if (/\p{L}[-\u2010\u2011]$/u.test(trimmed) && /^\s*\p{Ll}/u.test(p)) {
                  paras[paras.length - 1] = trimmed + '\n' + p; // joinHyphens lo unirá
                  return;
                }
                if (!/[.!?:;\u00BB"\u201D)\]]$/.test(trimmed) && /^\s*\p{Ll}/u.test(p)) {
                  paras[paras.length - 1] = trimmed + ' ' + p;
                  return;
                }
              }
              paras.push(p);
            });
          });
          if (pdf.destroy) pdf.destroy();
          var title = meta && meta.info && typeof meta.info.Title === 'string' ? normalizeParagraph(meta.info.Title) : '';
          if (/^(untitled|sin t\u00EDtulo|documento\d*)$|^microsoft word - /i.test(title)) title = '';
          var text = joinParagraphs(paras);
          return {
            title: title || baseName(file.name),
            text: ensureText(text, 'Este PDF no contiene texto seleccionable (parece escaneado). Prueba a importar una captura de pantalla de sus páginas.')
          };
        });
      });
    });
  }

  // ---------------------------------------------------------------- Imágenes (OCR)

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function captureTitle(d) {
    d = d || new Date();
    return 'Captura ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

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

  function importImage(blob, onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    var safeReport = function (pct, msg) { try { report(pct, msg); } catch (e) { /* ignorar */ } };
    safeReport(0, 'Cargando OCR…');
    return loadScript(CDN.tesseract, 'Tesseract', 'No se pudo cargar el reconocimiento de texto (OCR). Revisa tu conexión.')
      .then(function (Tesseract) {
        // Progreso global: carga 0–30 %, reconocimiento 30–100 %.
        var logger = function (m) {
          if (!m) return;
          var p = typeof m.progress === 'number' ? m.progress : 0;
          var pct = m.status === 'recognizing text' ? 30 + p * 70 : Math.min(30, p * 30);
          safeReport(Math.round(pct), OCR_STATUS[m.status] || 'Procesando imagen…');
        };
        return Promise.resolve(Tesseract.createWorker('spa+eng', 1, { logger: logger }))
          .catch(function () {
            throw new Error('No se pudo iniciar el OCR. Revisa tu conexión.');
          })
          .then(function (worker) {
            return worker.recognize(blob).then(function (res) {
              return res;
            }, function () {
              throw new Error('No se pudo leer la imagen. Prueba con otro formato (PNG o JPG).');
            }).then(function (res) {
              return Promise.resolve(worker.terminate()).catch(function () {}).then(function () { return res; });
            }, function (err) {
              return Promise.resolve(worker.terminate()).catch(function () {}).then(function () { throw err; });
            });
          });
      })
      .then(function (res) {
        safeReport(100, 'Texto reconocido');
        var raw = (res && res.data && res.data.text) || '';
        var text = normalizeText(raw);
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
    return Promise.resolve().then(function () {
      if (!file) throw new Error('No se seleccionó ningún archivo.');
      var kind = kindOf(file);
      if (!kind) {
        var ext = extOf(file.name);
        if (ext === 'doc') {
          throw new Error('Los documentos .doc antiguos no son compatibles. Guárdalo como .docx o PDF desde Word.');
        }
        throw new Error('Formato no compatible' + (ext ? ' (.' + ext + ')' : '') +
          '. Usa TXT, Markdown, HTML, EPUB, Word (DOCX), PDF o una imagen (PNG, JPG, WEBP).');
      }
      if (file.size === 0) throw new Error('El archivo está vacío.');
      switch (kind) {
        case 'txt': return importTxt(file);
        case 'md': return importMd(file);
        case 'html': return importHtml(file);
        case 'epub': return importEpub(file);
        case 'docx': return importDocx(file);
        case 'pdf': return importPdf(file);
        case 'image': return importImage(file, onProgress);
      }
    });
  }

  LV.importers = {
    importFile: importFile,
    importImage: importImage,
    accept: ACCEPT,
    isSupported: isSupported,
    // Utilidades expuestas por si otros módulos las necesitan.
    normalizeText: normalizeText
  };
})();
