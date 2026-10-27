# Manual de integración: PixPin + Lectura Veloz

Con esta integración, cualquier texto que veas en pantalla (un PDF protegido, una imagen, un vídeo con subtítulos o una web que no deja copiar) se lee en **Lectura Veloz** con un solo atajo:

```
 Pulsas el atajo ─► PixPin captura la zona ─► PixPin hace OCR y copia el texto
                                                          │
          Lectura Veloz se abre y empieza a leer ◄── abre lecturaveloz://clipboard
```

Este manual explica cómo configurarla paso a paso. Luego da recetas listas para copiar, la forma de controlar la lectura desde PixPin y, al final, una referencia técnica por si quieres ampliar la integración.

> **Antes de empezar:** todo esto requiere la **app de escritorio** de Lectura Veloz instalada con su instalador (`.msi`/`.exe` en Windows). La versión web no puede recibir atajos globales ni enlaces `lecturaveloz://`; en la web basta con pegar el texto o la captura con `Ctrl+V`.

---

## Índice

1. [Requisitos](#1-requisitos)
2. [Método rápido: sin configurar nada](#2-método-rápido-sin-configurar-nada)
3. [Método recomendado: un solo atajo en PixPin](#3-método-recomendado-un-solo-atajo-en-pixpin)
4. [Recetas de scripts](#4-recetas-de-scripts)
5. [Controlar la lectura desde PixPin](#5-controlar-la-lectura-desde-pixpin)
6. [Usarlo desde la línea de comandos, AutoHotkey o accesos directos](#6-usarlo-desde-la-línea-de-comandos-autohotkey-o-accesos-directos)
7. [Comprobar que todo funciona](#7-comprobar-que-todo-funciona)
8. [Solución de problemas](#8-solución-de-problemas)
9. [macOS y Linux](#9-macos-y-linux)
10. [Referencia técnica (para desarrollar la integración)](#10-referencia-técnica-para-desarrollar-la-integración)

---

## 1. Requisitos

| Necesitas | Detalle |
|---|---|
| **PixPin** | Instalado y **abierto**: los scripts se ejecutan dentro de la instancia de PixPin que está en marcha. |
| **Lectura Veloz (escritorio)** | Instalada con el instalador, y abierta al menos una vez. El instalador registra los enlaces `lecturaveloz://`. |
| **Windows** | Los scripts de PixPin y su línea de comandos (`pixpin.exe -r`) son de Windows. Para macOS, ver el [apartado 9](#9-macos-y-linux). |

---

## 2. Método rápido: sin configurar nada

1. Haz una captura con PixPin y usa **OCR → copiar texto**, o copia texto de donde quieras.
2. Pulsa **`Ctrl + Alt + R`** desde cualquier aplicación.
3. Lectura Veloz pasa al frente y empieza a leer lo que había en el portapapeles.

Si en el portapapeles hay una **imagen** en vez de texto (por ejemplo, copiaste la captura sin OCR), Lectura Veloz hace el OCR por su cuenta.

---

## 3. Método recomendado: un solo atajo en PixPin

Con este método, un único atajo hace todo: capturar, reconocer el texto y empezar a leer.

### Paso 1. Abre la configuración de PixPin
Haz clic derecho en el icono de PixPin en la bandeja del sistema → **Configuración**.

### Paso 2. Ve a la página de atajos
Abre la página **«Atajos / Acciones»** (en inglés, *Shortcut / Action*). Ahí se crean las acciones con script.

### Paso 3. Crea una acción nueva de tipo script
Ponle un nombre, por ejemplo **«Leer con Lectura Veloz»**, y pega este script:

```js
pixpin.screenShot(ShotAction.CopyOcrText);
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');
```

Qué hace cada línea:
- **Línea 1:** abre la herramienta de captura. Seleccionas la zona y, al confirmar, PixPin hace OCR y copia el texto.
- **Línea 2:** abre el enlace `lecturaveloz://clipboard`. Lectura Veloz espera hasta 3 segundos a que llegue el texto nuevo al portapapeles y empieza a leer.

> El `""` vacío después de `start` es necesario. Sin él, Windows toma el enlace como título de ventana y no lo abre.

### Paso 4. Asígnale un atajo
Por ejemplo **`Ctrl + Shift + L`**. Si quieres, añade la acción también al menú de la bandeja.

### Paso 5. Pruébalo
Pulsa el atajo, selecciona un párrafo de cualquier ventana y confirma. En uno o dos segundos Lectura Veloz debería estar leyéndolo.

---

## 4. Recetas de scripts

Todas usan funciones de la API de scripts de PixPin: `pixpin.screenShot`, `pixpin.directScreenShot`, `pixpin.genRect`, `pixpin.getSpRect`, `pixpin.runSystem`, `ShotAction.*` y `PixConst.*`. Para abrir el enlace puedes usar cualquiera de estas dos líneas, son equivalentes:

```js
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');   // estándar
pixpin.runSystem('explorer.exe "lecturaveloz://clipboard"');      // sin ventana de consola
```

### 4.1 Elegir la zona con el ratón y leer (la básica)
```js
pixpin.screenShot(ShotAction.CopyOcrText);
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');
```

### 4.2 Leer la ventana que está bajo el ratón, sin seleccionar nada
Pones el ratón sobre la ventana (un PDF, un artículo…), pulsas el atajo y listo.
```js
pixpin.directScreenShot(pixpin.getSpRect(PixConst.SpRectWindowUnderMouse), ShotAction.CopyOcrText);
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');
```

### 4.3 Repetir la última zona: ideal para ir página a página
Primero lees una página con la receta 4.1. Luego pasas de página en tu visor y pulsas este otro atajo: captura **la misma zona** otra vez sin que tengas que seleccionarla.
```js
pixpin.directScreenShot(pixpin.getSpRect(PixConst.SpRectLastShotRect), ShotAction.CopyOcrText);
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');
```

### 4.4 Zona fija de la pantalla (por ejemplo, subtítulos de vídeos)
Ajusta los números (x, y, ancho, alto) a tu pantalla:
```js
pixpin.directScreenShot(pixpin.genRect(200, 900, 1500, 160), ShotAction.CopyOcrText);
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');
```

### 4.5 Leer toda la pantalla bajo el ratón
```js
pixpin.directScreenShot(pixpin.getSpRect(PixConst.SpRectScreenUnderMouse), ShotAction.CopyOcrText);
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');
```

### 4.6 Enviar la captura como imagen (OCR de Lectura Veloz)
Úsala si el OCR de PixPin no reconoce bien tu idioma. Lectura Veloz hace el OCR en español e inglés con su propio motor.
```js
pixpin.screenShot(ShotAction.Copy);
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');
```

### 4.7 Leer un texto fijo o generado
Puedes mandar el texto directamente en el enlace. Los espacios y acentos tienen que ir codificados:
```js
pixpin.runSystem('cmd /c start "" "lecturaveloz://read?text=Hola%20mundo"');
```

---

## 5. Controlar la lectura desde PixPin

Además de abrir textos, Lectura Veloz acepta **órdenes** con el enlace `lecturaveloz://control/<orden>`. Así puedes crear en PixPin acciones o entradas del menú de la bandeja que controlen la lectura **sin quitarle el foco a la aplicación en la que trabajas**.

| Orden | Enlace | Qué hace |
|---|---|---|
| Pausa / reanudar | `lecturaveloz://control/toggle` | Pausa o continúa la lectura |
| Más rápido | `lecturaveloz://control/faster` | +25 palabras por minuto (o más velocidad de voz) |
| Más lento | `lecturaveloz://control/slower` | −25 palabras por minuto |
| Frase siguiente | `lecturaveloz://control/next` | Salta a la frase siguiente |
| Frase anterior | `lecturaveloz://control/prev` | Vuelve a la frase anterior |
| Ventana flotante | `lecturaveloz://control/float` | Abre o cierra el mini lector siempre visible |
| Voz | `lecturaveloz://control/voice` | Activa o desactiva la lectura en voz alta |

Ejemplo de acción en PixPin para pausar:
```js
pixpin.runSystem('explorer.exe "lecturaveloz://control/toggle"');
```

Una combinación muy cómoda: **capturar y leer en la ventana flotante.**
```js
pixpin.screenShot(ShotAction.CopyOcrText);
pixpin.runSystem('cmd /c start "" "lecturaveloz://clipboard"');
pixpin.runSystem('cmd /c start "" "lecturaveloz://control/float"');
```

> Estas mismas órdenes también tienen **atajos globales** en la app de escritorio:
> `Ctrl+Alt+Espacio` (pausa), `Ctrl+Alt+↑/↓` (velocidad), `Ctrl+Alt+←/→` (frase), `Ctrl+Alt+V` (voz) y `Ctrl+Alt+F` (ventana flotante).

---

## 6. Usarlo desde la línea de comandos, AutoHotkey o accesos directos

**PixPin por línea de comandos (Windows).** PixPin tiene que estar abierto.
```bat
pixpin.exe -r "pixpin.screenShot(ShotAction.CopyOcrText); pixpin.runSystem('explorer.exe \"lecturaveloz://clipboard\"');"
```
También puedes guardar el script en un archivo `leer.js` y ejecutarlo con `pixpin.exe -f "C:\ruta\leer.js"`.

**AutoHotkey v2.** Ejemplo con `Win + R` como atajo:
```ahk
#r::Run 'pixpin.exe -f "C:\scripts\leer.js"'
#Space::Run "lecturaveloz://control/toggle"
```

**Acceso directo en el escritorio.** Clic derecho → *Nuevo → Acceso directo* → ubicación `lecturaveloz://clipboard`. Al hacer doble clic, Lectura Veloz lee lo que haya en el portapapeles.

---

## 7. Comprobar que todo funciona

Prueba las partes por separado, de la más simple a la más completa:

1. **¿Funciona el enlace?** Copia cualquier texto, pulsa `Win + R`, escribe `lecturaveloz://clipboard` y pulsa Enter. Lectura Veloz debería leerlo.
2. **¿Funciona el OCR de PixPin?** Haz una captura con *OCR → copiar* y pega el resultado en el Bloc de notas.
3. **¿Funciona el script?** Ejecuta la acción de PixPin. Si el OCR funciona pero la app no se abre, revisa la línea `runSystem` ([apartado 8](#8-solución-de-problemas)).

---

## 8. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| No pasa nada al usar el enlace | El enlace `lecturaveloz://` no está registrado | Reinstala Lectura Veloz con el instalador y ábrela una vez. |
| Lee el texto **anterior**, no el nuevo | El OCR tardó más de 3 s en llegar al portapapeles | Vuelve a lanzar la acción, o usa la receta 4.6 (imagen), que no depende del OCR de PixPin. |
| Aparece y desaparece una ventana negra | `cmd /c start` abre una consola momentánea | Usa `explorer.exe "lecturaveloz://..."` en su lugar. |
| Windows dice «no se encuentra el archivo» | Falta el `""` después de `start` | Escribe `cmd /c start "" "lecturaveloz://clipboard"`. |
| `Ctrl+Alt+R` no hace nada | Otra aplicación usa ese atajo | Usa el script de PixPin o un acceso directo (apartados 3 y 6). |
| `Ctrl+Alt+←/→` gira la pantalla | Atajo del controlador de gráficos Intel | Desactiva los atajos de Intel o usa los enlaces `control/next` y `control/prev`. |
| El OCR reconoce mal los acentos | Idioma del OCR de PixPin | Cambia el idioma del OCR en PixPin, o usa la receta 4.6. |
| El script da error en PixPin | El nombre de alguna función cambió en tu versión | Revisa la ayuda de scripts de PixPin; ShotAction tiene `Copy`, `Pin`, `CopyOcrText`, `Save`, `Translate`… |

---

## 9. macOS y Linux

- **macOS:** la documentación de scripts de PixPin solo habla de Windows. En Mac usa el **método rápido**: copia el texto con OCR en PixPin y pulsa **`⌘ + ⌥ + R`**.
  - El enlace también funciona: `open "lecturaveloz://clipboard"`.
  - Se registra la primera vez que abres la app desde *Aplicaciones*.
- **Linux:** PixPin no existe, pero puedes combinar cualquier herramienta de OCR (por ejemplo `normcap`) con `xdg-open "lecturaveloz://clipboard"`, o con el atajo `Ctrl + Alt + R`.

---

## 10. Referencia técnica (para desarrollar la integración)

### 10.1 Protocolo de enlaces `lecturaveloz://`

| Enlace | Comportamiento |
|---|---|
| `lecturaveloz://clipboard` (también `lecturaveloz://read` o `lecturaveloz:`) | Consulta el portapapeles cada 250 ms durante un máximo de 3 s, hasta que cambie respecto al último texto entregado. Si no cambia, entrega lo que haya. **Texto** → evento `quick-read`. **Imagen** → evento `quick-read-image` (PNG en *data URL*). La ventana pasa al frente. |
| `lecturaveloz://read?text=<texto>` | Lee directamente el texto del parámetro (codificado como URL). |
| `lecturaveloz://control/<orden>` | Órdenes `toggle`, `faster`, `slower`, `next`, `prev`, `float` y `voice`. Emite el evento `reader-cmd`. No cambia el foco, salvo `float`, que muestra la ventana si estaba oculta. |

- Si la app está cerrada, el enlace la abre.
- Si ya está abierta, el complemento *single-instance* reenvía el enlace a la ventana existente, así que nunca se abre una segunda copia.

### 10.2 Dónde está el código

| Pieza | Archivo |
|---|---|
| Recepción de enlaces, sondeo del portapapeles, atajos globales | `src-tauri/src/lib.rs` (`handle_urls`, `quick_read_waiting`, `reader_cmd`, `CONTROL_CMDS`) |
| Registro del esquema y hosts móviles | `src-tauri/tauri.conf.json` → `plugins.deep-link` |
| Permisos | `src-tauri/capabilities/*.json` |
| Respuesta de la interfaz a los eventos | `web/js/app.js` (`bindNative`, `runReaderCmd`) |

### 10.3 Eventos y comandos disponibles para la interfaz

```js
const { event, core } = window.__TAURI__;
await event.listen('quick-read', (e) => leer(e.payload));            // string
await event.listen('quick-read-image', (e) => ocr(e.payload));       // "data:image/png;base64,..."
await event.listen('reader-cmd', (e) => orden(e.payload));           // 'toggle' | 'faster' | …
const pendiente = await core.invoke('quick_read_ready');             // null | {type:'text',text} | {type:'image',dataUrl}
const texto = await core.invoke('read_clipboard');                   // string | null
await core.invoke('set_mini_mode', { enabled: true });               // ventana flotante (escritorio)
```

### 10.4 Añadir una orden nueva (ejemplo: `restart`)

1. **`src-tauri/src/lib.rs`:** añade `"restart"` a `CONTROL_CMDS`. Si además quieres un atajo global, añádelo también a `READER_SHORTCUTS`.
2. **`web/js/app.js`:** en `runReaderCmd`, añade `case 'restart': seek(0); play(); break;`.
3. **Comprueba y prueba:** ejecuta `cargo check` en `src-tauri`, abre la app con `npm run dev` y prueba con `Win + R` → `lecturaveloz://control/restart`.
4. **Documenta la orden:** añádela a la tabla del [apartado 5](#5-controlar-la-lectura-desde-pixpin).

### 10.5 Ideas para seguir ampliando

- **`lecturaveloz://control/wpm/<n>`** para fijar una velocidad exacta. Habría que leer el número de `url.path()` y emitir un evento `reader-set`.
- **Leer y abrir en la ventana flotante con un solo enlace**, por ejemplo `lecturaveloz://clipboard?float=1`.
- **Devolver el estado a PixPin.** `pixpin.runSystemSync` devuelve `{code, output, error}`, así que una pequeña utilidad de línea de comandos podría consultar a la app si está leyendo y a qué velocidad.
