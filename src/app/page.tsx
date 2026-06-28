'use client'

/**
 * ПЛ Упаковка — точка входа Next.js.
 * PWA (vanilla JS) живёт в /public/pwa/ и рендерится в полноэкранном iframe,
 * чтобы сохранить оригинальную архитектуру (отдельные js-модули, Service Worker,
 * manifest.json) без переписывания под React.
 */

export default function Home() {
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <iframe
        src="/pwa/index.html"
        title="ПЛ — Упаковка"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          margin: 0,
          padding: 0,
          display: 'block',
        }}
        allow="fullscreen"
      />
    </div>
  )
}
