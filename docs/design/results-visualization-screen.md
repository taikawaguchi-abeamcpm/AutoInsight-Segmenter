# 結果可視化画面 設計書

## 1. この設計書の対象
- 対象機能: `結果可視化`
- 目的: 分析ジョブの実行結果をビジネスユーザーが理解しやすい形で可視化し、重要特徴量、黄金パターン、セグメント候補を確認できるようにする
- 出力物: UI 設計、画面内状態設計、結果データ構造案、Fabric GraphQL 入出力案、次画面への受け渡しモデル案

## 2. 画面の役割
- 実験結果を「読み解く画面」として、分析の要点を短時間で把握させる
- 影響度の高い特徴量と、その組み合わせで得られた黄金パターンを提示する
- セグメンテーションに使える条件候補を絞り込み、次画面へ引き渡す
- 分析ジョブが実行中でも途中経過を表示し、ユーザーを待たせすぎない

## 3. 前後の画面遷移
1. データセット選択
2. セマンティック・マッピング
3. 分析条件確認 / 実験開始
4. 結果可視化
5. セグメント作成

この設計書では `4. 結果可視化` のみを詳細化する。

## 4. 画面レイアウト案

### 4.1 全体構成
- ヘッダー
- 実行ステータスバー
- KPI サマリ帯
- 2 カラムの分析ワークスペース
- 下部固定アクションバー

### 4.2 ヘッダー
- 画面タイトル: `結果可視化`
- サブテキスト: `分析で見つかった重要要因とパターンを確認します`
- 右上アクション
  - `条件を見直す`
  - `再実行`
  - `結果を保存`

### 4.3 実行ステータスバー
目的:
- 非同期ジョブの進捗と結果確定状態を明確にする

UI コンポーネント:
- ステータスチップ `queued / running / completed / failed`
- 進捗バー
- 最終更新時刻
- 実行モード表示 `カスタム分析 / オートパイロット`
- 処理メッセージ

状態ごとの表示:
- `queued`: 待機中メッセージと見込み開始までの案内
- `running`: 中間結果を逐次表示
- `completed`: 全コンテンツ活性
- `failed`: エラーカードと再実行導線

### 4.4 KPI サマリ帯
目的:
- 結果の要約を最上部で提示する

UI コンポーネント:
- KPI カード `分析対象件数`
- KPI カード `影響度上位特徴量数`
- KPI カード `有効パターン数`
- KPI カード `推奨セグメント数`
- KPI カード `ベースライン比改善率`

### 4.5 左カラム: 分析インサイト
目的:
- なぜ結果が出たかを説明する主ビュー

セクション構成:
1. `重要特徴量ランキング`
2. `特徴量詳細`
3. `相互作用 / 組み合わせ`

UI コンポーネント:
- 横棒チャート
  - 特徴量名
  - 重要度スコア
  - 影響方向 `プラス / マイナス`
- フィルタ
  - カテゴリ別 `属性 / 行動 / 購買 / 接触 / 派生`
  - 上位件数
  - 正負切替
- 特徴量詳細カード
  - 説明文
  - 集計方法
  - 対象期間
  - 欠損率
  - 代表値
- 相互作用ヒートマップまたはペアテーブル
  - 組み合わせ特徴量
  - 相乗効果スコア

主要操作:
- ランキングの行選択で詳細カードを更新
- 複数特徴量を選んで比較表示

### 4.6 右カラム: パターンとアクション候補
目的:
- ビジネス施策に繋がる解釈を提示する

セクション構成:
1. `黄金パターン`
2. `セグメント候補`
3. `実行条件サマリ`

UI コンポーネント:
- パターンカード一覧
  - パターン名
  - 条件セット
  - 条件値またはしきい値
  - support
  - lift
  - 成約率差分または改善率
  - 推奨理由
- セグメント候補テーブル
  - セグメント名
  - 条件数
  - 該当件数
  - 想定利用シーン
  - `セグメント作成へ送る`
- 実行条件サマリカード
  - 目的変数
  - 実行モード
  - 対象期間
  - 有効特徴量数
  - 実行日時

主要操作:
- パターンカードを選ぶと、条件の詳細と該当件数プレビューを表示
- セグメント候補を複数選択し、次画面へ持ち越せる

### 4.7 下部固定アクションバー
- 左: 現在の結果状態 `確定済み / 更新中`
- 中央: 選択中のパターンまたはセグメント候補サマリ
- 右:
  - `CSV 出力`
  - `条件を編集`
  - `セグメント作成へ進む`

## 5. 画面内の基本フロー

### 5.1 初回表示
1. `analysisJobId` を受け取って画面表示
2. ジョブ状態と結果サマリを取得
3. 完了済みなら全結果を表示
4. 実行中なら中間サマリと進捗を先に表示

### 5.2 ユーザー作業
1. KPI サマリ帯で結果全体を把握する
2. 重要特徴量ランキングから要因を確認する
3. 黄金パターンで施策に使えそうな条件を探す
4. セグメント候補を選び、次画面へ進む

### 5.3 実行中の更新
- ポーリングまたはサブスクリプションで結果を更新
- 重要特徴量と KPI は先行表示可能にする
- 黄金パターンとセグメント候補は後から確定表示でもよい

### 5.4 エラー時
- ジョブ失敗時は原因サマリと `再実行` を表示
- 部分結果のみ取得できた場合は、表示可能領域だけ出しつつ警告を出す

## 6. UI 状態設計

### 6.1 画面ステート
```ts
type ResultsScreenStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'ready'
  | 'partial'
  | 'failed'
  | 'error';
```

### 6.2 ビュー制御用ステート
```ts
interface ResultsViewState {
  analysisJobId: string;
  selectedFeatureKey: string | null;
  selectedPatternId: string | null;
  selectedSegmentIds: string[];
  featureCategoryFilter: 'all' | 'profile' | 'behavior' | 'transaction' | 'engagement' | 'derived';
  importanceDirectionFilter: 'all' | 'positive' | 'negative';
  patternSortBy: 'lift' | 'support' | 'conversionDelta';
  topFeatureCount: 10 | 20 | 50;
  autoRefresh: boolean;
  status: ResultsScreenStatus;
}
```

## 7. データ構造案

### 7.1 結果全体モデル
```ts
type AnalysisJobStatus = 'queued' | 'running' | 'completed' | 'failed';

interface AnalysisResultDocument {
  analysisJobId: string;
  runId: string;
  datasetId: string;
  mappingDocumentId: string;
  mode: 'custom' | 'autopilot';
  status: AnalysisJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  summary: AnalysisResultSummary;
  featureImportances: FeatureImportanceResult[];
  interactionPairs: FeatureInteractionResult[];
  goldenPatterns: GoldenPatternResult[];
  segmentRecommendations: SegmentRecommendation[];
}

interface AnalysisResultSummary {
  analyzedRowCount: number;
  topFeatureCount: number;
  validPatternCount: number;
  recommendedSegmentCount: number;
  baselineMetricValue?: number;
  improvedMetricValue?: number;
  improvementRate?: number;
}
```

### 7.2 重要特徴量モデル
```ts
interface FeatureImportanceResult {
  featureKey: string;
  label: string;
  category: 'profile' | 'behavior' | 'transaction' | 'engagement' | 'derived';
  importanceScore: number;
  direction: 'positive' | 'negative' | 'neutral';
  aggregation: 'none' | 'count' | 'sum' | 'avg' | 'latest' | 'distinct_count';
  timeWindowDays?: number;
  missingRate?: number;
  description?: string;
}

interface FeatureInteractionResult {
  leftFeatureKey: string;
  rightFeatureKey: string;
  synergyScore: number;
  summary: string;
}
```

### 7.3 黄金パターンモデル
```ts
interface GoldenPatternResult {
  id: string;
  title: string;
  conditions: PatternCondition[];
  supportRate: number;
  lift: number;
  conversionDelta?: number;
  confidence?: number;
  description: string;
  recommendedAction?: string;
}

interface PatternCondition {
  featureKey: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in';
  value: string | number | boolean;
  valueTo?: string | number;
  label: string;
}
```

### 7.4 セグメント候補モデル
```ts
interface SegmentRecommendation {
  id: string;
  name: string;
  description?: string;
  sourcePatternId?: string;
  estimatedAudienceSize: number;
  estimatedConversionRate?: number;
  conditions: PatternCondition[];
  useCase?: string;
  priorityScore: number;
}
```

### 7.5 次画面への受け渡しモデル
```ts
interface SelectedSegmentContext {
  analysisJobId: string;
  segmentIds: string[];
  segments: SegmentRecommendation[];
}
```

## 8. GraphQL 入出力案

### 8.1 初期表示クエリ
用途:
- ジョブ状態と結果サマリをまとめて取得する

```graphql
query ResultsVisualizationBootstrap($analysisJobId: ID!) {
  analysisJob(id: $analysisJobId) {
    analysisJobId
    runId
    datasetId
    mappingDocumentId
    mode
    status
    createdAt
    startedAt
    completedAt
    summary {
      analyzedRowCount
      topFeatureCount
      validPatternCount
      recommendedSegmentCount
      baselineMetricValue
      improvedMetricValue
      improvementRate
    }
    featureImportances {
      featureKey
      label
      category
      importanceScore
      direction
      aggregation
      timeWindowDays
      missingRate
      description
    }
    interactionPairs {
      leftFeatureKey
      rightFeatureKey
      synergyScore
      summary
    }
    goldenPatterns {
      id
      title
      supportRate
      lift
      conversionDelta
      confidence
      description
      recommendedAction
      conditions {
        featureKey
        operator
        value
        valueTo
        label
      }
    }
    segmentRecommendations {
      id
      name
      description
      sourcePatternId
      estimatedAudienceSize
      estimatedConversionRate
      useCase
      priorityScore
      conditions {
        featureKey
        operator
        value
        valueTo
        label
      }
    }
  }
}
```

### 8.2 進捗更新クエリまたはサブスクリプション
```graphql
subscription AnalysisJobProgress($analysisJobId: ID!) {
  analysisJobProgress(analysisJobId: $analysisJobId) {
    analysisJobId
    status
    progressPercent
    message
    updatedAt
  }
}
```

### 8.3 結果保存ミューテーション
```graphql
mutation SaveAnalysisResultSnapshot($analysisJobId: ID!) {
  saveAnalysisResultSnapshot(analysisJobId: $analysisJobId) {
    snapshotId
    savedAt
  }
}
```

### 8.4 セグメント引き渡しミューテーション
用途:
- 次画面で使う候補を明示的に保持したい場合に使用

```graphql
mutation PrepareSegmentsFromResults($input: PrepareSegmentsInput!) {
  prepareSegmentsFromResults(input: $input) {
    analysisJobId
    segmentIds
  }
}
```

## 9. 可視化方針

### 9.1 重要特徴量ランキング
- 初期表示は横棒チャート
- 正負方向を色で区別
- クリックで詳細カードと関連パターンを更新

### 9.2 黄金パターン
- 数式ではなく「条件の並び」と「期待効果」を前面表示
- 「業種 = X」「営業収益 >= Y」のような具体的なカテゴリ値・数値しきい値をカード上に常時表示する
- カード本文には、該当件数、該当条件の目的変数率、全体平均との差を1文で表示する
- `support` `lift` `改善率` は比較しやすいバッジで表示

### 9.3 セグメント候補
- マーケティング施策に繋がる名称を優先表示
- 件数だけでなく優先度と用途を併記する

## 10. バリデーションルール
- `セグメント作成へ進む` は 1 件以上の候補選択時のみ活性
- ジョブが `completed` でない場合、未確定結果であることを明示
- `failed` 状態では結果保存と次画面遷移は不可
- 部分結果時は、未確定セクションに `暫定` バッジを表示

## 11. UI 文言のトーン
- 技術指標より意思決定に使える表現を優先する
- 例:
  - `importanceScore` 表示名: `効きやすさ`
  - `conversionDelta` 表示名: `成約率の差`
  - `segmentRecommendation` 表示名: `次に試したい顧客グループ`

## 12. 実装時の分割方針
- `src/components/results/ResultsVisualizationScreen.tsx`
- `src/components/results/JobStatusBar.tsx`
- `src/components/results/ResultsKpiStrip.tsx`
- `src/components/results/FeatureImportanceChart.tsx`
- `src/components/results/GoldenPatternList.tsx`
- `src/components/results/SegmentRecommendationTable.tsx`
- `src/components/results/ResultsActionBar.tsx`
- `src/types/results.ts`
- `src/services/results/resultsApi.ts`

## 13. この画面で先に決めておくべきこと
- 実行中更新をポーリングにするかサブスクリプションにするか
- 特徴量ランキングのスコアを正規化済みで返すか、生値で返すか
- `goldenPatterns` を API 側で完結生成するか、クライアント整形を残すか
- セグメント候補の件数見積もりをリアルタイム再計算するか固定値にするか

## 14. 推奨方針
- 初期版は `analysisJob` クエリで必要結果を一括取得し、更新だけ軽量 API を使う
- まずは `重要特徴量` と `黄金パターン` を中心に据え、過剰なチャート追加は避ける
- 次画面へは `SelectedSegmentContext` を渡し、セグメント条件の再編集はセグメント作成画面で行う

## 15. 設計レビュー反映

### 15.1 横断設計の参照
- 結果スナップショットの保存責務は `docs/design/data-persistence.md` に従う。
- ジョブ進捗、部分結果、失敗時復旧は `docs/design/job-lifecycle.md` に従う。
- 指標定義と計算式は `docs/design/analysis-logic.md` に従う。
- CSV出力、結果保存、セグメント引き渡しの権限と監査は `docs/design/security-and-permissions.md` に従う。

### 15.2 指標定義
画面に表示する `supportRate`、`lift`、`conversionDelta` は以下の定義を使う。

```ts
supportRate = patternMatchedCount / analyzedRowCount
conversionDelta = patternConversionRate - baselineConversionRate
lift = patternConversionRate / baselineConversionRate
```

- `baselineConversionRate` が 0 の場合は `lift` を非表示にし、`conversionDelta` を優先する。
- `importanceScore` はAPI側で 0-100 に正規化済みの値を返す。

### 15.3 部分結果の扱い
- `partial` 状態では、KPI、重要特徴量、実行条件サマリのみ表示可能にする。
- 黄金パターンとセグメント候補には `暫定` バッジを表示し、セグメント作成への遷移は不可にする。
- `partial -> failed` の場合は、表示可能な途中結果を閲覧専用で残し、保存とCSV出力は不可にする。

### 15.4 CSV出力とPII
- CSV出力は `export:create` 権限がある場合のみ活性化する。
- 出力列、最大件数、マスキング有無はAPI側で検証する。
- ダウンロードURLは期限付きとし、出力要求とダウンロードを監査ログに残す。

### 15.5 アクセシビリティ
- 重要特徴量チャートには同内容のテーブル表示を用意する。
- 影響方向は色だけでなく `プラス / マイナス / 中立` のラベルで示す。
- ヒートマップを追加する場合はペアテーブル代替表示を必須にする。

## 16. 変更履歴
- 2026-04-26: パターンカードに具体的な条件値・しきい値を常時表示する方針を追記。
- 2026-04-24: 設計レビューを受け、指標定義、部分結果制御、CSV権限、アクセシビリティを追記。
