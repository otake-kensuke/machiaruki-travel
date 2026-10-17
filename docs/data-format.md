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
- 外部JSONの取込・書出UIはStep 3・5で追加します。現段階で外部ファイルを取り込むことはできません。
- サンプルは仮の訪問記録を含むため `backup` 形式です。サンプルボタンは追加専用で、置換を行いません。

## 共通ルール

すべてのエンティティに、変更されない `id`、オフセット付きISO日時の `createdAt`・`updatedAt` を持たせます。IDは全コレクションを通じて一意です。サンプルは固定ID、通常データは今後 `crypto.randomUUID()` で作成します。

日付は `YYYY-MM-DD`。日時は秒まで指定し、`Z` または `+09:00` などのオフセットを必須にします。日付ごとの表示は旅行の `timeZone` に従います。`memo` は任意の文字列です。

| 配列 | フィールド |
| --- | --- |
| trips | name, startDate, endDate, timeZone, memo?, isSample? |
| days | tripId, date, title |
| plans | tripId, dayId, startAt（日時またはnull）, name, category, address?, location, memo?, order（0以上の整数）, deletedAt?（日時またはnull） |
| transportations | tripId, mode, name, from, to, departureAt, arrivalAt, memo? |
| accommodations | tripId, name, address, checkInAt, checkOutAt, memo? |
| visits | tripId, planId（IDまたはnull）, visitedAt, name, memo?, location, locationSource |

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

予定を編集しても訪問記録は変更しません。予定を削除する場合は `deletedAt` を付けて非表示にし、参照は保持します。日付の違う訪問、削除済み予定の訪問も、その実際の訪問日に表示します。現段階では削除モデルとテストのみ実装し、削除UIはありません。

## 端末保存・失敗時の扱い

IndexedDB: `machiaruki-travel` / `workspace` / key `active`。

```text
{ schemaVersion: '1.0', revision: 1, updatedAt: ISO日時, data: 全6配列 }
```

未保存時は空データを返すだけでDBへサンプルを書き込みません。読み込みに失敗した場合も空データで既存値を置き換えません。追加は同一readwriteトランザクション内で最新値を取得・結合・検証・保存します。全件置換や削除APIは現在提供していません。

保存済みデータが未知形式・不整合なら、画面にエラーを表示して停止します。エラーを理由にDBを削除しません。全件復元の実装時には、復元前退避と利用者の明示確認を追加します。
