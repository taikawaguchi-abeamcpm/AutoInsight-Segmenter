# Fabric接続管理: 複数有効接続

## 背景
- Fabric GraphQL 接続は複数登録できる。
- 1つを保存・有効化したときに他の接続を無効化すると、別データセットの再確認や分析実行ができなくなる。
- さらに、Secret を除外した接続一覧を使って他接続を非アクティブ化すると、保存済み `clientSecret` を上書きで失うリスクがある。

## 方針
- 一度保存・有効化した接続は、削除されるまで `isActive: true` のまま保持する。
- 新しい接続を保存しても、既存接続の `isActive` は変更しない。
- 保存済み接続の再テストでは、選択中の接続 `id` から保存済み Secret を再利用する。
- 分析実行時は「最初の有効接続」ではなく、選択された `datasetId` に対応する接続を使う。

## 実装
- `POST /api/fabric-connections`
  - 他接続を `isActive: false` にする処理を廃止する。
  - Secret を含まない一覧データで既存レコードを upsert しない。
- `DELETE /api/fabric-connections/{id}`
  - 削除後に別接続を自動で有効化する処理を廃止する。
- `POST /api/analysis/start`
  - `dataset.id` または `mapping.datasetId` から Fabric 接続を解決する。
- フロントエンド
  - 保存後のローカル状態でも、他接続を `isActive: false` にしない。
