import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUiState } from '../../data/uiState'
import type { Quote } from '../../lib/types'
import {
  INDICATOR_DEFS,
  SETTINGS_KEY,
  normalizeSettings,
  type IndicatorSetting,
  type IndicatorSettings,
} from './chartIndicators'
import { IndicatorMenu, IndicatorSettingsPopover, type IndicatorMenuItem } from './IndicatorSettings'
import { ChartView } from './ChartView'
import { SyncHub } from './SyncHub'
import { DRAW_LABEL_CARD, NARROW_CARD, NARROW_CARD_WITH_DRAW, TIGHT_DRAW_CARD, useNarrowCard } from './cardWidth'
import type { BottomCap } from './chartLayout'
import { PANES_GAP } from './tradeLayout'
import type { LegendFold } from './ChartLegend'
import type { TradeMark } from './chartMarks'
import { InstrumentPicker, type InstrumentRef } from '../../lib/InstrumentPicker'
import { SPAN_LABEL, type Orient, type SlotState, type Span } from './chartSlots'

/* 차트 패널 — 도구 줄과 차트 칸.
 *
 * 기간은 「일 · 분」 둘뿐입니다. 주·월봉이 오지 않아 탭을 두면 빈 탭이 됩니다.
 *
 * 지표는 설정(⚙)에서 켜고 끕니다. 자주 쓰는 다섯은 도구 줄에 단추로도 있고,
 * 카드가 좁으면 그 다섯이 「지표 N ▾」 한 단추로 접힙니다.
 * 한 칸일 때는 모든 차트가 한 구성을 씁니다. 선의 색·굵기·기간은 사용자가
 * 고르고 다음에 열어도 그대로입니다.
 *
 * 「차트 확대」는 이 화면 안에서 차트가 왼쪽 열을 다 차지하는 것입니다.
 * 브라우저 전체화면이 아닙니다 — 호가와 주문 폼은 그대로 있어야 차트를 보다가
 * 바로 주문할 수 있습니다. 한 칸은 확대에서만 그리기 도구가 나옵니다. 두 칸은
 * 도구 줄 끝의 「✎ 그리기」로 그리기 띠를 켜고 끄고, 확대에서는 늘 켜집니다.
 * 확대를 켜고 끄는 단추는 이 도구 줄이 아니라 카드 머리 띠에 있습니다 —
 * 「이 카드를 열 전체로」는 보이는 값이 아니라 카드 자체에 대한 동작입니다.
 *
 * 두 칸 보기는 카드 머리 띠의 [한 칸 | 두 칸 ▾] 로 켜고 끕니다. 확대와 상관없이
 * 켜져 있는 동안 두 칸이 위아래(또는 좌우)로 나란히 섭니다. 두 칸 중 하나가
 * 주문 대상이고, 다른 칸을 누르면 대상이 그 칸으로 옮겨 갑니다. 칸마다 봉 종류와
 * 지표 구성을 따로 가집니다 — 확대하고 축소해도 그대로입니다.
 */

const PERIODS: Span[] = ['day', 'minute']

/* 도구 줄에 단추로 나오는 지표. 나머지는 설정에서 켭니다. */
const QUICK_INDICATORS = ['MA', 'BOLL', 'VOL', 'MACD', 'RSI']

/* 두 칸일 때 칸마다 세우는 아래 칸(거래량·MACD·RSI 등)의 수. 칸 높이가 한 칸의
   반이라, 아래 칸을 둘 이상 세우면 봉 칸이 눌려 값을 읽을 수 없습니다. 목록
   차례로 앞의 것 하나가 서고, 나머지는 켠 채로 두었다가 한 칸으로 돌아가면 다시
   섭니다. */
const SPLIT_BOTTOM: BottomCap = { max: 1, floor: 0, order: [] }

/* 그리기 도구. 이름은 라이브러리의 오버레이 이름이고, 사각형만 이 앱이 등록합니다. */
const DRAW_TOOLS = [
  { name: 'segment', label: '추세선', icon: '╱' },
  { name: 'horizontalStraightLine', label: '수평선', icon: '─' },
  { name: 'rect', label: '사각형', icon: '▭' },
  { name: 'fibonacciLine', label: '피보나치', icon: '☰' },
]

interface Props {
  /** 두 칸의 종목. 둘째는 두 칸을 켜야 생깁니다. **둘째가 `null` 이면** 그 칸은
   *  「종목을 고르세요」만 서는 빈 칸입니다 — 담아 둔 종목이 목록에서 사라졌거나
   *  아직 고르지 않은 때입니다.
   *  시장은 이 종목들이 압니다 — 화면의 시장 범위는 여기까지 안 내려옵니다. */
  quotes: [Quote, Quote | null]
  /** 칸마다의 봉 종류·지표 구성. 종목은 `quotes` 가 이미 풀어 줍니다. */
  slots: [SlotState, SlotState]
  onSlotChange: (slot: 0 | 1, patch: Partial<SlotState>) => void
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** 두 칸 보기가 켜져 있는지. 확대와 상관없습니다. */
  split: boolean
  /** 두 칸의 놓임. 없으면 위아래입니다. */
  orient?: Orient
  /** 주문 대상인 칸. */
  active: 0 | 1
  onActiveChange: (slot: 0 | 1) => void
  /** 칸의 종목을 바꿉니다. **넘기지 않으면 종목 배지를 누를 수 없습니다** — 실행이
   *  종목을 정하는 차트(전략 검증)가 그렇습니다. */
  onPickInstrument?: (slot: 0 | 1, item: InstrumentRef) => void
  /** 차트 위에 얹는 매매 표시. 전략 검증·진행이 넘깁니다 — 일반주문에서는
   *  비어 있어 차트가 지금과 똑같이 그려집니다. */
  tradeMarks?: TradeMark[]
  onMarkPick?: (mark: TradeMark, at: { left: number; top: number }) => void
  /** 공용 지표 구성 위에 **이 화면에서만** 덮는 지표들. 있으면 지표 단추로 바꾼
   *  것도 여기로만 가고 공용 구성은 저장하지 않습니다 — 전략 검증이 규칙의 지표를
   *  켜도 일반주문 차트의 지표가 그대로이게 하려는 것입니다. */
  indicatorLayer?: {
    patch: IndicatorSettings
    onChange: (name: string, next: IndicatorSetting) => void
    /** 아래 칸의 수·높이 바닥 규칙. 넘친 지표는 이 차트에 안 섭니다. */
    bottom?: BottomCap
    /** 도구줄 단추가 대신 가리킬 지표 — 이 화면에서 같은 이름의 다른 셈을 켤 때
     *  (`MACD` → 엔진 식 MACD). 층에 그 지표가 있을 때만 씁니다. */
    aliases?: Record<string, string>
    /** 겹친 지표 범례를 접을지와 그 기억. */
    legendFold?: LegendFold
  }
  /** 두 칸에서 그리기 띠를 켜 두었는지와 그것을 바꾸는 함수. **바꾸는 함수를 넘기지
   *  않으면 「✎ 그리기」 단추가 없습니다** — 그 화면은 확대에서만 그립니다. */
  drawTools?: boolean
  onDrawToolsChange?: (on: boolean) => void
}

export function ChartPanel({
  quotes,
  slots,
  onSlotChange,
  expanded,
  onExpandedChange,
  split,
  orient = 'stack',
  active,
  onActiveChange,
  onPickInstrument,
  tradeMarks,
  onMarkPick,
  indicatorLayer,
  drawTools = false,
  onDrawToolsChange,
}: Props) {
  /* 지표 설정. 사용자가 고른 것이라 다음에 열어도 그대로입니다. */
  const [storedSettings, storeSettings] = useUiState<unknown>(SETTINGS_KEY, null)
  const [settings, setSettings] = useState<IndicatorSettings>(() => {
    /* 옛 형식의 저장값에는 이동평균 기간만 따로 있습니다. 새 설정이 없을 때만 그 값을
       가져옵니다 — 사용자가 고른 기간이 업데이트로 사라지면 안 됩니다. */
    const base = normalizeSettings(storedSettings)
    if (storedSettings === null) {
      try {
        const legacy = JSON.parse(localStorage.getItem('nh.chart.ma') ?? 'null') as unknown
        if (Array.isArray(legacy) && legacy.length > 0 && legacy.every((v) => typeof v === 'number')) {
          const ma = base.MA
          const lines = legacy.map((_, i) => ma.lines[i] ?? ma.lines[ma.lines.length - 1])
          base.MA = { ...ma, params: legacy, lines }
        }
      } catch {
        // 옛 값을 못 읽으면 기본으로 갑니다.
      }
    }
    return base
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  /* 두 칸에서 「✎ 그리기」 단추가 서는지. 그 단추를 넘겨받은 화면에서만 섭니다. */
  const canToggleDraw = split && onDrawToolsChange !== undefined
  /* 카드가 좁으면(`NARROW_CARD` 미만) 지표 단추 다섯을 「지표 N ▾」 하나로 접습니다.
     「✎」가 함께 서면 도구 줄이 그만큼 길어 더 넓은 카드에서부터 접습니다.
     그 목록이 열렸는지도 여기서 듭니다 — 카드가 다시 넓어지면 목록은 닫습니다. */
  const [watchWidth, folded] = useNarrowCard(canToggleDraw ? NARROW_CARD_WITH_DRAW : NARROW_CARD)
  /* 「✎ 그리기」의 글자까지 들어가는 카드인지. 좁으면 그림만 남깁니다. */
  const [watchDrawLabel, drawIconOnly] = useNarrowCard(DRAW_LABEL_CARD)
  /* 「✎」까지 선 도구 줄이 단추 사이를 줄여야 들어가는 카드인지. */
  const [watchControls, tightControls] = useNarrowCard(TIGHT_DRAW_CARD)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!folded) setMenuOpen(false)
  }, [folded])
  /* 아래 칸 규칙 때문에 차트에 못 선 지표. 칸마다 따로 듭니다 — 도구 줄은 대상
     칸의 것만 보이는데, 대상이 바뀌는 순간 그 칸이 다시 알려 주지 않아도 바로
     맞는 까닭이 서야 합니다. 도구줄 단추가 까닭을 답니다. */
  const [overflow, setOverflow] = useState<[string[], string[]]>([[], []])
  const reportOverflow = useCallback(
    (slot: 0 | 1) => (names: string[]) =>
      setOverflow((prev) => (slot === 0 ? [names, prev[1]] : [prev[0], names])),
    [],
  )
  /* 고른 그리기 도구. 하나를 그리고 나면 풀립니다. */
  const [tool, setTool] = useState<string | null>(null)
  /* 올릴 때마다 대상 칸의 도형이 모두 지워집니다. */
  const [clear, setClear] = useState<[number, number]>([0, 0])
  /* 어느 칸에서든 도형이 바뀌면 올라갑니다. 두 칸이 같은 종목이면 다른 칸도
     저장소에서 다시 읽습니다. */
  const [drawVersion, setDrawVersion] = useState(0)
  /* 같은 종목인 두 칸의 스크롤·확대를 맞추는 허브. 패널이 사는 동안 하나입니다. */
  const syncRef = useRef(new SyncHub())

  const second = quotes[1]
  /* 두 칸이 서는지. 확대와 상관없습니다 — 두 칸을 켜 두면 축소한 카드 안에서도
     두 칸이 나란히 섭니다. */
  const showSplit = split
  /* 지금 보이는 칸 중 도구 줄이 다루는 칸. 두 칸이면 주문 대상, 한 칸이면
     그 한 칸입니다. 봉 종류·지표 단추는 이 칸의 것을 보여 주고 이 칸만 바꿉니다.
     둘째 칸이 비어 있으면(종목이 없으면) 그 칸은 대상이 될 수 없어 첫째입니다. */
  const shownSlot: 0 | 1 = showSplit && second ? active : 0
  /* 그리기 띠가 서는지. 확대에서는 늘 서고, 두 칸에서는 「✎ 그리기」로 켜 두었을 때도
     섭니다. 한 칸은 확대에서만입니다 — 한 칸 일반 화면의 차트는 선을 그릴 만큼 넓지
     않고, 띠가 그 자리를 더 먹습니다. */
  const showDraw = expanded || (canToggleDraw && drawTools)

  /* 칸 하나가 받는 높이. 차트 자리(`.chart-stage`)의 **보이는** 높이이고, 위아래
     두 칸이면 그 반입니다(좌우 두 칸과 한 칸은 그대로). 칸이 줄어도 차트 자리는
     카드가 정하는 대로라 이 값은 되먹임 없이 그대로입니다. 이 높이가 표준 칸
     바닥보다 낮거나 펼친 범례가 봉 칸에 안 들어가면 머리 범례를 한 줄로 접습니다
     (`ChartView`). 지표 층을 넘기는 화면(전략 검증)은 재지 않습니다 — 그 차트의
     범례는 지표 수로 따로 접힙니다. */
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageHeight, setStageHeight] = useState(0)
  const watchStage = !indicatorLayer
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!watchStage || !stage) {
      setStageHeight(0)
      return
    }
    const measure = () => setStageHeight(stage.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [watchStage])
  const paneRoom =
    watchStage && stageHeight > 0
      ? showSplit && orient === 'stack'
        ? (stageHeight - PANES_GAP) / 2
        : stageHeight
      : null

  /* 칸의 지표 구성. 두 칸에서는 칸마다 따로이고, 아직 갈라지지 않은 칸은 한 칸
     모드의 구성을 그대로 봅니다 — 처음 켤 때 둘째 칸이 첫째와 같게 시작하는
     이유입니다. 한 칸 모드는 늘 공용 구성입니다. */
  /* 덮는 층을 얹은 구성. 같은 참조를 지켜야 차트가 지표를 다시 세우지 않습니다. */
  const layerPatch = indicatorLayer?.patch
  const layered = useMemo(
    () => (layerPatch ? { ...settings, ...layerPatch } : null),
    [settings, layerPatch],
  )
  const settingsFor = (slot: 0 | 1): IndicatorSettings =>
    layered
      ? layered
      : showSplit
        ? (slots[slot].indicators ?? settings)
        : settings
  const spanFor = (slot: 0 | 1): Span => slots[slot].span

  const updateSetting = (slot: 0 | 1, name: string, next: IndicatorSetting) => {
    /* 덮는 층이 있으면 그 층만 고칩니다 — 공용 구성은 안 바뀌고 저장도 안 합니다. */
    if (indicatorLayer) {
      indicatorLayer.onChange(name, next)
      return
    }
    const all = { ...settingsFor(slot), [name]: next }
    if (showSplit) {
      onSlotChange(slot, { indicators: all })
      return
    }
    setSettings(all)
    storeSettings(all)
  }

  const activeSettings = settingsFor(shownSlot)

  /* Esc — 팝오버가 열려 있으면 팝오버가 받습니다. 그다음이 그리기 도구,
     마지막이 확대 복귀입니다. 한 번에 하나만 닫힙니다. */
  useEffect(() => {
    if (settingsOpen || menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (tool) {
        setTool(null)
        return
      }
      if (expanded) onExpandedChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [settingsOpen, menuOpen, tool, expanded, onExpandedChange])

  /* 그리던 도구는 그리기 띠가 사라지면 풉니다 — 띠가 없는데 도구가 남아 있으면
     차트를 누를 때마다 보이지 않는 도구로 선이 그어집니다. */
  useEffect(() => {
    if (!showDraw) setTool(null)
  }, [showDraw])

  const toggle = (name: string) =>
    updateSetting(shownSlot, name, { ...activeSettings[name], on: !activeSettings[name].on })

  /* 아래 칸 규칙. 이 화면이 규칙을 넘기면(전략 검증) 그것을 쓰고, 아니면 두 칸일
     때만 칸마다 하나까지입니다. 규칙 때문에 못 선 지표에는 그 까닭을 답니다. */
  const bottomCap = indicatorLayer?.bottom ?? (showSplit ? SPLIT_BOTTOM : undefined)
  const overflowNote = indicatorLayer?.bottom
    ? '아래 칸은 셋까지 — 조건 표에서 값을 봅니다'
    : '두 칸에서는 아래 지표 칸이 하나까지입니다 — 한 칸으로 돌아가면 다시 섭니다'
  const shownOverflow = overflow[shownSlot]

  /* 도구 줄의 지표. 펼친 단추 줄과 접힌 목록이 같은 한 벌을 씁니다. */
  const quickItems: IndicatorMenuItem[] = QUICK_INDICATORS.map((name) => {
    /* 이 화면이 같은 이름의 다른 셈을 켰으면(검증 차트의 엔진 식 MACD) 단추는
       그 지표를 가리킵니다 — 켜져 있는데 단추가 꺼진 꼴이면 둘이 다른 말을 합니다. */
    const alias = indicatorLayer?.aliases?.[name]
    const target = alias && activeSettings[alias] ? alias : name
    return {
      name,
      target,
      label: INDICATOR_DEFS.find((def) => def.name === name)?.label ?? name,
      on: activeSettings[target].on,
      note: shownOverflow.includes(target) ? overflowNote : undefined,
    }
  })

  /* 「모두 지우기」는 도구 줄이 다루는 칸(주문 대상)의 도형을 지웁니다. */
  const clearDrawings = () => {
    setTool(null)
    setClear((prev) => (shownSlot === 0 ? [prev[0] + 1, prev[1]] : [prev[0], prev[1] + 1]))
  }

  const view = (slot: 0 | 1, quote: Quote) => (
    <ChartView
      key={slot}
      slot={slot}
      quote={quote}
      span={spanFor(slot)}
      settings={settingsFor(slot)}
      onSettingChange={(name, next) => updateSetting(slot, name, next)}
      expanded={expanded}
      split={showSplit}
      active={!showSplit || shownSlot === slot}
      onActivate={() => onActiveChange(slot)}
      onPickInstrument={onPickInstrument ? (item) => onPickInstrument(slot, item) : undefined}
      tool={tool}
      onToolDone={() => setTool(null)}
      clearSignal={clear[slot]}
      drawVersion={drawVersion}
      onDrawingsChange={() => setDrawVersion((v) => v + 1)}
      tradeMarks={tradeMarks}
      onMarkPick={onMarkPick}
      sync={syncRef.current}
      bottomCap={bottomCap}
      legendFold={indicatorLayer?.legendFold}
      onBottomOverflow={reportOverflow(slot)}
      paneRoom={paneRoom}
    />
  )

  return (
    <div className={`chart-panel${expanded ? ' is-expanded' : ''}`} ref={watchWidth}>
      <div
        className="chart-controls"
        ref={watchControls}
        data-tight={canToggleDraw && tightControls ? 'true' : undefined}
      >
        {/* 봉 종류는 칸마다 따로입니다. 이 토글은 도구 줄이 다루는 칸(주문 대상)의
            것을 보여 주고 그 칸만 바꿉니다. */}
        <div className="seg" role="group" aria-label="기간">
          {PERIODS.map((span) => (
            <button
              key={span}
              type="button"
              className="seg-item"
              aria-pressed={spanFor(shownSlot) === span}
              onClick={() => onSlotChange(shownSlot, { span })}
            >
              {SPAN_LABEL[span]}
            </button>
          ))}
        </div>

        {/* 지표는 켜고 끄는 것이라 알약이 아니라 각자 눌리는 단추입니다 —
            세그먼트는 「여럿 중 하나」이고 이것은 「여럿 중 여럿」입니다. */}
        <div className="chart-indicators" role="group" aria-label="지표">
          {folded ? (
            <IndicatorMenu items={quickItems} open={menuOpen} onOpenChange={setMenuOpen} onToggle={toggle} />
          ) : (
            quickItems.map((item) => (
              <button
                key={item.name}
                type="button"
                className="btn btn-quiet chart-indicator"
                aria-pressed={item.on}
                title={item.note}
                onClick={() => toggle(item.target)}
              >
                {item.name}
              </button>
            ))
          )}

          <div className="chart-settings">
            <button
              type="button"
              className="btn btn-quiet chart-indicator"
              aria-label="지표 설정"
              aria-expanded={settingsOpen}
              data-tip="지표 설정"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              ⚙
            </button>
            {settingsOpen && (
              <IndicatorSettingsPopover
                settings={activeSettings}
                onChange={(name, next) => updateSetting(shownSlot, name, next)}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        </div>

        {/* 두 칸에서 그리기 띠를 켜고 끕니다. 고른 것은 남습니다. 확대에서는 띠가 늘
            서 있어 눌린 채 잠깁니다. 카드가 좁으면 그림 글자만 남깁니다. */}
        {canToggleDraw && (
          <button
            ref={watchDrawLabel}
            type="button"
            className="btn btn-quiet chart-indicator chart-draw-toggle"
            aria-pressed={showDraw}
            aria-label={drawIconOnly ? '그리기' : undefined}
            data-tip={drawIconOnly && !expanded ? '그리기' : undefined}
            title={expanded ? '확대에서는 그리기 도구가 늘 켜집니다' : undefined}
            disabled={expanded}
            onClick={() => onDrawToolsChange?.(!drawTools)}
          >
            {drawIconOnly ? '✎' : '✎ 그리기'}
          </button>
        )}
      </div>

      <div className="chart-stage" ref={stageRef}>
        {/* 그리기 도구. 두 칸일 때는 주문 대상인 칸에 그려집니다. */}
        {showDraw && (
          <div className="draw-tools" role="toolbar" aria-label="그리기">
            {DRAW_TOOLS.map((item) => (
              <button
                key={item.name}
                type="button"
                className="draw-tool"
                aria-label={item.label}
                aria-pressed={tool === item.name}
                data-tip={item.label}
                onClick={() => setTool((current) => (current === item.name ? null : item.name))}
              >
                {item.icon}
              </button>
            ))}
            <span className="draw-tools-gap" />
            <button
              type="button"
              className="draw-tool"
              aria-label="그린 것 모두 지우기"
              data-tip="모두 지우기"
              onClick={clearDrawings}
            >
              🗑
            </button>
          </div>
        )}

        <div className={`chart-panes${showSplit ? ` is-split is-${orient}` : ''}`}>
          {/* 한 칸이면 첫째 칸만 섭니다. 둘째 칸의 종목·봉 종류·지표는 기억되어
              두 칸을 다시 켜면 그대로 돌아옵니다. */}
          {view(0, quotes[0])}
          {showSplit &&
            (second ? (
              view(1, second)
            ) : (
              <EmptySlot
                near={quotes[0].code}
                onPick={onPickInstrument ? (item) => onPickInstrument(1, item) : undefined}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

/* 종목이 없는 둘째 칸. 담아 둔 종목이 목록에서 사라졌거나(만기) 아직 고르지 않은
   때입니다. 첫째 칸의 종목을 대신 그리지 않습니다 — 그러면 같은 차트가 두 번
   서서 둘째 칸이 무엇을 보는지 읽을 수 없습니다. 배지 하나만 서고, 눌러서 이
   칸의 종목을 고릅니다. 고르는 판은 첫째 칸 종목(`near`)의 다른 만기를 먼저
   보입니다 — 두 칸의 흔한 쓰임이 같은 품목의 다른 만기입니다. 종목이 없는 칸은
   주문 대상이 되지 않습니다. */
function EmptySlot({ near, onPick }: { near: string; onPick?: (item: InstrumentRef) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="chart-box is-idle is-empty">
      {/* 빈 칸 가운데의 차례. 배지를 누를 수 있을 때만 적습니다 — 누를 수 없는
          배지를 누르라고 적으면 할 수 없는 일을 시키는 셈입니다. */}
      {onPick && (
        <p className="chart-pending-note is-two">
          <span className="chart-pending-lead">위 배지를 눌러</span>
          <span>이 칸에 볼 종목을 고르세요</span>
        </p>
      )}
      {onPick ? (
        <button
          type="button"
          className="chart-badge chart-badge-empty"
          aria-expanded={open}
          aria-label="둘째 칸 — 종목을 고르세요"
          onClick={() => setOpen((value) => !value)}
        >
          종목을 고르세요
          <span className="chart-badge-chev" aria-hidden="true">
            ▾
          </span>
        </button>
      ) : (
        <span className="chart-badge chart-badge-empty is-static">종목을 고르세요</span>
      )}
      {open && onPick && (
        <InstrumentPicker
          current={near}
          onPick={(item) => {
            setOpen(false)
            onPick(item)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
