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
- 2026-04-24: 設計レビューを受け、分析ロジック共通仕様を追加。
