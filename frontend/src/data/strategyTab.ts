/** 상단 전략주문 탭을 보일지 — 설정 「일반」의 「화면」 절이 바꿉니다.
 *
 *  값은 화면 상태 파일(`nh.nav.strategy`)에 참·거짓으로 남아, 앱을 다시 켜도 그대로입니다.
 *  **값이 없으면 끔입니다** — 처음 쓰는 사람에게는 전략주문 탭이 숨고, 설정 「일반」의
 *  「화면」에서 켭니다. 값이 오기 전에도 기본값(끔)으로 그리므로, 켬으로 저장한 사람에게는
 *  값이 온 뒤에 탭이 나타납니다.
 *
 *  **다만 값이 없는데 끝나지 않은 전략 실행이 있으면 켬으로 봅니다.** 도는 실행을 볼 자리가
 *  없어지면 안 되기 때문입니다. 이때는 보기만 바꾸고 파일에는 남기지 않습니다 — 사용자가
 *  설정에서 켜야 남습니다. 한 번 켬으로 본 뒤에는 그 실행이 끝나도 앱을 다시 켤 때까지
 *  켬을 지킵니다(보던 탭이 갑자기 사라지지 않게). 실행 목록을 받지 못하면 끔입니다.
 *  값이 거짓이면 실행이 있어도 끔인데, 끝나지 않은 실행이 있으면 설정에서 끌 수 없으므로
 *  이 조합은 생기지 않습니다.
 *
 *  끈 동안 숨는 것은 **화면과 알림뿐**입니다. 전략 엔진과 서버의 실행은 그대로 돌고,
 *  실시간 방송도 그대로 받습니다. 그래서 끝나지 않은 실행이 있으면 끄지 못하게
 *  합니다(`countActiveRuns`) — 실행은 도는데 볼 자리가 없는 상태가 되기 때문입니다. */
import { useSyncExternalStore } from 'react'

import { setUiValue, uiState, useUiState } from './uiState'

const KEY = 'nh.nav.strategy'

/** 값이 없을 때 쓰는 판정 — 끝나지 않은 실행을 본 적이 있는지. 한 번 참이 되면 이 앱이
 *  도는 동안 그대로입니다. */
let activeSeen = false
/** 값이 없어서 실행 목록을 물었는지. 한 번만 묻습니다. */
let runsAsked = false
const listeners = new Set<() => void>()

function subscribeActive(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 실행 목록을 받을 때마다 실행 저장소가 부릅니다(목록 조회와 실시간 방송). */
export function noteRunsForTab(runs: readonly { state: string }[]): void {
  if (activeSeen || !runs.some((run) => run.state !== 'ended')) return
  activeSeen = true
  for (const listener of listeners) listener()
}

/** 값이 없어 실행 목록을 한 번 물어야 하는지. 참을 돌려준 뒤로는 거짓입니다 — 앱이
 *  화면 상태를 받은 뒤 한 번 봅니다. 값이 있으면 묻지 않습니다. */
export function needsRunsForTab(): boolean {
  const ui = uiState()
  if (runsAsked || ui.status === 'loading' || ui.values[KEY] !== undefined) return false
  runsAsked = true
  return true
}

/** 참일 때만 켬이고, 거짓·참거짓이 아닌 값은 끔입니다. 값이 없으면 끝나지 않은 실행을
 *  본 적이 있을 때만 켬입니다(화면 상태를 받기 전에는 끔). 받기 전에 도착한 실행 알림은
 *  알림 쪽이 받은 뒤까지 미뤄 두므로 이 판정에 막혀 사라지지 않습니다(`data/alerts.ts`). */
function shownOf(raw: unknown, ready: boolean): boolean {
  if (raw === true) return true
  if (raw !== undefined) return false
  return ready && activeSeen
}

/** 지금 탭을 보이는지. 저장소를 구독하지 않는 자리(알림·페이지 이동)에서 그때그때 읽습니다. */
export function strategyTabShown(): boolean {
  const ui = uiState()
  return shownOf(ui.values[KEY], ui.status !== 'loading')
}

/** 화면이 쓰는 꼴. 파일 값이 오기 전에는 끔입니다. */
export function useStrategyTabShown(): boolean {
  const [raw, , ready] = useUiState<unknown>(KEY, undefined)
  useSyncExternalStore(subscribeActive, () => activeSeen)
  return shownOf(raw, ready)
}

/** 값을 바꿉니다. 화면에는 바로 서고, 파일에는 모아서 보냅니다. */
export function setStrategyTabShown(on: boolean): void {
  setUiValue(KEY, on)
}
