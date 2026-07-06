/**
 * Metro config (open source, MIT).
 *
 * One job beyond the Expo defaults: make the PROPRIETARY verification
 * engine optional at BUILD time. `verification/engine.ts` does a literal
 * require of `../verification-private/engine.ts` so Metro can statically
 * bundle the real engine into real builds. But that directory is absent in
 * the public repo (gitignored — see the repo README), and Metro fails hard
 * on unresolvable literal requires. This resolver redirects that one
 * specifier to the open stub whenever the private engine is not on disk,
 * so a fork/clone builds and runs against the published contract.
 *
 * Real build  → private dir present  → real engine bundled → rides verify.
 * Public fork → private dir absent   → stub bundled        → rides 'review'.
 */

const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);

const PRIVATE_ENGINE = path.join(
  __dirname,
  'src',
  'verification-private',
  'engine.ts',
);
const OPEN_STUB = path.join(__dirname, 'src', 'verification', 'stub.ts');
const havePrivateEngine = fs.existsSync(PRIVATE_ENGINE);

// eslint-disable-next-line no-console
console.log(
  `[pedalshield] anti-cheat engine: ${havePrivateEngine ? 'PROPRIETARY (real)' : 'open stub'}`,
);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    !havePrivateEngine &&
    moduleName.includes('verification-private/engine')
  ) {
    return { type: 'sourceFile', filePath: OPEN_STUB };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
