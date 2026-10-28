// The dashboard is one big template literal. A stray backslash or `${` in the
// source is silently rewritten when the literal is evaluated, so the page can
// ship syntactically-broken JavaScript while the template file itself parses.
// This compiles the generated inline script — the check that catches it.
const assert = require('assert');
const getDashboardHTML = require('../src/api/dashboard-template');

function inlineScript(html) {
  // Case-insensitive on purpose: CodeQL's js/bad-tag-filter is right that a
  // bare /<script>/ would miss <SCRIPT>. No attribute wildcard, though — the
  // page also loads Chart.js via <script src=...>, and matching that would
  // splice two script bodies together.
  const m = html.match(/<script>([\s\S]*)<\/script>/i);
  return m ? m[1] : null;
}

module.exports = {
  name: 'dashboard template',

  tests: [
    {
      name: 'renders the dashboard shell',
      fn: async () => {
        const html = getDashboardHTML();
        assert.ok(html.startsWith('<!DOCTYPE html>'));
        assert.ok(html.includes('id="dashboardView"'));
        assert.ok(html.includes('id="ordersView"'));
        assert.ok(html.includes('id="marketingView"'));
      }
    },
    {
      name: 'renders the reviews view with its controls',
      fn: async () => {
        const html = getDashboardHTML();
        for (const id of ['reviewsView', 'reviewRating', 'reviewReplied', 'reviewPeriod',
          'reviewSearch', 'reviewSummary', 'reviewList', 'reviewPagination', 'reviewLightbox']) {
          assert.ok(html.includes('id="' + id + '"'), 'missing #' + id);
        }
        assert.ok(html.includes('data-view="reviews"'), 'nav item missing');
      }
    },
    {
      name: 'the generated inline script compiles',
      fn: async () => {
        const script = inlineScript(getDashboardHTML());
        assert.ok(script && script.length > 1000, 'no inline script found');
        // Compiles the body without executing it — a syntax error throws here.
        assert.doesNotThrow(() => new Function(script));
      }
    },
    {
      name: 'regex literals survive template evaluation',
      fn: async () => {
        const script = inlineScript(getDashboardHTML());
        // The photo guard needs a real https:// regex; escaped-to-death versions
        // parse but never match, which is invisible without this assertion.
        assert.ok(script.includes('/^https:\\/\\//i'), 'photo URL https guard lost its escapes');
        assert.ok(script.includes('/\\.(jpe?g|png|webp|gif)(\\?|$)/i'), 'image extension guard mangled');
      }
    }
  ]
};
