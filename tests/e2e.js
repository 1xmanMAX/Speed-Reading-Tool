/* Pruebas de extremo a extremo de Lectura Veloz (Playwright + Chromium).
 *
 *   node tests/e2e.js [carpeta-de-capturas]
 *
 * Levanta un servidor estático sobre web/, recorre la app como lo haría una
 * persona y guarda capturas de pantalla de cada pantalla importante.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'web');
const FIX = path.join(__dirname, 'fixtures');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'screenshots'));
const PORT = 8790;

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

function serve() {
    return new Promise((resolve) => {
        const srv = http.createServer((req, res) => {
            let p = decodeURIComponent(req.url.split('?')[0]);
            if (p.endsWith('/')) p += 'index.html';
            const file = path.join(ROOT, p);
            if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
            fs.readFile(file, (err, data) => {
                if (err) { res.writeHead(404); res.end(); return; }
                res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
                res.end(data);
            });
        }).listen(PORT, () => resolve(srv));
    });
}

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
    if (ok) { passed++; console.log('  ✓ ' + name); }
    else { failed++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

const MODES = ['focus', 'chunk', 'guided', 'line', 'bionic', 'gradient', 'scroll', 'peri', 'flash'];

// Voz simulada: Chromium sin interfaz no trae voces, así que imitamos la API del navegador
const FAKE_SPEECH = () => {
    const voices = [
        { name: 'Microsoft Elvira Online (Natural) - Spanish (Spain)', lang: 'es-ES', voiceURI: 'ms-elvira', localService: false, default: true },
        { name: 'Microsoft Helena - Spanish (Spain)', lang: 'es-ES', voiceURI: 'ms-helena', localService: true, default: false },
    ];
    class U { constructor(t) { this.text = t; this.rate = 1; this.pitch = 1; } }
    let cur = null;
    let timer = 0;
    const synth = {
        speaking: false, paused: false, pending: false,
        getVoices: () => voices,
        addEventListener() {}, removeEventListener() {},
        speak(u) {
            cur = u; synth.speaking = true;
            const words = [...u.text.matchAll(/\S+/g)];
            let i = 0;
            setTimeout(() => u.onstart && u.onstart({}), 10);
            const tick = () => {
                if (cur !== u) return;
                if (i < words.length) { u.onboundary && u.onboundary({ name: 'word', charIndex: words[i].index, charLength: words[i][0].length }); i++; timer = setTimeout(tick, 120 / (u.rate || 1)); }
                else { synth.speaking = false; cur = null; u.onend && u.onend({}); }
            };
            timer = setTimeout(tick, 20);
        },
        cancel() { clearTimeout(timer); cur = null; synth.speaking = false; },
        pause() {}, resume() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.SpeechSynthesisUtterance = U;
};

async function newPage(browser, viewport, errors) {
    const ctx = await browser.newContext({ viewport, colorScheme: 'dark', locale: 'es-ES' });
    await ctx.addInitScript(FAKE_SPEECH);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.LV && LV.app);
    return page;
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
const state = (page) => page.evaluate(() => ({ pos: LV.app.state.pos, playing: LV.app.state.playing, mode: LV.app.settings.mode, n: LV.app.state.tok ? LV.app.state.tok.words.length : 0 }));

async function goHome(page) {
    if (await page.isVisible('#reader-back')) await page.click('#reader-back');
    await page.waitForSelector('#view-home:not([hidden])');
}

async function openSample(page) {
    await page.click('#load-sample');
    await page.waitForFunction(() => LV.app.state.tok);
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const srv = await serve();
    const browser = await chromium.launch();
    const errors = [];

    /* ---------------- Escritorio ---------------- */
    console.log('\nEscritorio (1440×900)');
    const page = await newPage(browser, { width: 1440, height: 900 }, errors);
    await page.waitForTimeout(600);
    await shot(page, '01-inicio');
    check('La página de inicio carga', await page.isVisible('#view-home'));
    check('Se muestran las 10 tarjetas de modos', (await page.$$('.mode-card')).length === 10);

    await openSample(page);
    const s0 = await state(page);
    check('El texto de ejemplo se abre en el lector', s0.n > 300, s0);
    await page.evaluate(() => LV.app.setSetting('immersive', false));

    let i = 2;
    for (const m of MODES) {
        await page.evaluate((m) => { LV.app.setMode(m); LV.app.seek(40); }, m);
        const before = (await state(page)).pos;
        await page.evaluate(() => LV.app.play());
        await page.waitForTimeout(m === 'line' ? 5500 : 2200);
        const st = await state(page);
        await shot(page, String(i++).padStart(2, '0') + '-modo-' + m);
        await page.evaluate(() => LV.app.pause());
        check(`Modo «${m}» reproduce y avanza`, st.playing && st.pos > before, { before, after: st.pos });
    }

    // Precisión del ritmo: 600 ppm sin pausas inteligentes ≈ 10 palabras/s
    await page.evaluate(() => { LV.app.setSetting('smartPause', false); LV.app.setSetting('rewindOnPause', false); LV.app.setMode('focus'); LV.app.seek(0); LV.app.setSetting('wpm', 600); LV.app.play(); });
    await page.waitForTimeout(5000);
    const timed = (await state(page)).pos;
    await page.evaluate(() => LV.app.pause());
    check('Ritmo preciso a 600 ppm (≈50 palabras en 5 s, con arranque suave)', timed >= 40 && timed <= 56, timed);
    await page.evaluate(() => { LV.app.setSetting('smartPause', true); LV.app.setSetting('rewindOnPause', true); LV.app.setSetting('wpm', 300); });

    // Teclado
    await page.evaluate(() => LV.app.seek(10));
    await page.keyboard.press('ArrowRight');
    check('Tecla → avanza una palabra', (await state(page)).pos === 11);
    await page.keyboard.press('Shift+ArrowRight');
    check('Shift+→ salta a la frase siguiente', (await state(page)).pos > 11);
    await page.keyboard.press('ArrowUp');
    check('Tecla ↑ sube 25 ppm', (await page.evaluate(() => LV.app.settings.wpm)) === 325);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('2');
    check('Tecla 2 cambia al modo Bloques', (await state(page)).mode === 'chunk');
    await page.keyboard.press(' ');
    await page.waitForTimeout(300);
    check('Espacio inicia la lectura', (await state(page)).playing);
    await page.keyboard.press(' ');
    check('Espacio pausa la lectura', !(await state(page)).playing);
    await page.keyboard.press('1');

    // Barra de progreso
    const bar = await page.$('#scrubber');
    const box = await bar.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const mid = await state(page);
    check('Clic en la barra de progreso salta a la mitad', Math.abs(mid.pos / mid.n - 0.5) < 0.05, mid);

    // Paneles
    await page.locator('[data-open="settings"]:visible').first().click();
    await page.waitForTimeout(400);
    await shot(page, '11-ajustes');
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await page.waitForTimeout(300);
    await shot(page, '12-atajos');
    await page.keyboard.press('Escape');

    // Temas
    for (const [k, t] of [['13', 'light'], ['14', 'sepia'], ['15', 'midnight']]) {
        await page.evaluate((t) => { LV.app.setSetting('theme', t); LV.app.setMode('bionic'); }, t);
        await page.waitForTimeout(250);
        await shot(page, `${k}-tema-${t}`);
        check(`Tema «${t}» aplicado`, (await page.evaluate(() => document.documentElement.dataset.theme)) === t);
    }
    await page.evaluate(() => { LV.app.setSetting('theme', 'auto'); LV.app.setMode('focus'); });

    // HUD que se oculta al leer
    await page.evaluate(() => { LV.app.setSetting('immersive', true); LV.app.setMode('focus'); LV.app.play(); });
    await page.waitForTimeout(3300);
    check('Los controles se ocultan mientras lees', await page.evaluate(() => document.querySelector('#view-reader').classList.contains('hud-hidden')));
    await shot(page, '16a-lectura-inmersiva');
    await page.mouse.move(700, 500);
    await page.mouse.move(720, 520);
    check('Los controles reaparecen al mover el ratón', !(await page.evaluate(() => document.querySelector('#view-reader').classList.contains('hud-hidden'))));
    await page.evaluate(() => { LV.app.pause(); LV.app.setSetting('immersive', false); });

    // Menú de modos
    await page.click('#mode-btn');
    await page.waitForTimeout(250);
    await shot(page, '16b-menu-modos');
    await page.click('.mode-item[data-mode="listen"]');
    check('El menú cambia al modo Escuchar', (await state(page)).mode === 'listen');

    // Modo Escuchar con voces de Microsoft
    await page.evaluate(() => LV.app.seek(0));
    await page.evaluate(() => LV.app.play());
    await page.waitForTimeout(2500);
    const heard = await state(page);
    await shot(page, '16c-modo-escuchar');
    await page.evaluate(() => LV.app.pause());
    check('Escuchar: la voz avanza el texto palabra a palabra', heard.pos > 5, heard);
    const voices = await page.$$eval('#voice-select option', (o) => o.map((x) => x.textContent));
    check('Lista las voces de Microsoft', voices.some((v) => /Microsoft/.test(v)), voices);
    await page.locator('[data-open="settings"]:visible').first().click();
    await page.evaluate(() => document.querySelector('#voice-select').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await shot(page, '16d-ajustes-voz');
    await page.keyboard.press('Escape');

    // Ventana flotante (Document Picture-in-Picture en Chrome/Edge)
    await page.evaluate(() => LV.app.setMode('focus'));
    const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await page.click('#btn-pip');
    const pip = await popup;
    check('Se abre la ventana flotante', !!pip && (await page.evaluate(() => LV.app.state.mini && LV.app.state.mini.kind)) === 'docpip');
    if (pip) {
        await pip.click('#mini-stage');
        await page.waitForTimeout(1500);
        check('Clic en la ventana flotante inicia la lectura', (await state(page)).playing);
        await pip.mouse.wheel(0, -100);
        check('La rueda del ratón sube la velocidad', (await page.evaluate(() => LV.app.settings.wpm)) === 325);
        await pip.click('#mini-stage', { button: 'right' });
        check('Clic derecho cambia a vista de frase', (await page.evaluate(() => LV.app.settings.miniView)) === 'phrase');
        await page.waitForTimeout(500);
        await pip.screenshot({ path: path.join(OUT, '16e-ventana-flotante.png') });
        await shot(page, '16f-ventana-principal-con-flotante');
        await pip.click('#mini-stage', { button: 'right' });
        await pip.keyboard.press('ArrowDown');
        await pip.dblclick('#mini-stage');
        await page.waitForTimeout(400);
        check('Doble clic vuelve a la ventana completa', !(await page.evaluate(() => LV.app.state.mini)));
        await page.evaluate(() => { LV.app.pause(); LV.app.setSetting('wpm', 300); });
    }

    // Fin de lectura y test de comprensión
    await page.evaluate(() => { LV.app.setSetting('wpm', 300); LV.app.seek(LV.app.state.tok.words.length - 260); LV.app.setSetting('wpm', 1500); LV.app.play(); });
    await page.waitForSelector('#finish-card:not([hidden])', { timeout: 30000 });
    await page.waitForTimeout(300);
    await shot(page, '16-lectura-completada');
    check('Al terminar aparece el resumen', await page.isVisible('.finish-inner'));
    await page.click('[data-act="quiz"]');
    await page.waitForTimeout(200);
    await shot(page, '17-test-comprension');
    for (let q = 0; q < 6; q++) {
        const opt = await page.$('[data-opt]');
        if (!opt) break;
        await opt.click();
        await page.waitForTimeout(800);
    }
    await shot(page, '18-resultado-test');
    check('El test muestra PPM efectivas', (await page.textContent('#finish-card')).includes('ppm efectivas'));
    await page.click('[data-act="close"]');
    await page.evaluate(() => LV.app.setSetting('wpm', 300));

    // Importación de archivos
    await goHome(page);
    const files = ['latin1.txt', 'doc.md', 'page.html', 'book.epub', 'doc.pdf', 'documento.docx',
        'documento.odt', 'texto.rtf', 'libro.fb2', 'libro.mobi', 'libro-palmdoc.mobi', 'presentacion.pptx', 'tabla.xlsx', 'subtitulos.srt'];
    for (const f of files) {
        await goHome(page);
        await page.setInputFiles('#file-input', path.join(FIX, f));
        await page.waitForFunction(() => !document.querySelector('#view-reader').hidden, null, { timeout: 30000 });
        const t = await page.evaluate(() => ({ title: LV.app.state.book.title, n: LV.app.state.tok.words.length, first: LV.app.state.tok.words.slice(0, 6).join(' ') }));
        check(`Importa ${f}`, t.n > 3, t);
        if (f === 'latin1.txt') check('Texto Windows-1252 decodificado (ñ y acentos)', /[ñóáé]/.test(t.first + (await page.evaluate(() => LV.app.state.book.text))), t.first);
    }
    // Documentos con imágenes: se conservan y se muestran en la lectura
    for (const f of ['con-imagen.epub', 'con-imagen.docx', 'documento.odt', 'libro.fb2', 'libro.mobi', 'presentacion.pptx', 'con-imagen.pdf']) {
        await goHome(page);
        await page.setInputFiles('#file-input', path.join(FIX, f));
        await page.waitForFunction(() => !document.querySelector('#view-reader').hidden && LV.app.state.tok, null, { timeout: 60000 });
        await page.evaluate(() => LV.app.setMode('guided'));
        await page.waitForFunction(() => document.querySelector('#page .fig img'), null, { timeout: 10000 }).catch(() => {});
        const r = await page.evaluate(() => ({ marks: LV.app.state.tok.images.length, loaded: LV.app.state.images.length, figs: document.querySelectorAll('#page .fig img').length }));
        check(`${f}: imágenes conservadas y visibles`, r.marks > 0 && r.loaded === r.marks && r.figs > 0, r);
        if (f === 'con-imagen.epub') await shot(page, '19a-epub-con-imagenes');
    }

    // PDF: vista original con las páginas reales
    check('PDF: vista original disponible', await page.isVisible('#btn-original'));
    await page.click('#btn-original');
    await page.waitForSelector('#original-host canvas', { timeout: 30000 });
    await page.waitForTimeout(800);
    await shot(page, '19b-pdf-vista-original');
    await page.click('#original-read');
    await page.waitForTimeout(500);
    check('«Leer desde esta página» vuelve a la lectura', (await state(page)).playing && !(await page.isVisible('#original-view')));
    await page.evaluate(() => LV.app.pause());

    // PDF escaneado: OCR automático
    await goHome(page);
    await page.setInputFiles('#file-input', path.join(FIX, 'escaneado.pdf'));
    await page.waitForFunction(() => !document.querySelector('#view-reader').hidden && LV.app.state.book && /PDF/i.test(LV.app.state.book.source), null, { timeout: 120000 });
    const scanned = await page.evaluate(() => LV.app.state.book.text.slice(0, 80));
    check('PDF escaneado: texto reconocido por OCR', /murci|veloz|saxof/i.test(scanned), scanned);

    await goHome(page);
    await page.setInputFiles('#file-input', path.join(FIX, 'shot.png'));
    await page.waitForTimeout(400);
    await shot(page, '19-ocr-en-progreso');
    await page.waitForFunction(() => LV.app.state.book && LV.app.state.book.source === 'OCR', null, { timeout: 90000 });
    const ocr = await page.evaluate(() => LV.app.state.book.text.slice(0, 80));
    check('OCR de una captura de pantalla', ocr.length > 10, ocr);
    await page.evaluate(() => LV.app.setMode('guided'));
    await shot(page, '20-texto-desde-captura');

    // Pegar texto
    await goHome(page);
    await page.locator('[data-open="paste"]:visible').first().click();
    await page.fill('#paste-title', 'Texto pegado de prueba');
    await page.fill('#paste-text', 'La lectura veloz es una habilidad que se entrena. Con práctica diaria, la vista aprende a avanzar con menos pausas. Lo importante es mantener la comprensión.');
    await shot(page, '21-pegar-texto');
    await page.click('#paste-ok');
    await page.waitForFunction(() => LV.app.state.book && LV.app.state.book.title === 'Texto pegado de prueba');
    check('Pegar texto abre el lector', true);

    // Biblioteca
    await page.keyboard.press('b');
    await page.waitForTimeout(400);
    const books = (await page.$$('#library-list .book-card')).length;
    await shot(page, '22-biblioteca');
    check('La biblioteca guarda todos los textos', books >= 20, books);
    await page.keyboard.press('Escape');

    // Persistencia de la posición tras recargar
    await page.evaluate(() => LV.app.seek(15));
    await page.waitForTimeout(1800);
    await page.reload();
    await page.waitForFunction(() => window.LV && LV.app);
    await page.waitForTimeout(500);
    await page.click('#recent-books .book-card');
    await page.waitForFunction(() => LV.app.state.tok);
    check('Recuerda la posición al recargar', (await state(page)).pos === 15, (await state(page)).pos);

    // Inicio con historial y estadísticas
    await goHome(page);
    await page.waitForTimeout(400);
    await shot(page, '23-inicio-con-biblioteca');
    await page.locator('[data-open="stats"]:visible').first().click();
    await page.waitForTimeout(400);
    await shot(page, '24-estadisticas');
    check('Las estadísticas registran sesiones', (await page.$$('.session-item')).length > 0);
    await page.keyboard.press('Escape');

    // Entrenamiento
    await page.click('#open-training');
    await page.waitForTimeout(300);
    await shot(page, '25-entrenamiento');
    const cards = await page.$$('#view-training [data-ex], #view-training .tr-card, #view-training button.tr-hub-card');
    check('El centro de entrenamiento muestra ejercicios', cards.length >= 4, cards.length);
    if (cards[0]) {
        await cards[0].click();
        await page.waitForTimeout(400);
        await shot(page, '26-tabla-schulte');
        await page.keyboard.press('Escape');
    }
    const cards2 = await page.$$('#view-training [data-ex], #view-training .tr-card, #view-training button.tr-hub-card');
    if (cards2[1]) {
        await cards2[1].click();
        await page.waitForTimeout(300);
        const start = await page.$('#view-training .btn');
        if (start) await start.click();
        await page.waitForTimeout(900);
        await shot(page, '27-destello');
        await page.keyboard.press('Escape');
    }

    // Service worker (PWA)
    const sw = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return !!reg;
    });
    check('El service worker (modo sin conexión) se registra', sw);
    await page.context().close();

    /* ---------------- Móvil ---------------- */
    console.log('\nMóvil (390×844)');
    const mob = await newPage(browser, { width: 390, height: 844 }, errors);
    await mob.waitForTimeout(500);
    await shot(mob, '30-movil-inicio');
    await openSample(mob);
    await mob.evaluate(() => LV.app.setSetting('immersive', false));
    for (const [k, m] of [['31', 'focus'], ['32', 'guided'], ['33', 'peri']]) {
        await mob.evaluate((m) => { LV.app.setMode(m); LV.app.seek(30); LV.app.play(); }, m);
        await mob.waitForTimeout(1800);
        await shot(mob, `${k}-movil-${m}`);
        await mob.evaluate(() => LV.app.pause());
    }
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check('Sin desplazamiento horizontal en móvil', !overflow);
    await mob.locator('[data-open="settings"]:visible').first().click();
    await mob.waitForTimeout(400);
    await shot(mob, '34-movil-ajustes');
    await mob.context().close();

    /* ---------------- Táctil (Android) ---------------- */
    console.log('\nTáctil: gestos al estilo VLC (390×844)');
    {
        const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
        const tp = await tctx.newPage();
        tp.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        const cdp = await tctx.newCDPSession(tp);
        const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
        const swipe = async (x0, y0, x1, y1, name) => {
            await touch('touchStart', [[x0, y0]]);
            for (let i = 1; i <= 12; i++) { await touch('touchMove', [[x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12]]); await tp.waitForTimeout(16); }
            if (name) await tp.screenshot({ path: path.join(OUT, name + '.png') });
            await touch('touchEnd', []);
            await tp.waitForTimeout(150);
        };
        const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await tp.waitForTimeout(40); await touch('touchEnd', []); };
        const ts = () => tp.evaluate(() => ({ pos: LV.app.state.pos, playing: LV.app.state.playing, wpm: LV.app.settings.wpm, size: LV.app.settings.rsvpSize, sheet: !document.querySelector('#quick-sheet').hidden }));
        await tp.goto(`http://localhost:${PORT}/`);
        await tp.waitForFunction(() => window.LV && LV.app);
        await tp.click('#load-sample');
        await tp.waitForFunction(() => LV.app.state.tok);
        await tp.waitForTimeout(300);
        check('Táctil: guía de gestos la primera vez', await tp.isVisible('#gesture-coach'));
        await tp.screenshot({ path: path.join(OUT, '40-tactil-guia.png') });
        await tp.tap('#coach-ok');
        await tp.evaluate(() => LV.app.seek(20));
        await tp.screenshot({ path: path.join(OUT, '41-tactil-lector.png') });
        let t0 = await ts();
        await swipe(330, 520, 330, 300, '42-tactil-velocidad');
        let t1 = await ts();
        check('Táctil: deslizar arriba a la derecha sube la velocidad', t1.wpm > t0.wpm, [t0.wpm, t1.wpm]);
        await swipe(60, 400, 60, 520);
        let t2 = await ts();
        check('Táctil: deslizar abajo a la izquierda reduce el texto', t2.size < t1.size, [t1.size, t2.size]);
        await swipe(100, 420, 320, 420, '43-tactil-avanzar');
        let t3 = await ts();
        check('Táctil: deslizar en horizontal avanza en el texto', t3.pos > t2.pos, [t2.pos, t3.pos]);
        await tap(195, 420);
        await tp.waitForTimeout(200);
        check('Táctil: un toque inicia la lectura', (await ts()).playing);
        await tap(195, 420);
        await tp.waitForTimeout(200);
        check('Táctil: otro toque la pausa', !(await ts()).playing);
        const before = (await ts()).pos;
        await tap(340, 420);
        await tp.waitForTimeout(80);
        await tap(340, 420);
        await tp.waitForTimeout(200);
        check('Táctil: doble toque a la derecha salta a la frase siguiente', (await ts()).pos > before);
        await touch('touchStart', [[195, 420]]);
        await tp.waitForTimeout(750);
        await touch('touchEnd', []);
        await tp.waitForTimeout(350);
        check('Táctil: mantener pulsado abre el panel rápido', (await ts()).sheet);
        await tp.screenshot({ path: path.join(OUT, '44-tactil-panel.png') });
        await tctx.close();
    }

    /* ---------------- Integración con PixPin (simulada) ---------------- */
    console.log('\nIntegración con PixPin');
    {
        const pctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const pp = await pctx.newPage();
        pp.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        const pdf = fs.readFileSync(path.join(FIX, 'con-imagen.pdf')).toString('base64');
        await pp.addInitScript((pdf) => {
            window.__calls = [];
            window.__ev = {};
            const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
            window.__TAURI__ = {
                core: { invoke: async (c, a) => { window.__calls.push([c, JSON.parse(JSON.stringify(a || {}))]); return c === 'pixpin_read_file' ? bytes.buffer.slice(0) : null; } },
                event: { listen: async (n, f) => { window.__ev[n] = f; return () => {}; } },
            };
        }, pdf);
        await pp.goto(`http://localhost:${PORT}/`);
        await pp.waitForFunction(() => window.__ev && window.__ev['pixpin-open']);
        const link = (t) => 'lecturaveloz://pixpin/abrir?v=1&doc=abc123&ruta=' + encodeURIComponent('C:\\Docs\\Informe.pdf') + '&nombre=Informe.pdf&tipo=pdf&pagina=1&frac=0.5&fraccion=0.5&paginas=3&t=' + t;
        await pp.evaluate((u) => window.__ev['pixpin-open']({ payload: u }), link(Date.now()));
        await pp.waitForFunction(() => LV.app.state.book && LV.app.state.book.source === 'PixPin', null, { timeout: 30000 });
        await pp.waitForTimeout(500);
        const o = await pp.evaluate(() => ({ pos: LV.app.state.pos, n: LV.app.state.tok.words.length, tags: LV.app.state.book.tags, reader: !document.querySelector('#view-reader').hidden }));
        check('PixPin: abre el documento directamente en el lector', o.reader, o);
        check('PixPin: continúa desde el marcador verde (página 2)', o.pos > 20 && o.pos < 49, o.pos);
        check('PixPin: el libro queda etiquetado «PixPin»', (o.tags || []).includes('PixPin'), o.tags);
        await pp.evaluate(() => { LV.app.setSetting('wpm', 600); LV.app.play(); });
        await pp.waitForTimeout(1200);
        await pp.evaluate(() => LV.app.pause());
        await pp.waitForTimeout(300);
        const sync = await pp.evaluate(() => window.__calls.filter((c) => c[0] === 'pixpin_sync').map((c) => c[1].progress));
        const lastSync = sync[sync.length - 1] || {};
        check('PixPin: devuelve el progreso (página y posición) al pausar', lastSync.doc === 'abc123' && lastSync.tipo === 'pdf' && typeof lastSync.pagina === 'number', lastSync);
        const lvPos = await pp.evaluate(() => LV.app.state.pos);
        await pp.evaluate((u) => window.__ev['pixpin-open']({ payload: u }), link(1000));
        await pp.waitForTimeout(800);
        check('PixPin: si el marcador de PixPin es más antiguo, gana Lectura Veloz', (await pp.evaluate(() => LV.app.state.pos)) === lvPos);
        check('PixPin: no duplica el libro al reabrirlo', (await pp.evaluate(async () => (await LV.storage.books.all()).length)) === 1);
        await pp.click('#reader-back');
        await pp.waitForTimeout(400);
        await pp.screenshot({ path: path.join(OUT, '50-pixpin-biblioteca.png') });
        await pctx.close();
    }

    check('Sin errores de JavaScript en consola', errors.length === 0, errors);

    await browser.close();
    srv.close();
    console.log(`\n${passed} correctas, ${failed} fallidas. Capturas en ${OUT}`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
