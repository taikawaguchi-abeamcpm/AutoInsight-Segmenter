# プログラムレビュー報告書

## 対象
- 実装対象: `src/` 配下の React + TypeScript 実装、SWA 設定、依存関係
- 実施日: 2026-04-24
- 重点観点: Fabric API 呼び出し効率、UI アクセシビリティ、セキュリティ、パフォーマンス

## 検証結果
- `npm run build`: 成功
- `npm audit --audit-level=moderate`: 失敗
  - `vite <= 6.4.1` 経由で `esbuild <= 0.24.2` の moderate 脆弱性を検出
  - 本番依存のみの `npm audit --omit=dev` は 0 件

## 指摘事項

### P1: 開発サーバーを外部公開する設定と Vite/esbuild 脆弱性が重なっている
- 対象:
  - `package.json:7`
  - `package.json:21`
- 内容:
  - `dev` と `preview` が `--host 0.0.0.0` で起動する。
  - 現在の `vite@^5.4.11` は `npm audit` で `esbuild` の dev server 脆弱性に該当する。
  - 開発環境で同一ネットワーク上の第三者から dev server に到達できる構成になりやすい。
- 修正案:
  - 通常の `npm run dev` は localhost のみにする。
  - 外部公開が必要な場合だけ `dev:host` など別 script に分ける。
  - Vite を脆弱性修正済み系列へ更新する。破壊的変更があるため、更新後に `npm run build` と画面確認を行う。

### P1: Fabric API 呼び出しにキャンセル・競合制御がなく、古いレスポンスで画面が上書きされる
- 対象:
  - `src/components/dataset/DatasetSelectionScreen.tsx:47-67`
  - `src/components/mapping/MappingScreen.tsx:43-49`
  - `src/components/results/ResultsVisualizationScreen.tsx:27-34`
  - `src/components/segment/SegmentCreationScreen.tsx:26-28`
- 内容:
  - `useEffect` 内の非同期処理に `AbortController` または mounted/current request guard がない。
  - データセットを素早く切り替えた場合、前の `getDatasetPreview` が後から解決して現在選択中ではないプレビューを表示しうる。
  - Fabric 実 API 化後は不要な API 呼び出しも残り、課金・レート制限・UX の問題につながる。
- 修正案:
  - サービス層を `signal?: AbortSignal` 対応にする。
  - 各 `useEffect` で cleanup 時に abort する。
  - 併せて `datasetId` 単位のプレビューキャッシュを持ち、同じデータセットを再選択しても再取得しない。

### P1: 分析バリデーションが入力変更ごとに即時実行される
- 対象:
  - `src/components/analysis/AnalysisRunScreen.tsx:54-61`
  - `src/components/analysis/AnalysisRunScreen.tsx:171-205`
  - `src/components/analysis/AnalysisRunScreen.tsx:209-242`
- 内容:
  - 日付や数値の入力変更ごとに `analysisApi.validate` が走る。
  - 実 API で事前統計や Fabric 参照を伴う場合、キー入力のたびに高コストな検証を発火する可能性がある。
  - レスポンス順制御もないため、古い検証結果が新しい設定の結果を上書きしうる。
- 修正案:
  - 入力中はローカルの軽量検証だけ行い、API 検証は `分析を開始` 前、または 500-800ms debounce 後に限定する。
  - `configHash` を付けて、返却時に現在の config と一致する結果だけ反映する。
  - ボタン押下時は必ず最新 config で再検証する方針を維持する。

### P1: スキーマ取得が全テーブル・全カラム一括前提になっている
- 対象:
  - `src/components/mapping/MappingScreen.tsx:43-49`
  - `src/services/mapping/mappingApi.ts:13-24`
  - `src/services/mockData.ts`
- 内容:
  - マッピング画面が初期表示で FabricDataset 全体を読み込む構造。
  - 設計書ではページングと詳細遅延取得が前提だが、実装はテーブル、カラム、サンプル値を一括モデルとして扱う。
  - 大規模 Fabric ワークスペースでは初期表示が重くなり、サンプル値権限制御も混ざりやすい。
- 修正案:
  - 初期表示は `tables(first, after)` でテーブル要約のみ取得する。
  - テーブル展開時にカラムを取得する。
  - サンプル値は明示操作と `sample:read` 権限確認後に別 API で取得する。

### P2: 選択 UI の状態がスクリーンリーダーに伝わりにくい
- 対象:
  - `src/components/common/Shell.tsx:39-50`
  - `src/components/dataset/DatasetSelectionScreen.tsx:133-138`
  - `src/components/analysis/AnalysisRunScreen.tsx:114-120`
  - `src/components/results/ResultsVisualizationScreen.tsx:107-123`
- 内容:
  - active/selected が CSS class のみで表現されている。
  - ワークフローナビは `aria-current="page"`、表示切替は `aria-pressed`、タブは `role="tablist"` / `role="tab"` / `aria-selected` があるとよい。
  - 重要特徴量ランキングはボタン選択状態が `aria-pressed` で伝わらない。
- 修正案:
  - 現在ステップのボタンに `aria-current="step"` または `aria-current="page"` を付ける。
  - segmented control は `aria-pressed` を付ける。
  - 分析モード切替はタブパターンで実装する。

### P2: チャートと進捗バーにアクセシブルな代替情報が不足している
- 対象:
  - `src/components/results/ResultsVisualizationScreen.tsx:84-88`
  - `src/components/results/ResultsVisualizationScreen.tsx:107-123`
- 内容:
  - 進捗バーは視覚的な `div` のみで `role="progressbar"` がない。
  - 重要特徴量の棒グラフは数値表示はあるが、表形式の代替ビューや `aria-label` がない。
  - 設計書の「チャートには同内容のテーブル表示を用意する」に未対応。
- 修正案:
  - 進捗バーに `role="progressbar" aria-valuenow aria-valuemin aria-valuemax` を付ける。
  - 重要特徴量は `<table>` 代替ビューを同画面に持つか、現在のリスト項目に十分な `aria-label` を付与する。

### P2: 複数の入力を `label` で包む Field 実装がある
- 対象:
  - `src/components/common/ui.tsx:31-45`
  - `src/components/dataset/DatasetSelectionScreen.tsx:132-140`
- 内容:
  - `Field` は常に `<label>` で children を包む。
  - `segmented` のように複数ボタンを含む場合、ラベルとコントロールの関連が曖昧になる。
- 修正案:
  - 単一 input 用の `Field` と、複数選択用の `FieldGroup` / `fieldset` + `legend` を分ける。

### P2: エラー処理が例外表示に寄り、共通 ApiError 契約を活用していない
- 対象:
  - `src/services/dataset/datasetApi.ts:16-23`
  - `src/components/dataset/DatasetSelectionScreen.tsx:60-66`
- 内容:
  - 共通型 `ApiError` は定義済みだが、サービス層は通常の `Error` を throw している。
  - retryable、correlationId、targetPath を UI に伝えられない。
  - Fabric の一時失敗時に再試行可能か判断できない。
- 修正案:
  - サービス層の返却を `AsyncResult<T>` または `ApiError` に統一する。
  - UI は `retryable` の場合だけ再試行導線を出す。
  - 監査・問い合わせ用に `correlationId` を表示またはログ送信する。

## 補足
- React は標準でテキストをエスケープするため、現状のモックデータ表示に直接的な XSS は見当たらない。
- 本番依存に既知脆弱性は検出されなかった。
- Azure Static Web Apps 設定は全ルート anonymous であり、初期プロトタイプとしては動くが、設計書の権限要件を満たすには認証済みロール前提の route 設計が必要。
