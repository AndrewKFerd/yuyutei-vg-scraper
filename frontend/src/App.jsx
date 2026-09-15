import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { fetchCards } from './api'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import CardGrid from './components/CardGrid'
import Footer from './components/Footer'

// The set this UI browses. There's no set-switcher in this simple version,
// so it's a constant; swap it out (or wire up a dropdown) if more sets need
// to be browsable later.
const SET_CODE = 'dzbt16'

function App() {
  const [cards, setCards] = useState([])
  const [setInfo, setSetInfo] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [errorMessage, setErrorMessage] = useState('')
  const [query, setQuery] = useState('')

  // Keeps the input snappy: the text state updates immediately on every
  // keystroke, while the (potentially expensive) filtered grid re-render
  // can lag a frame behind under React's control.
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    let cancelled = false

    setStatus('loading')
    fetchCards(SET_CODE)
      .then((data) => {
        if (cancelled) return
        setCards(data.cards)
        setSetInfo({ set: data.set, setNameJp: data.setNameJp, count: data.count })
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err.message)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const filteredCards = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return cards
    return cards.filter((card) => {
      return (
        card.nameEn?.toLowerCase().includes(q) ||
        card.nameJp?.toLowerCase().includes(q) ||
        card.setCode?.toLowerCase().includes(q) ||
        card.rarity?.toLowerCase().includes(q)
      )
    })
  }, [cards, deferredQuery])

  const isFiltered = deferredQuery.trim().length > 0

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Header setInfo={setInfo} />

      <main className="flex-1">
        <div className="py-6">
          <SearchBar value={query} onChange={setQuery} />

          <div className="mx-auto mt-3 max-w-xl px-4 text-center text-xs text-slate-500">
            {status === 'ready' &&
              (isFiltered
                ? `${filteredCards.length} of ${cards.length} cards`
                : `${cards.length} cards`)}
          </div>
        </div>

        {status === 'loading' && (
          <div className="grid grid-cols-2 gap-3 px-4 pb-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[100/140] w-full animate-pulse rounded-md bg-slate-200"
              />
            ))}
          </div>
        )}

        {status === 'error' && (
          <div className="mx-auto max-w-md px-4 py-16 text-center">
            <p className="text-sm font-semibold text-red-600">
              Couldn&apos;t load cards.
            </p>
            <p className="mt-2 text-xs text-slate-500">{errorMessage}</p>
            <p className="mt-4 text-xs text-slate-400">
              Make sure the backend is running, then reload the page.
            </p>
          </div>
        )}

        {status === 'ready' && <CardGrid cards={filteredCards} />}
      </main>

      <Footer />
    </div>
  )
}

export default App
