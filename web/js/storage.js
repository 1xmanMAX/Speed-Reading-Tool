/* Lectura Veloz — almacenamiento local
 * Libros en IndexedDB (soporta textos grandes), ajustes y estadísticas en localStorage.
 */
window.LV = window.LV || {};

(function () {
    'use strict';

    const DB_NAME = 'lectura-veloz';
    const DB_VERSION = 2;
    const STORE = 'books';
    const ASSETS = 'assets'; // imágenes y archivo original, separados para que la biblioteca cargue rápido
    const SETTINGS_KEY = 'lv.settings';
    const STATS_KEY = 'lv.stats';
    const LEGACY_KEY = 'fastReadingLibrary';

    let dbPromise = null;
    const memory = new Map(); // respaldo si IndexedDB no está disponible
    const memoryAssets = new Map();

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve) => {
            if (!('indexedDB' in window)) return resolve(null);
            let req;
            try {
                req = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (e) {
                return resolve(null);
            }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const store = db.createObjectStore(STORE, { keyPath: 'id' });
                    store.createIndex('lastOpened', 'lastOpened');
                }
                if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'bookId' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        });
        return dbPromise;
    }

    function tx(db, mode, fn, storeName = STORE) {
        return new Promise((resolve, reject) => {
            const t = db.transaction(storeName, mode);
            const store = t.objectStore(storeName);
            let result;
            const req = fn(store);
            if (req) req.onsuccess = () => { result = req.result; };
            t.oncomplete = () => resolve(result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
    }

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    const books = {
        async all() {
            const db = await openDb();
            const list = db ? await tx(db, 'readonly', (s) => s.getAll()) : [...memory.values()];
            return (list || []).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
        },
        async get(id) {
            const db = await openDb();
            return db ? tx(db, 'readonly', (s) => s.get(id)) : memory.get(id);
        },
        async put(book) {
            const db = await openDb();
            if (db) await tx(db, 'readwrite', (s) => s.put(book));
            else memory.set(book.id, book);
            return book;
        },
        async remove(id) {
            const db = await openDb();
            if (db) {
                await tx(db, 'readwrite', (s) => s.delete(id));
                await tx(db, 'readwrite', (s) => s.delete(id), ASSETS).catch(() => {});
            } else {
                memory.delete(id);
                memoryAssets.delete(id);
            }
        },
        /** { images: [{blob, alt}], original: {blob, type} } */
        async getAssets(id) {
            const db = await openDb();
            return (db ? await tx(db, 'readonly', (s) => s.get(id), ASSETS) : memoryAssets.get(id)) || null;
        },
        async putAssets(id, assets) {
            const rec = Object.assign({ bookId: id }, assets);
            const db = await openDb();
            if (db) await tx(db, 'readwrite', (s) => s.put(rec), ASSETS);
            else memoryAssets.set(id, rec);
        },
        /** Actualiza solo la posición sin reescribir el libro completo en memoria del llamador */
        async patch(id, fields) {
            const book = await books.get(id);
            if (!book) return null;
            Object.assign(book, fields);
            return books.put(book);
        },
        async create({ title, text, source, images, original, pageOffsets, cover }) {
            const now = Date.now();
            const existing = (await books.all()).find((b) => b.title === title && b.text.length === text.length);
            if (existing) {
                existing.lastOpened = now;
                return books.put(existing);
            }
            const id = uid();
            const hasImages = Array.isArray(images) && images.length > 0;
            if (hasImages || original) {
                await books.putAssets(id, { images: hasImages ? images : [], original: original || null });
            }
            return books.put({
                id,
                title,
                text,
                source: source || 'archivo',
                imageCount: hasImages ? images.length : 0,
                hasOriginal: !!original,
                originalType: original ? original.type : null,
                pageOffsets: pageOffsets || null,
                cover: cover || null,
                wordCount: LV.text ? LV.text.countWords(text) : text.split(/\s+/).length,
                index: 0,
                createdAt: now,
                lastOpened: now,
                finished: false,
            });
        },
        /** Migra la biblioteca de la versión anterior de la app (localStorage) */
        async migrateLegacy() {
            let legacy;
            try {
                legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
            } catch (e) {
                legacy = null;
            }
            if (!Array.isArray(legacy) || legacy.length === 0) return 0;
            let count = 0;
            for (const old of legacy) {
                if (!old || typeof old.text !== 'string') continue;
                const book = await books.create({
                    title: String(old.title || 'Sin título').replace(/\.txt$/i, ''),
                    text: old.text,
                    source: 'versión anterior',
                });
                if (old.currentIndex) {
                    book.index = old.currentIndex;
                    await books.put(book);
                }
                count++;
            }
            try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* sin acceso */ }
            return count;
        },
    };

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* almacenamiento lleno o bloqueado */ }
    }

    const settings = {
        load: (defaults) => Object.assign({}, defaults, readJson(SETTINGS_KEY, {})),
        save: (value) => writeJson(SETTINGS_KEY, value),
        clear: () => { try { localStorage.removeItem(SETTINGS_KEY); } catch (e) { /* nada */ } },
    };

    const MAX_SESSIONS = 1000;

    const stats = {
        load() {
            const s = readJson(STATS_KEY, null);
            return s && Array.isArray(s.sessions) ? s : { sessions: [], best: 0 };
        },
        /** session: { date, words, ms, mode, wpm, bookId, title } */
        add(session) {
            if (!session || session.words < 5 || session.ms < 3000) return stats.load();
            const s = stats.load();
            s.sessions.push(session);
            if (s.sessions.length > MAX_SESSIONS) s.sessions.splice(0, s.sessions.length - MAX_SESSIONS);
            const effective = Math.round(session.words / (session.ms / 60000));
            if (session.words >= 50) s.best = Math.max(s.best || 0, effective);
            writeJson(STATS_KEY, s);
            return s;
        },
        clear() {
            writeJson(STATS_KEY, { sessions: [], best: 0 });
        },
    };

    LV.storage = { books, settings, stats };
})();
