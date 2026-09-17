import { useEffect } from 'react';
import { getSiteOrigin } from '../config/site.js';

// The project has no react-helmet (or similar) dependency, so this small
// component manages the document head directly. It sets the page <title>,
// meta description, robots directive and a canonical link, and cleans up the
// tags it owns on unmount so a later page never inherits a stale canonical or
// a `noindex` left behind. Works identically in a normal browser and inside
// the Android WebView wrapper (both are just a DOM).
//
// Notes on SEO: this is a client-rendered SPA. Search engines that execute
// JavaScript (Google, Bing) read these tags after render; index.html also
// carries a baseline description for crawlers that don't. Nothing here is
// required for the page to be readable without JavaScript in the WebView —
// that only matters for crawlers, and the WebView always runs JS.

const MANAGED = 'data-cc-seo';

function upsertMeta(name, content) {
  if (content == null) return;
  let tag = document.head.querySelector(`meta[name="${name}"][${MANAGED}]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    tag.setAttribute(MANAGED, 'managed');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function upsertCanonical(href) {
  let link = document.head.querySelector(`link[rel="canonical"][${MANAGED}]`);
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    link.setAttribute(MANAGED, 'managed');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

export default function Seo({ title, description, path = '/', robots = 'index, follow' }) {
  useEffect(() => {
    document.title = title;

    upsertMeta('description', description);
    upsertMeta('robots', robots);

    const origin = getSiteOrigin();
    if (origin) upsertCanonical(`${origin}${path}`);

    return () => {
      // Remove only the tags this component created.
      document.head.querySelectorAll(`[${MANAGED}]`).forEach((el) => el.remove());
    };
  }, [title, description, path, robots]);

  return null;
}
