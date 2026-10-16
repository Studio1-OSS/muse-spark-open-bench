# Muse: PBKDF2PasswordHasher.encode() calls force_str(password) and rejects non-UTF-8 bytes passwords.
import _django

_django.setup(PASSWORD_HASHERS=["django.contrib.auth.hashers.PBKDF2PasswordHasher"])
from django.contrib.auth.hashers import PBKDF2PasswordHasher

try:
    PBKDF2PasswordHasher().encode(b"\x80password", "seasalt", iterations=1)
except Exception as e:
    print("BUG:", type(e).__name__, e)
    raise SystemExit(1)
print("OK: non-UTF-8 bytes password hashed")
