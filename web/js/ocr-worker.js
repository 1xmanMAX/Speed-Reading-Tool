/* Lectura Veloz — Web Worker del OCR Indra.
 * Carga onnxruntime-web y los modelos de Indra (se guardan en la caché del
 * navegador tras la primera descarga) y lee páginas sin bloquear la interfaz.
 *
 * Mensajes de entrada:  { id, type: 'init' } | { id, type: 'read', page: { width, height, data } }
 * Mensajes de salida:   { id, type: 'progress', loaded, total, stage, frac }
 *                       { id, type: 'done', result } | { id, type: 'error', message }
 */
/* global ort, IndraOCR */
'use strict';

var ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
var MODEL_BASE = 'https://huggingface.co/datalab-to/indra-ocr/resolve/v1.1.0/';
var MODEL_CACHE = 'lv-indra-v1.1.0';
// Tamaños aproximados para la barra de progreso (bytes).
var SIZES = { 'det.onnx': 389948, 'rec.onnx': 5042161, 'order.onnx': 2973138, 'orient.onnx': 371802, 'meta.json': 211869 };

var ocrPromise = null;

function post(msg) { self.postMessage(msg); }

async function fetchModel(name, onBytes) {
  var url = MODEL_BASE + name;
  var cache = null;
  try { cache = await caches.open(MODEL_CACHE); } catch (e) { cache = null; }
  if (cache) {
    var hit = await cache.match(url);
    if (hit) {
      var buf = await hit.arrayBuffer();
      onBytes(buf.byteLength, true);
      return buf;
    }
  }
  var res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al descargar ' + name);
  var chunks = [], got = 0;
  if (res.body && res.body.getReader) {
    var reader = res.body.getReader();
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value);
      got += r.value.byteLength;
      onBytes(r.value.byteLength);
    }
  } else {
    var whole = new Uint8Array(await res.arrayBuffer());
    chunks.push(whole);
    got = whole.byteLength;
    onBytes(got);
  }
  var out = new Uint8Array(got), at = 0;
  chunks.forEach(function (c) { out.set(c, at); at += c.byteLength; });
  if (cache) {
    try { await cache.put(url, new Response(out.slice().buffer, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { /* sin espacio */ }
  }
  return out.buffer;
}

function init(id) {
  if (ocrPromise) return ocrPromise;
  ocrPromise = (async function () {
    importScripts(ORT_BASE + 'ort.wasm.min.js', 'indra.js');
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1; // sin aislamiento entre orígenes no hay hilos
    var total = 0, loaded = 0;
    Object.keys(SIZES).forEach(function (k) { total += SIZES[k]; });
    var downloading = false;
    var onBytes = function (n, cached) {
      loaded += n;
      if (!cached) downloading = true;
      post({ id: id, type: 'progress', stage: downloading ? 'download' : 'load', loaded: loaded, total: Math.max(total, loaded) });
    };
    var files = await Promise.all(IndraOCR.FILES.map(function (f) { return fetchModel(f, onBytes); }));
    post({ id: id, type: 'progress', stage: 'prepare' });
    var models = { det: files[0], rec: files[1], order: files[2], orient: files[3], meta: new TextDecoder().decode(files[4]) };
    return IndraOCR.create(ort, models);
  })();
  ocrPromise.catch(function () { ocrPromise = null; });
  return ocrPromise;
}

self.onmessage = async function (e) {
  var msg = e.data || {};
  try {
    var ocr = await init(msg.id);
    if (msg.type === 'init') { post({ id: msg.id, type: 'done', result: true }); return; }
    if (msg.type === 'read') {
      var result = await ocr.read(msg.page, function (frac, stage) {
        post({ id: msg.id, type: 'progress', stage: stage, frac: frac });
      });
      post({ id: msg.id, type: 'done', result: { text: result.text, paragraphs: result.paragraphs, blocks: result.blocks, rotation: result.rotation, skew: result.skew } });
    }
  } catch (err) {
    post({ id: msg.id, type: 'error', message: (err && (err.message || String(err))) || 'Error del OCR' });
  }
};
