# セグメント作成画面 設計書

## 1. この設計書の対象
- 対象機能: `セグメント作成`
- 目的: 結果可視化で選択したセグメント候補や黄金パターンを元に、実運用向けのセグメント条件を編集・確認し、対象顧客へのフラグ付与やリスト保存を行う
- 出力物: UI 設計、画面内状態設計、セグメント条件データ構造案、Fabric GraphQL 入出力案、実行後の保存モデル案

## 2. 画面の役割
- 分析結果を実際のマーケティング施策に使えるセグメントへ変換する
- 条件の微修正、対象件数の再確認、名前付け、保存方法の選択を 1 画面で完結させる
- `フラグ付与` `静的リスト保存` `エクスポート` といった出力先を明示する
- 実行後のセグメント成果物 ID を返し、再利用可能な状態にする

## 3. 前後の画面遷移
1. データセット選択
2. セマンティック・マッピング
3. 分析条件確認 / 実験開始
4. 結果可視化
5. セグメント作成

この設計書では `5. セグメント作成` のみを詳細化する。

## 4. 画面レイアウト案

### 4.1 全体構成
- ヘッダー
- セグメント概要バー
- 3 カラムの作成ワークスペース
- 下部固定アクションバー

### 4.2 ヘッダー
- 画面タイトル: `セグメント作成`
- サブテキスト: `分析結果を配信・抽出に使える顧客グループとして保存します`
- 右上アクション
  - `結果に戻る`
  - `下書き保存`
  - `複製`

### 4.3 セグメント概要バー
目的:
- いま編集中のセグメントの重要情報を上部に固定表示する

UI コンポーネント:
- セグメント名
- 元の分析ジョブ名
- 元候補数
- 推定対象件数
- 更新日時
- 保存状態 `下書き / 保存済み / 実行済み`

### 4.4 左カラム: 候補と条件ビルダー
目的:
- 結果画面から持ち込んだ候補条件を編集可能なルールへ変換する

セクション構成:
1. `候補セグメント一覧`
2. `条件グループ`
3. `条件テンプレート`

UI コンポーネント:
- 候補セグメントリスト
  - セグメント名
  - 推定件数
  - 優先度
  - 元パターン名
- 条件グループエディタ
  - `AND / OR` グループ切替
  - 条件行
    - 項目名
    - 演算子
    - 値
    - 削除
  - `条件を追加`
  - `グループを追加`
- テンプレートショートカット
  - `最近 30 日で接触あり`
  - `購買回数が多い`
  - `高反応見込み`

主要操作:
- 候補セグメントを選ぶと条件ビルダーに初期値展開
- 手動で条件を増減してルールを編集
- 複数候補を統合して 1 セグメントにまとめる

### 4.5 中央カラム: プレビューと件数確認
目的:
- 条件変更が対象件数とセグメント品質にどう影響するかを即時確認する

UI コンポーネント:
- 件数プレビューカード
  - 推定対象件数
  - 全体母数に占める割合
  - 前回プレビューとの差分
- 属性分布カード
  - 主要属性の分布
  - 元母集団との差分
- 条件影響サマリカード
  - もっとも件数を絞っている条件
  - もっとも広い条件
  - 競合条件の警告
- 対象サンプルテーブル
  - 顧客 ID
  - 氏名または匿名 ID
  - 主要属性
  - 条件一致理由

主要操作:
- `件数を再計算`
- `サンプルを再取得`
- サンプル行から条件一致理由を確認

### 4.6 右カラム: 保存設定と出力先
目的:
- セグメントの保存先と利用方法を決定する

セクション構成:
1. `基本設定`
2. `出力方法`
3. `実行オプション`

UI コンポーネント:
- 基本設定フォーム
  - セグメント名
  - 説明
  - タグ
  - 有効期限
- 出力方法カード
  - `顧客フラグを付与`
  - `静的リストとして保存`
  - `CSV として出力`
  - `外部施策連携用に保持`
- 実行オプションフォーム
  - フラグ列名
  - 保存先テーブル名
  - 重複処理 `上書き / 追記 / スキップ`
  - 更新タイミング `今すぐ / 後で`
- 検証メッセージカード
  - 保存先未設定
  - 列名衝突
  - 件数 0
  - 対象件数過大

### 4.7 下部固定アクションバー
- 左: 検証結果 `エラー 0 / 警告 1`
- 中央: 実行サマリ
  - セグメント名
  - 推定件数
  - 出力方法
- 右:
  - `下書き保存`
  - `プレビュー更新`
  - `セグメントを作成`

## 5. 画面内の基本フロー

### 5.1 初回表示
1. 結果可視化画面から `SelectedSegmentContext` を受け取る
2. 選択済み候補をセグメント編集モデルへ変換する
3. 初期件数プレビューを取得する
4. 保存設定に既定値を埋める

### 5.2 ユーザー作業
1. 候補セグメントを選ぶ
2. 条件ビルダーで必要に応じて編集する
3. 件数プレビューとサンプルを確認する
4. 保存名と出力方法を設定する
5. バリデーションが通ったら作成を実行する

### 5.3 実行後
1. セグメント保存処理を実行する
2. `segmentId` または `segmentExecutionId` を受け取る
3. 完了メッセージと再利用導線を表示する

### 5.4 エラー時
- 件数プレビュー失敗時は最新成功値を保持しつつ再計算導線を出す
- 保存失敗時は条件編集内容を保持したままリトライ可能にする

## 6. UI 状態設計

### 6.1 画面ステート
```ts
type SegmentCreationStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'recomputingPreview'
  | 'savingDraft'
  | 'submitting'
  | 'submitted'
  | 'error';
```

### 6.2 ビュー制御用ステート
```ts
type SegmentOutputType = 'flag' | 'list' | 'csv' | 'external';

interface SegmentCreationViewState {
  analysisJobId: string;
  selectedRecommendationId: string | null;
  selectedOutputTypes: SegmentOutputType[];
  activeConditionGroupId: string | null;
  previewAutoRefresh: boolean;
  sampleSize: 20 | 50 | 100;
  dirty: boolean;
  status: SegmentCreationStatus;
}
```

## 7. データ構造案

### 7.1 セグメント編集モデル
```ts
type LogicalOperator = 'and' | 'or';

interface SegmentDraft {
  id: string;
  analysisJobId: string;
  sourceRecommendationIds: string[];
  name: string;
  description?: string;
  tags: string[];
  status: 'draft' | 'validated' | 'saved' | 'executed';
  ruleTree: SegmentRuleGroup;
  outputConfig: SegmentOutputConfig;
  previewSummary?: SegmentPreviewSummary;
  createdAt: string;
  updatedAt: string;
}

interface SegmentRuleGroup {
  id: string;
  operator: LogicalOperator;
  conditions: SegmentRuleCondition[];
  groups: SegmentRuleGroup[];
}

interface SegmentRuleCondition {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: 'string' | 'number' | 'boolean' | 'date' | 'datetime';
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'contains' | 'in';
  value: string | number | boolean;
  valueTo?: string | number;
  source: 'recommendation' | 'manual';
}
```

### 7.2 プレビュー用モデル
```ts
interface SegmentPreviewSummary {
  estimatedAudienceSize: number;
  audienceRate: number;
  deltaFromPreviousPreview?: number;
  topConstrainingConditions: string[];
  warnings: SegmentPreviewWarning[];
  sampleRows: SegmentPreviewRow[];
}

interface SegmentPreviewWarning {
  code:
    | 'ZERO_AUDIENCE'
    | 'TOO_BROAD'
    | 'CONFLICTING_RULES'
    | 'MISSING_OUTPUT_TARGET';
  severity: 'info' | 'warning' | 'error';
  message: string;
}

interface SegmentPreviewRow {
  customerKey: string;
  displayName?: string;
  attributes: Record<string, string | number | boolean | null>;
  matchedReasons: string[];
}
```

### 7.3 出力設定モデル
```ts
interface SegmentOutputConfig {
  outputs: SegmentOutputType[];
  flagConfig?: SegmentFlagConfig;
  listConfig?: SegmentListConfig;
  csvConfig?: SegmentCsvConfig;
  externalConfig?: SegmentExternalConfig;
  executionTiming: 'now' | 'later';
}

interface SegmentFlagConfig {
  tableName: string;
  flagColumnName: string;
  overwriteMode: 'overwrite' | 'append' | 'skip';
}

interface SegmentListConfig {
  tableName: string;
  listName: string;
}

interface SegmentCsvConfig {
  fileName: string;
  includeColumns: string[];
}

interface SegmentExternalConfig {
  destinationKey: string;
  payloadFormat: 'csv' | 'json';
}
```

### 7.4 保存結果モデル
```ts
interface SegmentSaveResult {
  segmentId: string;
  segmentExecutionId?: string;
  status: 'saved' | 'queued' | 'completed' | 'failed';
  affectedRowCount?: number;
  savedAt: string;
}
```

## 8. GraphQL 入出力案

### 8.1 初期表示クエリ
用途:
- 結果画面から渡された候補 ID を元に編集用ドラフトを生成または取得する

```graphql
query SegmentCreationBootstrap($analysisJobId: ID!, $segmentIds: [ID!]!) {
  segmentDraftFromResults(analysisJobId: $analysisJobId, segmentIds: $segmentIds) {
    id
    analysisJobId
    sourceRecommendationIds
    name
    description
    tags
    status
    ruleTree
    outputConfig
    previewSummary {
      estimatedAudienceSize
      audienceRate
      deltaFromPreviousPreview
      topConstrainingConditions
      warnings {
        code
        severity
        message
      }
      sampleRows {
        customerKey
        displayName
        attributes
        matchedReasons
      }
    }
    updatedAt
  }
}
```

### 8.2 件数プレビュー更新ミューテーション
```graphql
mutation PreviewSegment($input: PreviewSegmentInput!) {
  previewSegment(input: $input) {
    estimatedAudienceSize
    audienceRate
    deltaFromPreviousPreview
    topConstrainingConditions
    warnings {
      code
      severity
      message
    }
    sampleRows {
      customerKey
      displayName
      attributes
      matchedReasons
    }
  }
}
```

### 8.3 下書き保存ミューテーション
```graphql
mutation UpsertSegmentDraft($input: UpsertSegmentDraftInput!) {
  upsertSegmentDraft(input: $input) {
    id
    status
    updatedAt
  }
}
```

### 8.4 セグメント作成実行ミューテーション
```graphql
mutation CreateSegment($input: CreateSegmentInput!) {
  createSegment(input: $input) {
    segmentId
    segmentExecutionId
    status
    affectedRowCount
    savedAt
  }
}
```

## 9. 実行方針

### 9.1 フラグ付与
- 顧客主テーブルまたは関連セグメントテーブルへ出力する
- 既存列がある場合は `overwrite / append / skip` を選択可能にする

### 9.2 静的リスト保存
- セグメント定義と対象顧客 ID のスナップショットを保存する
- 再計算しない固定配布用リストとして扱う

### 9.3 エクスポート
- 初期版は CSV を優先
- 外部連携は保存したセグメントを後続バッチで取り込める構造にする

## 10. バリデーションルール
- セグメント名が空の場合は保存不可
- 条件が 1 件未満の場合は作成不可
- 推定件数が 0 の場合は作成不可
- 出力方法が 1 件も選ばれていない場合は作成不可
- `flag` 選択時に `flagColumnName` 未設定なら作成不可
- `list` 選択時に保存先テーブル未設定なら作成不可
- 警告のみの場合は作成可だが確認メッセージを表示する

## 11. UI 文言のトーン
- 分析用語ではなく配信・抽出・施策実行の文脈で表現する
- 例:
  - `estimatedAudienceSize` 表示名: `この条件に当てはまる人数`
  - `flagColumnName` 表示名: `付与するフラグ名`
  - `external` 表示名: `ほかの施策ツールで使うために保存`

## 12. 実装時の分割方針
- `src/components/segment/SegmentCreationScreen.tsx`
- `src/components/segment/SegmentCandidateList.tsx`
- `src/components/segment/SegmentRuleBuilder.tsx`
- `src/components/segment/SegmentPreviewPanel.tsx`
- `src/components/segment/SegmentOutputForm.tsx`
- `src/components/segment/SegmentActionBar.tsx`
- `src/types/segment.ts`
- `src/services/segment/segmentApi.ts`

## 13. この画面で先に決めておくべきこと
- 件数プレビューをリアルタイム更新にするか、明示ボタンにするか
- `ruleTree` を JSON scalar で扱うか、GraphQL input を細かく切るか
- フラグ付与先を既存顧客テーブルに限定するか、専用セグメントテーブルも許可するか
- 外部施策連携を初期版で UI に出すか、将来拡張用に隠すか

## 14. 推奨方針
- 初期版は `SelectedSegmentContext` を受けて 1 画面で調整と保存を完結させる
- 件数プレビューは `手動再計算` を基本にして API 負荷を抑える
- 保存形式はまず `フラグ付与` と `静的リスト保存` を主軸にし、外部連携は後付けしやすい構成にする

## 15. 設計レビュー反映

### 15.1 横断設計の参照
- セグメント下書きと成果物の保存責務は `docs/design/data-persistence.md` に従う。
- ルールツリーと出力設定の GraphQL 方針は `docs/design/graphql-contract.md` に従う。
- フラグ付与、CSV出力、外部連携の権限と監査は `docs/design/security-and-permissions.md` に従う。
- セグメント作成が非同期になる場合は `docs/design/job-lifecycle.md` に従う。

### 15.2 出力先方針の修正
- 初期版の `顧客フラグを付与` は既存顧客テーブルへの直接更新を避け、専用セグメントテーブルへの書き込みを優先する。
- 既存テーブル更新を許可する場合は、管理者権限、衝突検出、ロールバック方針を別途必須にする。
- `external` は管理者登録済み宛先がある場合のみ表示する。

### 15.3 保存結果モデルの拡張
```ts
interface SegmentSaveResult {
  segmentId: string;
  segmentExecutionId?: string;
  status: 'saved' | 'queued' | 'completed' | 'failed';
  outputTypes: SegmentOutputType[];
  outputLocation?: string;
  affectedRowCount?: number;
  executedBy: string;
  savedAt: string;
}
```

### 15.4 PIIとプレビュー
- `SegmentPreviewRow.displayName` は原則匿名IDを表示する。
- 実名または個人属性の表示は `sample:read` 権限がある場合のみ許可する。
- サンプル行の属性はマスク済み値を既定にする。

### 15.5 静的リストと動的条件
- 静的リストは作成時点の対象顧客IDスナップショットとして保存する。
- 動的条件セグメントは `ruleTree` と出力設定のみ保存し、実行時に再計算する。
- 画面上では「固定リスト」と「条件を保存して再計算可能」の違いを明示する。

### 15.6 バリデーション追加
- 出力先テーブル名または列名が既存成果物と衝突する場合は作成不可または確認必須にする。
- 最大出力件数を超える場合はCSV直接出力ではなく非同期エクスポートへ切り替える。
- 外部連携先が未承認の場合は作成不可にする。

## 16. 変更履歴
- 2026-04-24: 設計レビューを受け、専用セグメントテーブル方針、PII制御、保存結果拡張、外部連携制御を追記。
