import { Count, MINUS, Num, currencyDigits, numberParts, toneOf } from '../../lib/number'

/* 계좌 금액을 글자로 적는 조각. 계좌 화면의 표와 사이드바의 계좌 패널이 같은
 * 모양으로 적어야 해서 한곳에 둡니다 — 두 자리가 같은 손익을 다른 자릿수로
 * 적으면 어느 쪽이 맞는지 알 수 없습니다. */

/** 통화가 섞이므로 금액에는 늘 단위가 붙습니다. **코드를 모르면 아무것도 안
 *  답니다** — 무슨 돈인지 지어내지 않습니다.
 *
 *  소수 자릿수는 **줄의 통화**로 정합니다(`currencyDigits` — 엔은 0, 달러는 2).
 *  잔고 답에는 자릿수 칸이 없습니다. 코드를 모르면 값을 받은 그대로 적습니다. */
export function Money({
  value,
  currency,
  signed,
}: {
  value: number
  currency: string
  signed?: boolean
}) {
  if (currency === 'KRW') {
    return (
      <>
        <Count value={value} signed={signed} />원
      </>
    )
  }
  if (!currency) return <Count value={value} signed={signed} />
  return (
    <>
      <Num value={value} decimals={currencyDigits(currency) ?? 2} signed={signed} /> {currency}
    </>
  )
}

/** `Money` 가 그리는 것과 같은 글자 — 칸이 좁아 말줄임될 때 마우스를 올리면
 *  보이는 전체 값입니다. */
export function moneyLabel(value: number, currency: string, signed = false): string {
  if (currency === 'KRW') return `${numberParts(value, 0, null, signed)[0]}원`
  /* 통화를 모르면 `Count` 처럼 값을 반올림하지 않고 그대로 적습니다. */
  if (!currency) {
    const sign = value < 0 ? MINUS : signed && value > 0 ? '+' : ''
    return `${sign}${Math.abs(value).toLocaleString('ko-KR')}`
  }
  const [int, frac] = numberParts(value, currencyDigits(currency) ?? 2, null, signed)
  return `${int}${frac} ${currency}`
}

/** 손익은 계좌 값 가운데 색을 쓰는 유일한 값입니다. */
export function Tone({
  value,
  children,
}: {
  value: number
  children: React.ReactNode
}) {
  /* 0 은 본문색입니다 — 손익 0 은 본전이라 값이고, 흐림은 값이 없는 「—」의
     것입니다(`toneOf`). */
  return <span className={toneOf(value) || undefined}>{children}</span>
}
