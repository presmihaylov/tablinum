// Paint the stored theme before first paint so the app never flashes the wrong palette.
// A plain blocking script, not a module: a module is deferred, and the browser may paint the
// light background before it runs. Not inline either, so the CSP needs no script hash.
// The key and the JSON shape are what src/lib/storage.ts writes.
(function () {
  try {
    var mode = JSON.parse(localStorage.getItem('tablinum.theme'));
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    }
  } catch (err) {
    /* private mode, or a value we did not write: fall back to the system palette */
  }
})();
