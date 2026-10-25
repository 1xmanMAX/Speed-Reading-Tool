/* speech.js — lectura en voz alta (prioridad: voces de Microsoft).
 * Script clásico (no módulo). Expone window.LV.speech.
 *
 * Proveedores:
 *  - 'system': Web Speech API (speechSynthesis). En Edge incluye las voces
 *    neuronales "Microsoft … Online (Natural)"; en Windows, las voces locales
 *    de Microsoft (Helena, Laura, Pablo, Sabina…).
 *  - 'azure': Azure AI Speech (REST, voces neuronales) con clave propia.
 *
 * Cada llamada a speak() lee UN fragmento (una frase o un párrafo, ~600
 * caracteres como máximo) e informa del progreso con onWord(charIndex, charLength)
 * usando posiciones dentro de ese mismo fragmento.
 */
(function () {
  'use strict';

  window.LV = window.LV || {};
  var LV = window.LV;

  var MAX_CHARS = 600;
  var CHARS_PER_SEC = 14.5;        // velocidad de habla estimada a rate = 1
  var VOICES_TIMEOUT = 1500;
  var CACHE_LIMIT = 6;
  var SAMPLE_TEXT = 'Hola, así sonará tu lectura.';
  var AZURE_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

  var hasWindow = typeof window !== 'undefined';
  var synth = hasWindow && window.speechSynthesis ? window.speechSynthesis : null;
  var systemSupported = !!(synth && hasWindow && window.SpeechSynthesisUtterance);
  var azureCapable = !!(hasWindow && window.fetch && window.Audio && window.URL && URL.createObjectURL);

  // ---------------------------------------------------------------- Voces de Azure

  function az(id, label, region) {
    return { id: id, label: label, region: region };
  }
  var AZURE_RAW = [
    az('es-ES-ElviraNeural', 'Elvira', 'España'),
    az('es-ES-AlvaroNeural', 'Álvaro', 'España'),
    az('es-ES-XimenaNeural', 'Ximena', 'España'),
    az('es-MX-DaliaNeural', 'Dalia', 'México'),
    az('es-MX-JorgeNeural', 'Jorge', 'México'),
    az('es-AR-ElenaNeural', 'Elena', 'Argentina'),
    az('es-CO-SalomeNeural', 'Salomé', 'Colombia'),
    az('es-US-PalomaNeural', 'Paloma', 'EE. UU., español'),
    az('es-US-AlonsoNeural', 'Alonso', 'EE. UU., español'),
    az('en-US-JennyNeural', 'Jenny', 'EE. UU., inglés'),
    az('en-US-AriaNeural', 'Aria', 'EE. UU., inglés'),
    az('en-US-GuyNeural', 'Guy', 'EE. UU., inglés'),
    az('en-GB-SoniaNeural', 'Sonia', 'Reino Unido, inglés')
  ];
  var AZURE_VOICES = AZURE_RAW.map(function (v) {
    return {
      id: v.id,
      name: v.label + ' (' + v.region + ') · Azure neuronal',
      lang: v.id.split('-').slice(0, 2).join('-'),
      provider: 'azure',
      microsoft: true,
      natural: true,
      local: false
    };
  });
  var AZURE_BY_ID = {};
  AZURE_VOICES.forEach(function (v) { AZURE_BY_ID[v.id] = v; });

  // ---------------------------------------------------------------- Configuración

  var cfg = {
    provider: 'system',
    voiceId: null,
    rate: 1,
    pitch: 1,
    azureKey: '',
    azureRegion: ''
  };

  function clamp(n, lo, hi, def) {
    n = Number(n);
    if (!isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  }

  function azureConfigured() {
    return !!(cfg.azureKey && cfg.azureRegion);
  }

  function configure(o) {
    o = o || {};
    if ('azureKey' in o) cfg.azureKey = String(o.azureKey || '').trim();
    if ('azureRegion' in o) cfg.azureRegion = String(o.azureRegion || '').trim().toLowerCase().replace(/\s+/g, '');
    if ('voiceId' in o) cfg.voiceId = o.voiceId || null;
    if ('rate' in o) cfg.rate = clamp(o.rate, 0.5, 3, 1);
    if ('pitch' in o) cfg.pitch = clamp(o.pitch, 0.5, 2, 1);
    if (o.provider === 'system' || o.provider === 'azure') cfg.provider = o.provider;
    else if (!('provider' in o) && cfg.voiceId && AZURE_BY_ID[cfg.voiceId]) cfg.provider = 'azure';
    return getConfig();
  }

  function getConfig() {
    return {
      provider: cfg.provider, voiceId: cfg.voiceId, rate: cfg.rate, pitch: cfg.pitch,
      azureKey: cfg.azureKey, azureRegion: cfg.azureRegion
    };
  }

  // ---------------------------------------------------------------- Utilidades

  function safeCall(fn) {
    if (typeof fn !== 'function') return;
    try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) {
      if (hasWindow && window.console) console.error(e);
    }
  }

  function prepareText(text) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (t.length > MAX_CHARS) {
      // Cortar en el último espacio para no partir palabras.
      var cut = t.lastIndexOf(' ', MAX_CHARS);
      t = t.slice(0, cut > MAX_CHARS * 0.6 ? cut : MAX_CHARS);
    }
    return t;
  }

  // Lista de palabras con su posición y "peso" temporal (longitud + 2 + pausas).
  function wordsOf(text) {
    var out = [];
    var re = /\S+/g, m;
    while ((m = re.exec(text))) {
      var w = m[0];
      var weight = w.length + 2;
      if (/[.!?…]["»”’)\]]*$/.test(w)) weight += 8;          // fin de frase
      else if (/[,;:]["»”’)\]]*$/.test(w)) weight += 4;       // pausa breve
      else if (/[—–-]$/.test(w)) weight += 3;
      out.push({ start: m.index, len: w.length, weight: weight });
    }
    return out;
  }

  function totalWeight(words) {
    var s = 0;
    for (var i = 0; i < words.length; i++) s += words[i].weight;
    return s;
  }

  function estimateSeconds(words, rate) {
    return totalWeight(words) / (CHARS_PER_SEC * (rate || 1));
  }

  function wordLengthAt(text, idx) {
    var m = /^\S+/.exec(text.slice(idx));
    return m ? m[0].length : 0;
  }

  function langPrefix(l) {
    return String(l || '').toLowerCase().split(/[-_]/)[0];
  }

  // Handle "vacío" que informa de un error de forma asíncrona.
  function failedHandle(opts, msg) {
    var cancelled = false;
    setTimeout(function () { if (!cancelled) safeCall(opts.onError, new Error(msg)); }, 0);
    return { cancel: function () { cancelled = true; } };
  }

  // ---------------------------------------------------------------- Voces del sistema

  function rawSystemVoices() {
    if (!systemSupported) return [];
    try { return synth.getVoices() || []; } catch (e) { return []; }
  }

  function waitSystemVoices() {
    if (!systemSupported) return Promise.resolve([]);
    var now = rawSystemVoices();
    if (now.length) return Promise.resolve(now);
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { synth.removeEventListener('voiceschanged', onChange); } catch (e) { /* ignorar */ }
        resolve(rawSystemVoices());
      }
      function onChange() { if (rawSystemVoices().length) finish(); }
      var timer = setTimeout(finish, VOICES_TIMEOUT);
      try { synth.addEventListener('voiceschanged', onChange); } catch (e) {
        // Navegadores antiguos: solo la propiedad onvoiceschanged.
        var prev = synth.onvoiceschanged;
        synth.onvoiceschanged = function (ev) { if (prev) prev.call(synth, ev); onChange(); };
      }
    });
  }

  function voiceIdOf(v) { return v.voiceURI || v.name; }

  function mapSystemVoice(v) {
    var name = v.name || v.voiceURI || '';
    return {
      id: voiceIdOf(v),
      name: name,
      lang: v.lang || '',
      provider: 'system',
      microsoft: /Microsoft/i.test(name),
      natural: /Natural|Online|Neural/i.test(name),
      local: !!v.localService
    };
  }

  function rankOf(v) {
    var es = langPrefix(v.lang) === 'es' ? 0 : 1;
    var ms = v.microsoft && v.natural ? 0 : v.microsoft ? 1 : 2;
    return es * 10 + ms;
  }

  function sortVoices(list) {
    return list
      .map(function (v, i) { return { v: v, i: i, r: rankOf(v) }; })
      .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
      .map(function (x) { return x.v; });
  }

  function listVoices() {
    return waitSystemVoices().then(function (raw) {
      var seen = {};
      var sys = [];
      raw.forEach(function (v) {
        var m = mapSystemVoice(v);
        if (!m.id || seen[m.id]) return;
        seen[m.id] = 1;
        sys.push(m);
      });
      var out = sortVoices(sys);
      if (azureConfigured()) out = out.concat(AZURE_VOICES.map(function (v) {
        var c = {}; for (var k in v) c[k] = v[k]; return c;
      }));
      return out;
    });
  }

  function findSystemVoice(id, lang) {
    var raw = rawSystemVoices();
    var i;
    if (id) {
      for (i = 0; i < raw.length; i++) if (voiceIdOf(raw[i]) === id) return raw[i];
      for (i = 0; i < raw.length; i++) if (raw[i].name === id) return raw[i];
    }
    // Sin voz elegida (o ya no existe): la mejor para el idioma pedido.
    var want = langPrefix(lang || 'es');
    var best = null, bestRank = Infinity;
    for (i = 0; i < raw.length; i++) {
      if (langPrefix(raw[i].lang) !== want) continue;
      var r = rankOf(mapSystemVoice(raw[i])) % 10;
      if (r < bestRank) { best = raw[i]; bestRank = r; }
    }
    return best;
  }

  // Registro de qué voces envían eventos "boundary" (true/false), por id.
  var boundaryInfo = {};
  function hasBoundaryEvents(voiceId) {
    var id = voiceId || cfg.voiceId;
    if (AZURE_BY_ID[id]) return false; // Azure se sincroniza con el tiempo del audio
    if (id && Object.prototype.hasOwnProperty.call(boundaryInfo, id)) return boundaryInfo[id];
    if (id && /Google/i.test(id)) return false;
    return null; // desconocido
  }

  // ---------------------------------------------------------------- Proveedor: sistema

  var current = null;      // handle activo (solo uno a la vez)
  var liveUtterances = []; // referencias fuertes (bug de Chrome: el GC se come el utterance)

  function speakSystem(text, opts) {
    if (!systemSupported) return failedHandle(opts, 'Tu navegador no admite la lectura en voz alta.');

    var words = wordsOf(text);
    var rate = cfg.rate;
    var voice = findSystemVoice(cfg.voiceId, opts.lang);
    var voiceKey = voice ? voiceIdOf(voice) : null;
    var u = new window.SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || opts.lang || 'es-ES';
    u.rate = rate;
    u.pitch = cfg.pitch;
    u.volume = 1;

    var finished = false, cancelled = false, started = false;
    var gotBoundary = false;
    var estTimer = null, watchdog = null, startTimer = null;
    var lastIdx = -1;
    var estSecs = estimateSeconds(words, rate);

    function emit(idx, len) {
      if (idx === lastIdx) return;
      lastIdx = idx;
      safeCall(opts.onWord, idx, len);
    }

    function stopEstimator() {
      if (estTimer) { clearTimeout(estTimer); estTimer = null; }
    }

    function runEstimator() {
      var t0 = Date.now();
      var unit = 1000 / (CHARS_PER_SEC * rate);
      var i = 0, at = 0; // at: instante (ms) en que empieza la palabra i
      function step() {
        estTimer = null;
        if (finished || gotBoundary) return;
        var elapsed = Date.now() - t0;
        // Avanzar hasta la palabra que corresponde al tiempo transcurrido.
        while (i < words.length - 1 && at + words[i].weight * unit <= elapsed) {
          at += words[i].weight * unit;
          i++;
        }
        if (i < words.length) emit(words[i].start, words[i].len);
        if (i < words.length - 1) {
          estTimer = setTimeout(step, Math.max(10, at + words[i].weight * unit - elapsed));
        }
      }
      step();
    }

    function release() {
      stopEstimator();
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      var k = liveUtterances.indexOf(u);
      if (k >= 0) liveUtterances.splice(k, 1);
      u.onstart = u.onend = u.onerror = u.onboundary = null;
      if (current === handle) current = null;
    }

    function finish(err) {
      if (finished) return;
      finished = true;
      if (voiceKey && !gotBoundary && started && !err && !(voiceKey in boundaryInfo)) boundaryInfo[voiceKey] = false;
      release();
      if (cancelled) return;
      if (err) safeCall(opts.onError, err);
      else safeCall(opts.onEnd);
    }

    u.onstart = function () {
      if (finished || started) return;
      started = true;
      safeCall(opts.onStart);
      if (!gotBoundary) runEstimator();
    };
    u.onboundary = function (ev) {
      if (finished) return;
      if (ev && ev.name === 'sentence') return;
      var idx = ev && typeof ev.charIndex === 'number' ? ev.charIndex : -1;
      if (idx < 0 || idx >= text.length) return;
      if (!gotBoundary) {
        gotBoundary = true;
        stopEstimator();
        if (voiceKey) boundaryInfo[voiceKey] = true;
      }
      // Algunos motores apuntan al espacio previo a la palabra.
      while (idx < text.length && /\s/.test(text.charAt(idx))) idx++;
      var len = ev.charLength > 0 ? ev.charLength : wordLengthAt(text, idx);
      emit(idx, len);
    };
    u.onend = function () { finish(null); };
    u.onerror = function (ev) {
      var code = ev && ev.error;
      if (cancelled) return finish(null);
      if (code === 'interrupted' || code === 'canceled') return finish(null); // cortado desde fuera: seguir
      var msg = code === 'not-allowed'
        ? 'El navegador bloqueó la voz. Pulsa reproducir de nuevo.'
        : code === 'language-unavailable' || code === 'voice-unavailable'
          ? 'La voz seleccionada no está disponible. Elige otra en los ajustes.'
          : code === 'network'
            ? 'La voz necesita conexión a Internet y no se pudo conectar.'
            : 'No se pudo leer en voz alta' + (code ? ' (' + code + ')' : '') + '.';
      finish(new Error(msg));
    };

    var handle = {
      cancel: function () {
        if (finished || cancelled) return;
        cancelled = true;
        var wasCurrent = current === handle;
        finish(null);
        if (wasCurrent) { try { synth.cancel(); } catch (e) { /* ignorar */ } }
      }
    };

    liveUtterances.push(u);
    current = handle;

    // Vigilante: si onend no llega (bug de Chrome con voces de red), terminar igualmente.
    watchdog = setTimeout(function () {
      if (finished) return;
      try { synth.cancel(); } catch (e) { /* ignorar */ }
      finish(null);
    }, estSecs * 2000 + 3000);

    var busy = false;
    try { busy = synth.speaking || synth.pending; } catch (e) { /* ignorar */ }
    function go() {
      startTimer = null;
      if (finished) return;
      try {
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch (e) {
        finish(new Error('No se pudo leer en voz alta.'));
      }
    }
    if (busy) {
      // Chrome a veces ignora speak() justo después de cancel(): dar un respiro.
      try { synth.cancel(); } catch (e) { /* ignorar */ }
      startTimer = setTimeout(go, 60);
    } else {
      go();
    }
    return handle;
  }

  // ---------------------------------------------------------------- Proveedor: Azure

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  function pct(n) {
    n = Math.round(n);
    return (n >= 0 ? '+' : '') + n + '%';
  }

  function azureVoiceId() {
    return AZURE_BY_ID[cfg.voiceId] ? cfg.voiceId : 'es-ES-ElviraNeural';
  }

  function buildSsml(text, voiceId, lang, rate, pitch) {
    var vlang = AZURE_BY_ID[voiceId] ? AZURE_BY_ID[voiceId].lang : 'es-ES';
    var l = lang && langPrefix(lang) === langPrefix(vlang) ? lang : vlang;
    return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + escapeXml(l) + "'>" +
      "<voice name='" + escapeXml(voiceId) + "'>" +
      "<prosody rate='" + pct((rate - 1) * 100) + "' pitch='" + pct((pitch - 1) * 50) + "'>" +
      escapeXml(text) +
      '</prosody></voice></speak>';
  }

  function azureEndpoint() {
    return 'https://' + encodeURIComponent(cfg.azureRegion) + '.tts.speech.microsoft.com/cognitiveservices/v1';
  }

  function httpError(status) {
    if (status === 401 || status === 403) return 'Clave de Azure no válida o región incorrecta.';
    if (status === 429) return 'Se superó el límite de uso de Azure. Espera un momento o revisa tu cuota.';
    if (status === 400) return 'Azure rechazó la petición (voz o texto no válidos).';
    if (status === 404) return 'Región de Azure incorrecta.';
    if (status >= 500) return 'El servicio de voz de Azure no está disponible ahora. Inténtalo más tarde.';
    return 'Azure devolvió un error (HTTP ' + status + ').';
  }

  // Caché de audio: clave -> { promise, url, controller }. Máx. CACHE_LIMIT entradas.
  var audioCache = new Map();

  function cacheKey(text, voiceId, lang, rate, pitch) {
    return [cfg.azureRegion, voiceId, lang || '', rate, pitch, text].join('\u0001');
  }

  function disposeEntry(entry) {
    if (entry.url) { try { URL.revokeObjectURL(entry.url); } catch (e) { /* ignorar */ } entry.url = null; }
    else if (entry.controller) {
      entry.disposed = true;
      try { entry.controller.abort(); } catch (e) { /* ignorar */ }
    }
  }

  function trimCache() {
    while (audioCache.size > CACHE_LIMIT) {
      var oldest = audioCache.keys().next().value;
      var e = audioCache.get(oldest);
      audioCache.delete(oldest);
      disposeEntry(e);
    }
  }

  function clearCache() {
    audioCache.forEach(disposeEntry);
    audioCache.clear();
  }

  function fetchAudio(text, lang) {
    var voiceId = azureVoiceId();
    var ssml = buildSsml(text, voiceId, lang, cfg.rate, cfg.pitch);
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var entry = { url: null, controller: controller, disposed: false, promise: null };
    entry.promise = window.fetch(azureEndpoint(), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': cfg.azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': AZURE_FORMAT
      },
      body: ssml,
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error(httpError(res.status));
      return res.blob();
    }, function (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error('No se pudo conectar con Azure. Revisa tu conexión y la región.');
    }).then(function (blob) {
      if (!blob || !blob.size) throw new Error('Azure devolvió un audio vacío.');
      var url = URL.createObjectURL(blob);
      if (entry.disposed) { URL.revokeObjectURL(url); throw abortError(); }
      entry.url = url;
      entry.controller = null;
      return url;
    });
    return entry;
  }

  function abortError() {
    var e = new Error('Cancelado');
    e.name = 'AbortError';
    return e;
  }

  // Devuelve una entrada (de la caché o nueva) que pasa a ser propiedad de quien la pide.
  function takeAudio(text, lang) {
    var key = cacheKey(text, azureVoiceId(), lang, cfg.rate, cfg.pitch);
    var entry = audioCache.get(key);
    if (entry) { audioCache.delete(key); return entry; }
    return fetchAudio(text, lang);
  }

  function prefetch(text, opts) {
    if (cfg.provider !== 'azure' || !azureConfigured() || !azureCapable) return Promise.resolve(false);
    var t = prepareText(text);
    if (!t) return Promise.resolve(false);
    var lang = opts && opts.lang;
    var key = cacheKey(t, azureVoiceId(), lang, cfg.rate, cfg.pitch);
    var entry = audioCache.get(key);
    if (!entry) {
      entry = fetchAudio(t, lang);
      audioCache.set(key, entry);
      trimCache();
      entry.promise.catch(function () {
        if (audioCache.get(key) === entry) audioCache.delete(key); // no guardar errores
      });
    }
    return entry.promise.then(function () { return true; }, function () { return false; });
  }

  function speakAzure(text, opts) {
    if (!azureCapable) return failedHandle(opts, 'Tu navegador no puede reproducir el audio de Azure.');
    if (!azureConfigured()) return failedHandle(opts, 'Configura la clave y la región de Azure en los ajustes.');

    var words = wordsOf(text);
    var cum = [];
    var acc = 0;
    for (var i = 0; i < words.length; i++) { cum.push(acc); acc += words[i].weight; }
    var total = acc || 1;
    var estDur = estimateSeconds(words, cfg.rate);

    var entry = takeAudio(text, opts.lang);
    var audio = null, raf = 0, finished = false, cancelled = false, started = false;
    var wordIdx = -1;

    function sync() {
      if (!audio || finished) return;
      var d = audio.duration;
      if (!isFinite(d) || d <= 0) d = estDur;
      var p = Math.min(1, Math.max(0, audio.currentTime / d));
      var w = p * total;
      var j = wordIdx < 0 ? 0 : wordIdx;
      while (j < words.length - 1 && cum[j + 1] <= w) j++;
      if (j !== wordIdx && j < words.length) {
        wordIdx = j;
        safeCall(opts.onWord, words[j].start, words[j].len);
      }
    }

    function loop() {
      raf = 0;
      if (finished) return;
      sync();
      if (window.requestAnimationFrame) raf = window.requestAnimationFrame(loop);
    }

    function release() {
      if (raf && window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
      raf = 0;
      if (audio) {
        audio.onplaying = audio.ontimeupdate = audio.onended = audio.onerror = null;
        try { audio.pause(); } catch (e) { /* ignorar */ }
        try { audio.removeAttribute('src'); audio.load(); } catch (e) { /* ignorar */ }
      }
      disposeEntry(entry);
      if (current === handle) current = null;
    }

    function finish(err) {
      if (finished) return;
      finished = true;
      release();
      if (cancelled) return;
      if (err) safeCall(opts.onError, err);
      else safeCall(opts.onEnd);
    }

    var handle = {
      cancel: function () {
        if (finished || cancelled) return;
        cancelled = true;
        finish(null);
      }
    };
    current = handle;

    entry.promise.then(function (url) {
      if (finished) return;
      audio = new window.Audio();
      audio.preload = 'auto';
      audio.onplaying = function () {
        if (finished) return;
        if (!started) {
          started = true;
          safeCall(opts.onStart);
          sync();
          if (!raf) loop();
        }
      };
      audio.ontimeupdate = sync;
      audio.onended = function () { finish(null); };
      audio.onerror = function () { finish(new Error('No se pudo reproducir el audio de Azure.')); };
      audio.src = url;
      var p;
      try { p = audio.play(); } catch (e) { p = Promise.reject(e); }
      if (p && p.catch) {
        p.catch(function (e) {
          if (finished) return;
          if (e && e.name === 'NotAllowedError') finish(new Error('El navegador bloqueó el audio. Pulsa reproducir de nuevo.'));
          else if (!(e && e.name === 'AbortError')) finish(new Error('No se pudo reproducir el audio de Azure.'));
        });
      }
    }, function (err) {
      if (finished) return;
      if (err && err.name === 'AbortError') return finish(null);
      finish(err instanceof Error ? err : new Error('No se pudo obtener el audio de Azure.'));
    });

    return handle;
  }

  // ---------------------------------------------------------------- API pública

  function speak(text, opts) {
    opts = opts || {};
    stopCurrent();
    var t = prepareText(text);
    if (!t) {
      var c = false;
      setTimeout(function () { if (!c) safeCall(opts.onEnd); }, 0);
      return { cancel: function () { c = true; } };
    }
    return cfg.provider === 'azure' ? speakAzure(t, opts) : speakSystem(t, opts);
  }

  function stopCurrent() {
    if (current) current.cancel();
    current = null;
  }

  function stop() {
    stopCurrent();
    if (systemSupported) { try { synth.cancel(); } catch (e) { /* ignorar */ } }
  }

  function test(text, opts) {
    return speak(text || SAMPLE_TEXT, opts || { lang: 'es-ES' });
  }

  LV.speech = {
    listVoices: listVoices,
    configure: configure,
    getConfig: getConfig,
    speak: speak,
    prefetch: prefetch,
    stop: stop,
    test: test,
    clearCache: clearCache,
    hasBoundaryEvents: hasBoundaryEvents,
    isSpeaking: function () { return !!current; },
    AZURE_VOICES: AZURE_VOICES,
    systemSupported: systemSupported,
    MAX_CHARS: MAX_CHARS,
    // Utilidades internas expuestas para pruebas.
    _buildSsml: buildSsml,
    _wordsOf: wordsOf,
    _cacheSize: function () { return audioCache.size; }
  };
  // true si hay voces del sistema o Azure está configurado.
  Object.defineProperty(LV.speech, 'supported', {
    enumerable: true,
    get: function () { return systemSupported || (azureCapable && azureConfigured()); }
  });
})();
