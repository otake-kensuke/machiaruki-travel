export function mapsUrl({ location = null, name = '', address = '' }) {
  const coordinates = location && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;
  const query = coordinates ? `${location.latitude},${location.longitude}` : [name, address].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()).join(' ');
  if (!query) return null;
  const make = value => `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: value })}`;
  if (make(query).length <= 2048) return make(query);
  // Keep within the documented Maps URLs limit without splitting Unicode characters.
  const characters = Array.from(query);
  let low = 1;
  let high = characters.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (make(characters.slice(0, mid).join('')).length <= 2048) low = mid;
    else high = mid - 1;
  }
  return make(characters.slice(0, low).join(''));
}
