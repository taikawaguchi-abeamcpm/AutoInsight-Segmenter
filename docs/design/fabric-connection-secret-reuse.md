# Fabric接続管理: 保存済みClient Secretの再利用

## 背景
- Client Secret は保存後に画面へ再表示しない。
- そのため、保存済み接続を再度「接続確認」する場合、入力欄は空のままになる。
- 入力欄が空であることだけを検証条件にすると、DB に Secret が保存されていても再テストできない。

## 方針
- 接続一覧で選択中の接続を再テストまたは保存する場合、フロントエンドは `id` をリクエストへ含める。
- API は `id` を最優先で既存 `fabricConnections` レコードを検索し、保存済み `clientSecret` を再利用する。
- `id` で見つからない場合のみ、従来どおり endpoint URL と tenant ID から既存接続を検索する。
- 新規接続で保存済み Secret が存在しない場合は、これまで通り Client Secret 入力を必須にする。

## 対象API
- `POST /api/fabric-connections/test`
  - `draft.clientSecret` が空でも、`draft.id` に対応する保存済み Secret があれば接続確認を実行する。
- `POST /api/fabric-connections`
  - 既存接続の Secret を保持したまま、表示名・Workspace ID・Schema version などを更新できる。

## UI
- Client Secret 欄のプレースホルダーは「新規登録または差し替え時のみ入力」とする。
- Secret 登録済みの接続では、再テスト時に Secret の再入力を求めない。
