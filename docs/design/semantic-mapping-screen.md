# セマンティック・マッピング画面 設計書

## 1. この設計書の対象
- 対象機能: データセット選択後の「セマンティック・マッピング」
- 目的: Microsoft Fabric から取得したテーブル/カラムに対してビジネス上の意味付けを行い、以降の分析画面で使う `目的変数` と `特徴量` の定義を確定する
- 出力物: UI 設計、画面内の状態設計、Fabric GraphQL を前提としたデータ構造案

## 2. 画面の役割
- ビジネスユーザーがデータ構造を理解しなくても、分析に必要な意味付けを進められるようにする
- 「どのテーブルが顧客軸か」「どの列が成果指標か」「どの列を説明変数として使うか」を一画面で整理する
- 次画面の分析条件設定に渡すための正規化済みマッピング定義を作る

## 3. 前後の画面遷移
1. データセット選択
2. セマンティック・マッピング
3. 分析条件確認 / 実験開始
4. 結果可視化
5. セグメント作成

この設計書では `2. セマンティック・マッピング` のみを詳細化する。

## 4. 画面レイアウト案

### 4.1 全体構成
- ヘッダー
- 左: データソースツリー
- 右: 作業単位別の編集タブ
  - `テーブル意味付け`
  - `カラム意味付け`
  - `結合条件`
  - `目的変数・特徴量`
- 下部固定アクションバー

### 4.2 ヘッダー
- 画面タイトル: `セマンティック・マッピング`
- サブテキスト: 現在選択中の Fabric データセット名、最終同期時刻
- 右上アクション
  - `再同期`
  - `下書き保存`
  - `分析へ進む`

### 4.3 左ペイン: データソースツリー
目的:
- Fabric から取得したテーブルとカラムを探索する
- 未設定箇所を減らしながらマッピング対象を選ぶ

UI コンポーネント:
- テーブル検索ボックス
- テーブル一覧アコーディオン
  - 論理名
  - 物理名
  - テーブル種別バッジ
- 展開時のカラム一覧
  - 論理名
  - 物理名
  - 型バッジ
  - 役割バッジ `顧客ID / 日時 / 目的変数 / 特徴量 / 分析対象外`

主要操作:
- テーブルクリックで `テーブル意味付け` タブを開く
- カラムクリックで `カラム意味付け` タブを開く
- 左ペインは探索専用とし、詳細入力は右ペインに集約する

### 4.4 右ペイン: テーブル意味付け
目的:
- Fabric の物理テーブルに、業務上の意味を付ける
- 分析の主軸となる顧客/企業マスタと、活動・取引・補助マスタを識別する

入力項目:
- 論理名
- 補足
- テーブル種別
  - `顧客・企業マスタ`
  - `取引・実績`
  - `活動・イベント`
  - `補助マスタ`
  - `分析対象外`

### 4.5 右ペイン: カラム意味付け
目的:
- Fabric の物理カラムに、業務上の意味を付ける
- 分析に使うカラムと除外するカラムを明確にする

入力項目:
- 論理名
- 補足
- 役割
  - `顧客ID`
  - `日時`
  - `目的変数`
  - `特徴量`
  - `分析対象外`

役割に `セグメントキー` と `表示ラベル` は持たせない。セグメント作成時に必要なキーや表示名は、後続画面または出力設定で扱う。

### 4.6 右ペイン: 結合条件
目的:
- テーブル間の関連を明示する
- 例: `企業マスタ.AccountId = 活動テーブル.AccountId`

入力項目:
- 元テーブル
- 元カラム
- 結合先テーブル
- 結合先カラム
- 結合種別 `left / inner`
- 多重度 `many_to_one / one_to_many / one_to_one / many_to_many`

表示仕様:
- 結合条件は横一列固定にせず、右ペイン幅に応じて複数行へ折り返す。
- テーブル名・カラム名が長い場合でも、画面全体に横スクロールを発生させない。
- 削除操作は行末に配置し、折り返し時も他の入力を押し出さない。

### 4.7 右ペイン: 目的変数・特徴量
目的:
- 分析で予測または比較したい目的変数を 1 件選ぶ
- 説明変数として使う特徴量を複数選ぶ
- 特徴量を一括指定できるようにする

主要操作:
- 目的変数カラムを単一選択する
- 選択中テーブルの未設定カラムをまとめて特徴量にする
- 選択中テーブルの特徴量指定をまとめて解除する
- 個別カラムをチェックボックスで特徴量に追加/除外する

表示仕様:
- 特徴量一覧は `チェックボックス / カラム名 / 役割バッジ` の3列グリッドにし、チェックボックスが行中央へ流れないように固定する。
- 長いカラム名・物理名は折り返し、役割バッジは右端に維持する。
- 下部アクションバーが一覧項目を覆わないよう、画面内のレイアウト領域として確保する。

### 4.8 下部固定アクションバー
- 左: 完了率、未解決エラー件数
- 中央: 現在の定義サマリ
  - 顧客軸テーブル
  - 目的変数
  - 特徴量数
- 右:
  - `自動提案を適用`
  - `下書き保存`
  - `分析へ進む`

### 4.9 スクリーンショットレビュー反映
対象スクリーンショットから、以下をUI改善事項として反映する。

- 左ペインに縦スクロールと横スクロールが同時に出ており、探索中の視線移動が増える。左ペインは縦スクロールのみ許可し、長いテーブル名・カラム名は折り返す。
- 結合条件タブで入力行が右端へはみ出し、画面全体に横スクロールが出る。結合条件行はレスポンシブグリッドで折り返す。
- 目的変数・特徴量タブの特徴量一覧でチェックボックス、テキスト、バッジの間隔が広がりすぎている。3列構造に固定し、情報を近接させる。
- 下部アクションバーが特徴量一覧の内容を覆っている。固定表示は維持しつつ、通常のレイアウト領域を占有する sticky 表示とする。
- 右ペインと左ペインの最小幅が強すぎると、ブラウザ幅によって全体横スクロールが発生する。右ペインは `minmax(0, 1fr)` 相当で縮小可能にする。

## 5. 画面内の基本フロー

### 5.1 初回表示
1. データセット選択済み状態で画面へ入る
2. Fabric からテーブル一覧とカラムメタデータを取得する
3. システムが命名規則ベースで初期推定を行う
4. 推定結果を `提案` バッジ付きで画面反映する

### 5.2 ユーザー作業
1. 顧客の主キーを持つテーブルを `顧客マスタ` に指定
2. イベントや購買テーブルを関連エンティティとして指定
3. 目的変数カラムを 1 件選択
4. 特徴量として使うカラムを複数選択
5. 集計方法や時間窓を補正
6. バリデーションが通ったら次画面へ進む

### 5.3 自動提案
- 列名に `customer_id` `user_id` `member_id` が含まれる場合は顧客キー候補
- 列名に `order` `purchase` `contract` が含まれる場合は取引候補
- 列名に `date` `time` `timestamp` が含まれる場合は時系列軸候補
- `is_` `flg` `flag` `status` を含む二値列は目的変数候補

## 6. UI 状態設計

### 6.1 画面ステート
```ts
type MappingScreenStatus =
  | 'idle'
  | 'loadingSchema'
  | 'ready'
  | 'savingDraft'
  | 'validating'
  | 'submitting'
  | 'error';
```

### 6.2 ビュー制御用ステート
```ts
interface MappingScreenViewState {
  selectedDatasetId: string | null;
  selectedTableId: string | null;
  selectedColumnId: string | null;
  searchQuery: string;
  expandedTableIds: string[];
  activePanel: 'table' | 'column' | 'summary';
  showOnlyUnmapped: boolean;
  showSuggestedOnly: boolean;
  dirty: boolean;
  status: MappingScreenStatus;
}
```

## 7. データ構造案

### 7.1 Fabric スキーマ取得モデル
```ts
type FabricDataType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'array'
  | 'unknown';

interface FabricDataset {
  id: string;
  workspaceId: string;
  name: string;
  displayName: string;
  lastSyncedAt: string;
  tables: FabricTable[];
}

interface FabricTable {
  id: string;
  name: string;
  displayName: string;
  rowCount?: number;
  description?: string;
  columns: FabricColumn[];
}

interface FabricColumn {
  id: string;
  tableId: string;
  name: string;
  displayName: string;
  dataType: FabricDataType;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  sampleValues?: string[];
}
```

### 7.2 セマンティック定義モデル
```ts
type SemanticEntityRole =
  | 'customer_master'
  | 'transaction_fact'
  | 'event_log'
  | 'dimension'
  | 'excluded';

type SemanticColumnRole =
  | 'customer_id'
  | 'event_time'
  | 'target'
  | 'feature'
  | 'excluded';

type MappingSource = 'manual' | 'suggested' | 'imported';
type MappingStatus = 'unmapped' | 'mapped' | 'validated' | 'error';

interface TableSemanticMapping {
  tableId: string;
  entityRole: SemanticEntityRole;
  businessName: string;
  description?: string;
  primaryKeyColumnId?: string;
  customerJoinColumnId?: string;
  source: MappingSource;
  status: MappingStatus;
}

interface ColumnSemanticMapping {
  columnId: string;
  tableId: string;
  columnRole: SemanticColumnRole;
  businessName: string;
  description?: string;
  source: MappingSource;
  status: MappingStatus;
  featureConfig?: FeatureConfig;
  targetConfig?: TargetConfig;
}
```

### 7.3 目的変数と特徴量の定義
```ts
type AggregationType =
  | 'none'
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'latest'
  | 'distinct_count';

type MissingValuePolicy =
  | 'exclude'
  | 'zero_fill'
  | 'most_frequent'
  | 'unknown_category';

interface TimeWindow {
  unit: 'day' | 'week' | 'month';
  value: number;
}

interface FeatureConfig {
  featureKey: string;
  label: string;
  dataType: FabricDataType;
  aggregation: AggregationType;
  timeWindow?: TimeWindow;
  missingValuePolicy: MissingValuePolicy;
  enabled: boolean;
}

interface TargetConfig {
  targetKey: string;
  label: string;
  positiveValue?: string;
  negativeValue?: string;
  eventTimeColumnId?: string;
  evaluationWindow?: TimeWindow;
}
```

### 7.4 画面全体の保存単位
```ts
interface SemanticMappingDocument {
  id: string;
  datasetId: string;
  version: number;
  status: 'draft' | 'ready' | 'archived';
  tableMappings: TableSemanticMapping[];
  columnMappings: ColumnSemanticMapping[];
  validationIssues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

interface ValidationIssue {
  id: string;
  severity: 'info' | 'warning' | 'error';
  code:
    | 'MISSING_CUSTOMER_MASTER'
    | 'MISSING_TARGET'
    | 'MULTIPLE_TARGETS'
    | 'MISSING_EVENT_TIME'
    | 'UNRESOLVED_JOIN_KEY'
    | 'INVALID_TARGET_TYPE';
  message: string;
  tableId?: string;
  columnId?: string;
}
```

## 8. GraphQL 入出力案

### 8.1 初期表示クエリ
用途:
- Fabric 上のデータセット情報、テーブル、カラム、サンプル値を取得
- 既存の下書きマッピングがあれば同時に取得

```graphql
query MappingScreenBootstrap($datasetId: ID!) {
  dataset(id: $datasetId) {
    id
    workspaceId
    name
    displayName
    lastSyncedAt
    tables {
      id
      name
      displayName
      rowCount
      description
      columns {
        id
        name
        displayName
        dataType
        nullable
        isPrimaryKey
        isForeignKey
        sampleValues
      }
    }
  }
  semanticMappingDraft(datasetId: $datasetId) {
    id
    version
    status
    updatedAt
    tableMappings {
      tableId
      entityRole
      businessName
      primaryKeyColumnId
      customerJoinColumnId
      source
      status
    }
    columnMappings {
      columnId
      tableId
      columnRole
      businessName
      source
      status
    }
    validationIssues {
      id
      severity
      code
      message
      tableId
      columnId
    }
  }
}
```

### 8.2 下書き保存ミューテーション
```graphql
mutation UpsertSemanticMappingDraft($input: UpsertSemanticMappingInput!) {
  upsertSemanticMappingDraft(input: $input) {
    id
    version
    status
    updatedAt
  }
}
```

入力型の想定:
```graphql
input UpsertSemanticMappingInput {
  datasetId: ID!
  version: Int!
  status: MappingDraftStatus!
  tableMappings: [TableSemanticMappingInput!]!
  columnMappings: [ColumnSemanticMappingInput!]!
}
```

### 8.3 バリデーション実行ミューテーション
```graphql
mutation ValidateSemanticMapping($mappingId: ID!) {
  validateSemanticMapping(mappingId: $mappingId) {
    status
    validationIssues {
      id
      severity
      code
      message
      tableId
      columnId
    }
  }
}
```

## 9. バリデーションルール
- `customer_master` は 1 テーブル以上必須
- `target` は 1 カラムのみ許可
- 目的変数がイベント型の場合、対応する日時カラムが必須
- 特徴量に数値集計を指定した場合、元列型は数値系であること
- `transaction_fact` または `event_log` を使う場合、顧客軸への join キーが必須
- `分析へ進む` は `error` 件数が 0 のときのみ活性

## 10. UI 文言のトーン
- 専門用語をそのまま押し付けず、業務文脈に寄せる
- 例:
  - `customer_master` 表示名: `顧客の基本情報`
  - `transaction_fact` 表示名: `購買や成約の履歴`
  - `feature` 表示名: `成約に効きそうな項目`

## 11. 実装時の分割方針
- `src/components/mapping/MappingScreen.tsx`
- `src/components/mapping/SchemaBrowser.tsx`
- `src/components/mapping/SemanticCanvas.tsx`
- `src/components/mapping/PropertyInspector.tsx`
- `src/components/mapping/MappingActionBar.tsx`
- `src/types/mapping.ts`
- `src/services/mapping/mappingApi.ts`

## 12. この画面で先に決めておくべきこと
- マッピング定義の保存先を Fabric 側に置くか、アプリ専用ストアに置くか
- サンプル値の取得件数上限
- 自動提案ルールをクライアント実装にするか API 側に寄せるか
- 次画面へ渡す単位を `columnMappings` のままにするか、`分析入力モデル` に正規化してから渡すか

## 13. 推奨方針
- 初期版は `画面表示用モデル` と `保存用マッピングモデル` を分離する
- 自動提案はまずフロントエンドの軽量ルールベースで開始する
- 目的変数と特徴量の設定は同一画面で完結させ、画面遷移時の手戻りを減らす

## 14. 設計レビュー反映

### 14.1 横断設計の参照
- マッピング定義の保存先、楽観ロック、アーカイブは `docs/design/data-persistence.md` に従う。
- GraphQL エラー、共通 `ValidationIssue`、JSON scalar 方針は `docs/design/graphql-contract.md` に従う。
- サンプル値表示、PIIマスク、監査ログは `docs/design/security-and-permissions.md` に従う。
- 画面復元は `datasetId` をURLに保持し、詳細はAPI再取得する方針とする。

### 14.2 顧客軸とJoin定義
`customer_master` は原則 1 テーブルを主軸として選択する。複数の顧客マスタ候補がある場合は、ユーザーが主軸を1つ選び、他のテーブルは `dimension` または関連テーブルとして join 定義に含める。

```ts
interface JoinDefinition {
  id: string;
  fromTableId: string;
  fromColumnIds: string[];
  toTableId: string;
  toColumnIds: string[];
  joinType: 'left' | 'inner';
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
  confidence?: number;
  source: MappingSource;
}

interface SemanticMappingDocument {
  id: string;
  datasetId: string;
  version: number;
  status: 'draft' | 'ready' | 'archived';
  tableMappings: TableSemanticMapping[];
  columnMappings: ColumnSemanticMapping[];
  joinDefinitions: JoinDefinition[];
  validationIssues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
```

### 14.3 自動提案の信頼性表示
自動提案には `confidence` と `reason` を持たせ、画面上で「おすすめ理由」「確認が必要な理由」を表示する。

```ts
interface MappingSuggestion {
  targetType: 'table' | 'column' | 'join';
  targetId: string;
  suggestedRole: SemanticEntityRole | SemanticColumnRole;
  confidence: number;
  reason: string;
}
```

### 14.4 サンプル値とPII
- `sampleValues` はデフォルトでマスク済みの値を返す。
- 実値表示は `sample:read` 権限と明示操作がある場合のみ許可する。
- 氏名、メール、電話番号、住所候補列は自動マスク対象にする。

### 14.5 バリデーション追加
- 顧客主軸テーブルが複数ある場合はエラーにする。
- join 経路が未解決の特徴量は分析へ進めない。
- 複合キーの場合は `fromColumnIds` と `toColumnIds` の数が一致すること。
- `many_to_many` は初期版では警告以上とし、分析前に確認を必須にする。

## 15. 変更履歴
- 2026-04-26: 画面をデータソースツリー + 作業タブ構成へ見直し。テーブル/カラムの論理名・補足、Join編集、目的変数、特徴量一括指定を明確化。
- 2026-04-24: 設計レビューを受け、保存責務、Join定義、PII制御、自動提案信頼度を追記。
