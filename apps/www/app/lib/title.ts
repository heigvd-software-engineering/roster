import { useEffect } from "react";

/** The app's name, the last word of every tab title. */
const APP_NAME = "Roster";

/**
 * A tab title: what the page is, in as few words as a tab shows, then the app
 * name, separated by the middot the interface already uses ("Lab 3 · PRO ·
 * Roster"). Missing parts drop out, so a page still fetching its subject reads
 * "Roster" and never "undefined · Roster".
 */
export function pageTitle(...parts: (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => !!part), APP_NAME].join(
    " · ",
  );
}

/**
 * The tab title for a page whose subject only exists once fetched: the
 * assignment's title, the class's name. Everything a URL alone already knows
 * belongs in the route's `meta` export instead (`app/routes/*.tsx`), which
 * React Router renders declaratively. This hook exists for the rest, because
 * pages here fetch from the component with SWR, never from a loader, so no
 * `meta` function can see their data.
 *
 * Pass the same words the page's own heading shows, loading fallback included,
 * or the tab keeps the previous subject while the next one loads.
 */
export function useDocumentTitle(...parts: (string | null | undefined)[]) {
  const title = pageTitle(...parts);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
