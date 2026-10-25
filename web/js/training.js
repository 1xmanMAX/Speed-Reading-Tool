/* Lectura Veloz — entrenamiento
 * Ejercicios de atención y amplitud visual: Tabla de Schulte, Destello,
 * Expansión de bloques y Prueba de velocidad base (con preguntas de cierre).
 * API: LV.training.mount(container, opts), LV.training.unmount(), LV.training.cloze(text, count)
 */
window.LV = window.LV || {};

(function () {
    'use strict';

    const STORE_KEY = 'lv.training';

    const SAMPLE_TEXT = [
        'La lectura es una de las habilidades más importantes que desarrollamos a lo largo de la vida. Cuando leemos, los ojos no se deslizan de manera continua sobre la línea: avanzan a pequeños saltos llamados movimientos sacádicos y se detienen en fijaciones breves, durante las cuales el cerebro reconoce varias letras a la vez.',
        'Muchos lectores pronuncian mentalmente cada palabra. Esta voz interior ayuda a comprender, pero también marca un ritmo cómodo que rara vez cambia. Practicar con textos sencillos permite descubrir que es posible avanzar algo más rápido sin perder el hilo de la historia.',
        'La atención es un recurso limitado. Cuando la mente se distrae, los ojos regresan a frases ya leídas y el tiempo de lectura aumenta. Por eso conviene leer en un lugar tranquilo, con buena iluminación y con un objetivo claro: saber qué buscamos en el texto antes de comenzar.',
        'El vocabulario también influye. Un lector que conoce muchas palabras las reconoce de inmediato y dedica su esfuerzo a comprender las ideas. Leer con frecuencia, consultar el diccionario y comentar lo leído con otras personas son hábitos que fortalecen la comprensión con el paso de los meses.',
        'Los ejercicios de entrenamiento visual no hacen milagros, pero ayudan a mantener la concentración y a explorar el campo de visión periférica. Lo importante es practicar unos minutos cada día, observar el propio progreso con honestidad y recordar que comprender bien vale más que terminar deprisa.',
        'En las bibliotecas antiguas, los libros eran objetos valiosos que se copiaban a mano durante meses. Hoy tenemos acceso a millones de textos con un solo gesto, y el reto ya no es encontrar información, sino elegir con cuidado qué leer y dedicarle una atención profunda y tranquila.',
        'Una buena estrategia consiste en hacer una lectura previa: mirar los títulos, las primeras frases de cada párrafo y las conclusiones. Con ese mapa mental, la lectura detallada resulta más fluida, porque el cerebro anticipa la estructura del argumento y relaciona cada detalle con la idea general.',
        'Finalmente, el descanso importa. Los ojos se fatigan después de largos periodos frente a una pantalla. Levantar la mirada, enfocar objetos lejanos y parpadear con frecuencia son gestos simples que protegen la vista y permiten volver al texto con energía renovada.'
    ].join('\n\n');

    const STOPWORDS = new Set((
        'a al algo algun alguna algunas alguno algunos alguien ante antes aquel aquella aquellas aquello aquellos aqui alli ahi asi aun aunque ' +
        'bajo bien cada casi como con contra cual cuales cualquier cuando cuanta cuantas cuanto cuantos de del desde donde dos durante ' +
        'e el ella ellas ello ellos en entonces entre era eran eramos eres es esa esas ese eso esos esta estaba estaban estabamos estado estamos estan estar estas este esto estos estoy ' +
        'fue fuera fueron fui fuimos ha haber habia habian habra habria han has hasta hay haya hayan he hecho hemos hacia hacer hace hacen hizo hubo hubiera ' +
        'la las le les lo los luego mas me mi mientras mio mia mis misma mismas mismo mismos mucha muchas mucho muchos muy menos ' +
        'nada nadie ni ninguna ninguno no nos nosotras nosotros nuestra nuestras nuestro nuestros nunca o os otra otras otro otros ' +
        'para pero poco pocos podia podria pueden puede pues por porque que quien quienes se sea sean segun ser seria serian si sido siempre siendo sin sino sobre sois solo somos son soy su sus suya suyo ' +
        'tal tambien tan tanta tantas tanto tantos te tenemos tener tengo tenia tenian tiene tienen toda todas todavia todo todos tras tu tus tuya tuyo ' +
        'u un una unas uno unos usted ustedes va vamos van varias varios vez veces vosotros vuestra vuestro y ya yo ' +
        'ademas ahora alrededor apenas despues dentro fuera encima debajo delante detras incluso mediante parece pudo pueda puedan quiza quizas realmente ' +
        'tambien tampoco ningun cierto cierta ciertos ciertas demas mientras aquellas cuyo cuya cuyos cuyas donde adonde'
    ).split(/\s+/));

    const FALLBACK_DISTRACTORS = [
        'camino', 'ventana', 'memoria', 'lenguaje', 'montaña', 'historia', 'proyecto', 'silencio', 'energía', 'distancia',
        'pregunta', 'equilibrio', 'frontera', 'costumbre', 'sendero', 'mercado', 'pintura', 'relato', 'ciudad', 'materia'
    ];

    // ---------- utilidades ----------
    function norm(s) {
        return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }
    function isStop(w) { return STOPWORDS.has(norm(w)); }
    const WORD_RE = /[\p{L}][\p{L}\p{M}'’-]*[\p{L}]|[\p{L}]/gu;

    function cleanText(t) {
        return String(t || '').replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').trim();
    }
    function paragraphsOf(text) {
        const t = cleanText(text);
        let ps = t.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
        if (ps.length < 3) ps = t.split(/\n/).map(p => p.trim()).filter(Boolean);
        return ps;
    }
    function wordsOf(text) {
        return cleanText(text).split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
    }
    function bareWord(w) {
        return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    }
    function splitSentences(text) {
        const flat = cleanText(text).replace(/\s*\n+\s*/g, ' ');
        const out = [];
        const re = /[^.!?…]+(?:[.!?…]+["»”')\]]*|$)/g;
        let m;
        while ((m = re.exec(flat))) {
            const s = m[0].trim();
            if (s) out.push(s);
            if (m[0].length === 0) re.lastIndex++;
        }
        return out;
    }
    function fmtTime(ms) {
        const s = ms / 1000;
        return s < 60 ? s.toFixed(1).replace('.', ',') + ' s' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') + ' min';
    }

    // Variantes de la misma palabra (plural, género, flexión) no sirven como distractores
    function sameStem(a, b) {
        const n = Math.min(a.length, b.length);
        let i = 0;
        while (i < n && a[i] === b[i]) i++;
        return i >= Math.max(4, n - 2);
    }

    // ---------- generador de preguntas de cierre ----------
    function cloze(text, count) {
        count = Math.max(0, Math.floor(count || 0));
        if (!count || !text) return [];
        const sentences = splitSentences(text);

        // Vocabulario del pasaje (forma original de la primera aparición)
        const vocab = new Map();
        for (const m of cleanText(text).matchAll(WORD_RE)) {
            const w = m[0];
            const k = norm(w);
            if (w.length >= 4 && !STOPWORDS.has(k) && !vocab.has(k)) vocab.set(k, w);
        }

        // Candidatos: oraciones con una palabra de contenido de 5+ letras
        const candidates = [];
        sentences.forEach((s, idx) => {
            const words = s.split(/\s+/);
            if (words.length < 6 || words.length > 45) return;
            let best = null;
            for (const m of s.matchAll(WORD_RE)) {
                const w = m[0];
                if (w.length < 5 || isStop(w) || /['’-]/.test(w)) continue;
                const properNoun = m.index > 0 && /^\p{Lu}/u.test(w);
                if (properNoun) continue;
                if (!best || w.length > best.word.length) best = { word: w, index: m.index };
            }
            if (best) candidates.push({ s, idx, ...best });
        });
        if (!candidates.length) return [];

        // Repartir las preguntas a lo largo del pasaje
        const picked = [];
        const usedAnswers = new Set();
        const buckets = Math.min(count, candidates.length);
        for (let b = 0; b < buckets; b++) {
            const from = Math.floor(b * candidates.length / buckets);
            const to = Math.floor((b + 1) * candidates.length / buckets);
            const slice = shuffle(candidates.slice(from, to));
            const c = slice.find(c => !usedAnswers.has(norm(c.word)));
            if (c) { picked.push(c); usedAnswers.add(norm(c.word)); }
        }
        // Completar si algún tramo no aportó
        if (picked.length < count) {
            for (const c of shuffle(candidates.slice())) {
                if (picked.length >= count) break;
                if (!usedAnswers.has(norm(c.word)) && !picked.includes(c)) { picked.push(c); usedAnswers.add(norm(c.word)); }
            }
        }
        picked.sort((a, b) => a.idx - b.idx);

        return picked.map(c => {
            const answerKey = norm(c.word);
            const atStart = c.index === 0 || /^[^\p{L}]*$/u.test(c.s.slice(0, c.index));
            const answerForm = atStart ? c.word.toLowerCase() : c.word;
            const inSentence = new Set(Array.from(c.s.matchAll(WORD_RE), m => norm(m[0])));
            const seen = new Set([answerKey]);
            const pool = [];
            for (const [k, w] of vocab) {
                if (seen.has(k) || inSentence.has(k) || sameStem(k, answerKey)) continue;
                seen.add(k);
                pool.push(w);
            }
            // Distractores de longitud parecida: los más cercanos, con algo de azar
            shuffle(pool);
            pool.sort((a, b) => Math.abs(a.length - c.word.length) - Math.abs(b.length - c.word.length));
            const near = shuffle(pool.slice(0, 8));
            const distractors = [];
            for (const w of near) {
                if (distractors.length >= 3) break;
                distractors.push(w.toLowerCase());
            }
            for (const w of shuffle(FALLBACK_DISTRACTORS.slice())) {
                if (distractors.length >= 3) break;
                const k = norm(w);
                if (!seen.has(k) && !inSentence.has(k)) { seen.add(k); distractors.push(w); }
            }
            const options = shuffle([answerForm].concat(distractors));
            const sentence = c.s.slice(0, c.index) + '_____' + c.s.slice(c.index + c.word.length);
            return { sentence, options, answer: options.indexOf(answerForm) };
        });
    }

    // ---------- persistencia ----------
    function loadStore() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            const v = raw ? JSON.parse(raw) : null;
            return v && typeof v === 'object' ? v : {};
        } catch (e) { return {}; }
    }
    function saveStore(data) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* sin almacenamiento */ }
    }
    function updateStore(fn) {
        const d = loadStore();
        fn(d);
        saveStore(d);
        return d;
    }

    // ---------- DOM ----------
    function h(tag, attrs, children) {
        const el = document.createElement(tag);
        if (attrs) {
            for (const k in attrs) {
                const v = attrs[k];
                if (v == null || v === false) continue;
                if (k === 'class') el.className = v;
                else if (k === 'text') el.textContent = v;
                else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
                else if (v === true) el.setAttribute(k, '');
                else el.setAttribute(k, v);
            }
        }
        if (children != null) {
            (Array.isArray(children) ? children : [children]).forEach(c => {
                if (c == null || c === false) return;
                el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
            });
        }
        return el;
    }
    function statTile(label, value, id) {
        return h('div', { class: 'stat-tile tr-stat' }, [h('small', { text: label }), h('strong', { text: value, id })]);
    }

    // ---------- estado de montaje ----------
    let S = null;

    function later(fn, ms) {
        const id = setTimeout(() => { S && S.timeouts.delete(id); fn(); }, ms);
        S.timeouts.add(id);
        return id;
    }
    function clearTimers() {
        if (!S) return;
        S.timeouts.forEach(clearTimeout); S.timeouts.clear();
        S.intervals.forEach(clearInterval); S.intervals.clear();
        S.rafs.forEach(cancelAnimationFrame); S.rafs.clear();
        if (S.keyHandler) { document.removeEventListener('keydown', S.keyHandler); S.keyHandler = null; }
    }
    function every(fn, ms) {
        const id = setInterval(fn, ms);
        S.intervals.add(id);
        return id;
    }
    function frame(fn) {
        const id = requestAnimationFrame(t => { S && S.rafs.delete(id); fn(t); });
        S.rafs.add(id);
        return id;
    }
    function onKey(fn) {
        if (S.keyHandler) document.removeEventListener('keydown', S.keyHandler);
        S.keyHandler = fn;
        document.addEventListener('keydown', fn);
    }
    function emit(exercise, score, detail) {
        const r = { exercise, score, detail, date: new Date().toISOString() };
        try { S && S.opts.onResult && S.opts.onResult(r); } catch (e) { console.error(e); }
    }
    function sourceText() {
        let t = '';
        try { t = S.opts.getText ? String(S.opts.getText() || '') : ''; } catch (e) { t = ''; }
        return wordsOf(t).length >= 60 ? t : SAMPLE_TEXT;
    }
    function typingTarget(e) {
        const t = e.target;
        return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    }

    function screen(title, subtitle) {
        clearTimers();
        const root = S.container;
        root.textContent = '';
        const wrap = h('div', { class: 'tr-root' });
        const isHub = title == null;
        const back = h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm tr-back',
            onclick: () => (isHub ? S.opts.onExit && S.opts.onExit() : renderHub())
        }, isHub ? '← Volver' : '← Ejercicios');
        const heading = h('h2', { class: 'tr-title', tabindex: '-1', text: isHub ? 'Entrenamiento' : title });
        wrap.appendChild(h('header', { class: 'tr-header' }, [back, h('div', { class: 'tr-head-text' }, [heading, subtitle ? h('p', { class: 'tr-sub', text: subtitle }) : null])]));
        const body = h('div', { class: 'tr-body' });
        wrap.appendChild(body);
        root.appendChild(wrap);
        try { heading.focus({ preventScroll: true }); } catch (e) { /* */ }
        if (!isHub) {
            onKey(e => { if (e.key === 'Escape' && !typingTarget(e)) { e.preventDefault(); renderHub(); } });
        }
        return body;
    }

    // ---------- portada ----------
    const EXERCISES = [
        {
            id: 'schulte', name: 'Tabla de Schulte', icon: '⊞',
            desc: 'Busca los números en orden mientras mantienes la vista en el centro. Entrena la atención y la visión periférica.',
            best: d => {
                const b = d.schulte && d.schulte.best;
                if (!b) return null;
                const k = b['5'] ? '5' : Object.keys(b).sort()[0];
                return k ? 'Mejor ' + k + '×' + k + ': ' + fmtTime(b[k]) : null;
            },
            open: () => renderSchulte()
        },
        {
            id: 'flash', name: 'Destello', icon: '⚡',
            desc: 'Un grupo de dígitos o palabras aparece un instante. Escribe lo que viste; la dificultad se ajusta sola.',
            best: d => {
                const f = d.flash || {};
                const parts = [];
                if (f.digits) parts.push(f.digits.length + ' dígitos a ' + f.digits.exposure + ' ms');
                if (f.words) parts.push(f.words.length + ' palabras a ' + f.words.exposure + ' ms');
                return parts.length ? 'Mejor: ' + parts.join(' · ') : null;
            },
            open: () => renderFlash()
        },
        {
            id: 'span', name: 'Expansión de bloques', icon: '△',
            desc: 'Líneas cada vez más anchas alrededor de un punto central. Intenta captar la línea completa sin mover los ojos.',
            best: d => (d.span && d.span.bestPace ? 'Ritmo más rápido: ' + d.span.bestPace + ' ms por línea' : null),
            open: () => renderSpan()
        },
        {
            id: 'baseline', name: 'Prueba de velocidad base', icon: '⏱',
            desc: 'Lee un fragmento a tu ritmo normal y responde 3 preguntas. Mide tus palabras por minuto y tu comprensión.',
            best: d => (d.baseline && d.baseline.last ? 'Última: ' + d.baseline.last.wpm + ' PPM · ' + d.baseline.last.pct + ' % comprensión' : null),
            open: () => renderBaseline()
        }
    ];

    function renderHub() {
        const body = screen(null);
        const data = loadStore();
        body.appendChild(h('p', { class: 'tr-intro', text: 'Ejercicios breves para practicar la atención y la amplitud visual. Unos minutos al día bastan; la comprensión siempre es lo primero.' }));
        const grid = h('div', { class: 'tr-grid', role: 'list' });
        EXERCISES.forEach(ex => {
            const best = ex.best(data);
            grid.appendChild(h('button', { type: 'button', class: 'tr-card', role: 'listitem', 'data-ex': ex.id, onclick: ex.open }, [
                h('span', { class: 'tr-card-icon', 'aria-hidden': 'true', text: ex.icon }),
                h('span', { class: 'tr-card-name', text: ex.name }),
                h('span', { class: 'tr-card-desc', text: ex.desc }),
                h('span', { class: 'tr-card-best' + (best ? '' : ' is-empty'), text: best || 'Sin registros todavía' })
            ]));
        });
        body.appendChild(grid);
    }

    // ---------- 1. Tabla de Schulte ----------
    function renderSchulte() {
        const body = screen('Tabla de Schulte', 'Fija la mirada en el punto central y encuentra los números en orden usando la visión periférica.');
        const prefs = loadStore().schulte || {};
        let size = prefs.size >= 3 && prefs.size <= 7 ? prefs.size : 5;
        let next = 1, mistakes = 0, t0 = 0, running = false, timerId = null;

        const sizeSel = h('select', { class: 'input tr-select', 'aria-label': 'Tamaño de la tabla' },
            [3, 4, 5, 6, 7].map(n => h('option', { value: n, text: n + ' × ' + n, selected: n === size })));
        const startBtn = h('button', { type: 'button', class: 'btn tr-start' }, 'Empezar');
        const timeEl = h('strong', { text: '0,0 s' });
        const nextEl = h('strong', { text: '—' });
        const errEl = h('strong', { text: '0' });
        const bestEl = h('strong', { text: '—' });
        const status = h('p', { class: 'tr-status', role: 'status', 'aria-live': 'polite' });
        const grid = h('div', { class: 'tr-schulte', role: 'group', 'aria-label': 'Tabla de números' });
        const board = h('div', { class: 'tr-schulte-wrap' }, [grid, h('span', { class: 'tr-fix-dot', 'aria-hidden': 'true' })]);

        body.appendChild(h('div', { class: 'tr-toolbar' }, [h('label', { class: 'tr-field' }, [h('span', { text: 'Tamaño' }), sizeSel]), startBtn]));
        body.appendChild(h('div', { class: 'tr-stats' }, [
            h('div', { class: 'stat-tile tr-stat' }, [h('small', { text: 'Tiempo' }), timeEl]),
            h('div', { class: 'stat-tile tr-stat' }, [h('small', { text: 'Busca' }), nextEl]),
            h('div', { class: 'stat-tile tr-stat' }, [h('small', { text: 'Errores' }), errEl]),
            h('div', { class: 'stat-tile tr-stat' }, [h('small', { text: 'Mejor' }), bestEl])
        ]));
        body.appendChild(board);
        body.appendChild(status);

        function showBest() {
            const b = (loadStore().schulte || {}).best || {};
            bestEl.textContent = b[size] ? fmtTime(b[size]) : '—';
        }
        function build(active) {
            grid.textContent = '';
            grid.style.setProperty('--tr-n', size);
            const N = size * size;
            const nums = shuffle(Array.from({ length: N }, (_, i) => i + 1));
            const center = size % 2 ? (N - 1) / 2 : -1;
            nums.forEach((n, i) => {
                grid.appendChild(h('button', {
                    type: 'button', class: 'tr-cell' + (i === center ? ' has-dot' : ''), 'data-n': n, disabled: !active,
                    'aria-label': 'Número ' + n, onclick: e => pick(n, e.currentTarget)
                }, String(n)));
            });
        }
        function pick(n, btn) {
            if (!running) return;
            if (n === next) {
                btn.classList.add('is-found');
                btn.setAttribute('aria-pressed', 'true');
                next++;
                if (next > size * size) return finish();
                nextEl.textContent = String(next);
            } else if (!btn.classList.contains('is-found')) {
                mistakes++;
                errEl.textContent = String(mistakes);
                btn.classList.remove('is-wrong');
                void btn.offsetWidth;
                btn.classList.add('is-wrong');
                later(() => btn.classList.remove('is-wrong'), 450);
            }
        }
        function start() {
            build(true);
            next = 1; mistakes = 0; running = true;
            errEl.textContent = '0'; nextEl.textContent = '1'; timeEl.textContent = '0,0 s';
            status.textContent = 'Mantén la vista en el punto rojo.';
            t0 = performance.now();
            if (timerId) clearInterval(timerId);
            timerId = every(() => { timeEl.textContent = fmtTime(performance.now() - t0); }, 100);
            startBtn.textContent = 'Reiniciar';
            const first = grid.querySelector('.tr-cell');
            if (first) first.focus({ preventScroll: true });
        }
        function finish() {
            running = false;
            const ms = Math.round(performance.now() - t0);
            clearInterval(timerId); S.intervals.delete(timerId); timerId = null;
            timeEl.textContent = fmtTime(ms);
            nextEl.textContent = '✓';
            let record = false;
            updateStore(d => {
                d.schulte = d.schulte || {};
                d.schulte.size = size;
                d.schulte.best = d.schulte.best || {};
                if (!d.schulte.best[size] || ms < d.schulte.best[size]) { d.schulte.best[size] = ms; record = true; }
            });
            showBest();
            grid.querySelectorAll('.tr-cell').forEach(b => { b.disabled = true; });
            board.classList.add('is-done');
            status.textContent = '¡Completada en ' + fmtTime(ms) + ' con ' + mistakes + (mistakes === 1 ? ' error' : ' errores') + '!' + (record ? ' Nuevo récord personal.' : '');
            emit('schulte', ms / 1000, { size, mistakes, timeMs: ms, record });
            startBtn.textContent = 'Otra vez';
            startBtn.focus({ preventScroll: true });
        }
        sizeSel.addEventListener('change', () => {
            size = +sizeSel.value;
            running = false;
            if (timerId) { clearInterval(timerId); S.intervals.delete(timerId); timerId = null; }
            updateStore(d => { d.schulte = d.schulte || {}; d.schulte.size = size; });
            board.classList.remove('is-done');
            timeEl.textContent = '0,0 s'; nextEl.textContent = '—'; errEl.textContent = '0';
            startBtn.textContent = 'Empezar';
            status.textContent = '';
            build(false); showBest();
        });
        startBtn.addEventListener('click', () => { board.classList.remove('is-done'); start(); });
        build(false);
        showBest();
    }

    // ---------- 2. Destello ----------
    function renderFlash() {
        const body = screen('Destello', 'Mira el punto central. Aparecerá un estímulo durante unos milisegundos; escribe exactamente lo que viste.');
        const TRIALS = 10;
        const st = (loadStore().flash || {});
        let mode = st.mode === 'words' ? 'words' : 'digits';
        let length, exposure, streak, trial, correct, history, levelUps, phase, current, bestRound;
        const words = wordsOf(sourceText()).map(bareWord).filter(w => w && /\p{L}/u.test(w));

        const modeSel = h('select', { class: 'input tr-select', 'aria-label': 'Tipo de estímulo' }, [
            h('option', { value: 'digits', text: 'Dígitos', selected: mode === 'digits' }),
            h('option', { value: 'words', text: 'Palabras del texto', selected: mode === 'words' })
        ]);
        const startBtn = h('button', { type: 'button', class: 'btn' }, 'Empezar ronda');
        const trialEl = h('strong', { text: '0/' + TRIALS });
        const lenEl = h('strong');
        const expEl = h('strong');
        const accEl = h('strong', { text: '—' });
        const lenLabel = h('small');
        const display = h('div', { class: 'tr-flash-display', 'aria-live': 'off' }, h('span', { class: 'tr-fix-dot is-static', 'aria-hidden': 'true' }));
        const input = h('input', { class: 'input tr-flash-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Lo que viste', placeholder: 'Escribe lo que viste y pulsa Intro', disabled: true });
        const submitBtn = h('button', { type: 'button', class: 'btn', disabled: true }, 'Comprobar');
        const status = h('p', { class: 'tr-status', role: 'status', 'aria-live': 'polite' });
        const form = h('form', { class: 'tr-flash-form', onsubmit: e => { e.preventDefault(); submit(); } }, [input, submitBtn]);

        body.appendChild(h('div', { class: 'tr-toolbar' }, [h('label', { class: 'tr-field' }, [h('span', { text: 'Estímulo' }), modeSel]), startBtn]));
        body.appendChild(h('div', { class: 'tr-stats' }, [
            h('div', { class: 'stat-tile tr-stat' }, [h('small', { text: 'Intento' }), trialEl]),
            h('div', { class: 'stat-tile tr-stat' }, [lenLabel, lenEl]),
            h('div', { class: 'stat-tile tr-stat' }, [h('small', { text: 'Exposición' }), expEl]),
            h('div', { class: 'stat-tile tr-stat' }, [h('small', { text: 'Aciertos' }), accEl])
        ]));
        body.appendChild(display);
        body.appendChild(form);
        body.appendChild(status);

        function reset() {
            length = mode === 'digits' ? 4 : 2;
            exposure = 300; streak = 0; trial = 0; correct = 0; history = []; levelUps = 0; phase = 'idle'; bestRound = null;
            lenLabel.textContent = mode === 'digits' ? 'Dígitos' : 'Palabras';
            paintStats();
        }
        function paintStats() {
            trialEl.textContent = trial + '/' + TRIALS;
            lenEl.textContent = String(length);
            expEl.textContent = exposure + ' ms';
            accEl.textContent = trial ? Math.round(correct / trial * 100) + ' %' : '—';
        }
        function makeStimulus() {
            if (mode === 'digits') {
                let s = '';
                for (let i = 0; i < length; i++) s += Math.floor(Math.random() * 10);
                return s;
            }
            if (words.length < length) return words.join(' ');
            // Palabras consecutivas del texto, evitando secuencias demasiado largas
            for (let tries = 0; tries < 30; tries++) {
                const i = Math.floor(Math.random() * (words.length - length + 1));
                const seq = words.slice(i, i + length);
                const chars = seq.join(' ').length;
                if (chars <= 8 * length + 4 || tries > 25) return seq.join(' ');
            }
            return words.slice(0, length).join(' ');
        }
        function setDisplay(content, cls) {
            display.textContent = '';
            display.className = 'tr-flash-display' + (cls ? ' ' + cls : '');
            if (content == null) display.appendChild(h('span', { class: 'tr-fix-dot is-static', 'aria-hidden': 'true' }));
            else display.appendChild(h('span', { class: 'tr-flash-text', text: content }));
        }
        function runTrial() {
            phase = 'show';
            input.value = ''; input.disabled = true; submitBtn.disabled = true;
            status.textContent = 'Mira el centro…';
            current = makeStimulus();
            setDisplay(null);
            later(() => {
                setDisplay(current, 'is-stim');
                frame(t0 => {
                    const tick = t => {
                        if (t - t0 >= exposure - 8) {
                            setDisplay('#'.repeat(Math.max(4, Math.min(current.length, 28))), 'is-mask');
                            later(() => {
                                setDisplay(null);
                                phase = 'answer';
                                input.disabled = false; submitBtn.disabled = false;
                                input.focus({ preventScroll: true });
                                status.textContent = '¿Qué viste?';
                            }, 350);
                        } else frame(tick);
                    };
                    frame(tick);
                });
            }, 700);
        }
        function compare(a, b) {
            const f = s => norm(s).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
            return f(a) === f(b);
        }
        function levelUp() {
            // Alterna entre acortar la exposición y alargar el estímulo
            if ((levelUps % 2 === 0 && exposure > 50) || length >= (mode === 'digits' ? 12 : 7)) {
                if (exposure > 50) { exposure = Math.max(50, exposure - 30); history.push('exp'); }
                else { length++; history.push('len'); }
            } else { length++; history.push('len'); }
            levelUps++;
        }
        function backOff() {
            const last = history.pop();
            if (last === 'exp') exposure = Math.min(300, exposure + 30);
            else if (last === 'len') length = Math.max(mode === 'digits' ? 3 : 1, length - 1);
            else if (length > (mode === 'digits' ? 3 : 1)) length--;
            else exposure = Math.min(500, exposure + 30);
        }
        function submit() {
            if (phase !== 'answer') return;
            phase = 'feedback';
            input.disabled = true; submitBtn.disabled = true;
            const ok = compare(input.value, current);
            trial++;
            if (ok) {
                correct++; streak++;
                if (!bestRound || length > bestRound.length || (length === bestRound.length && exposure < bestRound.exposure)) bestRound = { length, exposure };
            }
            setDisplay(current, ok ? 'is-ok' : 'is-bad');
            status.textContent = ok ? '✓ Correcto.' : '✗ Era: «' + current + '».';
            if (ok && streak >= 2) { levelUp(); streak = 0; }
            else if (!ok) { backOff(); streak = 0; }
            paintStats();
            trialEl.textContent = trial + '/' + TRIALS;
            if (trial >= TRIALS) later(endRound, 1100);
            else later(runTrial, ok ? 800 : 1500);
        }
        function endRound() {
            phase = 'idle';
            const acc = Math.round(correct / TRIALS * 100);
            setDisplay(null);
            let record = false;
            updateStore(d => {
                d.flash = d.flash || {};
                d.flash.mode = mode;
                if (bestRound) {
                    const prev = d.flash[mode];
                    if (!prev || bestRound.length > prev.length || (bestRound.length === prev.length && bestRound.exposure < prev.exposure)) {
                        d.flash[mode] = { length: bestRound.length, exposure: bestRound.exposure, accuracy: acc, date: new Date().toISOString() };
                        record = true;
                    }
                }
            });
            status.textContent = 'Ronda terminada: ' + correct + ' de ' + TRIALS + ' (' + acc + ' %).' +
                (bestRound ? ' Mejor acierto: ' + bestRound.length + (mode === 'digits' ? ' dígitos' : ' palabras') + ' a ' + bestRound.exposure + ' ms.' : '') +
                (record ? ' Nuevo récord personal.' : '');
            emit('flash', acc, { mode, correct, trials: TRIALS, finalLength: length, finalExposure: exposure, best: bestRound, record });
            startBtn.disabled = false; modeSel.disabled = false;
            startBtn.textContent = 'Otra ronda';
            startBtn.focus({ preventScroll: true });
        }
        startBtn.addEventListener('click', () => {
            reset();
            startBtn.disabled = true; modeSel.disabled = true;
            runTrial();
        });
        modeSel.addEventListener('change', () => {
            mode = modeSel.value;
            updateStore(d => { d.flash = d.flash || {}; d.flash.mode = mode; });
            reset();
        });
        reset();
    }

    // ---------- 3. Expansión de bloques ----------
    function renderSpan() {
        const body = screen('Expansión de bloques', 'Mantén la vista en el punto. Las líneas crecen de 2 a 5 palabras: intenta percibirlas completas sin mover los ojos.');
        const prefs = loadStore().span || {};
        let pace = prefs.pace >= 200 && prefs.pace <= 3000 ? prefs.pace : 900;
        let playing = false, idx = 0, timer = null, shownAtPace = 0;
        const WIDTHS = [2, 3, 4, 5];
        const words = wordsOf(sourceText());
        const lines = [];
        let wi = 0, step = 0;
        while (wi < words.length && lines.length < 400) {
            const n = WIDTHS[step % WIDTHS.length];
            lines.push(words.slice(wi, wi + n).join(' '));
            wi += n; step++;
        }

        const playBtn = h('button', { type: 'button', class: 'btn tr-play', 'aria-pressed': 'false' }, 'Reproducir');
        const restartBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Reiniciar');
        const paceInput = h('input', { type: 'range', min: 200, max: 2000, step: 50, value: pace, class: 'tr-range', 'aria-label': 'Milisegundos por línea' });
        const paceOut = h('output', { class: 'tr-range-out', text: pace + ' ms' });
        const faster = h('button', { type: 'button', class: 'icon-btn tr-icon', 'aria-label': 'Más rápido (−50 ms)' }, '−');
        const slower = h('button', { type: 'button', class: 'icon-btn tr-icon', 'aria-label': 'Más lento (+50 ms)' }, '+');
        const list = h('div', { class: 'tr-span-list', 'aria-live': 'off' });
        const stage = h('div', { class: 'tr-span-stage' }, [h('span', { class: 'tr-span-axis', 'aria-hidden': 'true' }), list]);
        const progress = h('div', { class: 'tr-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': lines.length, 'aria-valuenow': 0 }, h('span'));
        const status = h('p', { class: 'tr-status', role: 'status', 'aria-live': 'polite', text: 'Espacio: reproducir o pausar · ← → ajustar ms por línea' });

        body.appendChild(h('div', { class: 'tr-toolbar' }, [
            playBtn, restartBtn,
            h('div', { class: 'tr-pace' }, [h('span', { class: 'tr-pace-label', text: 'Ritmo' }), faster, paceInput, slower, paceOut])
        ]));
        body.appendChild(stage);
        body.appendChild(progress);
        body.appendChild(status);

        const HALF = 3;
        function paint() {
            list.textContent = '';
            for (let k = idx - HALF; k <= idx + HALF; k++) {
                const off = k - idx;
                const txt = k >= 0 && k < lines.length ? lines[k] : '';
                const el = h('div', { class: 'tr-span-line' + (off === 0 ? ' is-current' : ''), 'data-off': Math.abs(off) }, txt || ' ');
                if (off === 0) el.appendChild(h('span', { class: 'tr-fix-dot is-line', 'aria-hidden': 'true' }));
                list.appendChild(el);
            }
            progress.firstChild.style.width = (lines.length ? (idx / Math.max(1, lines.length - 1)) * 100 : 0) + '%';
            progress.setAttribute('aria-valuenow', idx);
        }
        function schedule() {
            if (timer) { clearTimeout(timer); S.timeouts.delete(timer); }
            if (!playing) return;
            timer = later(() => {
                if (idx >= lines.length - 1) return stop(true);
                idx++; shownAtPace++;
                paint();
                schedule();
            }, pace);
        }
        function play() {
            if (idx >= lines.length - 1) { idx = 0; paint(); }
            playing = true; shownAtPace = 0;
            playBtn.textContent = 'Pausa'; playBtn.setAttribute('aria-pressed', 'true');
            stage.classList.add('is-playing');
            schedule();
        }
        function stop(ended) {
            const lineCount = shownAtPace;
            playing = false;
            if (timer) { clearTimeout(timer); S.timeouts.delete(timer); timer = null; }
            playBtn.textContent = ended ? 'Repetir' : 'Reproducir'; playBtn.setAttribute('aria-pressed', 'false');
            stage.classList.remove('is-playing');
            if (lineCount >= 20) {
                let record = false;
                updateStore(d => {
                    d.span = d.span || {};
                    d.span.pace = pace;
                    if (!d.span.bestPace || pace < d.span.bestPace) { d.span.bestPace = pace; record = true; }
                });
                emit('span', pace, { pace, lines: lineCount, record });
                status.textContent = (ended ? 'Fin del texto. ' : '') + lineCount + ' líneas a ' + pace + ' ms por línea.' + (record ? ' Nuevo ritmo récord.' : '');
            } else if (ended) status.textContent = 'Fin del texto.';
            shownAtPace = 0;
        }
        function setPace(v) {
            const newPace = Math.max(200, Math.min(2000, Math.round(v / 50) * 50));
            if (newPace !== pace && playing && shownAtPace >= 20) { stop(false); play(); }
            pace = newPace;
            paceInput.value = pace; paceOut.textContent = pace + ' ms';
            updateStore(d => { d.span = d.span || {}; d.span.pace = pace; });
            if (playing) { shownAtPace = 0; schedule(); }
        }
        playBtn.addEventListener('click', () => (playing ? stop(false) : play()));
        restartBtn.addEventListener('click', () => { const was = playing; if (playing) stop(false); idx = 0; paint(); if (was) play(); });
        paceInput.addEventListener('input', () => setPace(+paceInput.value));
        slower.addEventListener('click', () => setPace(pace + 50));
        faster.addEventListener('click', () => setPace(pace - 50));
        const baseKey = S.keyHandler;
        onKey(e => {
            baseKey && baseKey(e);
            if (typingTarget(e) && e.target !== paceInput) return;
            if (e.key === ' ' || e.code === 'Space') {
                if (e.target && e.target.tagName === 'BUTTON') return; // el botón ya lo gestiona
                e.preventDefault(); playing ? stop(false) : play();
            } else if (e.target !== paceInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault(); setPace(pace + (e.key === 'ArrowLeft' ? -50 : 50));
            }
        });
        paint();
    }

    // ---------- 4. Prueba de velocidad base ----------
    function pickPassage(text) {
        const ps = paragraphsOf(text);
        if (!ps.length) return { paragraphs: [], words: 0 };
        const total = ps.reduce((n, p) => n + wordsOf(p).length, 0);
        let start = 0;
        if (total > 420) {
            // Párrafos iniciales que aún dejan ~320 palabras por delante
            let remaining = total;
            const valid = [];
            ps.forEach((p, i) => { if (remaining >= 320) valid.push(i); remaining -= wordsOf(p).length; });
            start = valid.length ? valid[Math.floor(Math.random() * valid.length)] : 0;
        }
        const out = [];
        let count = 0;
        for (let i = start; i < ps.length && count < 300; i++) {
            let p = ps[i];
            const w = wordsOf(p).length;
            if (count + w > 400) {
                // Recortar en un final de oración cercano al límite
                const sents = splitSentences(p);
                let acc = '', n = 0;
                for (const s of sents) {
                    const sw = wordsOf(s).length;
                    if (count + n + sw > 400 && count + n >= 300) break;
                    if (count + n + sw > 400 && n > 0) break;
                    acc += (acc ? ' ' : '') + s; n += sw;
                }
                if (!n) { const ws = p.split(/\s+/).slice(0, 400 - count); acc = ws.join(' ') + '…'; n = ws.length; }
                out.push(acc); count += n;
                break;
            }
            out.push(p); count += w;
        }
        return { paragraphs: out, words: count };
    }

    function renderBaseline() {
        const body = screen('Prueba de velocidad base', 'Lee el fragmento a tu ritmo habitual, como si leyeras por gusto. Después responderás 3 preguntas breves.');
        const passage = pickPassage(sourceText());
        const passageText = passage.paragraphs.join('\n\n');
        let t0 = 0, wpm = 0, seconds = 0;

        const intro = h('div', { class: 'tr-panel tr-baseline-intro' }, [
            h('p', {}, ['Fragmento de ', h('strong', { text: passage.words + ' palabras' }), '. El cronómetro empieza al pulsar «Empezar» y se detiene al pulsar «Terminé».']),
            h('p', { class: 'tr-muted', text: 'Consejo: no hay prisa. Una medida honesta es más útil que una rápida.' })
        ]);
        const startBtn = h('button', { type: 'button', class: 'btn' }, 'Empezar');
        const doneBtn = h('button', { type: 'button', class: 'btn tr-done', hidden: true }, 'Terminé');
        const timeEl = h('span', { class: 'tr-clock', 'aria-hidden': 'true', hidden: true, text: '0:00' });
        const article = h('article', { class: 'tr-passage is-hidden', 'aria-hidden': 'true' }, passage.paragraphs.map(p => h('p', { text: p })));
        const results = h('div', { class: 'tr-baseline-results' });

        body.appendChild(intro);
        body.appendChild(h('div', { class: 'tr-toolbar tr-sticky' }, [startBtn, doneBtn, timeEl]));
        body.appendChild(article);
        body.appendChild(results);

        startBtn.addEventListener('click', () => {
            article.classList.remove('is-hidden');
            article.removeAttribute('aria-hidden');
            startBtn.hidden = true; doneBtn.hidden = false; timeEl.hidden = false;
            intro.hidden = true;
            t0 = performance.now();
            every(() => {
                const s = Math.floor((performance.now() - t0) / 1000);
                timeEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
            }, 1000);
            article.setAttribute('tabindex', '-1');
            article.focus({ preventScroll: true });
            article.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        doneBtn.addEventListener('click', () => {
            const ms = performance.now() - t0;
            seconds = Math.max(1, Math.round(ms / 100) / 10);
            wpm = Math.round(passage.words / (ms / 60000));
            S.intervals.forEach(clearInterval); S.intervals.clear();
            doneBtn.hidden = true; timeEl.hidden = true;
            article.classList.add('is-hidden');
            article.setAttribute('aria-hidden', 'true');
            quiz();
        });

        function quiz() {
            const qs = cloze(passageText, 3);
            results.textContent = '';
            if (!qs.length) return showResult(null, 0);
            const answers = new Array(qs.length).fill(-1);
            const box = h('div', { class: 'tr-panel tr-quiz' }, [
                h('h3', { class: 'tr-h3', text: 'Comprensión', tabindex: '-1' }),
                h('p', { class: 'tr-muted', text: 'Elige la palabra que faltaba en cada frase del fragmento.' })
            ]);
            const finishBtn = h('button', { type: 'button', class: 'btn', disabled: true }, 'Ver resultado');
            qs.forEach((q, qi) => {
                const opts = h('div', { class: 'tr-options', role: 'radiogroup', 'aria-label': 'Pregunta ' + (qi + 1) });
                q.options.forEach((o, oi) => {
                    opts.appendChild(h('button', {
                        type: 'button', class: 'tr-option', role: 'radio', 'aria-checked': 'false', 'data-q': qi, 'data-o': oi,
                        onclick: e => {
                            answers[qi] = oi;
                            opts.querySelectorAll('.tr-option').forEach(b => { b.setAttribute('aria-checked', String(b === e.currentTarget)); b.classList.toggle('is-selected', b === e.currentTarget); });
                            finishBtn.disabled = answers.some(a => a < 0);
                        }
                    }, o));
                });
                box.appendChild(h('div', { class: 'tr-question' }, [
                    h('p', { class: 'tr-q-text' }, [h('span', { class: 'tr-q-num', text: (qi + 1) + '.' }), ' ' + q.sentence]),
                    opts
                ]));
            });
            finishBtn.addEventListener('click', () => {
                let ok = 0;
                qs.forEach((q, qi) => {
                    const btns = box.querySelectorAll('.tr-option[data-q="' + qi + '"]');
                    btns.forEach((b, oi) => {
                        b.disabled = true;
                        b.classList.remove('is-selected');
                        if (oi === q.answer) b.classList.add('is-correct');
                        else if (oi === answers[qi]) b.classList.add('is-wrong');
                    });
                    if (answers[qi] === q.answer) ok++;
                });
                finishBtn.remove();
                showResult(ok, qs.length);
            });
            box.appendChild(h('div', { class: 'btn-row' }, finishBtn));
            results.appendChild(box);
            box.querySelector('.tr-h3').focus({ preventScroll: true });
            box.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }

        function showResult(ok, total) {
            const pct = total ? Math.round(ok / total * 100) : null;
            const eff = pct == null ? null : Math.round(wpm * pct / 100);
            updateStore(d => {
                d.baseline = d.baseline || {};
                d.baseline.last = { wpm, pct: pct == null ? '—' : pct, eff, date: new Date().toISOString() };
                if (eff != null && (!d.baseline.bestEff || eff > d.baseline.bestEff)) d.baseline.bestEff = eff;
                d.baseline.history = (d.baseline.history || []).concat([{ wpm, pct, eff, date: new Date().toISOString() }]).slice(-30);
            });
            emit('baseline', eff != null ? eff : wpm, { wpm, correct: ok, total, comprehension: pct, effectiveWpm: eff, words: passage.words, seconds });
            const panel = h('div', { class: 'tr-panel tr-result' }, [
                h('h3', { class: 'tr-h3', text: 'Resultado', tabindex: '-1' }),
                h('div', { class: 'tr-stats' }, [
                    statTile('Velocidad', wpm + ' PPM'),
                    statTile('Comprensión', pct == null ? '—' : pct + ' %'),
                    statTile('PPM efectivas', eff == null ? '—' : String(eff))
                ]),
                h('p', { class: 'tr-muted', text: pct == null
                    ? 'El fragmento era demasiado corto para generar preguntas; solo se midió la velocidad.'
                    : 'PPM efectivas = velocidad × comprensión. Repite la prueba de vez en cuando con textos parecidos para comparar.' }),
                h('div', { class: 'btn-row' }, [
                    h('button', { type: 'button', class: 'btn', onclick: () => renderBaseline() }, 'Repetir con otro fragmento'),
                    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => renderHub() }, 'Volver a ejercicios')
                ])
            ]);
            results.appendChild(panel);
            panel.querySelector('.tr-h3').focus({ preventScroll: true });
            panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // ---------- API ----------
    function mount(container, opts) {
        if (S) unmount();
        if (!container) throw new Error('LV.training.mount: falta el contenedor');
        S = { container, opts: opts || {}, timeouts: new Set(), intervals: new Set(), rafs: new Set(), keyHandler: null };
        container.classList.add('tr-host');
        renderHub();
    }
    function unmount() {
        if (!S) return;
        clearTimers();
        S.container.textContent = '';
        S.container.classList.remove('tr-host');
        S = null;
    }

    LV.training = { mount, unmount, cloze };
})();
