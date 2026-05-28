// DELTA FORCE 3D - Account System Utility with Persistent Stash & Loadout
const STORAGE_KEY = 'delta_3d_accounts';

// 取得所有本機帳號 (包含資料欄位升級相容)
export function getAccounts() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    const list = JSON.parse(data);
    let changed = false;
    list.forEach(a => {
      // 升級相容倉庫 Stash 系統
      if (a.stash === undefined) {
        // 新手包：可打 3 把的物資備份（已裝備 1 套 + 倉庫 2 套）
        a.stash = {
          m4a1: 2,
          m9: 2,
          bodyArmor: 2,
          opsHelmet: 2,
          grenade: 4,
          medkit: 4,
          goldBar: 0,
          hardDrive: 0,
          dogTag: 0
        };
        changed = true;
      }
      // 升級相容單兵配裝 Equipped 系統
      if (a.equipped === undefined) {
        a.equipped = {
          primaryWeapon: 'm4a1',
          secondaryWeapon: 'm9',
          bodyArmor: true,
          opsHelmet: true,
          grenades: 2,
          medkits: 2
        };
        changed = true;
      }
      if (a.coins === undefined) {
        a.coins = 2000; // 初始資金提升為 2000
        changed = true;
      }
    });
    if (changed) {
      saveAccounts(list);
    }
    return list;
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
    coins: 2000, // 初始給予 2000 金幣
    stash: {
      m4a1: 2,
      m9: 2,
      bodyArmor: 2,
      opsHelmet: 2,
      grenade: 4,
      medkit: 4,
      goldBar: 0,
      hardDrive: 0,
      dogTag: 0
    },
    equipped: {
      primaryWeapon: 'm4a1',
      secondaryWeapon: 'm9',
      bodyArmor: true,
      opsHelmet: true,
      grenades: 2,
      medkits: 2
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
    stash: newAccount.stash,
    equipped: newAccount.equipped
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
    stash: user.stash,
    equipped: user.equipped
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
    stash: accounts[idx].stash,
    equipped: accounts[idx].equipped
  };
}

// 更新遊玩戰績 (原配方相容)
export function updateStats(username, runStats) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) return null;

  const user = accounts[idx];
  
  user.stats.gamesPlayed += 1;
  if (runStats.victory) {
    user.stats.wins += 1;
  }
  user.stats.kills += runStats.kills;
  user.stats.headshots += runStats.headshots;
  user.stats.shotsFired += runStats.shotsFired;
  user.stats.shotsHit += runStats.shotsHit;
  user.stats.playTimeSeconds += runStats.playTimeSeconds;

  const currentRunScore = (runStats.kills * 100) + (runStats.victory ? 500 : 0);
  user.stats.highScore = Math.max(user.stats.highScore, currentRunScore);

  if (user.stats.kills >= 1) user.achievements.firstBlood = true;
  if (user.stats.headshots >= 5) user.achievements.deadeye = true;
  if (user.stats.wins >= 1) user.achievements.survivor = true;
  if (user.stats.shotsFired >= 500) user.achievements.heavyGunner = true;

  saveAccounts(accounts);

  return {
    user: {
      username: user.username,
      nickname: user.nickname,
      stats: user.stats,
      achievements: user.achievements,
      coins: user.coins,
      stash: user.stash,
      equipped: user.equipped
    },
    coinsEarnedDetails: {
      killsCoins: runStats.kills * 50,
      victoryCoins: runStats.victory ? 300 : 0,
      headshotsCoins: runStats.headshots * 20,
      accuracyCoins: 100,
      total: (runStats.kills * 50) + (runStats.victory ? 300 : 0) + (runStats.headshots * 20) + 100
    }
  };
}

// 戰術撤離結算：存檔、物資併入倉庫、死亡丢裝懲罰
export function saveMatchLoot(username, runStats, backpack, survived) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) return null;

  const user = accounts[idx];
  
  // 累加生涯戰績
  user.stats.gamesPlayed += 1;
  user.stats.kills += runStats.kills;
  user.stats.headshots += runStats.headshots;
  user.stats.shotsFired += runStats.shotsFired;
  user.stats.shotsHit += runStats.shotsHit;
  user.stats.playTimeSeconds += runStats.playTimeSeconds;

  if (survived) {
    user.stats.wins += 1;
    const currentRunScore = (runStats.kills * 100) + 500;
    user.stats.highScore = Math.max(user.stats.highScore, currentRunScore);

    // 將搜刮背包內的物資加入倉庫
    if (backpack) {
      Object.keys(backpack).forEach(key => {
        if (key === 'coins') {
          user.coins += backpack[key];
        } else if (user.stash[key] !== undefined) {
          user.stash[key] += backpack[key];
        }
      });
    }
  } else {
    // 戰死懲罰：丟失所有已裝備欄位裝備
    user.equipped = {
      primaryWeapon: null,
      secondaryWeapon: null,
      bodyArmor: false,
      opsHelmet: false,
      grenades: 0,
      medkits: 0
    };
    
    const currentRunScore = runStats.kills * 100;
    user.stats.highScore = Math.max(user.stats.highScore, currentRunScore);
  }

  // 成就更新
  if (user.stats.kills >= 1) user.achievements.firstBlood = true;
  if (user.stats.headshots >= 5) user.achievements.deadeye = true;
  if (user.stats.wins >= 1) user.achievements.survivor = true;
  if (user.stats.shotsFired >= 500) user.achievements.heavyGunner = true;

  saveAccounts(accounts);
  return {
    username: user.username,
    nickname: user.nickname,
    stats: user.stats,
    achievements: user.achievements,
    coins: user.coins,
    stash: user.stash,
    equipped: user.equipped
  };
}

// 配裝穿戴
export function equipItem(username, slot, itemId) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) throw new Error('找不到該帳號！');

  const user = accounts[idx];
  
  if (slot === 'primaryWeapon' || slot === 'secondaryWeapon') {
    // 卸下原武器
    if (user.equipped[slot]) {
      const prevWeapon = user.equipped[slot];
      user.stash[prevWeapon] += 1;
    }
    
    if (!itemId) {
      user.equipped[slot] = null;
    } else {
      if (user.stash[itemId] <= 0) throw new Error('倉庫中無此武器！');
      user.stash[itemId] -= 1;
      user.equipped[slot] = itemId;
    }
  } else if (slot === 'bodyArmor' || slot === 'opsHelmet') {
    // 卸下原護具
    if (user.equipped[slot]) {
      user.stash[slot] += 1;
    }
    
    if (!itemId) {
      user.equipped[slot] = false;
    } else {
      if (user.stash[slot] <= 0) throw new Error('倉庫中無此裝備！');
      user.stash[slot] -= 1;
      user.equipped[slot] = true;
    }
  } else if (slot === 'grenades' || slot === 'medkits') {
    const stashKey = slot === 'grenades' ? 'grenade' : 'medkit';
    if (user.stash[stashKey] <= 0) throw new Error('倉庫中無此消耗品！');
    user.stash[stashKey] -= 1;
    user.equipped[slot] += 1;
  }

  saveAccounts(accounts);
  return {
    username: user.username,
    nickname: user.nickname,
    stats: user.stats,
    achievements: user.achievements,
    coins: user.coins,
    stash: user.stash,
    equipped: user.equipped
  };
}

// 配裝卸下
export function unequipItem(username, slot) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) throw new Error('找不到該帳號！');

  const user = accounts[idx];

  if (slot === 'primaryWeapon' || slot === 'secondaryWeapon') {
    if (user.equipped[slot]) {
      const prevWeapon = user.equipped[slot];
      user.stash[prevWeapon] += 1;
      user.equipped[slot] = null;
    }
  } else if (slot === 'bodyArmor' || slot === 'opsHelmet') {
    if (user.equipped[slot]) {
      user.stash[slot] += 1;
      user.equipped[slot] = false;
    }
  } else if (slot === 'grenades' || slot === 'medkits') {
    if (user.equipped[slot] > 0) {
      const stashKey = slot === 'grenades' ? 'grenade' : 'medkit';
      user.equipped[slot] -= 1;
      user.stash[stashKey] += 1;
    }
  }

  saveAccounts(accounts);
  return {
    username: user.username,
    nickname: user.nickname,
    stats: user.stats,
    achievements: user.achievements,
    coins: user.coins,
    stash: user.stash,
    equipped: user.equipped
  };
}

// 黑市購入
export function buyMarketItem(username, itemId, cost) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) throw new Error('找不到該帳號！');

  const user = accounts[idx];
  if (user.coins < cost) throw new Error('Delta 幣不足！');

  user.coins -= cost;
  
  const stashKey = itemId;
  if (user.stash[stashKey] === undefined) {
    user.stash[stashKey] = 0;
  }
  user.stash[stashKey] += 1;

  saveAccounts(accounts);
  return {
    username: user.username,
    nickname: user.nickname,
    stats: user.stats,
    achievements: user.achievements,
    coins: user.coins,
    stash: user.stash,
    equipped: user.equipped
  };
}

// 黑市售出物資
export function sellMarketItem(username, itemId, value) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) throw new Error('找不到該帳號！');

  const user = accounts[idx];
  const stashKey = itemId;

  if (user.stash[stashKey] === undefined || user.stash[stashKey] <= 0) {
    throw new Error('倉庫中無此物品可售出！');
  }

  user.stash[stashKey] -= 1;
  user.coins += value;

  saveAccounts(accounts);
  return {
    username: user.username,
    nickname: user.nickname,
    stats: user.stats,
    achievements: user.achievements,
    coins: user.coins,
    stash: user.stash,
    equipped: user.equipped
  };
}

// 商店裝備清單 (原配方相容)
export const SHOP_ITEMS = [
  { id: 'laserSight', name: 'M4A1 雷射瞄準器', englishName: 'M4A1 Laser Sight', cost: 800, description: '提升主武器 M4A1 的威力，普通射擊傷害由 25 提升至 30。', category: 'weapon' },
  { id: 'suppressor', name: 'M9 戰術消音器', englishName: 'M9 Tactical Suppressor', cost: 500, description: '提升副武器 M9 手槍的威力，普通射擊傷害由 15 提升至 20。', category: 'weapon' },
  { id: 'bodyArmor', name: '重型防彈衣', englishName: 'Heavy Body Armor', cost: 1000, description: '出擊時初始生命值（Health）由 100 提升至 150。', category: 'armor' },
  { id: 'grenadePouch', name: '戰術手榴彈袋', englishName: 'Tactical Grenade Pouch', cost: 600, description: '出擊時初始攜帶手榴彈數量由 2 顆提升至 3 顆。', category: 'gear' },
  { id: 'opsHelmet', name: '特種作戰頭盔', englishName: 'Special Ops Helmet', cost: 1200, description: '提供頭部防護，使受到敵軍子彈射擊的傷害減少 25%。', category: 'armor' }
];

export function purchaseItem(username, itemId) {
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) throw new Error('找不到該帳號！');
  const user = accounts[idx];
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) throw new Error('找不到該商品！');
  if (user.coins < item.cost) throw new Error('Delta 金幣不足！');
  user.coins -= item.cost;
  saveAccounts(accounts);
  return user;
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

// 取得排行榜
export function getLeaderboard() {
  const accounts = getAccounts();
  const sorted = accounts.map(a => {
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

  sorted.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return b.wins - a.wins;
  });

  return sorted;
}
