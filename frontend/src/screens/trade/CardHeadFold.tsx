import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/* 아래 칸(주문체결상세·미결제약정) 카드의 머리 띠.
 *
 * 띠에 서는 것은 손잡이, 탭 둘(건수 꼬리표), 「HH:MM 부터」, 접기 단추입니다. 카드가
 * 좁아 한 줄에 다 안 들어가면 **넘치는 동안 한 단계씩** 접습니다.
 *
 *   1  「HH:MM 부터」를 뺍니다. 값이 아니라 값에 붙은 말이라 먼저 빠집니다
 *   2  접기 단추를 그림(▴·▾)만 남깁니다. 이름은 화면 읽기와 손을 올렸을 때 뜨는
 *      이름표로 남습니다
 *   3  탭 둘을 「고른 탭(건수) ▾」 하나로 줄이고, ▾ 로 두 탭을 고르는 목록을 엽니다.
 *      고르지 않은 탭에 건수가 있으면 ▾ 뒤에 흐린 알약(「미결제 1」)으로 남깁니다 —
 *      숨은 탭에 주문이 쌓이는 것이 안 보이면 안 됩니다
 *   4  그래도 넘치면 그 알약을 뺍니다. 건수는 목록 안에 그대로 있습니다
 *
 * 몇 px 에서 접을지 숫자로 정하지 않고 **실제로 넘치는지를 재서** 접습니다. 건수
 * 꼬리표가 붙는지, 몇 자리인지, 「부터」가 서는지에 따라 띠의 폭이 달라지기 때문
 * 입니다. 카드 폭이나 띠에 서는 것이 바뀌면 처음부터 다시 잽니다. */

export interface HeadTab {
  key: string
  label: string
  /** 줄인 띠에서 고르지 않은 탭의 건수 알약에 적는 짧은 이름(「미결제」). */
  short: string
  /** 탭 옆 건수. 0 이면 꼬리표를 달지 않습니다. */
  count: number
  current: boolean
}

interface Props {
  /** 카드 손잡이. */
  grip: ReactNode
  /** 탭 줄. 그 자리에 카드가 하나뿐이면 `null` 이고 `name` 이 섭니다. */
  strip: ReactNode | null
  /** 탭 줄을 목록 하나로 줄일 때 쓰는 탭들. */
  tabs: HeadTab[]
  /** 자리에 혼자 선 카드의 이름. */
  name: ReactNode
  /** 「HH:MM 부터」. 없으면 `null` 입니다. */
  note: string | null
  /** 접기 단추. 접을 수 없는 자리면 `null` 입니다. */
  fold: { collapsed: boolean; onToggle: () => void } | null
  onPick: (key: string) => void
}

/** 목록 하나로 줄이는 단계. */
const MENU_STAGE = 3
const LAST_STAGE = 4

/* 목록에서 탭을 고른 시각. 새로 선 카드의 목록 단추가 이 시각부터 잠깐 사이에
   서면 초점을 이어받습니다. 고른 카드와 새로 서는 카드의 머리 띠가 서로 다른
   것이라 둘 사이에 넘겨 줄 자리가 필요합니다. 시각으로 두는 것은, 새 카드의 띠가
   접히지 않아 목록 단추가 안 서는 경우에 이 표지가 남아 나중에 엉뚱한 단추가
   초점을 가져가지 않게 하려는 것입니다. */
let pickedAt = 0
const FOCUS_HANDOFF_MS = 1000

export function CardHeadFold({ grip, strip, tabs, name, note, fold, onPick }: Props) {
  const [stage, setStage] = useState(0)
  const headRef = useRef<HTMLDivElement | null>(null)

  /* 띠에 서는 것이 바뀌면 처음 모양부터 다시 잽니다. 건수가 늘어 접혀 있던 띠가
     더 넓어져야 할 수도, 건수가 사라져 펴져도 될 수도 있습니다. 어느 탭을 골랐는지는
     넣지 않습니다 — 탭 둘이 다 서는 모양에서는 폭이 같고, 목록으로 고를 때 단추가
     그대로 남아야 초점이 단추로 돌아옵니다. */
  const shape = `${tabs.map((tab) => `${tab.key}:${tab.count}`).join(',')}|${
    strip === null ? 0 : 1
  }|${note ?? ''}|${fold === null ? '' : fold.collapsed ? 'c' : 'o'}`
  useLayoutEffect(() => {
    setStage(0)
  }, [shape])

  /* 카드 폭이 바뀌면 처음 모양부터 다시 잽니다. 폭이 0 인 것은 카드가 가려진
     때라(다른 탭이 열린 자리) 판단하지 않습니다. */
  const [width, setWidth] = useState(0)
  const widthRef = useRef(0)
  useEffect(() => {
    const head = headRef.current
    if (!head) return
    const observer = new ResizeObserver(() => {
      const next = head.clientWidth
      if (next === 0 || next === widthRef.current) return
      const first = widthRef.current === 0
      widthRef.current = next
      /* 처음 잰 폭은 그리면서 이미 맞춰 접었습니다(아래 효과). 여기서 다시 처음
         모양으로 돌리면 그 사이 초점을 받은 목록 단추가 사라집니다. */
      if (first) return
      setStage(0)
      setWidth(next)
    })
    observer.observe(head)
    return () => observer.disconnect()
  }, [])

  /* 넘치는지 봅니다. 넘치면 한 단계 더 접습니다 — 화면에 그려지기 전에 끝나므로
     접히는 중간 모양은 보이지 않습니다. 띠가 다시 그려질 때마다 봅니다(`tabs` 는
     그릴 때마다 새로 옵니다). 가려져 있던 카드가 탭을 골라 다시 설 때도 그 그리기
     안에서 접힙니다. */
  useLayoutEffect(() => {
    const head = headRef.current
    if (!head || stage >= LAST_STAGE) return
    if (head.scrollWidth > head.clientWidth + 0.5) setStage(stage + 1)
  }, [stage, shape, width, tabs])

  const foldLabel = fold ? (fold.collapsed ? '펼치기' : '접기') : ''
  const showNote = note !== null && stage < 1
  const iconFold = stage >= 2

  return (
    <div className="card-head" ref={headRef} data-fold={stage > 0 ? stage : undefined}>
      {grip}
      {strip === null ? (
        name
      ) : stage >= MENU_STAGE ? (
        <TabMenu tabs={tabs} onPick={onPick} showOthers={stage < LAST_STAGE} />
      ) : (
        strip
      )}
      {(showNote || fold) && (
        <div className="card-head-actions">
          {showNote && <span className="card-note">{note}</span>}
          {fold && (
            <button
              type="button"
              className={`btn btn-quiet card-head-btn${iconFold ? ' is-icon' : ''}`}
              aria-expanded={!fold.collapsed}
              aria-label={iconFold ? foldLabel : undefined}
              data-tip={iconFold ? foldLabel : undefined}
              onClick={fold.onToggle}
            >
              {iconFold ? (
                <span aria-hidden="true">{fold.collapsed ? '▾' : '▴'}</span>
              ) : (
                foldLabel
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* 탭 둘을 줄인 목록. 단추에는 고른 탭과 그 건수가 서고, ▾ 로 두 탭을 고릅니다.
 *
 * 목록은 화면 기준 자리에 뜹니다. 주문 내역 카드는 표가 옆 카드로 흐르지 않게 제
 * 안에서 자르고, 접힌 카드는 머리 띠 높이뿐이라 카드 안에 띄우면 목록이 잘립니다.
 * 그래서 문서 맨 바깥에 그립니다 — 앱 틀처럼 폭을 재는 상자 안에 두면 그 상자가
 * 자리의 기준이 되어 엉뚱한 곳에 뜹니다. 자리는 열 때 단추에서 재고, 스크롤·창
 * 크기 변경이 오면 닫습니다. */
function TabMenu({
  tabs,
  onPick,
  showOthers,
}: {
  tabs: HeadTab[]
  onPick: (key: string) => void
  /** 고르지 않은 탭의 건수 알약을 세울지. 띠가 그래도 넘치면 뺍니다. */
  showOthers: boolean
}) {
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const current = tabs.find((tab) => tab.current) ?? tabs[0]
  const others = tabs.filter((tab) => tab !== current && tab.count > 0)

  /* 목록에서 다른 탭을 고르면 그 탭의 카드가 같은 자리에 섭니다. 머리 띠도 그 카드의
     것으로 바뀌므로, 새로 선 카드의 단추가 초점을 이어받습니다. */
  const currentKey = current?.key
  useEffect(() => {
    const button = buttonRef.current
    if (!button || button.offsetParent === null) return
    if (performance.now() - pickedAt > FOCUS_HANDOFF_MS) return
    pickedAt = 0
    button.focus()
  }, [currentKey])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  /* 열리면 고른 탭 줄에 초점을 둡니다. 목록은 문서 맨 바깥에 있어 Tab 으로는 닿지
     않으므로, 키보드로 연 사람이 바로 고를 수 있게 합니다. */
  const isOpen = open !== null
  useEffect(() => {
    if (!isOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [isOpen])

  /* 목록 안의 키. 위아래 화살표로 줄을 옮기고, Tab 은 목록을 닫고 단추로 돌아갑니다 —
     목록이 문서 끝에 있어 Tab 을 그대로 두면 초점이 화면 맨 끝으로 튑니다. */
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      setOpen(null)
      buttonRef.current?.focus()
    }
  }

  if (!current) return null
  const toggle = () => {
    if (open) {
      setOpen(null)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setOpen({ top: rect.bottom + 4, left: rect.left })
  }

  return (
    <div className="tabs tabs-inline trade-tabs card-tab-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tab card-tab-menu-button"
        aria-current="true"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-label={`${current.label}${current.count > 0 ? ` ${current.count}건` : ''} — 탭 고르기`}
        onClick={toggle}
      >
        {current.label}
        {current.count > 0 && <span className="tab-count">{current.count}</span>}
        <span className="card-tab-menu-chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {/* 고르지 않은 탭의 건수. ▾ 뒤의 흐린 알약에 짧은 이름과 함께 적어(「미결제
          1」) 고른 탭의 건수와 갈라 읽히게 합니다. 화면 읽기는 전체 이름(「미결제약정
          1건」)을 듣습니다. */}
      {showOthers &&
        others.map((tab) => (
          <span key={tab.key} className="card-tab-other" title={`${tab.label} ${tab.count}건`}>
            <span aria-hidden="true">
              {tab.short} {tab.count}
            </span>
            <span className="card-tab-other-name">
              {tab.label} {tab.count}건
            </span>
          </span>
        ))}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="split-switch-menu card-tab-menu-list"
            role="menu"
            aria-label="카드 고르기"
            style={{ top: open.top, left: open.left }}
            onKeyDown={onMenuKey}
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className="split-switch-option"
                role="menuitemradio"
                aria-checked={tab.current}
                onClick={() => {
                  setOpen(null)
                  buttonRef.current?.focus()
                  if (tab.current) return
                  pickedAt = performance.now()
                  onPick(tab.key)
                }}
              >
                <span className="split-switch-option-text">{tab.label}</span>
                {tab.count > 0 && <span className="tab-count">{tab.count}</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
