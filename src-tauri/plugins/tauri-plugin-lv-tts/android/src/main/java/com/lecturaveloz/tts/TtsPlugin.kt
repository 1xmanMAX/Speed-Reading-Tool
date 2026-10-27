package com.lecturaveloz.tts

import android.app.Activity
import android.os.Bundle
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
}
