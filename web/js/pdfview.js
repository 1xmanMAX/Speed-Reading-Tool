/* pdfview.js — "Vista original": visor ligero de PDF (páginas reales, con su maquetación e imágenes).
 *
 * API:
 *   LV.pdfview.open(container, blob, { page, onPageChange, onClose })
 *     -> Promise<{ goTo(page, smooth), destroy(), get page() }>
 *
 * - Carga pdf.js 3.11.174 bajo demanda (reutiliza window.pdfjsLib si importers.js ya lo cargó).
 * - Renderizado perezoso con IntersectionObserver; como mucho ~8 páginas con canvas en memoria.
 * - Capa de texto seleccionable, zoom (botones, Ctrl+rueda, teclas + / -), ajuste al ancho,
 *   inversión de colores para lectura nocturna y teclado (RePág/AvPág/Inicio/Fin/Esc).
 */
(function () {
  'use strict';

  var LV = window.LV = window.LV || {};

  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var CSS_UNITS = 96 / 72;          // escala que corresponde a "100 %"
  var MAX_FIT_WIDTH = 900;          // ancho máximo al ajustar (px CSS)
  var MAX_RENDERED = 8;             // páginas con canvas en memoria
  var MAX_CONCURRENT = 2;           // renders simultáneos
  var MAX_CANVAS_PIXELS = 16e6;     // límite de píxeles por canvas
  var MIN_SCALE = 0.25 * CSS_UNITS;
  var MAX_SCALE = 5 * CSS_UNITS;
  var SIDE_PAD = 16;
  var INVERT_KEY = 'lv.pdfview.invert';

  // ---------------------------------------------------------------- carga de pdf.js

  var loadPromise = null;

  function setupLib(lib) {
    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
    }
    return lib;
  }

  function loadPdfJs() {
    if (window.pdfjsLib && window.pdfjsLib.getDocument) return Promise.resolve(setupLib(window.pdfjsLib));
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + PDFJS_URL + '"]');
      var script = existing || document.createElement('script');
      function fail() {
        if (script.parentNode) script.parentNode.removeChild(script);
        loadPromise = null;
        var err = new Error('No se pudo cargar el visor de PDF. Revisa tu conexión.');
        err.pvUser = true;
        reject(err);
      }
      script.addEventListener('load', function () {
        if (window.pdfjsLib && window.pdfjsLib.getDocument) resolve(setupLib(window.pdfjsLib));
        else fail();
      });
      script.addEventListener('error', fail);
      if (!existing) {
        script.src = PDFJS_URL;
        script.async = true;
        script.crossOrigin = 'anonymous';
        document.head.appendChild(script);
      }
    });
    return loadPromise;
  }

  // ---------------------------------------------------------------- utilidades

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  var ICONS = {
    minus: svg('<path d="M5 12h14"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    fit: svg('<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>'),
    invert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>')
  };

  function readInvert() {
    try { return localStorage.getItem(INVERT_KEY) === '1'; } catch (e) { return false; }
  }
  function writeInvert(v) {
    try { localStorage.setItem(INVERT_KEY, v ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
  }

  function isCancel(err) {
    return err && (err.name === 'RenderingCancelledException' || err.name === 'AbortException');
  }

  // ---------------------------------------------------------------- visor

  function open(container, blob, opts) {
    opts = opts || {};
    if (!container) return Promise.reject(new Error('Falta el contenedor del visor.'));
    if (!blob) return Promise.reject(new Error('No hay ningún PDF que mostrar.'));

    container.innerHTML = '';
    container.classList.add('pv');
    var loading = el('div', 'pv-status');
    loading.innerHTML = '<span class="pv-spinner" aria-hidden="true"></span><span>Cargando PDF…</span>';
    container.appendChild(loading);

    var lib = null;

    function cleanupOnError(err) {
      container.innerHTML = '';
      container.classList.remove('pv');
      if (err && err.pvUser) throw err;
      throw new Error(err && err.name === 'PasswordException'
        ? 'Este PDF está protegido con contraseña.'
        : 'No se pudo abrir el PDF. Puede que el archivo esté dañado.');
    }

    return loadPdfJs()
      .then(function (l) {
        lib = l;
        return blob.arrayBuffer();
      })
      .then(function (buf) {
        return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
      })
      .then(function (pdfDoc) {
        var nums = [];
        for (var i = 1; i <= pdfDoc.numPages; i++) nums.push(i);
        return Promise.all(nums.map(function (n) {
          return pdfDoc.getPage(n).then(function (p) {
            var vp = p.getViewport({ scale: 1 });
            return { w: vp.width, h: vp.height };
          }, function () { return null; });
        })).then(function (sizes) {
          return { doc: pdfDoc, sizes: sizes };
        });
      })
      .then(function (r) { return createViewer(container, lib, r.doc, r.sizes, opts); }, cleanupOnError);
  }

  function createViewer(container, lib, pdfDoc, sizes, opts) {
    var numPages = pdfDoc.numPages;
    var fallback = sizes[0] || { w: 612, h: 792 };
    var destroyed = false;
    var scale = CSS_UNITS;
    var fitMode = true;
    var current = 1;
    var reportedPage = 0;
    var inverted = readInvert();
    var visible = new Set();
    var rendered = [];            // páginas con canvas, en orden de uso
    var active = 0;
    var tops = [];
    var timers = { report: 0, rerender: 0, scrollRaf: 0 };

    // --- DOM
    container.innerHTML = '';
    var root = el('div', 'pv-root' + (inverted ? ' pv-invert' : ''));
    var scroller = el('div', 'pv-scroll', { tabindex: '0', role: 'document', 'aria-label': 'Vista original del PDF' });
    var pagesEl = el('div', 'pv-pages');
    scroller.appendChild(pagesEl);

    var bar = el('div', 'pv-bar', { role: 'toolbar', 'aria-label': 'Controles del PDF' });
    var pageGroup = el('label', 'pv-pagebox');
    var pageInput = el('input', 'pv-pageinput', {
      type: 'text', inputmode: 'numeric', 'aria-label': 'Página actual', autocomplete: 'off', spellcheck: 'false'
    });
    var pageTotal = el('span', 'pv-total');
    pageTotal.textContent = '/ ' + numPages;
    pageGroup.appendChild(pageInput);
    pageGroup.appendChild(pageTotal);

    function btn(icon, label, cls) {
      var b = el('button', 'pv-btn' + (cls ? ' ' + cls : ''), { type: 'button', title: label, 'aria-label': label });
      b.innerHTML = icon;
      return b;
    }
    var bOut = btn(ICONS.minus, 'Alejar');
    var zoomLabel = el('span', 'pv-zoom', { 'aria-live': 'polite' });
    var bIn = btn(ICONS.plus, 'Acercar');
    var bFit = btn(ICONS.fit, 'Ajustar al ancho', 'pv-fit');
    var bInvert = btn(ICONS.invert, 'Invertir colores (lectura nocturna)');
    var bClose = btn(ICONS.close, 'Cerrar vista original', 'pv-close');

    function sep() { return el('span', 'pv-sep', { 'aria-hidden': 'true' }); }
    [pageGroup, sep(), bOut, zoomLabel, bIn, bFit, sep(), bInvert, bClose].forEach(function (n) { bar.appendChild(n); });

    root.appendChild(scroller);
    root.appendChild(bar);
    container.appendChild(root);

    // --- páginas
    var pages = [];
    for (var n = 1; n <= numPages; n++) {
      var s = sizes[n - 1] || fallback;
      var pageEl = el('div', 'pv-page', { 'data-page': String(n), 'aria-label': 'Página ' + n });
      pagesEl.appendChild(pageEl);
      pages.push({
        num: n, w1: s.w, h1: s.h, el: pageEl,
        canvas: null, textEl: null, renderedScale: 0,
        task: null, textTask: null, rendering: false
      });
    }

    // --- tamaño / zoom
    function fitScale() {
      var avail = Math.max(120, scroller.clientWidth - SIDE_PAD * 2);
      return clamp(Math.min(MAX_FIT_WIDTH, avail) / fallback.w, MIN_SCALE, MAX_SCALE);
    }

    function measureTops() {
      tops = pages.map(function (p) { return p.el.offsetTop; });
    }

    // Punto de anclaje: página bajo la coordenada y (relativa al scroller) y fracción dentro de ella.
    function anchorAt(y, x) {
      var contentY = scroller.scrollTop + y;
      var i = pageIndexAt(contentY);
      var p = pages[i];
      var h = p.el.offsetHeight || 1;
      return {
        i: i, y: y, frac: (contentY - tops[i]) / h,
        x: x, fracX: scroller.scrollWidth ? (scroller.scrollLeft + x) / scroller.scrollWidth : 0
      };
    }

    function applySizes() {
      pages.forEach(function (p) {
        p.el.style.width = Math.floor(p.w1 * scale) + 'px';
        p.el.style.height = Math.floor(p.h1 * scale) + 'px';
        if (p.textEl) p.textEl.style.setProperty('--scale-factor', String(scale));
      });
      measureTops();
      zoomLabel.textContent = Math.round(scale / CSS_UNITS * 100) + '%';
      bFit.classList.toggle('pv-on', fitMode);
    }

    function setScale(next, anchorY, anchorX) {
      next = clamp(next, MIN_SCALE, MAX_SCALE);
      if (Math.abs(next - scale) < 1e-4) return;
      var ay = anchorY == null ? 0 : anchorY;
      var ax = anchorX == null ? scroller.clientWidth / 2 : anchorX;
      var a = anchorAt(ay, ax);
      scale = next;
      // Cancelar renders obsoletos; se repintan tras una pausa breve.
      pages.forEach(function (p) { cancelRender(p); });
      applySizes();
      scroller.scrollTop = tops[a.i] + a.frac * pages[a.i].el.offsetHeight - a.y;
      scroller.scrollLeft = a.fracX * scroller.scrollWidth - a.x;
      clearTimeout(timers.rerender);
      timers.rerender = setTimeout(pump, 180);
      updateCurrent();
    }

    function zoomBy(factor, anchorY, anchorX) {
      fitMode = false;
      setScale(scale * factor, anchorY, anchorX);
      bFit.classList.toggle('pv-on', fitMode);
    }

    function fitWidth() {
      fitMode = true;
      setScale(fitScale(), 0);
      bFit.classList.toggle('pv-on', true);
    }

    // --- render
    function cancelRender(p) {
      if (p.task) { try { p.task.cancel(); } catch (e) { /* ya terminado */ } }
      if (p.textTask && p.textTask.cancel) { try { p.textTask.cancel(); } catch (e) { /* ya terminado */ } }
      p.task = null;
      p.textTask = null;
    }

    function freePage(p) {
      cancelRender(p);
      if (p.canvas) {
        p.canvas.width = 0;
        p.canvas.height = 0;
        p.canvas.remove();
        p.canvas = null;
      }
      if (p.textEl) { p.textEl.remove(); p.textEl = null; }
      p.renderedScale = 0;
      p.el.classList.remove('pv-ready');
      var k = rendered.indexOf(p);
      if (k >= 0) rendered.splice(k, 1);
    }

    function touch(p) {
      var k = rendered.indexOf(p);
      if (k >= 0) rendered.splice(k, 1);
      rendered.push(p);
      if (rendered.length <= MAX_RENDERED) return;
      // Libera las más lejanas de la página actual que no estén visibles.
      var candidates = rendered.filter(function (q) { return !visible.has(q.num) && !q.rendering; });
      candidates.sort(function (a, b) { return Math.abs(b.num - current) - Math.abs(a.num - current); });
      while (rendered.length > MAX_RENDERED && candidates.length) freePage(candidates.shift());
    }

    function needsRender(p) {
      return !p.rendering && Math.abs(p.renderedScale - scale) > 1e-4;
    }

    function pump() {
      if (destroyed) return;
      while (active < MAX_CONCURRENT) {
        var best = null;
        visible.forEach(function (num) {
          var p = pages[num - 1];
          if (!needsRender(p)) return;
          if (!best || Math.abs(num - current) < Math.abs(best.num - current)) best = p;
        });
        if (!best) return;
        renderPage(best);
      }
    }

    function renderPage(p) {
      p.rendering = true;
      active++;
      var renderScale = scale;
      function done() {
        p.rendering = false;
        active--;
        if (!destroyed) pump();
      }
      pdfDoc.getPage(p.num).then(function (page) {
        if (destroyed) return;
        var vp = page.getViewport({ scale: renderScale });
        var out = Math.min(window.devicePixelRatio || 1, 2);
        var px = vp.width * vp.height * out * out;
        if (px > MAX_CANVAS_PIXELS) out = Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height));
        var canvas = el('canvas', 'pv-canvas');
        canvas.width = Math.floor(vp.width * out);
        canvas.height = Math.floor(vp.height * out);
        var ctx = canvas.getContext('2d', { alpha: false });
        var task = page.render({
          canvasContext: ctx,
          viewport: vp,
          transform: out !== 1 ? [out, 0, 0, out, 0, 0] : null
        });
        p.task = task;
        return task.promise.then(function () {
          if (destroyed || p.task !== task) { canvas.width = 0; return; }
          p.task = null;
          if (p.canvas) { p.canvas.width = 0; p.canvas.remove(); }
          p.canvas = canvas;
          p.el.insertBefore(canvas, p.el.firstChild);
          p.el.classList.add('pv-ready');
          p.renderedScale = renderScale;
          touch(p);
          renderText(p, page, vp);
        });
      }).catch(function (err) {
        if (!isCancel(err) && !destroyed && window.console) console.warn('pdfview: error al dibujar la página', p.num, err);
      }).then(done);
    }

    function renderText(p, page, vp) {
      if (typeof lib.renderTextLayer !== 'function') return;
      page.getTextContent().then(function (tc) {
        if (destroyed || !p.canvas || p.renderedScale !== vp.scale) return;
        var layer = el('div', 'pv-text');
        layer.style.setProperty('--scale-factor', String(vp.scale));
        p.el.appendChild(layer);   // pdf.js lee --scale-factor del estilo calculado
        var task = lib.renderTextLayer({ textContentSource: tc, container: layer, viewport: vp, textDivs: [] });
        p.textTask = task;
        return task.promise.then(function () {
          if (destroyed || p.textTask !== task || !p.canvas) { layer.remove(); return; }
          p.textTask = null;
          if (p.textEl) p.textEl.remove();
          p.textEl = layer;
          layer.style.setProperty('--scale-factor', String(scale));
        }, function (err) { layer.remove(); throw err; });
      }).catch(function (err) {
        if (!isCancel(err) && !destroyed && window.console) console.warn('pdfview: capa de texto', p.num, err);
      });
    }

    // --- observadores
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var num = +e.target.getAttribute('data-page');
        if (e.isIntersecting) visible.add(num); else visible.delete(num);
      });
      pump();
    }, { root: scroller, rootMargin: '100% 0px 100% 0px' });
    pages.forEach(function (p) { io.observe(p.el); });

    var lastWidth = 0;
    var ro = new ResizeObserver(function () {
      var w = scroller.clientWidth;
      if (!w || w === lastWidth) return;
      lastWidth = w;
      if (fitMode) {
        var a = anchorAt(0, 0);
        var target = fitScale();
        if (Math.abs(target - scale) > 1e-3) {
          scale = target;
          pages.forEach(function (p) { cancelRender(p); });
          applySizes();
          scroller.scrollTop = tops[a.i] + a.frac * pages[a.i].el.offsetHeight;
          clearTimeout(timers.rerender);
          timers.rerender = setTimeout(pump, 180);
        } else {
          measureTops();
        }
      } else {
        measureTops();
      }
    });
    ro.observe(scroller);

    // --- página actual
    function pageIndexAt(contentY) {
      var lo = 0, hi = tops.length - 1, ans = 0;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (tops[mid] <= contentY) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans;
    }

    function updateCurrent() {
      var line = scroller.scrollTop + scroller.clientHeight / 3;
      var atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      var next = atBottom && scroller.scrollTop > 0 ? numPages : pageIndexAt(line) + 1;
      if (next !== current) {
        current = next;
        if (document.activeElement !== pageInput) pageInput.value = String(current);
      }
      clearTimeout(timers.report);
      timers.report = setTimeout(function () {
        if (destroyed || reportedPage === current) return;
        reportedPage = current;
        if (typeof opts.onPageChange === 'function') opts.onPageChange(current);
      }, 200);
    }

    function onScroll() {
      if (timers.scrollRaf) return;
      timers.scrollRaf = requestAnimationFrame(function () {
        timers.scrollRaf = 0;
        if (!destroyed) updateCurrent();
      });
    }
    scroller.addEventListener('scroll', onScroll, { passive: true });

    function goTo(page, smooth) {
      if (destroyed) return;
      var i = clamp(Math.round(+page) || 1, 1, numPages) - 1;
      var padTop = parseFloat(getComputedStyle(pagesEl).paddingTop) || 0;
      var top = Math.max(0, tops[i] - Math.min(padTop, 72));
      if (i === 0) top = 0;
      if (smooth && scroller.scrollTo) scroller.scrollTo({ top: top, behavior: 'smooth' });
      else scroller.scrollTop = top;
      current = i + 1;
      pageInput.value = String(current);
      updateCurrent();
    }

    // --- eventos de la barra
    function close() { if (!destroyed && typeof opts.onClose === 'function') opts.onClose(); }

    bOut.addEventListener('click', function () { zoomBy(1 / 1.15); });
    bIn.addEventListener('click', function () { zoomBy(1.15); });
    bFit.addEventListener('click', fitWidth);
    bInvert.addEventListener('click', function () {
      inverted = !inverted;
      root.classList.toggle('pv-invert', inverted);
      bInvert.classList.toggle('pv-on', inverted);
      bInvert.setAttribute('aria-pressed', String(inverted));
      writeInvert(inverted);
    });
    bClose.addEventListener('click', close);

    pageInput.addEventListener('focus', function () { pageInput.select(); });
    pageInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var v = parseInt(pageInput.value, 10);
        if (v) goTo(v, false);
        else pageInput.value = String(current);
        scroller.focus({ preventScroll: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        pageInput.value = String(current);
        scroller.focus({ preventScroll: true });
      }
    });
    pageInput.addEventListener('blur', function () { pageInput.value = String(current); });

    scroller.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var r = scroller.getBoundingClientRect();
      var d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(Math.exp(-clamp(d, -100, 100) * 0.0025), e.clientY - r.top, e.clientX - r.left);
    }, { passive: false });

    root.addEventListener('keydown', function (e) {
      if (e.target === pageInput || e.altKey) return;
      var k = e.key;
      var mod = e.ctrlKey || e.metaKey;
      if (k === 'Escape') { e.preventDefault(); close(); return; }
      if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1.15); return; }
      if (k === '-' || k === '_') { e.preventDefault(); zoomBy(1 / 1.15); return; }
      if (k === '0' && mod) { e.preventDefault(); fitWidth(); return; }
      if (mod) return;
      if (k === 'PageDown') { e.preventDefault(); goTo(current + 1); }
      else if (k === 'PageUp') { e.preventDefault(); goTo(current - 1); }
      else if (k === 'Home') { e.preventDefault(); goTo(1); }
      else if (k === 'End') { e.preventDefault(); goTo(numPages); }
    });

    // --- inicio
    if (inverted) { bInvert.classList.add('pv-on'); bInvert.setAttribute('aria-pressed', 'true'); }
    else bInvert.setAttribute('aria-pressed', 'false');
    lastWidth = scroller.clientWidth;
    scale = fitScale();
    applySizes();
    pageInput.value = '1';
    var startPage = clamp(Math.round(+opts.page) || 1, 1, numPages);
    reportedPage = startPage;          // no notificar la página inicial
    goTo(startPage, false);
    try { scroller.focus({ preventScroll: true }); } catch (e) { /* sin foco */ }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timers.report);
      clearTimeout(timers.rerender);
      if (timers.scrollRaf) cancelAnimationFrame(timers.scrollRaf);
      pages.forEach(freePage);
      io.disconnect();
      ro.disconnect();
      visible.clear();
      rendered.length = 0;
      try { pdfDoc.destroy(); } catch (e) { /* ignorar */ }
      container.innerHTML = '';
      container.classList.remove('pv');
    }

    return {
      goTo: goTo,
      destroy: destroy,
      get page() { return current; }
    };
  }

  LV.pdfview = { open: open, load: loadPdfJs };
})();
