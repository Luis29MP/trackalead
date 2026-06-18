import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, Send, Bot, Hand, User, ArrowLeft, Search, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatRelativeTime } from '@/lib/utils'

interface Conversation {
  id: string
  contact_number: string
  contact_name: string | null
  bot_paused: boolean
  last_message_at: string | null
  lead_id: string | null
}
interface Message {
  id: string
  from_number: string | null
  to_number: string | null
  message: string | null
  direction: 'inbound' | 'outbound'
  timestamp: string
}

function timeOf(d: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export function Conversations() {
  const { organization } = useAuth()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [lastMsg, setLastMsg] = useState<Record<string, string>>({})   // contact_number → último texto
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const selected = conversations.find(c => c.id === selectedId) ?? null

  useEffect(() => { if (organization?.id) load() }, [organization?.id])

  // Refresco ligero cada 5 s (mensajes nuevos / estado del bot)
  useEffect(() => {
    if (!organization?.id) return
    const t = setInterval(() => { load(); if (selected) loadMessages(selected.contact_number) }, 5000)
    return () => clearInterval(t)
  }, [organization?.id, selected?.contact_number])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function load() {
    if (!organization?.id) return
    const [{ data: convs }, { data: msgs }] = await Promise.all([
      supabase.from('whatsapp_conversations').select('*').eq('org_id', organization.id).order('last_message_at', { ascending: false }),
      supabase.from('whatsapp_messages').select('from_number, to_number, message, direction, timestamp').eq('org_id', organization.id).order('timestamp', { ascending: false }).limit(500),
    ])
    setConversations((convs ?? []) as Conversation[])
    // Último mensaje por contacto
    const map: Record<string, string> = {}
    for (const m of (msgs ?? []) as Message[]) {
      const contact = m.direction === 'inbound' ? m.from_number : m.to_number
      if (contact && !(contact in map)) map[contact] = m.message ?? ''
    }
    setLastMsg(map)
    setLoading(false)
  }

  async function loadMessages(contactNumber: string) {
    if (!organization?.id) return
    const { data } = await supabase.from('whatsapp_messages')
      .select('id, from_number, to_number, message, direction, timestamp')
      .eq('org_id', organization.id)
      .or(`from_number.eq.${contactNumber},to_number.eq.${contactNumber}`)
      .order('timestamp', { ascending: true })
    setMessages((data ?? []) as Message[])
  }

  function openConversation(c: Conversation) {
    setSelectedId(c.id)
    loadMessages(c.contact_number)
  }

  async function send() {
    if (!input.trim() || !selected || !organization) return
    const text = input.trim()
    setSending(true)
    const { data, error } = await supabase.functions.invoke('whatsapp-send', {
      body: { org_id: organization.id, to: selected.contact_number, message: text },
    })
    setSending(false)
    let errMsg: string | undefined = (data as { error?: string } | null)?.error
    if (error) {
      errMsg = error.message
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); if (b?.error) errMsg = b.error } catch { /* sin json */ } }
    }
    if (errMsg) { toast.error(`No se pudo enviar: ${errMsg}`, { duration: 8000 }); return }
    setInput('')
    await loadMessages(selected.contact_number)
  }

  async function setBotPaused(paused: boolean) {
    if (!selected) return
    const { error } = await supabase.from('whatsapp_conversations')
      .update({ bot_paused: paused, updated_at: new Date().toISOString() }).eq('id', selected.id)
    if (error) { toast.error('No se pudo cambiar el estado'); return }
    setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, bot_paused: paused } : c))
    toast.success(paused ? 'Has tomado el control — el bot no responderá' : 'Bot reactivado para esta conversación')
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(c =>
      c.contact_number.includes(q) || (c.contact_name?.toLowerCase().includes(q) ?? false))
  }, [conversations, search])

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }} className="bg-white">

      {/* ── Lista de conversaciones ───────────────────────────────────────── */}
      <div className={`flex flex-col border-r border-gray-200 ${selected ? 'hidden md:flex' : 'flex'}`} style={{ width: 340, flexShrink: 0 }}>
        <div className="px-4 py-3 border-b border-gray-100 shrink-0">
          <h1 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-2">
            <MessageCircle className="h-4 w-4 text-emerald-500" />Conversaciones
          </h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input placeholder="Buscar número o nombre…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-12 px-4">
              <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Sin conversaciones todavía. Aparecerán aquí cuando un cliente escriba por WhatsApp.
            </div>
          ) : (
            filtered.map(c => (
              <button
                key={c.id}
                onClick={() => openConversation(c)}
                className={`w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-center gap-3 ${selectedId === c.id ? 'bg-emerald-50/60' : ''}`}
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <User className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.contact_name || c.contact_number}</p>
                    <span className="text-[10px] text-gray-400 shrink-0">{timeOf(c.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-gray-400 truncate">{lastMsg[c.contact_number] || c.contact_number}</p>
                    {c.bot_paused
                      ? <span className="text-[9px] font-bold text-amber-600 flex items-center gap-0.5 shrink-0"><Hand className="h-2.5 w-2.5" />Manual</span>
                      : <span className="text-[9px] font-bold text-emerald-600 flex items-center gap-0.5 shrink-0"><Bot className="h-2.5 w-2.5" />Bot</span>}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Chat ──────────────────────────────────────────────────────────── */}
      <div className={`flex-1 flex-col ${selected ? 'flex' : 'hidden md:flex'}`} style={{ minWidth: 0 }}>
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
            <MessageCircle className="h-14 w-14 mb-3" />
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        ) : (
          <>
            {/* Cabecera del chat */}
            <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-3 shrink-0 bg-gray-50">
              <button className="md:hidden text-gray-500" onClick={() => setSelectedId(null)}><ArrowLeft className="h-5 w-5" /></button>
              <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><User className="h-4.5 w-4.5" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{selected.contact_name || selected.contact_number}</p>
                <p className={`text-[11px] font-medium flex items-center gap-1 ${selected.bot_paused ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {selected.bot_paused
                    ? <><Hand className="h-3 w-3" />Atendiendo manualmente</>
                    : <><Bot className="h-3 w-3" />Bot activo</>}
                </p>
              </div>
              {selected.lead_id && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs shrink-0" onClick={() => navigate(`/leads/${selected.lead_id}`)}>
                  <ExternalLink className="h-3.5 w-3.5" />Ficha
                </Button>
              )}
              {selected.bot_paused ? (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs text-emerald-700 border-emerald-300 shrink-0" onClick={() => setBotPaused(false)}>
                  <Bot className="h-3.5 w-3.5" />Ceder al bot
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs text-amber-700 border-amber-300 shrink-0" onClick={() => setBotPaused(true)}>
                  <Hand className="h-3.5 w-3.5" />Tomar control
                </Button>
              )}
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2" style={{ background: '#F1F5F9' }}>
              {messages.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">Sin mensajes en esta conversación.</p>
              ) : messages.map(m => {
                const out = m.direction === 'outbound'
                return (
                  <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${out ? 'bg-emerald-500 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm'}`}>
                      <p className="whitespace-pre-wrap break-words">{m.message}</p>
                      <p className={`text-[10px] mt-0.5 text-right ${out ? 'text-emerald-100' : 'text-gray-400'}`}>{timeOf(m.timestamp)}</p>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Caja de envío */}
            <div className="px-3 py-2.5 border-t border-gray-200 shrink-0 flex items-center gap-2">
              <Input
                placeholder="Escribe un mensaje…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                className="flex-1"
              />
              <Button onClick={send} disabled={sending || !input.trim()} className="gap-1.5 shrink-0 bg-emerald-500 hover:bg-emerald-600">
                <Send className="h-4 w-4" />{sending ? '' : 'Enviar'}
              </Button>
            </div>
            {!selected.bot_paused && (
              <p className="text-[11px] text-amber-600 bg-amber-50 px-4 py-1.5 border-t border-amber-100 shrink-0">
                El bot está activo: responde automáticamente. Pulsa "Tomar control" para atender tú sin que el bot conteste.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
