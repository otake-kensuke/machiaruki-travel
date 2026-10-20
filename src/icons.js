const paths = {
  calendar: ['M5 4h14v17H5z', 'M8 2v5m8-5v5M5 9h14M8 13h3m2 0h3m-8 4h3'],
  list: ['M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01'],
  pin: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z', 'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  camera: ['M3 7h4l2-3h6l2 3h4v14H3z', 'M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  plane: ['m22 3-8 9 3 8-2 1-5-6-5 4-2-1 4-6-6-5 1-2 8 3 9-8Z'],
  bed: ['M3 4v18m18-10v10M3 18h18M7 7h5v7H7zM12 10h7l2 4H3'],
  arrow: ['M4 12h16m-6-6 6 6-6 6'],
  home: ['m2 11 10-9 10 9M5 9v12h14V9M9 21v-7h6v7'],
  diamond: ['m12 2 10 10-10 10L2 12Z'],
  file: ['M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8'],
  leaf: ['M21 3c-12-2-21 5-15 13 8 6 15-3 15-13ZM4 20 16 8']
};
export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'ui-icon' })) svg.setAttribute(key, value);
  for (const d of paths[name] || paths.pin) { const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
