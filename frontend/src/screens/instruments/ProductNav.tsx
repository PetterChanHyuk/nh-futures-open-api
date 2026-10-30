import { useEffect, useState } from 'react'
import type { Product, ProductKind } from '../../lib/types'
import { kindsOf, searchTextOf } from '../../data/instruments'

/* 좌측 품목 내비 — 거래소가 최상위, 상품이 그 아래입니다.
 *
 * 해외 마스터가 거래소별 파일(cme · opra · 기타)로 오므로 그 축이 화면에도
 * 남습니다.
 *
 * **줄은 다 서고 그 아래는 많아야 하나가 펼쳐집니다.** 거래소는 무엇이 있는지 다
 * 보여야 하고(「이 거래소에는 없다」를 고르고 나서 알 수 있습니다), 상품군은 한
 * 번에 한 거래소의 것만 봅니다. **거래소끼리 견주는 길은 없습니다 — 옮겨 가며
 * 봅니다.** 펼친 거래소 줄을 다시 누르면 접힙니다.
 *
 * **국내에는 거래소 줄이 아예 없습니다.** 국내 마스터에 거래소 칸이 없어서,
 * 있는데 하나인 것이 아니라 축이 없는 것입니다. 이름 없는 줄을 세우면 고를 것도
 * 읽을 것도 없는 자리가 목록 위에 남습니다 — 상품군이 최상위가 됩니다.
 *
 * 세그먼트를 세로로 둘 쌓지 않습니다. 거래소를 세그먼트로 만들면 국내에서는
 * 고를 게 없으면서 고르는 모양을 하고 있게 됩니다.
 *
 * 맨 위에 찾기 칸이 있습니다. 품목이 수백 개라 거래소와 상품군을 짚어 가며
 * 내려가는 길만으로는 이름을 아는 사람이 더 느립니다. **찾기는 지금 열린
 * 거래소가 아니라 그 시장 전체**를 봅니다 — 어느 거래소에 있는지 알아야 찾을
 * 수 있다면, 이미 아는 사람만 쓸 수 있는 찾기가 됩니다.
 *
 * **상품군은 접힙니다.** 한 상품군에 품목이 이백 개가 넘는 시장이 있어, 다 펴
 * 두면 다른 상품군이 무엇인지 보려고 목록을 한참 굴려야 합니다. 접어 두면
 * 상품군 이름이 한 화면에 다 서서 「어떤 것들이 있나」가 먼저 보입니다.
 * 머리마다 품목 수를 답니다 — 접힌 것 안에 몇 개가 있는지 열어 보지 않고
 * 알 수 있어야 여는 값이 생깁니다.
 *
 * **이 화면을 열 때마다 거래소와 상품군이 모두 접혀 있습니다.** 펼친 것은 저장하지
 * 않고, 다른 화면에 갔다 오면 처음 모습으로 돌아옵니다. 찾기로 품목을 고르면 그
 * 품목의 거래소와 상품군을 펼쳐, 고른 것이 목록 어디에 있는지 보이게 합니다.
 */

/** 이 폭 아래에서는 안내 문구를 줄입니다. 잘린 문장은 안 적은 것만 못합니다. */
const NARROW = 180

interface Exchange {
  name: string
  groups: { name: string; items: Product[] }[]
}

interface Props {
  /** 그 시장의 품목 전부. 거래소 목록은 종류와 무관하게 다 서야, 「이 거래소에
   *  선물이 없다」를 고르고 나서 알 수 있습니다. */
  products: Product[]
  /** 어느 시장인가. 펼쳐 둔 상품군을 시장마다 따로 둡니다(이 화면에 있는 동안만). */
  market: 'domestic' | 'overseas'
  /** 지금 보고 있는 종류. 거래소 아래 항목만 이걸로 거릅니다.
   *  **`null` 이면 안 거릅니다** — 품목마다 종류가 하나뿐인 시장에서는 종류가
   *  고르는 축이 아니라 품목의 꼬리표라, 걸러 내면 목록의 대부분이 사라집니다. */
  kind: ProductKind | null
  selected: string
  /** 펼친 거래소. `null` 이면 다 접혀 있습니다. 국내처럼 거래소 축이 없거나 하나뿐인
   *  시장에서는 늘 펼쳐져 있습니다. */
  exchange: string | null
  /** 사용자가 경계선을 끌어 정한 폭 */
  width: number
  onSelect: (product: Product) => void
  /** 펼칠 거래소를 바꿉니다. `null` 이면 다 접습니다. **품목은 바꾸지 않습니다.** */
  onExchangeChange: (exchange: string | null) => void
}

export function ProductNav({
  products,
  market,
  selected,
  kind,
  exchange,
  width,
  onSelect,
  onExchangeChange,
}: Props) {
  const [query, setQuery] = useState('')
  /* 펼쳐 둔 상품군. **시장마다 따로**입니다 — 이름이 겹치는 상품군이 있어
     한 목록에 섞으면 국내에서 편 것이 해외에서도 펴집니다. 처음에는 다 접혀 있고,
     저장하지 않습니다. */
  const [openGroups, setOpenGroups] = useState<Record<string, string[]>>({})

  /* 시장을 바꾸면 찾던 말을 지웁니다. 남겨 두면 목록이 비어 있는 채로 열리고,
     그게 「이 시장에는 품목이 없다」로 읽힙니다. */
  useEffect(() => {
    setQuery('')
  }, [products])

  const term = query.trim().toLowerCase()

  /* 거래소 → 상품군 → 상품. **상품군으로 모으고 그 안에서 이름순**입니다.
   *
   * 실린 순서를 그대로 쓰면 사용자에게 뜻이 없는 순서가 됩니다. 품목이 수백
   * 개인 시장에서는 이름순이 유일하게 예측 가능한 순서이고, 같은 상품의 선물·
   * 옵션·스프레드는 이름 접두어가 같아 이름순이면 반드시 붙어 섭니다 —
   * 「이 상품에 옵션이 있다」를 눌러 보지 않고 압니다.
   *
   * 거래소와 상품군의 줄 순서는 **마스터 규격이 값을 나열한 순서**입니다.
   * 목록에 실린 순서(마스터 파일 순서)에는 뜻이 없고, 이름순으로 다시 세우면
   * 규격이 짝지어 적은 것이 갈라집니다.
   *
   * **연속 구간으로 묶지 않습니다.** 이름순으로 세우면 같은 상품군이 목록
   * 여기저기에 흩어져 나오는데, 직전 묶음하고만 비교하면 같은 상품군이 여러
   * 블록으로 갈립니다. */
  const exchanges: Exchange[] = []
  for (const product of products) {
    let ex = exchanges.find((item) => item.name === product.exchange)
    if (!ex) {
      ex = { name: product.exchange, groups: [] }
      exchanges.push(ex)
    }
    if (kind !== null && !kindsOf(product).includes(kind)) continue
    const group = ex.groups.find((item) => item.name === product.group)
    if (group) group.items.push(product)
    else ex.groups.push({ name: product.group, items: [product] })
  }
  /* 이름 안의 숫자는 숫자로 셉니다 — 글자로만 세우면 「미국채 10년」이
     「미국채 5년」 앞에 서고, 「3년국채」가 「10년국채」 뒤로 갑니다. */
  const byName = new Intl.Collator('ko', { numeric: true })
  for (const ex of exchanges) {
    for (const group of ex.groups) {
      group.items.sort((a, b) => byName.compare(a.name, b.name))
    }
  }

  const only = exchanges.length === 1
  /* 거래소 축이 있는 시장인가. 이름이 하나도 없으면 마스터가 그 칸을 안 준
     것이라, 줄을 세우지 않고 상품군을 최상위로 둡니다. */
  const hasExchange = exchanges.some((item) => item.name !== '')
  /* 펼친 거래소. 거래소 축이 없는 시장에서는 그 하나가 늘 펼쳐져 있습니다. */
  const active = hasExchange
    ? (exchanges.find((item) => item.name === exchange) ?? null)
    : exchanges[0]

  /* 찾기 결과는 시장 전체입니다. 거래소·상품군 머리를 세우지 않고 한 줄로
     펴되, 어디에 있는 품목인지를 이름 아래 작게 답니다 — 결과를 고르면
     그 거래소로 옮겨 가므로, 옮겨 가기 전에 어디로 가는지가 보입니다. */
  const found =
    term === ''
      ? []
      : products
          .filter((product) => searchTextOf(product).includes(term))
          .sort((a, b) => byName.compare(a.name, b.name))

  const opened = openGroups[market] ?? []
  const isOpen = (name: string) => opened.includes(name)

  const setOpen = (name: string, open: boolean) => {
    const next = open
      ? [...opened.filter((item) => item !== name), name]
      : opened.filter((item) => item !== name)
    setOpenGroups({ ...openGroups, [market]: next })
  }

  /* 찾기로 고른 품목은 그 거래소와 상품군을 펼칩니다 — 찾기를 지우고 목록으로
     돌아왔을 때 고른 것이 접힌 상품군 안에 숨어 있으면, 화면이 보여주는 것과
     목록이 어긋납니다. 목록에서 직접 고른 것은 이미 펼친 상품군 안에 있습니다. */
  const pick = (product: Product) => {
    setQuery('')
    if (!opened.includes(product.group)) setOpen(product.group, true)
    if (hasExchange) onExchangeChange(product.exchange)
    onSelect(product)
  }

  /* 한 거래소 아래에 서는 상품군 목록. 거래소 축이 없는 시장에서는 이것만
     섭니다 — 두 시장이 같은 조각을 씁니다. */
  const groupList = (ex: Exchange) => (
    <>
      {ex.groups.length === 0 && <p className="nav-empty">이 거래소에는 없습니다</p>}
      {ex.groups.map((group) => {
        const open = isOpen(group.name)
        return (
          <div key={group.name}>
            <h2 className="nav-group">
              <button
                type="button"
                className="nav-group-toggle"
                aria-expanded={open}
                onClick={() => setOpen(group.name, !open)}
              >
                <span className="nav-caret" aria-hidden="true">
                  {open ? '▾' : '▸'}
                </span>
                <span className="nav-group-name">{group.name}</span>
                {/* 접힌 안에 몇 개가 있는지. 열어 보지 않고 알 수 있어야
                    여는 값이 생깁니다. */}
                <span className="nav-group-count">{group.items.length}</span>
              </button>
            </h2>
            {open &&
              group.items.map((product) => (
                <button
                  key={product.code}
                  type="button"
                  className="nav-item"
                  aria-current={product.code === selected}
                  onClick={() => onSelect(product)}
                >
                  <span className="nav-name">{product.name}</span>
                </button>
              ))}
          </div>
        )
      })}
    </>
  )

  return (
    <nav className="product-nav" aria-label="품목" style={{ width }}>
      <input
        className="control nav-find"
        type="search"
        value={query}
        aria-label="품목 찾기"
        placeholder={width < NARROW ? '품목 찾기' : '이 시장에서 품목 찾기'}
        onChange={(event) => setQuery(event.target.value)}
      />

      {term !== '' ? (
        <div className="nav-scroll nav-scroll-flush">
          {found.length === 0 ? (
            <p className="nav-empty nav-empty-flush">찾는 품목이 없습니다</p>
          ) : (
            found.map((product) => (
              <button
                key={product.exchange + '|' + product.code}
                type="button"
                className="nav-item nav-result"
                aria-current={product.code === selected}
                onClick={() => pick(product)}
              >
                <span className="nav-name">{product.name}</span>
                {/* 국내에는 거래소 축이 없어 상품군만 섭니다. */}
                <span className="nav-where">
                  {[product.exchange, product.group].filter((text) => text !== '').join(' · ')}
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        /* **거래소는 아코디언입니다 — 고른 줄 바로 아래에 그 상품군이 들어갑니다.**
           여섯 줄은 그대로 다 서고, 펼쳐진 것만 하나입니다. 목록 위에 따로 띠로
           두면 고른 거래소와 그 상품군 사이에 다른 거래소 다섯 줄이 끼어, 그
           상품군이 누구의 것인지 화면이 말하지 않게 됩니다. */
        <div className={hasExchange ? 'nav-scroll' : 'nav-scroll nav-scroll-flush'}>
          {hasExchange
            ? exchanges.map((ex) =>
                only ? (
                  /* 하나뿐이면 못 누릅니다 — 누를 수 없는 것에 누르는 표시를
                     안 답니다. 그 아래는 늘 펼쳐져 있습니다. */
                  <div key={ex.name}>
                    <div className="nav-exchange nav-exchange-only">{ex.name}</div>
                    {groupList(ex)}
                  </div>
                ) : (
                  <div key={ex.name}>
                    <button
                      type="button"
                      className="nav-exchange"
                      aria-expanded={ex.name === active?.name}
                      /* 펼친 줄을 다시 누르면 접습니다. */
                      onClick={() => onExchangeChange(ex.name === active?.name ? null : ex.name)}
                    >
                      <span className="nav-caret" aria-hidden="true">
                        {ex.name === active?.name ? '▾' : '▸'}
                      </span>
                      {ex.name}
                    </button>
                    {ex.name === active?.name && groupList(ex)}
                  </div>
                ),
              )
            : active && groupList(active)}
        </div>
      )}
    </nav>
  )
}
