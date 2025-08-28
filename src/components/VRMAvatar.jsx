import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useAnimations, useFBX, useGLTF } from "@react-three/drei";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { Face, Hand, Pose } from "kalidokit";
import { useControls } from "leva";
import { useSelector } from "react-redux";
import { Euler, Object3D, Quaternion, Vector3 } from "three";
import { lerp } from "three/src/math/MathUtils.js";

import { useVideoRecognition } from "../hooks/useVideoRecognition";
import { remapMixamoAnimationToVrm } from "../utils/remapMixamoAnimationToVrm";
import { computeHandRotation } from "../utils/computeHandRotation";

// --- Temp objects reused for performance ---
const tmpVec3 = new Vector3();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();

// --- Helper functions ---
const mirrorVector = ({ x, y, z }) => ({ x: -x, y: -y, z: -z });

const vector = (obj, x = 1, y = 1, z = 1) => ({
  x: obj.x * x,
  y: obj.y * y,
  z: obj.z * z,
});

const lerpExpression = (vrm, name, value, factor) => {
  vrm.expressionManager.setValue(
    name,
    lerp(vrm.expressionManager.getValue(name), value, factor)
  );
};

const rotateBone = (
  vrm,
  boneName,
  value,
  slerpFactor,
  flip = { x: 1, y: 1, z: 1 }
) => {
  if (!value) return;
  const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!bone) {
    console.warn(`Bone ${boneName} not found in VRM humanoid.`);
    return;
  }
  tmpEuler.set(value.x * flip.x, value.y * flip.y, value.z * flip.z);
  tmpQuat.setFromEuler(tmpEuler);
  bone.quaternion.slerp(tmpQuat, slerpFactor);
};

// --- Main component ---
export const VRMAvatar = ({ avatar, ...props }) => {
  // Load VRM
  const { scene, userData } = useGLTF(`models/${avatar}`, undefined, undefined, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser));
  });

  const currentVrm = userData.vrm;

  // Animation clips
  const assetA = useFBX("models/animations/Swing Dancing.fbx");
  const assetB = useFBX("models/animations/Thriller Part 2.fbx");
  const assetC = useFBX("models/animations/Breathing Idle.fbx");

  const animationClipA = useMemo(() => {
    const clip = remapMixamoAnimationToVrm(currentVrm, assetA);
    clip.name = "Swing Dancing";
    return clip;
  }, [assetA, currentVrm]);

  const animationClipB = useMemo(() => {
    const clip = remapMixamoAnimationToVrm(currentVrm, assetB);
    clip.name = "Thriller Part 2";
    return clip;
  }, [assetB, currentVrm]);

  const animationClipC = useMemo(() => {
    const clip = remapMixamoAnimationToVrm(currentVrm, assetC);
    clip.name = "Idle";
    return clip;
  }, [assetC, currentVrm]);

  const { actions } = useAnimations(
    [animationClipA, animationClipB, animationClipC],
    currentVrm?.scene
  );

  // VRM optimizations
  useEffect(() => {
    if (!userData.vrm) return;
    VRMUtils.removeUnnecessaryVertices(scene);
    VRMUtils.combineSkeletons(scene);
    VRMUtils.combineMorphs(userData.vrm);

    userData.vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });
  }, [scene, userData.vrm]);

  // Redux offsets
  const upperArmOffset = useSelector((s) => s.offset.upperArmOffset);
  const lowerArmOffset = useSelector((s) => s.offset.lowerArmOffset);
  const handOffset = useSelector((s) => s.offset.handOffset);

  // Kalidokit refs
  const riggedFace = useRef();
  const riggedPose = useRef();
  const riggedLeftHand = useRef();
  const riggedRightHand = useRef();

  // Video recognition
  const setResultsCallback = useVideoRecognition((s) => s.setResultsCallback);
  const videoElement = useVideoRecognition((s) => s.videoElement);

  const resultsCallback = useCallback(
    (results) => {
      if (!videoElement || !currentVrm) return;

      // Face
      if (results.faceLandmarks) {
        riggedFace.current = Face.solve(results.faceLandmarks, {
          runtime: "mediapipe",
          video: videoElement,
          imageSize: { width: 640, height: 480 },
          smoothBlink: false,
          blinkSettings: [0.25, 0.75],
        });
      }

      // Pose
      if (results.za && results.poseLandmarks) {
        const solved = Pose.solve(results.za, results.poseLandmarks, {
          runtime: "mediapipe",
          video: videoElement,
        });
        if (solved) {
          riggedPose.current = {
            ...solved,
            LeftUpperArm: mirrorVector(vector(solved.RightUpperArm, ...(upperArmOffset || [1, 1, 1]))),
            LeftLowerArm: mirrorVector(vector(solved.RightLowerArm, ...(lowerArmOffset || [1, 1, 1]))),
            LeftHand:     mirrorVector(vector(solved.LeftHand, ...(handOffset || [1, 1, 1]))),
            RightUpperArm: mirrorVector(vector(solved.LeftUpperArm, ...(upperArmOffset || [1, 1, 1]))),
            RightLowerArm: mirrorVector(vector(solved.LeftLowerArm, ...(lowerArmOffset || [1, 1, 1]))),
            RightHand:     mirrorVector(vector(solved.RightHand, ...(handOffset || [1, 1, 1]))),
          };
        }
      }

      // Hands
      if (results.rightHandLandmarks) {
        riggedRightHand.current = computeHandRotation(results.rightHandLandmarks);
      }
      if (results.leftHandLandmarks) {
        riggedLeftHand.current = computeHandRotation(results.leftHandLandmarks);
      }
    },
    [videoElement, currentVrm, upperArmOffset, lowerArmOffset, handOffset]
  );

  useEffect(() => {
    setResultsCallback(resultsCallback);
  }, [resultsCallback, setResultsCallback]);

  // Controls
  const {
    aa, ih, ee, oh, ou,
    blinkLeft, blinkRight,
    angry, sad, happy,
    animation,
  } = useControls("VRM", {
    aa: { value: 0, min: 0, max: 1 },
    ih: { value: 0, min: 0, max: 1 },
    ee: { value: 0, min: 0, max: 1 },
    oh: { value: 0, min: 0, max: 1 },
    ou: { value: 0, min: 0, max: 1 },
    blinkLeft:  { value: 0, min: 0, max: 1 },
    blinkRight: { value: 0, min: 0, max: 1 },
    angry: { value: 0, min: 0, max: 1 },
    sad:   { value: 0, min: 0, max: 1 },
    happy: { value: 0, min: 0, max: 1 },
    animation: {
      options: ["None", "Idle", "Swing Dancing", "Thriller Part 2"],
      value: "Idle",
    },
  });

  // Play animations
  useEffect(() => {
    if (animation === "None" || videoElement) return;
    actions[animation]?.play();
    return () => actions[animation]?.stop();
  }, [actions, animation, videoElement]);

  // LookAt setup
  const camera = useThree((s) => s.camera);
  const lookAtTarget = useRef();
  const lookAtDestination = useRef(new Vector3(0, 0, 0));
  useEffect(() => {
    lookAtTarget.current = new Object3D();
    camera.add(lookAtTarget.current);
  }, [camera]);

  // Frame loop
  useFrame((_, delta) => {
    if (!userData.vrm) return;

    const vrm = userData.vrm;

    // --- Expressions ---
    vrm.expressionManager.setValue("angry", angry);
    vrm.expressionManager.setValue("sad",   sad);
    vrm.expressionManager.setValue("happy", happy);

    if (!videoElement) {
      ["aa","ih","ee","oh","ou","blinkLeft","blinkRight"].forEach((n) =>
        lerpExpression(vrm, n, eval(n), delta * 5)
      );
    } else if (riggedFace.current) {
      const f = riggedFace.current;
      [
        { name: "aa",        value: f.mouth.shape.A },
        { name: "ih",        value: f.mouth.shape.I },
        { name: "ee",        value: f.mouth.shape.E },
        { name: "oh",        value: f.mouth.shape.O },
        { name: "ou",        value: f.mouth.shape.U },
        { name: "blinkLeft", value: 1 - f.eye.l },
        { name: "blinkRight",value: 1 - f.eye.r },
      ].forEach((i) => lerpExpression(vrm, i.name, i.value, delta * 5));

      // Eyes
      if (lookAtTarget.current) {
        const pupil = f.pupil || { x: 0, y: 0 };
        vrm.lookAt.target = lookAtTarget.current;
        lookAtDestination.current.set(-2 * pupil.x, 2 * pupil.y, 0);
        lookAtTarget.current.position.lerp(lookAtDestination.current, delta * 5);
      }

      // Neck
      rotateBone(vrm, "neck", f.head ?? { x: 0, y: 0, z: 0 }, delta * 5, {
        x: 0.3, y: -0.3, z: -0.3,
      });
    }

    // --- Pose ---
    if (riggedPose.current) {
      rotateBone(vrm, "chest", riggedPose.current.Spine, delta * 5, { x: 0.1, y: -0.1, z: -0.1 });
      rotateBone(vrm, "spine", riggedPose.current.Spine, delta * 5, { x: 0.1, y: -0.1, z: -0.1 });
      rotateBone(vrm, "hips", riggedPose.current.Hips.rotation, delta * 5, { x: 0.1, y: -0.1, z: -0.1 });

      rotateBone(vrm, "leftUpperArm",  riggedPose.current.LeftUpperArm,  delta * 5);
      rotateBone(vrm, "leftLowerArm",  riggedPose.current.LeftLowerArm,  delta * 5);
      rotateBone(vrm, "rightUpperArm", riggedPose.current.RightUpperArm, delta * 5);
      rotateBone(vrm, "rightLowerArm", riggedPose.current.RightLowerArm, delta * 5);
    }

    // --- Hands ---
    const fingerJointsMap = {
      Thumb: ["Proximal", "Distal"],
      Index: ["Proximal", "Intermediate", "Distal"],
      Middle:["Proximal", "Intermediate", "Distal"],
      Ring:  ["Proximal", "Intermediate", "Distal"],
      Little:["Proximal", "Intermediate", "Distal"],
    };

    const applyHandRotations = (handName, handData) => {
      if (!handData) return;

      if (handData.Shoulder)
        rotateBone(vrm, handName==="left"?"leftUpperArm":"rightUpperArm", handData.Shoulder, delta * 5);

      if (handData.Elbow)
        rotateBone(vrm, handName==="left"?"leftLowerArm":"rightLowerArm", handData.Elbow, delta * 5);

      if (handData.Wrist)
        rotateBone(vrm, handName==="left"?"leftHand":"rightHand", handData.Wrist, delta * 5);

      ["Thumb","Index","Middle","Ring","Little"].forEach((finger) => {
        if (!handData[finger]) return;
        fingerJointsMap[finger].forEach((joint) => {
          if (!handData[finger][joint]) return;
          rotateBone(vrm, `${handName}${finger}${joint}`, handData[finger][joint], delta * 5);
        });
      });
    };

    applyHandRotations("left", riggedLeftHand.current);
    applyHandRotations("right", riggedRightHand.current);

    vrm.update(delta);
  });

  return (
    <group {...props}>
      <primitive
        object={scene}
        rotation-y={avatar !== "3636451243928341470.vrm" ? Math.PI : 0}
      />
    </group>
  );
};
