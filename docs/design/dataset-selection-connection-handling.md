# データセット選択: Fabric接続確認とプレビュー制御

## 背景
- 複数の Fabric 接続を登録した場合、接続ごとに `datasetId` が生成される。
- スキーマ取得に失敗した接続も一覧には警告付きで残すが、分析対象として確定してはいけない。
- プレビューとセマンティック・マッピング初期化で行数の全件ページングを実行すると、Static Web Apps のバックエンド呼び出しがタイムアウトする可能性がある。

## 方針
- `connectionStatus = ready` のデータセットのみ「このデータを使う」で次工程へ進める。
- `warning` のデータセットは一覧・詳細で確認できるが、確定ボタンは無効化する。
- 詳細には `connectionId` と `secretConfigured` を保持し、どの Fabric 接続設定を直すべきか分かるようにする。
- `preview` と `mappings/bootstrap` は、行数の全件ページングを行わない。GraphQL スキーマが `totalCount` を公開している場合だけ軽量に行数を取得する。
- 古い URL などで存在しない `datasetId` が渡された場合は、アクティブ接続へフォールバックせず `FABRIC.DATASET_CONNECTION_NOT_FOUND` を返す。

## 実装対象
- `api/httpApi/index.js`
  - `datasetId` から接続を厳密に解決する。
  - プレビューとマッピング初期化では `rowCountMode: 'totalOnly'` を使う。
  - 警告データセットにも `connectionId` と `secretConfigured` を付与する。
- `api/src/fabricClient.js`
  - `rowCountMode: 'totalOnly'` を追加し、`totalCount` のみを取得する軽量モードを提供する。
  - データセット一覧に `connectionId` と `secretConfigured` を付与する。
- `src/components/dataset/DatasetSelectionScreen.tsx`
  - 初期選択は `ready` を優先する。
  - 次工程へ進める条件を `connectionStatus === 'ready'` に限定する。
- `src/types/dataset.ts`
  - `connectionId`、`secretConfigured`、`SCHEMA_PREVIEW_UNAVAILABLE` を型に追加する。
