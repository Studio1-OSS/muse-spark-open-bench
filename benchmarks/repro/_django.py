"""Minimal Django settings shared by the reproductions (in-memory SQLite, auth + contenttypes)."""
import django
from django.conf import settings


def setup(**extra):
    settings.configure(
        INSTALLED_APPS=["django.contrib.contenttypes", "django.contrib.auth"],
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
        USE_TZ=True,
        **extra,
    )
    django.setup()


def migrate():
    from django.core.management import call_command

    call_command("migrate", verbosity=0)
