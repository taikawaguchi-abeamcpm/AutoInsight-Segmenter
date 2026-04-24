# GraphQL 共通契約 設計書

## 1. 目的
画面ごとに散っている GraphQL 入出力案を横断的に統一し、型安全性、エラー処理、ページング、認可、部分結果の扱いを揃える。

## 2. 基本方針
- 画面専用クエリは許可するが、共通型とエラー形式は全画面で揃える。
- 大量データを返す一覧はページングを必須にする。
- GraphQL の `JSON` scalar は初期版では `config`、`ruleTree`、`outputConfig` に限定する。
- UI が編集する複雑な構造は将来、明示 input 型へ段階的に移行できるよう、保存前にサーバー側でバリデーションする。

## 3. 共通型
```ts
interface PageInfo {
  hasNextPage: boolean;
  endCursor?: string;
  totalCount?: number;
}

interface ApiError {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  retryable: boolean;
  targetPath?: string;
  correlationId: string;
}

type AccessDeniedReason =
  | 'NO_WORKSPACE_ACCESS'
  | 'NO_DATASET_ACCESS'
  | 'NO_SAMPLE_ACCESS'
  | 'NO_WRITE_PERMISSION'
  | 'EXPORT_NOT_ALLOWED'
  | 'EXTERNAL_DESTINATION_NOT_ALLOWED';

interface ValidationIssue {
  id: string;
  scope: 'dataset' | 'mapping' | 'analysis' | 'results' | 'segment' | 'security';
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
  blocking: boolean;
  suggestedAction?: string;
}
```

## 4. ページング
```graphql
input PageInput {
  first: Int = 50
  after: String
}
```

- `first` の上限は原則 100。
- データセット、テーブル、カラム、結果一覧、セグメント候補一覧はページング対象にする。
- 画面初期表示では要約のみ取得し、詳細は選択時に遅延取得する。

## 5. エラー処理
- 認可エラーは `AccessDeniedReason` を含める。
- Fabric API の一時失敗は `retryable = true` とし、画面側は指数バックオフで再試行する。
- 入力不備は `ValidationIssue` として返し、API例外とは分ける。
- すべてのエラーに `correlationId` を付与し、問い合わせ・監査に使えるようにする。

## 6. JSON scalar 方針
| フィールド | 初期版方針 | 理由 |
| --- | --- | --- |
| `AnalysisRunConfig.config` | JSON scalar | custom/autopilot の差分吸収 |
| `SegmentDraft.ruleTree` | JSON scalar | ネスト条件の変更に強くする |
| `SegmentOutputConfig.outputConfig` | JSON scalar | 出力先拡張を見越す |

サーバー側は JSON schema 相当の検証を行い、不正構造を `ValidationIssue` として返す。

## 7. 変更履歴
- 2026-04-24: 設計レビューを受け、共通GraphQL契約を追加。
