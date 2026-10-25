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
    const files = ['latin1.txt', 'doc.md', 'page.html', 'book.epub', 'doc.pdf', 'documento.docx'];
    for (const f of files) {
        await goHome(page);
        await page.setInputFiles('#file-input', path.join(FIX, f));
        await page.waitForFunction(() => !document.querySelector('#view-reader').hidden, null, { timeout: 30000 });
        const t = await page.evaluate(() => ({ title: LV.app.state.book.title, n: LV.app.state.tok.words.length, first: LV.app.state.tok.words.slice(0, 6).join(' ') }));
        check(`Importa ${f}`, t.n > 3, t);
        if (f === 'latin1.txt') check('Texto Windows-1252 decodificado (ñ y acentos)', /[ñóáé]/.test(t.first + (await page.evaluate(() => LV.app.state.book.text))), t.first);
    }
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
    check('La biblioteca guarda todos los textos', books >= 8, books);
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

    check('Sin errores de JavaScript en consola', errors.length === 0, errors);

    await browser.close();
    srv.close();
    console.log(`\n${passed} correctas, ${failed} fallidas. Capturas en ${OUT}`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
