# 分析アルゴリズム詳細設計書

## 1. 目的
影響度算出、黄金パターン抽出、セグメント候補生成、オートパイロット探索の初期アルゴリズムを、実装に落とせる粒度で定義する。共通方針は `docs/design/analysis-logic.md` に従う。

## 2. 入力
| 入力 | 内容 |
| --- | --- |
| `mappingDocumentId` | セマンティック・マッピングの保存ID |
| `AnalysisRunConfig` | custom または autopilot の分析設定 |
| Fabric業務データ | GraphQL経由で取得する顧客、取引、イベント、ディメンション |
| `blockedColumnKeys` | PII、目的変数リーク、禁止列 |
| `randomSeed` | 再現性担保用の乱数シード |

## 3. 前処理
1. `SemanticMappingDocument` から顧客主軸、目的変数、特徴量候補、Join定義を復元する。
2. 顧客ID単位で分析ベーステーブルを作成する。
3. 期間指定がある場合、特徴量作成期間と目的変数評価期間を分離する。
4. 欠損率、ユニーク数、定数列、PII候補、リーク候補を検査する。
5. `AnalysisFeatureSummary.enabled = false` または `blockedColumnKeys` の列を除外する。

## 4. 特徴量生成
| 元データ | 生成特徴量 | 例 |
| --- | --- | --- |
| 顧客属性 | category / numeric / boolean | 業種、地域、契約年数 |
| トランザクション | count / sum / avg / latest | 90日購入回数、平均購入金額 |
| イベントログ | recency / frequency / count | 最終ログイン日数、閲覧回数 |
| ディメンション | label encoding候補 | 商品カテゴリ、担当部署 |

高カーディナリティカテゴリは初期版では one-hot 展開せず、上位カテゴリと `other` に丸める。日付列はそのままモデルに渡さず、経過日数、曜日、月などの派生特徴量に変換する。

## 5. 学習・評価
| 目的変数 | 初期モデル候補 | 主指標 |
| --- | --- | --- |
| 二値 | Logistic Regression、Gradient Boosting系、Decision Tree系 | AUC または PR-AUC |
| 連続値 | Linear Regression、Random Forest系、Gradient Boosting系 | RMSE または MAE |

custom モードでは説明可能性を優先し、特徴量数とモデル複雑度を抑える。autopilot モードでは時間上限内で複数候補を比較し、精度、説明可能性、セグメント化しやすさの合成スコアで採択する。

## 6. 影響度算出
### 6.1 model_based
モデルが重要度または係数を持つ場合に使用する。

```ts
rawImportance = abs(modelFeatureWeight)
importanceScore = normalizeTo0To100(rawImportance)
direction = signOrPartialDependence(feature)
```

### 6.2 permutation
特徴量をシャッフルしたときの評価指標劣化量を使う。

```ts
baselineScore = evaluate(model, validationData)
permutedScore = evaluate(model, permute(validationData, featureKey))
rawImportance = baselineScore - permutedScore
importanceScore = normalizeTo0To100(max(rawImportance, 0))
```

### 6.3 hybrid
`model_based` と `permutation` の平均順位を取り、片方だけで高い特徴量の過大評価を避ける。

```ts
rankScore = 0.5 * modelBasedRankPercentile + 0.5 * permutationRankPercentile
importanceScore = round(rankScore * 100)
```

## 7. パターン抽出
1. 影響度上位 N 件の特徴量を候補にする。
2. 数値特徴量は分位点、業務しきい値、単調性をもとに条件候補を作る。
3. カテゴリ特徴量は上位カテゴリと成果率差が大きいカテゴリを候補にする。
4. 1条件、2条件、最大3条件までの組み合わせを探索する。
5. `supportRate`、`conversionDelta`、`lift`、`confidence` を計算する。
6. support不足、過度に狭い条件、PII由来条件、説明困難な条件を除外する。

```ts
supportRate = patternMatchedCount / analyzedRowCount
conversionDelta = patternConversionRate - baselineConversionRate
lift = baselineConversionRate > 0
  ? patternConversionRate / baselineConversionRate
  : undefined
confidence = stabilityScore * dataQualityScore * simplicityScore
```

## 8. セグメント候補生成
黄金パターンをそのまま保存候補にせず、運用可能なセグメント条件へ変換する。

| 評価軸 | 内容 |
| --- | --- |
| audienceSize | 対象人数が運用可能な範囲か |
| expectedLift | ベースライン比の改善余地 |
| actionability | 施策に使える条件か |
| stability | 評価期間を変えても傾向が大きく崩れないか |
| simplicity | 条件数が少なく説明しやすいか |

```ts
priorityScore =
  0.30 * normalizedAudienceSize +
  0.30 * normalizedLift +
  0.20 * stability +
  0.10 * actionability +
  0.10 * simplicity
```

## 9. データリーク防止
- 目的変数と同義の列、事後結果列、評価期間後のイベント列を除外する。
- `event_time` がないイベントテーブルは時系列特徴量に使わない。
- セグメント出力後にしか存在しない列を分析入力に含めない。
- ユーザーが手動で禁止解除する場合も、blocking issue を明示的に承認する設計を別途必要とする。

## 10. 出力
| 出力 | 内容 |
| --- | --- |
| `FeatureImportanceResult[]` | 重要度、方向、説明文 |
| `FeatureInteractionResult[]` | 相互作用のある特徴量ペア |
| `GoldenPatternResult[]` | 条件、support、lift、confidence、推奨アクション |
| `SegmentRecommendation[]` | セグメント名、条件、推定人数、優先度 |
| `AnalysisResultSummary` | 件数、改善幅、候補数 |

## 11. 再現性
- `configHash`、`modelVersion`、`featureGenerationVersion`、`randomSeed` を結果に保存する。
- 同一入力、同一バージョン、同一seedでは同じ候補順位になることを契約とする。
- Fabricスキーマまたは元データの更新により再実行結果が変わる場合、`lastSyncedAt` と結果の作成日時を表示する。

## 12. 変更履歴
- 2026-04-24: `/design` 成果物として分析アルゴリズム詳細を追加。
