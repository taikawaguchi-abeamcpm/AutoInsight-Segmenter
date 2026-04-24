# セキュリティ・権限・PII 設計書

## 1. 目的
Azure Identity と Microsoft Fabric の権限を前提に、アプリ内操作の認可、監査ログ、個人情報/サンプル値の扱いを定義する。

## 2. 基本方針
- ユーザー認証は Azure Identity を前提にする。
- Fabric データへのアクセス可否は Fabric のワークスペース/データセット権限を尊重する。
- アプリ固有の操作権限を追加し、分析実行、CSV出力、セグメント書き込みを制御する。
- 個人情報は最小表示を原則とし、サンプル値と顧客識別情報はデフォルトでマスクする。

## 3. 操作別権限
| 操作 | 必要権限 | 監査 |
| --- | --- | --- |
| データセット閲覧 | Fabric dataset read | 任意 |
| サンプル値閲覧 | Fabric read + `sample:read` | 必須 |
| マッピング保存 | `mapping:write` | 必須 |
| 分析ジョブ開始 | `analysis:run` | 必須 |
| 結果閲覧 | `analysis:read` | 任意 |
| 結果保存 | `analysis:write` | 必須 |
| CSV出力 | `export:create` | 必須 |
| 顧客フラグ付与 | `segment:write` | 必須 |
| 外部連携 | `external:send` + 管理者登録済み宛先 | 必須 |
| Fabric 接続設定閲覧 | `admin:fabric_connection:read` | 必須 |
| Fabric 接続確認 | `admin:fabric_connection:test` | 必須 |
| Fabric 接続保存 | `admin:fabric_connection:write` | 必須 |
| Fabric 接続有効化 | `admin:fabric_connection:activate` | 必須 |
| Fabric secret 差し替え | `admin:fabric_connection:secret_write` | 必須 |

## 4. PII 表示制御
- サンプル値は既定でマスクする。
- 氏名、メール、電話番号、住所などの候補列は自動検出し、画面表示前にマスクする。
- `SegmentPreviewRow.displayName` は原則匿名IDを表示し、実名表示は `sample:read` と明示操作がある場合のみ許可する。
- CSV出力では列選択、最大件数、マスキング有無をAPI側で検証する。

## 5. 監査ログ
```ts
interface AuditLogRecord {
  id: string;
  actorUserId: string;
  action:
    | 'DATASET_SELECTED'
    | 'SAMPLE_VIEWED'
    | 'MAPPING_SAVED'
    | 'ANALYSIS_STARTED'
    | 'RESULT_SAVED'
    | 'CSV_EXPORTED'
    | 'SEGMENT_CREATED'
    | 'EXTERNAL_SYNC_REQUESTED'
    | 'FABRIC_CONNECTION_TESTED'
    | 'FABRIC_CONNECTION_SAVED'
    | 'FABRIC_CONNECTION_ACTIVATED'
    | 'FABRIC_CONNECTION_SECRET_ROTATED';
  targetType: string;
  targetId: string;
  occurredAt: string;
  correlationId: string;
  metadata?: Record<string, string | number | boolean>;
}
```

## 6. 出力制御
- CSV出力は最大件数を設定し、超過時は非同期エクスポートに切り替える。
- ダウンロードURLは期限付きにし、再発行にも監査ログを残す。
- 外部連携は初期版ではUIに表示しないか、管理者登録済み宛先がある場合のみ表示する。

## 7. 変更履歴
- 2026-04-24: Fabric 接続管理画面向けの管理者権限と監査アクションを追加。
- 2026-04-24: 設計レビューを受け、権限、監査、PII制御を追加。
