// Shared constants. The simulation uses its own coordinates:
//   x = across the street (positive is the batter's right as seen from behind),
//   y = up, z = distance down the street away from the batter.
// The 3D scene maps z to -z.

export const G = 9.81;
export const BALL_R = 0.075;

export const STREET = {
  halfW: 5,        // distance from the middle of the street to each house wall
  backZ: -7,       // wall behind the batter (the camera sits in front of it)
  endZ: 28,        // boundary wall at the far end
  endWallH: 1.5,
  backWallH: 2.6
};

export const PITCH = {
  stumpsZ: -0.6,
  idealZ: 0.75,    // where a well-timed bat meets the ball
  releaseZ: 12.5,
  releaseY: 1.75
};

// A ball that is stopped or fielded scores one run for each chalk line it crossed.
export const RUN_LINES = [9, 17, 23];

export const STUMPS = { halfW: 0.13, h: 0.72 };
export const WIDE_X = 1.05;

// Timing windows in seconds, measured from the ideal moment of contact.
export const TIMING = {
  lag: 0.07,       // time between the tap and the bat reaching the ball
  perfect: 0.034,
  good: 0.075,
  early: 0.125,
  late: 0.06
};

export const SUBSTEP = 1 / 240;
