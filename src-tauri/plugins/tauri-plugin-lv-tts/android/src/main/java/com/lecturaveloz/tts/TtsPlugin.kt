package com.lecturaveloz.tts

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.io.File
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.Locale

@InvokeArg
class CopyUriArgs {
    lateinit var uri: String
    var name: String? = null
}

@InvokeArg
class PixpinArgs {
    lateinit var doc: String
    var tipo: String = "texto"
    var pagina: Int = 0
    var frac: Float = 0f
    var fraccion: Float = 0f
    var t: Long = 0
    var palabra: Int = 0
    var total: Int = 0
}

@InvokeArg
class OpenInPixpinArgs {
    lateinit var path: String
    var mime: String? = null
    var doc: String? = null
    var pagina: Int = 0
}

@InvokeArg
class SystemBarsArgs {
    var light: Boolean = false
}

@InvokeArg
class VibrateArgs {
    var ms: Long = 18
}

@InvokeArg
class SpeakArgs {
    lateinit var text: String
    var id: String = ""
    var rate: Float = 1f
    var pitch: Float = 1f
    var lang: String? = null
    var voice: String? = null
}

/**
 * Lectura en voz alta con el motor TextToSpeech de Android.
 * Eventos: "start", "word" (inicio/fin del fragmento que se pronuncia), "end" y "error",
 * todos con el `id` del fragmento para que la app sincronice el resaltado.
 */
@TauriPlugin
class TtsPlugin(private val activity: Activity) : Plugin(activity) {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var failed = false
    private val pending = mutableListOf<() -> Unit>()
    // Barras del sistema (barra de estado arriba, navegación abajo) en px CSS.
    private var safe = floatArrayOf(0f, 0f, 0f, 0f) // arriba, derecha, abajo, izquierda

    override fun load(webView: WebView) {
        watchInsets(webView)
        tts = TextToSpeech(activity.applicationContext) { status ->
            activity.runOnUiThread {
                ready = status == TextToSpeech.SUCCESS
                failed = !ready
                if (ready) tts?.setOnUtteranceProgressListener(listener)
                val tasks = pending.toList()
                pending.clear()
                tasks.forEach { it() }
            }
        }
    }

    /**
     * La app dibuja de borde a borde (enableEdgeToEdge): la barra de estado queda
     * encima de la página. Se pasa su alto a la web como --safe-top / --safe-bottom
     * para que los botones bajen y esa franja se pinte con el fondo de la app.
     */
    private fun watchInsets(webView: WebView) {
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val d = v.resources.displayMetrics.density
            safe = floatArrayOf(bars.top / d, bars.right / d, bars.bottom / d, bars.left / d)
            pushInsets(webView)
            ViewCompat.onApplyWindowInsets(v, insets)
        }
        webView.post { ViewCompat.requestApplyInsets(webView) }
    }

    private fun insetsJs(): String {
        val (t, r, b, l) = safe.map { String.format(Locale.US, "%.1fpx", it) }
        return "(function(s){if(!s)return;s.setProperty('--safe-top','$t');s.setProperty('--safe-right','$r');" +
            "s.setProperty('--safe-bottom','$b');s.setProperty('--safe-left','$l');})" +
            "(document.documentElement&&document.documentElement.style)"
    }

    private fun pushInsets(webView: WebView) {
        webView.post { webView.evaluateJavascript(insetsJs(), null) }
    }

    /** Alto de las barras del sistema, para cuando la página carga después del primer aviso. */
    @Command
    fun insets(invoke: Invoke) {
        val res = JSObject()
        res.put("top", safe[0].toDouble())
        res.put("right", safe[1].toDouble())
        res.put("bottom", safe[2].toDouble())
        res.put("left", safe[3].toDouble())
        invoke.resolve(res)
    }

    /** Iconos de la barra de estado oscuros (tema claro) o claros (tema oscuro). */
    @Command
    fun systemBars(invoke: Invoke) {
        val args = invoke.parseArgs(SystemBarsArgs::class.java)
        activity.runOnUiThread {
            val ctl = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            ctl.isAppearanceLightStatusBars = args.light
            ctl.isAppearanceLightNavigationBars = args.light
            invoke.resolve()
        }
    }

    override fun onDestroy() {
        tts?.stop()
        tts?.shutdown()
        tts = null
    }

    private fun whenReady(invoke: Invoke, block: (TextToSpeech) -> Unit) {
        activity.runOnUiThread {
            val engine = tts
            when {
                ready && engine != null -> block(engine)
                failed -> invoke.reject("No hay un motor de voz disponible. Instala «Speech Services by Google» desde Play Store.")
                else -> pending.add { whenReady(invoke, block) }
            }
        }
    }

    private fun event(name: String, id: String?, extra: (JSObject) -> Unit = {}) {
        val o = JSObject()
        o.put("id", id ?: "")
        extra(o)
        trigger(name, o)
    }

    private val listener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = event("start", utteranceId)
        override fun onDone(utteranceId: String?) = event("end", utteranceId)
        override fun onStop(utteranceId: String?, interrupted: Boolean) = Unit

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) = event("error", utteranceId)

        override fun onError(utteranceId: String?, errorCode: Int) =
            event("error", utteranceId) { it.put("code", errorCode) }

        override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) =
            event("word", utteranceId) {
                it.put("start", start)
                it.put("end", end)
            }
    }

    @Command
    fun speak(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakArgs::class.java)
        whenReady(invoke) { engine ->
            val wanted = args.voice?.let { name -> engine.voices?.firstOrNull { it.name == name } }
            if (wanted != null) {
                engine.voice = wanted
            } else {
                val locale = args.lang?.let { Locale.forLanguageTag(it) } ?: Locale("es", "ES")
                if (engine.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) engine.language = locale
            }
            engine.setSpeechRate(args.rate.coerceIn(0.25f, 4f))
            engine.setPitch(args.pitch.coerceIn(0.5f, 2f))
            val result = engine.speak(args.text, TextToSpeech.QUEUE_FLUSH, Bundle(), args.id)
            if (result == TextToSpeech.ERROR) invoke.reject("No se pudo leer el texto en voz alta.")
            else invoke.resolve()
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        activity.runOnUiThread {
            tts?.stop()
            invoke.resolve()
        }
    }

    @Command
    fun voices(invoke: Invoke) {
        whenReady(invoke) { engine ->
            val list = JSArray()
            engine.voices?.sortedBy { it.name }?.forEach { v ->
                val o = JSObject()
                o.put("id", v.name)
                o.put("lang", v.locale.toLanguageTag())
                o.put("network", v.isNetworkConnectionRequired)
                o.put("quality", v.quality)
                list.put(o)
            }
            val res = JSObject()
            res.put("voices", list)
            res.put("engine", engine.defaultEngine ?: "")
            invoke.resolve(res)
        }
    }

    @Command
    fun vibrate(invoke: Invoke) {
        val args = invoke.parseArgs(VibrateArgs::class.java)
        val ms = args.ms.coerceIn(1L, 200L)
        try {
            val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (vibrator?.hasVibrator() == true) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(ms)
                }
            }
        } catch (e: Exception) {
            // Sin vibración disponible: no es un error para el usuario
        }
        invoke.resolve()
    }

    /**
     * Copia a la caché un documento compartido por PixPin (content://, con permiso
     * temporal de lectura) y devuelve su ruta para que la app lo importe.
     *
     * Desde JS se pide como `plugin:lv-tts|copy_uri` (snake_case: así lo comprueba el permiso
     * `allow-copy-uri`); Tauri lo pasa a camelCase para llamar a este método.
     * Si falla, el mensaje dice qué paso falló y por qué (permiso, archivo que no está…).
     */
    @Command
    fun copyUri(invoke: Invoke) {
        val args = invoke.parseArgs(CopyUriArgs::class.java)
        Thread {
            try {
                val uri = Uri.parse(args.uri)
                if (uri.scheme != "content" && uri.scheme != "file") throw IllegalArgumentException("URI no válida: «${args.uri}»")
                val safe = (args.name ?: "documento").replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(120).ifBlank { "documento" }
                val dir = File(activity.cacheDir, "pixpin").apply { mkdirs() }
                val out = File(dir, safe)
                val input = (try {
                    activity.contentResolver.openInputStream(uri)
                } catch (e: SecurityException) {
                    throw IllegalStateException("PixPin no dio permiso de lectura para $uri (${e.message})")
                } catch (e: java.io.FileNotFoundException) {
                    throw IllegalStateException("PixPin no encuentra el archivo $uri (${e.message})")
                }) ?: throw IllegalStateException("el sistema no devolvió nada para $uri")
                input.use { i -> out.outputStream().use { i.copyTo(it) } }
                if (out.length() == 0L) throw IllegalStateException("el archivo de PixPin está vacío ($uri)")
                val res = JSObject()
                res.put("path", out.absolutePath)
                res.put("size", out.length())
                invoke.resolve(res)
            } catch (e: Exception) {
                android.util.Log.w("LecturaVelozPixPin", "copyUri ${args.uri}", e)
                invoke.reject("No se pudo leer el documento de PixPin: ${e.message ?: e.javaClass.simpleName}")
            }
        }.start()
    }

    /**
     * **Abrir en PixPin**: el documento del libro (ya guardado en `cache/abrir-en-pixpin/` por
     * `pixpin_stage_file`) se abre en PixPin con ACTION_VIEW, como «Abrir con» desde el
     * explorador: PixPin lo enseña en su visor de PDF, Word, EPUB, Markdown o texto.
     * Extras para PixPin: `com.lecturaveloz.extra.PIXPIN_DOC` (el código de su mensaje, si el
     * libro vino de PixPin: abre ese mensaje con su marcador verde) y `…PAGINA` (desde 1).
     */
    @Command
    fun openInPixpin(invoke: Invoke) {
        val a = invoke.parseArgs(OpenInPixpinArgs::class.java)
        try {
            val dir = File(activity.cacheDir, "abrir-en-pixpin").canonicalFile
            val file = File(a.path).canonicalFile
            if (file.parentFile != dir || !file.isFile) {
                invoke.reject("No se encontró el documento preparado para PixPin.")
                return
            }
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".lvfiles", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, a.mime?.takeIf { it.isNotBlank() } ?: "application/octet-stream")
                setPackage(PIXPIN)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                clipData = ClipData.newRawUri(file.name, uri)
                a.doc?.takeIf { it.isNotBlank() }?.let { putExtra("com.lecturaveloz.extra.PIXPIN_DOC", it) }
                if (a.pagina > 0) putExtra("com.lecturaveloz.extra.PAGINA", a.pagina)
            }
            activity.startActivity(intent)
            invoke.resolve()
        } catch (e: ActivityNotFoundException) {
            invoke.reject("PixPin no está instalada (o es una versión que no abre este formato).")
        } catch (e: Exception) {
            android.util.Log.w("LecturaVelozPixPin", "openInPixpin ${a.path}", e)
            invoke.reject("No se pudo abrir en PixPin: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    /** Devuelve a PixPin el punto de lectura para que mueva su marcador verde 🟢. */
    @Command
    fun notifyPixpin(invoke: Invoke) {
        val a = invoke.parseArgs(PixpinArgs::class.java)
        try {
            val intent = Intent("com.forge.pixpin.LECTURA_VELOZ").apply {
                setPackage(PIXPIN)
                putExtra("doc", a.doc)
                putExtra("tipo", if (a.tipo == "pdf") "pdf" else "texto")
                putExtra("pagina", a.pagina.coerceAtLeast(0))
                putExtra("frac", a.frac.coerceIn(0f, 1f))
                putExtra("fraccion", a.fraccion.coerceIn(0f, 1f))
                putExtra("t", a.t)
                putExtra("palabra", a.palabra)
                putExtra("total", a.total)
            }
            activity.sendBroadcast(intent)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("No se pudo avisar a PixPin: ${e.message}")
        }
    }

    companion object {
        private const val PIXPIN = "com.forge.pixpin"
    }
}
