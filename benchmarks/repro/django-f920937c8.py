# Muse: the converter-less fast path calls path.startswith(self._route), which fails for gettext_lazy() routes.
import _django

_django.setup(USE_I18N=True, LANGUAGE_CODE="en")
from django.urls.resolvers import RoutePattern
from django.utils.translation import gettext_lazy as _

try:
    match = RoutePattern(_("translated/"), is_endpoint=False).match("translated/page/")
except TypeError as e:
    print("BUG:", e)
    raise SystemExit(1)
if not match:
    print("BUG: lazy route did not match its own prefix")
    raise SystemExit(1)
print("OK: lazy route matched, remaining path =", match[0])
