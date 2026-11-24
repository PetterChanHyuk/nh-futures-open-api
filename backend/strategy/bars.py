"""체결을 봉으로 세웁니다.

실행 하나가 보는 봉은 **두 군데에서 옵니다.** 시작할 때는 지표가 설 만큼을
분봉 조회로 받아 깔고, 그 뒤로는 실시간 체결을 이어 붙입니다. 두 벌이 한 줄로
이어져야 차트에 그려진 선과 엔진이 본 값이 같습니다.

## 세션은 허브가 붙여 줍니다

봉은 **세션 창으로 가릅니다** — 앞 창의 마지막 봉과 다음 창의 첫 봉을 이어
붙이지 않습니다. 창을 여기서 다시 계산하지 않고 허브가 메시지마다 붙여 주는
맥락(`domestic-day`·`domestic-night`·`overseas-cme`)을 그대로 씁니다. 같은
경계를 두 곳에서 세면 한쪽만 고쳐지는 날 봉이 화면과 달라집니다.

**야간은 별도 세션입니다.** 야간으로 도는 실행은 야간 봉만 판정하고 주간 봉은
지표를 세우는 데만 씁니다. 그래서 봉과 나란히 맥락을 들고 다닙니다
(`sessions`) — 판정할 봉을 고르는 것은 엔진의 몫입니다.

## 비는 분은 봉이 아닙니다

체결이 없는 동안은 봉을 만들지 않습니다(차트와 같은 규칙). 유효기간 「N봉
이내」는 **실제로 생긴 봉**으로 셉니다 — 한산한 구간에서 시계로 세면 조건이
채워질 기회 없이 만료됩니다.

봉이 **닫히는** 때는 둘입니다. 다음 봉 자리의 첫 체결이 오거나(`add`), 세션이
끝나거나 시세가 끊기거나(`close`). 닫힌 봉만 판정에 씁니다 — 아직 값이 바뀌는
봉으로 신호를 내면 같은 봉에서 신호가 섰다 사라집니다.

## 분봉의 칸은 조회 봉의 기준을 따릅니다

NH 분봉은 정각에서 끊기지 않는 품목이 있습니다 — 국내 주간 30분봉은 08:45·09:15,
60분봉은 08:45·09:45 이고, 해외도 품목마다 15·30·60분봉의 기준이 다릅니다. 품목 표를
따로 두지 않고 **조회로 받은 봉의 시각에서 기준을 읽어**(`grid_of`) 실시간 체결을 같은
칸에 넣습니다. 아직 조회 봉이 없으면 정각 기준입니다.

## 일봉은 거래일 하나입니다

국내는 달력 날짜로 셉니다(야간은 다음 날, `day_slot_of`). **해외는 시간표의 거래
창이 시작한 날**입니다 — 한국 시각 자정을 넘기는 세션(07:00~익일 06:00 등)도 한
봉이라, 자정에 봉이 닫혀 세션 한가운데서 판정하지 않습니다. 해외 거래일은 실행이
넘겨 주고(`BarBuilder(day_of=...)`), 조회로 받는 해외 일봉의 날짜도 같은 세션
날짜입니다.
"""
from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable
from datetime import date, datetime, timedelta
from typing import Any

from backend.sessions.hours import KST, now_kst
from backend.strategy.indicators import Bar

#: 화면의 `BASE_BARS` 와 같은 목록. 분봉은 길이(분), 일봉은 따로입니다.
BAR_MINUTES: dict[str, int] = {
    "1분봉": 1,
    "5분봉": 5,
    "15분봉": 15,
    "30분봉": 30,
    "60분봉": 60,
}

#: 일봉. 길이가 분이 아니라 **거래일 하나**입니다.
DAILY_BAR = "일봉"

#: 국내 야간. 이 창의 체결은 **다음 거래일**에 속합니다(세션 표와 같은 규칙).
NIGHT_CONTEXT = "domestic-night"

_MINUTE_MS = 60_000
_DAY_MS = 86_400_000


def minutes_of(base_bar: str) -> int | None:
    """그 기준 봉의 길이(분). 일봉이면 `None` 입니다."""
    return BAR_MINUTES.get(str(base_bar or "").strip())


def slot_of(timestamp: int, minutes: int, grid: int = 0) -> int:
    """그 체결이 드는 분봉의 시작 시각(밀리초).

    한국시간의 자정에서 `grid` 분 민 자리부터 봉 길이만큼씩 끊습니다. `grid` 가 0 이면
    15분봉은 :00·:15·:30·:45 이고, 15 이면 30분봉은 :15·:45 입니다. 그 날의 첫 칸보다
    앞선 시각은 앞 날의 마지막 칸입니다 — 자정을 넘겨 이어지는 세션의 칸입니다.
    """
    moment = datetime.fromtimestamp(timestamp / 1000, tz=KST)
    midnight = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    passed = int((moment - midnight).total_seconds() // 60)
    size = max(minutes, 1)
    start = midnight + timedelta(minutes=(passed - grid) // size * size + grid)
    return int(start.timestamp() * 1000)


def grid_of(stamps: Iterable[int], minutes: int) -> int | None:
    """조회 봉의 시각들이 앉은 칸 기준 — 자정에서 몇 분 밀렸는지. 봉이 없으면 `None`.

    한 품목의 봉은 기준이 하나라 어느 봉으로 읽어도 같습니다. 그래도 가장 많은 값을
    씁니다 — 모양이 다른 줄 하나가 그 실행의 칸을 전부 옮기지 않게 합니다.
    """
    seen: Counter[int] = Counter()
    for stamp in stamps:
        moment = datetime.fromtimestamp(stamp / 1000, tz=KST)
        seen[(moment.hour * 60 + moment.minute) % max(minutes, 1)] += 1
    return seen.most_common(1)[0][0] if seen else None


def day_slot_of(timestamp: int, context: str) -> int:
    """그 체결이 드는 **거래일**의 0시(밀리초).

    국내 야간은 다음 날에 속합니다. 휴장일을 건너뛰지 않습니다 — 봉을 세우는
    데 쓰는 자리라 하루 앞뒤가 달라도 봉이 섞이지 않고, 달력 날짜만으로도
    야간과 그 다음 주간이 한 봉에 들어옵니다.

    **해외 실시간 일봉은 이 값이 아니라 시간표의 거래일을 씁니다**(`BarBuilder` 의
    `day_of`) — 달력 날짜로 끊으면 자정을 넘기는 세션이 두 봉이 됩니다.
    """
    moment = datetime.fromtimestamp(timestamp / 1000, tz=KST)
    day: date = moment.date()
    if context == NIGHT_CONTEXT and moment.hour >= 12:
        # 18:00 에 열어 자정을 넘기는 창입니다. 자정 뒤의 체결은 이미 다음 날입니다.
        day = day + timedelta(days=1)
    start = datetime(day.year, day.month, day.day, tzinfo=KST)
    return int(start.timestamp() * 1000)


class BarBuilder:
    """실행 하나가 보는 봉 한 줄.

    받는 체결은 허브가 내는 모양 그대로입니다 — `{"timestamp", "price",
    "quantity"}`. 시각이 없는 체결은 어느 봉에 넣을지 고를 수 없어 버리고
    세어 둡니다(`dropped`).

    **체결은 시각 순으로 들어온다고 봅니다.** 허브가 받은 차례 그대로 넘겨
    주므로 실시간에서는 그렇습니다. 앞뒤가 뒤섞인 체결을 넣으면 지난 자리에
    봉이 새로 서서 봉 목록이 시각 순이 아니게 됩니다 — 기록 둘을 이어 붙여
    흘려 넣을 때가 그렇습니다.

    `day_of` 는 체결 하나가 드는 **일봉 자리**(그 거래일의 0시, 밀리초)를 답하는
    자리입니다. 해외 실행이 시간표의 거래일로 넘겨 줍니다(`engine.RunEngine`).
    거래 창 밖이라 `None` 이면 열린 봉의 날을 잇습니다. 없으면 `day_slot_of` 입니다.
    """

    def __init__(
        self,
        base_bar: str,
        *,
        limit: int = 2000,
        day_of: Callable[[int, str], int | None] | None = None,
    ) -> None:
        self.base_bar = str(base_bar or "").strip()
        self.minutes = minutes_of(self.base_bar)
        #: 담아 둘 봉 수. 지표가 보는 것은 앞쪽 몇백 봉뿐이라 무한정 들지 않습니다.
        self.limit = max(int(limit), 1)
        self.day_of = day_of
        self.bars: list[Bar] = []
        #: 봉마다의 맥락. `bars` 와 길이가 같습니다.
        self.sessions: list[str] = []
        self.dropped = 0
        self._open: Bar | None = None
        self._open_session = ""
        self._slot = 0
        #: 조회로 받은 마지막 봉의 시각. 그 칸의 체결이 오면 그 봉을 이어 갑니다(`add`).
        self._resumable: int | None = None
        #: 창마다의 분봉 칸 기준(`grid_of`). 없으면 정각 기준입니다.
        self._grids: dict[str, int] = {}
        #: 열린 봉에 마지막으로 넣은 체결의 시각. 기준이 바뀌면 이 시각으로 칸을 다시 찾습니다.
        self._open_at = 0

    # ── 채우기 ──────────────────────────────────────────

    def seed(self, rows: list[dict[str, Any]], context: str) -> set[int]:
        """분봉 조회로 받은 봉을 **시각으로 맞물려** 넣고, 읽은 봉의 시각들을 냅니다.

        앞만 채우지 않습니다 — 끊겼다 다시 붙으면 빈 자리가 앞이 아니라
        **가운데나 뒤**에 생깁니다(그동안 실시간이 안 왔고 그 뒤로 다시 오기
        시작하므로). 앞만 채우면 그 구멍이 영영 안 메워집니다.

        같은 자리가 겹치면 **조회 봉이 이깁니다.** 거래소가 적어 둔 것이고,
        이 앱이 실시간으로 세운 봉은 그 구간을 놓쳤을 수 있어 거래량이 모자랄
        수 있습니다.

        **한 칸에는 봉이 하나입니다.** 장중의 조회는 아직 안 끝난 칸의 봉까지 줍니다.
        그 칸이 열린 봉이면 열린 봉에 합치고(`_settle_open`), 열린 봉이 없으면 목록의
        끝에 두었다가 그 칸의 체결이 오면 이어 갑니다(`add`).

        **조회 봉에는 제 창이 없습니다.** 응답은 그 구간의 값일 뿐 어느 창에서
        왔는지 말해 주지 않으므로, 부르는 쪽이 준 창(`context`)을 적습니다 —
        실행이 그 창으로 물었으니 그 창의 봉입니다. 일봉이면 창으로 가리지
        않으므로 무엇이 적히든 판정에는 영향이 없습니다(`judged`).
        """
        held = dict(zip((one.timestamp for one in self.bars), self.sessions))
        made = {one.timestamp: one for one in self.bars}
        read: set[int] = set()
        for row in rows:
            bar = _bar_of(row)
            if bar is None:
                self.dropped += 1
                continue
            made[bar.timestamp] = bar
            held[bar.timestamp] = context
            read.add(bar.timestamp)

        self._adopt_grid(made, held, read, context)
        self._settle_open(made, held, read)
        self.bars = [made[when] for when in sorted(made)]
        self.sessions = [held[one.timestamp] for one in self.bars]
        self._trim()
        last = self.bars[-1].timestamp if self.bars else None
        self._resumable = last if self._open is None and last in read else None
        return read

    def learn_grid(self, stamps: Iterable[int], context: str) -> bool:
        """조회 봉의 시각으로 그 창의 칸 기준을 정합니다. 기준이 바뀌었으면 참입니다."""
        if self.minutes is None:
            return False
        found = grid_of(stamps, self.minutes)
        if found is None or found == self._grids.get(context, 0):
            return False
        self._grids[context] = found
        return True

    def _adopt_grid(
        self, made: dict[int, Bar], held: dict[int, str], read: set[int], context: str
    ) -> None:
        """조회 봉의 기준을 받고, 앞 기준으로 세운 봉들을 맞춥니다.

        조회를 못 받은 채 실시간으로 먼저 세운 봉이 있을 때입니다. 조회가 덮는 구간의
        어긋난 봉은 **조회 봉과 구간이 겹치므로 뺍니다.** 그보다 앞의 봉은 대신할 값이
        없어 둡니다. 열린 봉은 마지막 체결이 든 새 칸으로 옮깁니다.
        """
        if not self.learn_grid(read, context):
            return
        grid = self._grids[context]
        first = min(read)
        for when in [one for one in made if one not in read and one >= first]:
            if held[when] == context and slot_of(when, self.minutes, grid) != when:
                del made[when]
                del held[when]
        opened = self._open
        if opened is not None and self._open_session == context:
            slot = slot_of(self._open_at, self.minutes, grid)
            self._open = Bar(
                timestamp=slot,
                open=opened.open,
                high=opened.high,
                low=opened.low,
                close=opened.close,
                volume=opened.volume,
            )
            self._slot = slot

    def _settle_open(
        self, made: dict[int, Bar], held: dict[int, str], read: set[int]
    ) -> None:
        """조회 봉과 열린 봉을 맞춥니다.

        **조회에 그 뒤의 칸이 있으면 열린 봉은 이미 끝난 봉입니다** — 끊긴 동안 칸이
        넘어간 것입니다. 열어 둔 채 다음 체결로 닫으면 지난 시각의 봉이 목록 끝에
        붙어 시각 순서가 깨지므로, 다른 조회 봉처럼 판정 없이 목록에 둡니다. 그 칸의
        조회 봉이 있으면 그 값을 씁니다.

        **그 칸이 마지막이면 아직 자라는 봉입니다.** 조회 값을 열린 봉에 합치고
        목록에서 뺍니다. 같은 구간을 두 쪽에서 센 것이라 거래량은 더하지 않고 큰 쪽을
        쓰고, 종가는 실시간으로 받은 마지막 체결가입니다.
        """
        opened = self._open
        if opened is None:
            return
        when = opened.timestamp
        # 한 칸 뒤부터가 「그 뒤의 칸」입니다.
        next_slot = when + max((self.minutes or 0) * _MINUTE_MS, 1)
        if any(one >= next_slot for one in read):
            if when not in read:
                made[when] = opened
                held[when] = self._open_session
            self._open = None
            self._open_session = ""
            return
        if when not in read:
            return
        row = made.pop(when)
        held.pop(when)
        self._open = Bar(
            timestamp=when,
            open=row.open,
            high=max(row.high, opened.high),
            low=min(row.low, opened.low),
            close=opened.close,
            volume=max(row.volume, opened.volume),
        )

    @property
    def daily(self) -> bool:
        """일봉인지. **일봉은 창으로 가르지 않습니다** — 까닭은 `add` 에."""
        return self.minutes is None

    def add(self, trade: dict[str, Any], context: str) -> list[Bar]:
        """체결 하나를 넣고 **그 때문에 닫힌 봉**을 냅니다.

        닫히는 봉은 많아야 하나입니다. 같은 자리면 열린 봉을 키우고, 자리가
        바뀌거나 세션이 바뀌면 앞의 것을 닫고 새로 엽니다.

        **일봉은 창이 바뀌어도 안 닫습니다.** 「일봉 = 거래일 하나」이고 국내
        야간은 다음 거래일에 속하므로, 한 거래일의 야간과 그 다음 주간이 **한
        봉**입니다. 창으로 가르면 야간 있는 품목의 하루가 늘 두 조각이 되어
        지표가 하루를 두 번 셉니다.

        **조회로 받은 마지막 봉과 같은 칸의 체결이면 그 봉을 다시 열어 잇습니다.**
        장중에 조회한 봉은 아직 안 끝난 봉입니다. 새 봉을 열면 같은 시각의 봉이 둘
        서서 지표가 그 구간을 두 번 셉니다.
        """
        timestamp = _int(trade.get("timestamp"))
        price = _float(trade.get("price"))
        if timestamp is None or price is None:
            self.dropped += 1
            return []
        volume = float(_int(trade.get("quantity")) or 0)

        slot = self._slot_for(timestamp, context)
        closed: list[Bar] = []
        moved = slot != self._slot or (not self.daily and context != self._open_session)
        if self._open is not None and moved:
            closed = self.close()

        self._open_at = timestamp
        if self._open is None and not self._resume(slot, context):
            self._open = Bar(
                timestamp=slot, open=price, high=price, low=price, close=price, volume=volume
            )
            self._open_session = context
            self._slot = slot
            return closed

        held = self._open
        self._open = Bar(
            timestamp=held.timestamp,
            open=held.open,
            high=max(held.high, price),
            low=min(held.low, price),
            close=price,
            volume=held.volume + volume,
        )
        return closed

    def _resume(self, slot: int, context: str) -> bool:
        """조회로 받은 마지막 봉이 이 칸이면 열린 봉으로 되돌립니다. 되돌렸으면 참입니다."""
        wanted = self._resumable
        self._resumable = None
        if wanted != slot or not self._same_slot_last(slot, context):
            return False
        self._open = self.bars.pop()
        self._open_session = self.sessions.pop()
        self._slot = slot
        return True

    def _same_slot_last(self, slot: int, context: str) -> bool:
        """목록의 마지막 봉이 같은 칸인지. 분봉은 창까지 같아야 합니다."""
        if not self.bars or self.bars[-1].timestamp != slot:
            return False
        return self.daily or self.sessions[-1] == context

    def close(self) -> list[Bar]:
        """열린 봉을 닫습니다. 세션이 끝났거나 시세가 끊겼을 때 부릅니다.

        열린 봉이 없으면 아무 일도 없습니다 — 세션 끝 신호가 두 번 와도
        빈 봉이 서지 않습니다.

        **같은 칸의 봉이 이미 닫혀 있으면 새로 붙이지 않고 합칩니다** — 세션을 닫은
        뒤 같은 칸의 체결이 더 온 때입니다. 서로 다른 체결이라 거래량은 더합니다.
        """
        if self._open is None:
            return []
        made = self._open
        self._resumable = None
        if self._same_slot_last(made.timestamp, self._open_session):
            older = self.bars[-1]
            made = Bar(
                timestamp=made.timestamp,
                open=older.open,
                high=max(older.high, made.high),
                low=min(older.low, made.low),
                close=made.close,
                volume=older.volume + made.volume,
            )
            self.bars[-1] = made
        else:
            self.bars.append(made)
            self.sessions.append(self._open_session)
        self._open = None
        self._open_session = ""
        self._trim()
        return [made]

    # ── 보기 ────────────────────────────────────────────

    @property
    def open_bar(self) -> Bar | None:
        """아직 닫히지 않은 봉. 값이 더 바뀝니다 — 평가 방식이 「틱」인 실행만 판정에 씁니다."""
        return self._open

    @property
    def open_session(self) -> str:
        """열린 봉의 세션(맥락). 열린 봉이 없으면 빈 글자입니다."""
        return self._open_session

    def ready(self, need: int) -> bool:
        """지표가 설 만큼 모였는지."""
        return len(self.bars) >= need

    def judged(self, session: str) -> list[int]:
        """판정할 봉들이 앉은 자리.

        분봉은 **그 창의 봉**만입니다. 일봉은 거래일이 단위라 창으로 가르지
        않으므로 전부입니다 — 봉에 적힌 창은 그 거래일의 **첫 체결이 온 창**
        이고, 「언제 시작했나」를 남겨 두는 값입니다.
        """
        if self.daily:
            return list(range(len(self.bars)))
        return [at for at, one in enumerate(self.sessions) if one == session]

    def minute_slot(self, timestamp: int, context: str) -> int:
        """분봉에서 그 시각이 드는 칸의 시작. 그 창의 칸 기준을 씁니다."""
        return slot_of(timestamp, self.minutes or 1, self._grids.get(context, 0))

    def _slot_for(self, timestamp: int, context: str) -> int:
        if self.minutes is not None:
            return self.minute_slot(timestamp, context)
        if self.day_of is None:
            return day_slot_of(timestamp, context)
        slot = self.day_of(timestamp, context)
        if slot is not None:
            return slot
        # 거래 창 밖(정비·쉼)의 체결입니다. 열린 봉이 있으면 그 거래일을 잇습니다.
        # 없으면 달력 날짜입니다 — 시간표가 틀려 장중 체결이 창 밖으로 읽혀도 봉은 섭니다.
        return self._slot if self._open is not None else day_slot_of(timestamp, context)

    def _trim(self) -> None:
        if len(self.bars) <= self.limit:
            return
        cut = len(self.bars) - self.limit
        self.bars = self.bars[cut:]
        self.sessions = self.sessions[cut:]


def minute_span(count: int, minutes: int, *, now: datetime | None = None) -> tuple[str, str]:
    """분봉 `count` 개를 받으려면 언제부터 언제까지를 물어야 하는지 `(시작, 끝)`.

    날짜는 `YYYYMMDD` 입니다. **넉넉히 잡습니다** — 비는 분은 봉이 되지 않아
    시계로 센 구간에는 늘 봉이 모자랍니다. 하루에 설 수 있는 봉이 몇인지는
    품목마다 달라, 세지 않고 **하루치를 통째로** 며칠 받습니다.
    """
    moment = now or now_kst()
    per_day = max(int(_DAY_MS / (minutes * _MINUTE_MS)), 1)
    days = max(int(count / per_day) + 2, 2)
    start = (moment - timedelta(days=days)).strftime("%Y%m%d")
    return start, moment.strftime("%Y%m%d")


def day_span(count: int, *, now: datetime | None = None) -> tuple[str, str]:
    """일봉 `count` 개를 받으려면 언제부터 언제까지를 물어야 하는지 `(시작, 끝)`.

    **넉넉히 잡습니다** — 주말과 휴장일에는 봉이 서지 않아 달력으로 센 구간에는
    늘 봉이 모자랍니다. 닷새에 사흘 꼴로 보고 이틀을 더 얹습니다.
    """
    moment = now or now_kst()
    days = max(int(count * 5 / 3) + 2, 3)
    start = (moment - timedelta(days=days)).strftime("%Y%m%d")
    return start, moment.strftime("%Y%m%d")


def _bar_of(row: Any) -> Bar | None:
    if not isinstance(row, dict):
        return None
    timestamp = _int(row.get("timestamp"))
    close = _float(row.get("close"))
    if timestamp is None or close is None:
        return None
    high = _float(row.get("high"))
    low = _float(row.get("low"))
    opened = _float(row.get("open"))
    return Bar(
        timestamp=timestamp,
        open=opened if opened is not None else close,
        high=high if high is not None else close,
        low=low if low is not None else close,
        close=close,
        volume=float(_int(row.get("volume")) or 0),
    )


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float(value: Any) -> float | None:
    try:
        made = float(value)
    except (TypeError, ValueError):
        return None
    return made
