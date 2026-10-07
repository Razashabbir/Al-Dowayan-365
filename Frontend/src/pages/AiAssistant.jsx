import { useEffect } from 'react'
import { motion } from '../components/motion'
import { Hero3D } from '../components/three'
import { ChatList, ChatView, useAssistant } from '../components/assistant'
import { useDashScope } from './dash/common'

/** AI Assistant - full page: saved chats on the left, the conversation on the right. */
export default function AiAssistant() {
  const { tenant, company, tenantName } = useDashScope()
  const { error, ensureChats } = useAssistant()
  useEffect(() => { ensureChats() }, [ensureChats])

  return (
    <div className="page ai-page">
      <motion.header className="hero hero-3d" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <Hero3D />
        <div>
          <h1>AI Assistant</h1>
          <p>Ask about your figures - answered from the reporting database on your server{tenantName && company ? ` · ${tenantName} · ${company}` : ''}</p>
        </div>
      </motion.header>

      {error && <div className="alert bad">{error}</div>}

      <div className="ai-layout">
        <aside className="card ai-side"><ChatList /></aside>
        <section className="card ai-chat">
          <ChatView ctx={{ tenant, company }}
                    intro={`I calculate answers from the same dashboards and statements you can open${company ? ` - by default ${company.toUpperCase()}, this year to date` : ''}. Name another year, month or company in your question (e.g. "revenue March 2025 for 02td"). I only read data; nothing is changed.`} />
          <p className="muted small ai-note">Runs locally: answers are calculated from your reporting data with the same company and report access as your screens - nothing leaves your server. Chats are saved for your user; questions are recorded in the Audit Logs.</p>
        </section>
      </div>
    </div>
  )
}
