"""단일가(동시호가) 구간의 공백 판정과 종가 단일가로 끝나는 세션의 마감.

**계좌에도 NH선물 서버에도 닿지 않습니다.** 체결·세션 판정·단일가 구간은 손으로
넣고, 실행 파일·기록 파일은 임시 폴더에 씁니다.
"""
from __future__ import annotations

from backend.strategy import engine, paper, pump as pump_lib, runs, sim
from tests.test_strategy_engine import _때, _매수_보유, _설정, _엔진, _호가, 지연
from tests.test_strategy_paper_v2 import _목록

주간 = "domestic-day"
#: 종가 단일가 구간. 15:35 부터 15:45 까지이고, 세션은 15:45 에 닫힙니다.
종가구간 = (_때(15, 35), _때(15, 45))
#: 거래 창에서 받는 「다음 경계부터」의 구간 — 종가 단일가 시작부터 다음 개장까지.
다음경계 = (_때(15, 35), _때(8, 45, day=18))
유예 = engine.CLOSING_PRINT_WAIT_SECONDS * 1000


def _일봉(**aux) -> dict:
    return {**_설정(**aux), "baseBar": "일봉"}


def _틱(엔진: engine.RunEngine, 때: int, price: float) -> None:
    엔진.on_trade({"timestamp": 때, "price": price, "quantity": 1}, 주간, at=때)


def _공백(엔진: engine.RunEngine) -> list[str]:
    return [one["text"] for one in 엔진.events if one["kind"] == engine.GAP]


def _끝남(엔진: engine.RunEngine) -> list[str]:
    return [one["text"] for one in 엔진.events if one["kind"] == engine.SESSION]


def _판정(when: int) -> bool:
    """15:45 까지 주간 창이 열려 있습니다(종가 단일가 포함)."""
    return when < 종가구간[1]


def _구간(when: int) -> tuple[int, int] | None:
    """세션 판정이 내는 단일가 구간 — 거래 창이면 다음 경계부터, 단일가 중이면 그 구간."""
    return 다음경계 if when < 종가구간[0] else 종가구간


def _펌프(tmp_path, draft: dict):
    """실행 하나와 그 실행을 보는 펌프. 세션 판정·단일가 구간을 손으로 넣습니다."""
    목록 = _목록(tmp_path)
    목록.add(run_id="r1", version_id="v1", draft=draft, market="domestic", code="A7569000",
            session=주간, qty=1, cash=10_000_000.0)
    엔진 = 목록._engine("r1")
    지금 = {"at": 0}
    돌리는것 = pump_lib.RunPump(
        목록,
        hub=None,
        judge=lambda *a: _판정(지금["at"]),
        auction=lambda *a: _구간(지금["at"]),
        # 세션 끝 정리가 보는 거래 창의 끝 — 거래 창 안에서만 답합니다(`pump._closing_now`).
        closing=lambda *a: 종가구간[0] if 지금["at"] < 종가구간[0] else None,
        replaying=lambda: False,
    )
    엔진.note_open(주간, _때(8, 45))
    # 전날 일봉 하나. 준비 봉(2)을 채우고, 종가 99 → 오늘 100 위로 진입 규칙이 걸립니다.
    엔진.seed([{"timestamp": _때(0, 0, day=16), "close": 99.0}], 주간)

    def 흐른다(처음: int, 끝: int, 걸음: int = 1000) -> None:
        """박자처럼 시계를 돌리고 초마다 세션·세션 끝 정리를 봅니다. 시계가 먼저입니다(`RunPump.beat`)."""
        for when in range(처음, 끝 + 1, 걸음):
            지금["at"] = when
            엔진.tick_clock(when)
            돌리는것._sessions(when)
            돌리는것._session_ends(when)

    return 엔진, 흐른다


# ── 종가 단일가 동안 체결 없음 ─────────────────────────────


def test_종가_단일가_동안_체결이_없어도_공백이_아니고_세션_끝_일봉을_판정한다(tmp_path):
    """제보된 모양 — 15:34:59 마지막 체결, 15:35~15:45 체결 0건, 15:45 세션 끝."""
    엔진, 흐른다 = _펌프(tmp_path, _일봉())
    흐른다(_때(15, 30), _때(15, 30))
    _틱(엔진, _때(15, 30), 100.5)
    _틱(엔진, _때(15, 34, 59), 101.0)

    흐른다(_때(15, 35), _때(15, 45))
    assert _공백(엔진) == [], "종가 단일가 동안 체결이 없는 것은 공백이 아닙니다."
    assert 엔진.feed != engine.GAP
    assert _끝남(엔진) == [], "종가 단일가 체결을 기다리는 동안은 아직 닫지 않습니다."

    _틱(엔진, _때(15, 45, 1), 102.0)  # 종가 단일가 체결
    흐른다(_때(15, 45, 2), _때(15, 45, 30))

    봉 = 엔진.bars.bars[-1]
    assert 봉.close == 102.0, "세션 끝 봉의 종가가 종가 단일가 체결가입니다."
    표 = 엔진.conditions
    assert 표["state"] == engine.TABLE_READY and 표["barTime"] == 봉.timestamp
    (규칙,) = 표["rules"]
    assert 규칙["judged"] is True and 규칙["fired"] is True
    (조건,) = 규칙["stepsDetail"][0]["conds"]
    assert 조건["leftValue"] == 102.0
    assert [one["text"] for one in 엔진.events if one["kind"] == engine.SIGNAL] == ["매수 진입 규칙이 걸렸습니다"]
    종류 = [one["kind"] for one in 엔진.events]
    assert 종류.index(engine.SIGNAL) < 종류.index(engine.SESSION), "판정이 먼저, 「세션이 끝났습니다」가 뒤입니다."
    assert _끝남(엔진) == ["세션이 끝났습니다"]
    assert _공백(엔진) == [], "공백이 없었으니 「시세가 다시 들어옵니다」도 없습니다."


def test_마감에서_걸린_일봉_진입은_종가_체결을_담은_뒤_미룬다():
    """마감 판정은 지금처럼 주문을 다음 거래 창으로 미룹니다 — 기다린 뒤에 닫아도 같습니다."""
    엔진 = _엔진(_일봉())
    엔진.seed([{"timestamp": _때(0, 0, day=16), "close": 99.0}], 주간)
    _틱(엔진, _때(15, 34, 59), 99.5)
    엔진.set_auction(종가구간, at=_때(15, 44, 59))

    엔진.close_session(_때(15, 45))
    assert 엔진._deferred == {} and 엔진.bars.bars[-1].close == 99.0
    _틱(엔진, _때(15, 45, 1), 101.0)

    assert sorted(엔진._deferred) == ["entry"] and 엔진.book.orders == []
    assert 엔진.bars.bars[-1].close == 101.0


def test_종가_단일가_체결이_안_오면_유예_뒤_마지막_체결가로_닫는다(tmp_path):
    엔진, 흐른다 = _펌프(tmp_path, _일봉())
    흐른다(_때(15, 30), _때(15, 30))
    _틱(엔진, _때(15, 34, 59), 101.0)

    흐른다(_때(15, 35), _때(15, 45) + 유예 - 1000)
    assert _끝남(엔진) == [] and len(엔진.bars.bars) == 1

    흐른다(_때(15, 45) + 유예, _때(15, 45) + 유예)
    봉 = 엔진.bars.bars[-1]
    assert 봉.close == 101.0
    assert 엔진.conditions["state"] == engine.TABLE_READY
    assert _끝남(엔진) == ["세션이 끝났습니다"]
    assert _공백(엔진) == []


def test_구간이_끝난_뒤에는_그_끝에서부터_다시_센다(tmp_path):
    """분봉은 기다리지 않고 15:45 에 닫습니다. 공백은 구간 끝 15:45 에서 30초 뒤입니다."""
    엔진, 흐른다 = _펌프(tmp_path, _설정())
    흐른다(_때(15, 30), _때(15, 30))
    _틱(엔진, _때(15, 34, 59), 101.0)

    흐른다(_때(15, 35), _때(15, 45))
    assert _끝남(엔진) == ["세션이 끝났습니다"], "분봉은 종가 단일가 체결을 기다리지 않습니다."
    흐른다(_때(15, 45, 1), _때(15, 45, 29))
    assert _공백(엔진) == []

    흐른다(_때(15, 45, 30), _때(15, 45, 30))
    assert 엔진.feed == engine.GAP
    (글,) = _공백(엔진)
    assert engine.NO_TRADE in 글 and "15:34:59" in 글


def test_종가_체결이_세션_끝_신호보다_먼저_왔으면_바로_닫는다(tmp_path):
    엔진, 흐른다 = _펌프(tmp_path, _일봉())
    흐른다(_때(15, 30), _때(15, 30))
    _틱(엔진, _때(15, 34, 59), 101.0)
    흐른다(_때(15, 35), _때(15, 44, 59))
    _틱(엔진, _때(15, 45), 102.0)

    흐른다(_때(15, 45), _때(15, 45))
    봉 = 엔진.bars.bars[-1]
    assert 봉.close == 102.0 and _끝남(엔진) == ["세션이 끝났습니다"]


def test_기다리는_동안_종이_주문은_채우지_않고_마감에서_거둔다(tmp_path):
    엔진, 흐른다 = _펌프(tmp_path, _일봉())
    흐른다(_때(15, 30), _때(15, 30))
    _틱(엔진, _때(15, 34, 59), 101.0)
    흐른다(_때(15, 35), _때(15, 45))
    주문 = 엔진.book.place("o1", side=paper.BUY, quantity=1, order_type=paper.MARKET_ORDER, at=_때(15, 40))

    엔진.on_book(_호가(101.5, 101.0), at=_때(15, 45, 0, 500))
    assert 주문.filled == 0, "세션 끝 신호 뒤의 호가로 채우지 않습니다."
    _틱(엔진, _때(15, 45, 1), 102.0)

    assert 주문.filled == 0 and not 주문.open
    assert 엔진.book.auction is None


# ── 지금 동작 그대로 ─────────────────────────────────────


def test_단일가_밖에서_30초_체결이_없으면_공백이다():
    엔진 = _엔진()
    _틱(엔진, _때(10, 0), 101.0)
    엔진.set_auction(다음경계, at=_때(10, 0))

    엔진.tick_clock(_때(10, 0) + 엔진.gap_ms - 1)
    assert 엔진.feed != engine.GAP
    엔진.tick_clock(_때(10, 0) + 엔진.gap_ms)
    assert 엔진.feed == engine.GAP
    (글,) = _공백(엔진)
    assert engine.NO_TRADE in 글


def test_단일가_중이어도_연결이_끊기면_공백이다():
    엔진 = _엔진(_일봉())
    _틱(엔진, _때(15, 34, 59), 101.0)
    엔진.set_auction(종가구간, at=_때(15, 36))

    엔진.on_status(False, at=_때(15, 36))
    assert 엔진.feed == engine.GAP
    (글,) = _공백(엔진)
    assert "연결이 끊겼습니다" in 글


def test_품목을_몰라_끝_없는_구간이_오면_공백을_지금처럼_건다():
    엔진 = _엔진()
    _틱(엔진, _때(15, 34, 59), 101.0)
    엔진.set_auction((0, pump_lib._FOREVER), at=_때(15, 35))
    assert 엔진.book.auction == (0, pump_lib._FOREVER), "종이 장부는 지금처럼 늘 미룹니다."

    엔진.tick_clock(_때(15, 34, 59) + 엔진.gap_ms)
    assert 엔진.feed == engine.GAP, "모르는 것을 단일가로 읽어 공백을 영영 안 거는 일이 없습니다."


def test_거래_창에서_받는_다음_경계_구간은_지금_구간이_아니다():
    """박자 사이에 경계를 넘어도, 지금 단일가인지는 그 구간을 받은 시각으로 가립니다."""
    엔진 = _엔진()
    엔진.set_auction(다음경계, at=_때(15, 0))
    assert 엔진._auction_now is None
    엔진.set_auction(종가구간, at=_때(15, 35))
    assert 엔진._auction_now == 종가구간
    엔진.set_auction(None, at=_때(15, 45))
    assert 엔진._auction_now is None


def test_시각_없이_넣은_구간은_공백_판정에_안_쓴다():
    """백테스트·종이 장부만 쓰던 자리 — 시각을 안 주면 지금 구간으로 적지 않습니다."""
    엔진 = _엔진(_일봉())
    _틱(엔진, _때(15, 34, 59), 101.0)
    엔진.set_auction(종가구간)

    엔진.close_session(_때(15, 45))
    assert _끝남(엔진) == ["세션이 끝났습니다"], "구간을 모르면 바로 닫습니다."
    엔진.tick_clock(_때(15, 34, 59) + 엔진.gap_ms)
    assert 엔진.feed == engine.GAP


def test_펌프가_세션을_볼_때_시각을_같이_넘긴다(tmp_path):
    엔진, 흐른다 = _펌프(tmp_path, _설정())
    흐른다(_때(15, 36), _때(15, 36))
    assert 엔진._auction_now == 종가구간 and 엔진.book.auction == 종가구간
    assert 엔진.run.state == runs.ARMED


def test_다음_거래일_첫_체결은_새_봉을_열고_같은_날_봉이_둘_서지_않는다():
    """종가 체결이 닫힌 봉 밖에 홀로 남으면 다음 날 첫 체결에서 같은 날짜의 봉이 하나 더 닫힙니다."""
    엔진 = _엔진(_일봉())
    엔진.seed([{"timestamp": _때(0, 0, day=16), "close": 99.0}], 주간)
    _틱(엔진, _때(15, 34, 59), 99.5)
    엔진.set_auction(종가구간, at=_때(15, 44, 59))
    엔진.close_session(_때(15, 45))
    _틱(엔진, _때(15, 45, 1), 101.0)

    _틱(엔진, _때(9, 0, day=18), 100.0)
    assert [one.timestamp for one in 엔진.bars.bars] == [_때(0, 0, day=16), _때(0, 0, day=17)]
    assert 엔진.bars.open_bar.timestamp == _때(0, 0, day=18)


# ── 갈래·창·평가 방식 ─────────────────────────────────────


class _적는곳:
    """계좌로 나가는 주문을 적기만 합니다."""

    def __init__(self) -> None:
        self.orders: list[dict] = []

    def order(self, **물음):
        self.orders.append(물음)
        return {"id": f"{len(self.orders):010d}"}

    def cancel(self, *, run, order):
        return {"id": order.order_no}


def test_계좌_갈래도_단일가_중에는_공백을_안_걸고_종가_체결을_담아_닫는다():
    """구간은 엔진이 따로 듭니다 — 계좌 갈래 장부에는 단일가 칸이 없습니다."""
    run = runs.Run(
        id="r1", version_id="v1", code="A7569000", session=주간, market="domestic",
        state=runs.ARMED, qty=1, cash=10_000_000.0, multiplier=1.0, draft=_일봉(),
        mode=runs.SIM, approved_at=1_000, environment="paper",
    )
    엔진 = engine.RunEngine(run, tick=0.05, book=sim.SimBroker(run, sender=_적는곳(), environment=lambda: "paper"))
    assert not hasattr(엔진.book, "auction")
    _틱(엔진, _때(15, 34, 59), 101.0)
    엔진.set_auction(종가구간, at=_때(15, 35))

    엔진.tick_clock(_때(15, 44, 59))
    assert 엔진.feed != engine.GAP and _공백(엔진) == []
    엔진.close_session(_때(15, 45))
    _틱(엔진, _때(15, 45, 1), 102.0)
    assert 엔진.bars.bars[-1].close == 102.0 and _끝남(엔진) == ["세션이 끝났습니다"]


def test_야간_일봉도_종가_단일가_체결을_담아_닫는다():
    야간 = "domestic-night"
    엔진 = _엔진(_일봉(), session=야간)
    구간 = (_때(5, 50, day=18), _때(6, 0, day=18))
    엔진.on_trade({"timestamp": _때(5, 49, 59, day=18), "price": 101.0, "quantity": 1}, 야간, at=_때(5, 49, 59, day=18))
    엔진.set_auction(구간, at=_때(5, 50, day=18))

    엔진.tick_clock(_때(5, 59, 59, day=18))
    assert _공백(엔진) == []
    엔진.close_session(_때(6, 0, day=18))
    엔진.on_trade({"timestamp": _때(6, 0, 1, day=18), "price": 102.0, "quantity": 1}, 야간, at=_때(6, 0, 1, day=18))
    assert [one.close for one in 엔진.bars.bars] == [102.0] and _끝남(엔진) == ["세션이 끝났습니다"]


def test_해외는_구간이_없어_지금처럼_공백을_걸고_바로_닫는다():
    엔진 = _엔진(_일봉(), session="overseas", market="overseas", code="ESZ26")
    엔진.on_trade({"timestamp": _때(5, 0), "price": 101.0, "quantity": 1}, "overseas", at=_때(5, 0))
    엔진.set_auction(None, at=_때(5, 0))

    엔진.tick_clock(_때(5, 0) + 엔진.gap_ms)
    assert 엔진.feed == engine.GAP
    엔진.close_session(_때(6, 0))
    assert _끝남(엔진) == ["세션이 끝났습니다"] and len(엔진.bars.bars) == 1


def test_틱_평가_일봉은_단일가_뒤에_쉬지_않고_다음_날_판정한다():
    """공백이 없었으니 「다시 들어옵니다」도, 그 뒤 한 봉 쉬기(`_tick_rest_from`)도 없습니다."""
    엔진 = _엔진({**_일봉(), "evalMode": engine.EVAL_TICK})
    엔진.seed([{"timestamp": _때(0, 0, day=16), "close": 99.0}], 주간)
    _틱(엔진, _때(15, 34, 59), 99.5)
    엔진.set_auction(종가구간, at=_때(15, 35))
    엔진.tick_clock(_때(15, 44, 59))
    엔진.close_session(_때(15, 45))
    _틱(엔진, _때(15, 45, 1), 99.6)
    엔진.judge_tick(_때(15, 45, 1))
    assert 엔진._tick_rest_from is None and _공백(엔진) == []

    _틱(엔진, _때(9, 0, day=18), 101.0)
    엔진.judge_tick(_때(9, 0, day=18))
    표 = 엔진.conditions
    assert 표["partialBar"] is True and 표["barTime"] == _때(0, 0, day=18)


# ── 세션 끝 정리·다시 켜기 ────────────────────────────────


def test_세션_끝_정리는_지금처럼_거래_창_끝_전에_하고_마감은_그_뒤다(tmp_path):
    엔진, 흐른다 = _펌프(tmp_path, _일봉(sessionEndFlat=True, sessionEndMinutes="10", stopTicks="100", takeTicks="100"))
    엔진.ledger.add({"side": paper.BUY, "quantity": 1, "price": 100.0, "time": 1})
    엔진.run.state = runs.HOLDING
    흐른다(_때(15, 20), _때(15, 20))
    _틱(엔진, _때(15, 24, 59), 101.0)

    흐른다(_때(15, 25), _때(15, 25))
    엔진.on_book(_호가(101.05, 101.0), at=_때(15, 25) + 지연)
    assert 엔진.ledger.position.quantity == 0, "세션 끝 정리가 15:25 에 보유를 닫았습니다."
    _틱(엔진, _때(15, 34, 59), 101.0)

    흐른다(_때(15, 34, 59), _때(15, 45))
    _틱(엔진, _때(15, 45, 1), 102.0)
    흐른다(_때(15, 45, 2), _때(15, 45, 20))
    assert _끝남(엔진)[-2:] == ["세션 끝 정리 — 보유를 닫고 새로 들어가지 않습니다", "세션이 끝났습니다"]
    assert 엔진.bars.bars[-1].close == 102.0 and _공백(엔진) == []


def test_기다리는_동안_앱을_다시_켜면_그날_마감은_세션_끝을_못_받은_날과_같다():
    """미루는 마감은 메모리에만 있습니다. 다시 켠 엔진은 그날 봉을 닫지 않았고, 그날의
    잔고 줄도 앞 봉에서 잡아 둔 값이 없어 늦은 줄로 메워지지 않습니다 — 세션 끝 시각에
    앱이 꺼져 있던 날과 같습니다. 다음 거래일은 그대로 이어집니다."""
    기록: list = []
    처음 = _엔진(_일봉())
    처음.record = lambda kind, row: 기록.append((kind, dict(row)))
    처음.seed([{"timestamp": _때(0, 0, day=16), "close": 99.0}], 주간)
    처음.note_open(주간, _때(8, 45))
    _틱(처음, _때(9, 0), 99.5)
    처음.set_auction(종가구간, at=_때(15, 35))
    처음.close_session(_때(15, 45))
    assert 처음._close_due is not None

    다시 = engine.RunEngine(처음.run, tick=0.05)  # 같은 실행을 다시 세웁니다(메모리는 비어 있음).
    다시.record = 처음.record
    다시.seed([{"timestamp": _때(0, 0, day=16), "close": 99.0}, {"timestamp": _때(0, 0, day=17), "close": 102.0}], 주간)
    다시.note_open(주간, _때(8, 45, day=18))
    _틱(다시, _때(9, 0, day=18), 103.0)
    다시.close_session(_때(15, 45, day=18))

    날 = [row["day"] for kind, row in 기록 if kind == engine.DAY_ROW]
    assert 날 == ["2026-09-18"]
    assert [one.timestamp for one in 다시.bars.bars] == [_때(0, 0, day=16), _때(0, 0, day=17), _때(0, 0, day=18)]


# ── 닫힌 칸의 늦은 체결 ───────────────────────────────────


def _늦게(엔진: engine.RunEngine, 체결시각: int, 받은시각: int, price: float, context: str = 주간) -> None:
    """체결 시각보다 늦게 들어온 체결 하나."""
    엔진.on_trade({"timestamp": 체결시각, "price": price, "quantity": 1}, context, at=받은시각)


def test_유예_뒤에_온_종가_체결은_닫힌_일봉_칸에_새_봉을_안_연다():
    엔진 = _엔진(_일봉())
    엔진.seed([{"timestamp": _때(0, 0, day=16), "close": 99.0}], 주간)
    _틱(엔진, _때(15, 34, 59), 101.0)
    엔진.set_auction(종가구간, at=_때(15, 35))
    엔진.close_session(_때(15, 45))
    엔진.tick_clock(_때(15, 45) + 유예)  # 유예가 지나 마지막 체결가로 닫습니다.
    표 = 엔진.conditions
    assert 표["barTime"] == _때(0, 0, day=17) and 엔진.bars.bars[-1].close == 101.0

    _늦게(엔진, _때(15, 45), _때(15, 45, 12), 102.0)
    assert 엔진.bars.open_bar is None, "닫힌 거래일 칸에 새 봉을 열지 않습니다."
    assert 엔진.book.last_price == 102.0 and 엔진.last_trade_at == _때(15, 45, 12)
    assert 엔진.bars.bars[-1].close == 101.0, "닫힌 봉은 고쳐 쓰지 않습니다."

    _틱(엔진, _때(8, 45, day=18), 103.0)  # 다음 세션의 장 시작 단일가 체결
    assert 엔진.conditions is 표, "다음 날 첫 체결에서 더 판정한 봉이 없습니다."
    assert [one.timestamp for one in 엔진.bars.bars] == [_때(0, 0, day=16), _때(0, 0, day=17)]
    assert 엔진.bars.open_bar.timestamp == _때(0, 0, day=18) and 엔진.bars.open_bar.open == 103.0


def test_단일가_전부터_공백이던_실행의_늦은_체결도_새_봉을_안_연다():
    """이 실행은 기다리지 않고 바로 닫습니다(세션 끝 봉은 지금처럼 공백 표). 늦은 체결은
    공백을 풀지 않고 값만 적으며, 공백은 다음 세션 첫 체결에서 풉니다."""
    엔진 = _엔진(_일봉())
    엔진.seed([{"timestamp": _때(0, 0, day=16), "close": 99.0}], 주간)
    _틱(엔진, _때(15, 0), 101.0)
    엔진.tick_clock(_때(15, 0) + 엔진.gap_ms)
    assert 엔진.feed == engine.GAP
    엔진.set_auction(종가구간, at=_때(15, 35))
    엔진.close_session(_때(15, 45))
    assert 엔진._close_due is None and 엔진.conditions["state"] == engine.TABLE_GAP

    _늦게(엔진, _때(15, 45), _때(15, 45, 1), 102.0)
    assert 엔진.bars.open_bar is None and 엔진.feed == engine.GAP
    assert "시세가 다시 들어옵니다" not in _공백(엔진)

    _틱(엔진, _때(8, 45, day=18), 103.0)
    assert 엔진.feed != engine.GAP and _공백(엔진)[-1] == "시세가 다시 들어옵니다"
    assert [one.timestamp for one in 엔진.bars.bars] == [_때(0, 0, day=16), _때(0, 0, day=17)]
    assert 엔진.bars.open_bar.timestamp == _때(0, 0, day=18)


def test_분봉의_종가_체결은_세션_끝_시각_칸을_안_연다():
    엔진 = _엔진(_설정())
    _틱(엔진, _때(15, 34, 59), 101.0)
    엔진.set_auction(종가구간, at=_때(15, 35))
    엔진.close_session(_때(15, 45, 0, 73))
    (마지막,) = 엔진.bars.bars
    assert 마지막.timestamp == _때(15, 34)

    _늦게(엔진, _때(15, 45), _때(15, 45, 0, 180), 102.0)
    assert 엔진.bars.open_bar is None, "15:45 칸에 체결 하나짜리 봉이 서지 않습니다."

    _틱(엔진, _때(8, 45, day=18), 103.0)
    assert [one.timestamp for one in 엔진.bars.bars] == [_때(15, 34)], "다음 세션 첫 체결이 닫는 봉이 없습니다."
    assert 엔진.bars.open_bar.timestamp == _때(8, 45, day=18)


def test_늦은_체결은_종이_채움도_손절_감시도_안_탄다():
    엔진, 때 = _매수_보유()  # 101.5 매수, 2틱 손절 101.4
    엔진.close_session(_때(15, 45))
    받기 = []
    본래 = 엔진.book.on_trade
    엔진.book.on_trade = lambda trade, *, at: 받기.append(trade) or 본래(trade, at=at)

    _늦게(엔진, _때(15, 45), _때(15, 45, 1), 99.0)
    assert 받기 == [], "닫힌 세션의 체결로 종이 장부를 채우지 않습니다."
    assert 엔진.book.open_orders == []
    assert 엔진.run.state == runs.HOLDING, "손절선 아래 값이어도 닫힌 세션에서는 청산을 내지 않습니다."
    assert 엔진.book.last_price == 99.0


def test_마감_시각_뒤에_체결된_것이면_표지를_거두고_평소대로_받는다():
    """시간표가 틀려 장중에 세션을 닫은 날 — 그 뒤의 체결을 삼키지 않습니다."""
    엔진 = _엔진(_설정())
    _틱(엔진, _때(10, 0, 30), 101.0)
    엔진.close_session(_때(10, 1))
    assert 엔진._late is not None

    _틱(엔진, _때(10, 1, 5), 101.5)
    assert 엔진._late is None
    assert 엔진.bars.open_bar is not None and 엔진.bars.open_bar.timestamp == _때(10, 1)


def test_해외는_닫힌_칸_표지를_안_세운다():
    엔진 = _엔진(_설정(), session="overseas", market="overseas", code="ESZ26")
    엔진.on_trade({"timestamp": _때(5, 59), "price": 101.0, "quantity": 1}, "overseas", at=_때(5, 59))
    엔진.close_session(_때(6, 0))
    assert 엔진._late is None
    엔진.on_trade({"timestamp": _때(5, 59, 59), "price": 101.5, "quantity": 1}, "overseas", at=_때(6, 0, 1))
    assert 엔진.bars.open_bar is not None, "해외는 지금처럼 받습니다."
