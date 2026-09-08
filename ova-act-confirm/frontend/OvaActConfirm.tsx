import { useEffect, useRef, useState } from 'react'
// import { useTelegram } from '../hooks/useTelegram' // если хук лежит в проекте по этому пути —
// раскомментируйте и добавьте haptic.success() в первый useEffect ниже (когда phase становится
// 'entering'), как в остальных подтверждениях KitchenDesk (см. IikoCard.tsx).

/*
 * Подтверждение отправки акта разделки — робот-талисман Ова (тот же, что
 * на маркетинговом сайте, web/src/assets/ova/ova-hero.png) выскакивает с
 * лёгким пружинным подскоком и подтверждает, что акт ушёл на утверждение.
 * Само закрывается через 2.2 с, либо по тапу мимо карточки.
 *
 * Согласовано на прототипе:
 * https://claude.ai/code/artifact/6347b324-942f-4fc2-a36a-c0f9d9b44933
 *
 * ПОЧЕМУ ТАК АНИМИРОВАНО (см. .claude/skills/animate в этом репозитории):
 * - Частота действия — редкая (акт разделки шлют не сто раз в день), это
 *   как раз тот случай, где уместна капля "души", а не только фидбек.
 * - Подскок (пружинная кривая) — только на входе; выход быстрый и без
 *   пружины, как у тостов и модалок — заход эффектный, уход скромный.
 * - Только transform/opacity — ничего, что дёргает layout.
 * - prefers-reduced-motion уважается — без подскока, просто мягкое
 *   проявление.
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   import ovaHero from './ova-hero.png' // положите файл рядом, как здесь
 *
 *   const [sent, setSent] = useState(false)
 *   const sendMutation = useMutation({
 *     mutationFn: submitAkt,
 *     onSuccess: () => setSent(true),
 *   })
 *   ...
 *   <OvaActConfirm
 *     open={sent}
 *     onClose={() => setSent(false)}
 *     mascotSrc={ovaHero}
 *     subtitle={`№ ${akt.number} · ${akt.item} — обновится, как только администратор подтвердит`}
 *   />
 */
const OVA_CONFIRM_CSS = `
.ova-scrim {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 4, 9, 0);
  backdrop-filter: blur(0px);
  transition: background 220ms ease-out, backdrop-filter 220ms ease-out;
}
.ova-scrim.is-open { background: rgba(2, 4, 9, 0.68); backdrop-filter: blur(2px); }

.ova-card {
  width: 280px;
  text-align: center;
  transform: translateY(28px) scale(0.94);
  opacity: 0;
  transition: transform 420ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 260ms ease-out;
}
.ova-scrim.is-open .ova-card { transform: translateY(0) scale(1); opacity: 1; }
.ova-scrim.is-closing .ova-card {
  transform: translateY(14px) scale(0.97);
  opacity: 0;
  transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1), opacity 180ms ease-out;
}

.ova-card img {
  width: 168px;
  height: auto;
  display: block;
  margin: 0 auto 6px;
  filter: drop-shadow(0 16px 24px rgba(0, 0, 0, 0.5));
}
.ova-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 100px;
  margin-bottom: 10px;
}
.ova-title { font-size: 17px; font-weight: 800; margin: 0 0 4px; color: #eef2f8; }
.ova-sub { font-size: 13px; color: #8993a8; margin: 0; line-height: 1.5; }

@media (prefers-reduced-motion: reduce) {
  .ova-card { transition: opacity 200ms ease; transform: none !important; }
  .ova-scrim.is-closing .ova-card { transition: opacity 180ms ease; }
}
`

type Phase = 'closed' | 'entering' | 'open' | 'closing'

export function OvaActConfirm({
  open,
  onClose,
  mascotSrc,
  title = 'Акт ушёл на утверждение',
  subtitle,
  autoCloseMs = 2200,
}: {
  /** true, когда акт успешно отправлен — покажет Ову */
  open: boolean
  /** вызывается после того, как карточка сама закрылась (авто или по тапу мимо) */
  onClose: () => void
  /** import ovaHero from './ova-hero.png' и передать сюда */
  mascotSrc: string
  title?: string
  subtitle?: string
  /** через сколько мс само закроется; 0 — не закрывать автоматически */
  autoCloseMs?: number
}) {
  const [phase, setPhase] = useState<Phase>('closed')
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // open -> 'entering' (смонтировано, ещё без is-open — браузер должен
  // отрисовать этот кадр ДО добавления класса, иначе transition не сыграет
  // на самой первой отрисовке) -> следующий кадр -> 'open'.
  useEffect(() => {
    if (open) {
      setPhase('entering')
      const raf = requestAnimationFrame(() => setPhase('open'))
      return () => cancelAnimationFrame(raf)
    }
    setPhase((p) => (p === 'closed' ? p : 'closing'))
  }, [open])

  useEffect(() => {
    if (phase !== 'open' || !autoCloseMs) return
    autoCloseTimer.current = setTimeout(() => setPhase('closing'), autoCloseMs)
    return () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current)
    }
  }, [phase, autoCloseMs])

  useEffect(() => {
    if (phase !== 'closing') return
    const t = setTimeout(() => {
      setPhase('closed')
      onClose()
    }, 260)
    return () => clearTimeout(t)
  }, [phase, onClose])

  if (phase === 'closed') return null

  return (
    <>
      <style>{OVA_CONFIRM_CSS}</style>
      <div
        className={`ova-scrim ${phase === 'open' ? 'is-open' : ''} ${phase === 'closing' ? 'is-closing' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setPhase('closing')
        }}
      >
        <div className="ova-card">
          <img src={mascotSrc} alt="Ова, робот-талисман KitchenDesk" />
          <div className="ova-badge">
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={3}>
              <path d="M4 12l5 5 11-11" />
            </svg>
            Отправлено
          </div>
          <div className="ova-title">{title}</div>
          {subtitle && <p className="ova-sub">{subtitle}</p>}
        </div>
      </div>
    </>
  )
}
