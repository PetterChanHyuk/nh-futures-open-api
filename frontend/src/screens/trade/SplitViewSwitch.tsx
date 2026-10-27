import { useCallback, useEffect, useRef, useState } from 'react'
import { ORIENT_LABEL, type Orient } from './chartSlots'
import { NARROW_CARD, NARROW_CARD_SPLIT_HEAD, useNarrowCard } from './cardWidth'

/* 차트 카드 머리 띠의 [한 칸 | 두 칸 ▾].
 *
 * 「한 칸」과 「두 칸」은 누르면 바로 그 칸 수가 됩니다. 두 칸은 지난번에 고른
 * 놓임(처음엔 위아래)으로 섭니다. 「▾」는 놓임(위아래·좌우)을 고르는 목록입니다 —
 * 두 칸일 때 고르면 놓임만 바뀌고, 한 칸일 때 고르면 그 놓임으로 두 칸이 켜집니다.
 * 두 칸일 때는 단추에 지금 놓임이 적힙니다.
 *
 * 확대 단추 바로 왼쪽에 섭니다. 칸 수는 보이는 값이 아니라 카드를 어떻게 쓸지에
 * 대한 것이라, 도구 줄이 아니라 머리 띠에 둡니다. 확대와 상관없이 어디서나
 * 켜고 끕니다.
 *
 * 카드가 좁으면(`NARROW_CARD` 미만, 두 칸이면 `NARROW_CARD_SPLIT_HEAD` 미만) 글자를
 * 빼고 칸 모양 그림만 남깁니다 — 글자까지 세우면 머리 띠가 카드 밖으로 넘쳐 확대
 * 단추가 잘립니다. 두 칸일 때는 단추 글에 놓임이 붙어 길어지므로 더 넓은 카드에서부터
 * 접습니다. 이름은 화면 읽기와 손을 올렸을 때 뜨는 이름표로 그대로 남습니다. */

const ORIENTS: Orient[] = ['stack', 'side']

/* 칸 모양 그림 — 한 칸은 네모 하나, 두 칸은 놓임대로 둘. */
function PaneIcon({ kind }: { kind: 'one' | Orient }) {
  return (
    <span className={`split-icon is-${kind}`} aria-hidden="true">
      <i />
      {kind !== 'one' && <i />}
    </span>
  )
}

export function SplitViewSwitch({
  split,
  orient,
  sideNarrow = false,
  onChange,
}: {
  split: boolean
  orient: Orient
  /** 좌우로 놓으면 칸 하나가 좁아지는지(`SIDE_PANE_MIN` 미만). 참이면 목록의 「좌우」
   *  줄이 흐린 글자로 까닭을 답니다. 고르는 것은 그대로 됩니다. */
  sideNarrow?: boolean
  onChange: (next: { split: boolean; orient: Orient }) => void
}) {
  const [open, setOpen] = useState(false)
  const [watchWidth, compact] = useNarrowCard(split ? NARROW_CARD_SPLIT_HEAD : NARROW_CARD)
  /* 단추와 목록을 함께 감쌉니다. 「▾」를 누른 것을 「바깥」으로 보면 닫히자마자
     다시 열립니다. 같은 요소로 카드 폭도 잽니다. */
  const ref = useRef<HTMLDivElement | null>(null)
  const hold = useCallback(
    (element: HTMLDivElement | null) => {
      ref.current = element
      return watchWidth(element)
    },
    [watchWidth],
  )
  const twoLabel = split ? `두 칸 · ${ORIENT_LABEL[orient]}` : '두 칸'

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    /* Esc 는 목록만 닫습니다. 확대 중이어도 확대는 그대로입니다. */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div
      className={`split-switch${split ? ' is-on' : ''}${compact ? ' is-compact' : ''}`}
      ref={hold}
      role="group"
      aria-label="차트 칸 수"
    >
      <button
        type="button"
        className="split-switch-item is-one"
        aria-pressed={!split}
        aria-label={compact ? '한 칸' : undefined}
        data-tip={compact && !open ? '한 칸' : undefined}
        onClick={() => {
          setOpen(false)
          if (split) onChange({ split: false, orient })
        }}
      >
        <PaneIcon kind="one" />
        {!compact && '한 칸'}
      </button>
      <button
        type="button"
        className="split-switch-item is-two"
        aria-pressed={split}
        aria-label={compact ? twoLabel : undefined}
        data-tip={compact && !open ? twoLabel : undefined}
        onClick={() => {
          setOpen(false)
          if (!split) onChange({ split: true, orient })
        }}
      >
        <PaneIcon kind={orient} />
        {!compact && twoLabel}
      </button>
      <button
        type="button"
        className="split-switch-item is-chev"
        aria-label="두 칸 놓임 고르기"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="split-switch-chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="split-switch-menu" role="menu" aria-label="두 칸 놓임">
          {ORIENTS.map((kind) => {
            const current = split && orient === kind
            /* 좌우는 칸 하나가 차트 열의 절반이라, 열이 좁으면 봉과 가격 눈금이 겹칩니다.
               자동으로 바꾸지 않고 까닭만 적습니다 — 좁아도 좌우로 보고 싶을 수 있습니다. */
            const narrow = kind === 'side' && sideNarrow
            return (
              <button
                key={kind}
                type="button"
                className={`split-switch-option${narrow ? ' is-narrow' : ''}`}
                role="menuitemradio"
                aria-checked={current}
                onClick={() => {
                  setOpen(false)
                  if (!current) onChange({ split: true, orient: kind })
                }}
              >
                <PaneIcon kind={kind} />
                <span className="split-switch-option-text">
                  {ORIENT_LABEL[kind]}
                  {narrow && <span className="split-switch-note">차트 열이 좁습니다</span>}
                </span>
                {current && <span aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
