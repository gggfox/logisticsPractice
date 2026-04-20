interface SpeakerTurn {
  role: string
  text: string
}

interface CallConversationProps {
  speakers: readonly SpeakerTurn[] | undefined
  transcript: string | undefined
}

// The carrier's side is rendered to the right so the reader's eye
// follows the back-and-forth like a messaging thread. Anything that
// isn't obviously a carrier (agent/bot/system) sits on the left.
function isCarrierSide(role: string): boolean {
  const normalized = role.toLowerCase()
  return (
    normalized.includes('carrier') ||
    normalized.includes('driver') ||
    normalized.includes('user') ||
    normalized.includes('human') ||
    normalized.includes('caller')
  )
}

function formatRole(role: string): string {
  return role
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export function CallConversation({ speakers, transcript }: Readonly<CallConversationProps>) {
  if (speakers && speakers.length > 0) {
    return (
      <div
        className="flex max-h-[28rem] flex-col gap-2 overflow-auto rounded-lg border border-surface-border/70 bg-surface-1 p-3"
        data-testid="call-conversation"
      >
        {speakers.map((turn, index) => {
          const carrierSide = isCarrierSide(turn.role)
          return (
            <div
              // Speaker turns have no stable id; order + content is the
              // identity. This component never re-orders, so an index
              // key is safe.
              key={`${String(index)}-${turn.role}`}
              className={`flex ${carrierSide ? 'justify-end' : 'justify-start'}`}
              data-testid="call-conversation-turn"
              data-role={turn.role}
            >
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 text-sm shadow-sm ring-1 ring-inset ${
                  carrierSide
                    ? 'bg-accent-500/10 text-slate-900 ring-accent-500/20 dark:bg-accent-500/15 dark:text-slate-100'
                    : 'bg-surface-2 text-slate-800 ring-surface-border/70 dark:text-slate-200'
                }`}
              >
                <p className="eyebrow mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  {formatRole(turn.role)}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{turn.text}</p>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const transcriptText = transcript?.trim() ?? ''
  return (
    <pre
      data-testid="call-conversation-fallback"
      className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg border border-surface-border/70 bg-surface-1 p-3 font-sans text-sm text-slate-700 dark:text-slate-300"
    >
      {transcriptText || 'No transcript available.'}
    </pre>
  )
}
