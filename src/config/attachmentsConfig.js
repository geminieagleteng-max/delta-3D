// Weapon Attachments Configuration
export const ATTACHMENT_TYPES = {
  SIGHT: 'sight',
  MUZZLE: 'muzzle',
  GRIP: 'grip',
  MAGAZINE: 'magazine'
};

export const ATTACHMENTS = {
  // --- 瞄準鏡 (Sights) ---
  sight_reddot: {
    id: 'sight_reddot',
    name: '紅點瞄準鏡',
    type: ATTACHMENT_TYPES.SIGHT,
    size: [1, 1], // [width, height] in grid stash
    cost: 400,
    sellValue: 200,
    description: '提供清晰的發光紅點視野，開鏡速度提升 15%。',
    modifiers: { adsSpeed: 0.15 } // adsSpeed modifier: positive is faster ads
  },
  sight_scope4x: {
    id: 'sight_scope4x',
    name: 'ACOG 4倍瞄準鏡',
    type: ATTACHMENT_TYPES.SIGHT,
    size: [1, 1],
    cost: 800,
    sellValue: 400,
    description: '提供中距離望遠視野與十字分劃，開鏡速度降低 5%。',
    modifiers: { adsSpeed: -0.05, zoomFov: 32 } // zoomFov is the fov when ads
  },

  // --- 槍口 (Muzzles) ---
  muzzle_suppressor: {
    id: 'muzzle_suppressor',
    name: '戰術消音器',
    type: ATTACHMENT_TYPES.MUZZLE,
    size: [1, 1],
    cost: 600,
    sellValue: 300,
    description: '消除槍口火光並抑制作戰槍響，垂直後座力減少 10%。',
    modifiers: { recoil: -0.10, silence: true }
  },
  muzzle_compensator: {
    id: 'muzzle_compensator',
    name: '槍口補償器',
    type: ATTACHMENT_TYPES.MUZZLE,
    size: [1, 1],
    cost: 500,
    sellValue: 250,
    description: '大幅疏導排氣以控制槍口上跳，垂直與水平後座力減少 25%，開鏡速度降低 5%。',
    modifiers: { recoil: -0.25, adsSpeed: -0.05 }
  },

  // --- 前握把 (Grips) ---
  grip_vertical: {
    id: 'grip_vertical',
    name: '戰術垂直握把',
    type: ATTACHMENT_TYPES.GRIP,
    size: [1, 1],
    cost: 500,
    sellValue: 250,
    description: '提升槍枝持握穩定度，射擊擴散減少 20%，水平後座力減少 15%。',
    modifiers: { spread: -0.20, recoil: -0.15 }
  },
  grip_ergo: {
    id: 'grip_ergo',
    name: '人體工學斜角握把',
    type: ATTACHMENT_TYPES.GRIP,
    size: [1, 1],
    cost: 450,
    sellValue: 225,
    description: '使瞄準動作更為流暢迅速，開鏡速度大幅提升 30%。',
    modifiers: { adsSpeed: 0.30 }
  },

  // --- 彈匣 (Magazines) ---
  mag_extended: {
    id: 'mag_extended',
    name: '雙排擴容彈匣',
    type: ATTACHMENT_TYPES.MAGAZINE,
    size: [1, 1],
    cost: 500,
    sellValue: 250,
    description: '增加彈匣容量（步槍/衝鋒槍 +10 發，手槍 +5 發），但裝彈速度降低 15%。',
    modifiers: { extraCapacity: 10, reloadTime: 0.15 } // reloadTime modifier: positive is slower reload
  },
  mag_quickdraw: {
    id: 'mag_quickdraw',
    name: '快速拔裝彈匣',
    type: ATTACHMENT_TYPES.MAGAZINE,
    size: [1, 1],
    cost: 400,
    sellValue: 200,
    description: '配有快速拉環以加速戰術換彈，裝彈速度提升 30%。',
    modifiers: { reloadTime: -0.30 } // negative is faster reload
  }
};
