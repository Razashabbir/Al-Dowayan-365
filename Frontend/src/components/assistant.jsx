import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ai, fmt, fmtShort } from '../api'
import { useAuth } from '../auth'
import { useApp } from '../theme'
import Markdown from './Markdown'
import { IconSparkle } from './Icons'
import { motion, useReducedMotion } from './motion'

/* AI Assistant chat state shared by the full page (sidebar › AI Assistant) and the Ask pop-up (bottom right).
   Chats are saved per user on the server (sec.ai_chat / sec.ai_message). */

export const SUGGEST = [
  'Summarise this year against last year',
  'Why did net profit change?',
  'Top 10 expenses',
  'Is the balance sheet balanced?',
  'Revenue and profit by month',
  'Receivables and payables (DSO / DPO)',
  'Compare all companies',
  'Cash position',
]

const Ctx = createContext(null)
export const useAssistant = () => useContext(Ctx)

export function AssistantProvider({ children }) {
  const [chats, setChats] = useState([])
  const [chatId, setChatId] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loaded = useRef(false)

  const loadChats = useCallback(() => ai('chats').then((c) => { setChats(c); loaded.current = true }).catch((e) => setError(e.message)), [])
  const ensureChats = useCallback(() => { if (!loaded.current) loadChats() }, [loadChats])

  const openChat = useCallback(async (id) => {
    setChatId(id); setMsgs([]); setLoading(true); setError('')
    try { const r = await ai(`chats/${id}`); setMsgs(r.messages) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [])

  const newChat = useCallback(() => { setChatId(null); setMsgs([]); setError('') }, [])

  const ask = useCallback(async (text, ctx = {}) => {
    const q = (text || '').trim()
    if (!q || busy) return
    const before = msgs
    setMsgs([...before, { role: 'user', content: q }]); setBusy(true); setError('')
    try {
      const r = await ai('chat', { messages: [{ role: 'user', content: q }], chat_id: chatId || undefined, ...ctx })
      setMsgs([...before, { role: 'user', content: q },
        { role: 'assistant', content: r.answer, sources: r.sources, suggest: r.suggest, chart: r.chart }])
      if (r.chat_id) setChatId(r.chat_id)
      if (r.not_saved) setError('The answer could not be saved in your chat history (the database table is missing - restart the API).')
      loadChats()
    } catch (e) {
      setMsgs([...before, { role: 'user', content: q }, { role: 'assistant', content: e.message, error: true }])
    } finally {
      setBusy(false)
    }
  }, [busy, msgs, chatId, loadChats])

  const removeChat = useCallback(async (id) => {
    await ai(`chats/${id}`, undefined, 'DELETE')
    if (id === chatId) newChat()
    loadChats()
  }, [chatId, newChat, loadChats])

  const renameChat = useCallback(async (id, title) => {
    await ai(`chats/${id}`, { title }, 'PUT')
    loadChats()
  }, [loadChats])

  return (
    <Ctx.Provider value={{ chats, chatId, msgs, busy, loading, error, setError, loadChats, ensureChats, openChat, newChat, ask, removeChat, renameChat }}>
      {children}
    </Ctx.Provider>
  )
}

const COLORS = ['var(--theme-start)', 'var(--theme-end)', '#94a3b8']

/** Small chart under an answer (bars for rankings / months, a line for balances). */
export function AnswerChart({ c, height = 200 }) {
  const data = c.labels.map((l, i) => Object.fromEntries([['name', l], ...c.series.map((s) => [s.name, s.values[i]])]))
  const Chart = c.type === 'line' ? LineChart : BarChart
  const tilt = c.labels.length > 8 && c.type !== 'line'
  return (
    <div className="ai-chart">
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={tilt ? -25 : 0} textAnchor={tilt ? 'end' : 'middle'} height={tilt ? 50 : 24} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShort} width={52} />
          <Tooltip formatter={(v) => fmt(v)} />
          {c.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {c.series.map((s, i) => (c.type === 'line'
            ? <Line key={s.name} dataKey={s.name} stroke={COLORS[i]} strokeWidth={2} dot={false} />
            : <Bar key={s.name} dataKey={s.name} fill={COLORS[i]} radius={[4, 4, 0, 0]} />))}
        </Chart>
      </ResponsiveContainer>
    </div>
  )
}

/** Messages + question box. `ctx` = tenant / company / year / month sent with each question. */
export function ChatView({ ctx, compact = false, intro }) {
  const { msgs, busy, loading, ask } = useAssistant()
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const end = useRef(null)
  const box = useRef(null)
  const reduce = useReducedMotion()

  useEffect(() => { end.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' }) }, [msgs, busy, reduce])
  const send = (text) => { const t = (text ?? q).trim(); if (!t) return; setQ(''); ask(t, ctx); box.current?.focus() }
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  return (
    <div className={`ai-chatview ${compact ? 'compact' : ''}`}>
      <div className="ai-log" aria-live="polite">
        {loading && <p className="muted small">Loading chat…</p>}
        {!msgs.length && !loading && (
          <div className="ai-empty">
            <div className="ai-orb"><IconSparkle /></div>
            <h2>Hello{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}. What would you like to know?</h2>
            {intro && <p className="muted">{intro}</p>}
            <div className="ai-suggest">
              {SUGGEST.slice(0, compact ? 4 : 8).map((s) => <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>)}
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {msgs.map((m, i) => (
            <motion.div key={i} className={`ai-msg ${m.role} ${m.error ? 'err' : ''}`}
                        initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              {m.role === 'assistant' && !compact && <div className="ai-avatar"><IconSparkle /></div>}
              <div className="ai-bubble">
                {m.role === 'user' ? <p>{m.content}</p> : <Markdown text={m.content} />}
                {m.chart?.labels?.length > 0 && <AnswerChart c={m.chart} height={compact ? 160 : 200} />}
                {m.sources?.length > 0 && (
                  <div className="ai-sources">
                    <span className="muted small">Data used:</span>
                    {[...new Map(m.sources.map((s) => [s.label, s])).values()].map((s) => <span key={s.label} className="ai-chip">{s.label}</span>)}
                  </div>
                )}
                {i === msgs.length - 1 && m.suggest?.length > 0 && (
                  <div className="ai-follow">
                    {m.suggest.map((s) => <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>)}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {busy && (
          <div className="ai-msg assistant">
            {!compact && <div className="ai-avatar spin"><IconSparkle /></div>}
            <div className="ai-bubble ai-typing"><span /><span /><span /> <em className="muted small">Reading the reports…</em></div>
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="ai-input">
        <textarea ref={box} rows={compact ? 1 : 2} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} maxLength={4000}
                  placeholder={compact ? 'Ask about your figures…' : 'Ask a question - e.g. Why did expenses go up? · Top 10 expenses · Cash position · Revenue for 02td'} />
        <button className="primary" onClick={() => send()} disabled={!q.trim() || busy}>{busy ? '…' : 'Ask'}</button>
      </div>
    </div>
  )
}

/** Saved chats of the user: open, rename, delete. */
export function ChatList({ onPick }) {
  const { chats, chatId, openChat, newChat, removeChat, renameChat, ensureChats } = useAssistant()
  const [edit, setEdit] = useState(null)
  const [title, setTitle] = useState('')
  useEffect(() => { ensureChats() }, [ensureChats])

  const day = (s) => {
    const d = new Date(s && !s.endsWith('Z') ? `${s.replace(' ', 'T')}Z` : s), now = new Date()
    const diff = (new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5
    return diff <= 0 ? 'Today' : diff <= 1 ? 'Yesterday' : diff <= 7 ? 'Previous 7 days' : 'Older'
  }
  const groups = []
  chats.forEach((c) => {
    const g = day(c.updated_at)
    const last = groups[groups.length - 1]
    if (last && last.g === g) last.items.push(c); else groups.push({ g, items: [c] })
  })

  return (
    <div className="ai-chats">
      <button className="primary ai-newchat" onClick={() => { newChat(); onPick?.() }}>+ New chat</button>
      {!chats.length && <p className="muted small">Your chats appear here. They are saved for your user only.</p>}
      {groups.map(({ g, items }) => (
        <div key={g} className="ai-chat-group">
          <b>{g}</b>
          {items.map((c) => (
            <div key={c.chat_id} className={`ai-chat-item ${c.chat_id === chatId ? 'on' : ''}`}>
              {edit === c.chat_id ? (
                <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) renameChat(c.chat_id, title.trim()); setEdit(null) }}>
                  <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} onBlur={() => setEdit(null)} />
                </form>
              ) : (
                <>
                  <button className="ai-chat-open" title={c.title} onClick={() => { openChat(c.chat_id); onPick?.() }}>
                    <span data-no-tr>{c.title}</span><small className="muted">{c.questions} question{c.questions === 1 ? '' : 's'}</small>
                  </button>
                  <button className="ai-chat-act" title="Rename" aria-label="Rename" onClick={() => { setEdit(c.chat_id); setTitle(c.title) }}>✎</button>
                  <button className="ai-chat-act" title="Delete" aria-label="Delete" onClick={() => removeChat(c.chat_id)}>×</button>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Floating "Ask" button (bottom right of every page) that opens a small AI Assistant pop-up. */
export function AskWidget({ route, go }) {
  const { can } = useAuth()
  const { scope } = useApp()
  const { newChat, error } = useAssistant()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(false)
  const reduce = useReducedMotion()
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  if (!can('ai.use') || route === '/ai/assistant') return null
  const ctx = { tenant: scope?.tenant, company: scope?.company }

  return (
    <div className="ask-widget no-print">
      <AnimatePresence>
        {open && (
          <motion.section className="ask-panel card" role="dialog" aria-label="AI Assistant"
                          initial={reduce ? false : { opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.97 }} transition={{ duration: 0.2 }}>
            <header className="ask-head">
              <span className="ask-title"><IconSparkle /> AI Assistant</span>
              <span className="muted small" data-no-tr>{scope?.company ? scope.company.toUpperCase() : ''}</span>
              <span className="grow" />
              <button className="ask-icon" title="Chats" aria-label="Chats" onClick={() => setList(!list)}>☰</button>
              <button className="ask-icon" title="New chat" aria-label="New chat" onClick={() => { newChat(); setList(false) }}>＋</button>
              <button className="ask-icon" title="Open full page" aria-label="Open full page" onClick={() => { setOpen(false); go('/ai/assistant') }}>⤢</button>
              <button className="ask-icon" title="Close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </header>
            {error && <div className="alert bad small">{error}</div>}
            {list ? <ChatList onPick={() => setList(false)} /> : <ChatView ctx={ctx} compact intro="Answers use the company in the top bar and this year." />}
          </motion.section>
        )}
      </AnimatePresence>
      <button className={`ask-fab ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Ask the AI Assistant">
        {open ? <span className="ask-x">×</span> : <><IconSparkle /><span>Ask</span></>}
      </button>
    </div>
  )
}
