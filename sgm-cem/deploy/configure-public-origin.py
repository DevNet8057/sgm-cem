#!/usr/bin/env python3
"""Change l'origine publique sans remplacer les identifiants ni les cles privees."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ORIGIN = "https://sgm-cem.16-16-63-155.sslip.io"
COMPOSE = ["sudo", "-n", "docker", "compose", "-p", "sgm-cem", "-f", "docker-compose.prod.yml"]

DATABASE_SCRIPT = r"""
'use strict'
const { PrismaClient } = require('@prisma/client')
const fs = require('node:fs')
const prisma = new PrismaClient()
async function main() {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'))
  const actor = await prisma.user.findUnique({
    where: { email: payload.adminEmail },
    select: { id: true, fullName: true, role: true, isActive: true },
  })
  if (!actor?.isActive || !['ADMIN', 'DEVELOPER'].includes(actor.role)) {
    throw new Error('Administrateur initial actif requis')
  }
  const changes = await prisma.$transaction(async tx => {
    const changed = []
    for (const conf of payload.configs) {
      const current = await tx.systemConfig.findUnique({ where: { key: conf.key } })
      if (current?.isSecret) throw new Error('Cle publique declaree secrete')
      if (current?.value === conf.value) continue
      await tx.systemConfig.upsert({
        where: { key: conf.key },
        create: { ...conf, isSecret: false, updatedBy: actor.id },
        update: { value: conf.value, updatedBy: actor.id },
      })
      await tx.systemConfigHistory.create({ data: {
        configKey: conf.key,
        oldValue: current?.value ?? null,
        newValue: conf.value,
        changedBy: actor.id,
        changedByName: actor.fullName,
        reason: 'Changement autorise de l origine publique du deploiement',
      } })
      await tx.auditLog.create({ data: {
        userId: actor.id,
        userName: actor.fullName,
        action: 'DEVELOPER_PANEL_CONFIG_CHANGED',
        entityType: 'SystemConfig',
        entityId: conf.key,
        details: {
          source: 'configure-public-origin',
          oldValue: current?.value ?? null,
          newValue: conf.value,
        },
      } })
      changed.push(conf.key)
    }
    return changed
  }, { timeout: 15000 })
  console.log(JSON.stringify({ changedKeys: changes }))
}
main().catch(error => {
  console.error(`Migration DB refusee (${error.code || error.name || 'erreur'}).`)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
"""


def read_values(text):
    values = {}
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        parsed = shlex.split(value, comments=False)
        values[key.strip()] = parsed[0] if parsed else ""
    return values


def replace_public_values(text, updates):
    lines, written = [], set()
    for raw in text.splitlines():
        match = re.match(r"^\s*([A-Z][A-Z0-9_]*)\s*=", raw)
        key = match.group(1) if match else None
        if key in updates:
            if key not in written:
                lines.append(f"{key}={updates[key]}")
                written.add(key)
        else:
            lines.append(raw)
    lines.extend(f"{key}={value}" for key, value in updates.items() if key not in written)
    return "\n".join(lines) + "\n"


def atomic_private_write(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default=DEFAULT_ORIGIN)
    parser.add_argument("--apply", action="store_true", help="Appliquer aux fichiers prives et a PostgreSQL")
    args = parser.parse_args()
    origin = args.origin.rstrip("/")
    parsed = urlsplit(origin)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443)):
        raise SystemExit("Origine HTTPS simple requise (sans chemin ni identifiants).")

    env_path = ROOT / ".env"
    credentials_path = ROOT / ".deployment-credentials.env.local"
    lock_path = ROOT / ".env.public-origin.lock.env.local"
    with open(lock_path, "a", encoding="utf-8") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        before = env_path.read_text(encoding="utf-8")
        values = read_values(before)
        if not values.get("ADMIN_EMAIL"):
            raise SystemExit("ADMIN_EMAIL requis ; aucun changement applique.")
        updates = {
            "APP_URL": origin,
            "API_URL": origin,
            "NEXT_PUBLIC_API_URL": origin,
            "NEXT_PUBLIC_APP_URL": origin,
            "PAYMENT_RETURN_URL": origin + "/payment/return",
            "YELII_WEBHOOK_URL": origin + "/webhooks/yelii",
            "VAPID_SUBJECT": origin,
        }
        after = replace_public_values(before, updates)
        updated_values = read_values(after)
        # Verifier aussi les flags : seules les sept URLs ci-dessus peuvent changer.
        assert {key: val for key, val in values.items() if key not in updates} == {
            key: val for key, val in updated_values.items() if key not in updates
        }, "Une valeur hors perimetre aurait ete modifiee"
        planned = [key for key, val in updates.items() if values.get(key) != val]
        print(f"Origine cible : {origin}")
        print("Cles publiques a ajuster : " + (", ".join(planned) or "aucune"))
        if not args.apply:
            print("Simulation : configuration et base inchangees.")
            return

        backup = None
        if before != after:
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
            backup = ROOT / f".env.backup-public-origin-{stamp}.env.local"
            with open(backup, "x", encoding="utf-8", opener=lambda p, flags: os.open(p, flags, 0o600)) as handle:
                handle.write(before)
            atomic_private_write(env_path, after)

        specs = [
            {"key": key, "value": updates[key], "category": category, "label": label}
            for key, category, label in (
                ("APP_URL", "INFRASTRUCTURE", "URL de l application"),
                ("API_URL", "INFRASTRUCTURE", "URL publique de l API"),
                ("PAYMENT_RETURN_URL", "WEBHOOKS", "URL de retour apres paiement"),
                ("YELII_WEBHOOK_URL", "WEBHOOKS", "URL Webhook Yelii"),
                ("VAPID_SUBJECT", "NOTIFICATIONS", "Contact Web Push"),
            )
        ]
        result = subprocess.run(
            COMPOSE + ["exec", "-T", "--workdir", "/app/apps/api", "api", "node", "-e", DATABASE_SCRIPT],
            input=json.dumps({"adminEmail": values["ADMIN_EMAIL"], "configs": specs}),
            text=True, cwd=ROOT, capture_output=True,
        )
        if result.returncode:
            if before != after:
                atomic_private_write(env_path, before)
            raise SystemExit("Migration DB echouee ; fichier .env restaure. Aucun secret affiche.")
        report = json.loads(result.stdout.strip())
        if credentials_path.exists():
            credentials_before = credentials_path.read_text(encoding="utf-8")
            credentials_after = replace_public_values(credentials_before, {"URL": origin})
            if credentials_before != credentials_after:
                atomic_private_write(credentials_path, credentials_after)
        if backup:
            print(f"Sauvegarde privee : {backup.name} (600)")
        print("Cles DB modifiees et auditees : " + (", ".join(report["changedKeys"]) or "aucune"))
        print("Secrets, cles VAPID et flags conserves. Reconstruire web et recreer api/web avant verification.")


if __name__ == "__main__":
    main()
