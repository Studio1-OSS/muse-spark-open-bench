# Muse: orderby_issubset_groupby resolves '-field' as a field name, so values().annotate().order_by('-x').count() crashes.
import _django

_django.setup()
_django.migrate()
from django.contrib.auth.models import User
from django.db.models import Max

try:
    n = User.objects.values("is_staff").annotate(latest=Max("date_joined")).order_by("-latest").count()
except Exception as e:
    print("BUG:", type(e).__name__, e)
    raise SystemExit(1)
print("OK: count() =", n)
