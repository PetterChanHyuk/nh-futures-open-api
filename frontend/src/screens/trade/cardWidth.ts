import { useCallback, useState } from 'react'

/** 좁은 카드의 문턱(px). 차트 카드가 이보다 좁으면 도구 줄의 지표 단추를 한 단추로
 *  접고, 머리 띠의 칸 수 단추를 그림만 남깁니다. 일·분, 지표 다섯, 설정이 한 줄에
 *  서는 카드 폭입니다 — 더 좁으면 끝 단추부터 카드 밖으로 잘려 누를 수 없습니다. */
export const NARROW_CARD = 340

/** 두 칸이 켜져 있을 때 머리 띠의 칸 수 단추를 그림만 남기는 문턱(px). 두 칸이면
 *  단추 글이 「두 칸 · 위아래」로 한 칸일 때보다 길어, 차트 카드가 366 일 때 머리 띠가
 *  꼭 맞습니다. 여유를 조금 두어 이보다 좁으면 그림만 남깁니다. */
export const NARROW_CARD_SPLIT_HEAD = 370

/** 두 칸에서 도구 줄 끝에 「✎」 단추가 하나 더 설 때의 접는 문턱(px). 그 단추와
 *  틈만큼 도구 줄이 길어져, 이보다 좁은 카드에서는 지표 단추를 접습니다. */
export const NARROW_CARD_WITH_DRAW = 400

/** 「✎ 그리기」를 글자까지 세우는 카드 폭(px). 이보다 좁으면 「✎」 그림만 남깁니다. */
export const DRAW_LABEL_CARD = 440

/** 두 칸에서 도구 줄의 단추 사이를 줄이는 카드 폭(px). 지표를 접고 「✎」를 그림만
 *  남긴 도구 줄은 일·분 70, 「지표 N ▾」와 설정 104, 「✎」 27 에 단추 사이 12 둘을
 *  더해 225 이고, 카드 안쪽 여백 40 을 더하면 265 입니다. 이보다 좁은 카드에서는
 *  단추 사이를 6 으로 줄여 213 으로 넓은 열의 바닥(254, 도구 줄 214)에도 들어가게
 *  합니다. 한 칸이면 「✎」가 없어 이 바닥에서도 그대로 들어갑니다. */
export const TIGHT_DRAW_CARD = 266

/** 이 요소가 든 카드가 `threshold` 보다 좁은지. 창이 아니라 카드를 봅니다 — 같은
 *  창에서도 패널을 열거나 열 폭을 옮기면 카드 폭이 달라집니다. 카드가 없는
 *  화면(전략 검증)에서는 요소가 든 상자를 봅니다.
 *
 *  돌려주는 함수를 재려는 요소의 `ref` 로 겁니다. 처음 한 번은 그리기 전에 재서,
 *  좁은 카드에서 넓은 모양이 한 번 비쳤다 바뀌지 않게 합니다. 폭이 0 인 것은
 *  화면이 가려진 때라 판단하지 않습니다. */
export function useNarrowCard(
  threshold: number = NARROW_CARD,
): [(element: HTMLElement | null) => (() => void) | undefined, boolean] {
  const [narrow, setNarrow] = useState(false)
  const watch = useCallback(
    (element: HTMLElement | null) => {
      if (!element) return
      const card = element.closest<HTMLElement>('.trade-card') ?? element.parentElement ?? element
      const measure = () => {
        const width = card.getBoundingClientRect().width
        if (width === 0) return
        setNarrow(width < threshold)
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(card)
      return () => observer.disconnect()
    },
    [threshold],
  )
  return [watch, narrow]
}
