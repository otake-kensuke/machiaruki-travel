# 街歩きラボ｜旅行ノート v0.1

北海道旅行（2026年10月30日〜）での試用を目指す、端末保存型の静的Webアプリ。現在はStep 1〜2の実装です。GitHub Pages公開・デプロイは行っていません。

## ローカル起動

Node.js 20以降で、プロジェクトフォルダーから実行します。インストール・ビルドは不要です。

```powershell
node scripts/serve.mjs
```

ブラウザで `http://127.0.0.1:4173/` を開きます。初回は空です。「サンプル旅程を読み込む」→内容確認→「この端末に読み込む」で追加してください。`index.html` を直接ファイルとして開く方法はサポートしません。

- サーバーは127.0.0.1にのみ待ち受けます。終了はCtrl+C。
- 別ポートはPowerShellで `$env:PORT = '4174'` を指定してから起動します。
- `http://127.0.0.1:4173/machiaruki-travel/` はGitHub Pages相当のサブパス確認用です。
- ローカルURLを変えると別の保存領域になります。データはサーバー上のファイルではなく、ブラウザのIndexedDBに保存されます。

## 今回実装したこと

- 下部タブによる3画面の移動、旅行ホームの日程・交通・宿泊、日付別の予定と実績、日別訪問履歴。
- 明示操作によるサンプル全件追加。3日分、8予定、2交通、2宿泊、2仮訪問。
- IndexedDBの保存基盤。起動時は読み込みのみ、追加時は全件検証と一括トランザクション。
- 重複IDの拒否、複数タブの並行追加、保存失敗時のエラー・確認画面保持。
- 保存データの未知形式を初期化せず停止。既存データの自動上書き・削除機能はありません。
- 旅行が複数ある場合の選択欄。通常の画面操作で旅行を新規作成する機能は未実装です。
- ホーム画面向けマニフェスト、PNGアイコン、セーフエリアに配慮したレイアウト。

サンプルはすべて仮の設定で、予約情報や実際の訪問実績ではありません。仮訪問を含むため、サンプルJSONの外枠は `kind: "backup"` です。このボタンはアプリ同梱サンプルを追加する機能であり、利用者のバックアップファイルを復元する機能ではありません。

## 保存の方針

DB名は `machiaruki-travel`、DB構造バージョンは `1`。`workspace` ストアの `active` キーに、データ・スキーマバージョン・リビジョンをまとめて保存します。v0.1の小規模な旅程では、この構造でコレクション間の整合性を保ちます。

readwriteトランザクション内で最新データを取得し、追加データと結合・検証して保存します。成功は `transaction.oncomplete` 後に返します。サンプルは起動時に挿入しません。画面が再び表示されたときはDBを再読込します。

端末保存は永久保存を保証しません。ブラウザデータを削除しないでください。バックアップが未実装の現在は、実旅行の記録を投入する段階ではありません。旅行名・メモ・位置情報の送信やアクセス解析は行いません。

## 検証

データモデルのテスト（追加インストール不要）：

```powershell
node --test tests/model.test.js
```

ブラウザの統合テストは、起動済みサーバーとPlaywright、Microsoft Edgeが必要です。Playwrightが解決できる環境なら：

```powershell
node tests/browser.mjs
```

別の場所にPlaywrightがある場合は、その `index.mjs` の絶対パスを `PLAYWRIGHT_MODULE` に指定してください。`BROWSER_CHANNEL`（既定 `msedge`）と `TEST_BASE_URL`（既定 `http://127.0.0.1:4173/`）も指定できます。テストは独立したブラウザコンテキストを使い、利用者の通常プロファイルには接続しません。スクリーンショットは無視対象の `test-results/` に出力します。

## 次の開発段階

- Step 3：利用者ファイルからの旅程JSON取込・プレビュー、予定の追加・編集・削除。
- Step 4：訪問の新規記録・編集、単発GPS取得、手入力、Googleマップ外部リンク。
- Step 5：JSONバックアップ、置換対象の確認、復元前退避、全件復元。
- オフライン：アプリ本体のService Workerキャッシュと更新制御。`sw.js` は予約ファイルで、現在は登録していません。
- Step 6：iPhone Safari実機・ホーム画面起動・GPS・JSONのファイル保存・通信断の確認。

実機のホーム画面追加や保存領域の扱いは未検証です。サンプルを使って動作を確認してください。公開・デプロイは別途明示承認後に行います。

## ファイル構成

```text
AGENTS.md                    開発・データ保護・テスト・公開ルール
index.html                   アプリの入口・サンプル確認ダイアログ
manifest.webmanifest         ホーム画面向け設定
sw.js                        オフライン実装用の予約（未登録）
assets/css/app.css           PC・スマートフォンの表示
assets/icons/                SVG、192/512px PNG、Apple用180px PNG
src/app.js                   起動・遷移・サンプル追加・エラー表示
src/model.js                 モデル・日時・表示用データ整形
src/storage.js               IndexedDB・検証付き追加
src/validation.js            データ・JSON外枠の検証
src/ui.js                    安全なDOM生成・共通表示
src/screens/home.js          旅行ホーム
src/screens/timeline.js      日別の予定・訪問記録
src/screens/review.js        訪問履歴
samples/hokkaido-2026.sample.json
scripts/serve.mjs            依存不要のローカルHTTPサーバー
tests/model.test.js          モデル・検証テスト
tests/browser.mjs            実ブラウザの保存・表示テスト
docs/data-format.md          データ形式の仕様
docs/test-checklist.md       実施結果と実機確認項目
package.json / .gitignore    開発用設定
```

`transfer.js`・`geolocation.js`・`maps.js` はそれぞれの実装段階で追加します。
