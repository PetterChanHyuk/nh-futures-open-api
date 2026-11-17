"""실행의 거래일 — 해외는 시간표의 거래 창으로 셉니다.

**서버에 닿지 않습니다.** 시간표는 손으로 지은 품목 줄(`test_strategy_vwap_day`)이고,
체결은 손으로 넣습니다.
"""
from __future__ import annotations

from datetime import date, datetime

from backend.sessions.hours import KST
from backend.strategy import backtest, bars as bar_lib, engine, paper, records, runs
from tests.test_strategy_engine import _설정
from tests.test_strategy_records import _거래, _조건
from tests.test_strategy_vwap_day import _CME, _HKEX, _거래일, _ms, _봉, _vwap_규칙

해외 = "overseas"


def _자정(day: int) -> int:
    return int(datetime(2026, 9, day, tzinfo=KST).timestamp() * 1000)


def _해외엔진(contract=_CME, draft=None, record=None) -> engine.RunEngine:
    엔진 = engine.RunEngine(
        runs.Run(id="r1", version_id="v1", code="6A", session=해외, market="overseas",
                 state=runs.ARMED, draft=draft or _설정()),
        tick=0.01,
        record=record,
    )
    엔진.trading_day = _거래일(contract)
    return 엔진


def _틱(엔진: engine.RunEngine, 때: int, price: float = 100.0) -> None:
    엔진.on_trade({"timestamp": 때, "price": price, "quantity": 1}, 해외, at=때)


# ── 열쇠 ─────────────────────────────────────────────────


def test_자정을_넘어도_같은_거래일이고_세션_시작에서_넘어간다():
    엔진 = _해외엔진()
    for 때 in (_ms(16, 23, 58), _ms(16, 23, 59), _ms(17, 0, 0)):
        _틱(엔진, 때)
    assert 엔진.run.day_key == _자정(16)
    엔진.run.intents_today = 1

    _틱(엔진, _ms(17, 0, 1))  # 00:00 봉이 닫힘
    _틱(엔진, _ms(17, 0, 2))
    assert 엔진.run.day_key == _자정(16), "KST 자정을 넘겨도 16일 거래일입니다."
    assert 엔진.run.intents_today == 1, "하루 최대 진입 수가 풀리지 않습니다."

    _틱(엔진, _ms(17, 7, 0))
    _틱(엔진, _ms(17, 7, 1))  # 07:00 봉이 닫힘
    assert 엔진.run.day_key == _자정(17)
    assert 엔진.run.intents_today == 0


def test_창_밖의_봉은_앞_봉의_거래일을_잇는다():
    엔진 = _해외엔진(_HKEX)
    for 때 in (_ms(16, 12, 59), _ms(16, 13, 30), _ms(16, 14, 0)):
        _틱(엔진, 때)

    assert 엔진._trading_slot(_ms(16, 13, 30), 해외) == _자정(16)
    assert 엔진.run.day_key == _자정(16)


def test_거래일_값은_달력_열쇠와_같은_단위다():
    엔진 = _해외엔진()
    값 = 엔진._trading_slot(_ms(17, 0, 30), 해외)

    assert 값 == bar_lib.day_slot_of(_ms(16, 12, 0), 해외), "16일 0시(KST) 밀리초입니다."
    assert datetime.fromtimestamp(값 / 1000, tz=KST).date() == date(2026, 9, 16)


def test_국내는_달력_열쇠_그대로다():
    엔진 = engine.RunEngine(
        runs.Run(id="r", version_id="", code="A", session="domestic-night", market="domestic", draft=_설정()),
        tick=0.05,
    )
    때 = _ms(16, 23, 0)
    assert 엔진._trading_slot(때, "domestic-night") == bar_lib.day_slot_of(때, "domestic-night")
    assert 엔진._day_text(때) is None


# ── 기록 ─────────────────────────────────────────────────


def test_잔고_줄은_거래일을_적고_기록은_그_날로_묶는다():
    기록: list = []
    엔진 = _해외엔진(record=lambda kind, row: 기록.append((kind, dict(row))))
    엔진.ledger.add({"side": paper.BUY, "quantity": 1, "price": 100.0, "time": _ms(16, 23, 0)})
    엔진.run.state = runs.HOLDING
    for 때 in (_ms(16, 23, 58), _ms(17, 0, 10)):
        _틱(엔진, 때)
    엔진.close_session(_ms(17, 6, 0))

    (잔고,) = [row for kind, row in 기록 if kind == engine.DAY_ROW]
    assert 잔고["day"] == "2026-09-16", "자정 뒤 봉까지 16일 거래일의 잔고 줄 하나입니다."
    줄 = {**_거래(_ms(17, 0, 30), market="overseas", session=해외), "tradingDay": "2026-09-16"}
    assert records.day_of_row(줄) == date(2026, 9, 16)
    묶음 = records.dataset([줄], _조건(market="overseas"))
    assert 묶음["dates"] == ["2026-09-16"]


def test_체결로_닫힌_거래_줄에_거래일이_실린다():
    기록: list = []
    엔진 = _해외엔진(record=lambda kind, row: 기록.append((kind, dict(row))))
    _틱(엔진, _ms(16, 23, 58))
    엔진.ledger.add({"side": paper.BUY, "quantity": 1, "price": 100.0, "time": _ms(16, 23, 0)})
    엔진.run.state = runs.HOLDING
    엔진.book.last_price = 100.0
    엔진._close(1, 100.0, engine.STOP_LOSS, _ms(17, 0, 30))
    엔진.on_book({"asks": [{"price": 100.05, "quantity": 9}], "bids": [{"price": 100.0, "quantity": 9}]},
                 at=_ms(17, 0, 31))

    (거래,) = [row for kind, row in 기록 if kind == "trade"]
    assert 거래["tradingDay"] == "2026-09-16"
    (주문,) = [row for kind, row in 기록 if kind == engine.ORDER_ROW]
    assert 주문["tradingDay"] == "2026-09-16"


def test_칸_없는_옛_줄과_국내_줄은_지금_셈_그대로다():
    옛 = _거래(_ms(17, 0, 30), market="overseas", session=해외)
    국내 = _거래(_ms(16, 23, 0), session="domestic-night")

    assert records.day_of_row(옛) == records.trading_day(_ms(17, 0, 30), 해외) == date(2026, 9, 17)
    assert records.day_of_row(국내) == records.trading_day(_ms(16, 23, 0), "domestic-night")


# ── 개장 열쇠·미룬 일봉 주문 ─────────────────────────────────


def test_해외_일봉_미룬_주문은_자정_뒤_체결에서도_나간다():
    엔진 = _해외엔진(draft={**_설정(), "baseBar": "일봉"})
    엔진.note_open(해외, _ms(16, 7, 0))
    엔진._defer("entry", paper.BUY, 100.0, _ms(16, 6, 0))

    _틱(엔진, _ms(17, 0, 30))

    assert len(엔진.book.orders) == 1, "개장 열쇠가 거래일이라 자정 뒤에도 찾습니다."


# ── 바뀌는 순간 ───────────────────────────────────────────


def test_옛_셈으로_담긴_열쇠는_넘어가지_않고_고쳐_쓴다():
    엔진 = _해외엔진()
    엔진.run.day_key = _자정(17)  # 옛 셈: 자정에 이미 17일로 넘어가 있음
    엔진.run.intents_today = 2
    엔진.run.day_base = -50.0

    _틱(엔진, _ms(17, 0, 30))
    _틱(엔진, _ms(17, 0, 31))

    assert 엔진.run.day_key == _자정(16)
    assert 엔진.run.intents_today == 2 and 엔진.run.day_base == -50.0, "다시 켠 것만으로 풀리지 않습니다."


# ── 지난 봉 셈 ────────────────────────────────────────────


def test_지난_봉_셈의_해외_거래일도_실행_엔진과_같은_답이다(monkeypatch):
    봉들 = [_봉(16, 23, minute, 100.0 + (minute % 7) * 0.05) for minute in range(30, 60)]
    봉들 += [_봉(17, 0, minute, 100.0 + (minute % 5) * 0.05) for minute in range(0, 30)]

    def 셈():
        return backtest.compute(
            draft=_vwap_규칙(), market="overseas", code="6A", session=해외, bars=봉들, tick=0.01,
            margin=1_000.0, trading_day=_거래일(_CME),
        )

    빠른 = 셈()

    class 그냥(engine.RunEngine):
        def __init__(self, run, *, every, trading_day=None, **kwargs):
            super().__init__(run, **kwargs)
            self.trading_day = trading_day

    monkeypatch.setattr(backtest, "BacktestEngine", 그냥)
    assert 셈() == 빠른


# ── 해외 일봉 ─────────────────────────────────────────────
#
# 해외 일봉은 시간표의 거래 창이 시작한 날로 묶습니다. 한국 시각 자정을 넘기는
# 세션(CME 07:00~익일 06:00)도 한 봉이라 자정에 닫히지 않습니다.


def _ms초(day: int, hour: int, minute: int, second: int) -> int:
    return int(datetime(2026, 9, day, hour, minute, second, tzinfo=KST).timestamp() * 1000)


def _일봉(day: int, close: float) -> dict:
    return {"timestamp": _자정(day), "open": close, "high": close, "low": close, "close": close, "volume": 1}


def _해외일봉엔진(contract=_CME, record=None) -> engine.RunEngine:
    """「종가 > 100 이면 시장가 매수」 일봉 실행. 앞 이틀의 일봉(종가 99)을 깔아 둡니다."""
    엔진 = _해외엔진(contract, draft={**_설정(), "baseBar": "일봉"}, record=record)
    엔진.seed([_일봉(14, 99.0), _일봉(15, 99.0)], 해외)
    return 엔진


def _닫힌_날(엔진: engine.RunEngine) -> list[tuple[str, float]]:
    return [
        (datetime.fromtimestamp(one.timestamp / 1000, tz=KST).strftime("%d"), one.close)
        for one in 엔진.bars.bars
    ]


def test_해외_일봉은_한국_자정에_닫히지_않고_주문도_내지_않는다():
    엔진 = _해외일봉엔진()
    엔진.note_open(해외, _ms(16, 7, 0))

    _틱(엔진, _ms초(16, 23, 59, 59), 100.5)
    _틱(엔진, _ms초(17, 0, 0, 1), 101.0)

    assert _닫힌_날(엔진) == [("14", 99.0), ("15", 99.0)], "16일 세션은 아직 안 끝났습니다."
    assert 엔진.bars.open_bar.timestamp == _자정(16) and 엔진.bars.open_bar.close == 101.0
    assert 엔진.book.orders == [], "닫히지 않은 봉으로 판정하지 않습니다."
    assert 엔진.run.day_key == _자정(16), "거래일 열쇠가 앞 날로 돌아가지 않습니다."


def test_해외_일봉은_세션_끝에서_닫혀_판정하고_다음_세션에_낸다():
    기록: list = []
    엔진 = _해외일봉엔진(record=lambda kind, row: 기록.append((kind, dict(row))))
    엔진.note_open(해외, _ms(16, 7, 0))
    _틱(엔진, _ms초(16, 23, 59, 59), 100.5)
    _틱(엔진, _ms초(17, 0, 0, 1), 101.0)

    엔진.close_session(_ms(17, 6, 0))

    assert _닫힌_날(엔진)[-1] == ("16", 101.0), "자정 뒤 체결까지 16일 봉 하나입니다."
    assert 엔진.book.orders == [] and "entry" in 엔진._deferred, "마감 판정의 주문은 다음 세션에 냅니다."
    (잔고,) = [row for kind, row in 기록 if kind == engine.DAY_ROW]
    assert 잔고["day"] == "2026-09-16"

    엔진.note_open(해외, _ms(17, 7, 0))
    _틱(엔진, _ms초(17, 7, 0, 1), 101.0)

    assert len(엔진.book.orders) == 1
    assert 엔진.run.day_key == _자정(17)


def test_해외_일봉은_세션_끝_신호가_없어도_다음_세션_첫_체결에서_닫힌다():
    엔진 = _해외일봉엔진()
    엔진.note_open(해외, _ms(16, 7, 0))
    _틱(엔진, _ms초(16, 23, 59, 59), 100.5)
    _틱(엔진, _ms초(17, 5, 59, 0), 101.0)
    엔진.note_open(해외, _ms(17, 7, 0))

    _틱(엔진, _ms초(17, 7, 0, 1), 99.5)

    assert _닫힌_날(엔진)[-1] == ("16", 101.0)
    assert 엔진.bars.open_bar.timestamp == _자정(17)
    assert 엔진.run.day_key == _자정(17)


def test_해외_일봉의_창_밖_체결은_열린_봉의_날을_잇는다():
    # CME 의 쉬는 시간(06:00~07:00)에 늦게 온 체결.
    엔진 = _해외일봉엔진()
    _틱(엔진, _ms(16, 23, 0), 100.0)
    _틱(엔진, _ms초(17, 6, 30, 0), 100.2)

    assert len(엔진.bars.bars) == 2 and 엔진.bars.open_bar.timestamp == _자정(16)

    # 홍콩의 점심 쉼(13:00~14:00)과 자정을 넘는 익일 구간(18:00~04:00).
    홍콩 = _해외일봉엔진(_HKEX)
    for 때 in (_ms(16, 12, 59), _ms(16, 13, 30), _ms(16, 14, 0), _ms(16, 23, 0), _ms(17, 1, 0)):
        _틱(홍콩, 때)

    assert len(홍콩.bars.bars) == 2 and 홍콩.bars.open_bar.timestamp == _자정(16)


def test_국내_일봉은_전과_같이_달력_날짜로_묶는다():
    엔진 = engine.RunEngine(
        runs.Run(id="r", version_id="", code="A", session="domestic-night", market="domestic",
                 state=runs.ARMED, draft={**_설정(), "baseBar": "일봉"}),
        tick=0.05,
    )
    for 때, 창 in ((_ms(16, 23, 0), "domestic-night"), (_ms(17, 1, 0), "domestic-night"), (_ms(17, 10, 0), "domestic-day")):
        엔진.on_trade({"timestamp": 때, "price": 100.0, "quantity": 1}, 창, at=때)

    assert 엔진.bars.bars == [], "야간과 그 다음 주간이 한 봉(17일)입니다."
    assert 엔진.bars.open_bar.timestamp == bar_lib.day_slot_of(_ms(16, 23, 0), "domestic-night") == _자정(17)


def test_국내_일봉도_앞_날_봉이_닫혀도_거래일을_되돌리지_않는다():
    """세션 끝 신호를 못 받은 날 — 새 날 첫 체결이 거래일을 넘긴 뒤 앞 날 봉을 닫습니다."""
    엔진 = engine.RunEngine(
        runs.Run(id="r", version_id="", code="A", session="domestic-day", market="domestic",
                 state=runs.ARMED, draft={**_설정(), "baseBar": "일봉"}),
        tick=0.05,
    )
    엔진.note_open("domestic-day", _ms(16, 8, 45))
    엔진.on_trade({"timestamp": _ms(16, 10, 0), "price": 99.0, "quantity": 1}, "domestic-day", at=_ms(16, 10, 0))
    엔진.note_open("domestic-day", _ms(17, 8, 45))

    때 = _ms초(17, 8, 45, 1)
    엔진.on_trade({"timestamp": 때, "price": 99.0, "quantity": 1}, "domestic-day", at=때)

    assert _닫힌_날(엔진) == [("16", 99.0)]
    assert 엔진.run.day_key == _자정(17)


def test_지난_봉_셈의_해외_일봉은_받은_봉을_합치지_않는다():
    """받은 일봉은 이미 세션 날짜이고 그 날 0시의 점들로 풀어 넣습니다 — 시간표로 다시 읽지 않습니다."""
    from backend.strategy.indicators import Bar

    봉들 = [Bar(_자정(day), close, close, close, close, 10) for day, close in
            ((14, 99.0), (15, 101.0), (16, 99.0), (17, 101.0), (18, 99.0))]

    def 셈(trading_day):
        return backtest.compute(
            draft={**_설정(), "baseBar": "일봉"}, market="overseas", code="6A", session=해외, bars=봉들,
            tick=0.01, margin=1_000.0, trading_day=trading_day,
        )

    시간표 = 셈(_거래일(_CME))
    assert 시간표 == 셈(None)
    assert 시간표["signals"] >= 1
