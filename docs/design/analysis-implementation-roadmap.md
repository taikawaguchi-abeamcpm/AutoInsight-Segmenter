# 分析実装ロードマップ

## 1. 背景
`PROJECT_SPEC.md` のサービスコンセプトは、ビジネスユーザーがデータサイエンスの知識なしに Fabric 上のデータから成功の黄金パターンを発見し、セグメント作成へつなげることである。

現行実装は、実データ取得、特徴量影響度、黄金パターン、セグメント候補生成の骨格を満たしている。一方で、顧客単位の分析、リーク防止、複合パターン、オートパイロット、評価指標には不足が残っているため、精度と挙動の変化を管理しながら段階的に実装する。

## 2. 実装方針
- 既存の `AnalysisResultDocument` 互換性を維持する。
- ビジネスユーザー向けの出力を優先し、技術指標は内部メタデータに寄せる。
- 施策に使うセグメント候補は、対象件数、改善幅、条件の説明しやすさを重視する。
- 精度に直接影響する変更は、単体で検証できる粒度に分割する。

## 3. フェーズ分割

### Phase 1: 初期分析品質の補強
対象:
- `blockedColumnKeys` を Python worker で実際に除外する。
- `analysisUnit = customer` の場合、顧客キー単位へ分析行を集約する。
- 上位単一条件から 2 条件、3 条件の複合黄金パターンを探索する。
- セグメント候補の目的を明示し、未成果候補向けであることをレスポンスに反映する。

狙い:
- 「Web 閲覧 + 架電 = 成約率 UP」のようなサービスコンセプト上の代表例に近づける。
- 同一顧客の複数イベントにより対象人数や成果率が歪む問題を抑える。
- 禁止列やリーク列を UI 設定だけでなく実分析でも除外する。

### Phase 2: リーク防止と期間分離
対象:
- 目的変数評価期間と特徴量作成期間を分離する。
- `TargetConfig.eventTimeColumnId` と特徴量側 `event_time` を使い、評価後イベントを除外する。
- `blockedColumnKeys` に加え、目的変数と同義の列、事後結果列の自動候補検出を追加する。

狙い:
- 実運用で過大評価される分析結果を避ける。
- 時系列ログを使う分析を安全に扱う。

実装状況:
- `TargetConfig.eventTimeColumnId` または目的変数テーブルの `event_time` を分析基準時刻として使う。
- join 先特徴量に `event_time` がある場合、目的変数発生後の値を除外する。
- `FeatureConfig.timeWindow` がある場合、目的変数発生前の指定期間内だけを特徴量集計対象にする。
- `event_time` が必要な時系列・時間窓特徴量で、目的変数または特徴量側の日時列が不足する場合は分析対象から除外する。
- 目的変数と同義の列、または `converted`、`outcome`、`result`、`won/lost`、`成約/受注/失注/結果` などの事後結果らしい列を自動除外する。
- 除外件数は `modelMetadata.autoBlockedFeatureCount`、`timeUnsafeFeatureCount`、`futureFeatureValueCount`、`outsideWindowFeatureValueCount` に保存する。

### Phase 3: 評価基盤と permutation importance
対象:
- 学習/検証分割を導入する。
- AUC または PR-AUC を算出し、`modelMetadata` に保存する。
- `importanceMethod = permutation` を実装する。
- `hybrid` を model based と permutation の順位合成に寄せる。

狙い:
- 係数や単変量差だけに依存しない重要度にする。
- 結果の信頼度をビジネス画面で説明できるようにする。

### Phase 4: オートパイロット
対象:
- 目的変数のみ指定された場合の特徴量候補生成を実装する。
- count、recency、frequency、ratio、時間窓別集計を生成する。
- 複数モデル候補を比較し、精度、説明可能性、セグメント化しやすさの合成スコアで採択する。

狙い:
- `PROJECT_SPEC.md` の「目的変数のみ指定。AIが自動で特徴量生成と最適なパターン抽出」に近づける。

## 4. Phase 1 の完了条件
- 禁止列を指定した場合、`featureImportances`、`goldenPatterns`、`segmentRecommendations` に出ない。
- 顧客単位分析では `summary.analyzedRowCount` が顧客キー単位の件数になる。
- 2 条件以上の `goldenPatterns.conditions` が生成される場合がある。
- 既存 API レスポンス型を壊さない。
