#!/usr/bin/env node
/* Copia dentro de web/vendor/ todo lo que la app usaba desde CDN, para que funcione sin
 * conexión y no envíe nada a terceros (Google Play: Data safety sin datos compartidos).
 *
 *   npm run vendor          (lo ejecutan tauri build/dev y los workflows de GitHub)
 *
 * - Librerías JS y fuentes: de node_modules (versiones fijadas en package.json).
 * - Modelos del OCR Indra (Datalab, licencia OpenRAIL-M modificada): de Hugging Face, una
 *   revisión fija y comprobados con SHA-256. Se guardan con su LICENSE (obligatorio al
 *   distribuirlos; ver web/legal.html).
 * web/vendor/ no va en git: se regenera igual en cada máquina.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NM = join(ROOT, 'node_modules');
const OUT = join(ROOT, 'web', 'vendor');

const COPY = [
    ['pdfjs-dist/build/pdf.min.js', 'pdfjs/pdf.min.js'],
    ['pdfjs-dist/build/pdf.worker.min.js', 'pdfjs/pdf.worker.min.js'],
    ['pdfjs-dist/LICENSE', 'pdfjs/LICENSE'],
    ['jszip/dist/jszip.min.js', 'jszip/jszip.min.js'],
    ['jszip/LICENSE.markdown', 'jszip/LICENSE.md'],
    ['mammoth/mammoth.browser.min.js', 'mammoth/mammoth.browser.min.js'],
    ['mammoth/LICENSE', 'mammoth/LICENSE'],
    ['onnxruntime-web/dist/ort.wasm.min.js', 'ort/ort.wasm.min.js'],
    ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
    ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
];

// Fuentes (SIL Open Font License): latín y latín extendido bastan para español e inglés.
const FONTS = [
    { pkg: 'atkinson-hyperlegible-next', family: 'Atkinson Hyperlegible Next', faces: [[400, 'normal'], [500, 'normal'], [700, 'normal']] },
    { pkg: 'inter', family: 'Inter', faces: [[400, 'normal'], [500, 'normal'], [600, 'normal'], [700, 'normal']] },
    { pkg: 'lexend', family: 'Lexend', faces: [[300, 'normal'], [400, 'normal'], [500, 'normal']] },
    { pkg: 'literata', family: 'Literata', faces: [[400, 'normal'], [500, 'normal'], [600, 'normal'], [400, 'italic']] },
];
const SUBSETS = {
    latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
};

const INDRA_REV = 'v1.1.0';
const INDRA = {
    'det.onnx': 'f2bd4cba23e9c328cf7ec824634e423e191a2c6aacbbf35c62bd79dd70f62f59',
    'rec.onnx': '475972a2710be4a3cbfeb2bc7f3624ffd563de07de42476fc7a290d4e1ece484',
    'order.onnx': 'a42db2e8b536ad3d84045a4b7f9b0a72667cf8be4aa02d63f7b38004719fb180',
    'orient.onnx': '20eaf670f55a7cf9facfe1bdd6c7b8e40be75bbf4d48a3df43f66aa3bbd874fd',
    'meta.json': '4ce4c94b46f5d644033c02e718322014ff4081270f385038c571912b56696339',
    LICENSE: '50c88a018a7ee322e89f6b09401b237beb0cd331685879405b3db48993950a5f',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const put = (rel, data) => {
    const dest = join(OUT, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
};

function copyLibs() {
    for (const [src, dest] of COPY) {
        const from = join(NM, src);
        if (!existsSync(from)) throw new Error(`Falta ${src}: ejecuta «npm install» antes.`);
        mkdirSync(dirname(join(OUT, dest)), { recursive: true });
        copyFileSync(from, join(OUT, dest));
    }
}

function copyFonts() {
    let css = '/* Generado por scripts/vendor.mjs (fuentes de @fontsource, SIL Open Font License). */\n';
    for (const f of FONTS) {
        for (const [weight, style] of f.faces) {
            for (const [subset, range] of Object.entries(SUBSETS)) {
                const file = `${f.pkg}-${subset}-${weight}-${style}.woff2`;
                const from = join(NM, '@fontsource', f.pkg, 'files', file);
                if (!existsSync(from)) continue; // no todas las fuentes tienen latin-ext
                mkdirSync(join(OUT, 'fonts'), { recursive: true });
                copyFileSync(from, join(OUT, 'fonts', file));
                css += `@font-face{font-family:'${f.family}';font-style:${style};font-weight:${weight};font-display:swap;` +
                    `src:url(./${file}) format('woff2');unicode-range:${range};}\n`;
            }
        }
        const lic = join(NM, '@fontsource', f.pkg, 'LICENSE');
        if (existsSync(lic)) copyFileSync(lic, join(OUT, 'fonts', `LICENSE-${f.pkg}.txt`));
    }
    put('fonts/fonts.css', css);
}

async function fetchIndra() {
    for (const [name, hash] of Object.entries(INDRA)) {
        const dest = join(OUT, 'indra', name);
        if (existsSync(dest) && sha256(readFileSync(dest)) === hash) continue;
        const url = `https://huggingface.co/datalab-to/indra-ocr/resolve/${INDRA_REV}/${name}`;
        let buf = null;
        for (let i = 0; i < 4 && !buf; i++) {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                buf = Buffer.from(await res.arrayBuffer());
            } catch (e) {
                if (i === 3) throw new Error(`No se pudo descargar ${url}: ${e.message}`);
                await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
            }
        }
        const got = sha256(buf);
        if (got !== hash) throw new Error(`${name}: SHA-256 inesperado (${got}); no se usa.`);
        put(join('indra', name), buf);
    }
}

copyLibs();
copyFonts();
await fetchIndra();
console.log('web/vendor listo: pdf.js, JSZip, mammoth, ONNX Runtime, fuentes y modelos de Indra.');
