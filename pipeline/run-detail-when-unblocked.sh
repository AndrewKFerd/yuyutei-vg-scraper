#!/usr/bin/env bash
# Wait for yuyu-tei's rate-limit block to lift, then run the detail scrape.
#
# Probes with the same request signature scrape-card-detail.js actually
# sends (http-client.js's browserGet: full browser headers + a cookie jar),
# not a bare curl -- the site's defense is plausibly header/cookie based
# (see http-client.js's own header comment), so a minimal curl probe could
# read as unblocked while a real scrape session is still flagged, or the
# reverse.
cd "$(dirname "$0")"

probe() {
  node -e "
    const { createCookieJar, browserGet } = require('./http-client');
    (async () => {
      try {
        const res = await browserGet('https://yuyu-tei.jp/sell/vg/card/dbt01/10056', createCookieJar());
        console.log(res.status);
      } catch (err) {
        console.log(err.message);
      }
    })();
  "
}

unblocked=0
for i in $(seq 1 120); do
  result=$(probe)
  echo "probe $i: $result"
  if [ "$result" = "200" ]; then
    unblocked=1
    break
  fi
  sleep 60
done

if [ "$unblocked" -ne 1 ]; then
  echo "Still blocked after 120 probes (~2h). Not starting the scrape -- rerun this script later."
  exit 1
fi

sleep 30
echo "starting scrape-card-detail.js"
node scrape-card-detail.js
