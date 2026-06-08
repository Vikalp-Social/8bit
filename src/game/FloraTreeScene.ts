import Phaser from "phaser";
import type { FloraPost } from "./FloraTreeBackground";

// ─── Socket type & helpers ────────────────────────────────────────────────────

interface Socket { fx: number; fy: number; angle: number; }

// flattenBranches: converts calibrated branch polylines into flat Socket[].
// Tangent at each point via central difference; perpendicular chosen as the
// one pointing upward (negative screen-y = away from ground).
function flattenBranches(
  branches: { fx: number; fy: number }[][],
): Socket[] {
  const out: Socket[] = [];
  for (const branch of branches) {
    for (let i = 0; i < branch.length; i++) {
      const pt   = branch[i];
      const prev = branch[Math.max(0, i - 1)];
      const next = branch[Math.min(branch.length - 1, i + 1)];
      const tx = next.fx - prev.fx;
      const ty = next.fy - prev.fy;
      // Two candidate perpendiculars; pick the one pointing upward (negative y = away from ground)
      const p1x = -ty, p1y =  tx;
      const p2x =  ty, p2y = -tx;
      const px = p1y <= 0 ? p1x : p2x;
      const py = p1y <= 0 ? p1y : p2y;
      // Phaser angle convention: 0 = up, +90 = right (matches setOrigin(0.5, 1))
      out.push({ fx: pt.fx, fy: pt.fy, angle: Math.atan2(px, -py) * (180 / Math.PI) });
    }
  }
  return out;
}

// ─── Medium tree branch data (calibrated) ─────────────────────────────────────
const mediumBranches: { fx: number; fy: number }[][] = [
  // branch 0
  [ { fx: 0.4860, fy: 0.6307 }, { fx: 0.4813, fy: 0.6148 }, { fx: 0.4743, fy: 0.6011 }, { fx: 0.4629, fy: 0.5898 }, { fx: 0.4521, fy: 0.5864 }, { fx: 0.4407, fy: 0.5852 }, { fx: 0.4305, fy: 0.5920 }, { fx: 0.4217, fy: 0.6000 }, { fx: 0.4122, fy: 0.6057 }, { fx: 0.4033, fy: 0.6023 }, { fx: 0.4033, fy: 0.5898 }, { fx: 0.4109, fy: 0.5818 }, { fx: 0.4236, fy: 0.5705 }, { fx: 0.4185, fy: 0.5591 }, { fx: 0.4071, fy: 0.5511 }, { fx: 0.3988, fy: 0.5386 }, { fx: 0.3938, fy: 0.5205 }, { fx: 0.3900, fy: 0.5023 }, { fx: 0.3874, fy: 0.4761 }, { fx: 0.3988, fy: 0.4727 }, { fx: 0.4020, fy: 0.4841 }, { fx: 0.4039, fy: 0.5080 }, { fx: 0.4103, fy: 0.5182 }, { fx: 0.4179, fy: 0.5261 }, { fx: 0.4236, fy: 0.5341 }, { fx: 0.4331, fy: 0.5398 }, { fx: 0.4439, fy: 0.5477 }, { fx: 0.4502, fy: 0.5477 }, { fx: 0.4591, fy: 0.5500 }, { fx: 0.4699, fy: 0.5511 }, { fx: 0.4788, fy: 0.5602 }, { fx: 0.4870, fy: 0.5693 } ],
  // branch 1
  [ { fx: 0.4940, fy: 0.5545 }, { fx: 0.4921, fy: 0.5386 }, { fx: 0.4908, fy: 0.5250 }, { fx: 0.4870, fy: 0.5045 }, { fx: 0.4813, fy: 0.4864 }, { fx: 0.4794, fy: 0.4670 }, { fx: 0.4756, fy: 0.4443 }, { fx: 0.4737, fy: 0.4216 }, { fx: 0.4743, fy: 0.3966 }, { fx: 0.4743, fy: 0.3716 }, { fx: 0.4749, fy: 0.3455 }, { fx: 0.4781, fy: 0.3250 }, { fx: 0.4819, fy: 0.2977 }, { fx: 0.4876, fy: 0.2784 }, { fx: 0.4914, fy: 0.2659 }, { fx: 0.5003, fy: 0.2659 }, { fx: 0.5060, fy: 0.2784 }, { fx: 0.5016, fy: 0.3011 }, { fx: 0.4990, fy: 0.3216 }, { fx: 0.4952, fy: 0.3455 }, { fx: 0.4952, fy: 0.3693 }, { fx: 0.4933, fy: 0.3943 }, { fx: 0.4952, fy: 0.4170 }, { fx: 0.4997, fy: 0.4307 }, { fx: 0.5035, fy: 0.4489 }, { fx: 0.5105, fy: 0.4455 }, { fx: 0.5155, fy: 0.4295 }, { fx: 0.5238, fy: 0.4250 }, { fx: 0.5320, fy: 0.4159 }, { fx: 0.5403, fy: 0.4091 }, { fx: 0.5460, fy: 0.3932 }, { fx: 0.5536, fy: 0.3909 }, { fx: 0.5618, fy: 0.3932 }, { fx: 0.5637, fy: 0.4057 }, { fx: 0.5574, fy: 0.4239 }, { fx: 0.5504, fy: 0.4352 }, { fx: 0.5415, fy: 0.4420 }, { fx: 0.5346, fy: 0.4545 }, { fx: 0.5251, fy: 0.4705 }, { fx: 0.5206, fy: 0.4966 }, { fx: 0.5193, fy: 0.5148 }, { fx: 0.5206, fy: 0.5307 }, { fx: 0.5232, fy: 0.5523 }, { fx: 0.5238, fy: 0.5750 } ],
  // branch 2
  [ { fx: 0.5263, fy: 0.6102 }, { fx: 0.5371, fy: 0.6034 }, { fx: 0.5453, fy: 0.5966 }, { fx: 0.5542, fy: 0.5875 }, { fx: 0.5625, fy: 0.5841 }, { fx: 0.5714, fy: 0.5716 }, { fx: 0.5745, fy: 0.5625 }, { fx: 0.5815, fy: 0.5500 }, { fx: 0.5904, fy: 0.5511 }, { fx: 0.5910, fy: 0.5648 }, { fx: 0.5878, fy: 0.5784 }, { fx: 0.5828, fy: 0.5920 }, { fx: 0.5821, fy: 0.5977 }, { fx: 0.5891, fy: 0.6057 }, { fx: 0.5993, fy: 0.6148 }, { fx: 0.6069, fy: 0.6205 }, { fx: 0.6119, fy: 0.6330 }, { fx: 0.6107, fy: 0.6455 }, { fx: 0.5986, fy: 0.6477 }, { fx: 0.5910, fy: 0.6398 }, { fx: 0.5840, fy: 0.6307 }, { fx: 0.5758, fy: 0.6239 }, { fx: 0.5663, fy: 0.6193 }, { fx: 0.5561, fy: 0.6261 }, { fx: 0.5504, fy: 0.6318 }, { fx: 0.5396, fy: 0.6420 }, { fx: 0.5346, fy: 0.6580 } ],
];

// ─── Small tree branch data (calibrated) ──────────────────────────────────────
const smallBranches: { fx: number; fy: number }[][] = [
  // branch 0
  [ { fx: 0.4908, fy: 0.8102 }, { fx: 0.4895, fy: 0.8000 }, { fx: 0.4851, fy: 0.7841 }, { fx: 0.4800, fy: 0.7773 }, { fx: 0.4749, fy: 0.7693 }, { fx: 0.4788, fy: 0.7580 }, { fx: 0.4851, fy: 0.7648 }, { fx: 0.4908, fy: 0.7761 }, { fx: 0.4933, fy: 0.7886 } ],
  // branch 1
  [ { fx: 0.5029, fy: 0.7489 }, { fx: 0.5035, fy: 0.7341 }, { fx: 0.5022, fy: 0.7227 }, { fx: 0.4984, fy: 0.7034 }, { fx: 0.4940, fy: 0.6807 }, { fx: 0.4921, fy: 0.6625 }, { fx: 0.4984, fy: 0.6636 }, { fx: 0.5016, fy: 0.6784 }, { fx: 0.5054, fy: 0.6943 }, { fx: 0.5092, fy: 0.7091 }, { fx: 0.5105, fy: 0.7295 } ],
  // branch 2
  [ { fx: 0.5162, fy: 0.7239 }, { fx: 0.5238, fy: 0.7216 }, { fx: 0.5289, fy: 0.7114 }, { fx: 0.5327, fy: 0.6989 }, { fx: 0.5396, fy: 0.6852 }, { fx: 0.5466, fy: 0.6886 }, { fx: 0.5498, fy: 0.7023 }, { fx: 0.5447, fy: 0.7148 }, { fx: 0.5352, fy: 0.7239 }, { fx: 0.5263, fy: 0.7307 }, { fx: 0.5174, fy: 0.7420 }, { fx: 0.5105, fy: 0.7602 }, { fx: 0.5067, fy: 0.7807 } ],
];

const smallSocketsTyped  = flattenBranches(smallBranches);
const mediumSocketsTyped = flattenBranches(mediumBranches);
// ─── Large tree branch data (calibrated) ──────────────────────────────────────
const largeBranches: { fx: number; fy: number }[][] = [
  // branch 0
  [ { fx: 0.3855, fy: 0.5205 }, { fx: 0.3722, fy: 0.5273 }, { fx: 0.3684, fy: 0.5364 }, { fx: 0.3595, fy: 0.5580 }, { fx: 0.3525, fy: 0.5750 }, { fx: 0.3462, fy: 0.5841 }, { fx: 0.3373, fy: 0.5875 }, { fx: 0.3284, fy: 0.5875 }, { fx: 0.3284, fy: 0.5795 }, { fx: 0.3386, fy: 0.5659 }, { fx: 0.3462, fy: 0.5545 }, { fx: 0.3487, fy: 0.5273 } ],
  // branch 1
  [ { fx: 0.3399, fy: 0.5284 }, { fx: 0.3284, fy: 0.5318 }, { fx: 0.3145, fy: 0.5364 }, { fx: 0.2993, fy: 0.5477 }, { fx: 0.2878, fy: 0.5500 }, { fx: 0.2701, fy: 0.5602 }, { fx: 0.2511, fy: 0.5750 }, { fx: 0.2396, fy: 0.5773 }, { fx: 0.2314, fy: 0.5761 }, { fx: 0.2301, fy: 0.5591 }, { fx: 0.2377, fy: 0.5466 }, { fx: 0.2466, fy: 0.5455 }, { fx: 0.2587, fy: 0.5341 }, { fx: 0.2669, fy: 0.5284 }, { fx: 0.2593, fy: 0.5205 }, { fx: 0.2472, fy: 0.5091 }, { fx: 0.2339, fy: 0.5011 }, { fx: 0.2263, fy: 0.4864 }, { fx: 0.2339, fy: 0.4716 }, { fx: 0.2415, fy: 0.4784 }, { fx: 0.2492, fy: 0.4909 }, { fx: 0.2625, fy: 0.4955 }, { fx: 0.2752, fy: 0.4989 }, { fx: 0.2847, fy: 0.5011 }, { fx: 0.2955, fy: 0.5011 }, { fx: 0.3088, fy: 0.4955 }, { fx: 0.3227, fy: 0.4875 }, { fx: 0.3379, fy: 0.4807 }, { fx: 0.3456, fy: 0.4761 } ],
  // branch 2
  [ { fx: 0.3348, fy: 0.4659 }, { fx: 0.3259, fy: 0.4568 }, { fx: 0.3138, fy: 0.4477 }, { fx: 0.3062, fy: 0.4375 }, { fx: 0.3005, fy: 0.4216 }, { fx: 0.2936, fy: 0.4091 }, { fx: 0.2866, fy: 0.3989 }, { fx: 0.2739, fy: 0.3864 }, { fx: 0.2656, fy: 0.3830 }, { fx: 0.2555, fy: 0.3830 }, { fx: 0.2466, fy: 0.3830 }, { fx: 0.2352, fy: 0.3886 }, { fx: 0.2276, fy: 0.3909 }, { fx: 0.2181, fy: 0.3920 }, { fx: 0.2092, fy: 0.3920 }, { fx: 0.2022, fy: 0.3920 }, { fx: 0.2022, fy: 0.3784 }, { fx: 0.2136, fy: 0.3773 }, { fx: 0.2212, fy: 0.3739 }, { fx: 0.2320, fy: 0.3716 }, { fx: 0.2441, fy: 0.3636 }, { fx: 0.2523, fy: 0.3636 }, { fx: 0.2650, fy: 0.3636 }, { fx: 0.2720, fy: 0.3659 }, { fx: 0.2644, fy: 0.3432 }, { fx: 0.2599, fy: 0.3341 }, { fx: 0.2568, fy: 0.3148 }, { fx: 0.2555, fy: 0.2955 }, { fx: 0.2612, fy: 0.2955 }, { fx: 0.2675, fy: 0.3068 }, { fx: 0.2726, fy: 0.3250 }, { fx: 0.2771, fy: 0.3375 }, { fx: 0.2828, fy: 0.3511 }, { fx: 0.2891, fy: 0.3614 }, { fx: 0.2961, fy: 0.3693 }, { fx: 0.3056, fy: 0.3852 }, { fx: 0.3138, fy: 0.3943 }, { fx: 0.3202, fy: 0.4011 }, { fx: 0.3322, fy: 0.4125 }, { fx: 0.3418, fy: 0.4148 }, { fx: 0.3532, fy: 0.4205 }, { fx: 0.3640, fy: 0.4295 }, { fx: 0.3779, fy: 0.4398 }, { fx: 0.3874, fy: 0.4420 }, { fx: 0.3976, fy: 0.4500 }, { fx: 0.4077, fy: 0.4568 }, { fx: 0.4286, fy: 0.4614 } ],
  // branch 3
  [ { fx: 0.4508, fy: 0.4511 }, { fx: 0.4451, fy: 0.4364 }, { fx: 0.4350, fy: 0.4307 }, { fx: 0.4236, fy: 0.4102 }, { fx: 0.4122, fy: 0.4091 }, { fx: 0.4033, fy: 0.3955 }, { fx: 0.3842, fy: 0.3955 }, { fx: 0.3735, fy: 0.3943 }, { fx: 0.3690, fy: 0.3750 }, { fx: 0.3792, fy: 0.3670 }, { fx: 0.3881, fy: 0.3727 }, { fx: 0.3976, fy: 0.3727 }, { fx: 0.3988, fy: 0.3602 }, { fx: 0.3925, fy: 0.3466 }, { fx: 0.3900, fy: 0.3273 }, { fx: 0.3969, fy: 0.3284 }, { fx: 0.4058, fy: 0.3398 }, { fx: 0.4109, fy: 0.3545 }, { fx: 0.4160, fy: 0.3705 }, { fx: 0.4204, fy: 0.3727 }, { fx: 0.4299, fy: 0.3795 }, { fx: 0.4413, fy: 0.3886 }, { fx: 0.4496, fy: 0.3955 }, { fx: 0.4547, fy: 0.4000 }, { fx: 0.4597, fy: 0.4102 } ],
  // branch 4
  [ { fx: 0.4635, fy: 0.3591 }, { fx: 0.4547, fy: 0.3386 }, { fx: 0.4489, fy: 0.3295 }, { fx: 0.4420, fy: 0.3114 }, { fx: 0.4331, fy: 0.3023 }, { fx: 0.4185, fy: 0.2886 }, { fx: 0.4026, fy: 0.2830 }, { fx: 0.3925, fy: 0.2716 }, { fx: 0.3760, fy: 0.2682 }, { fx: 0.3620, fy: 0.2545 }, { fx: 0.3500, fy: 0.2466 }, { fx: 0.3411, fy: 0.2318 }, { fx: 0.3430, fy: 0.2182 }, { fx: 0.3519, fy: 0.2159 }, { fx: 0.3614, fy: 0.2295 }, { fx: 0.3709, fy: 0.2352 }, { fx: 0.3804, fy: 0.2352 }, { fx: 0.3925, fy: 0.2432 }, { fx: 0.4033, fy: 0.2455 }, { fx: 0.4147, fy: 0.2489 }, { fx: 0.4198, fy: 0.2523 }, { fx: 0.4236, fy: 0.2364 }, { fx: 0.4248, fy: 0.2216 }, { fx: 0.4229, fy: 0.2011 }, { fx: 0.4274, fy: 0.1977 }, { fx: 0.4344, fy: 0.2057 }, { fx: 0.4382, fy: 0.2239 }, { fx: 0.4388, fy: 0.2386 }, { fx: 0.4388, fy: 0.2534 }, { fx: 0.4432, fy: 0.2614 }, { fx: 0.4508, fy: 0.2682 }, { fx: 0.4572, fy: 0.2727 }, { fx: 0.4642, fy: 0.2830 } ],
  // branch 5
  [ { fx: 0.4686, fy: 0.2614 }, { fx: 0.4730, fy: 0.2443 }, { fx: 0.4788, fy: 0.2250 }, { fx: 0.4851, fy: 0.2125 }, { fx: 0.4946, fy: 0.1955 }, { fx: 0.4984, fy: 0.1773 }, { fx: 0.5010, fy: 0.1580 }, { fx: 0.5035, fy: 0.1386 }, { fx: 0.5010, fy: 0.1170 }, { fx: 0.4946, fy: 0.1011 }, { fx: 0.4895, fy: 0.0807 }, { fx: 0.4971, fy: 0.0784 }, { fx: 0.5041, fy: 0.0841 }, { fx: 0.5098, fy: 0.1091 }, { fx: 0.5149, fy: 0.1295 }, { fx: 0.5181, fy: 0.1182 }, { fx: 0.5219, fy: 0.0989 }, { fx: 0.5219, fy: 0.0841 }, { fx: 0.5263, fy: 0.0602 }, { fx: 0.5333, fy: 0.0602 }, { fx: 0.5441, fy: 0.0591 }, { fx: 0.5434, fy: 0.0807 }, { fx: 0.5384, fy: 0.1011 }, { fx: 0.5352, fy: 0.1182 }, { fx: 0.5301, fy: 0.1420 }, { fx: 0.5289, fy: 0.1602 }, { fx: 0.5232, fy: 0.1818 }, { fx: 0.5270, fy: 0.1841 }, { fx: 0.5453, fy: 0.1784 }, { fx: 0.5485, fy: 0.1693 }, { fx: 0.5580, fy: 0.1591 }, { fx: 0.5637, fy: 0.1557 }, { fx: 0.5688, fy: 0.1602 }, { fx: 0.5688, fy: 0.1773 }, { fx: 0.5612, fy: 0.1898 }, { fx: 0.5523, fy: 0.1989 }, { fx: 0.5396, fy: 0.2023 }, { fx: 0.5320, fy: 0.2080 }, { fx: 0.5232, fy: 0.2159 }, { fx: 0.5168, fy: 0.2352 }, { fx: 0.5111, fy: 0.2511 }, { fx: 0.5079, fy: 0.2670 }, { fx: 0.5067, fy: 0.2875 }, { fx: 0.5086, fy: 0.3114 } ],
  // branch 6
  [ { fx: 0.5536, fy: 0.4227 }, { fx: 0.5625, fy: 0.4125 }, { fx: 0.5695, fy: 0.4034 }, { fx: 0.5758, fy: 0.3909 }, { fx: 0.5815, fy: 0.3773 }, { fx: 0.5847, fy: 0.3591 }, { fx: 0.5853, fy: 0.3307 }, { fx: 0.5840, fy: 0.3102 }, { fx: 0.5809, fy: 0.2920 }, { fx: 0.5840, fy: 0.2716 }, { fx: 0.5885, fy: 0.2568 }, { fx: 0.5980, fy: 0.2557 }, { fx: 0.5980, fy: 0.2716 }, { fx: 0.5967, fy: 0.2795 }, { fx: 0.5974, fy: 0.3034 }, { fx: 0.6005, fy: 0.3205 }, { fx: 0.6031, fy: 0.3466 }, { fx: 0.6050, fy: 0.3636 }, { fx: 0.6138, fy: 0.3523 }, { fx: 0.6259, fy: 0.3511 }, { fx: 0.6392, fy: 0.3386 }, { fx: 0.6513, fy: 0.3295 }, { fx: 0.6633, fy: 0.3227 }, { fx: 0.6703, fy: 0.3080 }, { fx: 0.6766, fy: 0.2943 }, { fx: 0.6868, fy: 0.2795 }, { fx: 0.6938, fy: 0.2795 }, { fx: 0.6944, fy: 0.2955 }, { fx: 0.6900, fy: 0.3102 }, { fx: 0.6811, fy: 0.3284 }, { fx: 0.6722, fy: 0.3409 }, { fx: 0.6652, fy: 0.3477 }, { fx: 0.6544, fy: 0.3636 }, { fx: 0.6399, fy: 0.3784 }, { fx: 0.6284, fy: 0.3886 }, { fx: 0.6170, fy: 0.3977 }, { fx: 0.6081, fy: 0.4102 }, { fx: 0.5999, fy: 0.4250 }, { fx: 0.5961, fy: 0.4375 }, { fx: 0.6075, fy: 0.4386 }, { fx: 0.6196, fy: 0.4386 }, { fx: 0.6284, fy: 0.4386 }, { fx: 0.6386, fy: 0.4386 }, { fx: 0.6443, fy: 0.4375 }, { fx: 0.6475, fy: 0.4432 }, { fx: 0.6468, fy: 0.4545 }, { fx: 0.6341, fy: 0.4659 }, { fx: 0.6221, fy: 0.4625 }, { fx: 0.6075, fy: 0.4636 }, { fx: 0.5999, fy: 0.4659 }, { fx: 0.5916, fy: 0.4705 }, { fx: 0.5777, fy: 0.4818 } ],
  // branch 7
  [ { fx: 0.6221, fy: 0.5125 }, { fx: 0.6329, fy: 0.5148 }, { fx: 0.6456, fy: 0.5057 }, { fx: 0.6570, fy: 0.4909 }, { fx: 0.6633, fy: 0.4807 }, { fx: 0.6709, fy: 0.4693 }, { fx: 0.6779, fy: 0.4591 }, { fx: 0.6792, fy: 0.4398 }, { fx: 0.6830, fy: 0.4239 }, { fx: 0.6881, fy: 0.4080 }, { fx: 0.6957, fy: 0.4080 }, { fx: 0.6957, fy: 0.4250 }, { fx: 0.6931, fy: 0.4477 }, { fx: 0.7033, fy: 0.4341 }, { fx: 0.7134, fy: 0.4239 }, { fx: 0.7261, fy: 0.4182 }, { fx: 0.7356, fy: 0.4159 }, { fx: 0.7451, fy: 0.4091 }, { fx: 0.7508, fy: 0.4034 }, { fx: 0.7642, fy: 0.3955 }, { fx: 0.7718, fy: 0.3909 }, { fx: 0.7699, fy: 0.4102 }, { fx: 0.7629, fy: 0.4227 }, { fx: 0.7540, fy: 0.4295 }, { fx: 0.7382, fy: 0.4330 }, { fx: 0.7293, fy: 0.4443 }, { fx: 0.7147, fy: 0.4568 }, { fx: 0.7052, fy: 0.4670 }, { fx: 0.6950, fy: 0.4784 }, { fx: 0.6843, fy: 0.4909 }, { fx: 0.6817, fy: 0.5102 }, { fx: 0.6747, fy: 0.5295 }, { fx: 0.6804, fy: 0.5330 }, { fx: 0.6931, fy: 0.5318 }, { fx: 0.7039, fy: 0.5420 }, { fx: 0.7160, fy: 0.5455 }, { fx: 0.7299, fy: 0.5500 }, { fx: 0.7445, fy: 0.5591 }, { fx: 0.7585, fy: 0.5591 }, { fx: 0.7730, fy: 0.5670 }, { fx: 0.7838, fy: 0.5705 }, { fx: 0.7864, fy: 0.5818 }, { fx: 0.7807, fy: 0.5920 }, { fx: 0.7667, fy: 0.5955 }, { fx: 0.7528, fy: 0.5966 }, { fx: 0.7401, fy: 0.5932 }, { fx: 0.7267, fy: 0.5886 }, { fx: 0.7103, fy: 0.5818 }, { fx: 0.7014, fy: 0.5784 }, { fx: 0.6995, fy: 0.5909 }, { fx: 0.7084, fy: 0.6091 }, { fx: 0.7147, fy: 0.6273 }, { fx: 0.7217, fy: 0.6386 }, { fx: 0.7255, fy: 0.6443 }, { fx: 0.7229, fy: 0.6545 }, { fx: 0.7096, fy: 0.6500 }, { fx: 0.6963, fy: 0.6398 }, { fx: 0.6912, fy: 0.6148 }, { fx: 0.6849, fy: 0.6023 }, { fx: 0.6779, fy: 0.5841 }, { fx: 0.6697, fy: 0.5739 }, { fx: 0.6500, fy: 0.5739 }, { fx: 0.6329, fy: 0.5761 }, { fx: 0.6234, fy: 0.5830 } ],
];

const largeSocketsTyped  = flattenBranches(largeBranches);

// ─── Tier config ──────────────────────────────────────────────────────────────
interface TierConfig {
  imageKey: string;
  sockets:  Socket[];
  trunkFx:  number;
  trunkFy:  number;
}

// Tier is selected once on first renderLeaves call and locked in for the session.
// < 20 posts → small sapling; < 100 → medium tree; ≥ 100 → full large tree.
function pickTier(totalPosts: number): TierConfig {
  if (totalPosts < 20) {
    return { imageKey: "flora-tree-small",  sockets: smallSocketsTyped,  trunkFx: 0.506, trunkFy: 0.765 };
  } else if (totalPosts < 100) {
    return { imageKey: "flora-tree-medium", sockets: mediumSocketsTyped, trunkFx: 0.505, trunkFy: 0.600 };
  } else {
    return { imageKey: "flora-tree-large",  sockets: largeSocketsTyped,  trunkFx: 0.500, trunkFy: 0.550 };
  }
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const GREEN_PALETTE = [
  0x3aad3a, 0x52c41a, 0x389e0d,
  0x237804, 0x73d13d, 0x95de64,
  0x1a6b1a,
];

function tilesBase(): string {
  const b = (import.meta as { env: { BASE_URL?: string } }).env.BASE_URL ?? "/";
  return b.endsWith("/") ? b : `${b}/`;
}

// ─── Scene ────────────────────────────────────────────────────────────────────
export class FloraTreeScene extends Phaser.Scene {
  private occupiedSockets = new Set<number>();
  private shuffledSockets: Socket[] = [];
  private activeTier: TierConfig | null = null;
  // Displayed image bounds — set once when the tier/tree image is chosen
  private imgX     = 0;
  private imgY     = 0;
  private displayW = 0;
  private displayH = 0;

  constructor() {
    super({ key: "FloraTreeScene" });
  }

  preload() {
    const base = tilesBase();
    this.load.image("flora-tree-small",  `${base}tiles/tree-small.jpg`);
    this.load.image("flora-tree-medium", `${base}tiles/tree-medium.jpg`);
    this.load.image("flora-tree-large",  `${base}tiles/tree.jpg`);
    this.load.image("flora-leaf",        `${base}tiles/leaf.png`);
  }

  create() {
    this.events.on("renderLeaves", this.renderLeaves, this);
  }

  renderLeaves(posts: FloraPost[], totalPosts: number) {
    const { width, height } = this.scale;

    // Lock in the tier on the very first call
    if (!this.activeTier) {
      this.activeTier = pickTier(totalPosts ?? posts.length);

      // Scale the tree image uniformly to *cover* the screen (no letterboxing),
      // then offset so the calibrated trunk centre lands at the screen centre.
      // This keeps the tree prominent regardless of the image's composition.
      const src = this.textures.get(this.activeTier.imageKey)
        .getSourceImage() as HTMLImageElement;
      const nativeW = src.naturalWidth  || src.width;
      const nativeH = src.naturalHeight || src.height;
      const scale   = Math.max(width / nativeW, height / nativeH);

      this.displayW = nativeW * scale;
      this.displayH = nativeH * scale;

      const { trunkFx, trunkFy } = this.activeTier;
      this.imgX = width  / 2 - trunkFx * this.displayW;
      this.imgY = height / 2 - trunkFy * this.displayH;

      // Phaser image() origin is (0.5, 0.5) — position by centre
      this.add
        .image(
          this.imgX + this.displayW / 2,
          this.imgY + this.displayH / 2,
          this.activeTier.imageKey,
        )
        .setDisplaySize(this.displayW, this.displayH)
        .setDepth(0);

      this.shuffledSockets = Phaser.Utils.Array.Shuffle([
        ...this.activeTier.sockets,
      ]) as Socket[];
      this.occupiedSockets.clear();
    }

    const limit = Math.min(posts.length, this.shuffledSockets.length);

    for (let i = 0; i < limit; i++) {
      if (this.occupiedSockets.has(i)) continue;
      this.occupiedSockets.add(i);

      const sock = this.shuffledSockets[i];
      // Map image-fraction sockets to screen coords via the displayed image bounds
      const ax = this.imgX + sock.fx * this.displayW;
      const ay = this.imgY + sock.fy * this.displayH;

      const tint = GREEN_PALETTE[Phaser.Math.Between(0, GREEN_PALETTE.length - 1)];

      // sock.angle is perpendicular to the branch tangent, computed by flattenBranches.
      // ±25° of natural variation around the accurate base angle.
      const angle = sock.angle + Phaser.Math.Between(-25, 25);
      const post  = posts[i];

      // leaf.png is cropped to 146×166px (exact leaf bounds, no padding).
      // setOrigin(0.5, 1) pins the bottom-centre (stem) at the socket coordinate.
      const leaf = this.add
        .image(ax, ay, "flora-leaf")
        .setOrigin(0.5, 1)
        .setScale(0.24)
        .setAngle(angle)
        .setTint(tint)
        .setInteractive({ useHandCursor: true })
        .setAlpha(0)
        .setDepth(1);

      leaf.on("pointerdown", () => {
        console.log("post:", post.id);
      });

      this.tweens.add({
        targets:  leaf,
        alpha:    1,
        duration: 400,
        ease:     "Quad.easeOut",
      });

      this.tweens.add({
        targets:  leaf,
        y:        ay + 2,
        duration: 1400 + Math.random() * 800,
        yoyo:     true,
        repeat:   -1,
        ease:     "Sine.easeInOut",
        delay:    Math.random() * 2000,
      });
    }
  }
}
