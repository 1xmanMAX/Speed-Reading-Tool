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

async function newPage(browser, viewport, errors) {
    const ctx = await browser.newContext({ viewport, colorScheme: 'dark', locale: 'es-ES' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.LV && LV.app);
    return page;
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
const state = (page) => page.evaluate(() => ({ pos: LV.app.state.pos, playing: LV.app.state.playing, mode: LV.app.settings.mode, n: LV.app.state.tok ? LV.app.state.tok.words.length : 0 }));

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
    check('Se muestran las 9 tarjetas de modos', (await page.$$('.mode-card')).length === 9);

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
    await page.click('[data-open="settings"]');
    await page.waitForTimeout(400);
    await shot(page, '11-ajustes');
    await page.keyboard.press('Escape');
    await page.click('[data-open="shortcuts"]');
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
    await page.click('#go-home');
    const files = ['latin1.txt', 'doc.md', 'page.html', 'book.epub', 'doc.pdf'];
    for (const f of files) {
        await page.click('#go-home');
        await page.setInputFiles('#file-input', path.join(FIX, f));
        await page.waitForFunction(() => !document.querySelector('#view-reader').hidden, null, { timeout: 30000 });
        const t = await page.evaluate(() => ({ title: LV.app.state.book.title, n: LV.app.state.tok.words.length, first: LV.app.state.tok.words.slice(0, 6).join(' ') }));
        check(`Importa ${f}`, t.n > 3, t);
        if (f === 'latin1.txt') check('Texto Windows-1252 decodificado (ñ y acentos)', /[ñóáé]/.test(t.first + (await page.evaluate(() => LV.app.state.book.text))), t.first);
    }
    await page.click('#go-home');
    await page.setInputFiles('#file-input', path.join(FIX, 'shot.png'));
    await page.waitForTimeout(400);
    await shot(page, '19-ocr-en-progreso');
    await page.waitForFunction(() => LV.app.state.book && LV.app.state.book.source === 'OCR', null, { timeout: 90000 });
    const ocr = await page.evaluate(() => LV.app.state.book.text.slice(0, 80));
    check('OCR de una captura de pantalla', ocr.length > 10, ocr);
    await page.evaluate(() => LV.app.setMode('guided'));
    await shot(page, '20-texto-desde-captura');

    // Pegar texto
    await page.click('#go-home');
    await page.click('[data-open="paste"]');
    await page.fill('#paste-title', 'Texto pegado de prueba');
    await page.fill('#paste-text', 'La lectura veloz es una habilidad que se entrena. Con práctica diaria, la vista aprende a avanzar con menos pausas. Lo importante es mantener la comprensión.');
    await shot(page, '21-pegar-texto');
    await page.click('#paste-ok');
    await page.waitForFunction(() => LV.app.state.book && LV.app.state.book.title === 'Texto pegado de prueba');
    check('Pegar texto abre el lector', true);

    // Biblioteca
    await page.click('[data-open="library"]');
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
    await page.click('#go-home');
    await page.waitForTimeout(400);
    await shot(page, '23-inicio-con-biblioteca');
    await page.click('[data-open="stats"]');
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
    await mob.click('[data-open="settings"]');
    await mob.waitForTimeout(400);
    await shot(mob, '34-movil-ajustes');
    await mob.context().close();

    check('Sin errores de JavaScript en consola', errors.length === 0, errors);

    await browser.close();
    srv.close();
    console.log(`\n${passed} correctas, ${failed} fallidas. Capturas en ${OUT}`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
