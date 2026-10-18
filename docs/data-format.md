# データ形式 v1.0

アプリバージョン0.1、JSONスキーマバージョン `1.0`、IndexedDB構造バージョン `1` は別の番号です。スキーマの未知バージョンを暗黙に変換しません。

## JSON外枠

```json
{
  "appId": "machiaruki-travel",
  "schemaVersion": "1.0",
  "kind": "itinerary",
  "exportedAt": "2026-10-17T12:00:00+09:00",
  "data": {
    "trips": [],
    "days": [],
    "plans": [],
    "transportations": [],
    "accommodations": []
  }
}
```

- `itinerary` は訪問記録を含みません。内部では `visits: []` を補います。
- `backup` は `visits` 配列を必須にし、予定と実績の両方を含みます。
- 通常の旅程取込は旅行ホームから、kindがitineraryの2 MiB以下のファイルを確認して追加します。全件復元は別ボタンから、kindがbackupの20 MiB以下のファイルを選択します。
- サンプルは仮の訪問記録を含むため `backup` 形式です。サンプルボタンは追加専用で、置換を行いません。

## 共通ルール

すべてのエンティティに、変更されない `id`、オフセット付きISO日時の `createdAt`・`updatedAt` を持たせます。IDは全コレクションを通じて一意です。サンプルは固定ID、通常データは `crypto.randomUUID()` で作成します。

日付は `YYYY-MM-DD`。日時は秒まで指定し、`Z` または `+09:00` などのオフセットを必須にします。日付ごとの表示は旅行の `timeZone` に従います。`memo` は任意の文字列です。

| 配列 | フィールド |
| --- | --- |
| trips | name, startDate, endDate, timeZone, memo?, isSample? |
| days | tripId, date, title |
| plans | tripId, dayId, startAt（日時またはnull）, name, category, address?, location, memo?, order（0以上の整数）, deletedAt?（日時またはnull） |
| transportations | tripId, mode, name, from, to, departureAt, arrivalAt, memo? |
| accommodations | tripId, name, address, checkInAt, checkOutAt, memo? |
| visits | tripId, planId（IDまたはnull）, visitedAt, name, address?, memo?, location, locationSource |

`days` は同一旅行・日付に1件。予定の `dayId` は同じ旅行の日別データを参照し、時刻がある場合はその日付に一致させます。予定のcategoryは表示用の文字列で、サンプルは移動・散策・食事・観光です。

## 位置情報

```json
{
  "latitude": 43.0605,
  "longitude": 141.3509,
  "accuracy": 15,
  "capturedAt": "2026-10-30T14:12:00+09:00"
}
```

- `location` は地点未設定なら `null`。緯度は-90〜90、経度は-180〜180の有限数。
- 予定地点と訪問地点は独立した値です。予定地点をGPS取得結果としてコピーしません。
- `locationSource` は `gps`・`manual`・`none`。
- `gps` は緯度経度・0以上のaccuracy（m）・capturedAtを必須にします。
- `manual` は緯度経度を必須にします。`none` はlocationをnullにします。
- 施設名から座標を推測する機能や逆ジオコーディングはありません。

## 予定と実績

予定からの訪問では `visits.planId` に参照を保存し、施設名・メモ・訪問日時・地点を訪問記録自身に保存します。予定外の訪問は `planId: null`。同一予定の複数訪問を許容します。

予定を編集しても訪問記録は変更しません。予定を削除する場合は `deletedAt` を付けて非表示にし、参照は保持します。日付の違う訪問、削除済み予定の訪問も、その実際の訪問日に表示します。削除の確認画面では関連する訪問記録の件数と、履歴を保持することを表示します。

## 端末保存・失敗時の扱い

IndexedDB: `machiaruki-travel` / `workspace` / key `active`。

```text
{ schemaVersion: '1.0', revision: 1, updatedAt: ISO日時, data: 全6配列 }
```

未保存時は空データを返すだけでDBへサンプルを書き込みません。読み込みに失敗した場合も空データで既存値を置き換えません。追加・編集・削除済み設定は同一readwriteトランザクション内で最新値を取得・検証・保存します。全件置換はStep 5の復元専用手順に限定します。

保存済みデータが未知形式・不整合なら、画面にエラーを表示して停止します。エラーを理由にDBを削除しません。全件復元でも現在データの読み込み・検証・退避ができなければ置換を停止します。

## Step 3の取込・編集ルール

- 完全な旅程例は `samples/hokkaido-2026.itinerary.json`。同梱サンプルと同じIDなので、サンプル読込済みの端末への取込は拒否します。
- 旅行エージェントは新しい旅行に新しいIDを割り当て、days/plans/交通/宿泊の参照先を合わせてください。各レコードのcreatedAt/updatedAt、予定のorder/startAt/locationも必要です。時刻未定はstartAtをnull、地点未定はlocationをnullにします。
- 入力JSON内のID重複も、保存済みのどのコレクションとのID衝突も拒否します。既存旅行への差分取込や自動マージはしません。複数旅行入りのJSONは全件検証後に一括追加します。
- 更新日時が作成日時より前のデータ、文字列でない住所・メモ、data直下の未知コレクションも拒否します。日付・参照が不正なら一部だけ取り込みません。
- 取込プレビューは保存しません。ファイルを選び直すと前の候補を破棄し、キャンセル時も保存しません。最終保存時に最新のIndexedDBに対して再検証します。
- 予定編集は同じID・createdAtを維持し、updatedAtを更新します。入力にない予定地点などの情報も維持します。新規予定はIDと作成・更新日時を生成します。
- 日付は旅行期間内。予定の移動先の日別がなければ同じトランザクションで生成します。別の旅行への移動はできません。
- フォームの時刻は端末のタイムゾーンに依存せず旅行のtimeZoneで解釈します。日時の変更がなければ元の秒・オフセットを保持します。夏時間で存在しない/二通りある時刻は拒否して別時刻を案内します。
- 編集・削除の保存時に、画面を開いた時点の予定と現在の予定の内容を比較します。同じ予定が他のタブで変更・削除されていれば上書きせず、入力を保持してエラーを表示します。別の予定への変更は失いません。

## Step 4の訪問記録・GPS・外部リンク

- DBバージョン1、schemaVersion 1.0、6つのコレクションと既存レコードを維持します。訪問のaddressは任意の文字列で、従来のaddressがない記録もそのまま読み込めます。新規記録では予定の施設名・住所を初期入力にし、確認後に訪問側へ独立して保存します。
- 予定からの記録はplanIdで関連付け、予定外はnullです。予定地点や予定メモをGPS実績へコピーしません。単発のGPSが失敗すればlocation=null、locationSource=noneで保存します。
- visitedAtは実際の訪問日時です。開始時の現在時刻を初期値とし、旅行のtimeZoneで入力・編集します。時刻を変えなければ秒・ミリ秒も保持します。location.capturedAtはGPS側の取得日時で、visitedAtとは独立です。
- getCurrentPositionは記録開始または利用者の明示再取得時のみ呼びます。enableHighAccuracy=true、maximumAge=0、timeout=12000ms。JavaScript側にも同じ期限を設け、許可待ち等でもUIは止めません。
- 「内容を確認」で候補データと地点を固定します。確認・閉じる・再取得の後に届いた古い結果は無視します。単発API自体の中断やwatchPositionによる追跡は行いません。
- 訪問編集はID・createdAt・tripId・planId・location・locationSourceを保持し、名称・日時・住所・メモだけ変更してupdatedAtを更新します。編集時は再測位しません。同じ記録が別タブで変更された場合は拒否します。
- 新規訪問・編集とも最新データを読む同じIndexedDBトランザクションで検証・保存し、oncomplete後だけ成功表示します。保存エラーでは入力・確認候補を保持します。訪問の削除機能はありません。Step 4の操作では全件置換しません。
- 入力中に元の予定が削除済みになっても、その予定が同じ旅行に存在していれば開始済みの訪問を関連付けて保存できます。参照先そのものがなければ保存せず入力を残します。
- 旅行期間外の実際の訪問も許容します。日付切替は保存済みdaysと訪問日を合わせて表示し、daysデータ自体を改変しません。予定にない日の実績や削除済み予定の実績も表示します。
- Maps URLsは固定のhttps://www.google.com/maps/search/へapi=1とqueryを渡します。座標があればその緯度経度、なければ訪問側の施設名・住所を使用します。予定側の地点・更新後の住所で過去の実績を代用しません。
- URLは文字列をエンコードし、2048文字以内に収めます。ボタンを押した場合のみ外部へ開き、noopener/noreferrerを指定します。APIキー、地図埋込、自動施設名検索はありません。

位置APIとリンクの仕様：[MDN getCurrentPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)、[Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)。

## Step 5のバックアップ・全件復元

- `backup` のdataは全6配列を必須にします。空データでも各配列を省略しません。選択中の旅行だけに絞らず、削除済み予定も含め、ID・参照・日時・GPS情報を変換せず出力します。
- 出力・復元の上限はUTF-8で20 MiB。通常の旅程取込の2 MiBとは別です。出力不能なサイズなら準備・置換を中止し、復元できないファイルを作りません。JSON構文、appId、kind、schemaVersion、exportedAt、全件の必須項目・型・日付・座標・ID・参照を検証します。
- ファイル名は `machiaruki-travel-backup-<UTC日時>.json`、復元前退避は `machiaruki-travel-before-restore-<UTC日時>.json`。旅行名や個人情報はファイル名に含めません。生成ファイルは.gitignoreの対象です。
- JSON Fileを事前に作り、共有対応端末では利用者のクリック内で `navigator.share({files})` を直接呼びます。`navigator.canShare` で非対応ならダウンロードのみ表示します。共有失敗・キャンセルから勝手にダウンロードへ切り替えません。
- ダウンロードはBlob URLとdownload属性を使います。出力日時はJSONの作成時刻、ホームの最終出力操作日時は要求/受渡し時刻です。どちらもファイルの保存成功や端末外への保存を示しません。

DB構造バージョン1・schemaVersion 1.0のまま、既存workspaceストアに次のキーを追加します。これらはローカル管理情報で、バックアップのdataには含めません。

| キー | 内容 |
| --- | --- |
| active | 既存の全6配列・revision・updatedAt。通常保存と同じ形式 |
| backup-status | exportedAt、requestedAt、method、filename、sourceRevision、purpose、saveVerified:false |
| restore-pending | 一意な退避準備ID、sourceRevision、現在データの退避JSON、復元候補data、準備日時、出力操作記録 |
| restore-previous | 直前の復元前の退避JSON・sourceRevision・置換日時（1世代） |

methodは `download-requested` または `share-handed-off`。共有キャンセルや出力失敗では履歴を書きません。出力履歴のみの変更ではactiveのrevisionを上げません。出力元revisionと現在revisionが異なる場合は、再出力が必要な旨を表示します。

復元の順序：

1. ファイル全件を検証し、復元前後の全旅行名・日程・6配列件数を表示。ファイル選択だけではactiveを変更しません。
2. 最新activeがプレビュー時点とrevision・内容とも一致することを確認し、退避JSONを生成。readwriteトランザクション内でも再照合してrestore-pendingへ保存します。
3. 退避ファイルの出力操作後、最新active・退避準備ID・退避JSONの一致を同一トランザクションで確認して出力記録を付けます。出力や記録保存が失敗したら置換はできません。
4. 利用者が保存先で退避ファイルを開き、保存・内容確認および全件置換の2つを明示確認します。この確認は利用者の申告であり、OSによる保存成功の証明ではありません。
5. 復元専用APIも出力記録と両確認を必須にし、最新active・退避準備IDを再照合します。単一readwriteトランザクションでrestore-previousを保存、activeをrevision+1で置換、restore-pendingを削除します。oncomplete後だけ成功し、失敗なら全キーを巻き戻します。

プレビュー・退避・出力後に別タブでデータが変われば停止します。別の復元準備に置き換わった場合も停止します。復元と並行する通常保存は同じストアのトランザクション順に処理され、先行した変更を古い退避状態で消しません。自動マージは行いません。

restore-previousは同じ端末保存領域にあり、外部バックアップの代わりにはなりません。直前の退避JSONを出力画面から再取得できます。未完了のrestore-pendingを起動時に自動実行する処理はありません。

ファイル出力仕様：[MDN Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)、[MDN canShare](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare)、[MDN download属性](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#download)。共有のPromise完了も保存先への永続化完了とは限らないため、アプリは保存完了と表示しません。
