package com.lecturaveloz.tts

import androidx.core.content.FileProvider

/**
 * FileProvider propio del plugin (autoridad `<app>.lvfiles`): la app de Tauri ya declara el
 * `androidx.core.content.FileProvider` genérico y dos `<provider>` con la misma clase chocan al
 * unir los manifiestos. Solo comparte `cache/abrir-en-pixpin/` (ver `xml/lv_file_paths.xml`).
 */
class LvFileProvider : FileProvider()
