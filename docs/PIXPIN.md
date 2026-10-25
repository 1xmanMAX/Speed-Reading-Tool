# Integración con PixPin (y lectura rápida desde cualquier app)

Lectura Veloz (app de escritorio, Tauri) ofrece dos formas de enviarle texto
al instante sin pegarlo a mano. Ambas acaban igual: la ventana se muestra, pasa
a primer plano y empieza la lectura del texto.

| Vía | Cuándo usarla |
| --- | --- |
| Atajo global **Ctrl+Alt+R** (⌘+⌥+R en macOS) | Copias el texto tú (PixPin, navegador, PDF…) y pulsas el atajo. |
| Enlace **`lecturaveloz://clipboard`** | Lo abre otra app o script, p. ej. una acción personalizada de PixPin. |

> Todo esto solo funciona en la **app de escritorio** instalada. La versión web/PWA
> no puede registrar atajos globales ni enlaces `lecturaveloz://`; allí hay que pegar
> el texto (Ctrl+V).

## 1. Atajo global Ctrl+Alt+R

1. En PixPin haz una captura y usa **OCR → Copiar texto** (o copia cualquier texto).
2. Pulsa **Ctrl+Alt+R** desde cualquier sitio, aunque Lectura Veloz esté minimizada
   o en segundo plano (tiene que estar abierta).
3. Lectura Veloz lee el portapapeles, se muestra y empieza a leer.

Detalles:

- Si el portapapeles está vacío, no pasa nada.
- Si lo que hay es una **imagen** (por ejemplo, copiaste la captura en lugar del texto
  OCR), la app la recibe y hace el OCR ella misma. Es más lento y puede ser menos
  preciso que el OCR de PixPin.
- Si otra aplicación ya usa Ctrl+Alt+R, el atajo no se registra (la app sigue
  funcionando). En ese caso usa el enlace del apartado siguiente.

## 2. Enlace `lecturaveloz://` (para scripts y PixPin)

Al instalarse, la app registra el esquema `lecturaveloz://`. Al abrir:

- `lecturaveloz://clipboard` (o `lecturaveloz://read`): la app espera **hasta ~3 s**
  a que cambie el contenido del portapapeles y lo lee. Esa espera existe porque el
  OCR puede terminar de copiarse un instante *después* de abrirse el enlace. Si el
  portapapeles no cambia en ese tiempo, lee lo que haya (aunque sea el mismo texto
  de la vez anterior).
- `lecturaveloz://read?text=Hola%20mundo`: lee directamente el texto del parámetro
  (codificado como URL). Útil para textos cortos desde otros scripts.

Si la app está cerrada, el enlace la abre. Si ya está abierta, la misma ventana
recibe el texto (no se abre una segunda copia).

### Acción personalizada en PixPin (Windows)

PixPin permite asignar scripts a acciones o atajos. Un script que hace el OCR y
manda el resultado a Lectura Veloz:

```js
pixpin.screenShot(ShotAction.CopyOcrText);
pixpin.runSystem("cmd /c start lecturaveloz://clipboard");
```

1. Se abre la captura de PixPin; seleccionas la zona.
2. PixPin hace el OCR y copia el texto.
3. Se abre `lecturaveloz://clipboard` y Lectura Veloz lee el texto.

**Puntos sin verificar (pruébalos y ajusta):**

- Los nombres `pixpin.screenShot`, `ShotAction.CopyOcrText` y `pixpin.runSystem`
  vienen de la documentación/ejemplos de scripts de PixPin. **No se han probado
  aquí** y pueden variar según la versión. Si fallan, consulta la ayuda de scripts de
  tu versión de PixPin.
- No está claro si `screenShot(...)` espera a que termine el OCR o regresa antes.
  Por eso la app espera hasta 3 s a que cambie el portapapeles. Si el OCR tarda más,
  aumenta ese margen o abre el enlace con un retardo.
- Si `cmd /c start ...` muestra una ventana de consola fugaz, alternativas:
  - `explorer.exe lecturaveloz://clipboard`
  - `rundll32 url.dll,FileProtocolHandler lecturaveloz://clipboard`
- Si PixPin no tiene `runSystem`, puedes copiar con OCR (acción normal de PixPin) y
  luego pulsar **Ctrl+Alt+R** (apartado 1).

### Probar el enlace sin PixPin

Copia un texto y ejecuta:

- **Windows** (Win+R o terminal): `cmd /c start lecturaveloz://clipboard`
- **macOS**: `open "lecturaveloz://clipboard"`
- **Linux**: `xdg-open "lecturaveloz://clipboard"`

## Registro del esquema `lecturaveloz://` según el sistema

- **Windows:** lo registra el instalador (`.msi` / `.exe`). En `npm run dev` la app
  lo registra al arrancar.
- **macOS:** se registra cuando la app (`.app` en *Aplicaciones*) se ha abierto al
  menos una vez. En modo `dev` **no funciona**; hay que usar la app empaquetada.
- **Linux:** el paquete `.deb`/`.rpm` lo registra mediante su archivo `.desktop`. Con
  AppImage, o en `dev`, la app lo registra al arrancar en
  `~/.local/share/applications`. Requiere `xdg-open` y un entorno de escritorio que
  respete `x-scheme-handler`.
- **Android/iOS:** el esquema se declara en la configuración móvil (hosts
  `clipboard` y `read`). No hay atajo global en móvil, y PixPin no existe en esas
  plataformas. Leer el portapapeles en segundo plano está restringido en Android 10+
  e iOS (puede devolver vacío o mostrar un aviso de pegado). No está verificado en
  dispositivos reales.

## Para desarrolladores (frontend)

Eventos que emite la app (con `app.withGlobalTauri`):

```js
const { event, core } = window.__TAURI__;
await event.listen('quick-read', (e) => startReading(e.payload));         // string
await event.listen('quick-read-image', (e) => ocrThenRead(e.payload));    // "data:image/png;base64,..."
// Después de registrar los listeners (por si la app se abrió desde un enlace):
const pending = await core.invoke('quick_read_ready');
// pending: null | { type: "text", text } | { type: "image", dataUrl }
```

Comando extra: `core.invoke('read_clipboard')` → `string | null`.
