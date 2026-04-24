# 分析条件確認 / 実験開始画面 設計書

## 1. この設計書の対象
- 対象機能: `分析条件確認 / 実験開始`
- 目的: セマンティック・マッピングで定義した `目的変数` と `特徴量` を確認し、分析モードと実行条件を決めて分析ジョブを開始する
- 出力物: UI 設計、画面内状態設計、分析入力データ構造案、Fabric GraphQL 入出力案、初期アルゴリズム実行方針

## 2. 画面の役割
- ユーザーに「何を分析しようとしているか」を実行前に明示する
- `カスタム分析` と `オートパイロット` の切替を同一画面で扱う
- 実行前バリデーションを通し、分析基盤へジョブ投入する
- 結果可視化画面に渡す `analysisJobId` と実行サマリを確定する

## 3. 前後の画面遷移
1. データセット選択
2. セマンティック・マッピング
3. 分析条件確認 / 実験開始
4. 結果可視化
5. セグメント作成

この設計書では `3. 分析条件確認 / 実験開始` のみを詳細化する。

## 4. 画面レイアウト案

### 4.1 全体構成
- ヘッダー
- モード切替タブ
- 2 カラムの確認ワークスペース
- 下部固定アクションバー

### 4.2 ヘッダー
- 画面タイトル: `分析条件確認 / 実験開始`
- サブテキスト: `分析対象と実行条件を確認して実験を開始します`
- 右上アクション
  - `マッピングへ戻る`
  - `下書き保存`

### 4.3 モード切替タブ
目的:
- 分析方式の違いを画面冒頭で明確にする

UI コンポーネント:
- タブ `カスタム分析`
- タブ `オートパイロット`
- 補足テキスト
  - `カスタム分析`: 特徴量、期間、集計条件をユーザーが細かく確認・調整する
  - `オートパイロット`: 目的変数を中心に AI が特徴量生成と探索範囲を自動決定する

主要操作:
- タブ切替で右カラムの設定フォームが切り替わる
- モード変更時に非互換設定があれば確認ダイアログを出す

### 4.4 左カラム: 分析対象サマリ
目的:
- 実行対象が正しいかを短時間で確認させる

UI コンポーネント:
- データセット概要カード
  - データセット名
  - ワークスペース名
  - 最終同期時刻
- マッピング確定サマリカード
  - 顧客軸テーブル
  - 目的変数
  - 特徴量数
  - 関連テーブル数
- 目的変数詳細カード
  - 対象ラベル
  - positive / negative 値
  - イベント日時列
  - 評価窓
- 特徴量サマリテーブル
  - 特徴量名
  - 元テーブル
  - データ型
  - 集計方式
  - 時間窓
  - 有効 / 無効
- 事前チェックカード
  - 欠損率
  - 重複率
  - 学習対象件数見込み
  - 利用不可特徴量数

主要操作:
- 特徴量行ごとに有効 / 無効を切り替えられる
- `マッピングを修正` から前画面へ戻る

### 4.5 右カラム: 実行条件設定
目的:
- 分析ジョブのパラメータをモード別に設定する

#### カスタム分析モード
UI コンポーネント:
- 期間設定カード
  - 学習期間
  - 評価期間
  - 基準日
- モデル実行設定カード
  - 分析粒度 `顧客単位 / イベント単位`
  - 目的変数タイプ `二値 / 連続値`
  - モデル方針 `説明重視 / 精度重視 / バランス`
  - 交差検証分割数
- 特徴量制御カード
  - 特徴量カテゴリ別 ON/OFF
  - 上限特徴量数
  - 相関しきい値
- 出力設定カード
  - 影響度算出方法
  - パターン抽出件数
  - 結果保存名

#### オートパイロットモード
UI コンポーネント:
- 自動探索範囲カード
  - 探索時間上限
  - 候補特徴量上限
  - 自動生成特徴量を含める
- ビジネス優先カード
  - 説明しやすさ優先
  - セグメント化しやすさ優先
  - 再現性優先
- セーフガードカード
  - 使用禁止カラム
  - 高欠損列を除外
  - 高カードinality列を除外

### 4.6 下部固定アクションバー
- 左: バリデーション結果 `エラー 0 / 警告 2`
- 中央: 実行サマリ
  - モード
  - 目的変数
  - 有効特徴量数
  - 見込み実行時間
- 右:
  - `下書き保存`
  - `分析を開始`

## 5. 画面内の基本フロー

### 5.1 初回表示
1. セマンティック・マッピング完了後、この画面へ遷移する
2. マッピング定義を分析入力モデルへ正規化する
3. データ件数、欠損率、重複率などの事前チェックを取得する
4. 規定値を埋めた実行設定を表示する

### 5.2 カスタム分析
1. 目的変数と特徴量の内容を確認する
2. 不要な特徴量を無効化する
3. 期間、粒度、モデル方針、出力件数を調整する
4. 事前バリデーションを通す
5. 分析ジョブを作成する

### 5.3 オートパイロット
1. 目的変数を確認する
2. 自動探索の時間上限と制約だけを指定する
3. AI に特徴量生成と探索を委譲する
4. 分析ジョブを作成する

### 5.4 実行後
1. `analysisJobId` を受け取る
2. 結果可視化画面へ遷移する
3. ジョブが非同期の場合は `実行中` ステータスで遷移する

## 6. UI 状態設計

### 6.1 画面ステート
```ts
type AnalysisRunStatus =
  | 'idle'
  | 'loadingSummary'
  | 'ready'
  | 'validating'
  | 'savingDraft'
  | 'submitting'
  | 'submitted'
  | 'error';
```

### 6.2 ビュー制御用ステート
```ts
type AnalysisMode = 'custom' | 'autopilot';

interface AnalysisRunViewState {
  mappingDocumentId: string;
  selectedDatasetId: string;
  mode: AnalysisMode;
  status: AnalysisRunStatus;
  dirty: boolean;
  activeFeatureCategory: 'all' | 'profile' | 'behavior' | 'transaction' | 'engagement';
  showDisabledFeatures: boolean;
  selectedFeatureKeys: string[];
  validationExpanded: boolean;
}
```

## 7. データ構造案

### 7.1 画面表示用サマリモデル
```ts
interface AnalysisInputSummary {
  datasetId: string;
  datasetName: string;
  workspaceId: string;
  workspaceName: string;
  mappingDocumentId: string;
  customerTableName: string;
  target: AnalysisTargetSummary;
  features: AnalysisFeatureSummary[];
  relatedTables: string[];
  dataQuality: AnalysisDataQualitySummary;
}

interface AnalysisTargetSummary {
  targetKey: string;
  label: string;
  dataType: 'binary' | 'continuous';
  positiveValue?: string;
  negativeValue?: string;
  eventTimeColumnName?: string;
  evaluationWindowDays?: number;
}

interface AnalysisFeatureSummary {
  featureKey: string;
  label: string;
  sourceTableName: string;
  sourceColumnName: string;
  dataType: 'string' | 'integer' | 'float' | 'boolean' | 'date' | 'datetime';
  category: 'profile' | 'behavior' | 'transaction' | 'engagement' | 'derived';
  aggregation: 'none' | 'count' | 'sum' | 'avg' | 'latest' | 'distinct_count';
  timeWindowDays?: number;
  enabled: boolean;
  missingRate?: number;
}

interface AnalysisDataQualitySummary {
  eligibleRowCount: number;
  duplicateRate: number;
  averageMissingRate: number;
  invalidFeatureCount: number;
  warningMessages: string[];
}
```

### 7.2 実行設定モデル
```ts
type OptimizationPreference = 'explainability' | 'accuracy' | 'balanced';

interface CustomAnalysisConfig {
  mode: 'custom';
  observationStartDate: string;
  observationEndDate: string;
  evaluationStartDate?: string;
  evaluationEndDate?: string;
  analysisUnit: 'customer' | 'event';
  targetType: 'binary' | 'continuous';
  optimizationPreference: OptimizationPreference;
  crossValidationFolds: 3 | 5 | 10;
  maxFeatureCount: number;
  correlationThreshold: number;
  importanceMethod: 'model_based' | 'permutation' | 'hybrid';
  patternCount: number;
  selectedFeatureKeys: string[];
}

interface AutopilotAnalysisConfig {
  mode: 'autopilot';
  timeBudgetMinutes: 5 | 10 | 30 | 60;
  candidateFeatureLimit: number;
  allowGeneratedFeatures: boolean;
  businessPriority: 'explainability' | 'segmentability' | 'reproducibility';
  excludeHighMissingColumns: boolean;
  excludeHighCardinalityColumns: boolean;
  blockedColumnKeys: string[];
}

type AnalysisRunConfig = CustomAnalysisConfig | AutopilotAnalysisConfig;
```

### 7.3 ジョブ作成単位
```ts
interface AnalysisRunDocument {
  id: string;
  datasetId: string;
  mappingDocumentId: string;
  mode: AnalysisMode;
  config: AnalysisRunConfig;
  status: 'draft' | 'queued' | 'running' | 'completed' | 'failed';
  estimatedDurationSeconds?: number;
  createdAt: string;
  createdBy: string;
}

interface AnalysisValidationIssue {
  id: string;
  severity: 'info' | 'warning' | 'error';
  code:
    | 'NO_ENABLED_FEATURES'
    | 'INSUFFICIENT_ROW_COUNT'
    | 'TARGET_IMBALANCED'
    | 'INVALID_DATE_RANGE'
    | 'TOO_MANY_FEATURES'
    | 'MISSING_TARGET_TIME';
  message: string;
  featureKey?: string;
}
```

## 8. GraphQL 入出力案

### 8.1 初期表示クエリ
用途:
- マッピング定義を分析入力サマリへ変換して返す
- 実行可能性判断に必要な事前統計も返す

```graphql
query AnalysisRunBootstrap($mappingDocumentId: ID!) {
  analysisInputSummary(mappingDocumentId: $mappingDocumentId) {
    datasetId
    datasetName
    workspaceId
    workspaceName
    mappingDocumentId
    customerTableName
    target {
      targetKey
      label
      dataType
      positiveValue
      negativeValue
      eventTimeColumnName
      evaluationWindowDays
    }
    features {
      featureKey
      label
      sourceTableName
      sourceColumnName
      dataType
      category
      aggregation
      timeWindowDays
      enabled
      missingRate
    }
    relatedTables
    dataQuality {
      eligibleRowCount
      duplicateRate
      averageMissingRate
      invalidFeatureCount
      warningMessages
    }
  }
  analysisRunDraft(mappingDocumentId: $mappingDocumentId) {
    id
    mode
    status
    config
  }
}
```

### 8.2 事前バリデーションミューテーション
```graphql
mutation ValidateAnalysisRun($input: ValidateAnalysisRunInput!) {
  validateAnalysisRun(input: $input) {
    valid
    estimatedDurationSeconds
    issues {
      id
      severity
      code
      message
      featureKey
    }
  }
}
```

### 8.3 下書き保存ミューテーション
```graphql
mutation UpsertAnalysisRunDraft($input: UpsertAnalysisRunInput!) {
  upsertAnalysisRunDraft(input: $input) {
    id
    status
    updatedAt
  }
}
```

### 8.4 実行開始ミューテーション
```graphql
mutation StartAnalysisRun($input: StartAnalysisRunInput!) {
  startAnalysisRun(input: $input) {
    analysisJobId
    runId
    status
    startedAt
    estimatedDurationSeconds
  }
}
```

## 9. 初期アルゴリズム実行方針

### 9.1 カスタム分析
- 二値目的変数:
  - ベースラインとしてロジスティック回帰または勾配ブースティングを使用
  - 影響度は `model_based` または `permutation importance` で算出
- 連続値目的変数:
  - 線形回帰または勾配ブースティング回帰を使用
- パターン抽出:
  - 上位特徴量を軸にルール候補を作成
  - `support / lift / conversion rate difference` を使ってランキング

### 9.2 オートパイロット
- 特徴量候補生成
  - 時系列窓の複数生成
  - count / recency / frequency / ratio 系の派生特徴量生成
- 探索
  - 複数モデルを軽量比較し、精度と説明可能性を加味して採択
- 出力
  - 最終モデルの重要特徴量
  - セグメント候補
  - 説明用サマリ

## 10. バリデーションルール
- 目的変数が未設定なら実行不可
- 有効特徴量が 1 件未満なら実行不可
- 対象件数がしきい値未満なら実行不可
- 評価期間が学習期間と逆転している場合は実行不可
- `autopilot` でも禁止カラムのみが残る構成は実行不可
- 警告のみの場合は実行可だが、確認メッセージを表示する

## 11. UI 文言のトーン
- 「モデル」より「分析条件」「実験設定」を前面に出す
- 例:
  - `OptimizationPreference.explainability` 表示名: `理由が分かりやすい結果を優先`
  - `patternCount` 表示名: `注目パターンの表示件数`
  - `eligibleRowCount` 表示名: `分析に使える件数`

## 12. 実装時の分割方針
- `src/components/analysis/AnalysisRunScreen.tsx`
- `src/components/analysis/AnalysisModeTabs.tsx`
- `src/components/analysis/AnalysisInputSummaryPanel.tsx`
- `src/components/analysis/CustomAnalysisForm.tsx`
- `src/components/analysis/AutopilotForm.tsx`
- `src/components/analysis/AnalysisRunActionBar.tsx`
- `src/types/analysis.ts`
- `src/services/analysis/analysisApi.ts`

## 13. この画面で先に決めておくべきこと
- 事前統計をリアルタイム計算するか、事前集計を参照するか
- `config` を GraphQL で JSON scalar にするか、明示 input 型にするか
- オートパイロットの時間上限を UI からどこまで開放するか
- 結果画面へ遷移するタイミングを `queued` 即時にするか、最初の中間結果待ちにするか

## 14. 推奨方針
- 初期版は `analysisInputSummary` を API 側で返し、画面では表示に集中する
- 実行前バリデーションは `開始ボタン押下前` と `押下時` の 2 回に分ける
- `custom` と `autopilot` は同じジョブ基盤に流し込み、UI だけ差分を持たせる

## 15. 設計レビュー反映

### 15.1 横断設計の参照
- 分析下書き、ジョブ、結果の保存責務は `docs/design/data-persistence.md` に従う。
- 非同期ジョブの状態遷移、キャンセル、リトライ、タイムアウトは `docs/design/job-lifecycle.md` に従う。
- 影響度算出、黄金パターン抽出、オートパイロット、データリーク対策は `docs/design/analysis-logic.md` に従う。
- 操作権限と監査ログは `docs/design/security-and-permissions.md` に従う。

### 15.2 ジョブ作成単位の拡張
```ts
interface AnalysisRunDocument {
  id: string;
  datasetId: string;
  mappingDocumentId: string;
  mode: AnalysisMode;
  config: AnalysisRunConfig;
  configHash: string;
  status: 'draft' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'timed_out';
  estimatedDurationSeconds?: number;
  modelVersion?: string;
  featureGenerationVersion?: string;
  randomSeed?: number;
  createdAt: string;
  createdBy: string;
}
```

### 15.3 データリーク防止
- 学習期間より後のイベントを特徴量に含めない。
- 評価期間の結果を特徴量生成に使わない。
- 目的変数と同義、または事後結果を含む列は `blockedColumnKeys` に追加する。
- 時系列評価が必要な分析では、目的変数またはイベントの日時列を必須にする。

### 15.4 実行制御
- 同一 `mappingDocumentId` と同一 `configHash` のジョブが実行中の場合は、新規実行ではなく既存ジョブへ遷移する。
- `queued` または `running` のジョブはキャンセル可能にする。
- オートパイロットのタイムアウトは `timeBudgetMinutes + 10分` を上限にする。
- 分析開始、キャンセル、再実行は監査ログに残す。

### 15.5 バリデーション追加
- 対象件数しきい値は初期値 100 件とし、環境設定で変更可能にする。
- `evaluationStartDate` が `observationEndDate` 以前の場合は実行不可にする。
- `selectedFeatureKeys` がすべて PII 候補または禁止列の場合は実行不可にする。

## 16. 変更履歴
- 2026-04-24: 設計レビューを受け、ジョブ状態、データリーク防止、重複実行防止、監査対象を追記。
