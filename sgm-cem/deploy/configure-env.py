#!/usr/bin/env python3
"""Crée une configuration locale privée sans remplacer les secrets existants."""
import os
from pathlib import Path
import secrets
import shlex

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"
CREDENTIALS = ROOT / ".deployment-credentials.env.local"
ORIGIN = "https://16.16.63.155"


def private_create(path: Path, content: str) -> bool:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        os.chmod(path, 0o600)
        return False
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
    return True


postgres_password = secrets.token_hex(32)
redis_password = secrets.token_hex(32)
values = {
    "NODE_ENV": "production",
    "PORT": "3001",
    "TZ": "Africa/Douala",
    "APP_URL": ORIGIN,
    "API_URL": ORIGIN,
    "NEXT_PUBLIC_API_URL": ORIGIN,
    "NEXT_PUBLIC_APP_URL": ORIGIN,
    "POSTGRES_PASSWORD": postgres_password,
    "DATABASE_URL": f"postgresql://postgres:{postgres_password}@postgres:5432/sgm_cem",
    "REDIS_PASSWORD": redis_password,
    "REDIS_URL": f"redis://:{redis_password}@redis:6379",
    "JWT_SECRET": secrets.token_hex(64),
    "REFRESH_TOKEN_SECRET": secrets.token_hex(64),
    "CSRF_SECRET": secrets.token_hex(48),
    "CRON_SECRET": secrets.token_hex(48),
    "ADMIN_EMAIL": "admin@sgm-cem.local",
    "DEVELOPER_EMAIL": "admin@sgm-cem.local",
    "ADMIN_PASSWORD": "Aa1!" + secrets.token_urlsafe(32),
    "PAYMENT_RETURN_URL": ORIGIN + "/payment/return",
    "YELII_WEBHOOK_URL": ORIGIN + "/webhooks/yelii",
    "MOBILE_MONEY_ENABLED": "false",
    "CARD_ENABLED": "false",
    "CASH_ENABLED": "true",
    "WHATSAPP_ENABLED": "false",
    "SMS_ENABLED": "false",
    "EMAIL_ENABLED": "false",
    "PUSH_ENABLED": "false",
    "AUTO_SEND_RECEIPT_WHATSAPP": "false",
    "LOG_LEVEL": "info",
}

created = private_create(
    ENV,
    "# Configuration privée de production — ne pas versionner.\n"
    + "".join(f"{key}={value}\n" for key, value in values.items()),
)

# Si .env existe, réutiliser ses identifiants et ne jamais les régénérer.
current = {}
for raw in ENV.read_text(encoding="utf-8").splitlines():
    if not raw.strip() or raw.lstrip().startswith("#") or "=" not in raw:
        continue
    key, value = raw.split("=", 1)
    parsed = shlex.split(value, comments=False)
    current[key.strip()] = parsed[0] if parsed else ""
required = ("ADMIN_EMAIL", "ADMIN_PASSWORD", "APP_URL")
if not all(current.get(key) for key in required):
    raise SystemExit("Configuration existante incomplète ; aucun secret remplacé.")

private_create(
    CREDENTIALS,
    "# Accès initial privé — ne pas envoyer ni versionner.\n"
    + f"URL={current['APP_URL']}\n"
    + f"EMAIL={current['ADMIN_EMAIL']}\n"
    + f"PASSWORD={current['ADMIN_PASSWORD']}\n"
    + "# Changer le mot de passe depuis le compte après la première connexion.\n",
)
print("Configuration privée créée." if created else "Configuration existante conservée.")
print("Identifiants disponibles dans .deployment-credentials.env.local (permissions 600).")
