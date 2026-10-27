import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { MarketContext, OpenIntent, ProductKind } from '../../lib/types'
import { OrderConfirm } from './OrderConfirm'
import { defaultInstrumentCode, resolve, type Instrument } from '../../data/instruments'
import type { InstrumentRef } from '../../lib/InstrumentPicker'
import { SPLIT_KEY, defaultSplit, normalizeSplit, type SlotState, type SplitState } from './chartSlots'
import { domesticContextOf, subscribeSession } from '../../data/session'
import { marketConfigured, useEnvironment } from '../../data/environment'
import { useUiState } from '../../data/uiState'
import { noteTradeNotice } from '../../data/alerts'
import { useMasterStatus } from '../../lib/useMaster'
import { PanelEditor } from './PanelEditor'
import { CARD_LABEL } from './tradeLayout'
import { useOptionChainPick } from './useOptionChainPick'
import { useTradeQuotes } from './useTradeQuotes'
import { useTradeAccount } from './useTradeAccount'
import { useTradeGrid } from './useTradeGrid'
import { useOrderTicket } from './useOrderTicket'
import {
  renderHeader,
  renderResizers,
  renderChartCard,
  renderBottomCards,
  renderBookCard,
  renderTicksCard,
  renderFormCard,
} from './TradeCards'
import { type Tab, refFor } from './tradeScreenUtils'
import './trade.css'
import './InstrumentHeader.css'
import './ChartView.css'
import './OrderForm.css'

/* 일반주문 — 가장 오래 머무는 화면.
 *
 * 세 열입니다. 왼쪽이 차트·품목정보와 그 아래 주문체결상세·미결제약정,
 * 가운데가 호가와 시세체결, 오른쪽이 주문 폼입니다.
 *
 * 폭은 호가 200 과 주문 폼 280 이 고정이고 왼쪽 열이 남는 폭을 다 씁니다.
 * 경계선을 끌어 조절하지 않습니다 — 고정 둘이 정해져 있으면 왼쪽 폭도 이미
 * 정해진 값이라, 끌 수 있게 두면 창을 넓혀도 안 따라오는 자리가 생깁니다.
 *
 * 호가가 가운데에서 전체 높이를 씁니다. 위아래 10단계에 현재가 줄까지 21행이라
 * 이 화면의 세로 예산을 호가가 정하고, 나머지가 그 옆에서 맞춰 섭니다.
 * 하단 탭을 화면 전체 폭이 아니라 왼쪽 열 안에 두는 것도 그 때문입니다.
 *
 * 호가·주문은 탭이 바뀌어도 그대로 있습니다. 호가를 눌러 주문 가격을 넣는
 * 것이 이 화면의 기본 동작이라 사이에 다른 것이 끼면 손이 끊깁니다.
 *
 * 선물과 옵션은 같은 화면의 두 입구입니다. 옵션은 행사가 축이 하나 더 있어
 * 종목이 바로 정해지지 않으므로, 왼쪽 열 첫 탭에 체인이 서고 거기서 고른
 * 칸이 헤더·호가·주문의 종목이 됩니다.
 */

/* 밖에서 연 것 가운데 이미 들인 차례(`openedSeq`). 이 화면은 탭을 옮길 때마다
   새로 서므로, 화면 안에 두면 돌아올 때마다 지난번에 연 것을 또 들입니다. */
let takenOpenSeq = 0
let takenIntentSeq = 0

interface Props {
  /** 검색과 카탈로그가 기본으로 훑을 범위. **이 화면의 종목은 여기서 안 나옵니다** —
   *  종목은 코드가 정하고, 시장도 코드에서 나옵니다. */
  context: MarketContext
  /** 밖에서 고른 종목의 코드. 홈·종목 화면·최근 본·검색이 모두 이 하나로 들어옵니다. */
  openedCode: string | null
  /** 무엇을 하러 왔는가. 없으면 새 주문입니다. */
  openedIntent?: OpenIntent | null
  /** 밖에서 연 횟수. 열 때마다 오르고, 같은 코드를 다시 열어도 오릅니다. */
  openedSeq?: number
  /** 못 푸는 코드를 만났을 때. 화면 위 한 줄로 이유가 섭니다. */
  onOpenFailed: (code: string) => void
  /** 설정 창 열기. 그 시장의 인증 정보가 없을 때 헤더가 이 길을 냅니다. */
  onOpenSettings?: () => void
}

export function TradeScreen({
  context,
  openedCode,
  openedIntent,
  openedSeq = 0,
  onOpenFailed,
  onOpenSettings,
}: Props) {
  /* 2분할 상태 — 켜져 있는지, 어느 칸이 주문 대상인지, 칸마다 종목·봉·지표.
     남깁니다: 축소했다 다시 확대해도, 앱을 껐다 켜도 두 칸이 그대로 돌아옵니다.
     저장된 것은 예전 모양일 수 있어 읽을 때 정규화합니다. */
  const [storedSplit, storeSplit] = useUiState<unknown>(SPLIT_KEY, defaultSplit())
  const splitState = useMemo(() => normalizeSplit(storedSplit), [storedSplit])

  /* 이 화면이 보고 있는 종목 — **코드 하나**입니다.
     품목·만기·선물인지 옵션인지·어느 시장인지가 전부 여기서 풀려 나오므로,
     화면이 그것들을 따로 기억하지 않습니다. 기억이 여럿이면 서로 어긋나고,
     어긋나면 헤더가 말하는 종목과 주문 단추가 내는 종목이 갈립니다. */
  const [selectedCode, setSelectedCode] = useState<string | null>(() => {
    /* 두 칸 보기면 마지막으로 첫째 칸에 두었던 종목으로 엽니다. 다른 탭에 갔다
       오거나 앱을 다시 켜도 첫째 칸이 그대로입니다. 그 종목이 목록에 없으면
       (만기) 아래 차례로 넘어갑니다. */
    const first = splitState.split ? (splitState.slots[0].instrument?.code ?? null) : null
    if (first && resolve(first)) return first
    /* 밖에서 고르고 들어오지 않았으면 이 시장의 기본 종목으로 엽니다. 코드를
       비워 두면 화면은 기본 종목의 값을 보여주면서 만기 목록만 비어, 어느
       만기를 보고 있는지가 헤더에서 사라집니다. */
    return openedCode ?? defaultInstrumentCode(context === 'overseas' ? 'overseas' : 'domestic')
  })

  const [tab, setTab] = useState<Tab>('차트')

  /* 이 화면에서 사용자가 첫째 칸 종목을 바꿨는지. 바꾸기 전에는 남겨 둔 첫째 칸
     종목이 우선입니다(아래 종목 목록 도착 효과). */
  const firstChangedRef = useRef(false)
  const changeFirst = (code: string) => {
    firstChangedRef.current = true
    setSelectedCode(code)
  }

  /* 두 칸 보기 상태를 남깁니다. **첫째 칸 종목도 함께 남깁니다** — 그래야 다시
     들어왔을 때 첫째 칸이 그대로입니다. 남기는 때는 사용자가 첫째 칸을 바꿨을 때
     (`first`)와 두 칸을 켤 때뿐입니다. 봉 종류·지표를 바꾸는 쓰기에서까지 화면의
     첫째 칸으로 덮으면, 종목 목록을 받기 전이라 기본 종목이 서 있던 동안 남겨 둔
     종목이 지워집니다. */
  const setSplitState = (next: SplitState, first?: string) => {
    const code = first ?? (next.split && !splitState.split ? selectedCode : null)
    const ref = next.split && code && next.slots[0].instrument?.code !== code ? refFor(code) : null
    storeSplit(ref ? { ...next, slots: [{ ...next.slots[0], instrument: ref }, next.slots[1]] } : next)
  }
  const patchSlot = (slot: 0 | 1, patch: Partial<SlotState>) => {
    const slots: [SlotState, SlotState] = [{ ...splitState.slots[0] }, { ...splitState.slots[1] }]
    slots[slot] = { ...slots[slot], ...patch }
    setSplitState({ ...splitState, slots })
  }
  /* 코드를 종목으로 풉니다. 모르는 코드(상장이 끝난 종목)면 `null` 이고, 그때는
     이 시장의 기본 종목을 봅니다.
     **스프레드도 이 경로로 옵니다** — 검색·종목 화면이 스프레드를 이 화면으로
     보냅니다. 값은 선물과 같은 자리에 서고, 주문만 아직 막혀 있습니다.
     종목 목록을 받는 중에는 어떤 코드도 풀리지 않습니다. 목록이 오면 다시 풉니다 —
     그러지 않으면 받는 동안 풀지 못한 칸이 목록이 온 뒤에도 빈 칸으로 남습니다. */
  const master = useMasterStatus()
  const selected = useMemo(
    () => (selectedCode ? resolve(selectedCode) : null),
    // 목록이 도착하면 같은 코드라도 다시 풉니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedCode, master.status],
  )
  /* 그 종목의 시장에 인증 정보가 없는지. 그러면 그 종목의 시세·호가·체인·세션을
     **묻지 않습니다** — 빈 키로 물으면 토큰 발급부터 실패해 오류만 쌓입니다. 헤더가
     까닭을 한 번 말하고 주문 폼이 잠깁니다. 설정이나 접속 환경을 아직 모르면
     「없다」고 하지 않습니다 — 그때는 환경을 확인하는 중이라는 말이 먼저 섭니다. */
  const environment = useEnvironment()
  const credentialsMissing = (item: Instrument | null): boolean => {
    const view = environment.config
    const env = view?.active_environment ?? null
    return item !== null && view !== null && env !== null && !marketConfigured(view, env, item.market)
  }
  /* 시장은 **종목이** 정하고, 낮이냐 밤이냐는 **서버가 답한 세션**이 정합니다 —
     같은 종목을 낮에 보든 밤에 보든 품목과 만기는 같고, 세션은 화면의 시계가
     아니라 서버의 판정입니다(`data/session.ts`). 세션이 바뀌면 이 값이 바뀌어
     실시간 선언과 조회가 야간 것으로 다시 나가되, **주문 폼은 그대로입니다** —
     같은 계좌입니다. 화면의 `context` 는 검색·카탈로그의 기본 범위로만 남습니다. */
  useSyncExternalStore(
    subscribeSession,
    () =>
      `${domesticContextOf(selectedCode ?? '')}|${domesticContextOf(splitState.slots[1].instrument?.code ?? '')}`,
    () => '',
  )
  const contextOf = (item: Instrument | null): MarketContext =>
    item?.market === 'overseas'
      ? 'overseas'
      : item
        ? domesticContextOf(item.contract?.code ?? '')
        : context

  /* 둘째 차트 칸의 종목. 첫째 칸과 **같은 길로** 풉니다 — 코드에서 신원을 얻고
     신원에서 시세를 얻습니다. 칸마다 다른 길로 만들면 한쪽만 고쳐지는 자리가
     생깁니다. */
  const secondCode = splitState.slots[1].instrument?.code ?? null
  const secondSelected = useMemo(
    () => (secondCode ? resolve(secondCode) : null),
    // 목록이 도착하면 같은 코드라도 다시 풉니다(첫째 칸과 같은 까닭).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [secondCode, master.status],
  )

  /* 헤더·호가·주문 폼이 보는 종목 = **주문 대상인 칸**의 종목. 2분할에서 둘째
     칸이 대상이면 그 종목이고, 그 밖에는 화면의 종목입니다.

     **옵션의 축(콜/풋·행사가)도 여기서부터 나옵니다.** 아래 체인·시세·헤더가
     모두 이 값을 기준으로 서므로, 첫째 칸을 기준으로 두면 둘째 칸이 주문
     대상인 옵션일 때 헤더의 두 셀렉트만 첫째 칸을 가리킵니다. */
  const secondIsSubject = splitState.split && splitState.active === 1 && secondSelected !== null
  const subject = secondIsSubject ? secondSelected : selected

  /* 주문 대상이던 둘째 칸의 종목이 목록에서 사라졌으면(만기) 대상을 첫째로 옮기고
     한 줄로 알립니다. 둘째 칸은 「종목을 고르세요」 빈 칸으로 남습니다. 대상이
     사용자 손 없이 바뀌는 자리라 말없이 옮기지 않습니다. 목록을 아직 받는 중이면
     없는 것인지 모르는 것인지 가를 수 없어 기다립니다. */
  const secondMissing =
    master.status === 'ready' && splitState.split && splitState.active === 1 && secondSelected === null
  useEffect(() => {
    if (!secondMissing) return
    setSplitState({ ...splitState, active: 0 })
    noteTradeNotice({
      label: '주문 대상 바뀜',
      text: '둘째 칸의 종목이 종목 목록에 없어 주문 대상을 첫째 칸으로 옮겼습니다',
      urgent: false,
      mergeKey: 'trade|split-target',
    })
    // 사라진 순간 한 번만 옮깁니다. 저장 함수는 매번 새로 만들어집니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondMissing])
  /* 주문 대상 종목의 시장. 다른 시장의 종목을 차트 칸에 올려 주문 대상으로 삼으면
     헤더의 장 표시·주문유형·만기 목록·포지션 목록이 그 시장을 따라야 합니다 —
     화면의 시장 범위는 「어디서 시작했는가」이고, 주문은 「지금 무엇을 보는가」입니다. */
  const activeContext = contextOf(subject)
  const activeOverseas = activeContext === 'overseas'

  const {
    pickedSide,
    setPickedSide,
    pickedStrike,
    setPickedStrike,
    setPreset,
    chainSide,
    setChainSide,
    optionProduct,
    chainArgs,
    chainOwner,
    chain,
    chainRows,
    strikes,
    futuresPrice,
    atm,
    strikeDecimals,
    pickedLeg,
    pickedLabel,
    pickFromChain,
    pickFromCode,
    chainPickedCode,
    pendingAxis,
    presets,
    activePreset,
  } = useOptionChainPick({
    subject,
    contextOf,
    context,
    credentialsMissing,
    tab,
    activeOverseas,
  })

  const {
    quote,
    secondQuote,
    shownEntry,
    shownBuilt,
    shownUnasked,
    shownFailure,
    bookFailure,
    priceKnown,
    orderBlocked,
    environmentKnown,
    environmentWhy,
    shownQuote,
    sessionCode,
    credentialsWhy,
    sessionHeld,
    sessionWhy,
    legsLine,
    book,
    axisPending,
    ticks,
    bestBid,
    bestAsk,
    staleAt,
    quoteStaleAt,
    bookFailed,
    ticksFailed,
    failedExchange,
    listening,
    tapeSince,
    ordersSince,
    months,
  } = useTradeQuotes({
    selected,
    secondSelected,
    secondIsSubject,
    subject,
    splitState,
    contextOf,
    credentialsMissing,
    environment,
    activeContext,
    pickedLeg,
    pickedLabel,
    pendingAxis,
  })

  const {
    accountMarket,
    orderList,
    positionSides,
    positionList,
    receivedSides,
    positionNotes,
    orders,
    fills,
    positions,
  } = useTradeAccount({
    activeOverseas,
    shownQuote,
  })

  /* 선물이냐 옵션이냐도 **주문 대상 종목**이 정합니다. 헤더의 이름·시세·만기가
     그 종목을 말하는데 여기만 화면의 첫 종목을 보면, 선물을 주문하는 화면에
     콜풋·행사가 컨트롤이 서고 그것을 돌려도 아무것도 안 바뀝니다. */
  const kind: ProductKind = subject?.kind ?? 'futures'

  const {
    setSlotTabs,
    editorOpen,
    setEditorOpen,
    chartExpanded,
    setChartExpanded,
    storeLayout,
    layout,
    dragging,
    pending,
    resizeHint,
    splitRef,
    placeChip,
    startColumnResize,
    startRowResize,
    subjectShown,
    activeTab,
    setBottomOpen,
    expandedChart,
    isDefaultLayout,
    slotsUsed,
    slotOfCard,
    chartExpandButton,
    cardProps,
    chartTabStrip,
    chartTabsInBody,
    cardHead,
    collapsedFor,
    cardShown,
    bottomHead,
    colSplits,
    rowSplits,
    gridStyle,
    splitView,
  } = useTradeGrid({
    splitState,
    kind,
    tab,
    setTab,
    orders,
    fills,
    positions,
    ordersSince,
  })

  /* 종목을 이 화면으로 가져오는 단 하나의 길. 어디서 고르든(만기 드롭다운·
     청산·정정) 여기로 들어오고, 넘기는 것은 **코드 하나**입니다. 선물인지
     옵션인지, 어느 행사가인지는 코드가 말합니다.
     바꾸는 것은 「화면의 종목」이 아니라 **「주문 대상 칸의 종목」**입니다 —
     2분할에서 둘째 칸이 주문 대상인데 첫 칸을 바꾸면, 주문 폼은 새 종목이고
     헤더·호가·차트는 둘째 칸 그대로여서 내는 것과 보는 것이 갈립니다. */
  const openCode = (next: string) => {
    const item = resolve(next)
    /* 못 푸는 코드로는 화면을 옮기지 않고 이유를 말합니다. 그냥 옮기면 헤더가
       종목명과 만기 목록을 잃은 반쪽 화면이 서는데, 무엇이 잘못됐는지 알 수
       없다는 점에서 아무 일도 안 일어나는 것보다 나쁩니다. */
    if (!item) {
      onOpenFailed(next)
      return
    }
    if (secondIsSubject) {
      const ref = refFor(next)
      /* 못 푸는 코드면 칸을 비우지 않고 그대로 둡니다 — 고른 것이 안 열리는
         것보다 엉뚱한 칸이 비는 것이 나쁩니다. */
      if (ref) patchSlot(1, { instrument: ref })
    } else {
      changeFirst(next)
      if (splitState.split) setSplitState(splitState, next)
    }
    /* 고른 축은 **주문 대상 종목**에 딸린 것이라 그 종목이 바뀌면 새 코드에서
       다시 읽습니다. 옵션 코드면 콜/풋과 행사가가 그 안에 있고, 선물이나 아직
       행사가가 없는 코드면 비어 옵니다 — 어느 칸이 대상이든 같은 길입니다. */
    pickFromCode(item)
    if (item?.kind === 'option') setTab('체인')
    else if (tab === '체인') setTab('차트')
  }

  /* 차트 배지에서 종목을 골랐을 때. **배지는 제 칸만 바꿉니다** — 주문 대상은
     옮기지 않습니다. 둘째 칸이 대상인데 첫째 칸 배지로 고른 종목이 둘째 칸에
     들어가면, 고른 칸과 바뀐 칸이 달라 무엇을 바꿨는지 알 수 없습니다. 고른 칸이
     주문 대상이면 옵션의 축도 그 종목의 것으로 다시 읽습니다. */
  const pickInstrument = (slot: 0 | 1, item: InstrumentRef) => {
    if (slot === 1) {
      patchSlot(1, { instrument: item })
      if (secondIsSubject) pickFromCode(resolve(item.code))
      return
    }
    if (secondIsSubject) {
      /* 대상이 아닌 첫째 칸만 바꿉니다. 헤더·호가·주문 폼은 둘째 칸 그대로입니다. */
      if (!resolve(item.code)) {
        onOpenFailed(item.code)
        return
      }
      changeFirst(item.code)
      setSplitState(splitState, item.code)
      return
    }
    openCode(item.code)
  }

  /* 밖에서 연 종목(최근 본·검색·홈·종목 화면·계좌의 청산·정정)을 들이는 길.
     한 칸이면 화면 안에서 고를 때와 같은 길(`openCode`)입니다.

     **두 칸이면 첫째 칸으로 들어가고 주문 대상은 첫째로 돌아옵니다.** 둘째 칸은
     사용자가 따로 골라 둔 것이라 그대로 둡니다. 이미 어느 칸에 떠 있는 종목이면
     칸은 건드리지 않고 그 칸을 주문 대상으로 삼습니다 — 같은 종목이 두 칸에
     서면 칸 하나가 쓸모없어집니다.

     두 칸에서 옵션을 열어도 탭은 그대로입니다. 차트로 두 칸을 보는 중이라,
     체인으로 넘기면 고른 종목이 어느 칸에 들어갔는지 안 보입니다. */
  const openFromOutside = (next: string) => {
    if (!splitState.split) {
      openCode(next)
      return
    }
    const item = resolve(next)
    if (!item) {
      onOpenFailed(next)
      return
    }
    /* 이미 주문 대상 칸에 떠 있으면 할 일이 없습니다. */
    if ((secondIsSubject ? secondCode : selectedCode) === next) return
    if (secondSelected !== null && secondCode === next) {
      setSplitState({ ...splitState, active: 1 })
    } else {
      changeFirst(next)
      setSplitState({ ...splitState, active: 0 }, next)
    }
    pickFromCode(item)
    if (item.kind !== 'option' && tab === '체인') setTab('차트')
  }

  const {
    side,
    chooseSide,
    releaseSystemSide,
    orderType,
    setOrderType,
    condition,
    setCondition,
    price,
    setPrice,
    stopPrice,
    setStopPrice,
    quantity,
    setQuantity,
    editing,
    setEditing,
    closing,
    setClosing,
    closePriceFrom,
    touchPrice,
    confirming,
    setConfirming,
    submitPaused,
    sending,
    orderResult,
    orderable,
    keepModeForRef,
    keepTypeForRef,
    startClosing,
    startEditing,
    askToSend,
    confirmSend,
    clearResult,
    orderableAsk,
    checkOrderable,
  } = useOrderTicket({
    shownQuote,
    priceKnown,
    shownBuilt,
    shownFailure,
    environment,
    environmentKnown,
    credentialsWhy,
    activeContext,
    activeOverseas,
    onOpenFailed,
    openCode,
  })

  /* 밖에서 종목을 고르고 들어온 경우(검색·최근 본·홈·종목 화면). 어떻게
     들이는지는 `openFromOutside` 가 정합니다.

     한 칸이면 화면이 새로 설 때와 들어온 코드가 바뀌었을 때 엽니다. 이미 연
     종목을 다시 열면 아무 일도 없습니다.

     두 칸이면 **새로 연 것만** 들입니다. 다른 탭에 갔다 돌아와 화면이 새로 설
     때 지난번에 연 종목을 또 들이면, 그 사이에 바꿔 둔 칸과 주문 대상이 덮입니다.
     대신 같은 종목을 다시 열어도 새로 연 것이라 그 종목이 있는 칸이 주문 대상이
     됩니다. */
  /* 남겨 둔 첫째 칸 종목은 종목 목록이 있어야 풀립니다. 목록을 받는 중에 이
     화면이 섰으면 첫째 칸은 일단 다른 종목으로 서므로, 목록이 오면 남겨 둔
     종목으로 돌립니다. 그사이 사용자가 첫째 칸을 바꿨으면 그대로 둡니다.
     돌리기만 하고 남기지는 않습니다 — 남겨 둔 값으로 돌아가는 것입니다. */
  const savedFirst = splitState.split ? (splitState.slots[0].instrument?.code ?? null) : null
  useEffect(() => {
    if (master.status !== 'ready' || firstChangedRef.current) return
    if (!savedFirst || savedFirst === selectedCode) return
    const item = resolve(savedFirst)
    if (!item) return
    setSelectedCode(savedFirst)
    if (!secondIsSubject) pickFromCode(item)
    // 목록이 오거나 남겨 둔 종목이 바뀔 때만 봅니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master.status, savedFirst])

  /* 종목 목록을 받는 중에 이 화면이 서면 기본 종목도 아직 정할 수 없어, 첫째 칸이
     종목 없이 섭니다. 목록이 오면 그때 이 시장의 기본 종목을 정합니다. 밖에서
     고르고 들어온 종목, 남겨 둔 첫째 칸 종목, 그사이 사용자가 고른 종목이 있으면
     그쪽이 먼저라 건드리지 않습니다. 남기지는 않습니다 — 처음부터 기본 종목으로
     열렸을 때와 같은 상태로 돌아가는 것입니다. */
  useEffect(() => {
    if (master.status !== 'ready' || firstChangedRef.current || selectedCode) return
    if (savedFirst && resolve(savedFirst)) return
    const code = defaultInstrumentCode(context === 'overseas' ? 'overseas' : 'domestic')
    if (code && resolve(code)) setSelectedCode(code)
    // 목록이 올 때만 봅니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master.status])

  const lastOpenedRef = useRef<string | null>(null)
  const ranSeqRef = useRef<number | null>(null)
  useEffect(() => {
    /* 같은 화면에서 같은 차례를 두 번 들이지 않습니다. */
    if (ranSeqRef.current === openedSeq) return
    ranSeqRef.current = openedSeq
    const fresh = openedSeq !== takenOpenSeq
    takenOpenSeq = openedSeq
    if (splitState.split) {
      lastOpenedRef.current = openedCode
      if (fresh) {
        if (openedCode) openFromOutside(openedCode)
      } else {
        /* 새로 연 것이 없으면 주문 대상의 옵션 축(콜/풋·행사가)만 그 종목에서
           다시 읽습니다. 화면이 새로 서면 축이 비어 있습니다. */
        pickFromCode(subject)
      }
      return
    }
    if (!openedCode || lastOpenedRef.current === openedCode) return
    lastOpenedRef.current = openedCode
    openCode(openedCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedSeq])

  /* 무엇을 하러 왔는지를 폼에 옮깁니다. 종목이 바뀌면 폼을 비우는 효과가
     먼저 도는데, 그 뒤에 이것이 다시 채웁니다 — 순서가 뒤집히면 채운 값이
     곧바로 지워집니다. */
  const intentSeqRef = useRef<number | null>(null)
  useEffect(() => {
    /* 두 칸이면 종목과 같이 **새로 연 것만** 옮깁니다. 돌아올 때마다 다시 채우면
       지난번 청산 폼이 다시 서고 주문 대상도 그 종목으로 돌아갑니다.
       이 화면이 이미 들인 차례는 다시 돌아도 들입니다 — 개발 모드는 화면을 세울
       때 효과를 두 번 돌리고, 그때 폼을 비우는 효과도 다시 돌아 채운 값을
       지웁니다. */
    const fresh = openedSeq !== takenIntentSeq || intentSeqRef.current === openedSeq
    takenIntentSeq = openedSeq
    if (fresh) intentSeqRef.current = openedSeq
    if (!openedIntent) return
    if (splitState.split && !fresh) return
    if (openedIntent.kind === 'close') {
      /* 두 칸을 확대해 보는 중이면 확대를 풉니다. 확대에서는 잔고·주문 내역
         카드가 숨어, 청산하러 온 포지션과 낸 주문이 어떻게 되는지 안 보입니다. */
      if (splitState.split && chartExpanded) setChartExpanded(false)
      startClosing(openedIntent.position, openFromOutside)
      return
    }
    const order = openedIntent.order
    /* 다른 종목의 주문을 정정하러 왔으면 **화면이 그 종목으로 옮겨 갑니다.**
       폼만 바뀌고 헤더·호가·차트가 그대로면 「주문 정정」 단추에 엉뚱한 종목
       이름이 붙습니다 — 다른 어긋남은 「보는 것이 틀리다」인데 이건 「내는 것이
       틀릴 수 있다」입니다. */
    if (!resolve(order.code)) {
      onOpenFailed(order.code)
      return
    }
    /* **수량을 모르는 주문은 못 고칩니다.** 서버가 그 칸을 안 준 줄이라, 폼을
       열면 몇 계약을 낼지 화면이 지어내게 됩니다. 목록 쪽에서 이미 단추를 안
       세우지만 되돌릴 수 없는 자리라 여기서 한 번 더 봅니다.

       가격은 비어 있어도 됩니다 — 시장가 주문은 주문가격이 없고, 그건 못 받은
       것이 아니라 그 주문에 없는 값입니다. */
    if (order.quantity === null) return
    keepModeForRef.current = order.code
    openFromOutside(order.code)
    startEditing(
      {
        id: order.id,
        side: order.side,
        orderType: order.orderType,
        /* 미체결 탭에서 온 주문은 아직 일하는 중입니다 — 끝났거나 거절된
           주문은 그 탭에 서지 않습니다. */
        progress: 'working',
        price: order.price,
        stopPrice: order.stopPrice,
        quantity: order.quantity,
        filled: order.filled,
        source: order.source,
        editable: true,
      },
      'amend',
      order.market === 'overseas',
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedIntent])

  /* 주문 대상의 시장이 바뀌면 주문유형·체결조건을 처음으로 돌립니다. 국내의
     조건부지정가는 해외에 없고 해외의 STOP 은 국내에 없어, 들고 넘어가면 없는
     유형이 골라진 채가 됩니다. 지정가는 양쪽에 다 있습니다. */
  useEffect(() => {
    /* 해외 정정·취소가 방금 원주문의 유형을 옮겨 둔 시장이면 그대로 둡니다. */
    const keep = keepTypeForRef.current
    keepTypeForRef.current = null
    if (keep === activeContext) return
    setOrderType('지정가')
    setCondition('FAS')
    setStopPrice(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContext])

  return (
    <div className="trade">
      {renderHeader({
        shownQuote,
        activeContext,
        shownFailure,
        onOpenSettings,
        priceKnown,
        quoteStaleAt,
        months,
        legsLine,
        kind,
        pickedSide,
        pickedStrike,
        strikes,
        strikeDecimals,
        openCode,
        setPickedSide,
        setPickedStrike,
        isDefaultLayout,
        storeLayout,
        setEditorOpen,
      })}

      {editorOpen && (
        <PanelEditor
          layout={layout}
          onChange={storeLayout}
          onClose={() => setEditorOpen(false)}
        />
      )}

      {/* 카드 여섯이 슬롯 넷에 서는 격자. 열: 왼쪽(남는 폭) · 경계 · 오른쪽
          첫째 · 경계 · 오른쪽 둘째. 행: 위(남는 높이) · 경계 · 왼쪽 아래.
          카드의 DOM 순서는 고정이고 grid-area 만 바뀝니다 — 자리를 바꿔도,
          한 자리 안에서 탭을 바꿔도 차트가 다시 만들어지지 않습니다. */}
      <div
        className="trade-split"
        ref={splitRef}
        style={gridStyle}
        /* 끄는 중이거나 키보드로 고르는 중. 둘 다 「지금 자리를 옮기고 있다」라
           받을 수 있는 자리 표시가 같이 걸립니다 — 한쪽만 걸면 키보드로 옮길
           때는 어디에 놓을 수 있는지가 안 보입니다. */
        data-dragging={dragging || pending ? 'true' : undefined}
      >
        {resizeHint && (
          <div
            className="resize-pill"
            data-floor={resizeHint.floor ? 'true' : undefined}
            style={{ left: resizeHint.x, top: resizeHint.y }}
          >
            {resizeHint.text}
          </div>
        )}
        {/* 지금 손에 들려 있는 카드. 놓으면 무슨 일이 일어나는지는 대상 카드가
            제 자리에서 말합니다. */}
        {dragging && (
          <div className="drag-chip" ref={placeChip} aria-hidden="true">
            {slotsUsed[dragging].map((key) => CARD_LABEL[key]).join(' · ')}
          </div>
        )}
        {renderResizers({
          colSplits,
          startColumnResize,
          rowSplits,
          startRowResize,
        })}

        {renderChartCard({
          cardProps,
          cardHead,
          chartExpandButton,
          expandedChart,
          chartTabStrip,
          chartTabsInBody,
          activeTab,
          chain,
          optionProduct,
          presets,
          activePreset,
          setPreset,
          chainSide,
          setChainSide,
          chainRows,
          chainArgs,
          chainOwner,
          futuresPrice,
          atm,
          strikeDecimals,
          chainPickedCode,
          pickFromChain,
          quote,
          secondSelected,
          secondQuote,
          splitState,
          patchSlot,
          chartExpanded,
          setChartExpanded,
          subject,
          setSplitState,
          secondCode,
          selectedCode,
          pickFromCode,
          pickInstrument,
          shownQuote,
          activeContext,
          priceKnown,
          splitView,
        })}

        {/* 체인을 보는 동안에는 하단이 머리 띠만 남고 접힙니다.
            체인 탭에 있다는 것은 「어느 행사가로 갈지 고르는 중」이라는
            뜻이고, 그때 아래 칸의 표는 볼 일이 아닙니다. 몇 건 있는지는 탭
            옆 숫자가 대신 말합니다 — 머리와 한 행만 남기면 그 한 건이
            내가 찾는 건지 알 수 없어 결국 펼치게 됩니다. */}
        {renderBottomCards({
          expandedChart,
          collapsedFor,
          cardShown,
          cardProps,
          bottomHead,
          startClosing,
          shownQuote,
          context,
          orders,
          fills,
          positions,
          orderList,
          positionList,
          accountMarket,
          positionSides,
          positionNotes,
          receivedSides,
          startEditing,
        })}

        {renderBookCard({
          cardProps,
          cardHead,
          bookFailed,
          staleAt,
          failedExchange,
          shownQuote,
          book,
          bookFailure,
          priceKnown,
          axisPending,
          shownEntry,
          price,
          subjectShown,
          clearResult,
          touchPrice,
          setPrice,
        })}

        {renderTicksCard({
          cardProps,
          cardHead,
          ticksFailed,
          quoteStaleAt,
          failedExchange,
          tapeSince,
          shownQuote,
          ticks,
          listening,
          shownUnasked,
          axisPending,
        })}

        {renderFormCard({
          cardProps,
          cardHead,
          shownQuote,
          subjectShown,
          activeContext,
          kind,
          side,
          orderType,
          condition,
          price,
          stopPrice,
          quantity,
          bestBid,
          bestAsk,
          orderBlocked,
          submitPaused,
          credentialsWhy,
          environmentWhy,
          sessionWhy,
          sessionHeld,
          sessionCode,
          shownFailure,
          editing,
          orderable,
          environmentKnown,
          orderableAsk,
          closing,
          closePriceFrom,
          clearResult,
          chooseSide,
          setOrderType,
          setCondition,
          touchPrice,
          setPrice,
          setStopPrice,
          setQuantity,
          checkOrderable,
          setEditing,
          setClosing,
          releaseSystemSide,
          sending,
          orderResult,
          askToSend,
          slotOfCard,
          setSlotTabs,
          setBottomOpen,
          accountMarket,
        })}
      </div>

      {/* 되돌릴 수 없는 한 걸음 앞에 한 번 되묻습니다. 창이 떠 있는 동안
          바깥은 안 눌리고, 그만두면 아무 일도 일어나지 않습니다. */}
      {confirming && (
        <OrderConfirm
          ask={confirming.show}
          onConfirm={() => void confirmSend()}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
