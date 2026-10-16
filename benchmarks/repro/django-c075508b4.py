# Muse: MediaType.params no longer includes "q", a breaking change for code that reads it.
import _django

_django.setup()
from django.http.request import MediaType

params = MediaType("text/html; q=0.5").params
if "q" not in params:
    print("BUG: MediaType('text/html; q=0.5').params =", dict(params))
    raise SystemExit(1)
print("OK: params =", dict(params))
