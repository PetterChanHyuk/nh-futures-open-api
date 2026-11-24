"""차트 조회와 실시간 봉이 겹쳐도 한 칸에는 봉이 하나입니다.

장중의 차트 조회는 아직 안 끝난 칸의 봉까지 줍니다. 실행을 봉 중간에 세우거나 끊겼다
다시 붙으면 그 봉과 실시간으로 세운 봉이 같은 칸에 겹칩니다.

**계좌에도 NH선물 서버에도 닿지 않습니다.** 종이 실행에 봉과 체결을 지어 넣습니다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest

from backend import quotes
from backend.sessions.hours import KST
from backend.strategy import backtest, journal as journal_lib, rules, runs
from backend.strategy import service as service_lib
from backend.strategy.indicators import Bar
from tests.test_strategy_service import _마스터, _물음, _설정, _시간표

주간 = "domestic-day"


def _때(hour: int, minute: int, second: int = 0) -> int:
    return int(datetime(2026, 11, 24, hour, minute, second, tzinfo=KST).timestamp() * 1000)


def _봉(hour: int, minute: int, close: float) -> dict:
    return {
        "timestamp": _때(hour, minute),
        "open": close,
        "high": close,
        "low": close,
        "close": close,
        "volume": 5,
    }


def _세운(tmp_path, 조회: list[dict], **물음):
    목록 = service_lib.RunService(
        store=runs.RunStore(tmp_path / "runs.json"),
        journal=journal_lib.Journal(tmp_path / "trades.jsonl"),
        master=_마스터(),
        hours=_시간표(
            [
                {
                    "productCode": "01",
                    "kind": "futures",
                    "session": "day",
                    "tick": "0.05",
                    "contractInitialMargin": "2500000",
                }
            ]
        ),
        fetch=lambda run, minutes, count: list(조회),
    )
    목록.add(**_물음(**물음))
    엔진 = 목록._engine("run1")
    판정: list[int] = []
    원래 = 엔진._on_bar

    def 세며(bar, context, at):
        판정.append(bar.timestamp)
        원래(bar, context, at)

    엔진._on_bar = 세며
    return 목록, 엔진, 판정


def _체결(엔진, hour: int, minute: int, price: float) -> None:
    when = _때(hour, minute)
    엔진.on_trade({"timestamp": when, "price": price, "quantity": 1}, 주간, at=when)


def _시각들(엔진) -> list[int]:
    return [one.timestamp for one in 엔진.bars.bars]


def test_봉_중간에_세운_실행은_그_봉을_이어_한_번_판정한다(tmp_path):
    _, 엔진, 판정 = _세운(tmp_path, [_봉(9, 50, 97), _봉(9, 55, 98), _봉(10, 0, 99)])

    _체결(엔진, 10, 2, 100.0)

    assert _시각들(엔진) == [_때(9, 50), _때(9, 55)], "아직 안 끝난 봉은 완성 봉으로 세지 않습니다."
    assert 엔진.bars.open_bar.timestamp == _때(10, 0)

    _체결(엔진, 10, 5, 101.0)

    assert _시각들(엔진) == [_때(9, 50), _때(9, 55), _때(10, 0)]
    assert 엔진.bars.bars[-1].close == 100.0
    assert 판정 == [_때(10, 0)]


def test_재접속으로_열린_봉을_다시_조회해도_한_봉이다(tmp_path):
    조회 = [_봉(9, 55, 98)]
    목록, 엔진, 판정 = _세운(tmp_path, 조회)
    _체결(엔진, 10, 1, 100.0)

    조회.append(_봉(10, 0, 99))
    목록.refill("run1")
    _체결(엔진, 10, 5, 101.0)

    assert _시각들(엔진) == [_때(9, 55), _때(10, 0)]
    assert 판정 == [_때(10, 0)]


def test_끊긴_동안_칸이_넘어가도_시각_순서가_유지된다(tmp_path):
    조회 = [_봉(9, 55, 98)]
    목록, 엔진, 판정 = _세운(tmp_path, 조회)
    _체결(엔진, 10, 1, 100.0)

    조회.extend([_봉(10, 0, 99), _봉(10, 5, 102), _봉(10, 10, 103)])
    목록.refill("run1")
    _체결(엔진, 10, 12, 104.0)
    _체결(엔진, 10, 15, 105.0)

    assert _시각들(엔진) == [_때(9, 55), _때(10, 0), _때(10, 5), _때(10, 10)]
    assert 판정 == [_때(10, 10)], "끊긴 동안 끝난 봉은 뒤늦게 판정하지 않습니다."


def test_틱_평가_실행도_같은_칸을_한_봉으로_센다(tmp_path):
    설정 = _설정()
    설정["evalMode"] = "틱"
    _, 엔진, 판정 = _세운(tmp_path, [_봉(9, 55, 98), _봉(10, 0, 99)], draft=설정)

    _체결(엔진, 10, 2, 100.0)
    _체결(엔진, 10, 3, 100.5)
    _체결(엔진, 10, 5, 101.0)

    assert _시각들(엔진) == [_때(9, 55), _때(10, 0)]
    assert 판정 == [_때(10, 0)]


# ── 국내 N분봉의 진행 중인 봉 ────────────────────────────────
#
# 국내 N분봉 조회는 안 끝난 칸에 마지막 1분의 값만 담아 줍니다(2026-11-24 실측).


def _칸(hour, minute, opened, high, low, close, volume) -> dict:
    return {
        "timestamp": _때(hour, minute),
        "open": opened,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }


def _국내실행(session: str = 주간) -> runs.Run:
    return runs.Run(id="r", version_id="", code="A016C000", session=session, market="domestic")


@pytest.fixture
def 조회(monkeypatch):
    """분 단위마다 지어 둔 줄을 답하고, 어떤 분 단위를 물었는지 적어 둡니다."""
    from backend.domestic_futureoption import domestic_futureoption_functions as domestic_api

    답: dict[str, Any] = {
        "5": [_칸(9, 55, 98, 99, 97, 98, 50), _칸(10, 0, 103, 104, 102, 103, 4)],
        "1": [
            _칸(9, 59, 1, 1, 1, 1, 9),
            _칸(10, 0, 100, 101, 99, 100, 7),
            _칸(10, 1, 100, 105, 100, 102, 6),
            _칸(10, 2, 103, 104, 102, 103, 4),
        ],
    }
    물음: list[dict] = []

    def 차트(code, **kwargs):
        물음.append(kwargs)
        found = 답[kwargs["minutes"]]
        if isinstance(found, Exception):
            raise found
        return found

    monkeypatch.setattr(domestic_api, "chart_minute", 차트)
    monkeypatch.setattr(service_lib, "_rows", lambda raw, run, *, minute: list(raw))
    monkeypatch.setattr(
        service_lib, "now_kst", lambda: datetime(2026, 11, 24, 10, 2, 30, tzinfo=KST)
    )
    return 답, 물음


def test_국내_진행_중인_봉은_1분봉을_합쳐_센다(조회):
    _, 물음 = 조회

    (끝난것, 진행) = service_lib._fetch_bars(_국내실행(), 5, 10)

    assert 끝난것 == _칸(9, 55, 98, 99, 97, 98, 50), "끝난 칸은 조회 값 그대로입니다."
    assert (진행["timestamp"], 진행["open"], 진행["high"], 진행["low"], 진행["close"]) == (
        _때(10, 0), 100, 105, 99, 103,
    )
    assert 진행["volume"] == 17, "앞 칸의 1분봉(09:59)은 넣지 않습니다."
    assert [one["minutes"] for one in 물음] == ["5", "1"]


def test_야간_실행은_야간_1분봉으로_센다(조회):
    _, 물음 = 조회

    service_lib._fetch_bars(_국내실행("domestic-night"), 5, 10)

    assert [one["night"] for one in 물음] == [True, True]


def test_1분봉_실행은_다시_묻지_않는다(조회):
    답, 물음 = 조회

    assert service_lib._fetch_bars(_국내실행(), 1, 10) == 답["1"]
    assert [one["minutes"] for one in 물음] == ["1"]


def test_진행_중인_칸이_없으면_다시_묻지_않는다(조회):
    답, 물음 = 조회
    답["5"] = 답["5"][:1]

    assert service_lib._fetch_bars(_국내실행(), 5, 10) == 답["5"]
    assert len(물음) == 1


def test_1분봉을_못_받으면_조회_값을_그대로_쓴다(조회):
    답, _ = 조회
    앞 = list(답["5"])
    답["1"] = RuntimeError("막힘")

    assert service_lib._fetch_bars(_국내실행(), 5, 10) == 앞


def test_국내_30분봉은_08시45분_기준의_진행_중인_봉을_1분봉으로_센다(조회, monkeypatch):
    답, 물음 = 조회
    답["30"] = [_칸(9, 15, 98, 99, 97, 98, 50), _칸(9, 45, 103, 104, 102, 103, 4)]
    답["1"] = [
        _칸(9, 44, 1, 1, 1, 1, 9),
        _칸(9, 45, 100, 101, 99, 100, 7),
        _칸(9, 52, 103, 104, 102, 103, 4),
    ]
    monkeypatch.setattr(
        service_lib, "now_kst", lambda: datetime(2026, 11, 24, 9, 52, 30, tzinfo=KST)
    )

    (_, 진행) = service_lib._fetch_bars(_국내실행(), 30, 10)

    assert (진행["open"], 진행["high"], 진행["low"], 진행["close"], 진행["volume"]) == (
        100, 104, 99, 103, 11,
    )
    assert [one["minutes"] for one in 물음] == ["30", "1"]


def test_봉_순서는_조회_봉의_칸_기준으로_센다(tmp_path):
    설정 = _설정()
    설정["baseBar"] = "30분봉"
    _, 엔진, 판정 = _세운(
        tmp_path, [_봉(8, 45, 97), _봉(9, 15, 98), _봉(9, 45, 99)], draft=설정
    )
    엔진.note_open(주간, _때(8, 45))

    _체결(엔진, 9, 52, 100.0)
    _체결(엔진, 10, 15, 101.0)

    assert _시각들(엔진) == [_때(8, 45), _때(9, 15), _때(9, 45)]
    assert 판정 == [_때(9, 45)]
    assert 엔진._mark_row(엔진.bars.bars[-1], 주간, {})[rules.BAR_ORDER] == 3.0


def test_백테스트는_받은_봉의_칸_기준_그대로_돈다():
    """정각으로 끊으면 08:45 봉이 08:30 봉으로 적혀 닫히는 시각이 15분 앞섭니다."""
    봉들 = [
        Bar(timestamp=_때(8, 45) + 30 * 60_000 * at, open=100.0 + at, high=101.0 + at,
            low=99.0 + at, close=100.5 + at, volume=10.0)
        for at in range(5)
    ]
    설정 = _설정(stopTicks="", takeTicks="")
    설정["baseBar"] = "30분봉"
    설정["rules"]["buyEntry"]["steps"][0]["conds"][0]["right"] = "102"
    받음: list[int] = []

    class 엔진(backtest.BacktestEngine):
        def _on_bar(self, bar, context, at):
            받음.append(bar.timestamp)
            super()._on_bar(bar, context, at)

    원래 = backtest.BacktestEngine
    backtest.BacktestEngine = 엔진
    try:
        backtest.compute(
            draft=설정,
            market="domestic",
            code="A016C000",
            session=주간,
            bars=봉들,
            tick=0.05,
            multiplier=250000.0,
            margin=None,
            kind="futures",
        )
    finally:
        backtest.BacktestEngine = 원래

    assert 받음, "판정한 봉이 있어야 합니다."
    assert set(받음) <= {one.timestamp for one in 봉들}


# ── NH 분봉 응답을 한 칸 한 줄로 ─────────────────────────────


def _원문(날짜: str, 시각: str, 값: float, 거래량: int, 영업일: str = "") -> dict:
    return {
        "occurs1_ref_dt": 날짜,
        "occurs1_glb_biz_dt": 영업일 or 날짜,
        "occurs1_exch_tm": 시각,
        "occurs1_open_pric": str(값),
        "occurs1_high_pric": str(값 + 1),
        "occurs1_low_pric": str(값 - 1),
        "occurs1_close_pric": str(값 + 0.5),
        "occurs1_cum_trd_qty": str(거래량),
    }


def _시각(날, hour, minute) -> int:
    return int(datetime(2026, 11, 날, hour, minute, tzinfo=KST).timestamp() * 1000)


지금 = _시각(24, 10, 30)


def test_새_줄부터_온_응답을_오래된_것부터_낸다():
    줄들 = quotes.slot_bars(
        {"Occurs1": [_원문("20261124", "100500", 2, 1), _원문("20261124", "100000", 1, 1)]},
        now=지금,
    )

    assert [one["timestamp"] for one in 줄들] == [_시각(24, 10, 0), _시각(24, 10, 5)]


def test_칸_안에서_영업일이_바뀌면_두_줄을_한_봉으로_합친다():
    """홍콩 5분봉 18:05 처럼 새 영업일 줄이 먼저, 앞 영업일 줄이 뒤에 옵니다."""
    (봉,) = quotes.slot_bars(
        {
            "Occurs1": [
                _원문("20261123", "180500", 200, 9, 영업일="20261124"),
                _원문("20261123", "180500", 100, 2, 영업일="20261123"),
            ]
        },
        now=지금,
    )

    assert (봉["open"], 봉["high"], 봉["low"], 봉["close"], 봉["volume"]) == (
        100.0, 201.0, 99.0, 200.5, 11,
    )


def test_자정을_넘는_칸의_밀린_날짜를_하루_당긴다():
    """첫 체결이 자정 뒤인 23:50 칸은 다음 날 23:50 으로 적혀 옵니다."""
    줄들 = quotes.slot_bars(
        {
            "Occurs1": [
                _원문("20261124", "002000", 3, 1),
                _원문("20261124", "235000", 2, 7),
                _원문("20261123", "232000", 1, 1),
            ]
        },
        now=지금,
    )

    assert [one["timestamp"] for one in 줄들] == [
        _시각(23, 23, 20), _시각(23, 23, 50), _시각(24, 0, 20),
    ]


def test_지난_날의_밀린_날짜도_응답_차례로_당긴다():
    줄들 = quotes.slot_bars(
        {
            "Occurs1": [
                _원문("20261123", "002000", 3, 1),
                _원문("20261123", "235000", 2, 7),
                _원문("20261122", "232000", 1, 1),
            ]
        },
        now=지금,
    )

    assert 줄들[1]["timestamp"] == _시각(22, 23, 50)


def test_맨_새_줄의_날짜가_밀렸으면_지금_시각으로_당긴다():
    새벽 = _시각(24, 0, 5)
    줄들 = quotes.slot_bars(
        {"Occurs1": [_원문("20261124", "235000", 2, 7), _원문("20261123", "232000", 1, 1)]},
        now=새벽,
    )

    assert [one["timestamp"] for one in 줄들] == [_시각(23, 23, 20), _시각(23, 23, 50)]


def test_시계가_조금_늦어도_방금_열린_칸을_하루_앞으로_옮기지_않는다():
    줄들 = quotes.slot_bars(
        {"Occurs1": [_원문("20261124", "103000", 2, 1), _원문("20261124", "102500", 1, 1)]},
        now=_시각(24, 10, 30) - 2_000,
    )

    assert 줄들[-1]["timestamp"] == _시각(24, 10, 30)


def test_읽지_못하는_줄은_빼고_없는_응답은_빈_목록이다():
    assert quotes.slot_bars({}, now=지금) == []
    assert quotes.slot_bars({"Occurs1": "줄이 아님"}, now=지금) == []
    (봉,) = quotes.slot_bars({"Occurs1": ["줄이 아님", _원문("20261124", "100000", 1, 1)]}, now=지금)
    assert 봉["timestamp"] == _시각(24, 10, 0)


def test_해외_분봉은_칸_전체가_오므로_다시_묻지_않는다(monkeypatch):
    from backend.overseas_futureoption import overseas_futureoption_functions as overseas_api

    줄 = [_칸(10, 0, 100, 105, 99, 103, 17)]
    물음: list[dict] = []
    monkeypatch.setattr(
        overseas_api, "chart_minute", lambda code, **kwargs: 물음.append(kwargs) or 줄
    )
    monkeypatch.setattr(service_lib, "_rows", lambda raw, run, *, minute: list(raw))
    monkeypatch.setattr(
        service_lib, "now_kst", lambda: datetime(2026, 11, 24, 10, 2, 30, tzinfo=KST)
    )
    실행 = runs.Run(
        id="e", version_id="", code="ESZ26", session="overseas", market="overseas", exchange="FCME"
    )

    assert service_lib._fetch_bars(실행, 5, 10) == 줄
    assert len(물음) == 1
