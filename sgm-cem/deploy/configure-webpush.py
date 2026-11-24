#!/usr/bin/env python3
"""Configure Web Push sans envoyer de notification ni remplacer les cles existantes."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / '.env'
COMPOSE_FILE = ROOT / 'docker-compose.prod.yml'
ORIGIN = 'https://16.16.63.155'
CONFIG_KEYS = ('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_ENABLED')

NODE_SCRIPT = r"""
'use strict'
const fs = require('node:fs')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const apiRequire = createRequire('/app/apps/api/package.json')
const webpush = apiRequire('web-push')
const { PrismaClient } = apiRequire('@prisma/client')
const prisma = new PrismaClient()
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const configKeys = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_ENABLED']

function verifyPair(keys) {
  const publicText = keys.VAPID_PUBLIC_KEY
  const privateText = keys.VAPID_PRIVATE_KEY
  if (!/^[A-Za-z0-9_-]+$/.test(publicText) || !/^[A-Za-z0-9_-]+$/.test(privateText)) {
    throw new Error('INVALID_KEY_ENCODING')
  }
  const publicBytes = Buffer.from(publicText, 'base64url')
  const privateBytes = Buffer.from(privateText, 'base64url')
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error('INVALID_KEY_LENGTH')
  }
  const curve = crypto.createECDH('prime256v1')
  curve.setPrivateKey(privateBytes)
  if (!crypto.timingSafeEqual(curve.getPublicKey(), publicBytes)) throw new Error('KEY_PAIR_MISMATCH')
  webpush.setVapidDetails(keys.VAPID_SUBJECT, publicText, privateText)
  const audience = 'https://push.example.invalid'
  const headers = webpush.getVapidHeaders(audience, keys.VAPID_SUBJECT, publicText, privateText, 'aes128gcm')
  const authorization = headers.Authorization || headers.authorization
  const token = /(?:^|\s)t=([^,\s]+)/.exec(authorization)?.[1]
  if (!token) throw new Error('LOCAL_SIGNATURE_MISSING')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('LOCAL_SIGNATURE_INVALID')
  const publicObject = crypto.createPublicKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'P-256',
    x: publicBytes.subarray(1, 33).toString('base64url'),
    y: publicBytes.subarray(33, 65).toString('base64url'),
  } })
  const valid = crypto.verify('sha256', Buffer.from(parts.slice(0, 2).join('.')), {
    key: publicObject, dsaEncoding: 'ieee-p1363',
  }, Buffer.from(parts[2], 'base64url'))
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'))
  if (!valid || claims.aud !== audience || claims.sub !== keys.VAPID_SUBJECT || claims.exp <= Date.now() / 1000) {
    throw new Error('LOCAL_SIGNATURE_INVALID')
  }
}

async function readExisting() {
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: configKeys } } })
  return new Map(rows.map(row => [row.key, row]))
}

async function prepare() {
  const rows = await readExisting()
  const env = input.env || {}
  const values = {}
  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) {
    const fromEnv = env[key] || ''
    const fromDb = rows.get(key)?.value || ''
    if (fromEnv && fromDb && fromEnv !== fromDb) throw new Error('ENV_DB_KEYS_DISAGREE')
    values[key] = fromEnv || fromDb
  }
  let generated = false
  if (!values.VAPID_PUBLIC_KEY && !values.VAPID_PRIVATE_KEY) {
    if (!input.allowGenerate) throw new Error('VAPID_NOT_CONFIGURED')
    const pair = webpush.generateVAPIDKeys()
    values.VAPID_PUBLIC_KEY = pair.publicKey
    values.VAPID_PRIVATE_KEY = pair.privateKey
    generated = true
  } else if (values.VAPID_PRIVATE_KEY && !values.VAPID_PUBLIC_KEY) {
    const curve = crypto.createECDH('prime256v1')
    curve.setPrivateKey(Buffer.from(values.VAPID_PRIVATE_KEY, 'base64url'))
    values.VAPID_PUBLIC_KEY = curve.getPublicKey().toString('base64url')
  } else if (!values.VAPID_PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY_MISSING_NO_ROTATION_PERFORMED')
  }
  values.VAPID_SUBJECT = input.origin
  values.PUSH_ENABLED = 'true'
  verifyPair(values)
  if (input.mode === 'check') {
    const present = configKeys.every(key => rows.get(key)?.value === values[key])
    const privateMasked = rows.get('VAPID_PRIVATE_KEY')?.isSecret === true
    const publicVisible = rows.get('VAPID_PUBLIC_KEY')?.isSecret === false
    if (!present || !privateMasked || !publicVisible) throw new Error('DATABASE_CONFIG_INCOMPLETE')
    return { configured: true, localSignatureVerified: true }
  }
  return { keys: values, generated, localSignatureVerified: true }
}

async function apply() {
  const values = input.keys
  verifyPair(values)
  const actor = await prisma.user.findUnique({ where: { email: input.adminEmail } })
  if (!actor || !actor.isActive || !['ADMIN', 'DEVELOPER'].includes(actor.role)) {
    throw new Error('INITIAL_ADMIN_UNAVAILABLE')
  }
  const specs = [
    ['VAPID_PUBLIC_KEY', 'Web Push - cle publique VAPID', false],
    ['VAPID_PRIVATE_KEY', 'Web Push - cle privee VAPID', true],
    ['VAPID_SUBJECT', 'Web Push - contact de production', false],
    ['PUSH_ENABLED', 'Notifications push navigateur activees', false],
  ]
  const changed = await prisma.$transaction(async tx => {
    let count = 0
    for (const [key, label, isSecret] of specs) {
      const existing = await tx.systemConfig.findUnique({ where: { key } })
      if (existing && !existing.isEditable) throw new Error('CONFIG_LOCKED')
      if (['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].includes(key) && existing?.value && existing.value !== values[key]) {
        throw new Error('CONCURRENT_KEY_CHANGE_NO_ROTATION_PERFORMED')
      }
      if (existing?.value === values[key] && existing.isSecret === isSecret && existing.category === 'NOTIFICATIONS' && existing.label === label) continue
      const metadata = { category: 'NOTIFICATIONS', label, isSecret, updatedBy: actor.id }
      await tx.systemConfig.upsert({ where: { key },
        create: { key, value: values[key], ...metadata },
        update: { value: values[key], ...metadata },
      })
      const before = isSecret || existing?.isSecret ? '[masque]' : existing?.value ?? null
      const after = isSecret ? '[masque]' : values[key]
      await tx.systemConfigHistory.create({ data: {
        configKey: key, oldValue: before, newValue: after,
        changedBy: actor.id, changedByName: actor.fullName,
        reason: 'Configuration Web Push de production sans rotation des cles',
      } })
      await tx.auditLog.create({ data: {
        userId: actor.id, userName: actor.fullName,
        action: 'DEVELOPER_PANEL_CONFIG_CHANGED', entityType: 'SystemConfig', entityId: key,
        details: { before, after, source: 'configure-webpush', reason: 'Configuration Web Push de production' },
      } })
      count += 1
    }
    return count
  })
  return { changedConfigs: changed, localSignatureVerified: true }
}

;(input.mode === 'apply' ? apply() : prepare())
  .then(result => process.stdout.write(JSON.stringify(result)))
  .catch(error => {
    console.error(`Echec configuration Web Push (${error.code || error.name || 'erreur'}). Aucune valeur secrete affichee.`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
"""


def read_env():
    if ENV_FILE.is_symlink() or not ENV_FILE.is_file():
        raise SystemExit('Un fichier .env local prive est requis.')
    os.chmod(ENV_FILE, 0o600)
    values = {}
    for raw in ENV_FILE.read_text(encoding='utf-8').splitlines():
        if not raw.strip() or raw.lstrip().startswith('#') or '=' not in raw:
            continue
        key, raw_value = raw.split('=', 1)
        parsed = shlex.split(raw_value, comments=False)
        values[key.strip()] = parsed[0] if parsed else ''
    return values


def run_node(payload):
    command = ['sudo', '-n', 'docker', 'compose', '-f', str(COMPOSE_FILE),
               'exec', '-T', 'api', 'node', '-e', NODE_SCRIPT]
    result = subprocess.run(command, cwd=ROOT, input=json.dumps(payload),
                            text=True, capture_output=True)
    if result.returncode:
        # Les erreurs Prisma ou de commande ne doivent pas exposer le stdin prive.
        raise SystemExit('La configuration Web Push a echoue ; aucune cle remplacee intentionnellement. Verifier API et base.')
    try:
        return json.loads(result.stdout)
    except (ValueError, TypeError):
        raise SystemExit('Reponse Web Push invalide ; aucune valeur privee affichee.')


def write_env(updates):
    original = ENV_FILE.read_text(encoding='utf-8')
    lines, seen = [], set()
    for line in original.splitlines():
        match = re.match(r'^\s*([A-Z][A-Z0-9_]*)\s*=', line)
        if match and match.group(1) in updates:
            key = match.group(1)
            if key not in seen:
                lines.append(f'{key}={updates[key]}')
                seen.add(key)
        else:
            lines.append(line)
    lines.extend(f'{key}={value}' for key, value in updates.items() if key not in seen)
    content = '\n'.join(lines) + '\n'
    if content == original:
        return False
    descriptor, temporary = tempfile.mkstemp(prefix='.env.webpush-', dir=ROOT)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, ENV_FILE)
        os.chmod(ENV_FILE, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verifier sans ecrire ni generer de cles')
    args = parser.parse_args()
    lock_path = ROOT / '.env.webpush.lock'
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(descriptor, 'a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        env = read_env()
        if not env.get('ADMIN_EMAIL'):
            raise SystemExit('ADMIN_EMAIL est requis pour tracer la configuration.')
        targeted_env = {key: env.get(key, '') for key in CONFIG_KEYS}
        prepared = run_node({'mode': 'check' if args.check else 'prepare',
                             'env': targeted_env, 'origin': ORIGIN,
                             'allowGenerate': not args.check})
        if args.check:
            if not env.get('VAPID_PUBLIC_KEY') or not env.get('VAPID_PRIVATE_KEY'):
                raise SystemExit('Les cles VAPID doivent rester sauvegardees dans .env.')
            if any(env.get(key) != value for key, value in {'VAPID_SUBJECT': ORIGIN, 'PUSH_ENABLED': 'true'}.items()):
                raise SystemExit('La configuration .env est incomplete.')
            print('Web Push configure : paire P-256 et signature VAPID locale valides. Aucun envoi effectue.')
            return
        env_changed = write_env(prepared['keys'])
        applied = run_node({'mode': 'apply', 'keys': prepared['keys'], 'adminEmail': env['ADMIN_EMAIL']})
        print(json.dumps({'configured': True, 'keysGenerated': prepared['generated'],
                          'envChanged': env_changed, 'changedConfigs': applied['changedConfigs'],
                          'localSignatureVerified': True, 'notificationSent': False}))
        print('Recreer le conteneur API pour recharger .env et le cache de configuration.')


if __name__ == '__main__':
    main()
