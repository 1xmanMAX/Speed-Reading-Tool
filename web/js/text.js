/* Lectura Veloz — motor de texto
 * Tokenización, punto óptimo de reconocimiento (ORP), tiempos y agrupación en bloques.
 */
window.LV = window.LV || {};

(function () {
    'use strict';

    // Palabras funcionales en español e inglés: no conviene que un bloque termine en ellas
    const FUNCTION_WORDS = new Set((
        'a al ante bajo con contra de del desde durante e el en entre hacia hasta la las le les lo los mediante ' +
        'ni o para por que se según sin so sobre su sus tras u un una unas unos y mi tu me te nos ' +
        'the a an of to in on at by for with and or but from as is'
    ).split(' '));

    const OPENING = /^[¿¡«“"'‘(\[{—–-]+/;
    const CLOSING = /[»”"'’)\]}.,;:!?…—–-]+$/;
    const LETTER = /[\p{L}\p{N}]/u;

    // Bits de la marca de pausa de cada palabra
    const F_COMMA = 1;      // , ; :
    const F_SENTENCE = 2;   // . ! ? …
    const F_PARAGRAPH = 4;  // fin de párrafo
    const F_NUMBER = 8;

    function countWords(text) {
        const m = text.match(/\S+/g);
        return m ? m.length : 0;
    }

    /**
     * Convierte el texto en una estructura compacta:
     *  words: string[]           palabras tal cual aparecen
     *  flags: Uint8Array         marcas de puntuación / párrafo
     *  paraStarts: number[]      índice de la primera palabra de cada párrafo
     */
    function tokenize(text) {
        const normalized = String(text || '')
            .replace(/\r\n?/g, '\n')
            .replace(/­/g, '')
            .replace(/[ \t ]+/g, ' ');
        const paragraphs = normalized.split(/\n\s*\n+|\n(?=\s*[—–-]\s)/);
        const words = [];
        const paraStarts = [];

        for (const para of paragraphs) {
            const parts = para.trim().split(/\s+/).filter(Boolean);
            if (parts.length === 0) continue;
            paraStarts.push(words.length);
            for (const part of parts) {
                // Dividir compuestos con guion muy largos
                if (part.length > 16 && /\p{L}-\p{L}/u.test(part)) {
                    const pieces = part.split(/(?<=-)/);
                    for (const p of pieces) words.push(p);
                } else {
                    words.push(part);
                }
            }
        }

        const flags = new Uint8Array(words.length);
        const paraSet = new Set(paraStarts);
        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            let f = 0;
            const tail = w.match(CLOSING);
            if (tail) {
                const t = tail[0];
                if (/[.!?…]/.test(t)) f |= F_SENTENCE;
                else if (/[,;:—–]/.test(t)) f |= F_COMMA;
            }
            if (/\d/.test(w)) f |= F_NUMBER;
            if (paraSet.has(i + 1) || i === words.length - 1) f |= F_PARAGRAPH | F_SENTENCE;
            flags[i] = f;
        }

        return { words, flags, paraStarts };
    }

    /** Parte "limpia" de una palabra (sin puntuación de apertura/cierre) y sus desplazamientos */
    function core(word) {
        const lead = (word.match(OPENING) || [''])[0].length;
        const trail = (word.slice(lead).match(CLOSING) || [''])[0].length;
        return { lead, len: Math.max(0, word.length - lead - trail) };
    }

    /** Índice del punto óptimo de reconocimiento (según OpenSpritz), sobre la palabra completa */
    function orpIndex(word) {
        const { lead, len } = core(word);
        if (len === 0) return Math.floor(word.length / 2);
        let pivot;
        if (len <= 1) pivot = 0;
        else if (len <= 5) pivot = 1;
        else if (len <= 9) pivot = 2;
        else if (len <= 13) pivot = 3;
        else pivot = 4;
        return lead + pivot;
    }

    /** Multiplicador de tiempo para una palabra */
    function delayFactor(word, flag, smart) {
        if (!smart) return 1;
        let f = 1;
        const { len } = core(word);
        if (flag & F_PARAGRAPH) f = 2.6;
        else if (flag & F_SENTENCE) f = 2.1;
        else if (flag & F_COMMA) f = 1.5;
        if (len > 8) f *= 1 + Math.min(0.6, 0.25 + (len - 8) * 0.04);
        else if (len <= 3 && f === 1) f = 0.9;
        if (flag & F_NUMBER) f *= 1.3;
        return f;
    }

    function isFunctionWord(word) {
        const { lead, len } = core(word);
        return FUNCTION_WORDS.has(word.substr(lead, len).toLowerCase());
    }

    /**
     * Calcula el final (exclusivo) de un bloque inteligente que empieza en `start`.
     * Corta en puntuación y evita terminar en artículos o preposiciones.
     */
    function chunkEnd(tok, start, size) {
        const n = tok.words.length;
        if (size <= 1) return Math.min(n, start + 1);
        const maxChars = 12 + size * 7;
        let end = start;
        let chars = 0;
        while (end < n && end - start < size) {
            chars += tok.words[end].length + 1;
            if (end > start && chars > maxChars) break;
            end++;
            if (tok.flags[end - 1] & (F_SENTENCE | F_COMMA)) break;
        }
        // No terminar en palabra funcional: recortar, o ampliar si el bloque quedaría de una palabra
        const endsWeak = (e) => e < n && isFunctionWord(tok.words[e - 1]) && !(tok.flags[e - 1] & (F_SENTENCE | F_COMMA));
        let trimmed = end;
        while (trimmed - start > 1 && endsWeak(trimmed)) trimmed--;
        if (trimmed - start >= 2 || trimmed === end) return trimmed;
        let extended = end;
        while (endsWeak(extended) && extended - start < size + 2) extended++;
        return endsWeak(extended) ? trimmed : extended;
    }

    /** Divide el texto completo en bloques (array de índices de inicio) */
    function buildChunks(tok, size) {
        const starts = [];
        let i = 0;
        while (i < tok.words.length) {
            starts.push(i);
            i = chunkEnd(tok, i, size);
        }
        return starts;
    }

    function sentenceStart(tok, i) {
        let j = Math.max(0, i - 1);
        while (j > 0 && !(tok.flags[j - 1] & F_SENTENCE)) j--;
        return j;
    }

    function nextSentence(tok, i) {
        let j = i;
        while (j < tok.words.length - 1 && !(tok.flags[j] & F_SENTENCE)) j++;
        return Math.min(tok.words.length - 1, j + 1);
    }

    /** Número de letras a resaltar en lectura biónica */
    function bionicCount(word, ratio) {
        const { len } = core(word);
        if (len <= 0) return 0;
        if (len <= 3) return 1;
        if (len === 4) return 2;
        return Math.ceil(len * ratio);
    }

    const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
    }

    function bionicHtml(word, ratio) {
        const { lead } = core(word);
        const n = bionicCount(word, ratio);
        if (n === 0) return escapeHtml(word);
        return escapeHtml(word.slice(0, lead)) + '<b>' + escapeHtml(word.slice(lead, lead + n)) + '</b>' + escapeHtml(word.slice(lead + n));
    }

    /** Tiempo estimado (ms) para leer desde `from` hasta el final */
    function estimateMs(tok, from, wpm, smart) {
        const base = 60000 / wpm;
        let total = 0;
        const n = tok.words.length;
        // Muestreo para textos muy grandes
        const step = n - from > 40000 ? Math.ceil((n - from) / 40000) : 1;
        for (let i = from; i < n; i += step) total += delayFactor(tok.words[i], tok.flags[i], smart) * step;
        return total * base;
    }

    function hasLetters(word) {
        return LETTER.test(word);
    }

    const SAMPLE = {
        title: 'El arte de leer rápido (texto de ejemplo)',
        text: [
            'Leer es una de las habilidades más valiosas que podemos cultivar. Cada libro abre una puerta distinta: una idea nueva, una historia que no conocíamos, una forma diferente de mirar el mundo. Sin embargo, el tiempo es limitado y la lista de lecturas pendientes no deja de crecer.',
            'La lectura veloz propone una solución sencilla: entrenar la vista y la atención para avanzar por el texto con menos pausas innecesarias. Cuando leemos de forma tradicional, los ojos no se deslizan de manera continua; saltan de un punto a otro en pequeños movimientos llamados sacadas, y se detienen en fijaciones que duran apenas un cuarto de segundo.',
            'El modo de enfoque muestra una sola palabra a la vez en el mismo lugar de la pantalla. La letra resaltada en color marca el punto óptimo de reconocimiento, el lugar exacto donde el cerebro identifica la palabra con mayor rapidez. Así, la vista permanece quieta y toda la energía se dedica a comprender.',
            'Los bloques agrupan dos, tres o más palabras para que aprendas a captar frases completas de un solo vistazo. El resaltado guiado, en cambio, conserva el texto entero y desliza una marca suave que te invita a seguir el ritmo sin perder el contexto de la página.',
            'La lectura biónica destaca el comienzo de cada palabra en negrita. Muchas personas sienten que la mirada se ancla con más facilidad, aunque la evidencia científica todavía es limitada. El degradado de color, por su parte, tiñe cada línea con un tono que continúa en la siguiente, de modo que el salto de renglón resulta más natural.',
            'Un consejo importante: la velocidad no lo es todo. La investigación muestra que existe un equilibrio entre rapidez y comprensión. Lo ideal es subir el ritmo poco a poco, comprobar que sigues entendiendo lo que lees y regresar a una velocidad cómoda cuando el texto se vuelve complejo.',
            'Practica unos minutos cada día. Prueba distintos modos, observa cuál se adapta mejor a cada tipo de lectura y celebra tu progreso en las estadísticas. Con constancia, notarás que lees con más fluidez, más concentración y, sobre todo, con más ganas.',
        ].join('\n\n'),
    };

    LV.text = {
        F_COMMA, F_SENTENCE, F_PARAGRAPH, F_NUMBER,
        countWords, tokenize, orpIndex, delayFactor, chunkEnd, buildChunks,
        sentenceStart, nextSentence, bionicCount, bionicHtml, escapeHtml, estimateMs,
        isFunctionWord, hasLetters, SAMPLE,
    };
})();
