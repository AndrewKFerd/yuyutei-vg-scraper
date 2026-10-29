// Apply the saved/OS theme before first paint so there's no flash of the
// wrong theme. Loaded as a plain (blocking) <script> from index.html's
// <head> rather than inlined, so the Content-Security-Policy in vercel.json
// can allow scripts from 'self' only. Mirrors src/ui/theme.js (and the
// theme-color values in src/ui/palette.js) — keep them in sync.
(function () {
  var dark = false;
  try {
    var t = localStorage.getItem('yuyutei:theme');
    dark =
      t === 'dark' ||
      (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    // storage blocked: React applies the OS preference once it loads
    return;
  }
  if (dark) document.documentElement.classList.add('dark');
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) {
    metas[i].setAttribute('content', dark ? '#151e28' : '#f3f6f9');
  }
})();
