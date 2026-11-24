"""체결을 봉으로 세우기.

**봉을 손으로 지어 넣습니다.** 시각은 한국시간으로 만들고, 허브가 내는 체결
모양(`timestamp`·`price`·`quantity`)을 그대로 씁니다.
"""
from __future__ import annotations

from datetime import datetime

from backend.sessions.hours import KST
from backend.strategy import bars

주간 = "domestic-day"
야간 = "domestic-night"


def _때(hour: int, minute: int, second: int = 0, day: int = 17) -> int:
    return int(datetime(2026, 9, day, hour, minute, second, tzinfo=KST).timestamp() * 1000)


def _체결(
    hour: int, minute: int, price: float, quantity: int = 1, second: int = 0, day: int = 17
) -> dict:
    return {"timestamp": _때(hour, minute, second, day), "price": price, "quantity": quantity}


def test_기준_봉_이름이_화면과_같다():
    assert bars.minutes_of("5분봉") == 5
    assert bars.minutes_of("60분봉") == 60
    assert bars.minutes_of(bars.DAILY_BAR) is None, "일봉은 분으로 세지 않습니다."
    assert bars.minutes_of("3분봉") is None


def test_분봉_자리는_정각에서_끊는다():
    """15분봉이면 :00·:15·:30·:45 입니다."""
    때 = _때(10, 7, 30)

    assert bars.slot_of(때, 5) == _때(10, 5)
    assert bars.slot_of(때, 15) == _때(10, 0)
    assert bars.slot_of(때, 60) == _때(10, 0)


def test_야간_체결은_다음_거래일에_든다():
    """세션 표와 같은 규칙입니다."""
    assert bars.day_slot_of(_때(23, 30), 야간) == _때(0, 0, day=18)
    assert bars.day_slot_of(_때(2, 30, day=18), 야간) == _때(0, 0, day=18), "자정을 넘긴 뒤입니다."
    assert bars.day_slot_of(_때(10, 0), 주간) == _때(0, 0)


def test_같은_자리_체결은_봉을_키운다():
    만드는것 = bars.BarBuilder("5분봉")

    assert 만드는것.add(_체결(10, 0, 100.0, 2), 주간) == []
    만드는것.add(_체결(10, 1, 103.0, 1), 주간)
    만드는것.add(_체결(10, 4, 99.0, 3), 주간)

    (봉,) = 만드는것.close()
    assert (봉.open, 봉.high, 봉.low, 봉.close) == (100.0, 103.0, 99.0, 99.0)
    assert 봉.volume == 6.0
    assert 봉.timestamp == _때(10, 0)


def test_다음_자리_체결이_앞_봉을_닫는다():
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 0, 100.0), 주간)

    닫힌것 = 만드는것.add(_체결(10, 5, 101.0), 주간)

    assert [one.timestamp for one in 닫힌것] == [_때(10, 0)]
    assert 만드는것.open_bar is not None and 만드는것.open_bar.timestamp == _때(10, 5)


def test_비는_분은_봉이_되지_않는다():
    """유효기간 N봉은 실제로 생긴 봉으로 셉니다."""
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 0, 100.0), 주간)
    만드는것.add(_체결(10, 40, 101.0), 주간)
    만드는것.close()

    assert [one.timestamp for one in 만드는것.bars] == [_때(10, 0), _때(10, 40)]


def test_세션이_바뀌면_봉을_잇지_않는다():
    """앞 창의 마지막 봉과 다음 창의 첫 봉은 다른 봉입니다."""
    만드는것 = bars.BarBuilder("60분봉")
    만드는것.add(_체결(18, 30, 100.0), 야간)

    닫힌것 = 만드는것.add(_체결(18, 40, 101.0), 주간)
    만드는것.close()

    assert len(닫힌것) == 1, "자리는 같아도 창이 달라 닫힙니다."
    assert 만드는것.sessions == [야간, 주간]
    assert len(만드는것.bars) == 2


def test_판정할_봉을_세션으로_고른다():
    """야간으로 도는 실행은 야간 봉만 판정하고 주간 봉은 지표에만 씁니다."""
    만드는것 = bars.BarBuilder("60분봉")
    만드는것.add(_체결(10, 0, 100.0), 주간)
    만드는것.add(_체결(19, 0, 101.0), 야간)
    만드는것.close()

    assert 만드는것.judged(야간) == [1]
    assert 만드는것.judged(주간) == [0]


def test_열린_봉이_없으면_닫아도_빈_봉이_안_선다():
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 0, 100.0), 주간)

    assert len(만드는것.close()) == 1
    assert 만드는것.close() == []
    assert len(만드는것.bars) == 1


def _조회봉(hour: int, minute: int, close: float, volume: int = 5) -> dict:
    return {
        "timestamp": _때(hour, minute),
        "open": close,
        "high": close,
        "low": close,
        "close": close,
        "volume": volume,
    }


def test_조회_봉을_시각으로_맞물려_넣는다():
    """겹치는 자리는 조회 봉이 이깁니다 — 거래소가 적어 둔 것입니다."""
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 0, 100.0), 주간)
    만드는것.close()

    만드는것.seed([_조회봉(9, 50, 98), _조회봉(9, 55, 99), _조회봉(10, 0, 1)], 주간)

    assert [one.timestamp for one in 만드는것.bars] == [_때(9, 50), _때(9, 55), _때(10, 0)]
    assert 만드는것.bars[-1].close == 1.0, "같은 자리는 조회 봉이 덮습니다."
    assert 만드는것.sessions == [주간, 주간, 주간]


def test_가운데_끊긴_구간도_채운다():
    """끊겼다 다시 붙으면 빈 자리가 앞이 아니라 가운데나 뒤에 생깁니다."""
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 0, 100.0), 주간)
    만드는것.add(_체결(10, 20, 104.0), 주간)  # 10:05~10:15 를 놓쳤습니다.
    만드는것.close()
    assert [one.timestamp for one in 만드는것.bars] == [_때(10, 0), _때(10, 20)]

    만드는것.seed([_조회봉(10, 5, 101), _조회봉(10, 10, 102), _조회봉(10, 15, 103)], 주간)

    assert [one.close for one in 만드는것.bars] == [100.0, 101.0, 102.0, 103.0, 104.0]
    assert len(만드는것.sessions) == 5


def test_열린_봉과_같은_칸의_조회_봉은_열린_봉에_합친다():
    """아직 자라는 봉입니다. 목록에 따로 두면 닫힐 때 같은 시각의 봉이 둘이 됩니다."""
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 1, 100.0, quantity=2), 주간)

    만드는것.seed(
        [{"timestamp": _때(10, 0), "open": 98, "high": 103, "low": 97, "close": 99, "volume": 5}],
        주간,
    )

    assert 만드는것.bars == []
    열린것 = 만드는것.open_bar
    assert (열린것.open, 열린것.high, 열린것.low) == (98.0, 103.0, 97.0)
    assert 열린것.close == 100.0, "종가는 실시간으로 받은 마지막 체결가입니다."
    assert 열린것.volume == 5.0, "같은 구간을 두 쪽에서 센 값이라 더하지 않습니다."

    닫힌것 = 만드는것.add(_체결(10, 5, 101.0), 주간)

    assert [one.timestamp for one in 닫힌것] == [_때(10, 0)]
    assert [one.timestamp for one in 만드는것.bars] == [_때(10, 0)]


def test_조회의_진행_중인_봉은_첫_체결이_이어받는다():
    """장중에 시작한 실행입니다. 조회가 준 10:00 봉에 10:02 체결이 이어져 한 봉입니다."""
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.seed(
        [
            _조회봉(9, 55, 98),
            {"timestamp": _때(10, 0), "open": 99, "high": 99.5, "low": 98.5, "close": 99, "volume": 7},
        ],
        주간,
    )

    assert 만드는것.add(_체결(10, 2, 100.0, quantity=3), 주간) == []

    assert [one.timestamp for one in 만드는것.bars] == [_때(9, 55)]
    열린것 = 만드는것.open_bar
    assert (열린것.timestamp, 열린것.open, 열린것.high, 열린것.low, 열린것.close) == (
        _때(10, 0), 99.0, 100.0, 98.5, 100.0,
    )
    assert 열린것.volume == 10.0

    (닫힌것,) = 만드는것.add(_체결(10, 5, 101.0), 주간)

    assert 닫힌것.close == 100.0
    assert [one.timestamp for one in 만드는것.bars] == [_때(9, 55), _때(10, 0)]
    assert 만드는것.sessions == [주간, 주간]


def test_조회_뒤_다음_칸의_체결이면_조회_봉은_닫힌_채로_둔다():
    """그 칸에는 체결이 더 없었습니다. 조회 값이 그 봉의 값이고 다시 판정하지 않습니다."""
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.seed([_조회봉(10, 0, 99)], 주간)

    assert 만드는것.add(_체결(10, 5, 101.0), 주간) == []

    assert [one.close for one in 만드는것.bars] == [99.0]
    assert 만드는것.open_bar.timestamp == _때(10, 5)


def test_다른_창의_같은_시각_조회_봉은_잇지_않는다():
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.seed([_조회봉(10, 0, 99)], 야간)

    만드는것.add(_체결(10, 2, 100.0), 주간)

    assert [one.close for one in 만드는것.bars] == [99.0]
    assert 만드는것.open_bar.close == 100.0 and 만드는것.open_session == 주간


def test_끊긴_동안_칸이_넘어갔으면_열린_봉은_조회_봉으로_끝낸다():
    """다음 체결로 닫으면 10:00 봉이 10:10 뒤에 붙어 시각 순서가 깨집니다."""
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 1, 100.0), 주간)

    만드는것.seed([_조회봉(10, 0, 99), _조회봉(10, 5, 102), _조회봉(10, 10, 103)], 주간)

    assert 만드는것.open_bar is None
    assert 만드는것.add(_체결(10, 12, 104.0), 주간) == [], "끝난 봉을 다시 판정하지 않습니다."
    assert [one.timestamp for one in 만드는것.bars] == [_때(10, 0), _때(10, 5)]
    assert 만드는것.bars[0].close == 99.0
    assert 만드는것.open_bar.timestamp == _때(10, 10)

    만드는것.add(_체결(10, 15, 105.0), 주간)

    assert [one.timestamp for one in 만드는것.bars] == [_때(10, 0), _때(10, 5), _때(10, 10)]


def test_끊긴_동안_칸이_넘어갔는데_그_칸의_조회_봉이_없으면_열린_봉을_남긴다():
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 1, 100.0), 주간)

    만드는것.seed([_조회봉(10, 5, 102)], 주간)

    assert 만드는것.open_bar is None
    assert [(one.timestamp, one.close) for one in 만드는것.bars] == [
        (_때(10, 0), 100.0),
        (_때(10, 5), 102.0),
    ]


def test_칸_기준을_밀어_끊는다():
    assert bars.slot_of(_때(9, 50), 30, 15) == _때(9, 45)
    assert bars.slot_of(_때(9, 44, 59), 30, 15) == _때(9, 15)
    assert bars.slot_of(_때(9, 50), 60, 45) == _때(9, 45)
    assert bars.slot_of(_때(10, 44), 60, 45) == _때(9, 45)
    assert bars.slot_of(_때(10, 21), 15, 5) == _때(10, 20)
    # 자정을 넘겨 이어지는 세션의 칸입니다(홍콩 30분봉의 23:45).
    assert bars.slot_of(_때(0, 10, day=18), 30, 15) == _때(23, 45)


def test_조회_봉에서_칸_기준을_읽는다():
    assert bars.grid_of([_때(8, 45), _때(9, 15), _때(9, 45)], 30) == 15
    assert bars.grid_of([_때(8, 45), _때(9, 45)], 60) == 45
    assert bars.grid_of([_때(10, 0), _때(11, 0)], 60) == 0
    assert bars.grid_of([_때(10, 5), _때(10, 20), _때(10, 35)], 15) == 5
    assert bars.grid_of([_때(8, 45), _때(9, 15), _때(9, 20)], 30) == 15, "많은 쪽입니다."
    assert bars.grid_of([], 30) is None


def test_국내_주간_30분봉은_조회_봉의_칸으로_이어진다():
    """조회는 08:45·09:15·09:45 입니다. 09:52 체결은 09:30 이 아니라 09:45 칸입니다."""
    만드는것 = bars.BarBuilder("30분봉")
    만드는것.seed([_조회봉(8, 45, 97), _조회봉(9, 15, 98), _조회봉(9, 45, 99)], 주간)

    assert 만드는것.add(_체결(9, 52, 100.0), 주간) == []
    assert 만드는것.open_bar.timestamp == _때(9, 45)
    assert 만드는것.add(_체결(10, 14, 101.0), 주간) == [], "10:15 전까지 같은 칸입니다."

    (닫힌것,) = 만드는것.add(_체결(10, 15, 102.0), 주간)

    assert (닫힌것.timestamp, 닫힌것.close) == (_때(9, 45), 101.0)
    assert [one.timestamp for one in 만드는것.bars] == [_때(8, 45), _때(9, 15), _때(9, 45)]
    assert 만드는것.open_bar.timestamp == _때(10, 15)


def test_해외_15분봉도_품목의_칸_기준을_따른다():
    만드는것 = bars.BarBuilder("15분봉")
    만드는것.seed([_조회봉(10, 5, 98), _조회봉(10, 20, 99)], "overseas")

    만드는것.add(_체결(10, 21, 100.0), "overseas")

    assert 만드는것.open_bar.timestamp == _때(10, 20)
    assert [one.timestamp for one in 만드는것.bars] == [_때(10, 5)]


def test_칸_기준은_창마다_따로다():
    """국내 주간 30분봉은 :15·:45, 야간은 정각입니다."""
    만드는것 = bars.BarBuilder("30분봉")
    만드는것.seed([_조회봉(9, 15, 98)], 주간)
    만드는것.seed([_조회봉(19, 0, 99)], 야간)

    assert 만드는것.minute_slot(_때(9, 50), 주간) == _때(9, 45)
    assert 만드는것.minute_slot(_때(19, 50), 야간) == _때(19, 30)


def test_기준을_늦게_알면_열린_봉을_새_칸으로_옮겨_합친다():
    """첫 조회를 못 받아 정각 칸(09:30)으로 연 봉입니다. 09:50 체결은 09:45 칸입니다."""
    만드는것 = bars.BarBuilder("30분봉")
    만드는것.add(_체결(9, 50, 100.0), 주간)
    assert 만드는것.open_bar.timestamp == _때(9, 30)

    만드는것.seed([_조회봉(9, 15, 98), _조회봉(9, 45, 99)], 주간)

    assert 만드는것.open_bar.timestamp == _때(9, 45)
    assert 만드는것.open_bar.close == 100.0
    assert [one.timestamp for one in 만드는것.bars] == [_때(9, 15)]

    (닫힌것,) = 만드는것.add(_체결(10, 15, 101.0), 주간)

    assert 닫힌것.timestamp == _때(9, 45)
    assert [one.timestamp for one in 만드는것.bars] == [_때(9, 15), _때(9, 45)]


def test_기준을_늦게_알면_조회가_덮는_어긋난_봉은_뺀다():
    만드는것 = bars.BarBuilder("30분봉")
    만드는것.add(_체결(8, 10, 90.0), 주간)  # 조회보다 앞이라 대신할 값이 없습니다.
    만드는것.add(_체결(9, 0, 100.0), 주간)
    만드는것.add(_체결(9, 30, 101.0), 주간)
    만드는것.close()
    assert [one.timestamp for one in 만드는것.bars] == [_때(8, 0), _때(9, 0), _때(9, 30)]

    만드는것.seed([_조회봉(8, 45, 97), _조회봉(9, 15, 98), _조회봉(9, 45, 99)], 주간)

    assert [one.timestamp for one in 만드는것.bars] == [
        _때(8, 0), _때(8, 45), _때(9, 15), _때(9, 45),
    ]


def test_지난_칸만_조회하면_열린_봉은_그대로다():
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 1, 100.0), 주간)

    만드는것.seed([_조회봉(9, 55, 98)], 주간)

    assert [one.timestamp for one in 만드는것.bars] == [_때(9, 55)]
    assert 만드는것.open_bar.close == 100.0


def test_닫은_칸에_체결이_더_오면_같은_봉에_합친다():
    만드는것 = bars.BarBuilder("5분봉")
    만드는것.add(_체결(10, 1, 100.0, quantity=2), 주간)
    만드는것.close()

    만드는것.add(_체결(10, 2, 103.0, quantity=3), 주간)
    (닫힌것,) = 만드는것.close()

    (봉,) = 만드는것.bars
    assert 봉 == 닫힌것
    assert (봉.open, 봉.high, 봉.close, 봉.volume) == (100.0, 103.0, 103.0, 5.0)
    assert 만드는것.sessions == [주간]


def test_일봉도_조회의_오늘_봉을_이어받는다():
    """해외 일봉 조회는 오늘 봉까지 줍니다."""
    만드는것 = bars.BarBuilder(bars.DAILY_BAR)
    오늘 = bars.day_slot_of(_때(10, 0), 주간)
    만드는것.seed(
        [{"timestamp": 오늘, "open": 99, "high": 99, "low": 99, "close": 99, "volume": 7}], 주간
    )

    만드는것.add(_체결(10, 0, 100.0), 주간)
    만드는것.close()

    (봉,) = 만드는것.bars
    assert (봉.timestamp, 봉.open, 봉.close, 봉.volume) == (오늘, 99.0, 100.0, 8.0)


def test_시각이나_가격이_없는_체결은_버리고_센다():
    만드는것 = bars.BarBuilder("5분봉")

    만드는것.add({"price": 100.0, "quantity": 1}, 주간)
    만드는것.add({"timestamp": _때(10, 0), "quantity": 1}, 주간)
    만드는것.seed([{"close": 1}, "줄이 아님"], 주간)

    assert 만드는것.dropped == 4
    assert 만드는것.bars == [] and 만드는것.open_bar is None


def test_일봉은_거래일_하나다():
    만드는것 = bars.BarBuilder(bars.DAILY_BAR)
    만드는것.add(_체결(19, 0, 100.0), 야간)
    만드는것.add(_체결(2, 0, 102.0, day=18), 야간)
    만드는것.close()

    (봉,) = 만드는것.bars
    assert 봉.timestamp == _때(0, 0, day=18)
    assert (봉.open, 봉.close) == (100.0, 102.0)


def test_담아_둘_봉_수를_넘기면_앞에서_버린다():
    만드는것 = bars.BarBuilder("1분봉", limit=2)
    for minute in range(4):
        만드는것.add(_체결(10, minute, 100.0 + minute), 주간)
    만드는것.close()

    assert [one.close for one in 만드는것.bars] == [102.0, 103.0]
    assert len(만드는것.sessions) == 2, "맥락도 함께 줄어듭니다."


def test_지표가_설_만큼_모였는지():
    만드는것 = bars.BarBuilder("1분봉")
    만드는것.add(_체결(10, 0, 100.0), 주간)
    만드는것.close()

    assert 만드는것.ready(1) is True
    assert 만드는것.ready(2) is False


def test_분봉을_받을_구간은_넉넉히_잡는다():
    """비는 분은 봉이 되지 않아 시계로 센 구간에는 늘 봉이 모자랍니다."""
    지금 = datetime(2026, 9, 17, 10, 0, tzinfo=KST)

    assert bars.minute_span(100, 5, now=지금) == ("20260915", "20260917")
    시작, 끝 = bars.minute_span(1000, 1, now=지금)
    assert 끝 == "20260917" and 시작 < "20260917"


def test_일봉은_창이_바뀌어도_안_닫는다():
    """「일봉 = 거래일 하나」이고 국내 야간은 다음 거래일에 속합니다."""
    만드는것 = bars.BarBuilder(bars.DAILY_BAR)

    만드는것.add(_체결(19, 0, 100.0), 야간)
    닫힌것 = 만드는것.add(_체결(2, 0, 102.0, day=18), 야간)
    이어진것 = 만드는것.add(_체결(10, 0, 104.0, day=18), 주간)
    만드는것.close()

    assert 닫힌것 == [] and 이어진것 == [], "야간과 그 다음 주간이 한 봉입니다."
    (봉,) = 만드는것.bars
    assert (봉.open, 봉.close) == (100.0, 104.0)
    assert 만드는것.sessions == [야간], "그 거래일의 첫 체결이 온 창을 적습니다."


def test_분봉은_창이_바뀌면_닫는다():
    """앞 창의 마지막 봉과 다음 창의 첫 봉은 다른 봉입니다."""
    만드는것 = bars.BarBuilder("60분봉")
    만드는것.add(_체결(18, 30, 100.0), 야간)

    닫힌것 = 만드는것.add(_체결(18, 40, 101.0), 주간)

    assert len(닫힌것) == 1


def test_일봉은_판정할_봉을_창으로_가리지_않는다():
    만드는것 = bars.BarBuilder(bars.DAILY_BAR)
    만드는것.add(_체결(19, 0, 100.0), 야간)
    만드는것.close()
    만드는것.add(_체결(10, 0, 104.0, day=19), 주간)
    만드는것.close()

    assert 만드는것.daily is True
    assert 만드는것.judged(주간) == [0, 1]
    assert 만드는것.judged(야간) == [0, 1]


def test_일봉은_세션_끝으로_닫혀도_같은_거래일이면_한_봉이다():
    """17일 밤과 18일 낮은 같은 18일 거래일입니다."""
    만드는것 = bars.BarBuilder(bars.DAILY_BAR)
    만드는것.add(_체결(19, 0, 100.0, quantity=2), 야간)
    만드는것.close()
    만드는것.add(_체결(10, 0, 104.0, day=18), 주간)
    (닫힌것,) = 만드는것.close()

    (봉,) = 만드는것.bars
    assert 봉 == 닫힌것
    assert (봉.timestamp, 봉.open, 봉.close, 봉.volume) == (_때(0, 0, day=18), 100.0, 104.0, 3.0)
    assert 만드는것.sessions == [야간], "그 거래일의 첫 체결이 온 창입니다."


def test_분봉은_제_창의_봉만_고른다():
    만드는것 = bars.BarBuilder("60분봉")
    만드는것.add(_체결(10, 0, 100.0), 주간)
    만드는것.add(_체결(19, 0, 101.0), 야간)
    만드는것.close()

    assert 만드는것.daily is False
    assert 만드는것.judged(야간) == [1]


def test_일봉_구간은_주말만큼_넉넉히_잡는다():
    """주말과 휴장일에는 봉이 서지 않습니다."""
    지금 = datetime(2026, 9, 17, 10, 0, tzinfo=KST)

    시작, 끝 = bars.day_span(40, now=지금)

    assert 끝 == "20260917"
    assert 시작 < "20260801", "40 거래일이면 두 달 남짓 거슬러야 합니다."


def test_거래일이_바뀌면_일봉이_닫힌다():
    """창으로는 안 갈라도 거래일이 바뀌면 갈립니다."""
    만드는것 = bars.BarBuilder(bars.DAILY_BAR)
    만드는것.add(_체결(19, 0, 100.0), 야간)
    만드는것.add(_체결(10, 0, 104.0, day=18), 주간)

    # 다음 거래일의 야간입니다 — 18일 저녁은 19일 거래일입니다.
    닫힌것 = 만드는것.add(_체결(19, 0, 106.0, day=18), 야간)

    assert [one.timestamp for one in 닫힌것] == [_때(0, 0, day=18)]
    assert 만드는것.open_bar is not None
    assert 만드는것.open_bar.timestamp == _때(0, 0, day=19)


def test_조회_일봉에는_부르는_쪽이_준_창을_적는다():
    """응답은 그 구간의 값일 뿐 어느 창에서 왔는지 말해 주지 않습니다."""
    만드는것 = bars.BarBuilder(bars.DAILY_BAR)
    만드는것.add(_체결(19, 0, 100.0), 야간)
    만드는것.close()

    만드는것.seed(
        [
            {
                "timestamp": _때(0, 0, day=15),
                "open": 98,
                "high": 99,
                "low": 97,
                "close": 98,
                "volume": 5,
            }
        ],
        주간,
    )

    assert [one.timestamp for one in 만드는것.bars] == [_때(0, 0, day=15), _때(0, 0, day=18)]
    assert 만드는것.sessions == [주간, 야간], "조회 봉은 준 창, 실시간 봉은 첫 체결의 창."
    assert 만드는것.judged(주간) == [0, 1], "일봉은 창으로 안 가립니다."
