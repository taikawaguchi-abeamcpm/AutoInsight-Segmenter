# データ永続化・保存責務 設計書

## 1. 目的
画面設計で扱う下書き、分析ジョブ、結果、セグメント成果物の保存先と責務を統一する。Fabric 上の業務データ本体と、アプリが管理するメタデータを分離し、再実行、監査、権限判定、復旧を実装しやすくする。

## 2. 基本方針
- Fabric は分析対象データの参照元として扱う。
- アプリ専用メタデータストアを用意し、画面状態、下書き、ジョブ、結果スナップショット、セグメント定義を保存する。
- GraphQL API は Fabric 参照とアプリメタデータ操作を同じAPI境界で提供するが、保存責務は内部で分離する。
- ユーザー操作により永続化されるデータには `createdBy`、`updatedBy`、`createdAt`、`updatedAt`、`version` を持たせる。

## 3. 保存対象
| 対象 | 主な型 | 保存先 | 備考 |
| --- | --- | --- | --- |
| データセット選択履歴 | `DatasetSelectionHistory` | アプリメタデータストア | 最近使った表示、監査に使用 |
| セマンティックマッピング | `SemanticMappingDocument` | アプリメタデータストア | Fabric データセットIDに紐づく |
| 分析実行下書き | `AnalysisRunDocument` | アプリメタデータストア | 実行前設定を保持 |
| 分析ジョブ | `AnalysisJobRecord` | アプリメタデータストア | 非同期ジョブの状態管理 |
| 分析結果スナップショット | `AnalysisResultDocument` | アプリメタデータストア | 再表示、比較、監査に使用 |
| セグメント下書き | `SegmentDraft` | アプリメタデータストア | 条件編集内容を保持 |
| セグメント成果物 | `SegmentArtifact` | アプリメタデータストア + Fabric出力先 | 出力種別により保存先が分かれる |

## 4. 共通メタデータ
```ts
interface PersistedMetadata {
  id: string;
  tenantId: string;
  workspaceId?: string;
  datasetId?: string;
  version: number;
  status: 'draft' | 'ready' | 'archived' | 'deleted';
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
```

## 5. 楽観ロック
- 更新系ミューテーションは必ず `version` を入力に含める。
- API側は保存済み `version` と一致する場合のみ更新し、成功時に `version + 1` を返す。
- 不一致時は `CONFLICT.VERSION_MISMATCH` を返し、画面側で再読み込みまたは差分確認を促す。

## 6. 削除・アーカイブ
- 初期版では物理削除を行わず、`archived` または `deleted` に更新する。
- 監査対象の分析結果、CSV出力、セグメント実行履歴は削除不可とし、表示対象からのみ除外する。

## 7. セグメント出力の保存方針
- 初期版のフラグ付与は既存顧客テーブルへの直接更新を避け、専用セグメントテーブルへの書き込みを優先する。
- 静的リストは対象顧客IDのスナップショットとして保存する。
- CSV出力は期限付きダウンロードURLを発行し、出力要求とダウンロードを監査ログに残す。
- 外部連携は管理者が登録した宛先のみ選択可能にする。

## 8. 変更履歴
- 2026-04-24: 設計レビューを受け、保存先と責務分界を追加。
