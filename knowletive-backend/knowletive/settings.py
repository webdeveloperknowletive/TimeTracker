
"""
Django settings for knowletive project.

Development and production configuration.
Production secrets and database credentials must be provided
through environment variables in Coolify.
"""

import os
import sys
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured


# ============================================================
# BASE CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent.parent


# ============================================================
# LOAD LOCAL .env FILE (IF PRESENT)
# ============================================================

# In production, configure these variables in Coolify.
# Never commit a .env file containing passwords or secrets.
_env_path = BASE_DIR / ".env"

if _env_path.exists():
    with open(_env_path, "r", encoding="utf-8") as env_file:
        for line in env_file:
            line = line.strip()

            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)

            os.environ.setdefault(
                key.strip(),
                value.strip().strip("'\""),
            )


# ============================================================
# SECURITY SETTINGS
# ============================================================

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "").strip()

if not SECRET_KEY:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be configured in the environment."
    )


DEBUG = os.environ.get("DEBUG", "False").strip().lower() in (
    "true",
    "1",
    "yes",
)


_default_hosts = "timetracker-api.knowletive.in,timetracker.knowletive.in,localhost,127.0.0.1"
_configured_hosts = os.environ.get("ALLOWED_HOSTS", "").strip()
ALLOWED_HOSTS = [
    host.strip()
    for host in (_configured_hosts or _default_hosts).split(",")
    if host.strip()
]
for _h in ["timetracker-api.knowletive.in", "timetracker.knowletive.in", "localhost", "127.0.0.1", "testserver"]:
    if _h not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(_h)

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


# ============================================================
# APPLICATION DEFINITION
# ============================================================

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "tracker",
]



MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]



ROOT_URLCONF = "knowletive.urls"


TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


WSGI_APPLICATION = "knowletive.wsgi.application"


# ============================================================
# DATABASE CONFIGURATION
# ============================================================

# Tests use an in-memory SQLite database.
# All non-test commands require DATABASE_URL.
# Coolify should supply the internal PostgreSQL connection URL.

if "test" in sys.argv:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": ":memory:",
        }
    }

else:
    DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

    if not DATABASE_URL:
        raise ImproperlyConfigured(
            "DATABASE_URL must be configured in the environment."
        )

    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
        )
    }


# ============================================================
# PASSWORD VALIDATION
# ============================================================

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "MinimumLengthValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "CommonPasswordValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "NumericPasswordValidator"
        ),
    },
]


# ============================================================
# INTERNATIONALIZATION
# ============================================================

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# ============================================================
# STATIC FILES
# ============================================================

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# ============================================================
# CUSTOM USER MODEL
# ============================================================

AUTH_USER_MODEL = "tracker.User"


# ============================================================
# CORS CONFIGURATION
# ============================================================

# Set CORS_ALLOWED_ORIGINS in Coolify to the exact frontend URL.
# Example: https://timetracker.example.com
#
# Do not enable CORS_ALLOW_ALL_ORIGINS in production unless
# you deliberately intend to allow requests from every origin.

CORS_ALLOW_ALL_ORIGINS = (
    os.environ.get("CORS_ALLOW_ALL_ORIGINS", "False")
    .strip()
    .lower()
    in ("true", "1", "yes")
)


_default_cors_origins = [
    "https://timetracker.knowletive.in",
    "https://timetracker-api.knowletive.in",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]
_env_cors = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
CORS_ALLOWED_ORIGINS = list(dict.fromkeys(_default_cors_origins + _env_cors))

# Chrome Extension origin support (Origin: chrome-extension://<id>)
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^chrome-extension://.*$",
]
CORS_ALLOW_CREDENTIALS = True


# CSRF Trusted Origins
_default_csrf = [
    "https://timetracker.knowletive.in",
    "https://timetracker-api.knowletive.in",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
]
_env_csrf = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]
CSRF_TRUSTED_ORIGINS = list(dict.fromkeys(_default_csrf + _env_csrf))


# ============================================================
# DJANGO REST FRAMEWORK
# ============================================================

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
    ],
    "URL_FORMAT_OVERRIDE": None,
}


# ============================================================
# EMAIL CONFIGURATION
# ============================================================

# Preserved from the existing project.
# This dictionary is a custom setting; Django's built-in email
# backend uses EMAIL_BACKEND instead.

MAILERS = {
    "default": {
        "BACKEND": "django.core.mail.backends.console.EmailBackend",
    },
}


# ============================================================
# DEFAULT PRIMARY KEY
# ============================================================

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
