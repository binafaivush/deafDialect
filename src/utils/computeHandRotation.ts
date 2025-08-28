import * as THREE from "three";

interface FingerRotation {
  Proximal: THREE.Euler;
  Intermediate: THREE.Euler;
  Distal: THREE.Euler;
}

export interface HandRotation {
  // wrist: THREE.Euler;
  Thumb: FingerRotation;
  Index: FingerRotation;
  Middle: FingerRotation;
  Ring: FingerRotation;
  Little: FingerRotation;
}

// Convert landmark to Vector3
const toVector3 = (pt?: { x: number; y: number; z: number }) =>
  pt ? new THREE.Vector3(pt.x, -pt.y, -pt.z) : new THREE.Vector3(0, 0, 0);

// Compute rotation (Euler) of a segment between three points
const computeSegmentEuler = (
  prev: THREE.Vector3,
  current: THREE.Vector3,
  next: THREE.Vector3
): THREE.Euler => {
  const vPrev = current.clone().sub(prev).normalize();
  const vNext = next.clone().sub(current).normalize();

  const axis = new THREE.Vector3().crossVectors(vPrev, vNext).normalize();
  const angle = vPrev.angleTo(vNext);

  if (axis.length() < 0.001 || isNaN(angle)) {
    return new THREE.Euler(0, 0, 0);
  }

  const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  return new THREE.Euler().setFromQuaternion(quat, "XYZ");
};

// Compute wrist rotation
const computeWrist = (landmarks: { x: number; y: number; z: number }[]) => {
  const wrist = toVector3(landmarks[0]);
  const indexBase = toVector3(landmarks[5]);
  const pinkyBase = toVector3(landmarks[17]);

  const handDirection = indexBase.clone().sub(pinkyBase).normalize();
  const forward = indexBase
    .clone()
    .add(pinkyBase)
    .multiplyScalar(0.5)
    .sub(wrist)
    .normalize();

  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    forward
  );

  if (handDirection.x < 0) {
    const correction = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, 0, Math.PI)
    );
    quat.multiply(correction);
  }

  return new THREE.Euler().setFromQuaternion(quat, "XYZ");
};

// Calculate rotations for a single finger
const calcFingerRotation = (
  indices: number[],
  landmarks: { x: number; y: number; z: number }[]
): FingerRotation => {
  const valid = indices.every((i) => landmarks[i]);
  if (!landmarks || !valid) {
    return {
      Proximal: new THREE.Euler(),
      Intermediate: new THREE.Euler(),
      Distal: new THREE.Euler(),
    };
  }

  const v0 = toVector3(landmarks[indices[0]]);
  const v1 = toVector3(landmarks[indices[1]]);
  const v2 = toVector3(landmarks[indices[2]]);
  const v3 = toVector3(landmarks[indices[3]]);

  return {
    Proximal: computeSegmentEuler(v0, v1, v2),
    Intermediate: computeSegmentEuler(v1, v2, v3),
    Distal: computeSegmentEuler(
      v2,
      v3,
      v3.clone().add(v3.clone().sub(v2))
    ),
  };
};

// Compute full hand rotation from landmarks
export const computeHandRotation = (
  landmarks: { x: number; y: number; z: number }[]
): HandRotation => {
  if (!landmarks || landmarks.length < 21) {
    return {
      // wrist: new THREE.Euler(),
      Thumb: { Proximal: new THREE.Euler(), Intermediate: new THREE.Euler(), Distal: new THREE.Euler() },
      Index: { Proximal: new THREE.Euler(), Intermediate: new THREE.Euler(), Distal: new THREE.Euler() },
      Middle: { Proximal: new THREE.Euler(), Intermediate: new THREE.Euler(), Distal: new THREE.Euler() },
      Ring: { Proximal: new THREE.Euler(), Intermediate: new THREE.Euler(), Distal: new THREE.Euler() },
      Little: { Proximal: new THREE.Euler(), Intermediate: new THREE.Euler(), Distal: new THREE.Euler() },
    };
  }

  return {
    // wrist: computeWrist(landmarks),
    Thumb: calcFingerRotation([0, 1, 2, 3], landmarks),
    Index: calcFingerRotation([0, 5, 6, 7], landmarks),
    Middle: calcFingerRotation([0, 9, 10, 11], landmarks),
    Ring: calcFingerRotation([0, 13, 14, 15], landmarks),
    Little: calcFingerRotation([0, 17, 18, 19], landmarks),
  };
};
