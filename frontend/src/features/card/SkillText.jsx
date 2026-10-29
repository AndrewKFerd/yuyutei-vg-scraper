import { useState } from 'react'
import { Button } from '../../ui/controls'
import Skeleton from '../../ui/Skeleton'

// The card modal's skill text: English when there is some, else the
// Japanese with the translator's Translate toggle (useRulesTranslation).

// Longer than this and the skill box starts clamped, with "Show full text".
const SKILL_PREVIEW_CHARS = 240
const SKILL_PREVIEW_LINES = 4

// `segments` (a machine translation): the parts the translator couldn't
// read stay in Japanese, set apart in a muted colour.
/** @param {{ text: string, lang?: string, segments?: { text: string, untranslated: boolean }[] }} props */
function SkillBox({ text, lang, segments }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > SKILL_PREVIEW_CHARS || text.split('\n').length > SKILL_PREVIEW_LINES
  return (
    <div>
      {/* The clamp sits on the inner text, not the padded box, or the
          fifth line would peek through the bottom padding. */}
      <div lang={lang} className="rounded-lg border border-highlight-line bg-highlight p-3 text-sm leading-relaxed text-fg">
        <p className={`whitespace-pre-line ${long && !expanded ? 'line-clamp-4' : ''}`}>
          {segments
            ? segments.map((seg, i) =>
                seg.untranslated ? (
                  <span key={i} lang="ja" className="text-fg-muted">
                    {seg.text}
                  </span>
                ) : (
                  seg.text
                )
              )
            : text}
        </p>
      </div>
      {long && (
        <Button variant="link" size="inline" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="mt-1">
          {expanded ? 'Show less' : 'Show full text'}
        </Button>
      )}
    </div>
  )
}

// `card` is the catalog card merged with its set's detail shard. `status` is
// that shard's load state: the skill text only exists in the shard, so
// "no skill text" must not be claimed until it has actually loaded.
// `translation`: useRulesTranslation()'s state, for Japanese-only text.
function SkillText({ card, status, onRetry, translation }) {
  if (status === 'loading') {
    return <Skeleton label="Loading skill text" className="h-20 rounded-lg" />
  }
  if (status === 'error') {
    return (
      <p role="alert" className="rounded-lg border border-dashed border-line p-3 text-sm text-negative">
        Couldn&apos;t load the skill text.{' '}
        <Button variant="link" size="inline" onClick={onRetry} className="text-sm">
          Try again
        </Button>
      </p>
    )
  }

  if (card.skillTextEn) {
    // Keyed on the text so a different card starts collapsed again.
    return <SkillBox key={card.skillTextEn} text={card.skillTextEn} />
  }

  if (card.skillTextJp) {
    const shown = translation.on && translation.status === 'ready' ? translation.result : null
    const working = translation.on && translation.status === 'loading'
    return (
      <div>
        {shown ? (
          // Keyed on the text so switching starts collapsed again.
          <SkillBox key={shown.text} text={shown.text} segments={shown.segments} />
        ) : (
          <SkillBox key={card.skillTextJp} text={card.skillTextJp} lang="ja" />
        )}
        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-fg-subtle">
          <p>
            {shown
              ? 'Machine translation from the Japanese text — approximate. Untranslated parts are left in Japanese.'
              : 'Japanese only — no official English release yet.'}
          </p>
          <Button variant="link" size="inline" onClick={translation.toggle} aria-pressed={translation.on} disabled={working}>
            {working ? 'Translating…' : translation.on ? 'Show Japanese' : 'Translate'}
          </Button>
        </div>
        {translation.on && translation.status === 'error' && (
          <p role="alert" className="mt-1 text-xs text-negative">
            Couldn&apos;t load the translator.{' '}
            <Button variant="link" size="inline" onClick={translation.retry}>
              Try again
            </Button>
          </p>
        )}
      </div>
    )
  }

  return (
    <p className="rounded-lg border border-dashed border-line p-3 text-sm text-fg-subtle">
      No skill text available for this card yet.
    </p>
  )
}

export default SkillText
