"""해외 선물의 계약당 개시증거금과 전략 예산 검사.

품목 표(`overseas_product_service`)의 선물 값을 실행이 담아 예산과 견줍니다. 옵션과
스프레드는 그 값을 쓰지 않고, 값을 모르면 지금처럼 예산 검사만 건너뜁니다.

**계좌에도 NH선물 서버에도 닿지 않습니다.** 마스터와 품목 표를 지어 끼웁니다.
"""
from __future__ import annotations

import threading

import pytest

from backend.strategy import journal as journal_lib, paper, runs
from backend.strategy import service as service_lib
from tests.test_strategy_service import _설정, _시간표, _해외물음

USD = "USD"
품목줄 = {"productCode": "MES", "currency": USD, "contractInitialMargin": 2885.0}


class _마스터:
    def __init__(self, kind: str = "futures") -> None:
        self.kind = kind

    def locate(self, market, code):
        if market != "overseas" or code != "MESU26":
            return None
        return {
            "ExchName": "FCME",
            "tsiz": "0.25",
            "ctrt_size": "5",
            "expiry_date": "20260918",
            "kind": self.kind,
            "product_code": "MES",
        }


class _품목표:
    """받으면 `next_table` 이 표가 됩니다. `터질것` 이 있으면 받지 못합니다."""

    def __init__(self, table=None, *, next_table=None, 터질것=None, 새것=True) -> None:
        self.table = table
        self.next_table = next_table
        self.터질것 = 터질것
        self.새것 = 새것
        self.calls = 0
        self.called = threading.Event()

    def cached(self):
        return self.table

    def fresh(self, now=None):
        return self.새것 and self.table is not None

    def products(self):
        self.calls += 1
        self.called.set()
        if self.터질것 is not None:
            raise self.터질것
        if self.next_table is not None:
            self.table = self.next_table
        return self.table


def _목록(tmp_path, 표, *, kind="futures", currency=USD) -> service_lib.RunService:
    made = service_lib.RunService(
        store=runs.RunStore(tmp_path / "runs.json"),
        journal=journal_lib.Journal(tmp_path / "trades.jsonl"),
        master=_마스터(kind),
        hours=_시간표(),
        fetch=lambda run, minutes, count: [],
        overseas_products=표,
    )
    made._currency_of = lambda market, code: currency
    return made


def _물음(budget: str = "10000"):
    설정 = _설정(session="해외 CME", fillCond="", marginBudget=budget)
    설정["baseBar"] = "1분봉"
    return _해외물음(draft=설정)


def _막힘(엔진):
    return runs.entry_block(
        엔진.run,
        엔진.ledger,
        side=paper.BUY,
        open_entry=0,
        max_hold=5,
        add_while_open=False,
        gap=False,
        expiring=False,
        last_price=7000.0,
        signal=7000.0,
    )


def test_세울_때_품목_표를_받아_첫_주문부터_예산을_잰다(tmp_path):
    표 = _품목표(next_table={"products": [품목줄]})
    목록 = _목록(tmp_path, 표)

    줄 = 목록.add(**_물음("10000"))

    assert 표.calls == 1
    assert 줄["margin"] == 2885.0
    assert (줄["perContract"], 줄["perContractBasis"]) == (2885.0, "margin")
    assert 줄["budgetUnchecked"] is False
    assert 줄["marginLeft"] == 10000.0


def test_예산을_넘는_해외_선물_진입을_막는다(tmp_path):
    목록 = _목록(tmp_path, _품목표({"products": [품목줄]}))
    목록.add(**_물음("1000"))

    assert _막힘(목록._engine("run1")) == runs.WHY_BUDGET


def test_예산_안의_해외_선물은_들어간다(tmp_path):
    목록 = _목록(tmp_path, _품목표({"products": [품목줄]}))
    목록.add(**_물음("2885"))

    assert _막힘(목록._engine("run1")) is None


@pytest.mark.parametrize("종류", ["spread", "option"])
def test_스프레드와_옵션에는_품목_표의_값을_쓰지_않는다(tmp_path, 종류):
    목록 = _목록(tmp_path, _품목표({"products": [품목줄]}), kind=종류)

    아는것 = 목록.instrument("overseas", "MESU26")

    assert (아는것["margin"], 아는것["marginCurrency"]) == (None, "")
    assert 아는것["why"] == service_lib.WHY_NO_OVERSEAS_MARGIN


def test_스프레드는_지금처럼_예산_검사를_건너뛴다(tmp_path):
    목록 = _목록(tmp_path, _품목표({"products": [품목줄]}), kind="spread")

    줄 = 목록.add(**_물음("1000"))

    assert 줄["budgetUnchecked"] is True
    assert _막힘(목록._engine("run1")) is None


def test_통화가_다르면_견주지_않는다(tmp_path):
    """HKD 예산과 USD 증거금을 그대로 견주면 다른 돈끼리 비교합니다."""
    목록 = _목록(tmp_path, _품목표({"products": [품목줄]}), currency="HKD")

    줄 = 목록.add(**_물음("1000"))

    assert 줄["margin"] is None and 줄["budgetUnchecked"] is True
    assert 목록.known_margin("overseas", "MESU26", 목록.instrument("overseas", "MESU26")) is None


def test_통화를_모르는_값은_쓰지_않는다(tmp_path):
    줄하나 = {**품목줄, "currency": None}
    목록 = _목록(tmp_path, _품목표({"products": [줄하나]}))

    assert 목록.instrument("overseas", "MESU26")["margin"] is None


def test_품목_표를_못_받아도_실행은_서고_그_사실을_남긴다(tmp_path):
    목록 = _목록(tmp_path, _품목표(터질것=RuntimeError("막힘")))

    줄 = 목록.add(**_물음("1000"))

    assert 줄["budgetUnchecked"] is True
    assert service_lib.WHY_BUDGET_UNCHECKED in [one["text"] for one in 목록._engine("run1").events]


def test_표가_늦게_와도_그때부터_예산을_잰다(tmp_path):
    표 = _품목표(터질것=RuntimeError("막힘"))
    목록 = _목록(tmp_path, 표)
    목록.add(**_물음("1000"))
    assert _막힘(목록._engine("run1")) is None

    표.터질것 = None
    표.table = {"products": [품목줄]}
    (줄,) = 목록.rows()

    assert 줄["budgetUnchecked"] is False
    assert _막힘(목록._engine("run1")) == runs.WHY_BUDGET


def test_날이_바뀐_표는_뒤에서_한_번만_다시_받는다(tmp_path):
    표 = _품목표({"products": [품목줄]})
    목록 = _목록(tmp_path, 표)
    목록.add(**_물음())
    표.새것 = False
    표.calls = 0
    표.called.clear()

    목록.rows()
    assert 표.called.wait(5), "낡은 표를 받으러 나가야 합니다."
    목록.rows()
    목록.rows()

    assert 표.calls == 1, "실패해도 간격 안에서는 다시 묻지 않습니다."


def test_끝난_실행은_표를_받으러_나가지_않는다(tmp_path):
    표 = _품목표({"products": [품목줄]})
    목록 = _목록(tmp_path, 표)
    목록.add(**_물음())
    목록._engine("run1").run.state = runs.ENDED
    표.새것 = False
    표.calls = 0
    표.called.clear()

    목록.rows()

    assert not 표.called.wait(0.05)
    assert 표.calls == 0


def test_돌려_보기_라우트는_통화를_거친_증거금으로_셈한다(monkeypatch):
    from fastapi.testclient import TestClient

    from backend.main import app
    from backend.strategy import backtest
    from backend.strategy.strategy_routes import get_master, get_service
    from tests.test_strategy_backtest import _가짜목록, _몸, _마스터 as 백테스트마스터

    class 다른통화(_가짜목록):
        def known_margin(self, market, code, facts):
            return None

    받음: dict = {}
    원래 = backtest.compute
    monkeypatch.setattr(backtest, "compute", lambda **물음: 받음.update(물음) or 원래(**물음))
    app.dependency_overrides[get_service] = lambda: 다른통화()
    app.dependency_overrides[get_master] = 백테스트마스터
    try:
        답 = TestClient(app).post("/api/strategy/backtest", json=_몸())
    finally:
        app.dependency_overrides.pop(get_service, None)
        app.dependency_overrides.pop(get_master, None)

    assert 답.status_code == 200, 답.text
    assert 받음["margin"] is None, "종목 정보의 값(1,000)을 그대로 쓰면 안 됩니다."


def test_국내_값은_통화_견줌을_지나지_않는다():
    facts = {"margin": 2_500_000.0, "marginCurrency": ""}

    assert service_lib.RunService._margin_in(facts, "KRW") == 2_500_000.0
