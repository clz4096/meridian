/**
 * External links open in Safari, not the in-app browser. An iOS home-screen app
 * opens target=_blank links in an in-app browser sheet that blocks Meridian until
 * it is dismissed. iOS 17+ understands the `x-safari-https://` scheme, which hands
 * the URL to Safari itself and leaves Meridian usable. Everywhere else (desktop,
 * Android, a Safari tab) the browser already opens a separate tab, so this does
 * nothing there.
 */

/** True only inside an iOS home-screen app (`navigator.standalone` is iOS-only). */
export function isIosStandalone(nav: Navigator = navigator): boolean {
  return (nav as Navigator & { standalone?: boolean }).standalone === true;
}

/** The Safari hand-off URL for an off-site http(s) link, or null to leave it alone. */
export function safariHref(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin === origin || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  return 'x-safari-' + url.href;
}

export function installExternalLinks(): void {
  if (typeof window === 'undefined' || !isIosStandalone()) return;
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const to = safariHref(a.href, location.origin);
    if (!to) return;
    e.preventDefault();
    location.href = to;
  });
}
