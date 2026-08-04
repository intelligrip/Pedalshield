/**
 * Plain-language copy for verification outcomes.
 *
 * This is the deterministic layer, and it is the PRIMARY one — most devices
 * cannot run the on-device model, so this text is what most riders read.
 * The language model only rewrites this into something warmer when it
 * happens to be available. If you improve rider-facing wording, improve it
 * HERE; the model has nothing to work from otherwise.
 *
 * TONE RULES, deliberately chosen:
 *  - Never accuse. A flag is what the sensors saw, not a verdict on the
 *    person. Almost every flag has an innocent cause, and the founder's own
 *    genuine rides were rejected twice during July before the engine learned
 *    that lesson.
 *  - Always say what happens to their money.
 *  - Always give something actionable, or say plainly that there's nothing
 *    they did wrong.
 *
 * A rider who understands why a ride went to review is a rider who stays. A
 * silent black box that quietly pays less is how you lose people — and it's
 * the difference between a product a university will buy and one it won't.
 */

import type { FlagCode, RideStatus } from '../verification/types.ts';

export interface FlagExplanation {
  /** One-line summary of what the sensors saw. */
  what: string;
  /** The most common innocent cause. */
  why: string;
  /** What the rider can do, or null when there's nothing to fix. */
  fix: string | null;
}

export const FLAG_COPY: Record<FlagCode, FlagExplanation> = {
  TELEPORT: {
    what: 'Part of your route jumped further than a bike could travel.',
    why: 'Usually a GPS glitch under tree cover, in a canyon, or when the phone reacquires signal after a tunnel or a cold start.',
    fix: 'Nothing you did wrong. We removed the impossible stretch and paid you for the rest of the ride.',
  },
  SPEED_OUT_OF_BAND: {
    what: 'Sustained speeds were faster than a bicycle.',
    why: 'This normally means the ride was recorded in a vehicle, or a long descent was mixed with a drive home.',
    fix: 'Start a new ride once you are back on the bike, so a drive is never part of the same recording.',
  },
  NO_VIBRATION: {
    what: 'The phone never picked up road buzz.',
    why: 'A well-damped mount, a padded bag, or a very smooth indoor surface can absorb the vibration a road normally produces.',
    fix: 'Carrying the phone in a jersey pocket or a firmer mount gives the sensors more to work with.',
  },
  NO_CADENCE: {
    what: 'No pedalling rhythm was detectable.',
    why: 'A phone loose in a backpack or pannier smears the regular motion of pedalling into noise.',
    fix: 'A pocket or handlebar mount makes cadence much easier to detect.',
  },
  WALKING_DETECTED: {
    what: 'The pace and step pattern looked like walking.',
    why: 'Long walked sections — a steep hill, a busy crossing, a bike path detour — can outweigh the ridden part of a short trip.',
    fix: 'Walked distance does not earn, but the ridden portion still does.',
  },
  GPS_NOISY: {
    what: 'GPS accuracy was poor for most of the ride.',
    why: 'Dense tree cover, tall buildings, or a phone kept inside a bag all weaken the signal.',
    fix: 'Giving the phone a clearer view of the sky improves accuracy, and your score with it.',
  },
  SPARSE_SAMPLES: {
    what: 'Too few sensor readings were recorded.',
    why: 'Low Power Mode, or iOS suspending the app, can throttle location and motion updates mid-ride.',
    fix: 'Turning off Low Power Mode before a ride keeps the recording continuous.',
  },
  TOO_STRAIGHT: {
    what: 'The route was near-perfectly straight and held an unusually constant speed.',
    why: 'Real rides vary. Both signals together look generated — though a flat rail trail with a tailwind can come close.',
    fix: 'Nothing to change if this was a genuine straight-road ride; the score accounts for it.',
  },
  NO_ATTESTATION: {
    what: 'This device has not completed hardware attestation.',
    why: 'Attestation needs a recent iPhone and an App Store build. Older hardware simply cannot produce it.',
    fix: 'Not something you can fix, and it does not stop you earning.',
  },
  NO_MOTION_DATA: {
    what: 'No motion or fitness data was available.',
    why: 'Motion & Fitness permission is off, so cadence and vibration could not be checked at all.',
    fix: 'Enabling Motion & Fitness in Settings gives your rides more evidence and a higher score.',
  },
  GPS_SYNTHETIC: {
    what: 'The location track had far more glitches than a real GPS produces.',
    why: 'A handful of spikes is normal. A track made mostly of them usually means location was being simulated.',
    fix: 'If you use a location-spoofing or developer tool, turn it off before riding.',
  },
  RIDE_TOO_SHORT: {
    what: 'The ride was too short to verify.',
    why: 'Very short recordings do not contain enough evidence to tell riding apart from a phone moving around.',
    fix: 'Rides over about a third of a kilometre and two minutes can be verified.',
  },
  STATIONARY: {
    what: 'The distance accumulated without really going anywhere.',
    why: 'A stationary phone gathers GPS jitter that adds up to real-looking distance inside a very small area.',
    fix: 'Nothing to fix if you were riding — but a trainer or stationary bike cannot be verified this way.',
  },
  SENSOR_INCOHERENT: {
    what: 'The motion sensors did not line up with the route.',
    why: 'When a bike turns, the phone rotates; when it speeds up, road buzz rises. Those did not match here — often because the phone was held very still, or was somewhere isolated from the bike.',
    fix: 'Carrying the phone on your body or the bike itself keeps the sensors in agreement.',
  },
};

/** Headline for each outcome. Kept short — the detail lives in the flags. */
export const STATUS_COPY: Record<RideStatus, { title: string; body: string }> = {
  verified: {
    title: 'Ride verified',
    body: 'The physics checked out and your full verified distance earned.',
  },
  review: {
    title: 'Ride in review',
    body: 'Most of this ride looked right, but something was unclear — so it earned a reduced amount rather than being turned away.',
  },
  rejected: {
    title: 'Ride not verified',
    body: 'This recording did not show a bike ride the engine could confirm.',
  },
};
