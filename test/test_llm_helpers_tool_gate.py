"""``stream_and_collect`` must report every tool-gate decision to its caller.

A model whose tool calls were all refused still returns plausible prose, so the
returned text cannot tell a caller whether any work actually happened. Cron
relies on this callback to record a fully-blocked run as a failure instead of a
success — and a success there resets the auto-pause counter, so a job that can
never succeed would re-fire forever. Testing against the REAL implementation
matters because every caller fakes this helper in its own tests: the hook could
be dead at runtime while all of them stayed green.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from kiro_crew import llm_helpers
from kiro_crew.acp.client import AcpError
from kiro_crew.llm_helpers import ToolApprovalPolicy, stream_and_collect
from kiro_crew.providers.base import (
    EVENT_COMPLETE,
    EVENT_PERMISSION_REQUEST,
    EVENT_TEXT_CHUNK,
    LLMEvent,
)


async def _no_sleep(_seconds: float) -> None:
    """Collapse the retry backoff so the retry test stays fast."""
    return None

# Tripped by the always-enforced deny checks in _resolve_permission, which run
# for every approval policy — including AUTO_APPROVE, which is what a cron with
# approval_mode="auto" uses.
_DENIED_TITLE = "rm -rf /"
_BENIGN_TITLE = "Read README.md"


class _ScriptedProvider:
    """Yields a fixed event script and records the gate calls it received."""

    def __init__(self, events: list[LLMEvent]) -> None:
        self._events = events
        self.approved: list[str] = []
        self.rejected: list[str] = []

    async def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        for event in self._events:
            yield event

    async def approve_tool(self, request_id: str) -> None:
        self.approved.append(request_id)

    async def reject_tool(self, request_id: str) -> None:
        self.rejected.append(request_id)


def _script(title: str) -> list[LLMEvent]:
    return [
        LLMEvent(kind=EVENT_TEXT_CHUNK, text="on it"),
        LLMEvent(kind=EVENT_PERMISSION_REQUEST, title=title, request_id="r1"),
        LLMEvent(kind=EVENT_TEXT_CHUNK, text=" — could not."),
        LLMEvent(kind=EVENT_COMPLETE, text=""),
    ]


@pytest.mark.asyncio
async def test_a_security_deny_is_flagged_as_a_security_block():
    provider = _ScriptedProvider(_script(_DENIED_TITLE))
    seen: list[tuple[str, bool, bool]] = []

    text = await stream_and_collect(
        provider,  # type: ignore[arg-type]
        "q",
        approval_policy=ToolApprovalPolicy.AUTO_APPROVE,
        retry_transient=False,
        on_tool_gate=lambda t, a, b: seen.append((t, a, b)),
    )

    assert seen == [(_DENIED_TITLE, False, True)], "the security block never reached the caller"
    assert provider.rejected == ["r1"]
    # The turn still completes and still returns prose — which is precisely why
    # the caller cannot infer the refusal from the reply text.
    assert text == "on it — could not."


@pytest.mark.asyncio
async def test_an_interactive_rejection_is_not_a_security_block():
    """An unattended cron's approval request deny-fasts on a timeout and lands
    here. Counting it as a security block would fail — and eventually
    auto-pause — a job whose only problem is that nobody approved it."""
    provider = _ScriptedProvider(_script(_BENIGN_TITLE))
    seen: list[tuple[str, bool, bool]] = []

    async def _deny(_event) -> bool:
        return False

    await stream_and_collect(
        provider,  # type: ignore[arg-type]
        "q",
        approval_policy=ToolApprovalPolicy.HOOK_BASED,
        hooks=None,
        on_tool_approval=_deny,
        retry_transient=False,
        on_tool_gate=lambda t, a, b: seen.append((t, a, b)),
    )

    assert seen == [(_BENIGN_TITLE, False, False)], (
        "an interactive rejection must not be reported as a security block"
    )
    assert provider.rejected == ["r1"]


@pytest.mark.asyncio
async def test_an_approved_tool_is_reported_as_approved():
    provider = _ScriptedProvider(_script(_BENIGN_TITLE))
    seen: list[tuple[str, bool, bool]] = []

    await stream_and_collect(
        provider,  # type: ignore[arg-type]
        "q",
        approval_policy=ToolApprovalPolicy.AUTO_APPROVE,
        retry_transient=False,
        on_tool_gate=lambda t, a, b: seen.append((t, a, b)),
    )

    assert seen == [(_BENIGN_TITLE, True, False)], "the approval never reached the caller"
    assert provider.approved == ["r1"]


@pytest.mark.asyncio
async def test_both_arms_are_distinguishable_within_one_turn():
    """The caller's verdict is "security-blocked something AND approved nothing",
    so a turn that got one of each must not read as fully blocked."""
    provider = _ScriptedProvider(
        [
            LLMEvent(kind=EVENT_PERMISSION_REQUEST, title=_DENIED_TITLE, request_id="r1"),
            LLMEvent(kind=EVENT_PERMISSION_REQUEST, title=_BENIGN_TITLE, request_id="r2"),
            LLMEvent(kind=EVENT_COMPLETE, text=""),
        ]
    )
    seen: list[tuple[str, bool, bool]] = []

    await stream_and_collect(
        provider,  # type: ignore[arg-type]
        "q",
        approval_policy=ToolApprovalPolicy.AUTO_APPROVE,
        retry_transient=False,
        on_tool_gate=lambda t, a, b: seen.append((t, a, b)),
    )

    assert [(a, b) for _, a, b in seen] == [(False, True), (True, False)]


@pytest.mark.asyncio
async def test_a_raising_callback_does_not_fail_the_turn():
    """Observing a gate decision is bookkeeping; it must never abort a cron run."""
    provider = _ScriptedProvider(_script(_DENIED_TITLE))

    def _boom(title: str, approved: bool, security_blocked: bool) -> None:
        raise RuntimeError("caller bug")

    text = await stream_and_collect(
        provider,  # type: ignore[arg-type]
        "q",
        approval_policy=ToolApprovalPolicy.AUTO_APPROVE,
        retry_transient=False,
        on_tool_gate=_boom,
    )

    assert text == "on it — could not."


class _RetryThenSucceedProvider:
    """Refuses a tool, fails transiently, then succeeds tool-free on the retry.

    Reproduces the shape that made refusals leak across attempts: the first
    attempt's decision described work the final turn never performed.
    """

    def __init__(self) -> None:
        self.attempts = 0
        self.rejected: list[str] = []

    async def stream(self, message: str) -> AsyncIterator[LLMEvent]:
        self.attempts += 1
        if self.attempts == 1:
            yield LLMEvent(kind=EVENT_PERMISSION_REQUEST, title=_DENIED_TITLE, request_id="r1")
            # `transient` is the structured verdict acp_error_is_transient prefers
            # over string-matching the message, so this takes the real retry route.
            exc = AcpError("backend hiccup")
            exc.transient = True  # type: ignore[attr-defined]
            raise exc
        yield LLMEvent(kind=EVENT_TEXT_CHUNK, text="done without tools")
        yield LLMEvent(kind=EVENT_COMPLETE, text="")

    async def approve_tool(self, request_id: str) -> None:
        pass

    async def reject_tool(self, request_id: str) -> None:
        self.rejected.append(request_id)


@pytest.mark.asyncio
async def test_a_discarded_retry_attempt_reports_no_gate_decisions(monkeypatch):
    """A refusal from an abandoned attempt must not reach the caller.

    Otherwise it outvotes a clean retry: the caller sees "refused something,
    approved nothing" and fails a run that actually succeeded — which for cron
    means auto-pausing a healthy recurring job.
    """
    monkeypatch.setattr(llm_helpers.asyncio, "sleep", _no_sleep)
    provider = _RetryThenSucceedProvider()
    seen: list[tuple[str, bool, bool]] = []

    text = await stream_and_collect(
        provider,  # type: ignore[arg-type]
        "q",
        approval_policy=ToolApprovalPolicy.AUTO_APPROVE,
        on_tool_gate=lambda t, a, b: seen.append((t, a, b)),
    )

    assert provider.attempts == 2, "the transient failure did not trigger a retry"
    assert text == "done without tools"
    assert seen == [], f"decisions from the abandoned attempt leaked: {seen}"


@pytest.mark.asyncio
async def test_omitting_the_callback_leaves_behavior_unchanged():
    """Every existing caller passes no callback — that path must stay inert."""
    provider = _ScriptedProvider(_script(_DENIED_TITLE))

    text = await stream_and_collect(
        provider,  # type: ignore[arg-type]
        "q",
        approval_policy=ToolApprovalPolicy.AUTO_APPROVE,
        retry_transient=False,
    )

    assert text == "on it — could not."
    assert provider.rejected == ["r1"]
