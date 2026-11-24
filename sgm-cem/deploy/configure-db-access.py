#!/usr/bin/env python3
"""Configure le profil administrateur PostgreSQL demandé, derrière un tunnel SSH."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
CREDENTIALS = ROOT / ".database-access.env.local"
ROLE = "sgm_remote"
DATABASE = "sgm_cem"
ACCESS_PROFILE = "POSTGRESQL_SUPERUSER"
PRIVILEGES = "SUPERUSER,CREATEDB,CREATEROLE"
COMPOSE = ["sudo", "-n", "docker", "compose", "-p", "sgm-cem", "-f", str(ROOT / "docker-compose.prod.yml")]
ADMIN_PSQL = COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def execute_sql(command: list[str], sql: str, environment: dict[str, str] | None = None) -> str:
    result = subprocess.run(command, input=sql, text=True, capture_output=True,
                            cwd=ROOT, env=environment, check=False)
    if result.returncode:
        # psql peut inclure du SQL dans stderr : ne jamais relayer un secret.
        raise RuntimeError("Commande PostgreSQL refusée ou indisponible ; aucun détail sensible affiché.")
    return result.stdout.strip()


def read_private_credentials() -> dict[str, str]:
    if CREDENTIALS.is_symlink() or not CREDENTIALS.is_file():
        raise RuntimeError("Le fichier d'accès existant n'est pas un fichier privé normal.")
    os.chmod(CREDENTIALS, 0o600)
    values = {}
    for line in CREDENTIALS.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    if (values.get("USER") != ROLE or values.get("DATABASE") != DATABASE
            or len(values.get("PASSWORD", "")) < 32
            or len(values.get("MANAGED_ROLE_ID", "")) != 32):
        raise RuntimeError("Fichier d'accès inattendu ; aucun identifiant remplacé.")
    return values


def main() -> None:
    metadata_json = execute_sql(ADMIN_PSQL, f"""
SELECT json_build_object('marker', shobj_description(oid, 'pg_authid'),
 'superuser', rolsuper, 'createdb', rolcreatedb, 'createrole', rolcreaterole,
 'replication', rolreplication, 'bypassrls', rolbypassrls,
 'memberships', (SELECT count(*) FROM pg_auth_members WHERE member = pg_roles.oid))
FROM pg_roles WHERE rolname = {sql_literal(ROLE)};
""")
    metadata = json.loads(metadata_json) if metadata_json else None

    if CREDENTIALS.exists():
        values = read_private_credentials()
    else:
        if metadata is not None:
            raise RuntimeError("Le rôle existe sans les identifiants gérés attendus ; création et rotation refusées.")
        values = {
            "DRIVER": "PostgreSQL",
            "HOST": "127.0.0.1",
            "PORT": "15432",
            "DATABASE": DATABASE,
            "USER": ROLE,
            "PASSWORD": "Aa1!" + secrets.token_urlsafe(36),
            "ACCESS_PROFILE": ACCESS_PROFILE,
            "PRIVILEGES": PRIVILEGES,
            "SSH_HOST": "16.16.63.155",
            "SSH_PORT": "22",
            "SSH_USER": "ubuntu",
            "SSH_REMOTE_DB_HOST": "127.0.0.1",
            "SSH_REMOTE_DB_PORT": "5433",
            "SSH_TUNNEL": 'ssh -N -o ExitOnForwardFailure=yes -L 15432:127.0.0.1:5433 -i "$env:USERPROFILE\\.ssh\\ec2-lgm" ubuntu@16.16.63.155',
            "MANAGED_ROLE_ID": secrets.token_hex(16),
        }
        descriptor = os.open(CREDENTIALS, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        if os.geteuid() == 0:
            owner = ROOT.stat()
            os.fchown(descriptor, owner.st_uid, owner.st_gid)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("# Accès PostgreSQL privé par tunnel SSH ; ne pas versionner ni sourcer.\n")
            handle.write("".join(f"{key}={value}\n" for key, value in values.items()))

    marker = "sgm-cem-managed-db-access/v1/" + values["MANAGED_ROLE_ID"]
    if metadata is not None:
        if metadata.get("marker") != marker:
            raise RuntimeError("Rôle existant inattendu ; aucune modification automatique autorisée.")

    execute_sql(ADMIN_PSQL, f"""
BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL client_min_messages = 'warning';
DO $managed_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {sql_literal(ROLE)}) THEN
    IF (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = {sql_literal(ROLE)}) IS DISTINCT FROM {sql_literal(marker)} THEN
      RAISE EXCEPTION 'Role non gere refuse';
    END IF;
    ALTER ROLE sgm_remote WITH SUPERUSER CREATEDB CREATEROLE;
  ELSE
    CREATE ROLE sgm_remote LOGIN SUPERUSER CREATEDB CREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD {sql_literal(values['PASSWORD'])};
    COMMENT ON ROLE sgm_remote IS {sql_literal(marker)};
  END IF;
END
$managed_role$;
GRANT CONNECT ON DATABASE sgm_cem TO sgm_remote;
GRANT USAGE ON SCHEMA public TO sgm_remote;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sgm_remote;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO sgm_remote;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sgm_remote;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO sgm_remote;
COMMIT;
""")

    environment = os.environ.copy()
    environment["PGPASSWORD"] = values["PASSWORD"]
    # L'adresse Docker évite la règle trust de loopback créée par initdb.
    # sudo conserve seulement ce nom d'environnement, jamais sa valeur en argv.
    client_compose = COMPOSE[:2] + ["--preserve-env=PGPASSWORD"] + COMPOSE[2:]
    client_psql = client_compose + ["exec", "-T", "-e", "PGPASSWORD", "postgres", "psql", "-X", "-qAt",
                                    "-v", "ON_ERROR_STOP=1", "-h", "postgres", "-U", ROLE, "-d", DATABASE]
    authenticated = execute_sql(client_psql, "SELECT current_user || ':' || current_database();\n", environment)
    if authenticated != f"{ROLE}:{DATABASE}":
        raise RuntimeError("Validation du compte distant échouée ; aucune rotation de mot de passe effectuée.")
    profile_confirmed = execute_sql(ADMIN_PSQL, f"SELECT rolsuper AND rolcreatedb AND rolcreaterole FROM pg_roles WHERE rolname = {sql_literal(ROLE)};\n")
    if profile_confirmed != "t":
        raise RuntimeError("Le profil administrateur PostgreSQL demandé n'est pas confirmé.")
    if values.get("ACCESS_PROFILE") != ACCESS_PROFILE or values.get("PRIVILEGES") != PRIVILEGES:
        # Ajouter seulement les métadonnées : ne jamais réécrire ni régénérer PASSWORD.
        with CREDENTIALS.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(f"\nACCESS_PROFILE={ACCESS_PROFILE}\nPRIVILEGES={PRIVILEGES}\n")
        os.chmod(CREDENTIALS, 0o600)
    print("Rôle PostgreSQL configuré et authentification validée : sgm_remote / sgm_cem.")
    print("Profil demandé : SUPERUSER, CREATEDB et CREATEROLE sur le cluster PostgreSQL.")
    print("Accès réseau inchangé : tunnel SSH, PostgreSQL sur 127.0.0.1:5433 uniquement.")
    print("Identifiants privés : .database-access.env.local (600) ; aucun mot de passe affiché.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Échec de configuration de l'accès PostgreSQL : {error}", file=sys.stderr)
        sys.exit(1)
