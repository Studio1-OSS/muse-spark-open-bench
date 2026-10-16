# Muse: yaml.dump(..., sort_keys=False, **self.options) raises TypeError when the caller passes sort_keys.
import _django

_django.setup()
from django.core import serializers

try:
    serializers.serialize("yaml", [], sort_keys=True)
except TypeError as e:
    print("BUG:", e)
    raise SystemExit(1)
print("OK: serialize('yaml', sort_keys=True) works")
