import { COLLECTIONS } from './model.js';
import { DataError, validateData, validateEnvelope } from './validation.js';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

// Append independent trips only. No matching record is updated or merged.
export function dataForAddition(current, incoming) {
  validateData(current);
  validateData(incoming);
  if (!incoming.trips.length) throw new DataError(['追加する旅行がありません。']);
  const combined = Object.fromEntries(COLLECTIONS.map(key => [key, [...current[key], ...incoming[key]]]));
  validateData(combined);
  return combined;
}

export function parseItinerary(text, current) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new DataError(['旅程ファイルは2 MiB以下のJSONを選択してください。']);
  let envelope;
  try { envelope = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new DataError(['JSONを読み取れません。括弧・引用符・カンマなどの形式を確認してください。']); }
  if (envelope?.kind !== 'itinerary') throw new DataError(['旅程取込ではkindが「itinerary」のJSONを選択してください。バックアップの復元はStep 5で対応します。']);
  const data = validateEnvelope(envelope);
  dataForAddition(current, data);
  return data;
}
