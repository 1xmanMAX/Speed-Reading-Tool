package com.lecturaveloz.tts

import android.app.Activity
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

    override fun load(webView: WebView) {
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
     */
    @Command
    fun copyUri(invoke: Invoke) {
        val args = invoke.parseArgs(CopyUriArgs::class.java)
        Thread {
            try {
                val uri = Uri.parse(args.uri)
                if (uri.scheme != "content" && uri.scheme != "file") throw IllegalArgumentException("URI no válida")
                val safe = (args.name ?: "documento").replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(120).ifBlank { "documento" }
                val dir = File(activity.cacheDir, "pixpin").apply { mkdirs() }
                val out = File(dir, safe)
                activity.contentResolver.openInputStream(uri).use { input ->
                    if (input == null) throw IllegalStateException("No se pudo abrir el documento")
                    out.outputStream().use { input.copyTo(it) }
                }
                val res = JSObject()
                res.put("path", out.absolutePath)
                invoke.resolve(res)
            } catch (e: Exception) {
                invoke.reject("No se pudo leer el documento de PixPin: ${e.message}")
            }
        }.start()
    }

    /** Devuelve a PixPin el punto de lectura para que mueva su marcador verde 🟢. */
    @Command
    fun notifyPixpin(invoke: Invoke) {
        val a = invoke.parseArgs(PixpinArgs::class.java)
        try {
            val intent = Intent("com.forge.pixpin.LECTURA_VELOZ").apply {
                setPackage("com.forge.pixpin")
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
}
