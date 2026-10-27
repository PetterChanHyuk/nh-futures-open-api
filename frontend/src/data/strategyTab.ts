/** 상단 전략주문 탭을 보일지 — 설정 「일반」의 「화면」 절이 바꿉니다.
 *
 *  값은 화면 상태 파일(`nh.nav.strategy`)에 참·거짓으로 남아, 앱을 다시 켜도 그대로입니다.
 *  **값이 없으면 켬입니다** — 처음 쓰는 사람에게는 모든 탭이 보입니다.
 *
 *  끈 동안 숨는 것은 **화면과 알림뿐**입니다. 전략 엔진과 서버의 실행은 그대로 돌고,
 *  실시간 방송도 그대로 받습니다. 그래서 끝나지 않은 실행이 있으면 끄지 못하게
 *  합니다(`countActiveRuns`) — 실행은 도는데 볼 자리가 없는 상태가 되기 때문입니다. */
import { setUiValue, uiValue, useUiState } from './uiState'

const KEY = 'nh.nav.strategy'

/** 담긴 값을 읽습니다. 참·거짓이 아닌 값은 켬으로 읽습니다 — 손으로 고친 파일 때문에
 *  탭이 사라지면 어디서 되살리는지 찾기 어렵습니다. */
function readShown(raw: unknown): boolean {
  return raw !== false
}

/** 지금 탭을 보이는지. 저장소를 구독하지 않는 자리(알림·페이지 이동)에서 그때그때 읽습니다. */
export function strategyTabShown(): boolean {
  return readShown(uiValue<unknown>(KEY, true))
}

/** 화면이 쓰는 꼴. 파일 값이 오기 전에는 기본값(켬)입니다. */
export function useStrategyTabShown(): boolean {
  const [raw] = useUiState<unknown>(KEY, true)
  return readShown(raw)
}

/** 값을 바꿉니다. 화면에는 바로 서고, 파일에는 모아서 보냅니다. */
export function setStrategyTabShown(on: boolean): void {
  setUiValue(KEY, on)
}
