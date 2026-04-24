# 非同期ジョブライフサイクル 設計書

## 1. 目的
分析実行、結果可視化、セグメント作成で共通利用する非同期ジョブの状態遷移、進捗、失敗時復旧を定義する。

## 2. 共通ジョブ状態
```ts
type JobStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

interface JobProgress {
  jobId: string;
  status: JobStatus;
  progressPercent?: number;
  message?: string;
  updatedAt: string;
  partialResultAvailable: boolean;
}
```

## 3. 状態遷移
- `draft -> queued -> running -> completed`
- `queued -> cancelled`
- `running -> partial -> completed`
- `running -> failed`
- `running -> timed_out`
- `partial -> failed`

`partial` は一部結果が保存済みで、未確定セクションが残る状態を表す。結果画面では保存やセグメント遷移などの破壊的操作を制限する。

## 4. リトライと重複実行
- 同一 `mappingDocumentId` と同一 `configHash` の実行が `queued` または `running` の場合、新規実行ではなく既存ジョブへの遷移を優先する。
- `failed`、`timed_out`、`cancelled` は再実行可能にする。
- 再実行時は新しい `runId` を発行し、過去結果はアーカイブせず比較可能に残す。

## 5. キャンセルとタイムアウト
- 分析ジョブは `queued` または `running` でキャンセル可能にする。
- タイムアウトはモード別に設定する。
  - custom: 既定 30 分
  - autopilot: UIで選択した探索時間 + 後処理猶予 10 分
- キャンセル後の途中結果は表示不可とし、監査ログのみ残す。

## 6. 進捗取得
- 初期版はポーリングを基本にする。
- ポーリング間隔は `queued` で 10 秒、`running` で 5 秒、長時間実行時は最大 30 秒まで伸ばす。
- サブスクリプション対応は後続拡張とする。

## 7. 変更履歴
- 2026-04-24: 設計レビューを受け、非同期ジョブ共通仕様を追加。
