/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'

// Botón de dictado por voz (Web Speech API del navegador, en español).
// Cada frase reconocida se envía por onText para añadirla al campo.
// Si el navegador no lo soporta (p. ej. Firefox), no se muestra.
export function MicButton({ onText, className = '', title = 'Dictar por voz' }: {
  onText: (text: string) => void
  className?: string
  title?: string
}) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recRef = useRef<any>(null)

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!SR)
    return () => { try { recRef.current?.stop() } catch { /* noop */ } }
  }, [])

  function toggle() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    if (listening) { try { recRef.current?.stop() } catch { /* noop */ } return }
    const rec = new SR()
    rec.lang = 'es-ES'
    rec.interimResults = false
    rec.continuous = true
    rec.onresult = (e: any) => {
      let finalText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript
      }
      if (finalText.trim()) onText(finalText.trim())
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    try { rec.start(); setListening(true) } catch { setListening(false) }
  }

  if (!supported) return null
  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? 'Detener dictado' : title}
      className={`inline-flex items-center justify-center h-9 w-9 rounded-lg border transition-colors shrink-0 ${
        listening ? 'bg-red-50 border-red-300 text-red-600 animate-pulse' : 'border-gray-200 text-gray-500 hover:text-primary-600 hover:border-primary-300'
      } ${className}`}
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  )
}
