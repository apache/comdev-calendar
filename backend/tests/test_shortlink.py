"""Shortlink token generation."""

from __future__ import annotations

import pytest

from asfcalendar import shortlink


def test_default_length_and_alphabet() -> None:
    token = shortlink.generate()
    assert len(token) == shortlink.DEFAULT_LENGTH
    assert all(character in shortlink.ALPHABET for character in token)


def test_tokens_avoid_ambiguous_characters() -> None:
    for character in "01ILOUl":
        assert character not in shortlink.ALPHABET


def test_tokens_are_not_repeated() -> None:
    tokens = {shortlink.generate() for _ in range(2000)}
    assert len(tokens) == 2000


def test_short_tokens_are_refused() -> None:
    with pytest.raises(ValueError):
        shortlink.generate(3)


@pytest.mark.parametrize("token", ["AbCd2345", "aaaa", shortlink.generate(12)])
def test_valid_tokens(token: str) -> None:
    assert shortlink.is_valid(token)


@pytest.mark.parametrize("token", ["", "with space", "no/slash", "0OIl", "x" * 33, "abc$"])
def test_invalid_tokens(token: str) -> None:
    assert not shortlink.is_valid(token)
