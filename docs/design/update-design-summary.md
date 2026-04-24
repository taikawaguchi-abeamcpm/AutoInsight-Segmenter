# 設計書更新サマリー

## 1. 更新日
2026-04-24

## 2. 更新目的
`docs/reviews/design_review_report.md` の指摘を受け、画面単位の設計に不足していた横断設計と、画面別の矛盾・考慮漏れを `docs/design/` 配下へ反映した。

## 3. 追加した設計書
| ファイル | 反映した主な指摘 |
| --- | --- |
| `fabric-connection-admin-screen.md` | 実Fabric接続情報を管理画面で入力・疎通確認・有効化する方針 |
| `screen-transition-and-ui-components.md` | `/design` 成果物として画面遷移図、共通UIコンポーネント、画面間状態を整理 |
| `fabric-graphql-schema.md` | Fabric接続方式、認証、GraphQL Facade、スキーマSDL案、疎通確認を整理 |
| `analysis-algorithm-detail.md` | 影響度算出、パターン抽出、セグメント候補生成、再現性を実装粒度で整理 |
| `data-persistence.md` | 保存先、アプリメタデータ、楽観ロック、セグメント成果物 |
| `graphql-contract.md` | 共通GraphQL型、エラー形式、ページング、JSON scalar 方針 |
| `security-and-permissions.md` | Azure/Fabric権限、操作権限、監査ログ、PII制御 |
| `job-lifecycle.md` | 非同期ジョブ、部分結果、キャンセル、リトライ、タイムアウト |
| `navigation-context.md` | 画面遷移、URL設計、リロード復元、権限変更時の挙動 |
| `analysis-logic.md` | データリーク防止、評価指標、影響度、黄金パターン計算式 |

## 4. 更新した既存設計書
| ファイル | 更新内容 |
| --- | --- |
| `dataset-selection-screen.md` | 推奨判定の矛盾を修正し、API側軽量スコア、ページング、権限表示を追記 |
| `semantic-mapping-screen.md` | 顧客主軸の原則1テーブル化、Join定義、自動提案信頼度、サンプル値マスクを追記 |
| `analysis-run-screen.md` | ジョブ状態、configHash、モデル/特徴量バージョン、データリーク防止、重複実行防止を追記 |
| `results-visualization-screen.md` | support/lift/conversionDelta の計算式、partial時の操作制限、CSV出力権限、アクセシビリティを追記 |
| `segment-creation-screen.md` | 専用セグメントテーブル方針、保存結果モデル拡張、PII制御、静的/動的セグメントの違いを追記 |
| `fabric-graphql-schema.md` | `.env` 固定ではなく、管理画面で保存した有効接続設定を使う方式に更新 |
| `navigation-context.md` | Fabric 接続管理画面を追加 |
| `security-and-permissions.md` | Fabric 接続管理用の権限と監査アクションを追加 |
| `screen-transition-and-ui-components.md` | データセット選択から Fabric 接続管理への導線を追加 |

## 5. レビュー指摘の反映状況
| 指摘 | 反映状況 |
| --- | --- |
| P0 保存先未確定 | `data-persistence.md` と各画面の横断参照に反映 |
| P0 GraphQL共通仕様不足 | `graphql-contract.md` に反映 |
| P0 権限・監査不足 | `security-and-permissions.md` に反映 |
| P0 PII/サンプル値未定義 | `security-and-permissions.md`、`semantic-mapping-screen.md`、`segment-creation-screen.md` に反映 |
| P1 画面遷移分断 | `navigation-context.md` に反映 |
| P1 非同期ジョブ分散 | `job-lifecycle.md`、`analysis-run-screen.md`、`results-visualization-screen.md` に反映 |
| P1 Fabric制約が抽象的 | `dataset-selection-screen.md`、`graphql-contract.md` に反映 |
| P1 自動提案の信頼性不足 | `semantic-mapping-screen.md` に反映 |
| P1 アルゴリズム仕様不足 | `analysis-logic.md`、`analysis-run-screen.md`、`results-visualization-screen.md` に反映 |
| P2 ステータス・ValidationIssue共通化 | `graphql-contract.md`、`job-lifecycle.md` に反映 |
| P2 アクセシビリティ不足 | `results-visualization-screen.md` に反映 |

## 6. 残課題
- 実Fabric接続には、管理画面で登録する Fabric GraphQL endpoint、Entra ID アプリ登録、GraphQL API Execute 権限、基礎データソース権限の設定が必要。
- 現行SPAの接続管理はモックAPIであり、client secret 保存と実疎通確認にはバックエンドと秘密情報ストアが必要。
- GraphQL の詳細 input 型は初期版では一部 JSON scalar とし、実装時のバリデーションで補う。
- 外部施策連携は初期版では管理者登録済み宛先がある場合のみ表示する前提とした。
- 既存顧客テーブルへの直接フラグ更新は初期版では推奨しない。必要な場合は別途ロールバック設計を追加する。
