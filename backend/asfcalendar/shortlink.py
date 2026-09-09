"""Short, URL-safe tokens for event shortlinks."""

from __future__ import annotations

import secrets

# Crockford-ish alphabet: no I, L, O, U, 0 or 1, so tokens survive being read
# aloud or copied out of an email.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz"
DEFAULT_LENGTH = 8


def generate(length: int = DEFAULT_LENGTH) -> str:
    """Returns a random shortlink token.

    With 52 symbols and the default length of 8 there are ~5e13 possibilities,
    which is far more than we need; the storage layer retries on the (very
    unlikely) collision anyway.
    """
    if length < 4:
        raise ValueError("Shortlink tokens must be at least 4 characters")
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def is_valid(token: str) -> bool:
    """Cheap sanity check so we can reject junk before hitting the database."""
    if not token or len(token) > 32:
        return False
    return all(character in ALPHABET for character in token)
