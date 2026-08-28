(function () {
  'use strict';

  var API_DEFAULT = 'https://api.pedalshield.app';
  var EXPLORER = 'https://mainnet.zcashexplorer.app/transactions/';
  var KM_PER_MILE = 1.609344;

  // Documented June 11 2026 outdoor ride — 492 m, paid on mainnet.
  // Used only when ?fixture=1 so the page can be reviewed without the ledger.
  var FIXTURE = {
    txid: '2a849aca04f9b9661ec826c22db97edfb988a22fc7ce7432a651abbc08b264ab',
    distance_meters: 492,
    verified: true,
    integrity_score: 0.94,
    payout_zat: 390,
    avg_speed_kmh: 9.8,
    explorer_url:
      'https://mainnet.zcashexplorer.app/transactions/2a849aca04f9b9661ec826c22db97edfb988a22fc7ce7432a651abbc08b264ab',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiBase() {
    var q = new URLSearchParams(location.search).get('api');
    if (q) return q.replace(/\/$/, '');
    return API_DEFAULT;
  }

  function txidFromLocation() {
    var params = new URLSearchParams(location.search);
    if (params.get('txid')) return params.get('txid').trim().toLowerCase();
    var parts = location.pathname.replace(/\/+$/, '').split('/');
    var idx = parts.lastIndexOf('proof');
    if (idx >= 0 && parts[idx + 1] && parts[idx + 1] !== 'index.html') {
      return parts[idx + 1].trim().toLowerCase();
    }
    return '';
  }

  function isHexTxid(id) {
    return /^[0-9a-f]{64}$/.test(id);
  }

  function formatDistance(meters) {
    var km = meters / 1000;
    var mi = km / KM_PER_MILE;
    if (km < 1) {
      return { primary: meters + ' m', alt: mi.toFixed(2) + ' mi' };
    }
    return { primary: km.toFixed(2) + ' km', alt: mi.toFixed(2) + ' mi' };
  }

  function formatZec(zat) {
    if (zat == null || !(zat > 0)) return null;
    var s = (zat / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    return s + ' ZEC';
  }

  function explorerUrl(txid) {
    return EXPLORER + txid;
  }

  function setStatus(html) {
    $('receipt').hidden = true;
    $('empty').hidden = true;
    $('status').hidden = false;
    $('status').innerHTML = html;
  }

  function showEmpty() {
    $('receipt').hidden = true;
    $('status').hidden = true;
    $('empty').hidden = false;
    document.title = 'Ride proof — Pedalshield';
  }

  function renderProof(proof, opts) {
    opts = opts || {};
    $('status').hidden = true;
    $('empty').hidden = true;
    $('receipt').hidden = false;

    var dist = formatDistance(proof.distance_meters || 0);
    $('dist').textContent = dist.primary;
    $('dist-alt').textContent = dist.alt;

    $('status-val').textContent = proof.verified ? 'Verified' : 'Unverified';
    $('status-val').className = 'val' + (proof.verified ? ' ok' : '');

    $('integrity').textContent =
      proof.integrity_score != null ? Number(proof.integrity_score).toFixed(2) : '—';

    $('speed').textContent =
      proof.avg_speed_kmh != null ? Number(proof.avg_speed_kmh).toFixed(1) + ' km/h' : '—';

    var payout = formatZec(proof.payout_zat);
    $('payout').textContent = payout || '—';
    $('payout').className = 'val' + (payout ? ' ok' : '');

    var txid = proof.txid || '';
    $('txid').textContent = 'txid ' + txid;
    var expl = proof.explorer_url || explorerUrl(txid);
    $('explorer-link').href = expl;

    $('fixture-banner').hidden = !opts.fixture;
    $('partial-banner').hidden = !opts.partial;

    document.title = dist.primary + ' verified — Pedalshield';
  }

  function renderUnknownTxid(txid) {
    renderProof(
      {
        txid: txid,
        distance_meters: 0,
        verified: false,
        explorer_url: explorerUrl(txid),
      },
      { partial: true },
    );
    $('dist').textContent = '—';
    $('dist-alt').textContent = 'Attested stats not in the Pedalshield ledger yet';
    document.title = 'Ride proof — Pedalshield';
  }

  async function main() {
    var params = new URLSearchParams(location.search);
    if (params.get('fixture') === '1') {
      renderProof(FIXTURE, { fixture: true });
      return;
    }

    var txid = txidFromLocation();
    if (!txid) {
      showEmpty();
      return;
    }
    if (!isHexTxid(txid)) {
      setStatus('<p class="muted">That does not look like a Zcash transaction id (64 hex characters).</p>');
      return;
    }

    setStatus('<p class="muted">Looking up the attested ride…</p>');
    try {
      var res = await fetch(apiBase() + '/proof/' + encodeURIComponent(txid), {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 404) {
        renderUnknownTxid(txid);
        return;
      }
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      var proof = await res.json();
      renderProof(proof);
    } catch (err) {
      renderUnknownTxid(txid);
      $('partial-banner').textContent =
        'Could not reach the Pedalshield ledger. The explorer link still proves whether money moved.';
      $('partial-banner').hidden = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
