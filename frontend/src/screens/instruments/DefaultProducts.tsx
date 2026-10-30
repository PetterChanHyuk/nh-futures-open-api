import { useState, useSyncExternalStore } from 'react'
import { InstrumentPicker } from '../../lib/InstrumentPicker'
import { productsOf, type Market } from '../../data/instruments'
import { subscribeUi, uiState, useUiState } from '../../data/uiState'
import type { Product } from '../../lib/types'

/* 기본 품목 — 종목 화면 상세 칸 맨 위의 알약 줄.
 *
 * 자주 여는 품목을 알약으로 두고, 누르면 그 품목의 월물 목록이 아래 상세 칸에
 * 섭니다. 왼쪽 목록을 거래소·상품군까지 펼쳐 내려가지 않아도 됩니다. 알약은 빼고
 * 더할 수 있고, 바꾼 목록은 다음에 켜도 그대로입니다.
 *
 * **알약은 왼쪽 목록을 건드리지 않습니다.** 알약으로 고른 품목의 상품군을 펼치지
 * 않고, 왼쪽에서 품목을 골라도 알약 줄은 그대로입니다 — 둘은 같은 상세 칸을 여는
 * 두 길입니다. */

/** 알약 하나 — 시장과 품목 코드. 같은 코드가 두 시장에 있을 수 있어 둘을 함께
 *  듭니다. */
export interface ProductPin {
  market: Market
  code: string
}

/** 저장값이 없을 때의 알약. 국내 미국달러·코스피200, 해외 미니 S&P 500·미니
 *  나스닥 100 입니다. 코드는 종목 마스터의 품목 코드입니다. */
export const DEFAULT_PINS: readonly ProductPin[] = [
  { market: 'domestic', code: 'USD' },
  { market: 'domestic', code: 'KOSPI' },
  { market: 'overseas', code: 'ES' },
  { market: 'overseas', code: 'NQ' },
]

const PINS_KEY = 'nh.instruments.defaults'

function isPin(value: unknown): value is ProductPin {
  if (typeof value !== 'object' || value === null) return false
  const { market, code } = value as Record<string, unknown>
  return (market === 'domestic' || market === 'overseas') && typeof code === 'string' && code !== ''
}

/** 기본 품목 목록의 지금 상태. */
export interface DefaultProductsState {
  pins: readonly ProductPin[]
  /** 바꾼 목록을 저장합니다. */
  store: (next: ProductPin[]) => void
  /** 빼고 더할 수 있는지. 화면 상태 파일을 읽은 뒤에만 됩니다. */
  editable: boolean
}

/** 기본 품목 목록. **저장값이 없으면 기본 넷이고, 빈 목록이면 빈 목록입니다** —
 *  사용자가 일부러 다 뺀 것을 열 때마다 되살리면 뺀 것이 무시된 것입니다. 바꾸면
 *  바로 저장합니다.
 *
 *  **화면 상태 파일을 읽지 못했으면 바꾸지 못합니다.** 그때 서 있는 것은 저장값이
 *  아니라 기본 넷이라, 그 위에서 하나를 빼면 「기본 넷 − 1」이 저장값을 덮습니다.
 *  기본 넷을 보이되 바꾼 것은 남기지 않습니다. 파일을 받는 중에는 종목 화면 자체가
 *  그려지지 않습니다. */
export function useDefaultProducts(): DefaultProductsState {
  const [stored, store] = useUiState<unknown>(PINS_KEY, null)
  const status = useSyncExternalStore(subscribeUi, () => uiState().status)
  const pins = Array.isArray(stored) ? stored.filter(isPin) : DEFAULT_PINS
  return { pins, store, editable: status === 'ready' }
}

/** 알약이 가리키는 품목. 마스터에서 찾지 못하면(품목이 빠짐) `null` 입니다. */
export function productOfPin(pin: ProductPin): Product | null {
  return productsOf(pin.market).find((item) => item.code === pin.code) ?? null
}

const MARKET_WORD: Record<Market, string> = { domestic: '국내', overseas: '해외' }

interface Props {
  pins: readonly ProductPin[]
  /** 빼기·더하기를 받을지. 아니면 두 단추가 눌리지 않습니다. */
  editable: boolean
  /** 지금 상세 칸에 선 품목. 그 알약이 눌린 모양으로 섭니다. */
  current: ProductPin | null
  onOpen: (pin: ProductPin) => void
  onChange: (next: ProductPin[]) => void
}

export function DefaultProducts({ pins, editable, current, onOpen, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  /* 마스터에서 못 찾는 알약은 세우지 않습니다. 저장값에서는 지우지 않습니다 —
     마스터가 다시 그 품목을 실으면 알약도 돌아옵니다. */
  const shown = pins.flatMap((pin) => {
    const product = productOfPin(pin)
    return product ? [{ pin, product }] : []
  })
  const same = (a: ProductPin, b: ProductPin) => a.market === b.market && a.code === b.code

  const remove = (pin: ProductPin) => {
    if (editable) onChange(pins.filter((item) => !same(item, pin)))
  }

  /* 더한 알약은 맨 뒤에 섭니다. 이미 있는 품목이면 아무것도 안 합니다 — 같은 알약이
     둘 서면 하나를 빼도 남아 뺀 것이 안 먹은 것으로 보입니다. */
  const add = (pin: ProductPin) => {
    setAdding(false)
    if (!editable || pins.some((item) => same(item, pin))) return
    onChange([...pins, pin])
  }

  /* 바꾼 것을 남기지 못하는 때의 까닭. 누르지 못하는 단추에 붙입니다. */
  const locked = editable ? undefined : '화면 상태를 받지 못해 바꾼 목록을 남길 수 없습니다'

  return (
    <div className="instr-pins" role="group" aria-label="기본 품목">
      <span className="instr-pins-label">기본 품목</span>
      {shown.map(({ pin, product }) => {
        const on = current !== null && same(current, pin)
        return (
          <span key={`${pin.market}|${pin.code}`} className="instr-pin" data-on={on ? 'true' : undefined}>
            <button
              type="button"
              className="instr-pin-open"
              aria-pressed={on}
              onClick={() => onOpen(pin)}
            >
              <span className="instr-pin-market">{MARKET_WORD[pin.market]}</span>
              <span className="instr-pin-name">{product.name}</span>
            </button>
            <button
              type="button"
              className="instr-pin-remove"
              aria-label={`${product.name} 기본 품목에서 빼기`}
              title={locked ?? '빼기'}
              disabled={!editable}
              onClick={() => remove(pin)}
            >
              ×
            </button>
          </span>
        )
      })}
      <span className="instr-pin-adder">
        <button
          type="button"
          className="instr-pin-add"
          aria-expanded={adding}
          title={locked}
          disabled={!editable}
          onClick={() => setAdding((open) => !open)}
        >
          + 품목 추가
        </button>
        {/* **품목 모드**로 엽니다. 알약은 월물이 아니라 품목을 가리키므로, 월물이
            늘어선 판을 세우면 누른 월물이 버려진 것처럼 읽힙니다. */}
        {adding && (
          <InstrumentPicker
            mode="product"
            market={current?.market ?? 'domestic'}
            current={null}
            onClose={() => setAdding(false)}
            onPick={(item) => add({ market: item.market, code: item.productCode })}
          />
        )}
      </span>
      {/* 저장 단추가 없는 자리라, 바꾼 것이 남는다는 것을 여기서 말합니다. 남기지
          못하는 때에는 이 말이 거짓이라 세우지 않습니다. */}
      {editable && <span className="instr-pins-note">다음에 켜도 그대로</span>}
    </div>
  )
}
