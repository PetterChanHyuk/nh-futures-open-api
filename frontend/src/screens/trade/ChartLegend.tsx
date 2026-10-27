import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Chart } from 'klinecharts'
import type { Quote } from '../../lib/types'
import type { IndicatorSettings } from './chartIndicators'
import { anyIndicatorDef } from './extraIndicators'

/* 차트 범례.
 *
 * 라이브러리의 말풍선 대신 이 앱이 그립니다. 라이브러리 것은 봉 위에 상자를
 * 띄워 봉을 가리고, 글자 크기·색이 앱과 다릅니다. 여기서는 칸의 왼쪽 위에
 * 글줄로 붙이고, 십자선을 따라 값만 바뀝니다.
 *
 * 위 칸은 두 줄입니다 — 시가·고가·저가·종가, 그 아래 겹친 지표. 아래 칸은
 * 칸마다 한 줄입니다. 지표 줄에는 숨기기(눈)와 끄기(✕)가 붙어, 설정을 열지
 * 않고도 선 하나를 치울 수 있습니다.
 */

export interface LegendEntry {
  label: string
  value: string
  /** 선의 색. 위 칸은 이름에, 아래 칸은 값에 칠합니다. */
  color?: string
  /** 선인지(막대·점이 아니라). 접힌 한 줄은 선마다 색 점 하나를 세웁니다. */
  line?: boolean
}

export interface LegendRow {
  name: string
  label: string
  /** 칸의 위쪽 좌표(캔버스 기준). 줄을 그 칸에 붙입니다. */
  top: number
  /** 라이브러리에서 지표가 숨김 상태인지. */
  hidden: boolean
  entries: LegendEntry[]
  /** **아직 값이 하나도 안 선 지표인가.** 봉이 모자라 못 셈한 것이라, 값 자리를
   *  「—」로 채우지 않고 그 까닭을 한 줄로 대신 적습니다 — 「—」는 「원래 없는 값」의
   *  말이라 「조금 더 기다리면 선다」를 말할 수 없습니다. */
  warmingUp: boolean
  /** 선의 이름이 곧 기간인 지표인지(이동평균의 5·20·60). 접힌 한 줄은 이런 지표만
   *  점 옆에 기간을 적습니다 — 고정 선(볼린저의 상단·중심·하단)은 점만 섭니다. */
  periodLines?: boolean
}

export interface OhlcRow {
  top: number
  open: number
  high: number
  low: number
  close: number
  /** 전봉 종가. 등락 색의 기준입니다. */
  prevClose: number
}

const CANDLE_PANE = 'candle_pane'
/* 위 칸 범례는 종목 배지 아래에 섭니다. 배지 한 줄의 높이입니다. */
export const BADGE_HEIGHT = 26
/* 범례 한 줄의 높이와 줄 사이(`trade.css` 의 `.legend-line`·`.legend`). */
const LINE_HEIGHT = 18
const LINE_GAP = 2
/* 접힌 한 줄의 항목 사이와 줄의 좌우 안쪽 여백(`.legend-line`). */
const COMPACT_GAP = 6
const LINE_PADDING = 4
/* 범례가 칸 폭에서 쓰지 못하는 몫 — 가격축 앞에서 멈춥니다(`.legend` 의 최대 폭). */
const LEGEND_AXIS_ROOM = 80

/** 펼친 머리 범례(시고저종 한 줄 + 겹친 지표 `overlays` 줄)의 아래 끝 — 봉 칸
 *  위에서 잰 값입니다. 차트를 그리기 전에 범례가 봉 칸에 들어갈지 셀 때 씁니다. */
export function legendHeadBottom(overlays: number): number {
  return BADGE_HEIGHT + LINE_HEIGHT * (1 + overlays) + LINE_GAP * overlays
}

function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** 지표 값의 자릿수. 가격을 따르는 지표는 종목 자릿수, 나머지는 둘입니다.
 *  범례와 배지가 같은 규칙을 씁니다 — 같은 값이 두 자릿수로 보이면 다른 값처럼 읽힙니다. */
export function precisionFor(series: string, name: string, quote: Quote): number {
  if (series === 'price') return quote.decimals
  if (name === 'VOL' || name === 'OBV') return 0
  return 2
}

/** 캔버스 안에서 칸이 시작하는 높이. 칸이 없으면 null 입니다. */
export function paneTop(chart: Chart, box: HTMLElement, paneId: string): number | null {
  const dom = chart.getDom(paneId, 'main')
  if (!dom) return null
  return dom.getBoundingClientRect().top - box.getBoundingClientRect().top
}

/** 십자선이 가리키는(없으면 마지막) 봉의 값들을 모읍니다. */
export function collectLegend(
  chart: Chart,
  box: HTMLElement,
  quote: Quote,
  settings: IndicatorSettings,
  cursor: number | null,
): { ohlc: OhlcRow | null; rows: LegendRow[]; bars: number } {
  const data = chart.getDataList()
  if (data.length === 0) return { ohlc: null, rows: [], bars: 0 }
  const index = cursor !== null && cursor >= 0 && cursor < data.length ? cursor : data.length - 1
  const bar = data[index]
  const prev = data[index - 1] ?? bar

  const candleTop = paneTop(chart, box, CANDLE_PANE) ?? 0
  const ohlc: OhlcRow = {
    top: candleTop,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    prevClose: prev.close,
  }

  const rows: LegendRow[] = []
  for (const indicator of chart.getIndicators()) {
    const def = anyIndicatorDef(indicator.name)
    const setting = settings[indicator.name]
    if (!def || !setting) continue
    const top = paneTop(chart, box, indicator.paneId)
    if (top === null) continue

    const result = (indicator.result[index] ?? {}) as Record<string, unknown>
    const decimals = precisionFor(indicator.series, indicator.name, quote)
    const entries: LegendEntry[] = []
    let lineIndex = 0
    let extraIndex = 0
    let shown = false

    for (const figure of indicator.figures) {
      const raw = result[figure.key]
      const value = typeof raw === 'number' ? formatNumber(raw, decimals) : '—'
      if (typeof raw === 'number') shown = true
      if (figure.type === 'line') {
        const line = setting.lines[lineIndex]
        const label = def.linePeriods ? String(setting.params[lineIndex]) : def.lines[lineIndex]
        entries.push({ label: label ?? figure.key, value, color: line?.color, line: true })
        lineIndex += 1
      } else {
        entries.push({ label: def.extras?.[extraIndex] ?? figure.key, value })
        extraIndex += 1
      }
    }

    rows.push({
      name: indicator.name,
      label: def.label,
      top,
      hidden: !indicator.visible,
      entries,
      /* 하나라도 값이 섰으면 준비가 끝난 것입니다 — 그 지표의 그림 가운데 한둘이
         늦게 서는 경우가 있어, **전부 비었을 때만** 준비 중입니다. */
      warmingUp: !shown,
      periodLines: def.linePeriods !== undefined,
    })
  }

  return { ohlc, rows, bars: data.length }
}

interface Props {
  /** 차트에 실린 봉 수. 아직 값이 안 선 지표가 「얼마나 모였나」를 적습니다. */
  bars: number
  quote: Quote
  ohlc: OhlcRow | null
  rows: LegendRow[]
  onHide: (name: string, hidden: boolean) => void
  onRemove: (name: string) => void
  /** 봉 칸 위 겹친 지표가 많을 때 한 줄로 접을지. 넘기는 차트(전략 검증)만 접히고,
   *  안 넘기면 늘 펼친 그대로입니다. */
  fold?: LegendFold
  /** 칸이 낮아 머리 범례를 한 줄로 접을지. 넘기면 시고저종과 겹친 지표가 한 줄
   *  (「종 값 +3 · 지표 점 ▾」)이 되고, ▾ 로 펼친 범례는 차트 위에 덮여 섭니다.
   *  `open` 은 덮인 범례가 떠 있는지입니다. */
  compact?: LegendFold
}

/** 겹친 지표 범례 접기 — 펼쳤는지와 바꾸는 함수. 기억은 넘기는 쪽이 합니다. */
export interface LegendFold {
  open: boolean
  onToggle: (open: boolean) => void
}

/** 겹친 지표가 이만큼 넘으면 접습니다(시고저종 줄은 세지 않음). */
const FOLD_AT = 4

function tone(value: number, base: number): string {
  return value > base ? 'up' : value < base ? 'down' : ''
}

export function ChartLegend({ bars, quote, ohlc, rows, onHide, onRemove, fold, compact }: Props) {
  const d = quote.decimals
  const topRows = rows.filter((row) => row.top === ohlc?.top)
  const subRows = rows.filter((row) => row.top !== ohlc?.top)
  /* 접을 수 있는지와 지금 접혔는지. 십자선을 올려도 바뀌지 않습니다 — 펴고 접는 것은
     사용자가 줄을 누를 때뿐입니다. */
  const foldable = fold !== undefined && topRows.length >= FOLD_AT
  const folded = foldable && !fold.open

  /* 덮인 범례는 그 바깥을 누르거나 Esc 로 닫힙니다. Esc 는 여기서 먼저 받아 멈춥니다 —
     그대로 흘리면 같은 키가 확대까지 풀어 한 번에 둘이 닫힙니다. ▾ 를 누르는 것은
     바깥이 아닙니다(그 단추가 직접 접고 폅니다). */
  const popRef = useRef<HTMLDivElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const popOpen = compact?.open === true
  const toggleCompact = compact?.onToggle
  /* 덮인 범례를 닫습니다. 초점이 그 안(◉·✕·「▴ 접기」)에 있었으면 ▾ 로 돌립니다 —
     덮개가 사라지며 초점이 문서 처음으로 떨어지면 키보드로 쓰던 사람은 자리를
     잃습니다. ▾ 는 접힌 줄에 늘 남아 같은 일을 되돌리는 단추입니다.

     바깥을 눌러 닫을 때(`afterClick`)는 그 누름이 초점을 옮길 때까지 기다렸다가,
     초점이 갈 곳 없이 떨어졌을 때만 ▾ 로 돌립니다. 누른 곳이 입력칸·단추면 초점은
     거기에 두어야 합니다 — 사용자가 고른 자리입니다. */
  const closePop = useCallback(
    (afterClick: boolean) => {
      const inside = popRef.current?.contains(document.activeElement) ?? false
      toggleCompact?.(false)
      if (!inside) return
      if (!afterClick) {
        openRef.current?.focus()
        return
      }
      window.setTimeout(() => {
        const now = document.activeElement
        if (now === null || now === document.body) openRef.current?.focus()
      }, 0)
    },
    [toggleCompact],
  )
  useEffect(() => {
    if (!popOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closePop(false)
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (popRef.current?.contains(target) || openRef.current?.contains(target))) return
      closePop(true)
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [popOpen, closePop])

  const indicatorLine = (row: LegendRow, valueColored: boolean) => (
    <div key={row.name} className={`legend-line${row.hidden ? ' is-hidden' : ''}`}>
      <button
        type="button"
        className="legend-tool"
        aria-label={`${row.label} ${row.hidden ? '보이기' : '숨기기'}`}
        aria-pressed={row.hidden}
        onClick={() => onHide(row.name, !row.hidden)}
      >
        {row.hidden ? '◌' : '◉'}
      </button>
      <button
        type="button"
        className="legend-tool"
        aria-label={`${row.label} 끄기`}
        onClick={() => onRemove(row.name)}
      >
        ✕
      </button>
      <span className="legend-name">{row.label}</span>
      {/* **값 자리를 「—」로 채우지 않습니다.** 「—」는 「원래 없는 값」의 말이라,
          봉이 더 모이면 선다는 것을 말할 수 없습니다. 이상이 아니라 아직 못 셈한
          것이므로 중립으로 적습니다 — 검증 화면의 「준비 중」과 같은 말입니다.
          **몇 봉이 필요한지는 안 적습니다**: 지표마다 다르고 화면이 그 수를 갖고
          있지 않아, 지어낸 수를 적으면 「—」보다 나쁩니다. */}
      {row.warmingUp ? (
        <span className="legend-entry legend-warmup">준비 중 — 확보 {bars}</span>
      ) : (
        row.entries.map((entry, i) => (
          <span key={i} className="legend-entry">
            <span className="legend-key" style={valueColored ? undefined : { color: entry.color }}>
              {entry.label}
            </span>
            <span className="legend-value" style={valueColored ? { color: entry.color } : undefined}>
              {entry.value}
            </span>
          </span>
        ))
      )}
    </div>
  )

  /* 칸이 좁아지면 이 줄은 두 단계로 물러납니다. 고르는 것은 `trade.css`
     의 칸 폭 조건이고, 여기서는 그 조건이 짚을 이름만 답니다.

     1. 표지가 한 글자가 됩니다 — 「시가」가 「시」로. 값은 그대로입니다
     2. 그래도 모자라면 **시가부터** 접고, 다음이 고가·저가 한 짝입니다.
        종가는 마지막까지 남습니다

     시가를 먼저 접는 것은 넷 중 유일하게 다른 표시가 대신 말해 주기
     때문입니다 — 봉의 몸통 색이 이미 「종가가 시가보다 위인가」를
     말합니다. 고가·저가는 방향만 다른 한 짝이라 갈라 접지 않습니다:
     한쪽만 남기면 화면이 오르는 쪽이나 내리는 쪽을 편들게 됩니다.

     접힌 개수는 줄 끝에 「+n」으로 섭니다. 없으면 「이 차트는 원래
     그 값을 안 보여준다」로 읽혀, 칸을 넓히면 나온다는 것을 모릅니다. */
  const ohlcLine = (row: OhlcRow) => (
    <div className="legend-line legend-ohlc">
      {(
        [
          ['시가', '시', row.open, 'open'],
          ['고가', '고', row.high, 'high'],
          ['저가', '저', row.low, 'low'],
          ['종가', '종', row.close, 'close'],
        ] as const
      ).map(([label, short, value, key]) => (
        <span key={label} className={`legend-entry legend-ohlc-${key}`}>
          <span className="legend-key">
            <span className="legend-key-long">{label}</span>
            <span className="legend-key-short">{short}</span>
          </span>
          <span className={`legend-value ${tone(value, row.prevClose)}`}>
            {formatNumber(value, d)}
          </span>
        </span>
      ))}
    </div>
  )

  /* 접힌 한 줄의 지표 쪽 — 지표마다 한 덩어리(「· 선마다 색 점 + 이름」)입니다.
     자리가 모자라면 **지표 단위로** 끝에서부터 물러납니다. 점만 남으면 색만 남아
     어느 지표의 선인지 읽을 수 없으므로, 이름과 그 점들은 함께 서거나 함께
     사라집니다. 기간이 이름인 지표(이동평균의 5·20·60)는 점 옆에 기간을 적고,
     고정 선의 지표(볼린저의 상단·중심·하단)는 점만 둡니다. 숨긴 지표는 흐리게 둡니다. */
  /* 접힌 줄에 지표가 하나도 못 서는지. 그때는 「+3」 뒤가 비어 ▾ 가 무엇을 펼치는지
     읽히지 않으므로, 「+3」 바로 뒤에 도구 줄 접힘과 같은 꼴로 「지표 n」을 세우고
     빈 지표 자리는 접습니다.

     줄 폭은 CSS 가 정하므로(칸 폭 − 가격축 앞 몫) 그 폭에서 종가·「+3」·▾ 를 뺀
     자리를 첫 지표 덩어리의 폭과 견줍니다. 지표 자리나 「지표 n」의 폭으로 재지
     않습니다 — 그 둘은 이 판정에 따라 접히고 서므로, 그걸로 재면 표시가 섰다
     사라졌다 흔들립니다. */
  /* 접힌 줄은 봉을 다시 받는 동안 잠깐 사라졌다 다시 섭니다. 새로 선 줄을 재도록
     요소 자체를 상태로 듭니다. */
  const [line, setLine] = useState<HTMLDivElement | null>(null)
  const [noneFits, setNoneFits] = useState(false)
  const isCompact = compact !== undefined
  const itemsKey = isCompact
    ? topRows.map((row) => `${row.name}:${row.entries.length}:${row.hidden ? 1 : 0}`).join('|')
    : ''
  useLayoutEffect(() => {
    const box = line?.closest<HTMLElement>('.chart-box')
    if (!isCompact || !line || !box) {
      setNoneFits(false)
      return
    }
    const measure = () => {
      const first = line.querySelector<HTMLElement>('.legend-compact-item')
      if (!first) {
        setNoneFits(false)
        return
      }
      const width = (element: Element) => element.getBoundingClientRect().width
      const fixed = [...line.children]
        .filter((child) => child.matches('.legend-ohlc-close, .legend-compact-more, .legend-compact-open'))
        .reduce((sum, child) => sum + width(child), 0)
      /* 종가 · 「+3」 · 지표 자리 · ▾ — 사이 셋. 반 픽셀 안쪽으로 맞닿으면 「지표 n」
         쪽으로 둡니다 — 소수 폭이 반올림되며 덩어리가 끝에서 잘리는 것보다 낫습니다. */
      const room = width(box) - LEGEND_AXIS_ROOM - LINE_PADDING * 2 - fixed - COMPACT_GAP * 3
      setNoneFits(width(first) > room - 0.5)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [isCompact, itemsKey, line])

  const compactItems = topRows.map((row) => (
    <span key={row.name} className={`legend-compact-item${row.hidden ? ' is-hidden' : ''}`}>
      <span className="legend-fold-sep"> · </span>
      {row.entries
        .filter((entry) => entry.line)
        .map((entry, i) => (
          <span key={i} className="legend-compact-dot">
            <span
              className="legend-fold-dot"
              style={{ background: entry.color || 'var(--text-dim)' }}
              aria-hidden="true"
            />
            {row.periodLines && entry.label}
          </span>
        ))}
      <span className="legend-compact-name">{row.label}</span>
    </span>
  ))

  return (
    <>
      {ohlc && compact && (
        /* 접힌 한 줄 머리. 시가·고가·저가는 접어 「+3」으로 세고 종가만 남깁니다
           (넓은 칸의 접는 차례와 같은 끝). ◉·✕·「준비 중」은 펼친 범례에서 봅니다.
           ▾ 는 늘 줄 끝에 남고, 모자라면 지표가 끝에서부터 지표 단위로 물러납니다.
           하나도 못 서면 「+3」 뒤에 「지표 n」이 섭니다. */
        <div className="legend legend-candle" style={{ top: ohlc.top + BADGE_HEIGHT }}>
          <div ref={setLine} className="legend-line legend-compact">
            <span className="legend-entry legend-ohlc-close">
              <span className="legend-key">종</span>
              <span className={`legend-value ${tone(ohlc.close, ohlc.prevClose)}`}>
                {formatNumber(ohlc.close, d)}
              </span>
            </span>
            <span className="legend-compact-more">+3</span>
            {noneFits && (
              /* 읽어 주는 이름은 ▾ 단추가 함께 말합니다. */
              <span className="legend-compact-count" aria-hidden="true">
                <span className="legend-fold-sep">· </span>
                지표
                <span className="chart-fold-count">{topRows.length}</span>
              </span>
            )}
            {compactItems.length > 0 && (
              <span className={`legend-compact-items${noneFits ? ' is-empty' : ''}`}>{compactItems}</span>
            )}
            <button
              ref={openRef}
              type="button"
              className="legend-compact-open"
              aria-expanded={compact.open}
              aria-label={`${compact.open ? '범례 접기' : '범례 펼치기'}${
                noneFits ? ` — 겹친 지표 ${topRows.length}개` : ''
              }`}
              onClick={() => compact.onToggle(!compact.open)}
            >
              {compact.open ? '▴' : '▾'}
            </button>
          </div>
        </div>
      )}
      {ohlc && compact?.open && (
        /* 펼친 범례는 차트 위에 덮입니다. 봉 칸의 위 여백은 접힌 한 줄로 셉니다 —
           펼친 높이로 여백을 잡으면 낮은 칸에서 봉이 설 자리가 없습니다. */
        <div ref={popRef} className="legend legend-pop" style={{ top: ohlc.top + BADGE_HEIGHT }}>
          {ohlcLine(ohlc)}
          {topRows.map((row) => indicatorLine(row, false))}
          <button
            type="button"
            className="legend-line legend-fold legend-unfold"
            aria-expanded={true}
            onClick={() => closePop(false)}
          >
            ▴ 접기
          </button>
        </div>
      )}
      {ohlc && !compact && (
        <div className="legend legend-candle" style={{ top: ohlc.top + BADGE_HEIGHT }}>
          {ohlcLine(ohlc)}
          {folded ? (
            /* 접힌 한 줄 — 지표 이름만, 앞에 그 지표 첫 선의 색 점. 값은 펼쳐야 섭니다. */
            <button
              type="button"
              className="legend-line legend-fold"
              aria-expanded={false}
              onClick={() => fold.onToggle(true)}
            >
              {topRows.map((row, index) => (
                <span key={row.name} className="legend-fold-item">
                  {index > 0 && <span className="legend-fold-sep"> · </span>}
                  <span
                    className="legend-fold-dot"
                    style={{ background: row.entries[0]?.color || 'var(--text-dim)' }}
                    aria-hidden="true"
                  />
                  {row.label}
                </span>
              ))}
              <span className="legend-fold-mark" aria-hidden="true">
                {' '}▾
              </span>
            </button>
          ) : (
            <>
              {topRows.map((row) => indicatorLine(row, false))}
              {foldable && (
                <button
                  type="button"
                  className="legend-line legend-fold legend-unfold"
                  aria-expanded={true}
                  onClick={() => fold.onToggle(false)}
                >
                  ▴ 접기
                </button>
              )}
            </>
          )}
        </div>
      )}
      {subRows.map((row) => (
        <div key={row.name} className="legend legend-sub" style={{ top: row.top }}>
          {indicatorLine(row, true)}
        </div>
      ))}
    </>
  )
}
