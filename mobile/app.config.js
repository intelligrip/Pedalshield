// Build-time branding on top of app.json.
//
// APP_BRAND=ghost-commute (set by the `ghost-commute` profile in eas.json)
// installs as "Ghost Commute" with its own icon and permission prompts.
// Anything else, including unset, is the unchanged Pedalshield build.
//
// Bundle ID, slug, EAS project and update URL stay the same on purpose:
// this ships through the existing App Store Connect record and TestFlight,
// with no new app or App Attest provisioning. One consequence: on a phone,
// the Ghost Commute build REPLACES the Pedalshield build (same bundle ID).
export default ({ config }) => {
  if (process.env.APP_BRAND !== 'ghost-commute') return config;

  const NAME = 'Ghost Commute';
  const ICON = './assets/ghost-commute-icon.png';
  const BG = '#05070B'; // Fogline near-black
  const rebrand = (v) => JSON.parse(JSON.stringify(v).replace(/Pedalshield/g, NAME));

  return {
    ...config,
    name: NAME,
    icon: ICON,
    splash: { ...config.splash, image: ICON, backgroundColor: BG },
    ios: { ...config.ios, infoPlist: rebrand(config.ios.infoPlist) },
    android: { ...config.android, adaptiveIcon: { foregroundImage: ICON, backgroundColor: BG } },
    plugins: rebrand(config.plugins),
    extra: { ...config.extra, brand: NAME },
  };
};
