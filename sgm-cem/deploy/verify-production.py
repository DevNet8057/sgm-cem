#!/usr/bin/env python3
"""Recette HTTPS sans mutation métier ; aucun identifiant dans le rapport."""

from __future__ import annotations

import hashlib
import base64
import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import ssl
import sys
import time
import urllib.error
import urllib.request


APP_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = Path.home() / ".cache" / "sgm-cem-verification"
REPORT_PATH = OUTPUT_DIR / "report.json"
CSRF_HEADER = "x-csrf-token"


def read_credentials() -> dict[str, str]:
    values = {}
    source = APP_DIR / ".deployment-credentials.env.local"
    for line in source.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    for key in ("URL", "EMAIL", "PASSWORD"):
        if not values.get(key):
            raise ValueError("Fichier privé incomplet")
    if values["URL"].rstrip("/") not in {"https://16.16.63.155", "https://sgm-cem.16-16-63-155.sslip.io"}:
        raise ValueError("Origine différente du serveur autorisé")
    return values


class Verification:
    def __init__(self, origin: str):
        self.origin = origin.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        )
        self.results = []
        self.requests = 0

    def request(self, name, path, expected=200, *, method="GET", data=None, csrf=None):
        self.requests += 1
        if self.requests > 35:
            raise RuntimeError("Budget de requêtes dépassé")
        headers = {"Accept": "application/json", "User-Agent": "SGM-CEM-production-verification/1.0"}
        encoded = None
        if data is not None:
            encoded = json.dumps(data, separators=(",", ":")).encode("utf-8")
            headers.update({"Content-Type": "application/json", "Origin": self.origin})
        if csrf is not None:
            headers[CSRF_HEADER] = csrf
        request = urllib.request.Request(self.origin + path, data=encoded, headers=headers, method=method)
        started = time.monotonic()
        try:
            try:
                response = self.opener.open(request, timeout=110)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.code
                content_type = response.headers.get("Content-Type", "")
                body = response.read(10 * 1024 * 1024 + 1)
            document = json.loads(body) if "application/json" in content_type else None
            record = {
                "name": name, "path": path, "status": status,
                "expected_status": expected, "passed": status == expected,
                "elapsed_ms": round((time.monotonic() - started) * 1000),
                "bytes": len(body),
            }
            self.results.append(record)
            return record, document, body, content_type
        except Exception as error:
            self.results.append({"name": name, "path": path, "passed": False, "exception_type": type(error).__name__})
            raise RuntimeError("Échec de requête, détails sensibles non affichés") from None

    def assertion(self, name, condition, **metadata):
        self.results.append({"name": name, "passed": bool(condition), **metadata})

    def csrf(self, name):
        result, document, _, _ = self.request(name, "/api/csrf-token")
        token = document.get("token") if isinstance(document, dict) else None
        result["passed"] = result["passed"] and isinstance(token, str) and bool(token)
        if not result["passed"]:
            raise RuntimeError("Jeton CSRF indisponible")
        return token

    def summary(self):
        return {
            "origin": self.origin, "requests": self.requests,
            "passed": all(item["passed"] for item in self.results),
            "checks": self.results,
            "notes": [
                "Aucune création de membre, rubrique, contribution ou paiement.",
                "Les connexions/déconnexion créent les audits et sessions normaux.",
                "Intégrations externes non sollicitées.",
                "Cookies, mots de passe, jetons et contenus personnels exclus du rapport.",
            ],
        }


def main():
    parser = argparse.ArgumentParser(description="Vérifie l'API de production sans mutation métier.")
    parser.add_argument(
        "--expect-empty",
        action="store_true",
        help="Vérifie l'état initial avec un seul compte DEVELOPER et aucune donnée membre ou rubrique.",
    )
    arguments = parser.parse_args()

    os.umask(0o077)
    OUTPUT_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    credentials = read_credentials()
    verify = Verification(credentials["URL"])
    try:
        result, document, _, _ = verify.request("health", "/api/health")
        result["passed"] = result["passed"] and document.get("status") == "ok"
        verify.request("unauthenticated_me", "/api/auth/me", expected=401)
        result, document, _, _ = verify.request(
            "login_without_csrf", "/api/auth/login", expected=403,
            method="POST", data={"email": credentials["EMAIL"], "password": credentials["PASSWORD"]},
        )
        result["passed"] = result["passed"] and document.get("error", {}).get("code") == "CSRF_INVALID"

        token = verify.csrf("csrf_before_login")
        result, document, _, _ = verify.request(
            "valid_login", "/api/auth/login", method="POST", csrf=token,
            data={"email": credentials["EMAIL"], "password": credentials["PASSWORD"]},
        )
        result["passed"] = result["passed"] and document.get("success") is True
        if not result["passed"]:
            raise RuntimeError("Connexion de recette impossible")
        auth_cookies = [cookie for cookie in verify.jar if cookie.name in ("access_token", "refresh_token")]
        verify.assertion("auth_cookies_secure_httponly", len(auth_cookies) == 2 and all(
            cookie.secure and any(key.lower() == "httponly" for key in cookie._rest)
            for cookie in auth_cookies
        ))
        token = verify.csrf("csrf_after_login")

        endpoints = [
            ("authenticated_me", "/api/auth/me"),
            ("dashboard", "/api/stats/dashboard"),
            ("members", "/api/membres"),
            ("rubriques", "/api/rubriques"),
            ("settings", "/api/settings"),
            ("users", "/api/users"),
            ("developer_config", "/api/developer/config"),
        ]
        for name, path in endpoints:
            result, document, _, _ = verify.request(name, path)
            result["passed"] = result["passed"] and document.get("success") is True
            if name == "users":
                records = document.get("data")
                result["passed"] = result["passed"] and isinstance(records, list)
                if isinstance(records, list):
                    developers = [row for row in records if row.get("role") == "DEVELOPER" and row.get("isActive") is True]
                    if arguments.expect_empty:
                        verify.assertion("single_initial_developer", len(records) == 1 and len(developers) == 1, user_count=len(records))
                    else:
                        verify.assertion("active_developer_exists", len(developers) >= 1, active_developer_count=len(developers))
            if name == "members":
                records = document.get("data")
                pagination = document.get("pagination")
                total = pagination.get("total") if isinstance(pagination, dict) else None
                valid_page = isinstance(records, list) and isinstance(total, int) and not isinstance(total, bool) and total >= 0 and total >= len(records)
                verify.assertion("members_response_valid", valid_page, record_count=len(records) if isinstance(records, list) else None)
                if arguments.expect_empty:
                    verify.assertion("no_initial_members", valid_page and total == 0 and len(records) == 0)
            if name == "rubriques":
                records = document.get("data")
                valid_rubriques = isinstance(records, list)
                verify.assertion("rubriques_response_valid", valid_rubriques)
                if arguments.expect_empty:
                    verify.assertion("no_initial_rubriques", valid_rubriques and len(records) == 0)
            if name == "developer_config":
                records = document.get("data")
                result["passed"] = result["passed"] and isinstance(records, list)
                if not isinstance(records, list):
                    raise RuntimeError("Réponse de configuration invalide")
                verify.assertion("configuration_secrets_masked", all(
                    not row.get("isSecret") or row.get("value") == "••••••••" for row in records
                ))
                flags = {row.get("key"): row.get("value") for row in records}
                configs = {row.get("key"): row for row in records}
                flag_keys = ("CARD_ENABLED", "EMAIL_ENABLED", "SMS_ENABLED", "WHATSAPP_ENABLED", "MOBILE_MONEY_ENABLED", "PUSH_ENABLED")
                verify.assertion("integration_flags_boolean", all(flags.get(key) in ("true", "false") for key in flag_keys))

                def provider_configured(keys):
                    return all(configs.get(key, {}).get("isSet") is True for key in keys)

                email_enabled = flags.get("EMAIL_ENABLED") == "true"
                verify.assertion(
                    "smtp_configured_when_email_enabled",
                    not email_enabled or provider_configured(("SMTP_HOST", "SMTP_USER", "SMTP_PASS")),
                )
                provider_requirements = (
                    ("CARD_ENABLED", ("CINETPAY_API_KEY", "CINETPAY_SITE_ID", "CINETPAY_SECRET_KEY")),
                    ("SMS_ENABLED", ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM")),
                    ("WHATSAPP_ENABLED", ("DIALOG360_API_KEY",)),
                )
                for flag, keys in provider_requirements:
                    verify.assertion(
                        f"{flag.lower()}_provider_configured_when_enabled",
                        flags.get(flag) != "true" or provider_configured(keys),
                    )
                verify.assertion(
                    "mobile_money_enabled",
                    flags.get("MOBILE_MONEY_ENABLED") == "true",
                )
                verify.assertion("push_enabled", flags.get("PUSH_ENABLED") == "true")

        result, document, _, _ = verify.request("web_push_public_key", "/api/notifications/push/public-key")
        public_key = document.get("data", {}).get("publicKey", "")
        decoded = base64.urlsafe_b64decode(public_key + "=" * (-len(public_key) % 4))
        result["passed"] = result["passed"] and document.get("success") is True and len(decoded) == 65 and decoded[0] == 4

        result, document, _, _ = verify.request(
            "authenticated_post_without_csrf", "/api/membres/import", expected=403,
            method="POST", data={"membres": []},
        )
        result["passed"] = result["passed"] and document.get("error", {}).get("code") == "CSRF_INVALID"
        result, document, _, _ = verify.request(
            "oversized_array_rejected_before_validation", "/api/membres/import", expected=413,
            method="POST", csrf=token, data={"membres": [None] * 1001},
        )
        result["passed"] = result["passed"] and document.get("error", {}).get("code") == "PAYLOAD_TOO_COMPLEX"

        result, _, body, content_type = verify.request("financial_pdf", "/api/stats/financial-report.pdf")
        result["passed"] = result["passed"] and body.startswith(b"%PDF-") and "application/pdf" in content_type and len(body) > 1000
        if result["passed"]:
            pdf_path = OUTPUT_DIR / "financial-report.pdf"
            pdf_path.write_bytes(body)
            result["sha256"] = hashlib.sha256(body).hexdigest()
            result["artifact"] = str(pdf_path)

        result, document, _, _ = verify.request(
            "public_seed_password_rejected", "/api/auth/login", expected=401,
            method="POST", csrf=token,
            data={"email": credentials["EMAIL"], "password": "ChristEst!2026"},
        )
        result["passed"] = result["passed"] and document.get("error", {}).get("code") == "ACCESS_DENIED"
        verify.request("logout", "/api/auth/logout", method="POST", csrf=token, data={})
    except Exception as error:
        verify.assertion("recipe_completed", False, exception_type=type(error).__name__)
    report = verify.summary()
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(REPORT_PATH, 0o600)
    for item in report["checks"]:
        print(("PASS" if item["passed"] else "FAIL") + " " + item["name"] + (f" HTTP {item['status']}" if "status" in item else ""))
    print(f"Rapport privé : {REPORT_PATH}; requêtes : {verify.requests}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
