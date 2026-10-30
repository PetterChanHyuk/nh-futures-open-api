import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

/* 관심종목 줄의 순서 바꾸기 — 줄을 잡아 끌거나, 줄(또는 손잡이)에 초점을 두고
 * Alt+위·아래.
 *
 * **줄 어디를 잡아도 됩니다.** 왼쪽 손잡이 점은 「옮길 수 있다」는 표시이고, 줄
 * 몸통을 잡아 끌어도 같습니다. 손 떨림 안에서 떼면 끌기가 아니라 그 줄을 누른
 * 것이고(펼치기·주문 화면), 그 밖으로 움직였으면 끌기라 누름은 일어나지 않습니다.
 *
 * **포인터로 직접 따라갑니다.** 브라우저의 끌어놓기에 맡기면 「여기 놓아도 되는가」를
 * 받는 쪽이 매번 되받아야 하고, 그 답이 한 번 늦으면 줄이 못 놓는 곳으로 굳습니다.
 * 일반주문의 카드 옮기기와 같은 손입니다.
 *
 * **든 줄이 손을 따라오고, 다른 줄이 비켜납니다.** 든 줄이 지나간 줄들은 든 줄
 * 한 칸만큼 미끄러져 빈자리를 벌리고, 그 빈자리가 곧 놓일 자리입니다. 펼친 줄은
 * 아래 판까지 한 덩어리로 들리고 한 덩어리로 비켜납니다. 움직임은 모두 `transform`
 * 이라 끄는 동안 목록의 자리 계산은 다시 일어나지 않습니다.
 *
 * **손을 뗄 때 한 번만** 순서를 바꿔 저장합니다 — 끄는 동안 실제 순서를 바꾸면
 * 옮길 때마다 저장하거나, 줄이 손 밑에서 오가며 놓일 자리가 흔들립니다. 무르면 모든
 * 줄이 제자리로 미끄러져 돌아갑니다.
 *
 * 빈 칸은 끌 대상도 놓을 자리도 아닙니다 — 빈 칸은 늘 담긴 줄 뒤에 섭니다. */

/** 이만큼은 손 떨림입니다. 그 안에서는 아직 끌기가 아닙니다 — 줄을 누르려던 것이
 *  순서 바꾸기가 되면 안 됩니다. */
const SLOP = 4

/** 끌기를 시작하지 않는 자리. 빼기 단추와 펼친 줄 아래 판은 제 누름이 따로 있고,
 *  손잡이는 제 손으로 끌기를 엽니다. */
const NOT_A_HANDLE = '.home-remove, .home-quote-panel, .home-grip'

export interface WatchDrag {
  /** 들고 있는 줄. */
  from: number
}

/** 줄들에 적은 자리 옮김을 지웁니다. `instant` 면 미끄러지지 않고 바로 제자리입니다. */
function settle(rows: readonly HTMLElement[], lifted: HTMLElement, instant: boolean) {
  if (!instant) {
    /* 무를 때입니다. 든 줄은 제자리에 닿을 때까지 들린 모양(바탕·그림자·위에 섬)을
       유지합니다 — 모양을 먼저 벗으면 돌아가는 길에 다른 줄 밑으로 지나갑니다. */
    lifted.dataset.returning = 'true'
    const done = () => {
      delete lifted.dataset.returning
      lifted.removeEventListener('transitionend', done)
    }
    lifted.addEventListener('transitionend', done)
    /* 미끄러짐이 없으면(움직임 줄이기 설정, 이미 제자리) 끝 알림이 오지 않습니다. */
    window.setTimeout(done, 300)
    rows.forEach((row) => (row.style.transform = ''))
    return
  }
  /* 놓을 때입니다. 같은 순간 실제 순서가 바뀌어 줄들이 이미 그 자리에 서므로,
     옮김을 미끄러지며 거두면 줄이 한 번 더 움직여 보입니다. 미끄러짐을 끄고
     지운 뒤 그 상태를 한 번 확정하고, 다음 그림에서 미끄러짐을 되살립니다. */
  rows.forEach((row) => {
    row.style.transition = 'none'
    row.style.transform = ''
  })
  void rows[0]?.offsetHeight
  window.requestAnimationFrame(() => rows.forEach((row) => (row.style.transition = '')))
}

/** 키보드로 옮긴 뒤 초점을 되돌릴 자리 — 손잡이였는지 줄이었는지. */
type Part = 'grip' | 'row'

/* 손을 뗀 뒤 따라오는 누름 하나를 삼킵니다. 끌기를 마친 손이 줄이나 판 위에서
 * 떨어지면 브라우저가 그 자리에 누름을 보내는데, 그대로 두면 순서를 바꾸자마자
 * 줄이 펼쳐지거나 주문 화면으로 넘어갑니다. 누름은 손을 뗀 그 자리에서 바로
 * 오므로, 오지 않으면 한 박자 뒤에 거둡니다 — 다음 누름까지 삼키면 안 됩니다. */
function swallowClick(afterNextRelease: boolean) {
  const stop = (ev: MouseEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    done()
  }
  const later = () => window.setTimeout(done, 0)
  function done() {
    window.removeEventListener('click', stop, true)
    window.removeEventListener('pointerup', later, true)
  }
  window.addEventListener('click', stop, true)
  /* 아직 손을 안 뗐으면(Esc 로 무른 경우) 뗄 때까지 기다립니다. */
  if (afterNextRelease) window.addEventListener('pointerup', later, true)
  else later()
}

/**
 * @param codes 담긴 줄의 코드(빈 칸 제외, 보이는 차례)
 * @param onMove 한 줄을 다른 자리로 옮깁니다(`from` 번째를 빼서 `to` 번째에 둠)
 */
export function useWatchDrag(codes: readonly string[], onMove: (from: number, to: number) => void) {
  const tableRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<WatchDrag | null>(null)

  /* 키보드로 옮긴 줄에 초점을 되돌립니다. 줄이 자리를 옮기면 그 요소가 목록 안에서
     다시 꽂히며 초점을 잃는데, 그러면 Alt+위를 이어 누를 수 없습니다. 누른 자리가
     손잡이였으면 손잡이로, 줄이었으면 줄로 돌아갑니다. */
  const refocus = useRef<{ code: string; part: Part } | null>(null)
  const order = codes.join('|')
  useLayoutEffect(() => {
    const target = refocus.current
    if (!target) return
    refocus.current = null
    const element = [...(tableRef.current?.querySelectorAll<HTMLElement>(`[data-${target.part}]`) ?? [])].find(
      (item) => item.dataset[target.part] === target.code,
    )
    element?.focus()
  }, [order])

  /* 끌기 하나. 잡은 자리(`holder`)에 포인터를 붙들고, 움직임·손 뗌·무르기는 창에서
     듣습니다. */
  const begin = (event: PointerEvent<HTMLElement>, index: number, holder: Element) => {
    const table = tableRef.current
    if (!table) return
    const rows = [...table.querySelectorAll<HTMLElement>('.home-quote-list > li')].slice(0, codes.length)
    if (rows.length !== codes.length) return

    /* 줄 자리는 잡을 때 한 번 잽니다. 끄는 동안 실제 자리는 바뀌지 않고 옮김만
       얹히므로, 이 값이 끝까지 맞습니다. 무른 직후라 줄들이 아직 제자리로 미끄러지는
       중이면 보이는 자리는 그 옮김만큼 어긋나 있어, 옮김을 빼고 잽니다. */
    const rects = rows.map((row) => {
      const rect = row.getBoundingClientRect()
      const shift = new DOMMatrixReadOnly(getComputedStyle(row).transform).m42
      return { top: rect.top - shift, bottom: rect.bottom - shift, height: rect.height }
    })
    const startX = event.clientX
    const startY = event.clientY
    /* 비켜나는 줄들이 미끄러지는 거리 — 든 줄 하나의 피치입니다. 펼친 줄이면 판까지입니다.
       줄 사이 선은 둘째 줄부터 위에 붙으므로 든 줄 제 높이가 아니라 「선 없는 높이 +
       선 하나」로 잽니다 — 첫 줄을 들면 제 높이에는 선이 없어, 그대로 쓰면 놓는 순간
       줄들이 선 굵기만큼 튑니다. */
    const lineOf = (row: HTMLElement | undefined) =>
      row ? parseFloat(getComputedStyle(row).borderTopWidth) || 0 : 0
    const size = rects[index].height - lineOf(rows[index]) + lineOf(rows[1])
    /* 든 덩어리의 가는 쪽 끝이 어느 줄의 가운데를 넘었는지로 놓일 자리를 고릅니다 —
       아래로 끌면 아래 끝, 위로 끌면 위 끝입니다. 손끝으로 고르면 펼친 줄처럼 큰
       덩어리는 손이 한참 가야 자리가 바뀌고, 그동안 덩어리가 이웃 줄을 덮습니다. */
    const minDy = rects[0].top - rects[index].top
    const maxDy = rects[rects.length - 1].bottom - rects[index].bottom
    const middle = (rect: { top: number; height: number }) => rect.top + rect.height / 2
    const slotOf = (dy: number) => {
      const top = rects[index].top + dy
      const bottom = rects[index].bottom + dy
      const below = rects.filter((rect, i) => i > index && middle(rect) < bottom).length
      const above = rects.filter((rect, i) => i < index && middle(rect) > top).length
      return index + below - above
    }
    /* 든 줄이 `slot` 으로 갈 때 `i` 번째 줄이 비켜나는 거리. 든 줄과 그 자리 사이의
       줄들만 든 줄 쪽으로 한 칸 당겨집니다. */
    const shiftOf = (i: number, slot: number) => {
      if (index < i && i <= slot) return -size
      if (slot <= i && i < index) return size
      return 0
    }

    let moved = false
    let slot = index
    const place = (next: number) => {
      slot = next
      rows.forEach((row, i) => {
        if (i === index) return
        const shift = shiftOf(i, slot)
        row.style.transform = shift === 0 ? '' : `translateY(${shift}px)`
      })
    }
    /* 포인터를 잡은 자리에 붙들어 둡니다. 듣기는 창에 걸어 두므로 붙들기에 실패해도
       그 밖의 움직임과 손 뗌을 받습니다. */
    try {
      holder.setPointerCapture(event.pointerId)
    } catch {
      // 붙들지 못해도 창의 듣기가 끌기를 따라갑니다.
    }
    const move = (ev: globalThis.PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < SLOP && Math.abs(ev.clientY - startY) < SLOP) return
      if (!moved) {
        /* 줄 몸통에서 시작한 끌기는 글자 선택을 막지 않고 시작합니다(누름일 수도
           있어서). 끌기로 넘어가는 순간 딸려 잡힌 선택을 걷습니다. */
        window.getSelection()?.removeAllRanges()
        moved = true
        setDrag({ from: index })
      }
      /* 든 줄은 손을 따라오되 목록 안에서만 움직입니다 — 첫 줄 위 끝부터 마지막 담긴
         줄 아래 끝까지입니다. 그 밖에는 놓을 자리가 없고, 넘어가면 머리글이나 빈 칸을
         덮고 카드 밖으로 나가 잘립니다. 다른 줄은 놓일 자리가 바뀔 때만 움직입니다. */
      const dy = Math.min(Math.max(ev.clientY - startY, minDy), maxDy)
      rows[index].style.transform = `translateY(${dy}px)`
      const next = slotOf(dy)
      if (next !== slot) place(next)
    }
    /* 끌기가 끝나면 단 듣기를 모두 뗍니다 — 남으면 끌기가 아닐 때 손을 움직여도
       줄이 들립니다. */
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', abort, true)
      window.removeEventListener('blur', cancel)
      setDrag(null)
      if (!moved) return
      /* 놓으면 실제 순서가 바뀌어 줄들이 벌려 둔 자리에 그대로 섭니다 — 옮김은
         바로 거둡니다. 무르면 모두 미끄러져 제자리로 돌아갑니다. */
      const keep = commit && slot !== index
      settle(rows, rows[index], keep)
      /* 제자리에 놓으면 순서가 그대로라 저장하지 않습니다. */
      if (keep) onMove(index, slot)
    }
    /* 떨림 안에서 뗐으면 누름입니다 — 브라우저가 보내는 누름을 그대로 둡니다. */
    const up = () => {
      if (moved) swallowClick(false)
      finish(true)
    }
    /* 끌기가 중간에 끊긴 경우입니다 — 창이 바뀌거나 브라우저가 제스처를 가져간
       것이라 손을 뗀 적이 없습니다. 순서는 그대로 둡니다. */
    const cancel = () => finish(false)
    /* 끌다가 무르기. 손을 떼기 전에 Esc 를 누르면 순서는 그대로이고, 이어서 손을
       떼도 그 줄을 누른 것이 되지 않습니다. */
    const abort = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      swallowClick(true)
      finish(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', abort, true)
    window.addEventListener('blur', cancel)
  }

  const keyMove = (index: number, part: Part) => (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const target = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (target < 0 || target >= codes.length) return
    refocus.current = { code: codes[index], part }
    onMove(index, target)
  }

  /** 손잡이 단추에 답니다. */
  const gripProps = (index: number) => ({
    'data-grip': codes[index],
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      /* 글자가 딸려 선택되지 않게 기본 동작을 막고, 초점은 직접 줍니다 — 초점이
         있어야 이어서 Alt+화살표로 옮길 수 있습니다. */
      event.preventDefault()
      const grip = event.currentTarget
      grip.focus()
      begin(event, index, grip)
    },
    onKeyDown: keyMove(index, 'grip'),
  })

  /** 담긴 줄(`li`)에 답니다. 줄 몸통 어디서든 끌기를 엽니다. 기본 동작은 막지
   *  않습니다 — 떨림 안에서 떼면 그 줄의 누름이 그대로 일어나야 합니다. */
  const rowProps = (index: number) => ({
    onPointerDown: (event: PointerEvent<HTMLLIElement>) => {
      if (event.button !== 0) return
      const from = event.target as Element
      if (from.closest(NOT_A_HANDLE)) return
      begin(event, index, from)
    },
  })

  /** 줄의 누름 단추에 답니다. 손잡이와 같은 Alt+위·아래입니다. */
  const rowKeyProps = (index: number) => ({
    'data-row': codes[index],
    onKeyDown: keyMove(index, 'row'),
  })

  return { tableRef, drag, gripProps, rowProps, rowKeyProps }
}
