/**
 * ZIP-321 Zcash payment request URIs — pure, on-device.
 *
 * Pedalshield's marketplace is NON-CUSTODIAL: when a rider buys something,
 * they pay the merchant DIRECTLY from their own wallet. The app just builds
 * the payment request (recipient + amount + a memo carrying the order id)
 * and hands it to the rider's wallet via a `zcash:` deep link. We never hold
 * funds and never touch keys.
 *
 * Format (ZIP-321): zcash:<address>?amount=<zec>&memo=<base64url(utf8)>
 */

/** Standard base64 of a byte array (no external deps; RN + Node safe). */
function bytesToBase64(bytes: number[]): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return out;
}

/** UTF-8 encode a string to bytes (no TextEncoder dependency). */
function utf8Bytes(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // surrogate pair
      const c2 = s.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

/** base64url (RFC 4648 §5) of a UTF-8 string — used for ZIP-321 memos. */
export function base64UrlMemo(memo: string): string {
  return bytesToBase64(utf8Bytes(memo))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Trim a ZEC amount to 8 decimals (zatoshi precision), no trailing zeros. */
function formatZecAmount(zec: number): string {
  const s = zec.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return s.length ? s : '0';
}

/**
 * Build a ZIP-321 `zcash:` payment URI the rider's wallet can open directly.
 * `address` must be the merchant's Unified/Sapling address; funds go straight
 * to them — Pedalshield is never in the path.
 */
export function buildZcashPaymentUri(
  address: string,
  amountZec: number,
  memo?: string,
): string {
  const params = [`amount=${formatZecAmount(amountZec)}`];
  if (memo && memo.length > 0) params.push(`memo=${base64UrlMemo(memo)}`);
  return `zcash:${address}?${params.join('&')}`;
}

/** A short, human-readable order id used as the payment memo. */
export function newOrderId(): string {
  const noise = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PSO-${noise}`;
}
