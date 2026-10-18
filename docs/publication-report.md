# GitHub Pages 公開報告

実施日：2026年10月18日（日本時間）。利用者によるPublic化・Pages公開の明示承認に基づいて実施。

公開URL：[街歩きラボ](https://otake-kensuke.github.io/machiaruki-travel/)

リポジトリ：[otake-kensuke/machiaruki-travel](https://github.com/otake-kensuke/machiaruki-travel)

## 公開前の安全確認

公開前の基準は `ce711c0`。初期の5コミット、57追跡ファイル、および履歴・参照外も含むローカルGit全104 blobを検査しました。公開準備コミット `bc130d5` までの6コミット・60追跡ファイル・112 blobでも再検査し、公開を止める問題は検出しませんでした。

- APIキー・サービスのトークン・秘密鍵・認証値のパターン検査、ファイル名の検査：検出なし。
- 実際の予約番号・個人メール・電話・利用者ローカルパスのパターン検査とサンプル内容確認：問題なし。コミットのauthor/committerはGitHubのnoreply形式。コミットメッセージも検査しました。
- PNGのEXIFやテキストメタデータも検査し、個人情報を含み得るメタデータはありません。
- 同梱JSONはisSample=true。交通は「サンプル時刻・予約なし」、宿泊は「施設未定」「予約はありません」、訪問は「仮の記録」「架空」を明記。施設の公開地点と仮設定であり、実際の予約・利用者の訪問履歴は含みません。
- 個人バックアップ、exports、local-data、テスト用ブラウザプロファイルは追跡していません。.gitignoreで通常の出力JSONと復元前退避JSONも除外しています。削除済みの過去ファイルもGit blobとして検査しています。
- IndexedDB保存処理、fetch、外部リンク、共有処理、Service Workerを確認。アプリのfetchは同梱ファイル取得のみ。旅行/訪問データをGitHubへアップロードする処理はありません。Googleマップ・OS共有への受渡しは利用者の明示操作のみです。

検査スクリプトは `node scripts/audit-publication.mjs`。一致した認証値そのものを表示せず、分類と場所だけを報告します。パターン検査とコード・データ内容の確認を併用しました。

## 公開設定

`otake-kensuke/embassy-stamp-rally` の設定を読み取り、同じブランチ配信方式にしました。参照先リポジトリは変更していません。

| 項目 | 設定・確認結果 |
| --- | --- |
| リポジトリ | Public。匿名REST APIでも取得可能 |
| Pages方式 | legacy（Deploy from a branch） |
| 公開元 | mainブランチのルート `/` |
| URL | https://otake-kensuke.github.io/machiaruki-travel/ |
| HTTPS | 強制有効。証明書エラーを無視せずHTTPS 200を確認 |
| HTTPアクセス | HTTPSへの301転送を確認 |
| カスタムドメイン | なし |
| 初回配信確認コミット | bc130d5194b946abaf77aae675f2fa2f1d929019（Pages builtを確認） |

`.nojekyll` を追加し、静的ファイルをJekyllの変換に依存せず配信します。アセットの相対パスとService Workerのサブディレクトリscopeを維持しています。画面の版表示を「端末保存」にし、Service Workerの内容hashと版を更新しました。

## 公開サイトの検証結果

ローカルのNodeテスト55件が成功。公開HTTPSサイトは、通常の利用者プロファイルと分離したWindows Edgeで架空データだけを使い、以下の8項目がすべて成功しました。

1. HTTPSのサブディレクトリで起動し、初回データ未書込、オフライン準備完了、scopeが `/machiaruki-travel/` であること。
2. サンプルの明示追加、旅行ホーム・予定/実績・振り返りの表示。
3. 架空の旅程JSONをプレビューし、確認前は未変更、確定後に追加し既存訪問を保持。
4. 予定編集を保存し、再読込後も全データを保持。
5. 予定から座標なし訪問を保存し、振り返りとGoogleマップのオンライン依存表示を確認。
6. 実際のJSONダウンロード内容が全データと一致。復元前の退避JSONも一致し、明示確認後の全件復元でID・日時・参照・全データが一致。
7. 通常のHTTPキャッシュを無効にし、オフライン起動→訪問保存→ウィンドウ再起動→オンライン復帰でデータを維持。
8. PCおよび390px/320px幅で表示を確認。横はみ出し・ページ例外なし。実際のHTTP(S)要求は公開アプリ内のファイルのGET/HEADだけで、本文や記録内容・クエリによるデータ送信なし。

Edgeのダウンロード画面に由来するedge://等の内部リソースは、HTTP(S)の通信とは区別して検証しています。

配信ファイルはアプリ本体の33アセットすべてがHTTP 200かつSHA-256一致。HTML・CSS・JavaScript・PNGアイコンの配信形式とService WorkerのJavaScript MIMEを確認しました。Service Worker本体もローカルと一致し、公開版のキャッシュIDは `455d429452d833467edb` です。

再実行：PlaywrightとEdgeが利用可能な環境で `node tests/public-site-browser.mjs`。実際の公開URLでテストしますが、架空データは独立した端末内保存領域にだけ保存します。

## 変更ファイル

- `.nojekyll`：静的配信を明示。
- `index.html`、`sw.js`：版表示と内容hash/版を更新。
- `AGENTS.md`、`README.md`：今回の公開承認、公開URL、公開後の利用/開発方針。
- `scripts/audit-publication.mjs`：公開前の全ファイル/全Gitオブジェクト監査。
- `tests/public-site-browser.mjs`：公開HTTPSサイトの主要操作・オフライン・通信検証。
- `package.json`：監査と公開サイト検証のコマンド。
- `docs/test-checklist.md`、`docs/publication-report.md`：確認結果と残課題。

## 残課題・利用前の確認

- iPhone実機のSafari・ホーム画面追加、機内モード起動、OS終了後の保持、実機GPS、ネイティブ共有と「ファイル」保存/復元は未検証。PCのスマートフォン幅検証は実機検証ではありません。
- ローカルURLと公開HTTPS URLの保存領域は別です。必要な旅行データはJSONで移行し、旅行前に利用する起動方法で保存・バックアップ・復元・オフライン動作を確認してください。
- 保存完了や端末外ファイルへの永続化はアプリから証明できません。外部のJSONを保存先で開き、内容を確認してください。
- 新版は入力保存後に全アプリタブ/ウィンドウを閉じて開き直す方式です。強制再読込はありません。

最終報告では、検証結果を記録したmainコミットのPushと、ローカル/GitHubのコミット一致を報告します。
