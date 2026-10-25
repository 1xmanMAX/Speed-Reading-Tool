# Ventana flotante (mini lector)

El modo flotante deja un lector pequeño, palabra por palabra (RSVP), siempre
visible mientras trabajas en otras aplicaciones. Cómo funciona depende de la
plataforma:

| Plataforma | Cómo funciona |
| --- | --- |
| **App de escritorio** (Windows, macOS, Linux) | La ventana principal se encoge a un mini reproductor de unos 460×170 px, sin bordes y **siempre encima**, en la esquina inferior derecha de la pantalla (respetando la barra de tareas o el Dock). Se arrastra desde la propia barra del mini lector y se puede redimensionar. Al salir, la ventana vuelve a su tamaño, posición y estado (maximizada, pantalla completa) anteriores. |
| **Chrome / Edge** (web/PWA) | Usa *Document Picture-in-Picture*: se abre una ventanita flotante del navegador con el lector, que se mantiene encima de las demás ventanas. |
| **Safari y otros navegadores** | Alternativa con *Picture-in-Picture de vídeo*: las palabras se dibujan en un vídeo que el navegador muestra flotando. Solo muestra la lectura; los controles son los del reproductor PiP. |
| **Android / iOS** | Todavía no disponible. |

## Atajos de teclado globales (escritorio)

Funcionan aunque estés trabajando en otra aplicación: **no** activan ni traen
al frente la ventana de Lectura Veloz (salvo `Ctrl+Alt+F`, que la vuelve a
mostrar si estaba oculta o minimizada). En macOS, `Ctrl` es `Cmd`.

| Atajo | Acción |
| --- | --- |
| `Ctrl+Alt+R` | Lectura rápida del portapapeles (trae la ventana al frente) |
| `Ctrl+Alt+Espacio` | Pausar / reanudar |
| `Ctrl+Alt+↑` | Más rápido |
| `Ctrl+Alt+↓` | Más lento |
| `Ctrl+Alt+→` | Frase siguiente |
| `Ctrl+Alt+←` | Frase anterior |
| `Ctrl+Alt+F` | Activar / desactivar la ventana flotante |
| `Ctrl+Alt+V` | Activar / desactivar la lectura en voz alta |

Si otra aplicación ya usa alguna combinación, ese atajo no se registra (se
anota en la consola) y los demás siguen funcionando. Ojo: en algunos
escritorios Linux `Ctrl+Alt+←/→` cambia de escritorio virtual, y en algunos
equipos Windows con gráficos Intel gira la pantalla.

## Gestos con el ratón (ventana flotante)

| Gesto | Acción |
| --- | --- |
| Clic | Pausar / reanudar |
| Rueda | Cambiar la velocidad |
| `Ctrl` + rueda | Cambiar el tamaño de la ventana |
| `Mayús` + rueda | Cambiar el tamaño del texto |
| Arrastrar | Mover la ventana |
| Doble clic | Volver a la ventana completa |
| Clic derecho | Cambiar entre vista por palabra y por frase |
| Arrastrar un borde | Redimensionar la ventana |

## Detalles técnicos (escritorio)

- El frontend llama al comando de Tauri `set_mini_mode`:
  - `window.__TAURI__.core.invoke('set_mini_mode', { enabled: true })` → entra en
    modo mini y devuelve `true`.
  - `window.__TAURI__.core.invoke('set_mini_mode', { enabled: false })` → restaura
    la ventana y devuelve `false`.
- En móvil el comando no hace nada y devuelve siempre `false`.
- Como la ventana mini no tiene bordes, la zona por la que se arrastra lleva el
  atributo `data-tauri-drag-region` (permiso `core:window:allow-start-dragging`
  en `src-tauri/capabilities/desktop.json`).
- Para moverla arrastrando desde cualquier punto (no solo la barra), el
  frontend llama a `window.__TAURI__.window.getCurrentWindow().startDragging()`
  al detectar `mousedown` + movimiento, para que un clic simple siga sirviendo
  para pausar.
- **Redimensionar por los bordes:** Tauri 2 (2.12) ya permite redimensionar
  ventanas sin bordes en Windows y Linux mientras la ventana sea
  `resizable` (lo es en modo mini); en macOS lo hace el sistema. La zona
  sensible es de unos 5 px en el borde de la ventana. Tamaño limitado entre
  260×90 y 1200×500 px lógicos.
- **Ctrl + rueda:** `invoke('mini_resize', { delta: 1.1 })` agranda un 10 % y
  `{ delta: 0.9 }` encoge, manteniendo fija la esquina inferior derecha y con
  los mismos límites. Solo actúa en modo mini; fuera de él (y en móvil) no
  hace nada y devuelve `Ok`. Un `delta` no positivo o no finito da error.
- **Atajos globales:** cada uno emite el evento `reader-cmd` a la ventana
  `main` con un texto: `toggle`, `faster`, `slower`, `next`, `prev`, `float` o
  `voice`. Se escucha con
  `window.__TAURI__.event.listen('reader-cmd', (e) => { /* e.payload */ })`.
  Solo se disparan al pulsar (no al soltar). Con `float` el frontend decide si
  entra o sale del modo mini (`set_mini_mode`).
