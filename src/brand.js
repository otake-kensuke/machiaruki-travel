// Display-only identity. APP_ID, database name, JSON schema and public URL stay stable.
export const BRAND = { name: '旅あるき', subtitle: '予定も、寄り道も、旅のノートに。', themeColor: '#165b4b', backgroundColor: '#fffaf0' };

// Decoration only: switching scenery never changes a plan, destination or travel order.
export const SCENERY = {
  generic: { image: './assets/illustrations/generic.png', caption: '旅の風景イメージ' },
  hokkaido: { image: './assets/illustrations/hokkaido.png', caption: '函館と札幌の風景イメージ・旅程や訪問順とは無関係です' }
};
export function sceneryForTrip(trip) { return trip?.name.includes('北海道') ? 'hokkaido' : 'generic'; }
