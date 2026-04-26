# データセット選択画面 設計書

## 1. この設計書の対象
- 対象機能: 最初の導線となる「データセット選択」
- 目的: Microsoft Fabric 上の利用可能なデータセットを一覧化し、分析対象として 1 件を選択させる
- 出力物: UI 設計、画面内状態設計、Fabric GraphQL 入出力案、次画面への受け渡しデータ構造案

## 2. 画面の役割
- ビジネスユーザーが「今どのデータを使って分析を始めるか」を迷わず決められるようにする
- データセットの中身を深く見る前に、接続状態、更新日時、主要テーブル数、想定用途を短時間で判断できるようにする
- 選択したデータセット ID と最低限のメタ情報を、次画面のセマンティック・マッピングへ引き渡す

## 3. 前後の画面遷移
1. データセット選択
2. セマンティック・マッピング
3. 分析条件確認 / 実験開始
4. 結果可視化
5. セグメント作成

この設計書では `1. データセット選択` のみを詳細化する。

## 4. 画面レイアウト案

### 4.1 全体構成
- ヘッダー
- 上部フィルタバー
- 左: データセット一覧
- 右: 選択中データセットの詳細プレビュー
- 下部アクションバー

### 4.2 ヘッダー
- 画面タイトル: `データセット選択`
- サブテキスト: `分析に使うデータソースを選択してください`
- 右上アクション
  - `再読み込み`
  - `Fabric に接続`

### 4.3 上部フィルタバー
目的:
- 候補数が多い環境でも、業務観点でデータセットを絞り込めるようにする

UI コンポーネント:
- キーワード検索
- ワークスペースフィルタ
- 更新日時ソート
- ステータスフィルタ `利用可能 / 警告あり / 接続エラー`
- 表示切替 `すべて / 最近使った / おすすめ`

主要操作:
- 検索語はデータセット名、説明、タグに対して部分一致
- `最近使った` は直近アクセス履歴ベース
- `おすすめ` は必要テーブル数や更新鮮度が揃ったデータセットを優先表示

### 4.4 左カラム: データセット一覧
目的:
- 一覧比較で候補を素早く選べるようにする

UI コンポーネント:
- データセットカード一覧
- カード内要素
  - データセット名
  - ワークスペース名
  - 説明文
  - タグ `CRM / EC / Web 行動 / 営業活動` など
  - 最終更新日時
  - テーブル数
  - 接続ステータスバッジ
  - 推奨バッジ

カード状態:
- `default`
- `hover`
- `selected`
- `disabled`
- `warning`

主要操作:
- カード選択で右カラムの詳細プレビューを更新
- ダブルクリックまたはカード内 `このデータを使う` で次画面へ進む
- 接続エラー状態のカードは選択不可だが、詳細は閲覧可

### 4.5 右カラム: データセット詳細プレビュー
目的:
- 選択前に「このデータで分析を始めて問題ないか」を判断させる

UI コンポーネント:
- 概要カード
  - データセット名
  - 説明
  - 所属ワークスペース
  - オーナー
  - 最終同期時刻
- 品質サマリカード
  - テーブル数
  - カラム総数
  - 主キー候補数
  - 日時列数
  - サンプル行取得可否
- 主要テーブルプレビュー
  - 上位 5 テーブル名
  - 想定役割候補 `顧客 / 取引 / 行動`
  - 行数の目安
- 注意事項カード
  - 接続警告
  - 権限不足
  - 主キー未検出
  - 更新遅延

主要操作:
- `テーブルを確認` でモーダルを開き、全テーブルを簡易表示
- `このデータを使う` で選択確定

### 4.6 下部アクションバー
- 左: 件数表示 `12 件中 3 件を表示`
- 中央: 現在の選択サマリ
  - データセット名
  - ワークスペース名
  - 接続状態
- 右:
  - `キャンセル`
  - `このデータを使う`

## 5. 画面内の基本フロー

### 5.1 初回表示
1. 画面表示時にユーザーがアクセス可能な Fabric ワークスペース一覧を取得
2. 各ワークスペース配下のデータセット一覧を取得
3. 主要メタデータを集約し、推奨順で一覧表示
4. 先頭の推奨データセットを初期選択する

### 5.2 ユーザー作業
1. 検索またはフィルタで候補を絞る
2. データセットカードを選択
3. 右ペインの詳細を見て妥当性を確認
4. 問題なければ `このデータを使う` を実行
5. `datasetId` と最小メタ情報を持ってセマンティック・マッピングへ遷移

### 5.3 エラー時
- Fabric 接続失敗時は、画面上部に再試行可能なエラーバナーを表示
- 権限不足のデータセットは一覧に残しつつ `閲覧不可` 表示
- プレビュー取得失敗時は、一覧選択は維持しつつ右ペインのみフォールバック表示

## 6. UI 状態設計

### 6.1 画面ステート
```ts
type DatasetSelectionStatus =
  | 'idle'
  | 'loadingList'
  | 'ready'
  | 'loadingPreview'
  | 'submitting'
  | 'empty'
  | 'error';
```

### 6.2 ビュー制御用ステート
```ts
interface DatasetSelectionViewState {
  selectedWorkspaceId: string | null;
  selectedDatasetId: string | null;
  searchQuery: string;
  statusFilter: 'all' | 'ready' | 'warning' | 'error';
  listMode: 'all' | 'recent' | 'recommended';
  sortBy: 'updatedAt' | 'name';
  sortOrder: 'asc' | 'desc';
  status: DatasetSelectionStatus;
}
```

## 7. データ構造案

### 7.1 一覧表示用モデル
```ts
type DatasetConnectionStatus =
  | 'ready'
  | 'warning'
  | 'error'
  | 'forbidden'
  | 'syncing';

interface FabricWorkspaceSummary {
  id: string;
  name: string;
  region?: string;
}

interface DatasetListItem {
  id: string;
  name: string;
  displayName: string;
  workspaceId: string;
  workspaceName: string;
  description?: string;
  tags: string[];
  tableCount: number;
  lastSyncedAt?: string;
  connectionStatus: DatasetConnectionStatus;
  recommended: boolean;
  recentlyUsed: boolean;
  warningCodes: DatasetWarningCode[];
}
```

### 7.2 詳細プレビュー用モデル
```ts
type DatasetWarningCode =
  | 'NO_PRIMARY_KEY'
  | 'NO_TIMESTAMP_COLUMN'
  | 'LOW_TABLE_COUNT'
  | 'SYNC_DELAYED'
  | 'ACCESS_LIMITED';

interface DatasetPreview {
  datasetId: string;
  ownerName?: string;
  rowEstimate?: number;
  columnCount: number;
  primaryKeyCandidateCount: number;
  timestampColumnCount: number;
  sampleAvailable: boolean;
  topTables: DatasetTablePreview[];
  warnings: DatasetWarning[];
}

interface DatasetTablePreview {
  tableId: string;
  tableName: string;
  rowCount?: number;
  suggestedRole?: 'customer' | 'transaction' | 'event' | 'unknown';
}

interface DatasetWarning {
  code: DatasetWarningCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
}
```

### 7.3 次画面への受け渡しモデル
```ts
interface SelectedDatasetContext {
  datasetId: string;
  datasetName: string;
  workspaceId: string;
  workspaceName: string;
  connectionStatus: DatasetConnectionStatus;
  lastSyncedAt?: string;
  tableCount: number;
}
```

## 8. GraphQL 入出力案

### 8.1 データセット一覧取得クエリ
用途:
- ログインユーザーがアクセスできるワークスペースとデータセットを取得する
- 一覧描画に必要な最小メタデータだけを返す

```graphql
query DatasetSelectionList {
  workspaces {
    id
    name
    region
    datasets {
      id
      name
      displayName
      description
      tags
      tableCount
      lastSyncedAt
      connectionStatus
      recommended
      recentlyUsed
      warningCodes
    }
  }
}
```

### 8.2 プレビュー取得クエリ
```graphql
query DatasetPreview($datasetId: ID!) {
  dataset(id: $datasetId) {
    id
    name
    displayName
    workspaceId
    workspaceName
    ownerName
    tableCount
    rowEstimate
    columnCount
    primaryKeyCandidateCount
    timestampColumnCount
    sampleAvailable
    topTables(limit: 5) {
      id
      name
      rowCount
      suggestedRole
    }
    warnings {
      code
      severity
      message
    }
  }
}
```

### 8.3 選択確定ミューテーション
用途:
- 監査ログや最近使った履歴に反映する場合のみ必要
- 初期版ではクライアントルーティングのみでもよい

```graphql
mutation SelectDataset($datasetId: ID!) {
  selectDataset(datasetId: $datasetId) {
    datasetId
    selectedAt
  }
}
```

## 9. 推奨ロジック案
- `recommended = true` の判定条件
  - 接続状態が `ready`
  - テーブル数がしきい値以上
  - `顧客 ID` 候補列が存在
  - `日時列` 候補が存在
  - 最終同期が一定期間内

初期版のスコア例:
```ts
score =
  (connectionStatus === 'ready' ? 50 : 0) +
  Math.min(tableCount, 20) +
  (primaryKeyCandidateCount > 0 ? 20 : 0) +
  (timestampColumnCount > 0 ? 10 : 0) -
  warningCount * 15;
```

## 10. バリデーションルール
- `このデータを使う` は `selectedDatasetId !== null` のときのみ活性
- `connectionStatus = error` のデータセットは選択確定不可
- `forbidden` のデータセットは一覧表示のみ許可
- 推奨表示は `warning` を含んでもよいが、`error` を含む場合は除外

## 11. UI 文言のトーン
- 技術用語より業務判断を優先した文言にする
- 例:
  - `connectionStatus: ready` 表示名: `すぐに使えます`
  - `warning` 表示名: `確認してから使う`
  - `error` 表示名: `このままでは使えません`

## 12. 実装時の分割方針
- `src/components/dataset/DatasetSelectionScreen.tsx`
- `src/components/dataset/DatasetFilterBar.tsx`
- `src/components/dataset/DatasetList.tsx`
- `src/components/dataset/DatasetPreviewPanel.tsx`
- `src/components/dataset/DatasetActionBar.tsx`
- `src/types/dataset.ts`
- `src/services/dataset/datasetApi.ts`

## 13. この画面で先に決めておくべきこと
- ワークスペースを跨いだ一覧取得を 1 クエリで行うか、クライアント集約にするか
- `recommended` 判定を API 側で返すか、フロントエンド側で算出するか
- プレビューで row count を厳密値にするか概算にするか
- 最近使った履歴をブラウザ保存にするかサーバー保存にするか

## 14. 推奨方針
- 初期版は一覧クエリとプレビュークエリを分離し、一覧の初期表示を軽く保つ
- 推奨ロジックはまずフロントエンドで計算し、後で API 側に移せる形にする
- 次画面には `SelectedDatasetContext` を渡し、詳細スキーマ取得はセマンティック・マッピング側で行う

## 15. 設計レビュー反映

### 15.1 横断設計の参照
- 保存責務は `docs/design/data-persistence.md` に従う。
- GraphQL のページング、エラー、認可エラー形式は `docs/design/graphql-contract.md` に従う。
- データセット閲覧、サンプル値閲覧、監査ログは `docs/design/security-and-permissions.md` に従う。
- 次画面への遷移とリロード復元は `docs/design/navigation-context.md` に従う。

### 15.2 推奨判定の修正
レビューで指摘された通り、一覧クエリだけでは `primaryKeyCandidateCount` や `timestampColumnCount` を取得できないため、初期表示の `recommended` は API が返す軽量スコアを優先する。

```ts
interface DatasetListItem {
  id: string;
  name: string;
  displayName: string;
  workspaceId: string;
  workspaceName: string;
  description?: string;
  tags: string[];
  tableCount: number;
  lastSyncedAt?: string;
  connectionStatus: DatasetConnectionStatus;
  recommended: boolean;
  recommendationScore?: number;
  recommendationReasons: string[];
  recentlyUsed: boolean;
  warningCodes: DatasetWarningCode[];
}
```

- フロントエンドは `recommendationScore` と `recommendationReasons` を表示に使う。
- プレビュー取得後により詳細な推奨理由を補足表示してよい。
- `connectionStatus = error` または `forbidden` は推奨対象外にする。

### 15.3 Fabric制約への対応
- ワークスペース横断の一覧取得はページングを前提にする。
- 初期表示ではデータセット概要のみ取得し、プレビューは選択時に遅延取得する。
- 複数の Fabric 接続が登録されている場合、`ready` 状態の接続をそれぞれデータセット候補として表示する。
- 一覧取得では行数取得を行わず、スキーマ確認の軽量処理に留める。行数はプレビューまたはマッピング取得時に遅延取得する。
- 一部接続のスキーマ取得が失敗しても一覧全体を失敗させず、該当接続を警告付き候補として表示する。
- Fabric GraphQL 呼び出しはタイムアウトを設定し、応答しない接続で画面が読み込み中のままにならないようにする。
- Fabric API の一時失敗は再試行可能なエラーとして表示する。
- row count は `推定値` として扱い、厳密値ではないことをUIで示す。
- 実接続の GraphQL スキーマに connection 型の `totalCount` が公開されている場合、プレビュー取得時に `first: 1` 相当の軽量クエリで `totalCount` を取得し、主要テーブルの行数と全体の `rowEstimate` に反映する。
- `totalCount` が公開されていない場合は、`items / endCursor / hasNextPage` と `first / after` によるページングで、必要最小限の1列だけを取得しながら行数を数える。
- 行数取得クエリに失敗した場合は、スキーマ取得自体は成功扱いとし、行数は未取得として `-` 表示にフォールバックする。

### 15.4 権限とPII
- `forbidden` と `ACCESS_LIMITED` は「閲覧不可」として統一表示する。
- 権限不足データセットは一覧表示のみ許可し、プレビューと選択確定は不可にする。
- サンプル値を表示する導線はこの画面では持たない。

## 16. 変更履歴
- 2026-04-26: 複数 Fabric 接続時の一覧取得、軽量化、接続別フォールバック表示を追記。
- 2026-04-26: 実接続プレビューで `totalCount` またはページングから行数目安を取得する方針を追記。
- 2026-04-24: 設計レビューを受け、横断設計参照、推奨判定、ページング、権限制御を追記。
