// DELTA FORCE 3D - Local Account System Utility

const STORAGE_KEY = 'delta_3d_accounts';

// 取得所有本機帳號
export function getAccounts() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to parse accounts from localStorage:', e);
    return [];
  }
}

// 儲存帳號清單
export function saveAccounts(accounts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

// 註冊新帳號
export function registerAccount(username, nickname, password) {
  if (!username || !nickname || !password) {
    throw new Error('所有欄位皆為必填！');
  }
  const accounts = getAccounts();
  const exists = accounts.some(a => a.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    throw new Error('此帳號已存在！');
  }

  const newAccount = {
    username,
    nickname,
    password, // 基於展示目的採用明文比對
    coins: 1000, // 初始給予 1000 金幣
    inventory: {
      laserSight: false,
      suppressor: false,
      bodyArmor: false,
      grenadePouch: false,
      opsHelmet: false
    },
    stats: {
      gamesPlayed: 0,
      wins: 0,
      kills: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      playTimeSeconds: 0,
      highScore: 0
    },
    achievements: {
      firstBlood: false,
      deadeye: false,
      survivor: false,
      heavyGunner: false
    }
  };

  accounts.push(newAccount);
  saveAccounts(accounts);
  return { 
    username: newAccount.username, 
    nickname: newAccount.nickname, 
    stats: newAccount.stats, 
    achievements: newAccount.achievements,
    coins: newAccount.coins,
    inventory: newAccount.inventory
  };
}

// 登入帳號
export function loginAccount(username, password) {
  if (!username || !password) {
    throw new Error('帳號與密碼皆為必填！');
  }
  const accounts = getAccounts();
  const user = accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!user || user.password !== password) {
    throw new Error('帳號或密碼錯誤！');
  }
  return { 
    username: user.username, 
    nickname: user.nickname, 
    stats: user.stats, 
    achievements: user.achievements,
    coins: user.coins !== undefined ? user.coins : 0,
    inventory: user.inventory || { laserSight: false, suppressor: false, bodyArmor: false, grenadePouch: false, opsHelmet: false }
  };
}

// 修改暱稱
export function updateNickname(username, newNickname) {
  if (!newNickname || !newNickname.trim()) {
    throw new Error('暱稱不得為空！');
  }
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) {
    throw new Error('找不到該帳號！');
  }
  accounts[idx].nickname = newNickname.trim();
  saveAccounts(accounts);
  return { 
    username: accounts[idx].username, 
    nickname: accounts[idx].nickname, 
    stats: accounts[idx].stats, 
    achievements: accounts[idx].achievements,
    coins: accounts[idx].coins !== undefined ? accounts[idx].coins : 0,
    inventory: accounts[idx].inventory || { laserSight: false, suppressor: false, bodyArmor: false, grenadePouch: false, opsHelmet: false }
  };
}

// 更新遊玩戰績
export function updateStats(username, runStats) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) return null;

  const user = accounts[idx];
  
  // 累加數值
  user.stats.gamesPlayed += 1;
  if (runStats.victory) {
    user.stats.wins += 1;
  }
  user.stats.kills += runStats.kills;
  user.stats.headshots += runStats.headshots;
  user.stats.shotsFired += runStats.shotsFired;
  user.stats.shotsHit += runStats.shotsHit;
  user.stats.playTimeSeconds += runStats.playTimeSeconds;

  // 計算單場得分，並更新最高分 (Kills = 100分, Wins = 500分)
  const currentRunScore = (runStats.kills * 100) + (runStats.victory ? 500 : 0);
  user.stats.highScore = Math.max(user.stats.highScore, currentRunScore);

  // 更新成就判定
  if (user.stats.kills >= 1) user.achievements.firstBlood = true;
  if (user.stats.headshots >= 5) user.achievements.deadeye = true;
  if (user.stats.wins >= 1) user.achievements.survivor = true;
  if (user.stats.shotsFired >= 500) user.achievements.heavyGunner = true;

  // 計算本場獲得金幣
  const killsCoins = runStats.kills * 50;
  const victoryCoins = runStats.victory ? 300 : 0;
  const headshotsCoins = runStats.headshots * 20;
  const accuracyPct = runStats.shotsFired > 0 ? (runStats.shotsHit / runStats.shotsFired) : 0;
  const accuracyCoins = Math.round(accuracyPct * 100);
  const coinsEarned = killsCoins + victoryCoins + headshotsCoins + accuracyCoins;

  // 累加金幣
  user.coins = (user.coins !== undefined ? user.coins : 0) + coinsEarned;
  if (!user.inventory) {
    user.inventory = { laserSight: false, suppressor: false, bodyArmor: false, grenadePouch: false, opsHelmet: false };
  }

  saveAccounts(accounts);

  return {
    user: {
      username: user.username,
      nickname: user.nickname,
      stats: user.stats,
      achievements: user.achievements,
      coins: user.coins,
      inventory: user.inventory
    },
    coinsEarnedDetails: {
      killsCoins,
      victoryCoins,
      headshotsCoins,
      accuracyCoins,
      total: coinsEarned
    }
  };
}

// 商店裝備清單
export const SHOP_ITEMS = [
  {
    id: 'laserSight',
    name: 'M4A1 雷射瞄準器',
    englishName: 'M4A1 Laser Sight',
    cost: 800,
    description: '提升主武器 M4A1 的威力，普通射擊傷害由 25 提升至 30。',
    category: 'weapon'
  },
  {
    id: 'suppressor',
    name: 'M9 戰術消音器',
    englishName: 'M9 Tactical Suppressor',
    cost: 500,
    description: '提升副武器 M9 手槍的威力，普通射擊傷害由 15 提升至 20。',
    category: 'weapon'
  },
  {
    id: 'bodyArmor',
    name: '重型防彈衣',
    englishName: 'Heavy Body Armor',
    cost: 1000,
    description: '出擊時初始生命值（Health）由 100 提升至 150。',
    category: 'armor'
  },
  {
    id: 'grenadePouch',
    name: '戰術手榴彈袋',
    englishName: 'Tactical Grenade Pouch',
    cost: 600,
    description: '出擊時初始攜帶手榴彈數量由 2 顆提升至 3 顆。',
    category: 'gear'
  },
  {
    id: 'opsHelmet',
    name: '特種作戰頭盔',
    englishName: 'Special Ops Helmet',
    cost: 1200,
    description: '提供頭部防護，使受到敵軍子彈射擊的傷害減少 25%。',
    category: 'armor'
  }
];

// 購買裝備
export function purchaseItem(username, itemId) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) {
    throw new Error('找不到該帳號！');
  }

  const user = accounts[idx];
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) {
    throw new Error('找不到該商品！');
  }

  // 初始化預設值
  if (user.coins === undefined) user.coins = 0;
  if (!user.inventory) {
    user.inventory = { laserSight: false, suppressor: false, bodyArmor: false, grenadePouch: false, opsHelmet: false };
  }

  if (user.inventory[itemId]) {
    throw new Error('您已擁有此裝備！');
  }

  if (user.coins < item.cost) {
    throw new Error('Delta 金幣不足！');
  }

  // 扣除金幣並加入庫存
  user.coins -= item.cost;
  user.inventory[itemId] = true;

  saveAccounts(accounts);
  return { 
    username: user.username, 
    nickname: user.nickname, 
    stats: user.stats, 
    achievements: user.achievements,
    coins: user.coins,
    inventory: user.inventory
  };
}

// 軍階對照表
const RANKS = [
  { minKills: 0, title: 'RECRUIT', zhTitle: '新兵', color: '#88a888' },
  { minKills: 5, title: 'PRIVATE', zhTitle: '二兵', color: '#a3b899' },
  { minKills: 12, title: 'CORPORAL', zhTitle: '下士', color: '#4f7a53' },
  { minKills: 25, title: 'SERGEANT', zhTitle: '中士', color: '#3d8c4b' },
  { minKills: 50, title: 'LIEUTENANT', zhTitle: '少尉', color: '#00bcd4' },
  { minKills: 100, title: 'CAPTAIN', zhTitle: '上尉', color: '#3f51b5' },
  { minKills: 200, title: 'MAJOR', zhTitle: '少校', color: '#9c27b0' },
  { minKills: 500, title: 'COLONEL', zhTitle: '上校', color: '#ff9800' },
  { minKills: 1000, title: 'GENERAL', zhTitle: '將軍', color: '#f44336' }
];

// 計算目前軍階
export function getRank(kills) {
  let currentRank = RANKS[0];
  let nextRank = null;

  for (let i = 0; i < RANKS.length; i++) {
    if (kills >= RANKS[i].minKills) {
      currentRank = RANKS[i];
      nextRank = RANKS[i + 1] || null;
    } else {
      break;
    }
  }

  return {
    title: currentRank.title,
    zhTitle: currentRank.zhTitle,
    color: currentRank.color,
    minKills: currentRank.minKills,
    nextRankTitle: nextRank ? nextRank.title : 'MAX',
    nextRankKills: nextRank ? nextRank.minKills : null,
    progress: nextRank ? (kills - currentRank.minKills) / (nextRank.minKills - currentRank.minKills) : 1
  };
}

// 取得本機排行榜
export function getLeaderboard() {
  const accounts = getAccounts();
  const sorted = accounts.map(a => {
    // 生涯總分計算公式
    const totalScore = (a.stats.kills * 100) + (a.stats.wins * 500);
    return {
      username: a.username,
      nickname: a.nickname,
      totalScore,
      highScore: a.stats.highScore,
      kills: a.stats.kills,
      wins: a.stats.wins,
      gamesPlayed: a.stats.gamesPlayed
    };
  });

  // 排序優先序：總積分 -> 擊殺數 -> 勝場數
  sorted.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return b.wins - a.wins;
  });

  return sorted;
}
