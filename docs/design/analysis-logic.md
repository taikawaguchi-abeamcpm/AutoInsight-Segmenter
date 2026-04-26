# 分析ロジック 設計書

## 1. 目的
影響度算出、黄金パターン抽出、オートパイロットの初期アルゴリズムを、再現性とデータリーク防止を含めて定義する。

## 2. 共通前提
- 分析は `mappingDocumentId` と `AnalysisRunConfig` を入力にする。
- 分析実行時に `configHash`、`modelVersion`、`featureGenerationVersion`、`randomSeed` を保存する。
- 期間を使う分析では、特徴量作成の基準日と目的変数の評価期間を分離する。

## 3. データリーク防止
- 学習期間より後のイベントを特徴量に含めない。
- 評価期間の結果を特徴量生成に使わない。
- `event_time` または対象日時列が不足する場合、時系列評価を必要とする分析は実行不可にする。
- 目的変数と同義または事後結果を含む列は `blockedColumnKeys` として除外する。

## 4. 評価指標
| 目的変数 | 主指標 | 補助指標 |
| --- | --- | --- |
| 二値 | AUC または PR-AUC | lift、conversionDelta、accuracy |
| 連続値 | RMSE または MAE | R2、平均差分 |

ビジネス画面には技術指標をそのまま出さず、`理由の分かりやすさ`、`成約率の差`、`対象件数` として表示する。

## 5. 影響度算出
- 初期版は `model_based` と `permutation` をサポートする。
- `importanceScore` はAPI側で 0-100 に正規化して返す。
- 正負方向はモデル係数、部分依存、またはセグメント別平均差をもとに `positive / negative / neutral` で返す。

### 5.1 実データ分析の初期実装
- 分析開始時に Fabric GraphQL から対象テーブルの行データを `first / after` でページング取得する。
- 目的変数と同じ Query テーブルに存在する特徴量は、その行の値をそのまま分析値にする。
- 目的変数テーブルと特徴量テーブルが `joinDefinitions` で直接接続されている場合は、join キーで特徴量テーブルを結合し、目的変数行ごとの特徴量値へ集計する。
- 目的変数テーブルと特徴量テーブルが同一ハブテーブルに接続されている場合は、ハブキーを介して結合する。典型例は、目的変数テーブルと活動テーブルがどちらも顧客マスタへ接続されているケース。
- 二値目的変数は `TargetConfig.positiveValue / negativeValue` を優先し、未設定の場合は boolean、0/1、true/false、成約/未成約などの値から推定する。
- 数値特徴量は正例・負例の平均差を標準偏差で正規化し、目的変数平均との差と合わせて `importanceScore` を算出する。
- カテゴリ特徴量は値ごとの正例率を集計し、全体平均との差が最も大きい値を代表パターンとして採用する。
- join で複数行に展開される特徴量は `FeatureConfig.aggregation` に従って集計する。
  - 数値: `sum / avg / min / max / latest / count / distinct_count`
  - カテゴリ: `latest / none` は直近相当の最終値、その他は最頻値。`count / distinct_count` は数値特徴量として扱う。
- `supportRate`、`conversionDelta`、`lift`、`estimatedAudienceSize` は実データ集計値から返す。
- 大量データの上限は API 環境変数で制御する。
  - `FABRIC_ANALYSIS_PAGE_SIZE`
  - `FABRIC_ANALYSIS_MAX_ROWS`

## 6. 黄金パターン指標
```ts
supportRate = patternMatchedCount / analyzedRowCount
conversionDelta = patternConversionRate - baselineConversionRate
lift = patternConversionRate / baselineConversionRate
```

- `baselineConversionRate` が 0 の場合、`lift` は返さず `conversionDelta` を優先表示する。
- `supportRate` がしきい値未満のパターンは推奨対象から除外する。
- パターンには `confidence` と `recommendedAction` を付与する。

## 7. オートパイロット
- 自動生成特徴量は count、recency、frequency、ratio、時間窓別集計を対象にする。
- 高欠損列、高カーディナリティ列、PII候補列、禁止列は既定で除外する。
- 探索時間上限内で複数モデルを比較し、精度、説明可能性、セグメント化しやすさを加味して採択する。

## 8. 変更履歴
- 2026-04-26: Fabric GraphQL の行データと join 定義に基づく実分析仕様を追記。
- 2026-04-24: 設計レビューを受け、分析ロジック共通仕様を追加。
