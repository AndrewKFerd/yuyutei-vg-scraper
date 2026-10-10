// Apply the saved/OS theme before first paint so there's no flash of the
// wrong theme. Loaded as a plain (blocking) <script> from index.html's
// <head> rather than inlined, so the Content-Security-Policy in vercel.json
// can allow scripts from 'self' only. Mirrors src/theme.js — keep them in
// sync.
(function () {
  try {
    var t = localStorage.getItem('yuyutei:theme');
    var dark =
      t === 'dark' ||
      (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch {
    // storage blocked: React applies the OS preference once it loads
  }
})();
