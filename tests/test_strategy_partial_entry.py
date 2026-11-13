"""진입 주문이 다 채워지기 전에 들고 있는 수량의 감시.

진입 주문이 일부만 채워졌거나(남은 수량은 아직 걸려 있음), 들고 있는 채로 추가
진입 주문이 나가 있어도 **들고 있는 수량에는 손절·익절·추적 청산과 세션 끝 청산이
붙습니다.** 청산을 낼 때는 남은 진입 주문을 먼저 거둡니다 — 두면 청산한 뒤에
채워져 닫은 보유가 다시 섭니다.

**계좌에도 NH선물 서버에도 닿지 않습니다.** 종이 장부와, 주문·취소를 받아 적기만
하는 가짜 계좌로 봅니다.
"""
from __future__ import annotations

from collections.abc import Callable

import pytest

from backend.strategy import engine, paper, runs, sim
from tests.test_strategy_engine import (
    _규칙,
    _넣기,
    _때,
    _매수_보유,
    _설정,
    _엔진,
    _조건,
    _틱,
    _호가,
    주간,
    지연,
)


def _반쪽_진입(side: str = paper.BUY) -> tuple[engine.RunEngine, int]:
    """시장가 2계약 진입에 호가 잔량이 1계약뿐입니다. 남은 1계약은 다음 호가를 기다립니다.

    매수는 101.5 에, 매도는 99.0 에 1계약이 채워집니다. 손절은 2틱입니다.
    """
    설정 = _설정(stopTicks="2", takeTicks="100", perOrder="2")
    if side == paper.SELL:
        설정["rules"]["buyEntry"] = {"on": False, "steps": []}
        설정["rules"]["sellEntry"] = _규칙(_조건(op="lt", right="100"))
        가격들 = (101.0, 99.0, 99.0)
        호가 = _호가(99.5, 99.0, quantity=1)
    else:
        가격들 = (99.0, 101.0, 101.0)
        호가 = _호가(101.5, 101.0, quantity=1)
    엔진 = _엔진(설정, qty=2)
    for 분, 값 in enumerate(가격들):
        _넣기(엔진, 분, 값)
    때 = _때(10, 2) + 지연
    엔진.on_book(호가, at=때)
    return 엔진, 때


def _추가_대기() -> tuple[engine.RunEngine, int]:
    """101.5 에 1계약을 들고 있고, 추가 진입 1계약이 호가를 기다리며 걸려 있습니다."""
    엔진, 때 = _매수_보유(stopTicks="2", takeTicks="100", addWhileOpen=True)
    엔진._send(paper.BUY, 1, 101.5, "entry", 때 + 5)
    assert 엔진.run.state == runs.ENTERING and len(엔진.open_orders) == 1
    return 엔진, 때


# ── 일부 체결 ──────────────────────────────────────────


@pytest.mark.parametrize(("side", "너머"), [(paper.BUY, 101.3), (paper.SELL, 99.2)])
def test_진입이_일부만_채워지면_보유_중이고_든_수량에_손절이_나간다(side, 너머):
    엔진, 때 = _반쪽_진입(side)
    assert 엔진.ledger.position.side == side and 엔진.ledger.position.size == 1
    assert 엔진.run.state == runs.HOLDING, "진입 주문 중에 두면 손절을 보지 않습니다."
    (남은,) = 엔진.open_orders
    assert 남은["intent"] == "entry" and 남은["remaining"] == 1

    _틱(엔진, 때 + 10, 너머)  # 손절선(평균가 ∓ 2틱) 너머

    assert 엔진.run.state == runs.EXITING and 엔진._exit_reason == engine.STOP_LOSS
    (청산,) = 엔진.open_orders
    assert 청산["intent"] == "exit" and 청산["quantity"] == 1, "든 1계약만 닫습니다."
    assert 청산["side"] == (paper.SELL if side == paper.BUY else paper.BUY)


def test_전량_체결과_일부_체결이_같은_시세에서_같은_청산을_낸다():
    """보고된 비교 그대로 — 1계약 전량과 2계약 중 1계약이 같은 손절을 냅니다."""
    전량, 때1 = _매수_보유(stopTicks="2", takeTicks="100")
    일부, 때2 = _반쪽_진입(paper.BUY)

    _틱(전량, 때1 + 10, 101.3)
    _틱(일부, 때2 + 10, 101.3)

    def 청산들(엔진):
        return [(one["side"], one["quantity"], one["reason"]) for one in 엔진.open_orders]

    assert 청산들(일부) == 청산들(전량) == [(paper.SELL, 1, engine.STOP_LOSS)]


def test_청산을_내면_남은_진입_주문을_거두고_청산_뒤에_다시_서지_않는다():
    엔진, 때 = _반쪽_진입(paper.BUY)
    _틱(엔진, 때 + 10, 101.3)
    진입 = 엔진.book.orders[0]
    assert 진입.status == paper.CANCELLED and 진입.filled == 1
    assert 진입.reason == engine.EXIT_WITHDRAW_TEXT

    엔진.on_book(_호가(101.35, 101.3), at=때 + 10 + 지연)  # 청산이 채워지는 호가 — 잔량이 넉넉합니다.
    assert 엔진.ledger.position.quantity == 0 and 엔진.run.state == runs.ARMED

    엔진.on_book(_호가(101.35, 101.3), at=때 + 1_000)
    assert 엔진.ledger.position.quantity == 0, "거둔 진입 주문은 채워지지 않습니다."
    assert 엔진.open_orders == []


def test_일부_체결_중에도_익절이_든_수량에_나간다():
    엔진, 때 = _반쪽_진입(paper.BUY)
    엔진.aux["takeTicks"] = "2"  # 익절선 101.6

    _틱(엔진, 때 + 10, 101.6)

    assert 엔진.run.state == runs.EXITING and 엔진._exit_reason == engine.TAKE_PROFIT
    assert [one["quantity"] for one in 엔진.open_orders] == [1]


def test_남은_수량이_나중에_채워지면_보유를_늘리고_보유_중에_머문다():
    엔진, 때 = _반쪽_진입(paper.BUY)

    엔진.on_book(_호가(101.6, 101.0, quantity=1), at=때 + 20)

    assert 엔진.ledger.position.quantity == 2 and 엔진.run.state == runs.HOLDING
    assert 엔진.open_orders == []


def test_남은_수량이_취소돼도_든_수량은_보유_중으로_감시한다():
    엔진, 때 = _반쪽_진입(paper.BUY)

    엔진.close_session(때 + 10)  # 세션이 끝나 걸린 주문을 거둡니다.

    assert 엔진.ledger.position.quantity == 1 and 엔진.run.state == runs.HOLDING
    assert 엔진.exit_lines(), "손절·익절 선이 그대로 섭니다."


# ── 추가 진입이 나가 있는 동안 ───────────────────────────


def test_추가_진입_주문이_나가_있는_동안에도_앞서_든_수량에_손절이_나간다():
    엔진, 때 = _추가_대기()

    _틱(엔진, 때 + 10, 101.3)

    assert 엔진.run.state == runs.EXITING and 엔진._exit_reason == engine.STOP_LOSS
    추가 = 엔진.book.orders[1]
    assert 추가.status == paper.CANCELLED and 추가.filled == 0
    assert 추가.reason == engine.EXIT_WITHDRAW_TEXT
    (청산,) = 엔진.open_orders
    assert 청산["intent"] == "exit" and 청산["quantity"] == 1


def test_추가_진입이_안_채워지고_닫혀도_보유_중으로_돌아간다():
    """감시 중으로 가면 앞서 든 1계약에 손절도 청산 규칙도 붙지 않습니다."""
    엔진, 때 = _추가_대기()

    엔진.close_session(때 + 10)

    assert 엔진.ledger.position.quantity == 1 and 엔진.run.state == runs.HOLDING
    assert 엔진.exit_lines()


@pytest.mark.parametrize("만들기", [_반쪽_진입, _추가_대기], ids=["일부체결", "추가진입"])
def test_세션_끝_정리는_진입_주문을_거두고_든_수량을_닫는다(만들기: Callable):
    엔진, 때 = 만들기()

    assert 엔진.session_end(때 + 10, until=때 + 60_000)

    assert 엔진.run.state == runs.EXITING and 엔진._exit_reason == engine.SESSION_END
    (청산,) = 엔진.open_orders
    assert 청산["intent"] == "exit" and 청산["quantity"] == 1
    assert all(not one.open for one in 엔진.book.orders if 엔진._purpose.get(one.id) != "exit")


# ── 계좌 갈래 ──────────────────────────────────────────


class _가짜계좌:
    """주문·취소를 받아 적기만 합니다. 계좌에 닿지 않습니다."""

    def __init__(self) -> None:
        self.orders: list[dict] = []
        self.cancelled: list[str] = []

    def order(self, **물음):
        self.orders.append(물음)
        return {"id": f"{len(self.orders):010d}"}

    def cancel(self, *, run, order):
        self.cancelled.append(order.order_no)
        return {"id": f"9{len(self.cancelled):09d}"}


def _모의_반쪽() -> tuple[engine.RunEngine, _가짜계좌, int]:
    """모의 계좌 실행. 지정가 101 에 2계약을 내고 계좌 알림으로 1계약만 채워졌습니다."""
    run = runs.Run(
        id="r1", version_id="v1", code="A7569000", session=주간, market="domestic",
        state=runs.ARMED, qty=2, cash=10_000_000.0, multiplier=1.0,
        draft=_설정(orderType="지정가", stopTicks="2", takeTicks="100", perOrder="2"),
        mode=runs.SIM, approved_at=1_000, environment="paper",
    )
    계좌 = _가짜계좌()
    엔진 = engine.RunEngine(
        run, tick=0.05, book=sim.SimBroker(run, sender=계좌, environment=lambda: "paper")
    )
    for 분, 값 in enumerate((99.0, 101.0, 101.0)):
        _넣기(엔진, 분, 값)
    assert [one["quantity"] for one in 계좌.orders] == [2]
    때 = _때(10, 3)
    엔진.on_order({"id": "0000000001", "filled": 1, "fillPrice": 101.0}, at=때)
    assert 엔진.ledger.position.quantity == 1
    return 엔진, 계좌, 때


def test_모의_계좌도_일부_체결이면_보유_중이고_손절에_앞서_남은_수량을_취소한다():
    엔진, 계좌, 때 = _모의_반쪽()
    assert 엔진.run.state == runs.HOLDING

    _틱(엔진, 때 + 10, 100.85)  # 손절선 100.9 너머

    assert 계좌.cancelled == ["0000000001"], "남은 1계약에 취소를 냅니다."
    assert [one["quantity"] for one in 계좌.orders] == [2, 1], "청산은 든 1계약입니다."
    assert 계좌.orders[1]["order_type"] == paper.MARKET_ORDER
    assert 엔진.run.state == runs.EXITING and 엔진._exit_reason == engine.STOP_LOSS


def test_모의_계좌에서_취소가_닿기_전에_남은_수량이_채워지면_보유_중으로_돌아와_다시_닫는다():
    """청산 1계약이 채워진 뒤에도 1계약이 남습니다. 감시 중으로 가지 않습니다."""
    엔진, 계좌, 때 = _모의_반쪽()
    _틱(엔진, 때 + 10, 100.85)

    엔진.on_order({"id": "0000000001", "filled": 2, "fillPrice": 101.0}, at=때 + 20)
    엔진.on_order({"id": "0000000002", "filled": 1, "fillPrice": 100.85, "status": "filled"}, at=때 + 30)

    assert 엔진.ledger.position.quantity == 1 and 엔진.run.state == runs.HOLDING

    _틱(엔진, 때 + 40, 100.85)
    assert [one["quantity"] for one in 계좌.orders] == [2, 1, 1]
    assert 엔진.run.state == runs.EXITING


def test_모의_계좌에서_청산이_먼저_채워지고_남은_수량이_늦게_채워져도_보유_중이다():
    엔진, 계좌, 때 = _모의_반쪽()
    _틱(엔진, 때 + 10, 100.85)
    엔진.on_order({"id": "0000000002", "filled": 1, "fillPrice": 100.85, "status": "filled"}, at=때 + 20)
    assert 엔진.ledger.position.quantity == 0 and 엔진.run.state == runs.ARMED

    엔진.on_order({"id": "0000000001", "filled": 2, "fillPrice": 101.0}, at=때 + 30)

    assert 엔진.ledger.position.quantity == 1
    assert 엔진.run.state == runs.HOLDING, "감시 중에 두면 늦게 든 1계약에 손절이 안 붙습니다."
    _틱(엔진, 때 + 40, 100.85)
    assert [one["quantity"] for one in 계좌.orders] == [2, 1, 1]
