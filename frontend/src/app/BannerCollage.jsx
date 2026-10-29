import { memo, useEffect, useRef, useState } from 'react'

// The banner's picture: DZ-BT17's showpiece cards laid out as one tilted
// wall of art, drawn onto a single canvas (so it is one image, and needs no
// CSP change -- a canvas only shown, never read back, can take any image
// img-src allows). Redrawn when the banner changes size. Until the scans
// arrive the banner's own navy gradient shows; the wall fades in over it.

const TILT = (-12 * Math.PI) / 180
const CARD_RATIO = 280 / 200
const IMAGE_TIMEOUT_MS = 15_000

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => done(null), IMAGE_TIMEOUT_MS)
    function done(result) {
      clearTimeout(timer)
      img.onload = img.onerror = null
      resolve(result)
    }
    img.decoding = 'async'
    img.onload = () => done(img)
    img.onerror = () => done(null)
    img.src = src
  })
}

/**
 * Columns of cards, every other column dropped half a card (a staggered
 * wall), rotated a little and filling the whole box with room to spare.
 */
function drawWall(canvas, images) {
  const { width, height } = canvas.getBoundingClientRect()
  if (!width || !height) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const cardH = Math.max(height * 0.62, 110)
  const cardW = cardH / CARD_RATIO
  const gap = Math.round(cardW * 0.08)
  const radius = cardW * 0.05
  // Enough area that the rotated wall still covers every corner.
  const span = Math.hypot(width, height)
  const cols = Math.ceil(span / (cardW + gap)) + 2
  const rows = Math.ceil(span / (cardH + gap)) + 2

  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.rotate(TILT)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 4
  let n = 0
  for (let c = 0; c < cols; c++) {
    const x = (c - cols / 2) * (cardW + gap)
    const drop = c % 2 ? (cardH + gap) / 2 : 0
    for (let r = 0; r < rows; r++) {
      const y = (r - rows / 2) * (cardH + gap) + drop
      // Step through the cards out of order, so neighbours differ.
      const img = images[(n * 7 + c * 3) % images.length]
      n++
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(x, y, cardW, cardH, radius)
      ctx.fillStyle = '#0d141c'
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.clip()
      ctx.drawImage(img, x, y, cardW, cardH)
      ctx.restore()
    }
  }
  ctx.restore()
}

/** @param {{ urls: string[], className?: string }} props */
function BannerCollage({ urls, className = '' }) {
  const canvasRef = useRef(null)
  const [images, setImages] = useState(null)
  const key = urls.join('|')

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    Promise.all(key.split('|').map(loadImage)).then((loaded) => {
      const ok = loaded.filter(Boolean)
      if (!cancelled && ok.length > 0) setImages(ok)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !images) return undefined
    drawWall(canvas, images)
    if (typeof ResizeObserver === 'undefined') return undefined
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => drawWall(canvas, images))
    })
    observer.observe(canvas)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [images])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`transition-opacity duration-700 ${images ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  )
}

export default memo(BannerCollage)
