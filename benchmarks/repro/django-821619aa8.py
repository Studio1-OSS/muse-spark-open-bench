# Muse: with a custom Prefetch queryset, get_prefetch_querysets() no longer adds the parent instance hint,
# so database routers stop receiving it.
import _django

seen = []


class Recorder:
    def db_for_read(self, model, **hints):
        if model.__name__ == "ContentType":
            seen.append("instance" in hints)
        return None


_django.setup(DATABASE_ROUTERS=[Recorder()])
_django.migrate()
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.db.models import Prefetch

seen.clear()
list(Permission.objects.prefetch_related(Prefetch("content_type", queryset=ContentType.objects.all()))[:5])
if not any(seen):
    print("BUG: router saw no instance hint for the custom Prefetch queryset; calls:", seen)
    raise SystemExit(1)
print("OK: router received the instance hint")
