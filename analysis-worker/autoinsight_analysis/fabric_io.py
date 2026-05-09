import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"
GRAPHQL_TIMEOUT_SECONDS = float(os.environ.get("FABRIC_GRAPHQL_TIMEOUT_MS", "30000")) / 1000
ANALYSIS_PAGE_SIZE = int(os.environ.get("FABRIC_ANALYSIS_PAGE_SIZE", "500"))
ANALYSIS_MAX_ROWS = int(os.environ.get("FABRIC_ANALYSIS_MAX_ROWS", "5000"))


def http_json(url: str, body: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json",
        **headers,
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(raw or err.reason) from err


def get_bearer_token(connection: dict[str, Any], auth: dict[str, Any]) -> str:
    if connection.get("authMode") == "obo":
        authorization = auth.get("authorization") or ""
        if authorization.lower().startswith("bearer "):
            return authorization[7:].strip()
        raise RuntimeError("OBO authentication requires the user's Fabric bearer token.")

    client_secret = connection.get("clientSecret")
    if not client_secret:
        raise RuntimeError("Service principal authentication requires clientSecret in the analysis worker payload.")

    token_url = f"https://login.microsoftonline.com/{urllib.parse.quote(str(connection.get('tenantId')))}/oauth2/v2.0/token"
    form = urllib.parse.urlencode({
        "client_id": connection.get("clientId"),
        "client_secret": client_secret,
        "grant_type": "client_credentials",
        "scope": FABRIC_SCOPE,
    }).encode("utf-8")
    request = urllib.request.Request(token_url, data=form, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded"
    })
    try:
        with urllib.request.urlopen(request, timeout=GRAPHQL_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(raw or err.reason) from err

    token = payload.get("access_token")
    if not token:
        raise RuntimeError(payload.get("error_description") or payload.get("error") or "Fabric access token could not be acquired.")
    return token


def execute_fabric_graphql(connection: dict[str, Any], auth: dict[str, Any], query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    token = get_bearer_token(connection, auth)
    payload = http_json(
        connection["endpointUrl"],
        {"query": query, "variables": variables},
        {"Authorization": f"Bearer {token}"},
        GRAPHQL_TIMEOUT_SECONDS,
    )
    if payload.get("errors"):
        message = " / ".join(str(item.get("message", item)) for item in payload["errors"])
        raise RuntimeError(message)
    return payload.get("data") or {}


def fetch_table_rows(
    connection: dict[str, Any],
    auth: dict[str, Any],
    table_name: str,
    column_names: list[str],
    page_size: int | None = None,
    max_rows: int | None = None,
) -> dict[str, Any]:
    page_size = page_size or ANALYSIS_PAGE_SIZE
    max_rows = max_rows or ANALYSIS_MAX_ROWS
    selected_columns = list(dict.fromkeys([name for name in column_names if name]))
    if not table_name or not selected_columns:
        return {"rows": [], "truncated": False}

    rows: list[dict[str, Any]] = []
    after = None
    truncated = False
    selection = "\n".join(selected_columns)

    while len(rows) < max_rows:
        first = min(page_size, max_rows - len(rows))
        args = [f"first: {first}"]
        if after:
            args.append(f"after: {json.dumps(after)}")
        query = f"""
        query AutoInsightAnalysisRows {{
          page: {table_name}({", ".join(args)}) {{
            items {{
              {selection}
            }}
            endCursor
            hasNextPage
          }}
        }}
        """
        data = execute_fabric_graphql(connection, auth, query)
        result = data.get("page") or {}
        items = result.get("items") if isinstance(result.get("items"), list) else []
        rows.extend(items)

        if not result.get("hasNextPage") or not result.get("endCursor") or not items:
            break
        after = result["endCursor"]
        truncated = len(rows) >= max_rows

    return {"rows": rows, "truncated": truncated}
