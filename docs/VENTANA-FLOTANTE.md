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
