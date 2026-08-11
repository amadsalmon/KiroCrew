"""Migration from the deprecated ``poolable_servers`` to ``stub_servers``.

This is the guarantee an existing install depends on across the upgrade that
makes the stub opt-in: a machine that had pooled servers keeps its stubs, a
fresh machine gets none, and an operator who deliberately cleared the list is
not silently re-stubbed from the old key.

The decisive property is that the choice is made on KEY PRESENCE, not on
truthiness. ``stub_servers: []`` and "no ``stub_servers`` at all" are different
statements about intent, and only one of them may fall back.
"""

import json
import tempfile
import unittest.mock
from pathlib import Path

from kiro_crew.config.loader import KiroCrewConfig, _resolve_stub_servers


def _load_from_dict(data: object) -> KiroCrewConfig:
    """Write *data* to a temp config file and load via KiroCrewConfig.load()."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(data, f)
        tmp = Path(f.name)
    try:
        with unittest.mock.patch(
            "kiro_crew.config.loader.config_path",
            return_value=tmp,
        ):
            return KiroCrewConfig.load()
    finally:
        tmp.unlink(missing_ok=True)


class TestResolver:
    """The pure decision, isolated from config loading."""

    def test_the_new_key_wins_when_present(self) -> None:
        assert _resolve_stub_servers(
            {"stub_servers": ["alpha-mcp"], "poolable_servers": ["beta-mcp"]}
        ) == ["alpha-mcp"]

    def test_an_explicitly_empty_new_key_does_not_fall_back(self) -> None:
        """The load-bearing case.

        An operator who cleared the list wrote ``[]`` on purpose. Reading that as
        "falsy, so try the old key" would re-stub every server they had just
        turned off — the exact default this change exists to remove.
        """
        assert _resolve_stub_servers(
            {"stub_servers": [], "poolable_servers": ["beta-mcp", "gamma-mcp"]}
        ) == []

    def test_the_deprecated_key_is_read_only_when_the_new_one_is_absent(self) -> None:
        """An existing install keeps its behaviour: a pooled server already ran
        behind a stub, since pooling was only reachable through one."""
        assert _resolve_stub_servers({"poolable_servers": ["beta-mcp"]}) == ["beta-mcp"]

    def test_a_fresh_install_stubs_nothing(self) -> None:
        assert _resolve_stub_servers({}) == []

    def test_junk_entries_are_dropped_rather_than_carried(self) -> None:
        assert _resolve_stub_servers(
            {"stub_servers": ["ok-mcp", "", None, 7, {"a": 1}, "also-ok"]}
        ) == ["ok-mcp", "also-ok"]

    def test_a_non_list_value_is_not_trusted(self) -> None:
        assert _resolve_stub_servers({"stub_servers": "alpha-mcp"}) == []
        assert _resolve_stub_servers({"poolable_servers": {"alpha-mcp": True}}) == []


class TestThroughTheLoader:
    """The resolver wired into ``KiroCrewConfig.load``, which is what ships."""

    def test_a_legacy_config_arrives_as_stub_servers(self) -> None:
        cfg = _load_from_dict({"mcp_gateway": {"poolable_servers": ["legacy-mcp"]}})
        assert cfg.mcp_gateway.stub_servers == ["legacy-mcp"]

    def test_a_cleared_list_survives_the_load(self) -> None:
        cfg = _load_from_dict(
            {"mcp_gateway": {"stub_servers": [], "poolable_servers": ["legacy-mcp"]}}
        )
        assert cfg.mcp_gateway.stub_servers == []

    def test_the_shipped_default_is_empty(self) -> None:
        """No mcp_gateway section at all — the state of a fresh install."""
        cfg = _load_from_dict({})
        assert cfg.mcp_gateway.stub_servers == []
