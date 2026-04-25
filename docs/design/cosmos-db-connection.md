# Azure Cosmos DB 接続設定

## 1. 構成
React SPA から Cosmos DB へ直接接続しない。Azure Static Web Apps の Functions API を経由し、API 側で Cosmos DB for NoSQL に接続する。

```text
React App -> /api/* -> Azure Functions -> Azure Cosmos DB for NoSQL
```

## 2. 必須アプリ設定
Static Web Apps の構成に以下を追加する。

| 設定名 | 例 |
| --- | --- |
| `COSMOS_ENDPOINT` | `https://<account>.documents.azure.com:443/` |
| `COSMOS_DATABASE_NAME` | `autoinsight` |
| `COSMOS_CONNECTIONS_CONTAINER` | `fabricConnections` |
| `COSMOS_MAPPINGS_CONTAINER` | `semanticMappings` |
| `COSMOS_ANALYSIS_RUNS_CONTAINER` | `analysisRuns` |
| `COSMOS_ANALYSIS_RESULTS_CONTAINER` | `analysisResults` |
| `COSMOS_SEGMENTS_CONTAINER` | `segments` |
| `COSMOS_AUDIT_CONTAINER` | `auditLogs` |

ローカル開発だけ `COSMOS_CONNECTION_STRING` または `COSMOS_KEY` を使用できる。本番は Managed Identity と Cosmos DB RBAC を使う。

## 3. コンテナ
API は不足している database / container を `partitionKey: /partitionKey` で作成する。既に作成済みのコンテナを使う場合は、少なくとも `/partitionKey` または `/tenantId` を推奨する。

## 4. 疎通確認
デプロイ後、以下で Cosmos DB への接続とコンテナ解決を確認する。

```text
GET /api/cosmos/health
```

`status: ok` と各 container 名が返れば、API から Cosmos DB に接続できている。
