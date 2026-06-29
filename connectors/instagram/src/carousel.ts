/**
 * Carousel (multi-slide post) DOM affordances.
 *
 * Instagram renders only the visible slide(s) of a carousel, so a single
 * extraction captures just the current slide's media (RCA-7). Walking every
 * slide requires advancing the carousel and re-reading the DOM between slides.
 *
 * Per the layer split, the connector owns the *selectors* (Instagram DOM
 * knowledge); the content-script Navigator owns the click + wait *mechanics*.
 */

/**
 * Finds the carousel "Next" control within `scope`, or `null` on the last slide
 * (Instagram removes the Next button there — the natural end-of-carousel
 * signal). Scoped to the post element so it never grabs a different post's
 * control on the home feed.
 */
export function findCarouselNext(scope: ParentNode = document): HTMLElement | null {
  // Preferred: an explicit Next button.
  const button = scope.querySelector<HTMLElement>('button[aria-label="Next"]');
  if (button) return button;

  // Fallback: a labelled icon — click its nearest button / role=button ancestor.
  const icon = scope.querySelector('svg[aria-label="Next"], [aria-label="Next"]');
  if (!icon) return null;
  const clickable =
    icon.closest('button') ?? (icon.closest('[role="button"]') as HTMLElement | null);
  return clickable ?? (icon as HTMLElement);
}
