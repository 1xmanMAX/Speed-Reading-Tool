/* Lectura Veloz — Web Worker del OCR Indra.
 * Carga onnxruntime-web y los modelos de Indra que van dentro de la app (web/vendor)
 * y lee páginas sin bloquear la interfaz.
 *
 * Mensajes de entrada:  { id, type: 'init' } | { id, type: 'read', page: { width, height, data } }
 * Mensajes de salida:   { id, type: 'progress', loaded, total, stage, frac }
 *                       { id, type: 'done', result } | { id, type: 'error', message }
 */
/* global ort, IndraOCR */
'use strict';

// Todo va dentro de la app (scripts/vendor.mjs): sin conexión y sin pedir nada a terceros.
var ORT_BASE = new URL('../vendor/ort/', self.location.href).href;
var MODEL_BASE = new URL('../vendor/indra/', self.location.href).href;
// Tamaños aproximados para la barra de progreso (bytes).
var SIZES = { 'det.onnx': 389948, 'rec.onnx': 5042161, 'order.onnx': 2973138, 'orient.onnx': 371802, 'meta.json': 211869 };

var ocrPromise = null;

function post(msg) { self.postMessage(msg); }

async function fetchModel(name, onBytes) {
  var res = await fetch(MODEL_BASE + name);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al cargar ' + name);
  var buf = await res.arrayBuffer();
  onBytes(buf.byteLength, true);
  return buf;
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
