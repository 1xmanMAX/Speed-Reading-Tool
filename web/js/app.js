/* Lectura Veloz — aplicación
 * Motor de reproducción, modos de lectura e interfaz.
 */
(function () {
    'use strict';

    const T = LV.text;
    const S = LV.storage;
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const esc = T.escapeHtml;

    /* =====================================================
       Modos de lectura
       ===================================================== */
    const MODES = [
        { id: 'focus', name: 'Enfoque', kind: 'rsvp', desc: 'Una palabra a la vez, fija en el centro, con la letra de reconocimiento óptimo resaltada.', demo: 'lec<span class="o">t</span>ura' },
        { id: 'chunk', name: 'Bloques', kind: 'rsvp', chunk: true, desc: 'Grupos de palabras que forman frases con sentido, para captar más de un vistazo.', demo: 'una idea nueva,' },
        { id: 'guided', name: 'Resaltado', kind: 'page', desc: 'El texto completo con una marca que avanza a tu ritmo, sin perder el contexto.', demo: '<span class="dim">Cada libro</span> <span class="hl">abre</span> una puerta' },
        { id: 'line', name: 'Línea', kind: 'page', desc: 'Un pautador recorre cada renglón como si guiaras la lectura con el dedo.', demo: '<span class="dim">texto anterior</span><br><span class="hl">renglón activo ———</span>' },
        { id: 'bionic', name: 'Biónica', kind: 'page', desc: 'El inicio de cada palabra en negrita para anclar la mirada. Ajusta la intensidad.', demo: '<b>Le</b>er <b>e</b>s <b>u</b>na <b>habil</b>idad' },
        { id: 'gradient', name: 'Degradado', kind: 'page', desc: 'Cada renglón cambia de color y continúa en el siguiente para saltar de línea sin esfuerzo.', demo: '<span style="background:linear-gradient(90deg,var(--grad-a),var(--grad-b));-webkit-background-clip:text;background-clip:text;color:transparent">un color que fluye</span>' },
        { id: 'scroll', name: 'Teleprompter', kind: 'scroll', desc: 'El texto se desplaza de forma continua a la velocidad elegida. Ideal para relajarse.', demo: '<span class="dim">↑ desplazamiento</span><br>suave y continuo' },
        { id: 'peri', name: 'Periférica', kind: 'peri', chunk: true, desc: 'Columna estrecha: fija la vista en el centro y capta cada renglón completo.', demo: 'capta · | · el renglón' },
        { id: 'flash', name: 'Destello', kind: 'rsvp', chunk: true, flash: true, desc: 'El bloque aparece un instante y se oculta. Entrena la amplitud y la atención.', demo: '<span class="dim">#### ## ####</span>' },
    ];
    const MODE = Object.fromEntries(MODES.map((m) => [m.id, m]));

    const DEFAULTS = {
        mode: 'focus',
        wpm: 300,
        chunkSize: 3,
        rampUp: false,
        rampSeconds: 30,
        smartPause: true,
        rewindOnPause: true,
        countdown: false,
        sessionLimit: 0,
        theme: 'auto',
        font: 'atkinson',
        rsvpSize: 56,
        pageSize: 20,
        lineHeight: 1.65,
        columnWidth: 65,
        showOrp: true,
        showGuides: true,
        showContext: true,
        dimInactive: true,
        bionicRatio: 0.45,
        voice: false,
        immersive: true,
    };

    const THEMES = [
        { id: 'auto', name: 'Auto', bg: 'linear-gradient(135deg,#fafaf7 50%,#121418 50%)', fg: '#7aa2ff' },
        { id: 'dark', name: 'Oscuro', bg: '#121418', fg: '#e6e8eb' },
        { id: 'light', name: 'Claro', bg: '#fafaf7', fg: '#1f2328' },
        { id: 'sepia', name: 'Sepia', bg: '#f4ecd8', fg: '#3b2f22' },
        { id: 'midnight', name: 'OLED', bg: '#000000', fg: '#ffb454' },
    ];

    const settings = S.settings.load(DEFAULTS);
    if (!MODE[settings.mode]) settings.mode = DEFAULTS.mode;

    /* =====================================================
       Estado
       ===================================================== */
    const state = {
        book: null,         // registro guardado
        tok: null,          // { words, flags, paraStarts }
        prefix: null,       // sumas acumuladas de factores de tiempo
        chunkCache: new Map(),
        pos: 0,
        playing: false,
        timer: 0,
        flashTimer: 0,
        stepStart: 0,
        stepDur: 0,
        stepsSinceResume: 0,
        playStartedAt: 0,
        pausedByUser: false,
        // ventana de página renderizada
        win: { start: 0, end: 0, el: null, spans: [], lines: null, kind: '' },
        curRange: [0, 0],
        session: null,
        saveTimer: 0,
        rafId: 0,
        speaking: false,
    };

    const el = {
        app: $('#app'),
        home: $('#view-home'),
        reader: $('#view-reader'),
        title: $('#book-title'),
        modeBar: $('#mode-bar'),
        stage: $('#stage'),
        rsvp: $('#rsvp'),
        rsvpWord: $('#rsvp-word'),
        rsvpPrev: $('#rsvp-prev'),
        rsvpNext: $('#rsvp-next'),
        pageWrap: $('#page-wrap'),
        page: $('#page'),
        scrollBox: $('#scroll-box'),
        scrollWrap: $('#scroll-wrap'),
        scrollPage: $('#scroll-page'),
        peri: $('#peri'),
        periCol: $('#peri-col'),
        countdown: $('#countdown'),
        finish: $('#finish-card'),
        scrubber: $('#scrubber'),
        scrubFill: $('#scrubber-fill'),
        scrubThumb: $('#scrubber-thumb'),
        scrubTip: $('#scrubber-tip'),
        metaProgress: $('#meta-progress'),
        metaWords: $('#meta-words'),
        metaLeft: $('#meta-left'),
        play: $('#btn-play'),
        wpmValue: $('#wpm-value'),
        chunkValue: $('#chunk-value'),
        chunkStepper: $('#chunk-stepper'),
        sessionTime: $('#session-time'),
        fileInput: $('#file-input'),
        toasts: $('#toasts'),
        scrim: $('#scrim'),
    };

    const n = () => (state.tok ? state.tok.words.length : 0);
    const mode = () => MODE[settings.mode];

    /* =====================================================
       Utilidades
       ===================================================== */
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function fmtDuration(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (h) return `${h} h ${m} min`;
        if (m >= 1) return `${m} min`;
        return `${s} s`;
    }

    function fmtClock(ms) {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    const nf = new Intl.NumberFormat('es');
    const fmtNum = (v) => nf.format(Math.round(v));

    function hashHue(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
        return Math.abs(h) % 360;
    }

    function lowerBound(arr, v) {
        // último índice con arr[i] <= v
        let lo = 0, hi = arr.length - 1, ans = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return ans;
    }

    function toast(message, opts = {}) {
        const t = document.createElement('div');
        t.className = 'toast' + (opts.error ? ' is-error' : '');
        t.innerHTML = `<span class="toast-msg">${esc(message)}</span>` + (opts.progress ? '<div class="loading-bar"><i></i></div>' : '');
        el.toasts.appendChild(t);
        const close = () => {
            t.classList.add('is-out');
            setTimeout(() => t.remove(), 250);
        };
        if (!opts.progress) setTimeout(close, opts.duration || 3200);
        return {
            update(pct, msg) {
                if (msg) $('.toast-msg', t).textContent = msg;
                const bar = $('.loading-bar i', t);
                if (bar) bar.style.width = clamp(pct, 0, 100) + '%';
            },
            close,
        };
    }

    /* =====================================================
       Ajustes y apariencia
       ===================================================== */
    function applyAppearance() {
        const root = document.documentElement;
        root.dataset.theme = settings.theme;
        root.dataset.font = settings.font;
        root.style.setProperty('--rsvp-size', settings.rsvpSize + 'px');
        root.style.setProperty('--page-size', settings.pageSize + 'px');
        root.style.setProperty('--line-height', settings.lineHeight);
        root.style.setProperty('--column', settings.columnWidth + 'ch');
        el.app.classList.toggle('no-orp', !settings.showOrp);
        el.app.classList.toggle('no-guides', !settings.showGuides);
        el.app.classList.toggle('no-context', !settings.showContext);
        el.app.classList.toggle('immersive', settings.immersive);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#121418';
    }

    const FORMAT = {
        wpm: (v) => `${v} ppm`,
        chunkSize: (v) => `${v}`,
        rampSeconds: (v) => `${v} s`,
        sessionLimit: (v) => (Number(v) === 0 ? 'Sin límite' : `${v} min`),
        rsvpSize: (v) => `${v} px`,
        pageSize: (v) => `${v} px`,
        lineHeight: (v) => Number(v).toFixed(2),
        columnWidth: (v) => `${v} car.`,
        bionicRatio: (v) => `${Math.round(v * 100)}%`,
    };

    function syncSettingsUI() {
        $$('[data-setting]').forEach((input) => {
            const key = input.dataset.setting;
            if (input.type === 'checkbox') input.checked = !!settings[key];
            else input.value = settings[key];
            if (input.type === 'range') paintRange(input);
        });
        $$('output[data-for]').forEach((o) => {
            const key = o.dataset.for;
            o.textContent = FORMAT[key] ? FORMAT[key](settings[key]) : settings[key];
        });
        $$('[data-depends]').forEach((f) => {
            if (settings[f.dataset.depends]) f.removeAttribute('data-disabled');
            else f.setAttribute('data-disabled', '');
        });
        $$('.theme-swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === settings.theme)));
        el.wpmValue.textContent = settings.wpm;
        el.chunkValue.textContent = settings.chunkSize;
    }

    function paintRange(input) {
        const min = Number(input.min), max = Number(input.max);
        input.style.setProperty('--fill', ((input.value - min) / (max - min)) * 100 + '%');
    }

    let saveSettingsTimer = 0;
    function setSetting(key, value) {
        if (settings[key] === value) return;
        settings[key] = value;
        clearTimeout(saveSettingsTimer);
        saveSettingsTimer = setTimeout(() => S.settings.save(settings), 250);
        syncSettingsUI();
        onSettingChanged(key);
    }

    function onSettingChanged(key) {
        switch (key) {
            case 'theme': case 'font': case 'rsvpSize': case 'pageSize': case 'lineHeight': case 'columnWidth':
            case 'showOrp': case 'showGuides': case 'showContext': case 'immersive':
                applyAppearance();
                if (['font', 'pageSize', 'lineHeight', 'columnWidth'].includes(key)) relayout();
                break;
            case 'smartPause':
                buildPrefix();
                updateMeta();
                break;
            case 'wpm':
                updateMeta();
                break;
            case 'chunkSize':
                if (mode().chunk) {
                    state.pos = unitStart(state.pos);
                    restartIfPlaying();
                    render();
                }
                break;
            case 'bionicRatio':
                if (settings.mode === 'bionic') { invalidateWindow(); render(); }
                break;
            case 'dimInactive':
                render();
                break;
            case 'voice':
                restartIfPlaying();
                break;
        }
    }

    function buildSettingsUI() {
        const picker = $('[data-setting-group="theme"]');
        picker.innerHTML = THEMES.map((t) => `<button type="button" class="theme-swatch" data-theme="${t.id}" aria-pressed="false"><i style="background:${t.bg};color:${t.fg}">Aa</i>${t.name}</button>`).join('');
        picker.addEventListener('click', (e) => {
            const b = e.target.closest('.theme-swatch');
            if (b) setSetting('theme', b.dataset.theme);
        });

        $$('[data-setting]').forEach((input) => {
            const key = input.dataset.setting;
            const handler = () => {
                let v;
                if (input.type === 'checkbox') v = input.checked;
                else if (input.type === 'range') v = Number(input.value);
                else v = input.value;
                setSetting(key, v);
            };
            input.addEventListener(input.type === 'range' ? 'input' : 'change', handler);
        });

        $('#reset-settings').addEventListener('click', () => {
            const keepMode = settings.mode;
            Object.assign(settings, DEFAULTS, { mode: keepMode });
            S.settings.save(settings);
            applyAppearance();
            syncSettingsUI();
            buildPrefix();
            relayout();
            toast('Ajustes restablecidos');
        });

        $('#clear-stats').addEventListener('click', () => {
            if (!confirm('¿Borrar todas las estadísticas de lectura?')) return;
            S.stats.clear();
            renderStats();
            renderHomeStats();
            toast('Estadísticas borradas');
        });
    }

    /* =====================================================
       Preparación del texto
       ===================================================== */
    function buildPrefix() {
        if (!state.tok) return;
        const { words, flags } = state.tok;
        const p = new Float64Array(words.length + 1);
        for (let i = 0; i < words.length; i++) p[i + 1] = p[i] + T.delayFactor(words[i], flags[i], settings.smartPause);
        state.prefix = p;
    }

    function chunks() {
        const size = settings.chunkSize;
        if (!state.chunkCache.has(size)) state.chunkCache.set(size, T.buildChunks(state.tok, size));
        return state.chunkCache.get(size);
    }

    /** Inicio de la unidad (palabra, bloque o renglón) que contiene `i` */
    function unitStart(i) {
        const m = mode();
        if (m.chunk) {
            const c = chunks();
            return c[lowerBound(c, i)];
        }
        if (m.id === 'line') {
            const lines = ensureLines();
            if (lines && lines.starts.length) {
                const k = lowerBound(lines.starts, i);
                if (i >= lines.starts[0]) return lines.starts[k];
            }
        }
        return i;
    }

    /** Fin (exclusivo) de la unidad que empieza en `i` */
    function unitEnd(i) {
        const m = mode();
        const total = n();
        if (m.chunk) {
            const c = chunks();
            const k = lowerBound(c, i);
            return k + 1 < c.length ? c[k + 1] : total;
        }
        if (m.id === 'line') {
            const lines = ensureLines();
            if (lines && lines.starts.length) {
                const k = lowerBound(lines.starts, i);
                if (k + 1 < lines.starts.length) return Math.max(i + 1, lines.starts[k + 1]);
                return Math.max(i + 1, state.win.end);
            }
        }
        return Math.min(total, i + 1);
    }

    function effectiveWpm() {
        let wpm = settings.wpm;
        if (settings.rampUp && state.playing) {
            const t = (performance.now() - state.playStartedAt) / 1000;
            const f = clamp(t / settings.rampSeconds, 0, 1);
            wpm = wpm * (0.6 + 0.4 * f);
        }
        return wpm;
    }

    function unitDuration(start, end) {
        const base = 60000 / effectiveWpm();
        const factor = state.prefix[end] - state.prefix[start];
        const warm = [1.5, 1.25, 1.1][state.stepsSinceResume] || 1;
        let d = base * factor * warm;
        if (mode().chunk) {
            // Los bloques se leen algo más rápido que palabra a palabra
            d *= 0.92;
        }
        return Math.max(40, d);
    }

    /* =====================================================
       Reproducción
       ===================================================== */
    function play() {
        if (!state.tok || n() === 0 || state.playing) return;
        hideFinish();
        if (state.pos >= n() - 1) state.pos = 0;
        if (settings.rewindOnPause && state.pausedByUser) {
            state.pos = unitStart(Math.max(T.sentenceStart(state.tok, state.pos + 1), state.pos - 8));
        }
        state.pausedByUser = false;
        const start = () => {
            state.playing = true;
            state.playStartedAt = performance.now();
            state.stepsSinceResume = 0;
            beginSession();
            updatePlayButton();
            render();
            if (settings.voice && 'speechSynthesis' in window) speakFrom(state.pos);
            else scheduleNext();
            if (settings.mode === 'scroll') startScrollLoop();
        };
        if (settings.countdown) runCountdown(start);
        else start();
    }

    function pause(byUser = true) {
        if (!state.playing) {
            cancelCountdown();
            return;
        }
        state.playing = false;
        state.pausedByUser = byUser;
        clearTimeout(state.timer);
        clearTimeout(state.flashTimer);
        stopSpeech();
        stopScrollLoop();
        freezePacer();
        updatePlayButton();
        tickSession();
        saveProgress(true);
        if (settings.mode === 'flash') renderRsvp();
    }

    function toggle() {
        if (state.playing || countdownTimer) pause();
        else play();
    }

    function restartIfPlaying() {
        if (!state.playing) return;
        clearTimeout(state.timer);
        clearTimeout(state.flashTimer);
        stopSpeech();
        state.stepsSinceResume = 0;
        if (settings.voice && 'speechSynthesis' in window) speakFrom(state.pos);
        else scheduleNext();
    }

    function scheduleNext() {
        const start = state.pos;
        const end = unitEnd(start);
        const dur = unitDuration(start, end);
        state.stepStart = performance.now();
        state.stepDur = dur;
        onStepStart(dur);
        state.timer = setTimeout(() => {
            if (!state.playing) return;
            countRead(end - start);
            state.stepsSinceResume++;
            if (end >= n()) {
                finish();
                return;
            }
            setPos(end);
            if (checkSessionLimit()) return;
            scheduleNext();
        }, dur);
    }

    function onStepStart(dur) {
        const m = mode();
        if (m.flash) {
            const show = clamp(dur * 0.35, 70, 260);
            clearTimeout(state.flashTimer);
            state.flashTimer = setTimeout(() => {
                if (state.playing) maskFlash();
            }, show);
        }
        if (m.id === 'line') animatePacer(dur);
    }

    function setPos(i, opts = {}) {
        if (!state.tok) return;
        state.pos = clamp(i, 0, n() - 1);
        render(opts);
        scheduleSave();
    }

    /** Salto manual (flechas, barra de progreso, clic en palabra) */
    function seek(i) {
        if (!state.tok) return;
        hideFinish();
        state.pos = unitStart(clamp(i, 0, n() - 1));
        state.pausedByUser = false;
        render({ jump: true });
        scheduleSave();
        restartIfPlaying();
    }

    function step(dir) {
        if (!state.tok) return;
        if (dir > 0) seek(unitEnd(state.pos));
        else seek(Math.max(0, state.pos - 1));
    }

    function stepSentence(dir) {
        if (!state.tok) return;
        if (dir > 0) seek(T.nextSentence(state.tok, state.pos));
        else {
            let s = T.sentenceStart(state.tok, state.pos);
            if (state.pos - s < 2) s = T.sentenceStart(state.tok, Math.max(0, s - 1));
            seek(s);
        }
    }

    function finish() {
        state.playing = false;
        clearTimeout(state.timer);
        stopSpeech();
        stopScrollLoop();
        updatePlayButton();
        state.pos = n() - 1;
        render();
        const sess = state.session;
        tickSession();
        saveProgress(true, true);
        showFinish(sess);
    }

    /* --- Cuenta atrás --- */
    let countdownTimer = 0;
    function runCountdown(done) {
        let k = 3;
        el.countdown.hidden = false;
        const tick = () => {
            if (k === 0) {
                el.countdown.hidden = true;
                countdownTimer = 0;
                done();
                return;
            }
            el.countdown.innerHTML = `<span>${k}</span>`;
            k--;
            countdownTimer = setTimeout(tick, 700);
        };
        tick();
    }

    function cancelCountdown() {
        if (!countdownTimer) return;
        clearTimeout(countdownTimer);
        countdownTimer = 0;
        el.countdown.hidden = true;
    }

    /* --- Voz (síntesis del navegador) --- */
    let voiceCache = null;
    function pickVoice() {
        if (voiceCache) return voiceCache;
        const voices = speechSynthesis.getVoices();
        voiceCache = voices.find((v) => /^es(-|_)?/i.test(v.lang) && /natural|google|online/i.test(v.name))
            || voices.find((v) => /^es/i.test(v.lang)) || null;
        return voiceCache;
    }

    function speakFrom(start) {
        if (!state.playing) return;
        const words = state.tok.words;
        const end = Math.min(n(), T.nextSentence(state.tok, start) === start ? start + 1 : sentenceEndFrom(start));
        const offsets = [];
        let text = '';
        for (let i = start; i < end; i++) {
            offsets.push(text.length);
            text += words[i] + ' ';
        }
        const u = new SpeechSynthesisUtterance(text);
        const v = pickVoice();
        if (v) u.voice = v;
        u.lang = v ? v.lang : 'es-ES';
        u.rate = clamp(settings.wpm / 170, 0.5, 3.5);
        u.onboundary = (e) => {
            if (!state.playing || e.name === 'sentence') return;
            const k = lowerBound(offsets, e.charIndex);
            const idx = start + k;
            if (idx > state.pos) countRead(idx - state.pos);
            if (idx !== state.pos) setPos(unitStart(idx));
        };
        u.onend = () => {
            if (!state.playing || !state.speaking) return;
            countRead(Math.max(0, end - state.pos));
            if (end >= n()) { finish(); return; }
            setPos(end);
            if (checkSessionLimit()) return;
            speakFrom(end);
        };
        state.speaking = true;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
    }

    function sentenceEndFrom(i) {
        const { flags } = state.tok;
        let j = i;
        while (j < n() - 1 && !(flags[j] & T.F_SENTENCE) && j - i < 60) j++;
        return j + 1;
    }

    function stopSpeech() {
        if (!state.speaking) return;
        state.speaking = false;
        try { speechSynthesis.cancel(); } catch (e) { /* sin soporte */ }
    }

    /* =====================================================
       Sesiones y estadísticas
       ===================================================== */
    function beginSession() {
        const now = Date.now();
        if (!state.session || state.session.bookId !== state.book.id || now - state.session.lastActive > 5 * 60000) {
            flushSession();
            state.session = { bookId: state.book.id, title: state.book.title, mode: settings.mode, words: 0, ms: 0, start: now, lastActive: now, activeSince: performance.now() };
        } else {
            state.session.activeSince = performance.now();
        }
    }

    function countRead(k) {
        if (state.session && k > 0) state.session.words += k;
    }

    function tickSession() {
        const s = state.session;
        if (!s || !s.activeSince) return;
        s.ms += performance.now() - s.activeSince;
        s.activeSince = 0;
        s.lastActive = Date.now();
        updateSessionClock();
    }

    function sessionMs() {
        const s = state.session;
        if (!s) return 0;
        return s.ms + (s.activeSince ? performance.now() - s.activeSince : 0);
    }

    function flushSession(extra) {
        const s = state.session;
        if (!s) return;
        tickSession();
        S.stats.add(Object.assign({
            date: s.start,
            words: s.words,
            ms: Math.round(s.ms),
            mode: s.mode,
            wpm: settings.wpm,
            bookId: s.bookId,
            title: s.title,
        }, extra || {}));
        state.session = null;
        updateSessionClock();
    }

    function checkSessionLimit() {
        if (!settings.sessionLimit) return false;
        if (sessionMs() >= settings.sessionLimit * 60000) {
            pause(false);
            toast(`¡Sesión de ${settings.sessionLimit} min completada! Buen trabajo.`, { duration: 5000 });
            return true;
        }
        return false;
    }

    function updateSessionClock() {
        el.sessionTime.textContent = fmtClock(sessionMs());
    }
    setInterval(() => { if (state.playing) updateSessionClock(); }, 1000);

    /* =====================================================
       Progreso del libro
       ===================================================== */
    function scheduleSave() {
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(() => saveProgress(false), 1500);
    }

    function saveProgress(now, finished) {
        if (!state.book) return;
        clearTimeout(state.saveTimer);
        state.book.index = state.pos;
        state.book.lastOpened = Date.now();
        if (finished) state.book.finished = true;
        const fields = { index: state.pos, lastOpened: state.book.lastOpened, finished: !!state.book.finished, mode: settings.mode };
        S.books.patch(state.book.id, fields).catch(() => {});
    }

    /* =====================================================
       Renderizado
       ===================================================== */
    function render(opts = {}) {
        if (!state.tok) return;
        const m = mode();
        el.rsvp.hidden = m.kind !== 'rsvp';
        el.pageWrap.hidden = m.kind !== 'page';
        el.scrollBox.hidden = m.kind !== 'scroll';
        el.peri.hidden = m.kind !== 'peri';
        el.chunkStepper.hidden = !m.chunk;

        if (m.kind === 'rsvp') renderRsvp();
        else if (m.kind === 'page') renderPage(el.page, el.pageWrap, opts);
        else if (m.kind === 'scroll') renderPage(el.scrollPage, el.scrollWrap, opts);
        else if (m.kind === 'peri') renderPeri();
        updateMeta();
    }

    /* --- RSVP --- */
    function renderRsvp() {
        const m = mode();
        const { words } = state.tok;
        const s = state.pos;
        const e = unitEnd(s);
        const w = el.rsvpWord;
        if (m.chunk) {
            w.className = 'rsvp-word is-chunk';
            w.textContent = words.slice(s, e).join(' ');
        } else {
            const word = words[s] || '';
            const o = T.orpIndex(word);
            const chars = [...word];
            const oi = Math.min(o, chars.length - 1);
            w.className = 'rsvp-word';
            w.innerHTML = `<span class="l">${esc(chars.slice(0, oi).join(''))}</span><span class="p">${esc(chars[oi] || '')}</span><span class="r">${esc(chars.slice(oi + 1).join(''))}</span>`;
        }
        el.rsvp.classList.toggle('is-chunk-mode', !!m.chunk);
        if (settings.showContext) {
            el.rsvpPrev.textContent = words.slice(Math.max(0, s - 8), s).join(' ');
            el.rsvpNext.textContent = words.slice(e, e + 8).join(' ');
        }
    }

    function maskFlash() {
        el.rsvpWord.className = 'rsvp-word is-chunk is-flash-mask';
        el.rsvpWord.textContent = el.rsvpWord.textContent.replace(/[^\s]/g, '#');
    }

    /* --- Ventana de página --- */
    const WIN_BEFORE = 200;
    const WIN_SIZE = 1600;

    function invalidateWindow() {
        state.win.kind = '';
    }

    function ensureWindow(container, kind) {
        const w = state.win;
        const total = n();
        const pos = state.pos;
        const key = kind + ':' + settings.mode;
        const needsEnd = Math.min(total, pos + 60);
        if (w.kind === key && w.el === container && pos >= w.start && needsEnd <= w.end) return false;

        const { words, paraStarts } = state.tok;
        const pIdx = lowerBound(paraStarts, Math.max(0, pos - WIN_BEFORE));
        const start = paraStarts[pIdx] || 0;
        let pEnd = pIdx;
        while (pEnd + 1 < paraStarts.length && paraStarts[pEnd + 1] < start + WIN_SIZE) pEnd++;
        let end = pEnd + 1 < paraStarts.length ? paraStarts[pEnd + 1] : total;
        if (end <= pos) end = Math.min(total, pos + WIN_SIZE); // párrafo gigantesco
        const bionic = settings.mode === 'bionic';
        const ratio = settings.bionicRatio;

        let html = '';
        let p = pIdx;
        let open = false;
        for (let i = start; i < end; i++) {
            if (p < paraStarts.length && paraStarts[p] === i) {
                if (open) html += '</p>';
                html += '<p>';
                open = true;
                p++;
            } else if (!open) {
                html += '<p>';
                open = true;
            } else {
                html += ' ';
            }
            html += `<span class="w" data-i="${i}">${bionic ? T.bionicHtml(words[i], ratio) : esc(words[i])}</span>`;
        }
        if (open) html += '</p>';
        if (start > 0) html = '<p class="fine">…</p>' + html;
        if (end < total) html += '<p class="fine">…</p>';

        container.innerHTML = html;
        if (w.el && w.el !== container) w.el.innerHTML = '';
        w.el = container;
        w.kind = key;
        w.start = start;
        w.end = end;
        w.spans = $$('.w', container);
        w.lines = null;
        state.curRange = [0, 0];
        return true;
    }

    function spanAt(i) {
        const w = state.win;
        return i >= w.start && i < w.end ? w.spans[i - w.start] : null;
    }

    /** Agrupa las palabras de la ventana en renglones visuales */
    function ensureLines() {
        const w = state.win;
        if (!w.el || !w.spans.length) return null;
        if (w.lines) return w.lines;
        const starts = [];
        const tops = [];
        const heights = [];
        let lastTop = -1e9;
        for (let k = 0; k < w.spans.length; k++) {
            const s = w.spans[k];
            const top = s.offsetTop;
            if (Math.abs(top - lastTop) > 4) {
                starts.push(w.start + k);
                tops.push(top);
                heights.push(s.offsetHeight);
                lastTop = top;
            }
        }
        w.lines = { starts, tops, heights };
        return w.lines;
    }

    function relayout() {
        if (!state.win.el) return;
        state.win.lines = null;
        if (settings.mode === 'gradient') paintGradient();
        render({ jump: true });
    }

    function paintGradient() {
        const w = state.win;
        const lines = ensureLines();
        if (!lines) return;
        const pairs = [['a', 'b'], ['b', 'a'], ['a', 'c'], ['c', 'a']];
        const width = w.el.clientWidth || 1;
        let li = 0;
        for (let k = 0; k < w.spans.length; k++) {
            const i = w.start + k;
            while (li + 1 < lines.starts.length && lines.starts[li + 1] <= i) li++;
            const s = w.spans[k];
            const x = clamp((s.offsetLeft + s.offsetWidth / 2) / width, 0, 1);
            const [from, to] = pairs[(lines.starts[0] === w.start ? li : li) % 4];
            s.style.color = `color-mix(in oklab, var(--grad-${from}) ${Math.round((1 - x) * 100)}%, var(--grad-${to}))`;
        }
    }

    function renderPage(container, wrap, opts) {
        const m = mode();
        const rebuilt = ensureWindow(container, m.kind);
        container.className = 'page mode-' + m.id + (m.kind === 'scroll' ? ' scroll-page' : '');
        if (rebuilt && m.id === 'gradient') paintGradient();
        if (rebuilt && m.id === 'line') {
            const band = document.createElement('div');
            band.className = 'line-band';
            const pacer = document.createElement('div');
            pacer.className = 'pacer';
            container.prepend(band, pacer);
            state.win.band = band;
            state.win.pacer = pacer;
        }

        const dim = settings.dimInactive;
        container.classList.toggle('dim-read', dim && (m.id === 'guided' || m.id === 'scroll'));
        container.classList.toggle('dim-all', dim && m.id === 'line');

        const start = state.pos;
        const end = m.id === 'line' ? unitEnd(start) : start + 1;
        updateCursor(start, end, rebuilt || opts.jump, m);

        if (m.id === 'line') positionBand(start);
        if (m.kind === 'page') autoScroll(wrap, start, rebuilt || opts.jump);
        else if (!state.playing || rebuilt || opts.jump) snapScroll();
    }

    function updateCursor(start, end, full, m) {
        const w = state.win;
        const [ps, pe] = state.curRange;
        const cls = m.id === 'line' ? 'line-on' : 'cur';
        for (let i = ps; i < pe; i++) {
            const s = spanAt(i);
            if (s) s.classList.remove('cur', 'line-on');
        }
        for (let i = start; i < end; i++) {
            const s = spanAt(i);
            if (s) s.classList.add(cls);
        }
        if (m.id !== 'line' && m.id !== 'bionic' && m.id !== 'gradient') {
            if (full) {
                for (let k = 0; k < w.spans.length; k++) w.spans[k].classList.toggle('read', w.start + k < start);
            } else if (start > ps) {
                for (let i = ps; i < start; i++) { const s = spanAt(i); if (s) s.classList.add('read'); }
            } else {
                for (let i = start; i < ps; i++) { const s = spanAt(i); if (s) s.classList.remove('read'); }
            }
        }
        state.curRange = [start, end];
    }

    function autoScroll(wrap, i, instant) {
        const s = spanAt(i);
        if (!s) return;
        const wr = wrap.getBoundingClientRect();
        const r = s.getBoundingClientRect();
        const target = wr.height * 0.36;
        const rel = r.top - wr.top;
        if (instant || rel < wr.height * 0.15 || rel > wr.height * 0.62) {
            wrap.scrollTo({ top: wrap.scrollTop + rel - target, behavior: instant ? 'auto' : 'smooth' });
        }
    }

    /* --- Pautador de línea --- */
    function positionBand(i) {
        const w = state.win;
        const lines = ensureLines();
        if (!lines || !w.band) return;
        const k = lowerBound(lines.starts, i);
        const pad = settings.pageSize * 0.2;
        w.band.style.top = (lines.tops[k] - pad) + 'px';
        w.band.style.height = (lines.heights[k] + pad * 2) + 'px';
        const p = w.pacer;
        p.style.transition = 'none';
        p.style.top = (lines.tops[k] + lines.heights[k] + 1) + 'px';
        const first = spanAt(lines.starts[k]);
        p.style.left = (first ? first.offsetLeft : 0) + 'px';
        p.style.width = '0px';
        p.classList.toggle('is-on', state.playing);
    }

    function animatePacer(dur) {
        const w = state.win;
        if (!w.pacer) return;
        const lines = ensureLines();
        const k = lowerBound(lines.starts, state.pos);
        const lastIdx = (k + 1 < lines.starts.length ? lines.starts[k + 1] : w.end) - 1;
        const first = spanAt(lines.starts[k]);
        const last = spanAt(lastIdx);
        if (!first || !last) return;
        const width = last.offsetLeft + last.offsetWidth - first.offsetLeft;
        const p = w.pacer;
        p.classList.add('is-on');
        p.style.transition = 'none';
        p.style.width = '0px';
        void p.offsetWidth;
        p.style.transition = `width ${dur}ms linear`;
        p.style.width = width + 'px';
    }

    function freezePacer() {
        const p = state.win.pacer;
        if (!p || settings.mode !== 'line') return;
        const cw = getComputedStyle(p).width;
        p.style.transition = 'none';
        p.style.width = cw;
    }

    /* --- Teleprompter: desplazamiento continuo --- */
    function scrollTargetY() {
        const lines = ensureLines();
        if (!lines) return 0;
        const pos = state.pos;
        const k = lowerBound(lines.starts, pos);
        const ls = lines.starts[k];
        const le = k + 1 < lines.starts.length ? lines.starts[k + 1] : state.win.end;
        let frac = 0;
        if (state.playing && state.stepDur) frac = clamp((performance.now() - state.stepStart) / state.stepDur, 0, 1);
        const within = (pos - ls + frac) / Math.max(1, le - ls);
        const lineH = k + 1 < lines.tops.length ? lines.tops[k + 1] - lines.tops[k] : lines.heights[k];
        return el.scrollPage.offsetTop + lines.tops[k] + lineH * within;
    }

    function snapScroll() {
        const wrap = el.scrollWrap;
        wrap.scrollTop = scrollTargetY() - wrap.clientHeight * 0.38;
    }

    function startScrollLoop() {
        stopScrollLoop();
        const wrap = el.scrollWrap;
        const loop = () => {
            const target = scrollTargetY() - wrap.clientHeight * 0.38;
            wrap.scrollTop += (target - wrap.scrollTop) * 0.18;
            state.rafId = requestAnimationFrame(loop);
        };
        state.rafId = requestAnimationFrame(loop);
    }

    function stopScrollLoop() {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
    }

    /* --- Periférica --- */
    function renderPeri() {
        const c = chunks();
        const k = lowerBound(c, state.pos);
        const { words } = state.tok;
        let html = '';
        for (let j = k - 3; j <= k + 3; j++) {
            if (j < 0 || j >= c.length) {
                html += '<div class="peri-line"><span>&nbsp;</span></div>';
                continue;
            }
            const ws = words.slice(c[j], j + 1 < c.length ? c[j + 1] : words.length);
            const half = Math.ceil(ws.length / 2);
            const left = ws.slice(0, half).join(' ');
            const right = ws.slice(half).join(' ');
            const cls = j === k ? ' cur' : j < k ? ' done' : '';
            html += `<div class="peri-line${cls}">` + (right ? `<span>${esc(left)}</span><span>${esc(right)}</span>` : `<span>${esc(left)}</span>`) + '</div>';
        }
        el.periCol.innerHTML = html;
    }

    /* --- Metadatos y barra de progreso --- */
    function updateMeta() {
        const total = n();
        if (!total) return;
        const pos = state.pos;
        const frac = total > 1 ? pos / (total - 1) : 0;
        el.scrubFill.style.width = frac * 100 + '%';
        el.scrubThumb.style.left = frac * 100 + '%';
        el.metaProgress.textContent = Math.round(frac * 100) + '%';
        el.metaWords.textContent = `${fmtNum(pos + 1)} / ${fmtNum(total)} palabras`;
        const left = state.prefix ? (state.prefix[total] - state.prefix[pos]) * (60000 / settings.wpm) : 0;
        el.metaLeft.textContent = left > 0 ? `Quedan ${fmtDuration(left)}` : 'Terminado';
    }

    function updatePlayButton() {
        el.play.innerHTML = `<svg><use href="#i-${state.playing ? 'pause' : 'play'}"/></svg>`;
        el.play.setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproducir');
        el.app.classList.toggle('is-playing', state.playing);
        if (state.win.pacer) state.win.pacer.classList.toggle('is-on', state.playing);
    }

    /* --- Tarjeta de fin y test de comprensión --- */
    function showFinish(sess) {
        const words = sess ? sess.words : 0;
        const ms = sess ? sess.ms : 0;
        const real = ms > 0 ? Math.round(words / (ms / 60000)) : 0;
        const canQuiz = LV.training && typeof LV.training.cloze === 'function';
        el.finish.innerHTML = `
            <div class="finish-inner">
                <h2>¡Lectura completada! 🎉</h2>
                <p>${esc(state.book.title)}</p>
                <div class="finish-grid">
                    <div><strong>${fmtNum(words)}</strong><small>palabras</small></div>
                    <div><strong>${fmtClock(ms)}</strong><small>tiempo</small></div>
                    <div><strong>${fmtNum(real)}</strong><small>ppm reales</small></div>
                </div>
                <div class="btn-row">
                    ${canQuiz ? '<button class="btn" data-act="quiz">Test de comprensión</button>' : ''}
                    <button class="btn btn-ghost" data-act="restart">Leer de nuevo</button>
                    <button class="btn btn-ghost" data-act="close">Cerrar</button>
                </div>
            </div>`;
        el.finish.hidden = false;
        state.lastSession = { words, ms, real };
        el.finish.onclick = (e) => {
            const act = e.target.closest('[data-act]');
            if (!act) return;
            if (act.dataset.act === 'quiz') showQuiz();
            if (act.dataset.act === 'restart') { hideFinish(); seek(0); }
            if (act.dataset.act === 'close') hideFinish();
        };
        flushSession({ finished: true });
    }

    function showQuiz() {
        // Preguntas sobre las últimas ~1200 palabras leídas
        const { words } = state.tok;
        const from = Math.max(0, n() - 1200);
        const text = words.slice(from).join(' ');
        const qs = LV.training.cloze(text, 4);
        if (!qs.length) {
            toast('El texto es demasiado corto para generar preguntas.');
            return;
        }
        let k = 0;
        let correct = 0;
        const inner = $('.finish-inner', el.finish);
        const showQ = () => {
            if (k >= qs.length) {
                const pct = correct / qs.length;
                const real = state.lastSession ? state.lastSession.real : 0;
                const eff = Math.round(real * pct);
                inner.innerHTML = `
                    <h2>Resultado</h2>
                    <p>Comprensión estimada con preguntas de completar.</p>
                    <div class="finish-grid">
                        <div><strong>${correct}/${qs.length}</strong><small>aciertos</small></div>
                        <div><strong>${Math.round(pct * 100)}%</strong><small>comprensión</small></div>
                        <div><strong>${fmtNum(eff)}</strong><small>ppm efectivas</small></div>
                    </div>
                    <p class="fine">PPM efectivas = velocidad real × comprensión. ${pct < 0.7 ? 'Prueba a bajar un poco la velocidad.' : 'Buen equilibrio: puedes subir un 5–10 %.'}</p>
                    <div class="btn-row" style="margin-top:16px"><button class="btn" data-act="close">Listo</button></div>`;
                const s = S.stats.load();
                const last = s.sessions[s.sessions.length - 1];
                if (last && last.bookId === state.book.id) {
                    last.comprehension = pct;
                    last.effective = eff;
                    try { localStorage.setItem('lv.stats', JSON.stringify(s)); } catch (e) { /* lleno */ }
                }
                return;
            }
            const q = qs[k];
            inner.innerHTML = `
                <p class="fine">Pregunta ${k + 1} de ${qs.length}</p>
                <h2 style="font-size:18px;font-family:var(--font-read);font-weight:500;margin:12px 0 16px;line-height:1.5">${esc(q.sentence)}</h2>
                <div class="quiz-options">${q.options.map((o, i) => `<button class="btn btn-ghost" data-opt="${i}">${esc(o)}</button>`).join('')}</div>`;
        };
        el.finish.onclick = (e) => {
            const opt = e.target.closest('[data-opt]');
            const act = e.target.closest('[data-act]');
            if (act && act.dataset.act === 'close') { hideFinish(); return; }
            if (!opt) return;
            const q = qs[k];
            const chosen = Number(opt.dataset.opt);
            if (chosen === q.answer) correct++;
            $$('[data-opt]', inner).forEach((b) => {
                b.disabled = true;
                const i = Number(b.dataset.opt);
                if (i === q.answer) b.classList.add('is-right');
                else if (i === chosen) b.classList.add('is-wrong');
            });
            k++;
            setTimeout(showQ, 700);
        };
        showQ();
    }

    function hideFinish() {
        el.finish.hidden = true;
        el.finish.innerHTML = '';
    }

    /* =====================================================
       Barra de modos y controles
       ===================================================== */
    function buildModeBar() {
        el.modeBar.innerHTML = MODES.map((m, i) => `<button class="mode-pill" role="tab" data-mode="${m.id}" aria-selected="false" title="${esc(m.desc)} (${i + 1})"><span class="mode-dot"></span>${m.name}</button>`).join('');
        el.modeBar.addEventListener('click', (e) => {
            const b = e.target.closest('[data-mode]');
            if (b) setMode(b.dataset.mode);
        });

        $('#mode-cards').innerHTML = MODES.map((m, i) => `
            <button class="mode-card" data-mode="${m.id}">
                <div class="mode-demo">${m.demo}</div>
                <h3>${m.name}<span class="mode-key">${i + 1}</span></h3>
                <p>${esc(m.desc)}</p>
            </button>`).join('');
        $('#mode-cards').addEventListener('click', async (e) => {
            const b = e.target.closest('[data-mode]');
            if (!b) return;
            settings.mode = b.dataset.mode;
            S.settings.save(settings);
            const recent = (await S.books.all())[0];
            if (recent) openBook(recent);
            else openSample();
        });
    }

    function setMode(id) {
        if (!MODE[id]) return;
        const wasPlaying = state.playing;
        if (wasPlaying) pause(false);
        stopScrollLoop();
        settings.mode = id;
        S.settings.save(settings);
        $$('.mode-pill').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === id)));
        const active = $(`.mode-pill[data-mode="${id}"]`);
        if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        invalidateWindow();
        if (state.tok) {
            state.pos = unitStart(state.pos);
            render({ jump: true });
            if (MODE[id].kind === 'page' || MODE[id].kind === 'scroll') state.pos = unitStart(state.pos);
        }
        if (wasPlaying) play();
    }

    function bindControls() {
        el.play.addEventListener('click', toggle);
        $('#btn-prev').addEventListener('click', () => step(-1));
        $('#btn-next').addEventListener('click', () => step(1));
        $('#btn-back-sentence').addEventListener('click', () => stepSentence(-1));
        $('#btn-fwd-sentence').addEventListener('click', () => stepSentence(1));
        $('#wpm-down').addEventListener('click', () => changeWpm(-25));
        $('#wpm-up').addEventListener('click', () => changeWpm(25));
        $('#chunk-down').addEventListener('click', () => setSetting('chunkSize', clamp(settings.chunkSize - 1, 1, 8)));
        $('#chunk-up').addEventListener('click', () => setSetting('chunkSize', clamp(settings.chunkSize + 1, 1, 8)));
        $('#btn-fullscreen').addEventListener('click', toggleFullscreen);
        $('#theme-cycle').addEventListener('click', cycleTheme);
        $('#go-home').addEventListener('click', showHome);

        // Clic en el escenario
        el.rsvp.addEventListener('click', toggle);
        el.peri.addEventListener('click', toggle);
        [el.page, el.scrollPage].forEach((p) => p.addEventListener('click', (e) => {
            const w = e.target.closest('.w');
            if (w) seek(Number(w.dataset.i));
        }));

        // Barra de progreso
        const scrub = el.scrubber;
        const fracAt = (x) => {
            const r = scrub.getBoundingClientRect();
            return clamp((x - r.left) / r.width, 0, 1);
        };
        let dragging = false;
        scrub.addEventListener('pointerdown', (e) => {
            if (!state.tok) return;
            dragging = true;
            scrub.setPointerCapture(e.pointerId);
            scrub.classList.add('is-drag');
            seek(Math.round(fracAt(e.clientX) * (n() - 1)));
        });
        scrub.addEventListener('pointermove', (e) => {
            if (!state.tok) return;
            const f = fracAt(e.clientX);
            const i = Math.round(f * (n() - 1));
            el.scrubTip.hidden = false;
            el.scrubTip.style.left = f * 100 + '%';
            el.scrubTip.textContent = `${Math.round(f * 100)}% · ${state.tok.words.slice(i, i + 6).join(' ')}…`;
            if (dragging) seek(i);
        });
        const end = () => { dragging = false; scrub.classList.remove('is-drag'); };
        scrub.addEventListener('pointerup', end);
        scrub.addEventListener('pointercancel', end);
        scrub.addEventListener('pointerleave', () => { el.scrubTip.hidden = true; });

        // Gestos táctiles en RSVP: deslizar para avanzar/retroceder
        let touchX = null;
        el.stage.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
        el.stage.addEventListener('touchend', (e) => {
            if (touchX === null || mode().kind === 'page' || mode().kind === 'scroll') return;
            const dx = e.changedTouches[0].clientX - touchX;
            touchX = null;
            if (Math.abs(dx) > 60) {
                stepSentence(dx < 0 ? 1 : -1);
                e.preventDefault();
            }
        });

        window.addEventListener('resize', debounce(() => {
            if (state.win.el) {
                state.win.lines = null;
                if (settings.mode === 'gradient') paintGradient();
                if (!el.reader.hidden) render({ jump: true });
            }
        }, 150));

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (state.playing) pause(true);
                flushSession();
                saveProgress(true);
            }
        });
        window.addEventListener('pagehide', () => { flushSession(); saveProgress(true); });
    }

    function debounce(fn, ms) {
        let t = 0;
        return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    }

    function changeWpm(delta) {
        setSetting('wpm', clamp(Math.round((settings.wpm + delta) / 5) * 5, 60, 1500));
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
        else document.exitFullscreen?.();
    }

    function cycleTheme() {
        const ids = THEMES.map((t) => t.id);
        const next = ids[(ids.indexOf(settings.theme) + 1) % ids.length];
        setSetting('theme', next);
        toast('Tema: ' + THEMES.find((t) => t.id === next).name, { duration: 1400 });
    }

    function bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (document.querySelector('dialog[open]') && e.key !== 'Escape') return;
            const inReader = !el.reader.hidden && state.tok;
            const k = e.key;
            if (k === 'Escape') { closePanels(); return; }
            if (k === '?') { openPanel('shortcuts'); return; }
            if (k === 't' || k === 'T') { cycleTheme(); return; }
            if (k === 's' || k === 'S') { openPanel('settings'); return; }
            if (k === 'b' || k === 'B') { openPanel('library'); return; }
            if (!inReader) return;
            if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
            else if (k === 'ArrowRight') { e.preventDefault(); e.shiftKey ? stepSentence(1) : step(1); }
            else if (k === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? stepSentence(-1) : step(-1); }
            else if (k === 'ArrowUp') { e.preventDefault(); changeWpm(25); }
            else if (k === 'ArrowDown') { e.preventDefault(); changeWpm(-25); }
            else if (k === '[') setSetting('chunkSize', clamp(settings.chunkSize - 1, 1, 8));
            else if (k === ']') setSetting('chunkSize', clamp(settings.chunkSize + 1, 1, 8));
            else if (k === 'f' || k === 'F') toggleFullscreen();
            else if (k === 'Home') { e.preventDefault(); seek(0); }
            else if (k === 'End') { e.preventDefault(); seek(n() - 1); }
            else if (k === '+' || k === '=') setSetting(mode().kind === 'rsvp' ? 'rsvpSize' : 'pageSize', mode().kind === 'rsvp' ? clamp(settings.rsvpSize + 4, 28, 120) : clamp(settings.pageSize + 1, 14, 32));
            else if (k === '-') setSetting(mode().kind === 'rsvp' ? 'rsvpSize' : 'pageSize', mode().kind === 'rsvp' ? clamp(settings.rsvpSize - 4, 28, 120) : clamp(settings.pageSize - 1, 14, 32));
            else if (/^[1-9]$/.test(k) && MODES[Number(k) - 1]) setMode(MODES[Number(k) - 1].id);
        });
    }

    /* =====================================================
       Paneles
       ===================================================== */
    const PANELS = { library: '#panel-library', settings: '#panel-settings', stats: '#panel-stats' };
    const DIALOGS = { paste: '#modal-paste', shortcuts: '#modal-shortcuts' };

    function openPanel(name) {
        if (DIALOGS[name]) {
            const d = $(DIALOGS[name]);
            if (!d.open) d.showModal();
            if (name === 'paste') setTimeout(() => $('#paste-text').focus(), 30);
            return;
        }
        closePanels();
        const p = $(PANELS[name]);
        if (!p) return;
        if (name === 'library') renderLibrary();
        if (name === 'stats') renderStats();
        p.hidden = false;
        el.scrim.hidden = false;
        const focusable = p.querySelector('input, button');
        if (focusable) focusable.focus({ preventScroll: true });
    }

    function closePanels() {
        Object.values(PANELS).forEach((s) => { $(s).hidden = true; });
        el.scrim.hidden = true;
    }

    function bindPanels() {
        document.addEventListener('click', (e) => {
            const open = e.target.closest('[data-open]');
            if (open) { openPanel(open.dataset.open); return; }
            if (e.target.closest('[data-close]')) closePanels();
        });
        el.scrim.addEventListener('click', closePanels);
        $('#library-search').addEventListener('input', debounce(renderLibrary, 120));

        const pasteText = $('#paste-text');
        pasteText.addEventListener('input', () => {
            $('#paste-count').textContent = `${fmtNum(T.countWords(pasteText.value))} palabras`;
        });
        $('#modal-paste').addEventListener('close', async () => {
            const d = $('#modal-paste');
            if (d.returnValue !== 'ok') return;
            const text = pasteText.value.trim();
            if (!text) return;
            const title = $('#paste-title').value.trim() || titleFrom(text);
            pasteText.value = '';
            $('#paste-title').value = '';
            $('#paste-count').textContent = '0 palabras';
            await addAndOpen({ title, text, source: 'texto pegado' });
        });
    }

    /* =====================================================
       Biblioteca
       ===================================================== */
    function bookCard(b, opts = {}) {
        const pct = b.wordCount > 1 ? Math.round((b.index / (b.wordCount - 1)) * 100) : 0;
        const hue = hashHue(b.title);
        const left = Math.max(0, b.wordCount - b.index) / settings.wpm * 60000;
        const initial = esc((b.title.trim()[0] || '?').toUpperCase());
        const active = state.book && state.book.id === b.id ? ' is-active' : '';
        return `
            <div class="book-card${active}" data-book="${b.id}" role="button" tabindex="0">
                <div class="book-row">
                    <span class="book-cover" style="background:hsl(${hue} 50% 42%)">${initial}</span>
                    <div class="book-text">
                        <div class="book-title" title="${esc(b.title)}">${esc(b.title)}</div>
                        <div class="book-meta">${fmtNum(b.wordCount)} palabras · ${b.finished && pct >= 99 ? 'Terminado' : 'quedan ' + fmtDuration(left)}</div>
                    </div>
                </div>
                <div class="bar"><i style="width:${pct}%"></i></div>
                <div class="book-meta">${pct}% leído${b.source ? ' · ' + esc(b.source) : ''}</div>
                ${opts.noDelete ? '' : `<button class="book-delete" data-delete="${b.id}" title="Eliminar"><svg><use href="#i-trash"/></svg></button>`}
            </div>`;
    }

    async function renderLibrary() {
        const q = $('#library-search').value.trim().toLowerCase();
        const list = (await S.books.all()).filter((b) => !q || b.title.toLowerCase().includes(q));
        const host = $('#library-list');
        host.innerHTML = list.length
            ? list.map((b) => bookCard(b)).join('')
            : `<div class="empty">${q ? 'Sin resultados.' : 'Tu biblioteca está vacía.<br>Añade un archivo o pega un texto para empezar.'}</div>`;
    }

    async function renderRecent() {
        const list = (await S.books.all()).slice(0, 4);
        $('#continue-section').hidden = list.length === 0;
        $('#recent-books').innerHTML = list.map((b) => bookCard(b)).join('');
    }

    function bindLibrary() {
        const handler = async (e) => {
            const del = e.target.closest('[data-delete]');
            if (del) {
                e.stopPropagation();
                const book = await S.books.get(del.dataset.delete);
                if (!book || !confirm(`¿Eliminar «${book.title}» de la biblioteca?`)) return;
                await S.books.remove(book.id);
                if (state.book && state.book.id === book.id) { pause(false); state.book = null; state.tok = null; showHome(); }
                renderLibrary();
                renderRecent();
                toast('Libro eliminado');
                return;
            }
            const card = e.target.closest('[data-book]');
            if (!card) return;
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const book = await S.books.get(card.dataset.book);
            if (book) { closePanels(); openBook(book); }
        };
        ['#library-list', '#recent-books'].forEach((s) => {
            $(s).addEventListener('click', handler);
            $(s).addEventListener('keydown', handler);
        });
    }

    /* =====================================================
       Abrir textos
       ===================================================== */
    function titleFrom(text) {
        const first = text.trim().split(/\s+/).slice(0, 7).join(' ');
        return first.length > 60 ? first.slice(0, 57) + '…' : first + (T.countWords(text) > 7 ? '…' : '');
    }

    async function addAndOpen({ title, text, source }, autoplay) {
        if (!text || !text.trim()) {
            toast('No se encontró texto para leer.', { error: true });
            return;
        }
        const book = await S.books.create({ title, text, source });
        openBook(book);
        if (autoplay) setTimeout(play, 250);
    }

    function openBook(book) {
        if (state.playing) pause(false);
        flushSession();
        hideFinish();
        state.book = book;
        state.tok = T.tokenize(book.text);
        state.chunkCache.clear();
        buildPrefix();
        state.pos = clamp(book.index || 0, 0, Math.max(0, n() - 1));
        state.pausedByUser = false;
        invalidateWindow();
        if (state.win.el) state.win.el.innerHTML = '';
        state.win.el = null;
        book.lastOpened = Date.now();
        S.books.patch(book.id, { lastOpened: book.lastOpened }).catch(() => {});
        showReader();
        state.pos = unitStart(state.pos);
        render({ jump: true });
        if (book.wordCount !== n()) S.books.patch(book.id, { wordCount: n() }).catch(() => {});
    }

    function openSample() {
        addAndOpen({ title: T.SAMPLE.title, text: T.SAMPLE.text, source: 'ejemplo' });
    }

    function showReader() {
        el.home.hidden = true;
        el.reader.hidden = false;
        el.title.textContent = state.book ? state.book.title : '';
        $$('.mode-pill').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === settings.mode)));
        updateSessionClock();
    }

    function showHome() {
        if (state.playing) pause(false);
        flushSession();
        saveProgress(true);
        el.reader.hidden = true;
        el.home.hidden = false;
        el.title.textContent = '';
        renderRecent();
        renderHomeStats();
    }

    /* --- Importación de archivos --- */
    async function importFiles(files) {
        const list = [...files];
        if (!list.length) return;
        const imp = LV.importers;
        let opened = null;
        for (const file of list) {
            const isImg = /^image\//.test(file.type);
            const t = toast(isImg ? 'Reconociendo texto de la imagen…' : `Importando «${file.name}»…`, { progress: true });
            try {
                const res = isImg
                    ? await imp.importImage(file, (pct, msg) => t.update(pct, msg))
                    : await imp.importFile(file);
                t.close();
                if (!res.text || !res.text.trim()) throw new Error('No se encontró texto en el archivo.');
                opened = await S.books.create({ title: res.title || file.name, text: res.text, source: isImg ? 'OCR' : (file.name.split('.').pop() || '').toUpperCase() });
            } catch (err) {
                t.close();
                toast(err && err.message ? err.message : 'No se pudo importar el archivo.', { error: true, duration: 5000 });
            }
        }
        if (opened) {
            if (list.length > 1) toast(`${list.length} archivos añadidos a la biblioteca`);
            openBook(opened);
        }
        renderLibrary();
    }

    async function importImageBlob(blob, autoplay) {
        if (!LV.importers) return;
        const t = toast('Reconociendo texto de la imagen…', { progress: true });
        try {
            const res = await LV.importers.importImage(blob, (pct, msg) => t.update(pct, msg));
            t.close();
            await addAndOpen({ title: res.title, text: res.text, source: 'OCR' }, autoplay);
        } catch (err) {
            t.close();
            toast(err.message || 'No se pudo leer la imagen.', { error: true });
        }
    }

    function bindImport() {
        el.fileInput.addEventListener('change', () => {
            importFiles(el.fileInput.files);
            el.fileInput.value = '';
        });

        const dz = $('#dropzone');
        let depth = 0;
        window.addEventListener('dragenter', (e) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
            depth++;
            document.body.classList.add('is-dragging');
        });
        window.addEventListener('dragleave', () => {
            depth = Math.max(0, depth - 1);
            if (!depth) document.body.classList.remove('is-dragging');
        });
        window.addEventListener('dragover', (e) => { e.preventDefault(); });
        window.addEventListener('drop', (e) => {
            e.preventDefault();
            depth = 0;
            document.body.classList.remove('is-dragging');
            dz.classList.remove('is-over');
            if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
        });
        dz.addEventListener('dragover', () => dz.classList.add('is-over'));
        dz.addEventListener('dragleave', () => dz.classList.remove('is-over'));

        // Pegar texto o capturas (p. ej. desde PixPin) en cualquier parte
        document.addEventListener('paste', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            const items = e.clipboardData ? [...e.clipboardData.items] : [];
            const img = items.find((it) => it.type.startsWith('image/'));
            if (img) {
                e.preventDefault();
                importImageBlob(img.getAsFile(), false);
                return;
            }
            const text = e.clipboardData && e.clipboardData.getData('text/plain');
            if (text && T.countWords(text) >= 3) {
                e.preventDefault();
                addAndOpen({ title: titleFrom(text), text, source: 'portapapeles' });
            }
        });

        $('#load-sample').addEventListener('click', openSample);
        $('#read-clipboard').addEventListener('click', readClipboard);
    }

    async function readClipboard() {
        try {
            const tauri = window.__TAURI__;
            if (tauri && tauri.core) {
                const text = await tauri.core.invoke('read_clipboard');
                if (text) return addAndOpen({ title: titleFrom(text), text, source: 'portapapeles' });
            }
            if (navigator.clipboard && navigator.clipboard.read) {
                try {
                    const items = await navigator.clipboard.read();
                    for (const it of items) {
                        const type = it.types.find((t) => t.startsWith('image/'));
                        if (type) return importImageBlob(await it.getType(type), false);
                    }
                } catch (e) { /* sin permiso para imágenes: probar texto */ }
            }
            const text = navigator.clipboard ? await navigator.clipboard.readText() : '';
            if (text && text.trim()) return addAndOpen({ title: titleFrom(text), text, source: 'portapapeles' });
            toast('El portapapeles está vacío. Copia un texto o una captura y vuelve a intentarlo.');
        } catch (err) {
            toast('No se pudo acceder al portapapeles. Pulsa Ctrl+V para pegar.', { error: true });
        }
    }

    /* --- Integración de escritorio (Tauri): atajo global y PixPin --- */
    function bindNative() {
        const tauri = window.__TAURI__;
        if (!tauri || !tauri.event) return;
        let last = { key: '', at: 0 };
        const fresh = (key) => {
            // El mismo contenido puede llegar por evento y por quick_read_ready
            const dup = key === last.key && Date.now() - last.at < 1500;
            last = { key, at: Date.now() };
            return !dup;
        };
        const readText = (text) => {
            text = String(text || '');
            if (text.trim() && fresh(text)) addAndOpen({ title: titleFrom(text), text, source: 'lectura rápida' }, true);
        };
        const readImage = async (dataUrl) => {
            if (!dataUrl || !fresh(String(dataUrl).slice(0, 200))) return;
            try {
                const blob = await (await fetch(String(dataUrl))).blob();
                importImageBlob(blob, true);
            } catch (err) {
                toast('No se pudo leer la imagen del portapapeles.', { error: true });
            }
        };
        (async () => {
            await tauri.event.listen('quick-read', (e) => readText(e.payload));
            await tauri.event.listen('quick-read-image', (e) => readImage(e.payload));
            try {
                const p = await tauri.core.invoke('quick_read_ready');
                if (p && p.type === 'text') readText(p.text);
                else if (p && p.type === 'image') readImage(p.dataUrl);
            } catch (e) { /* comando no disponible */ }
        })();
    }

    /* =====================================================
       Estadísticas
       ===================================================== */
    function computeStats() {
        const s = S.stats.load();
        const sessions = s.sessions;
        const words = sessions.reduce((a, x) => a + x.words, 0);
        const ms = sessions.reduce((a, x) => a + x.ms, 0);
        const avg = ms > 0 ? words / (ms / 60000) : 0;
        const dayKey = (d) => new Date(d).toDateString();
        const days = new Set(sessions.map((x) => dayKey(x.date)));
        let streak = 0;
        const d = new Date();
        if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
        while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
        const week = [];
        for (let i = 6; i >= 0; i--) {
            const day = new Date();
            day.setDate(day.getDate() - i);
            const key = day.toDateString();
            const m = sessions.filter((x) => dayKey(x.date) === key).reduce((a, x) => a + x.ms, 0);
            week.push({ label: day.toLocaleDateString('es', { weekday: 'short' }).slice(0, 2), ms: m, today: i === 0 });
        }
        const quizzes = sessions.filter((x) => typeof x.comprehension === 'number');
        const comp = quizzes.length ? quizzes.reduce((a, x) => a + x.comprehension, 0) / quizzes.length : null;
        return { sessions, words, ms, avg, streak, week, best: s.best || 0, comp };
    }

    function renderHomeStats() {
        const st = computeStats();
        const host = $('#home-stats');
        if (!st.sessions.length) { host.innerHTML = ''; return; }
        host.innerHTML = `
            <div class="stat-tile"><small>Palabras leídas</small><strong>${fmtNum(st.words)}</strong></div>
            <div class="stat-tile"><small>Tiempo de lectura</small><strong>${fmtDuration(st.ms)}</strong></div>
            <div class="stat-tile"><small>Velocidad media</small><strong>${fmtNum(st.avg)}</strong><em>ppm</em></div>
            <div class="stat-tile"><small>Racha</small><strong>${st.streak}</strong><em>${st.streak === 1 ? 'día' : 'días'}</em></div>`;
    }

    function renderStats() {
        const st = computeStats();
        const maxMs = Math.max(60000, ...st.week.map((d) => d.ms));
        const recent = st.sessions.slice(-12).reverse();
        $('#stats-body').innerHTML = `
            <div class="stats-grid">
                <div class="stat-tile"><small>Palabras leídas</small><strong>${fmtNum(st.words)}</strong></div>
                <div class="stat-tile"><small>Tiempo total</small><strong>${fmtDuration(st.ms)}</strong></div>
                <div class="stat-tile"><small>Velocidad media</small><strong>${fmtNum(st.avg)}</strong><em>ppm</em></div>
                <div class="stat-tile"><small>Mejor marca</small><strong>${fmtNum(st.best)}</strong><em>ppm</em></div>
                <div class="stat-tile"><small>Racha actual</small><strong>${st.streak}</strong><em>${st.streak === 1 ? 'día' : 'días'}</em></div>
                <div class="stat-tile"><small>Comprensión media</small><strong>${st.comp === null ? '—' : Math.round(st.comp * 100) + '%'}</strong></div>
            </div>
            <div class="chart">
                <h3>Minutos de lectura · últimos 7 días</h3>
                <div class="chart-bars">
                    ${st.week.map((d) => `<div class="chart-bar${d.today ? ' is-today' : ''}" title="${fmtDuration(d.ms)}"><i style="height:${Math.round((d.ms / maxMs) * 100)}%"></i><small>${d.label}</small></div>`).join('')}
                </div>
            </div>
            <div class="session-list">
                ${recent.length ? recent.map((x) => `<div class="session-item"><span>${esc(x.title || 'Lectura')} · ${esc((MODE[x.mode] || {}).name || '')}</span><span>${fmtNum(x.words)} pal · ${fmtNum(x.words / Math.max(1, x.ms / 60000))} ppm${typeof x.comprehension === 'number' ? ' · ' + Math.round(x.comprehension * 100) + '%' : ''}</span></div>`).join('') : '<div class="empty">Aún no hay sesiones. ¡Empieza a leer!</div>'}
            </div>
            <div class="evidence">
                <strong>Sobre la evidencia.</strong> La investigación (Rayner et al., 2016) muestra que existe un equilibrio entre velocidad y comprensión: leer mucho más rápido suele costar comprensión, sobre todo en textos difíciles. Usa los test de comprensión, sube la velocidad poco a poco y vuelve a un ritmo cómodo cuando lo necesites.
            </div>`;
    }

    /* =====================================================
       Entrenamiento
       ===================================================== */
    function bindTraining() {
        const btn = $('#open-training');
        const view = $('#view-training');
        if (!btn || !view || !LV.training) {
            if (btn) btn.hidden = true;
            return;
        }
        btn.addEventListener('click', () => {
            if (state.playing) pause(false);
            el.home.hidden = true;
            el.reader.hidden = true;
            view.hidden = false;
            LV.training.mount(view, {
                onExit: () => {
                    LV.training.unmount();
                    view.hidden = true;
                    if (state.tok && el.title.textContent) showReader();
                    else showHome();
                },
                getText: () => (state.book ? state.book.text : T.SAMPLE.text),
                onResult: () => {},
            });
        });
    }

    /* =====================================================
       Inicio
       ===================================================== */
    async function init() {
        applyAppearance();
        buildSettingsUI();
        syncSettingsUI();
        buildModeBar();
        bindControls();
        bindKeyboard();
        bindPanels();
        bindLibrary();
        bindImport();
        bindNative();
        bindTraining();
        $('.eyebrow').lastChild.textContent = ` ${MODES.length} modos de lectura`;

        try {
            const migrated = await S.books.migrateLegacy();
            if (migrated) toast(`Se importaron ${migrated} libros de la versión anterior`);
        } catch (e) { /* sin migración */ }

        showHome();

        if ('serviceWorker' in navigator && !window.__TAURI__ && location.protocol.startsWith('http')) {
            window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
        }

        // Atajos desde la URL: ?text=... o #sample (útil para compartir o integraciones)
        const params = new URLSearchParams(location.search);
        const shared = params.get('text') || params.get('t');
        if (shared) addAndOpen({ title: params.get('title') || titleFrom(shared), text: shared, source: 'compartido' });
    }

    // API mínima para depuración y pruebas automatizadas
    LV.app = { state, settings, setMode, play, pause, seek, openSample, setSetting };

    init();
})();
