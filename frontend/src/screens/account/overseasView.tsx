import { useSyncExternalStore } from 'react'
import { useListOnce, type OverseasView, type ServerPosition } from '../../data/account'

/* ── 해외 통화 보기 ────────────────────────────────────── */

/* 계좌 화면 머리와 사이드바의 계좌 패널이 **한 보기**를 씁니다. 두 자리가 함께 떠
 * 있을 때 한쪽에서 바꾸면 다른 쪽도 바로 따라옵니다 — 같은 해외 예탁금을 두 자리가
 * 다른 통화로 말하면, 어느 쪽이 지금 고른 보기인지 알 수 없습니다. */

/** 남기는 모양. 원화 환산으로 볼 때도 고른 통화를 들고 있어, 통화별로 돌아오면
 *  그 통화가 그대로 섭니다. */
export interface StoredView {
  mode: 'by-currency' | 'converted'
  currency: string
}

export const VIEW_KEY = 'nh.account.overseas.view'
export const DEFAULT_VIEW: StoredView = { mode: 'by-currency', currency: 'USD' }

/** 남긴 값을 읽습니다. 모양이 틀리면(모르는 보기, 세 글자 대문자가 아닌 통화)
 *  기본값입니다 — 틀린 값으로 물으면 서버가 거절하고 화면이 빕니다. */
export function readView(raw: unknown): StoredView {
  const value = (raw ?? {}) as Partial<StoredView>
  const mode = value.mode === 'by-currency' || value.mode === 'converted' ? value.mode : null
  const currency = typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency) ? value.currency : null
  if (mode === null || currency === null) return DEFAULT_VIEW
  return { mode, currency }
}

/** 고를 수 있는 통화. USD 가 늘 맨 앞이고 나머지는 글자 차례입니다. */
export function currencyChoices(codes: (string | null | undefined)[]): string[] {
  const rest = new Set<string>()
  for (const code of codes) {
    const one = (code ?? '').trim().toUpperCase()
    if (/^[A-Z]{3}$/.test(one) && one !== 'USD') rest.add(one)
  }
  return ['USD', ...[...rest].sort()]
}

/* 남긴 보기를 담는 자리. 브라우저 저장소가 막혀 있으면 값이 남지 않을 뿐, 이번
   실행 동안은 여기 담긴 값으로 두 자리가 함께 움직입니다. */
let held: StoredView | null = null
const listeners = new Set<() => void>()

function savedView(): StoredView {
  if (held === null) {
    try {
      const raw = localStorage.getItem(VIEW_KEY)
      held = readView(raw === null ? DEFAULT_VIEW : JSON.parse(raw))
    } catch {
      held = DEFAULT_VIEW
    }
  }
  return held
}

function saveView(next: StoredView): void {
  held = next
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(next))
  } catch {
    // 저장이 막혀 있어도 이번 실행 동안은 값이 유지됩니다.
  }
  for (const listener of listeners) listener()
}

function subscribeView(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 남긴 해외 보기와 그것을 바꾸는 함수. 모양이 틀린 값은 기본(통화별 USD)으로
 *  읽습니다. */
export function useSavedOverseasView(): [StoredView, (next: StoredView) => void] {
  return [useSyncExternalStore(subscribeView, savedView, savedView), saveView]
}

/** 지금 물을 보기. 남긴 통화가 고를 목록에 없으면 **화면만** 첫 통화로 봅니다.
 *  남긴 값은 덮지 않습니다 — 그 통화의 줄이 다시 생기면 사용자가 고른 대로
 *  돌아가야 합니다. 잔고를 아직 못 받았으면(`known` 거짓) 목록을 모르므로 남긴
 *  통화로 먼저 묻습니다. */
export function shownView(saved: StoredView, currencies: string[], known: boolean): OverseasView {
  const currency = !known || currencies.includes(saved.currency) ? saved.currency : currencies[0]
  return saved.mode === 'converted' ? { mode: 'converted' } : { mode: 'by-currency', currency }
}

/** 계좌 머리의 통화 보기 전환. 시장 전환과 같은 꼴(둘 중 하나)이고, 통화별이면
 *  곁에 통화를 고르는 칸이 섭니다. 고를 통화가 하나뿐이면 칸 대신 글자입니다.
 *
 *  **고를 통화를 알려고 해외 잔고를 부릅니다** — 잔고 탭과 같은 자리라 두 번
 *  나가지 않습니다. */
export function OverseasViewPicker({
  saved,
  shown,
  currencies,
  onChange,
}: {
  saved: StoredView
  shown: OverseasView
  currencies: string[]
  onChange: (next: StoredView) => void
}) {
  useListOnce<ServerPosition>('overseas', 'positions')
  const byCurrency = shown.mode === 'by-currency'
  const current = shown.mode === 'by-currency' ? shown.currency : saved.currency
  /* 잔고를 받기 전에는 남긴 통화가 목록에 없을 수 있습니다. 보이는 통화는 늘
     고를 수 있게 넣어 둡니다. */
  const options = currencies.includes(current) ? currencies : [...currencies, current]
  return (
    <div className="acct-view">
      <div className="seg seg-even acct-view-mode">
        <button
          type="button"
          className="seg-item"
          aria-pressed={byCurrency}
          onClick={() => onChange({ ...saved, mode: 'by-currency' })}
        >
          통화별
        </button>
        <button
          type="button"
          className="seg-item"
          aria-pressed={!byCurrency}
          onClick={() => onChange({ ...saved, mode: 'converted' })}
        >
          원화 환산
        </button>
      </div>
      {byCurrency &&
        (options.length > 1 ? (
          <select
            className="control acct-view-currency"
            aria-label="통화"
            value={current}
            onChange={(event) => onChange({ mode: 'by-currency', currency: event.target.value })}
          >
            {options.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        ) : (
          <span className="acct-view-code">{current}</span>
        ))}
    </div>
  )
}
