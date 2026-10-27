import { useEffect, useRef, useState } from 'react'

import { countActiveRuns } from '../../data/strategyStore'
import { setStrategyTabShown, useStrategyTabShown } from '../../data/strategyTab'
import { Switch } from './AlertSettings'

/* 설정 「일반」의 화면 묶음 — 상단 전략주문 탭을 보일지.
 *
 * 켜는 것은 바로 반영됩니다. 끄는 것은 두 가지를 먼저 봅니다.
 *
 * - **끝나지 않은 전략 실행이 있으면 끄지 않습니다.** 실행은 도는데 볼 자리가 없는
 *   상태가 되기 때문입니다. 스위치는 켠 채로 두고 그 아래에 까닭을 한 줄 적습니다.
 * - **전략주문 화면을 보고 있으면 홈으로 옮긴 뒤에 끕니다.** 저장하지 않은 전략 설정이
 *   있으면 다른 탭으로 옮길 때와 같은 확인 창이 뜨고, 「여기 남기」를 고르면 끄지 않고
 *   스위치를 켬으로 되돌립니다. */

/** 확인하는 동안의 단계. `checking` 은 실행 목록을 받는 중, `leaving` 은 화면을 옮기는
 *  중(저장하지 않은 설정 확인 창이 떠 있을 수 있습니다)입니다. */
type Step = 'idle' | 'checking' | 'leaving'

export function ViewSettingsGroup({ onHideStrategy }: { onHideStrategy: () => Promise<boolean> }) {
  const shown = useStrategyTabShown()
  const [step, setStep] = useState<Step>('idle')
  /* 끄지 못한 까닭. 다시 누르거나 켜면 지웁니다. */
  const [refusal, setRefusal] = useState<string | null>(null)
  /* 이 창이 아직 떠 있는지. 실행 목록을 받는 사이 창을 닫았으면, 답이 와도 끄지
     않습니다 — 사용자가 보지 않는 데서 탭이 사라지면 무엇을 눌렀는지 알 수 없습니다. */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const turnOff = async () => {
    setRefusal(null)
    setStep('checking')
    const active = await countActiveRuns()
    if (!alive.current) return
    if (active === null) {
      setStep('idle')
      setRefusal('실행 목록을 확인하지 못해 끌 수 없습니다')
      return
    }
    if (active > 0) {
      setStep('idle')
      setRefusal(`실행 중인 전략 ${active}개를 멈춘 뒤 끌 수 있습니다`)
      return
    }
    setStep('leaving')
    await onHideStrategy()
    if (alive.current) setStep('idle')
  }

  return (
    <section className="settings-view" aria-label="화면">
      <h2 className="settings-name">화면</h2>
      <div className="view-control">
        <Switch
          label="전략주문 탭 보이기"
          /* 화면을 옮기는 동안에는 고른 쪽(끔)으로 섭니다. 확인 창에서 남기를 고르면
             저장된 값(켬)으로 돌아옵니다. */
          on={step === 'leaving' ? false : shown}
          busy={step !== 'idle'}
          onChange={(next) => {
            if (next) {
              setRefusal(null)
              setStrategyTabShown(true)
              return
            }
            void turnOff()
          }}
        />
      </div>
      {refusal && (
        <p className="settings-confirm-error" role="alert">
          {refusal}
        </p>
      )}
      <p className="settings-note">
        끄면 상단의 전략주문 탭과 전략 알림이 숨겨집니다. 실행 중인 전략이 있으면 끌 수 없습니다.
      </p>
    </section>
  )
}
