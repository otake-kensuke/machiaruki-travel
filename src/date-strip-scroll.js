// UI only: never change which days exist or which date is selected.
export function centerSelectedDate(strip, previous) {
  const selected = strip?.querySelector('[aria-current="date"]');
  if (!selected) return;
  const trip = href => new URLSearchParams(href?.split('?')[1]).get('trip');
  const sameTrip = Boolean(previous?.selected) && trip(previous.selected) === trip(selected.getAttribute('href'));
  const changingDate = sameTrip && previous.selected !== selected.getAttribute('href');
  if (sameTrip) strip.scrollLeft = previous.left;
  function center(animate) {
    if (!strip.isConnected) return;
    const box = strip.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    const desired = strip.scrollLeft + tab.left - box.left - strip.clientLeft
      + tab.width / 2 - strip.clientWidth / 2;
    const left = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, desired));
    strip.scrollTo({ left, behavior: animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
  }
  requestAnimationFrame(() => center(changingDate));
  // Reselecting the current tab does not fire hashchange, but should still center.
  strip.addEventListener('click', event => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      && event.target.closest('a') === selected) center(true);
  });
}
