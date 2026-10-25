# Lectura Veloz

Lectura Veloz es una aplicación de lectura rápida, moderna, gratuita y sin conexión. Tiene **10 modos de lectura** (incluido un modo audiolibro), ejercicios de entrenamiento, un test de comprensión y estadísticas. Funciona en el **navegador (PWA)**, en **Windows, macOS y Linux**, y en **Android e iOS**. La misma interfaz ligera se empaqueta con [Tauri 2](https://v2.tauri.app), que usa un núcleo en Rust y el webview nativo del sistema.

## Modos de lectura

| # | Modo | Cómo funciona |
|---|------|---------------|
| 1 | **Enfoque** (RSVP) | Muestra una palabra a la vez en el mismo sitio. La letra del *punto óptimo de reconocimiento* (ORP, el método de Spritz) va resaltada en rojo y hay guías de fijación. |
| 2 | **Bloques** | Muestra grupos de 1 a 8 palabras con cortes inteligentes. Corta en la puntuación y no deja un bloque terminado en artículo o preposición («de», «la», «en»…). |
| 3 | **Resaltado** | Muestra el texto completo con una marca que avanza a tu ritmo. Lo ya leído se atenúa. |
| 4 | **Línea** | Un pautador recorre cada renglón (el método del dedo o la tarjeta) y el resto del texto se oscurece. |
| 5 | **Biónica** | Pone en negrita el inicio de cada palabra. La intensidad es ajustable. |
| 6 | **Degradado** | Cada renglón cambia de color y el siguiente continúa con ese color, al estilo de BeeLine. Los colores se adaptan al tema. |
| 7 | **Teleprompter** | El texto se desplaza de forma continua a la velocidad elegida. |
| 8 | **Periférica** | Muestra una columna estrecha con una línea central. Mantienes la vista en el centro y captas el renglón entero. |
| 9 | **Destello** | El bloque aparece un instante y luego se oculta. Sirve para entrenar la amplitud visual y la atención. |
| 0 | **Escuchar** | Audiolibro: una voz lee el libro y el texto se resalta palabra a palabra. |

## Lector a pantalla completa y ventana flotante

- El lector ocupa toda la pantalla. Los controles flotan en una píldora que **se oculta sola** mientras lees y vuelve al mover el ratón o tocar la pantalla. El progreso es una línea fina en el borde inferior; al pasar el ratón por encima puedes saltar a cualquier punto.
- **Ventana flotante** (botón ▣ o tecla `P`): un mini reproductor siempre visible para seguir leyendo mientras haces otras cosas.
  - **App de escritorio:** la ventana se convierte en un mini reproductor sin bordes y siempre encima.
  - **Chrome y Edge:** usa *Document Picture-in-Picture*.
  - **Safari y otros:** usa Picture-in-Picture de vídeo.
  - **Solo contenido:** sin botones ni bordes. Muestra únicamente la palabra, el bloque o la frase que lee la voz, en cualquier formato (PDF, EPUB, Word, TXT…).
  - **Ratón:**
    - Clic: pausa.
    - Rueda: velocidad.
    - `Shift`+rueda: tamaño del texto.
    - `Ctrl`+rueda: tamaño de la ventana.
    - Arrastrar: mover.
    - Clic derecho: vista palabra/frase.
    - Doble clic: volver a la ventana completa.
  - **Teclado:** `Espacio`, `←`/`→`, `↑`/`↓`, `+`/`−`, `V` (voz), `H` (ayuda) y `Esc`.
  - **Atajos globales** (app de escritorio, funcionan aunque estés en otra aplicación):
    - `Ctrl+Alt+Espacio`: pausa.
    - `Ctrl+Alt+↑`/`↓`: velocidad.
    - `Ctrl+Alt+←`/`→`: frase.
    - `Ctrl+Alt+V`: voz.
    - `Ctrl+Alt+F`: ventana flotante.
  - Cada libro de la biblioteca tiene un botón ▣ para abrirlo directamente en la ventana flotante.
  - Detalles en [docs/VENTANA-FLOTANTE.md](docs/VENTANA-FLOTANTE.md).

## Lectura en voz alta con voces de Microsoft

- **Microsoft Edge:** ofrece gratis las voces neuronales «Online (Natural)», por ejemplo *Microsoft Elvira Online (Natural)*. La app las detecta y las pone primero.
- **Windows:** la app de escritorio y los demás navegadores usan las voces locales de Microsoft (Helena, Laura, Pablo, Sabina), que funcionan sin conexión.
- **Microsoft Azure (opcional):** voces neuronales en cualquier dispositivo. Crea un recurso *Speech* gratuito (nivel F0, unos 500 000 caracteres al mes) en el portal de Azure y pega la clave y la región en *Ajustes → Voz*. La clave se guarda solo en tu dispositivo.
- La voz funciona en el modo **Escuchar** y también en cualquier otro modo (botón 🎧 o tecla `V`). El texto avanza sincronizado con la voz.

## Funciones

- **Importación**: PDF, EPUB, **Word (.docx)**, TXT (UTF-8 y Windows-1252), Markdown, HTML e **imágenes con OCR** (Tesseract, en español e inglés). También puedes pegar texto o capturas con Ctrl+V desde cualquier pantalla.
- **Integración con PixPin**:
  - El atajo global **Ctrl+Alt+R** lee lo que tengas en el portapapeles.
  - El enlace **`lecturaveloz://clipboard`** permite lanzar la lectura desde un script de PixPin.
  - Detalles en [docs/PIXPIN.md](docs/PIXPIN.md).
- **Ritmo inteligente**:
  - Pausa más en comas, puntos, finales de párrafo, palabras largas y números.
  - Aceleración progresiva opcional.
  - Arranque suave al reanudar.
  - Al pausar, retrocede hasta el inicio de la frase.
- **Test de comprensión** al terminar: genera preguntas de completar a partir del propio texto y calcula las **PPM efectivas**, es decir, la velocidad multiplicada por la comprensión.
- **Entrenamiento**:
  - Tabla de Schulte.
  - Destello con dificultad adaptativa.
  - Expansión de bloques.
  - Prueba de velocidad base con preguntas.
- **Lectura en voz alta** sincronizada, con las voces del sistema.
- **Estadísticas**: palabras leídas, tiempo, velocidad media, mejor marca, racha de días, gráfico semanal y comprensión media.
- **Biblioteca**:
  - Usa IndexedDB, así que admite libros grandes.
  - Recuerda la posición de cada libro.
  - Permite buscar.
  - Importa automáticamente la biblioteca de la versión anterior.
- **Apariencia**:
  - 5 temas (Automático, Oscuro, Claro, Sepia y OLED), con contraste verificado según WCAG AA.
  - Fuentes Atkinson Hyperlegible, Inter, Literata y Lexend.
  - Tamaño, interlineado y ancho de columna ajustables.
  - Modo inmersivo.
- **Atajos de teclado**: pulsa `?` dentro de la app para verlos todos.
  - `Espacio`: reproducir o pausar.
  - `←` / `→`: palabra anterior o siguiente.
  - `Shift` + `←` / `→`: frase anterior o siguiente.
  - `↑` / `↓`: más o menos velocidad.
  - `1` a `9` y `0`: cambiar de modo.
  - `M`: menú de modos. `V`: voz. `P`: ventana flotante.
- **Privacidad**: todo se guarda en tu dispositivo y no se envía nada a ningún servidor.

## Pruebas

```bash
npm test             # 51 comprobaciones en Chromium y capturas en tests/screenshots/
```

## Probarla

```bash
npm run serve        # abre http://localhost:8080
```

También puedes abrir `web/index.html` directamente en el navegador. Desde ahí se puede **instalar como app (PWA)** en el móvil o el escritorio.

## Compilar las apps nativas

Requisitos: [Node 20+](https://nodejs.org) y [Rust](https://rustup.rs). Después ejecuta `npm install`.

| Plataforma | Comando | Notas |
|------------|---------|-------|
| Escritorio (desarrollo) | `npm run dev` | En Linux necesitas `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`. |
| Windows / macOS / Linux | `npm run build` | Genera `.msi`/`.exe`, `.dmg`/`.app`, y `.deb`/`.rpm`/`.AppImage` en `src-tauri/target/release/bundle/`. |
| Android | `npm run android:init` y después `npm run android:build` | Necesita Android SDK y NDK, Java 17 y los targets de Rust para Android. |
| iOS | `npm run ios:init` y después `npm run ios:build` | Solo en macOS con Xcode y una cuenta de desarrollador. |

**Compilación automática:** al subir una etiqueta (`git tag v1.0.0 && git push --tags`), GitHub Actions compila Windows, macOS (Intel y Apple Silicon), Linux y un APK de Android, y crea un borrador de *release*. Además, cada push a `main` publica la versión web en GitHub Pages: activa *Settings → Pages → Source: GitHub Actions*.

### ¿Por qué Tauri?

Una app de Tauri ocupa unos pocos MB y usa mucha menos memoria que Electron, porque no incluye un navegador completo: usa el webview del sistema y un núcleo en Rust. La interfaz está hecha en JavaScript puro, sin frameworks ni paso de compilación, para que cargue al instante. El motor de lectura precalcula los tiempos de cada palabra y solo dibuja en pantalla la parte visible del texto, así que funciona con fluidez incluso con libros enteros.

## Estructura

```
web/                 Interfaz (HTML, CSS y JS sin dependencias)
  js/text.js         Motor de texto: tokenización, ORP, bloques y tiempos
  js/app.js          Reproductor, modos, biblioteca, estadísticas e interfaz
  js/importers.js    TXT/MD/HTML/EPUB/PDF/OCR (las librerías se cargan solo cuando hacen falta)
  js/training.js     Ejercicios de entrenamiento y generador de preguntas
  js/speech.js       Voz: voces del sistema (Microsoft) y Azure neuronal
  js/storage.js      IndexedDB y localStorage
  sw.js              Service worker (funciona sin conexión)
src-tauri/           App nativa (Rust): atajo global, portapapeles y enlaces lecturaveloz://
docs/PIXPIN.md       Guía de integración con PixPin
```

## Sobre la evidencia

La investigación (Rayner et al., 2016) muestra que existe un equilibrio entre velocidad y comprensión: leer mucho más rápido suele costar comprensión, sobre todo en textos difíciles. Por eso la app mide la comprensión y recomienda subir la velocidad poco a poco. Lectura Veloz es una herramienta para practicar y leer con más concentración, no una promesa milagrosa.
