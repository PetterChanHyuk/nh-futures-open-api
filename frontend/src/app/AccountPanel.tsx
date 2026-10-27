import { useEffect } from 'react'
import { assetsOf } from '../data/depositHistory'
import {
  depositAt,
  depositMoney,
  depositUnit,
  loadDeposit,
  loadList,
  retryDeposit,
  retryList,
  useDeposit,
  useEnvironmentSettled,
  useListEntry,
  useMarketCredentialed,
  useReloadWhenShown,
  type DepositEntry,
  type DepositMarket,
  type ListEntry,
  type ServerPosition,
} from '../data/account'
import { toPosition } from '../data/accountRows'
import {
  MARKET_BADGE,
  NO_CODE_REASON,
  NO_CREDENTIALS,
  NO_CREDENTIALS_HINT,
  POSITIONS_EMPTY,
} from '../lib/labels'
import { Count, NumOrDash } from '../lib/number'
import type { OpenIntent, Position } from '../lib/types'
import { Money, Tone, moneyLabel } from '../screens/account/accountMoney'
import {
  currencyChoices,
  shownView,
  useSavedOverseasView,
  type StoredView,
} from '../screens/account/overseasView'
import './AccountPanel.css'

/* 사이드바의 계좌 패널 — 어느 화면에 있든 예탁금과 보유 포지션을 곁에서 봅니다.
 *
 * 값은 계좌 화면과 **같은 조회·같은 셈**입니다. 예탁자산·주문가능은 계좌 화면
 * 요약 띠와 같은 칸을 같은 길로 읽고, 포지션 줄은 잔고 표와 같은 가공을 거칩니다.
 * 두 자리가 같은 이름 아래 다른 수를 세우면 어느 쪽을 믿어야 할지 알 수 없습니다.
 *
 * **열려 있을 때만 조회합니다.** 계좌 조회에는 초당 한도가 있어, 닫힌 패널까지
 * 부르면 보고 있는 화면의 조회가 밀립니다. 열 때마다 새로 받고, 창이 다시 보일 때
 * 한 번 더 받습니다. 닫혀 있는 동안에는 받아 둔 값을 그대로 둡니다.
 *
 * 포지션 줄을 누르면 주문 화면이 그 종목을 **청산하러** 엽니다 — 보유와 반대
 * 방향, 보유 수량이 채워진 폼입니다. 계좌 화면 잔고 줄과 같은 길이고, 주문은
 * 사용자가 주문 단추를 눌러야 나갑니다.
 */

const MARKET_NAME: Record<DepositMarket, string> = { domestic: '국내', overseas: '해외' }
const MARKETS: DepositMarket[] = ['domestic', 'overseas']

interface Props {
  /** 패널이 열려 있는지. 닫혀 있으면 조회하지 않습니다. */
  open: boolean
  onOpenInstrument: (code: string, intent?: OpenIntent) => void
}

export function AccountPanel({ open, onOpenInstrument }: Props) {
  /* 시장마다 따로 가립니다 — 한 시장만 쓰는 사람의 찬 시장까지 막으면 쓸 수 있는
     계좌를 못 봅니다. 설정이나 접속 환경을 아직 모르면 「없다」고 하지 않습니다. */
  const domesticCredentialed = useMarketCredentialed('domestic')
  const overseasCredentialed = useMarketCredentialed('overseas')
  const credentialed: Record<DepositMarket, boolean> = {
    domestic: domesticCredentialed,
    overseas: overseasCredentialed,
  }
  const settled = useEnvironmentSettled()

  const domesticPositions = useListEntry<ServerPosition>('domestic', 'positions')
  const overseasPositions = useListEntry<ServerPosition>('overseas', 'positions')
  const positions: Record<DepositMarket, ListEntry<ServerPosition>> = {
    domestic: domesticPositions,
    overseas: overseasPositions,
  }

  /* 해외 금액의 보기는 계좌 화면 머리와 같은 값입니다. 고를 통화는 USD 와 해외
     포지션 줄의 통화입니다. */
  const [saved, setSaved] = useSavedOverseasView()
  const currencies = currencyChoices((positions.overseas.rows ?? []).map((row) => row.currency))
  const view = shownView(saved, currencies, positions.overseas.rows !== null)
  /* 보기는 글자로 봅니다 — 보기 객체는 그릴 때마다 새것입니다. */
  const viewKey = JSON.stringify(view)

  const domesticDeposit = useDeposit('domestic')
  const overseasDeposit = useDeposit('overseas', view)
  const deposits: Record<DepositMarket, DepositEntry> = {
    domestic: domesticDeposit,
    overseas: overseasDeposit,
  }

  /* 열 때 부릅니다. 담긴 값이 지워져 「안 불렀다」로 돌아가면(환경이 바뀜) 열려
     있는 동안 다시 부릅니다 — 계좌 화면의 자리들과 같은 규칙입니다. 나가 있는 같은
     물음이 있으면 겹쳐 묻지 않습니다. */
  const domesticDepositIdle = deposits.domestic.status === 'idle'
  const overseasDepositIdle = deposits.overseas.status === 'idle'
  const domesticListIdle = positions.domestic.status === 'idle'
  const overseasListIdle = positions.overseas.status === 'idle'
  useEffect(() => {
    if (open && settled && domesticCredentialed) void loadDeposit('domestic')
  }, [open, settled, domesticCredentialed, domesticDepositIdle])
  useEffect(() => {
    if (open && settled && overseasCredentialed) void loadDeposit('overseas', view)
    // 보기는 글자(viewKey)로 봅니다 — 보기 객체는 그릴 때마다 새것입니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settled, overseasCredentialed, overseasDepositIdle, viewKey])
  useEffect(() => {
    if (open && settled && domesticCredentialed) void loadList('domestic', 'positions')
  }, [open, settled, domesticCredentialed, domesticListIdle])
  useEffect(() => {
    if (open && settled && overseasCredentialed) void loadList('overseas', 'positions')
  }, [open, settled, overseasCredentialed, overseasListIdle])

  /* 창이 다시 보일 때 한 번 새로 받습니다 — 다른 창에 다녀온 사이의 변화(앱 밖
     체결 등)가 옛 값 그대로 남지 않게 합니다. 열려 있을 때만입니다. */
  useReloadWhenShown(() => {
    for (const market of MARKETS) {
      if (!credentialed[market]) continue
      retryDeposit(market, market === 'overseas' ? view : undefined)
      retryList(market, 'positions')
    }
  }, open && settled && (domesticCredentialed || overseasCredentialed))

  const shown = MARKETS.filter((market) => credentialed[market])

  /* 두 시장 모두 인증 정보가 없으면 조회가 성립하지 않습니다 — 「잠시 뒤 다시」가
     아니라 무엇이 없는지와 어디서 넣는지를 말합니다. */
  if (shown.length === 0) {
    return (
      <div className="acct-side">
        <div className="acct-side-notice">
          <p className="notice-title">{NO_CREDENTIALS}</p>
          <p className="notice-reason">{NO_CREDENTIALS_HINT}</p>
        </div>
      </div>
    )
  }

  const missing = MARKETS.find((market) => !credentialed[market])

  return (
    <div className="acct-side">
      <section className="acct-side-dep" aria-label="예탁금">
        {shown.map((market) => (
          <div key={market} className="acct-side-dep-row">
            <div className="acct-side-mk">
              {MARKET_NAME[market]}
              {market === 'overseas' && (
                <ViewSwitch
                  saved={saved}
                  shown={view.mode === 'by-currency' ? view.currency : saved.currency}
                  currencies={currencies}
                  converted={view.mode === 'converted'}
                  onChange={setSaved}
                />
              )}
            </div>
            <DepositLines
              entry={deposits[market]}
              onRetry={() => retryDeposit(market, market === 'overseas' ? view : undefined)}
            />
          </div>
        ))}
      </section>

      {shown.map((market) => (
        <PositionGroup
          key={market}
          market={market}
          entry={positions[market]}
          onOpen={(row) => onOpenInstrument(row.code, { kind: 'close', position: row })}
        />
      ))}

      {/* 한 시장만 인증 정보가 있으면 빠진 시장이 왜 없는지 한 줄로 말합니다 — 말이
          없으면 그 시장에 아무것도 없는 것으로 읽힙니다. */}
      {missing && (
        <p className="acct-side-note">{MARKET_NAME[missing]}는 인증 정보가 없어 보이지 않습니다</p>
      )}
    </div>
  )
}

/** 해외 줄 끝의 보기 전환. 계좌 화면 머리의 전환과 같은 두 갈래(통화별·원화
 *  환산)이고, 고를 통화가 둘 이상이면 통화 글자 옆 ▾ 로 통화를 고릅니다. 패널이
 *  좁으면 「통화별」을 빼고 「원화 환산」을 「원화」로 줄입니다. */
function ViewSwitch({
  saved,
  shown,
  currencies,
  converted,
  onChange,
}: {
  saved: StoredView
  /** 지금 보이는(통화별이면 묻는) 통화. */
  shown: string
  currencies: string[]
  converted: boolean
  onChange: (next: StoredView) => void
}) {
  /* 잔고를 받기 전에는 남긴 통화가 목록에 없을 수 있습니다. 보이는 통화는 늘
     고를 수 있게 넣어 둡니다. */
  const options = currencies.includes(shown) ? currencies : [...currencies, shown]
  return (
    <span className="acct-side-seg" role="group" aria-label="해외 금액 보기">
      <span className="acct-side-seg-item" data-on={!converted}>
        <button
          type="button"
          aria-pressed={!converted}
          aria-label={`통화별 ${shown}`}
          onClick={() => onChange({ ...saved, mode: 'by-currency' })}
        >
          <span className="acct-side-long">통화별 </span>
          {shown}
        </button>
        {options.length > 1 && (
          /* 고르는 칸은 ▾ 자리에 겹쳐 둔 셀렉트입니다. 통화를 고르면 통화별
             보기로 바뀝니다. */
          <span className="acct-side-cur">
            <span aria-hidden="true">▾</span>
            <select
              aria-label="통화"
              value={shown}
              onChange={(event) => onChange({ mode: 'by-currency', currency: event.target.value })}
            >
              {options.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </span>
        )}
      </span>
      <span className="acct-side-seg-item" data-on={converted}>
        <button
          type="button"
          aria-pressed={converted}
          aria-label="원화 환산"
          onClick={() => onChange({ ...saved, mode: 'converted' })}
        >
          <span className="acct-side-long">원화 환산</span>
          <span className="acct-side-short">원화</span>
        </button>
      </span>
    </span>
  )
}

/** 한 시장의 예탁자산·주문가능. 계좌 화면 요약 띠의 앞 두 칸과 같은 값입니다. */
function DepositLines({ entry, onRetry }: { entry: DepositEntry; onRetry: () => void }) {
  const value = entry.value
  if (value === null && entry.status === 'failed') {
    return (
      <p className="acct-side-fail">
        예탁자산을 받지 못했습니다
        {entry.failure === 'retry' && (
          <button type="button" className="btn btn-quiet" onClick={onRetry}>
            다시
          </button>
        )}
      </p>
    )
  }
  const unit = value === null ? null : depositUnit(value)
  const cell = (amount: number | null, width: string) => {
    if (value === null || unit === null) return <span className="skeleton" style={{ minWidth: width }} />
    if (amount === null) return <span className="dead">—</span>
    return depositMoney(amount, unit.decimals, unit.currency)
  }
  return (
    <dl className="acct-side-kv">
      <div>
        <dt>예탁자산</dt>
        <dd>{cell(value === null ? null : assetsOf(value), '9ch')}</dd>
      </div>
      <div>
        <dt>주문가능</dt>
        <dd>{cell(value === null ? null : depositAt(value, 'orderable'), '8ch')}</dd>
      </div>
    </dl>
  )
}

/** 한 시장의 포지션 묶음. 머리에 건수가 서고, 받은 뒤에만 셉니다 — 모르는 건수를
 *  「0건」으로 세우면 있는 포지션을 없다고 말하게 됩니다. */
function PositionGroup({
  market,
  entry,
  onOpen,
}: {
  market: DepositMarket
  entry: ListEntry<ServerPosition>
  onOpen: (row: Position) => void
}) {
  const overseas = market === 'overseas'
  const rows = entry.rows === null ? null : entry.rows.map((row) => toPosition(row, overseas))
  return (
    <section className="acct-side-group" aria-label={`${MARKET_NAME[market]} 포지션`}>
      <h2 className="acct-side-grp">
        {MARKET_NAME[market]} 포지션
        {rows !== null && <small>{rows.length}건</small>}
      </h2>
      {rows === null ? (
        entry.status === 'failed' ? (
          <p className="acct-side-fail">
            가져오지 못했습니다
            {entry.failure === 'retry' && (
              <button type="button" className="btn btn-quiet" onClick={() => retryList(market, 'positions')}>
                다시
              </button>
            )}
          </p>
        ) : (
          <div className="acct-side-skel" aria-hidden="true">
            <span className="skeleton" style={{ minWidth: '14ch', height: 13 }} />
            <span className="skeleton" style={{ minWidth: '9ch' }} />
          </div>
        )
      ) : rows.length === 0 ? (
        <p className="acct-side-empty">{POSITIONS_EMPTY}</p>
      ) : (
        <div className="acct-side-list">
          {/* 열쇠는 값이 아니라 자리입니다 — 종목을 못 찾은 줄은 코드가 빈 글자라
              값으로 열쇠를 만들면 겹칩니다. */}
          {rows.map((row, index) => (
            <PositionLine key={`position-${index}`} row={row} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

/** 포지션 한 줄. 줄 전체가 청산하러 여는 단추입니다. */
function PositionLine({ row, onOpen }: { row: Position; onOpen: (row: Position) => void }) {
  const side = row.side === 'long' ? '매수' : '매도'
  const body = (
    <>
      <span className="acct-side-name">{row.name}</span>
      <span className="acct-side-sub">
        {/* 모르는 시장 값이면 배지를 안 답니다 — 글자 없는 배지는 빈 조각입니다. */}
        {MARKET_BADGE[row.market] && <span className="badge">{MARKET_BADGE[row.market]}</span>}
        {row.productKind === 'spread' && <span className="badge">스프레드</span>}
        {/* 방향은 글자가 나르고 색은 거듭니다. */}
        <span className={row.side === 'long' ? 'up' : 'down'}>{side}</span>
        <span className="acct-side-num">
          {row.quantity === null ? <span className="dead">—</span> : <><Count value={row.quantity} />계약</>}
          {' · '}
          <NumOrDash value={row.avgPrice} decimals={row.decimals} />
        </span>
      </span>
      <span className="acct-side-foot">
        <span className="acct-side-pl" title={row.pl === null ? undefined : moneyLabel(row.pl, row.currency, true)}>
          {row.pl === null ? (
            <span className="dead">—</span>
          ) : (
            <Tone value={row.pl}>
              <Money value={row.pl} currency={row.currency} signed />
            </Tone>
          )}
        </span>
        {row.code === '' ? (
          <span className="acct-side-close dead">{NO_CODE_REASON}</span>
        ) : (
          <span className="acct-side-close" aria-hidden="true">
            청산 ›
          </span>
        )}
      </span>
    </>
  )
  /* 종목 마스터에서 코드를 못 찾은 줄은 **열 종목이 없습니다.** 줄은 그대로
     보이되 누르는 자리에서 빠집니다 — 계좌 화면 잔고 줄과 같은 조건입니다. */
  if (row.code === '') return <div className="acct-side-row">{body}</div>
  const quantity = row.quantity === null ? '' : ` ${row.quantity.toLocaleString('ko-KR')}계약`
  return (
    <button
      type="button"
      className="acct-side-row"
      aria-label={`${row.name} ${side}${quantity} 청산`}
      onClick={() => onOpen(row)}
    >
      {body}
    </button>
  )
}
