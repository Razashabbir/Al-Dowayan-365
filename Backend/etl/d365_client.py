"""Thin client for the Dynamics 365 Finance & Operations OData API (client-credentials auth).

Credentials come from a tenant record (see tenants.py) or, for quick tests, from .env.
"""
import os
import time
from urllib.parse import parse_qs, urlparse

import msal
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


class D365Error(RuntimeError):
    """Error with a message that is safe and useful to show to an end user."""


def normalize_env_url(url: str) -> tuple[str, str | None]:
    """'https://x.operations.dynamics.com/?cmp=03aa&mi=...' -> ('https://x.operations.dynamics.com', '03aa')"""
    url = (url or "").strip()
    if not url.lower().startswith("http"):
        url = "https://" + url
    p = urlparse(url)
    if not p.netloc:
        raise D365Error("Environment URL is not valid.")
    cmp = parse_qs(p.query).get("cmp", [None])[0]
    return f"https://{p.netloc}", cmp


def friendly_auth_error(result: dict) -> str:
    code = (result.get("error_codes") or [None])[0]
    desc = result.get("error_description", "")
    known = {
        7000215: "Client secret is wrong. Paste the secret VALUE (not the Secret ID).",
        7000222: "Client secret has expired. Create a new one in Entra ID.",
        700016: "Application (client) ID was not found in this directory (tenant).",
        90002: "Directory (tenant) ID was not found.",
        900023: "Directory (tenant) ID is not valid.",
        500011: "The environment URL is not a resource in this tenant. Check the D365 URL.",
    }
    return known.get(code, f"{result.get('error')}: {desc.splitlines()[0] if desc else 'token request failed'}")


class D365Client:
    def __init__(self, tenant_id=None, client_id=None, client_secret=None, base_url=None):
        if all(v is None for v in (tenant_id, client_id, client_secret, base_url)):  # CLI: use .env
            tenant_id, client_id = os.getenv("D365_TENANT_ID"), os.getenv("D365_CLIENT_ID")
            client_secret, base_url = os.getenv("D365_CLIENT_SECRET"), os.getenv("D365_BASE_URL")
        missing = [n for n, v in (("Directory (tenant) ID", tenant_id), ("Application (client) ID", client_id),
                                  ("Client secret", client_secret), ("Environment URL", base_url)) if not v]
        if missing:
            raise D365Error(f"Missing: {', '.join(missing)}.")
        self.base_url, _ = normalize_env_url(base_url)
        self._msal_args = dict(client_id=client_id.strip(), client_credential=client_secret.strip(),
                               authority=f"https://login.microsoftonline.com/{tenant_id.strip()}")
        self._app = None
        self.scope = [f"{self.base_url}/.default"]
        self.session = requests.Session()

    # ---- auth -------------------------------------------------------------
    def token(self) -> str:
        try:
            if self._app is None:  # contacts Microsoft Entra to discover the tenant
                self._app = msal.ConfidentialClientApplication(**self._msal_args)
            result = self._app.acquire_token_for_client(scopes=self.scope)  # MSAL caches + refreshes
        except requests.RequestException as ex:
            raise D365Error("Cannot reach login.microsoftonline.com. Check the server's internet/proxy access.") from ex
        except ValueError as ex:  # unknown / malformed tenant
            raise D365Error(f"Directory (tenant) ID was not accepted by Microsoft Entra: {ex}") from ex
        if "access_token" not in result:
            raise D365Error(friendly_auth_error(result))
        return result["access_token"]

    def _headers(self, accept="application/json") -> dict:
        return {
            "Authorization": f"Bearer {self.token()}",
            "Accept": accept,
            "OData-Version": "4.0",
            "Prefer": "odata.maxpagesize=5000",
        }

    # ---- http with retry --------------------------------------------------
    NET_RETRIES = int(os.getenv("D365_NET_RETRIES", "8"))   # ~8 minutes of patience for network drops

    @staticmethod
    def _net_reason(ex: Exception) -> str:
        """Short human reason from a requests/urllib3 exception chain."""
        s = str(ex)
        for key, text in (("NameResolutionError", "DNS lookup failed (no internet / VPN / wrong URL)"),
                          ("getaddrinfo failed", "DNS lookup failed (no internet / VPN / wrong URL)"),
                          ("ConnectTimeout", "connection timed out"), ("timed out", "timed out"),
                          ("RemoteDisconnected", "D365 closed the connection"),
                          ("Connection aborted", "connection aborted"), ("ConnectionReset", "connection reset"),
                          ("10054", "connection reset by the remote host"),
                          ("SSLError", "TLS/SSL error (proxy or antivirus intercepting HTTPS?)"),
                          ("ProxyError", "proxy refused the connection")):
            if key in s:
                return text
        return s.splitlines()[0][:160]

    def get(self, url: str, params: dict | None = None, accept_xml: bool = False) -> requests.Response:
        """GET with retries: HTTP 429/5xx (throttling, servicing) and network drops are retried with backoff,
        resuming the same page - a long download no longer fails because of one hiccup."""
        r, net_fail, last_reason = None, 0, ""
        for attempt in range(12):
            try:
                r = self.session.get(url, params=params, timeout=(30, 600),
                                     headers=self._headers("application/xml" if accept_xml else "application/json"))
            except (requests.ConnectionError, requests.Timeout) as ex:
                net_fail += 1
                last_reason = self._net_reason(ex)
                if net_fail > self.NET_RETRIES:
                    raise D365Error(
                        f"Cannot reach {self.base_url} after {net_fail} tries ({last_reason}). "
                        f"Open the URL in a browser on this PC: if it does not load, the sandbox is stopped, "
                        f"being serviced, or the network/VPN is down.") from ex
                self.session.close()                       # drop the broken connection
                self.session = requests.Session()
                time.sleep(min(60, 5 * 2 ** min(net_fail - 1, 4)))   # 5,10,20,40,60,60... s
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                wait = int(r.headers.get("Retry-After", min(120, 2 ** min(attempt, 6) * 2)))
                time.sleep(wait)
                continue
            if r.status_code == 401:
                raise D365Error(
                    "D365 rejected the app (401). Register the Client ID in D365 under "
                    "System administration > Setup > Microsoft Entra applications.")
            if r.status_code == 403:
                raise D365Error("Access denied (403). Give the D365 service user a role that can read this data.")
            if r.status_code == 404:
                raise D365Error(f"Not found (404): {url.split('?')[0]}")
            r.raise_for_status()
            return r
        if r is None:
            raise D365Error(f"Cannot reach {self.base_url} ({last_reason}).")
        raise D365Error(f"D365 kept answering HTTP {r.status_code} (busy or being serviced). Try again later.")

    # ---- OData helpers ----------------------------------------------------
    def iter_entity(self, entity: str, select: list[str] | None = None, filter_: str | None = None):
        """Yield every record of an entity across all companies, following @odata.nextLink paging."""
        params = {"cross-company": "true"}
        if select:
            params["$select"] = ",".join(select)
        if filter_:
            params["$filter"] = filter_
        url = f"{self.base_url}/data/{entity}"
        while url:
            data = self.get(url, params=params).json()
            yield from data.get("value", [])
            url = data.get("@odata.nextLink")
            params = None  # nextLink already carries the query string

    def metadata(self) -> str:
        return self.get(f"{self.base_url}/data/$metadata", accept_xml=True).text

    def test(self) -> list[dict]:
        """Token + list of legal entities. Raises D365Error with a readable message."""
        self.token()
        return list(self.iter_entity("LegalEntities", select=["LegalEntityId", "Name"]))
