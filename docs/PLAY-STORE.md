# Publicar Lectura Veloz en Google Play

Guía para publicar la app **gratis** ahora y dejarla lista para añadir **suscripciones, cuentas y
servidores** más adelante, según las políticas de Google Play vigentes en octubre de 2026.

Textos de la ficha y gráficos: [`store/ficha.md`](../store/ficha.md) y la carpeta `store/`.

---

## 1. Lo que ya está hecho en la app (1.0.0)

| Requisito de Google Play | Estado |
|---|---|
| **Formato AAB** (Play ya no acepta APK para apps nuevas) | `npm run android:build` → `.aab` con arm64, armv7 y x86_64. El workflow *Release* lo genera y firma al publicar una etiqueta `v*`. |
| **API de destino ≥ 36** (Android 16) para apps nuevas desde el 31-ago-2026 | `targetSdk = 37` (Android 17), `minSdk = 24` |
| **Páginas de 16 KB** en las librerías nativas (apps para Android 15+) | `src-tauri/build.rs` enlaza con `max-page-size=16384`; comprobado en las tres arquitecturas, y el APK con `zipalign -P 16`. |
| **Permisos** mínimos | Solo `INTERNET` (voces de Azure, opcionales) y `VIBRATE`. Nada sensible: sin ubicación, contactos, almacenamiento, cámara ni micrófono. |
| **Sin código descargado** fuera de Play | Todo va dentro: pdf.js, JSZip, mammoth, ONNX Runtime, fuentes y modelos del OCR (`web/vendor`, generado por `scripts/vendor.mjs` con versiones y SHA-256 fijos). Una prueba automática comprueba que la app **no se conecta a ningún servidor de terceros**. |
| **Política de privacidad** pública | `web/legal.html#privacidad` (también enlazada desde *Ajustes*). |
| **Licencias de terceros** y condiciones de los modelos Indra | `web/legal.html#terminos` y `#licencias`; las licencias van dentro de la app. |
| **Sin anuncios, sin cuentas, sin analítica** | Simplifica *Seguridad de los datos* y la clasificación. |

---

## 2. Antes de subirla (lo que tienes que hacer tú)

### 2.1 Cuenta de desarrollador
1. Crea la cuenta en [play.google.com/console](https://play.google.com/console) (pago único de 25 USD).
   - **Personal** basta para esta app; *Organización* solo es obligatoria para apps financieras, de salud, VPN o de gobierno.
   - Si piensas cobrar a nombre de una empresa, una cuenta de organización (necesita D-U-N-S) muestra los datos de la empresa en vez de los tuyos.
2. Completa la **verificación de identidad**. Desde 2026 es la misma *verificación de desarrollador de Android*, que exige registrar los nombres de paquete.
3. Declara tu **estado de comerciante** (*trader*) para la UE y el Reino Unido. Es obligatorio al crear la cuenta; el plazo para cuentas existentes es el 1-feb-2027.
   - **Mientras la app sea gratis y sin compras:** *no comerciante*.
   - **Al monetizar:** pasa a *comerciante*. En una cuenta personal eso **publica tu teléfono y tu dirección** en la ficha; desde el 1-mar-2027, para todos los usuarios. Es otra razón para usar una cuenta de organización si vas a cobrar.
4. **Prueba cerrada obligatoria** (cuentas personales creadas desde noviembre de 2023):
   - **12 testers** inscritos en la prueba cerrada durante **14 días seguidos**.
   - Después solicitas acceso a producción.
   - Calcula unas 3 semanas hasta la publicación.

### 2.2 Clave de firma (importante)
- El AAB y el APK se firman con la clave **`lecturaveloz`** (`lectura-veloz.jks`), que te envié aparte con su contraseña. **Guárdala en un lugar seguro.**
- Para que GitHub genere el AAB firmado, añade en *Settings → Secrets and variables → Actions* estos secretos:
  - `ANDROID_KEYSTORE_BASE64`: el resultado de `base64 -w0 lectura-veloz.jks`.
  - `ANDROID_KEYSTORE_PASSWORD`: la contraseña.
  - `ANDROID_KEY_ALIAS`: `lecturaveloz`.
- **Play App Signing:** al subir el primer AAB, Play te pregunta por la clave de firma de la app.
  - **Recomendado: «Usar una clave generada por Google».** La clave `lecturaveloz` queda como *clave de subida*; si la pierdes, Google permite cambiarla.
  - Consecuencia: la versión de Play tendrá otra firma que los APK que instalaste a mano. **Desinstala el APK una vez antes de instalar desde Play.** Hazlo después de exportar tus libros si te importan: los datos están en el teléfono.
  - Alternativa: subir `lecturaveloz` como clave de la app (Play da la herramienta PEPK para exportarla). Así los APK instalados a mano se actualizan desde Play, pero esa clave pasa a ser imposible de cambiar.

### 2.3 Página de privacidad en internet
- Play necesita una **URL pública**. Activa GitHub Pages en *Settings → Pages → Source: GitHub Actions*.
- El workflow *Deploy web to GitHub Pages* publicará la web, y la política quedará en `https://1xmanmax.github.io/Speed-Reading-Tool/legal.html#privacidad`.

### 2.4 Subir
1. Crea la app en Play Console:
   - Nombre: «Lectura Veloz».
   - Idioma predeterminado: español.
   - App o juego: **app**.
   - Gratis o de pago: **gratis**. Una app gratis no puede pasar a ser de pago, pero sí puede tener suscripciones.
2. *Pruebas → Prueba cerrada*: sube el AAB, añade a los 12 testers (por lista de correos o Grupo de Google) y espera los 14 días.
3. Rellena *Contenido de la app* (sección 3) y la *Ficha principal* (`store/ficha.md`).
4. Solicita acceso a producción y publica.

---

## 3. Respuestas para «Contenido de la app»

| Apartado | Respuesta |
|---|---|
| Política de privacidad | La URL de la sección 2.3 |
| Anuncios | **No**, la app no contiene anuncios |
| Acceso a la app | **Todas las funciones están disponibles sin restricciones** (no hay inicio de sesión) |
| Clasificación de contenido | Cuestionario IARC; categoría «Referencia, noticias o educación»; sin violencia, sexo, lenguaje, drogas, apuestas ni interacción entre usuarios → saldrá *Para todos / PEGI 3*. Google ya **no admite apps sin clasificar** (jul-2026). |
| Público objetivo | **13+**, sin marcar menores de 13, para no entrar en la política de Familias (que añade requisitos). Si algún día quieres llegar a niños, revisa esa política antes. |
| App de noticias | No |
| Apps de salud / financieras / gobierno | No |
| Estado de comerciante | Ver 2.1 |
| Seguridad de los datos | Ver 3.1 |

### 3.1 Seguridad de los datos (Data safety)
La app no envía nada salvo una función opcional: las **voces de Microsoft Azure con la clave del propio usuario**. Si la activa, el texto que se lee se manda a Microsoft para generar el audio. Google considera «recopilado» cualquier dato que sale del dispositivo, aunque no lo guarde nadie. Respuestas recomendadas:

- **¿Recopila o comparte datos?** Sí. Solo por la opción de Azure.
- **Tipo de datos:** *Mensajes y contenido del usuario → Otro contenido generado por el usuario* (el texto que se lee en voz alta).
  - Recopilado: **sí**. Compartido: **no** (Microsoft actúa como proveedor del servicio para el propio usuario).
  - **Se procesa de forma efímera:** sí.
  - **Obligatorio u opcional:** opcional (el usuario decide activarlo).
  - **Finalidad:** funcionalidad de la app.
- **Cifrado en tránsito:** sí (HTTPS).
- **El usuario puede pedir que se borren los datos:** no se conservan datos (procesamiento efímero, nada en servidores propios).

Si prefieres declarar «No recopila ningún dato», habría que quitar la opción de Azure de la versión de Play. Las voces neuronales del teléfono siguen funcionando sin ella.

---

## 4. Cada versión nueva

1. Sube la versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`.
   - El `versionCode` sale de la versión: 1.0.0 → 1000000, 1.0.1 → 1000001, 1.1.0 → 1001000. Siempre debe crecer.
2. `git tag v1.0.1 && git push --tags`: el workflow *Release* genera el AAB firmado (con los secretos de 2.2) y el APK.
3. Sube el AAB en Play Console y escribe las notas de la versión.
4. Requisito de cada año: el **31 de agosto** Google sube la API de destino mínima. Revisa [la página oficial](https://developer.android.com/google/play/requirements/target-sdk) cada verano.

---

## 5. Plan para monetizar, cuentas y servidores (políticas 2026)

Nada de esto hace falta para publicar gratis. Está pensado para que, cuando llegue, no haya que rehacer nada.

### 5.1 Cobrar dentro de la app
- **Bienes digitales** (suscripción «Pro», funciones extra) → **Google Play Billing obligatorio** en general.
  - En **EE. UU., Reino Unido y el EEE** existen desde 2026 los programas de *facturación alternativa* y *enlaces externos*, con comisiones reducidas. Hay que inscribirse y declarar las transacciones; en EE. UU., las comisiones se pagan desde el 1-oct-2026.
- **Técnicamente:** Tauri no trae compras integradas. Se añade un plugin Kotlin propio (como `tauri-plugin-lv-tts`) con la **Play Billing Library** y un pequeño servidor que **verifique cada compra** con la Google Play Developer API y escuche las *Real-time developer notifications* (Pub/Sub) para renovaciones y cancelaciones.
- **Política de suscripciones:**
  - Precio, periodo y renovación claros antes de pagar.
  - Cómo cancelar, con enlace a la gestión de suscripciones de Play.
  - Si hay periodo de prueba, cuándo empieza a cobrarse.
  - Si hay descuentos por condición (p. ej. estudiantes), explicar quién puede usarlos (aclaración de 2026).
- **Japón:** si vendes allí, hay que completar la autorización de pagos (fecha límite 1-dic-2026 para quien ya vende).
- **Estado de comerciante:** pasa a *comerciante* (ver 2.1).
- **Modelo sugerido:** mantener gratis todo lo que hoy existe (lectura, modos, OCR, voz) y cobrar por lo que cuesta dinero mantener:
  - sincronización entre aparatos;
  - voces premium en la nube;
  - biblioteca en la nube;
  - estadísticas avanzadas.

### 5.2 Cuentas de usuario
- Si la app permite **crear una cuenta**, es obligatorio:
  - un camino **dentro de la app** para borrar la cuenta y sus datos;
  - un **enlace web** donde pedirlo, que nombre la app o al desarrollador y que funcione sin la app instalada;
  - indicarlo en Play Console.
  - Si borrar la cuenta exige cancelar antes la suscripción, hay que explicarlo y ofrecer ayuda.
- Inicio de sesión recomendado: **Credential Manager** de Android (Google, passkeys).
  - No uses el registro de llamadas para verificar teléfonos: está prohibido desde el 27-ene-2027.
  - Para SMS, usa *SMS Retriever* o *SMS User Consent*.
- *Acceso a la app* (sección 3): si alguna función exige cuenta, da a Google una **cuenta de prueba** para la revisión.
- **Play Age Signals:** API nueva (oct-2026) para adaptar funciones según la edad. No es obligatoria para esta app; tenla en cuenta si añades funciones sociales.

### 5.3 Servidores
- Actualiza **antes de lanzar** la *Seguridad de los datos* y `web/legal.html`. Ya se compromete a hacerlo antes de que lleguen estas funciones. Hay que indicar:
  - qué datos se guardan (correo, progreso, biblioteca);
  - dónde se guardan;
  - cuánto tiempo;
  - con quién se comparten.
- Usuarios europeos: proveedor con acuerdo de tratamiento de datos (RGPD), datos mínimos y cifrado en tránsito y en reposo.
- Los documentos de los usuarios son lo más delicado. Recomendado: que la sincronización sea opcional y, si se puede, cifrada de extremo a extremo.

### 5.4 Licencias a revisar antes de cobrar
- **OCR Indra (modelos de Datalab, OpenRAIL-M modificada):**
  - Gratis mientras tú (o tu empresa) no superéis **20 M USD** de ingresos o de financiación.
  - Y **mientras no ofrezcas un producto que compita con los de Datalab** (procesamiento de documentos y OCR como servicio).
  - Una app de lectura veloz que cobra probablemente no compite. Aun así, antes de monetizar conviene pedirles la licencia comercial ([datalab.to](https://www.datalab.to/pricing)) o cambiar el OCR de Android por **ML Kit** de Google (gratis, en el teléfono, apto para uso comercial).
  - Mientras se usen sus modelos, sus restricciones deben seguir en los términos de la app (ya están).
- **El código de la app no tiene licencia** y el repositorio es **público**: cualquiera puede leerlo, pero nadie tiene permiso para reutilizarlo. Si vas a cobrar, decide:
  - repositorio privado;
  - o una licencia que proteja tu trabajo.
- **PDF.js 3.11.174** tiene un fallo conocido (CVE-2024-4367) que solo se aprovecha con `isEvalSupported: true`. La app lo usa siempre con `false`. Pasar a PDF.js 4 o 5 exige cambiar a módulos ES; queda pendiente para una versión futura.

### 5.5 Distribuir APK fuera de Play
- La **verificación de desarrollador de Android** también se aplica a las apps instaladas a mano:
  - desde septiembre de 2026 en Brasil, Indonesia, Singapur y Tailandia;
  - en todo el mundo a partir de 2027.
- Un APK de un desarrollador no registrado pedirá pasos extra o ADB. Con la cuenta de Play verificada y el paquete registrado, los APK firmados con tu clave siguen instalándose con normalidad.

---

## 6. Fuentes (consultadas el 30-oct-2026)
- [Requisito de API de destino](https://developer.android.com/google/play/requirements/target-sdk) · [Play Console: API de destino](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Anuncio de políticas 29-oct-2026](https://support.google.com/googleplay/android-developer/answer/18100766) · [15-jul-2026](https://support.google.com/googleplay/android-developer/answer/17134731) · [15-abr-2026](https://support.google.com/googleplay/android-developer/answer/16926792)
- [Requisitos de Play Console](https://support.google.com/googleplay/android-developer/answer/17125096) · [Estado de comerciante](https://support.google.com/googleplay/android-developer/answer/17594752)
- [Eliminación de cuentas](https://support.google.com/googleplay/android-developer/answer/13327111) · [Seguridad de los datos](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Prueba cerrada de 12 testers](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Facturación alternativa en EE. UU.](https://support.google.com/googleplay/android-developer/answer/15582165)
- [Verificación de desarrolladores (Android Authority)](https://www.androidauthority.com/android-sideloading-changes-timeline-3679204/)
- [Páginas de 16 KB (Android NDK)](https://groups.google.com/g/Android-ndk/c/2TfuH2HVvgY)
