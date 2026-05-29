// DELTA FORCE 3D - Account System Utility with Persistent Grid Stash & Loadout
import { ATTACHMENTS } from '../config/attachmentsConfig';
import { cloudConfig } from '../config/cloudConfig';

const STORAGE_KEY = 'delta_3d_accounts';

// 雲端帳號同步輔助函數
async function fetchCloudAccount(username) {
  const { provider } = cloudConfig;
  if (provider === 'local') return null;

  try {
    if (provider === 'kvdb') {
      const bucketId = cloudConfig.kvdb.bucketId;
      const url = `https://kvdb.io/${bucketId}/accounts_${encodeURIComponent(username.toLowerCase())}`;
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`KVdb 錯誤碼: ${res.status}`);
      return await res.json();
    }

    if (provider === 'firebase') {
      if (!cloudConfig.firebase.databaseURL) return null;
      const dbUrl = cloudConfig.firebase.databaseURL.replace(/\/$/, '');
      const url = `${dbUrl}/accounts/${encodeURIComponent(username.toLowerCase())}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Firebase 錯誤碼: ${res.status}`);
      return await res.json();
    }

    if (provider === 'supabase') {
      if (!cloudConfig.supabase.url || !cloudConfig.supabase.anonKey) return null;
      const clientUrl = cloudConfig.supabase.url.replace(/\/$/, '');
      const tableName = cloudConfig.supabase.accountsTableName || 'accounts';
      const url = `${clientUrl}/rest/v1/${tableName}?username=eq.${encodeURIComponent(username.toLowerCase())}&select=*`;
      const res = await fetch(url, {
        headers: {
          'apikey': cloudConfig.supabase.anonKey,
          'Authorization': `Bearer ${cloudConfig.supabase.anonKey}`
        }
      });
      if (!res.ok) throw new Error(`Supabase 錯誤碼: ${res.status}`);
      const data = await res.json();
      if (data && data.length > 0) {
        const accountData = data[0];
        if (accountData.data) {
          if (typeof accountData.data === 'string') {
            return JSON.parse(accountData.data);
          }
          return accountData.data;
        }
        return accountData;
      }
      return null;
    }
  } catch (err) {
    console.error(`無法從雲端下載 ${username} 的帳號資料:`, err);
  }
  return null;
}

async function saveCloudAccount(user) {
  const { provider } = cloudConfig;
  if (provider === 'local') return;

  try {
    if (provider === 'kvdb') {
      const bucketId = cloudConfig.kvdb.bucketId;
      const url = `https://kvdb.io/${bucketId}/accounts_${encodeURIComponent(user.username.toLowerCase())}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
      });
      if (!res.ok) throw new Error(`KVdb 錯誤碼: ${res.status}`);
    }

    if (provider === 'firebase') {
      if (!cloudConfig.firebase.databaseURL) return;
      const dbUrl = cloudConfig.firebase.databaseURL.replace(/\/$/, '');
      const url = `${dbUrl}/accounts/${encodeURIComponent(user.username.toLowerCase())}.json`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
      });
      if (!res.ok) throw new Error(`Firebase 錯誤碼: ${res.status}`);
    }

    if (provider === 'supabase') {
      if (!cloudConfig.supabase.url || !cloudConfig.supabase.anonKey) return;
      const clientUrl = cloudConfig.supabase.url.replace(/\/$/, '');
      const tableName = cloudConfig.supabase.accountsTableName || 'accounts';
      const url = `${clientUrl}/rest/v1/${tableName}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': cloudConfig.supabase.anonKey,
          'Authorization': `Bearer ${cloudConfig.supabase.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          username: user.username.toLowerCase(),
          data: user
        })
      });
      if (!res.ok) throw new Error(`Supabase 錯誤碼: ${res.status}`);
    }
  } catch (err) {
    console.error(`無法將 ${user.username} 的帳號資料同步至雲端:`, err);
  }
}

// 取得不同物品佔用的網格尺寸 [寬, 高]
export function getItemSize(itemId) {
  if (itemId === 'm4a1' || itemId === 'ak47' || itemId === 'm870') return [4, 2];
  if (itemId === 'awp') return [5, 2];
  if (itemId === 'mp5') return [3, 2];
  if (itemId === 'm9') return [2, 1];
  if (itemId === 'deagle') return [2, 2];
  if (itemId === 'bodyArmor' || itemId === 'opsHelmet') return [2, 2];
  if (itemId === 'goldBar') return [1, 2];
  
  // 戰術配件 (在 attachmentsConfig 中定義)
  if (itemId.startsWith('sight_') || itemId.startsWith('muzzle_') || itemId.startsWith('grip_') || itemId.startsWith('mag_')) {
    return [1, 1];
  }
  
  // 預設 (手榴彈, 醫療包, 加密硬碟, 軍牌) 為 1x1
  return [1, 1];
}

// 產生隨機唯一 ID
export function generateUid() {
  return 'item_' + Math.random().toString(36).substr(2, 9);
}

// 尋找 10 x N 網格中的第一個空位
export function findEmptySpace(items, w, h) {
  const GRID_COLS = 10;
  const GRID_ROWS = 40; // 擴展到 40 行，防止倉庫溢出
  
  for (let r = 0; r <= GRID_ROWS - h; r++) {
    for (let c = 0; c <= GRID_COLS - w; c++) {
      let overlap = false;
      for (const item of items) {
        const [iw, ih] = getItemSize(item.type);
        const ir = item.r;
        const ic = item.c;
        
        // Bounding Box 碰撞檢測
        const xOverlap = !(c + w <= ic || ic + iw <= c);
        const yOverlap = !(r + h <= ir || ir + ih <= r);
        if (xOverlap && yOverlap) {
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        return { r, c };
      }
    }
  }
  return null; // 倉庫全滿
}

// 統一初始化與升級網格倉庫與配裝結構
export function initializeGridStash(user) {
  if (!user) return null;
  
  // 確保基礎 stash 存在
  if (!user.stash) {
    user.stash = {
      m4a1: 0, ak47: 0, awp: 0, mp5: 0, m870: 0, m9: 0, deagle: 0,
      bodyArmor: 0, opsHelmet: 0, grenade: 0, medkit: 0,
      goldBar: 0, hardDrive: 0, dogTag: 0, keycard: 0, flashbang: 0, smoke: 0, knife: 0
    };
  }
  
  // 確保 equipped 配裝槽與配件插槽存在
  if (!user.equipped) {
    user.equipped = {
      primaryWeapon: null,
      primaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
      secondaryWeapon: null,
      secondaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
      bodyArmor: false,
      opsHelmet: false,
      grenades: 0,
      medkits: 0
    };
  } else {
    if (!user.equipped.primaryAttachments) {
      user.equipped.primaryAttachments = { sight: null, muzzle: null, grip: null, magazine: null };
    }
    if (!user.equipped.secondaryAttachments) {
      user.equipped.secondaryAttachments = { sight: null, muzzle: null, grip: null, magazine: null };
    }
  }

  // 若尚未有 gridStashItems，從舊 stash 映射拆箱轉換
  if (user.gridStashItems === undefined) {
    user.gridStashItems = [];
    
    Object.keys(user.stash).forEach(itemId => {
      const quantity = user.stash[itemId] || 0;
      for (let i = 0; i < quantity; i++) {
        const [w, h] = getItemSize(itemId);
        const space = findEmptySpace(user.gridStashItems, w, h);
        if (space) {
          const itemObj = {
            uid: generateUid(),
            type: itemId,
            r: space.r,
            c: space.c
          };
          // 武器初始化配件插槽
          if (itemId === 'm4a1' || itemId === 'ak47' || itemId === 'awp' || itemId === 'mp5' || itemId === 'm870' || itemId === 'm9' || itemId === 'deagle') {
            itemObj.attachments = { sight: null, muzzle: null, grip: null, magazine: null };
          }
          user.gridStashItems.push(itemObj);
        }
      }
    });
  }
  
  return user;
}

// 取得所有本機帳號
export function getAccounts() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return [];
  try {
    const list = JSON.parse(data);
    let changed = false;
    list.forEach(a => {
      // 升級相容倉庫 Stash 系統
      const prevGrid = a.gridStashItems;
      initializeGridStash(a);
      if (prevGrid === undefined) {
        changed = true;
      }
      
      // 補全可能新增的配件欄位
      Object.keys(ATTACHMENTS).forEach(attKey => {
        if (a.stash[attKey] === undefined) {
          a.stash[attKey] = 0;
          changed = true;
        }
      });

      // 補全可能新增的特殊道具與武器
      const newItems = ['keycard', 'flashbang', 'smoke', 'knife'];
      newItems.forEach(itemKey => {
        if (a.stash[itemKey] === undefined) {
          a.stash[itemKey] = 0;
          changed = true;
        }
      });
      
      if (a.coins === undefined) {
        a.coins = 2000;
        changed = true;
      }

      // 一次性升級現有 "distant star" 帳號為本機管理員並賦予無限金幣
      if (a.username && a.username.toLowerCase() === 'distant star') {
        if (!a.isAdmin || a.coins !== 99999999) {
          a.isAdmin = true;
          a.coins = 99999999;
          changed = true;
        }
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
export async function registerAccount(username, nickname, password) {
  if (!username || !nickname || !password) {
    throw new Error('所有欄位皆為必填！');
  }

  // 1. 檢查本機快取是否存在
  const accounts = getAccounts();
  const exists = accounts.some(a => a.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    throw new Error('此帳號已存在！');
  }

  // 2. 檢查雲端是否已存在此帳號
  let cloudUser = null;
  try {
    cloudUser = await fetchCloudAccount(username);
  } catch (err) {
    console.error('註冊時從雲端檢查帳號失敗:', err);
  }
  if (cloudUser) {
    throw new Error('此帳號已存在！');
  }

  const newAccount = {
    username,
    nickname,
    password,
    coins: 2000,
    stash: {
      m4a1: 2,
      ak47: 0,
      awp: 0,
      mp5: 0,
      m870: 0,
      m9: 2,
      deagle: 0,
      bodyArmor: 2,
      opsHelmet: 2,
      grenade: 4,
      medkit: 4,
      goldBar: 0,
      hardDrive: 0,
      dogTag: 0,
      keycard: 0,
      flashbang: 2,
      smoke: 2,
      knife: 1
    },
    equipped: {
      primaryWeapon: 'm4a1',
      primaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
      secondaryWeapon: 'm9',
      secondaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
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

  initializeGridStash(newAccount);
  accounts.push(newAccount);
  saveAccounts(accounts);

  // 3. 同步新帳號至雲端
  try {
    await saveCloudAccount(newAccount);
  } catch (err) {
    console.error('無法儲存新帳號至雲端:', err);
  }

  return newAccount;
}

// 登入帳號
export async function loginAccount(username, password) {
  if (!username || !password) {
    throw new Error('帳號與密碼皆為必填！');
  }

  // 1. 優先嘗試從雲端獲取帳號資料（支援跨裝置）
  let cloudUser = null;
  try {
    cloudUser = await fetchCloudAccount(username);
  } catch (err) {
    console.error('登入時從雲端獲取帳號失敗:', err);
  }

  if (cloudUser) {
    if (cloudUser.password !== password) {
      throw new Error('帳號或密碼錯誤！');
    }
    initializeGridStash(cloudUser);
    
    // 更新或寫入本機快取
    const accounts = getAccounts();
    const idx = accounts.findIndex(a => a.username.toLowerCase() === username.toLowerCase());
    if (idx > -1) {
      accounts[idx] = cloudUser;
    } else {
      accounts.push(cloudUser);
    }
    saveAccounts(accounts);
    return cloudUser;
  }

  // 2. 雲端找不到或失敗，退回本機快取驗證（保證離線相容性）
  const accounts = getAccounts();
  const user = accounts.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!user || user.password !== password) {
    throw new Error('帳號或密碼錯誤！');
  }
  initializeGridStash(user);

  // 如果本機存在該帳號，但剛才在雲端沒有找到，自動同步上傳至雲端（以便日後進行跨裝置登入）
  if (!cloudUser) {
    saveCloudAccount(user).catch(err => {
      console.error('自動上傳本機帳號至雲端失敗:', err);
    });
  }

  return user;
}

// 修改暱稱
export function updateNickname(username, newNickname) {
  if (!newNickname || !newNickname.trim()) {
    throw new Error('暱稱不得為空！');
  }
  const accounts = getAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  if (idx === -1) throw new Error('找不到該帳號！');
  accounts[idx].nickname = newNickname.trim();
  saveAccounts(accounts);
  
  // 背景同步至雲端
  saveCloudAccount(accounts[idx]).catch(err => {
    console.error('修改暱稱時雲端同步失敗:', err);
  });
  
  return accounts[idx];
}

// 更新遊玩戰績
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
  
  // 背景同步至雲端
  saveCloudAccount(user).catch(err => {
    console.error('更新戰績時雲端同步失敗:', err);
  });

  return {
    user: user,
    coinsEarnedDetails: {
      killsCoins: runStats.kills * 50,
      victoryCoins: runStats.victory ? 300 : 0,
      headshotsCoins: runStats.headshots * 20,
      accuracyCoins: 100,
      total: (runStats.kills * 50) + (runStats.victory ? 300 : 0) + (runStats.headshots * 20) + 100
    }
  };
}

// 獲取一個特定使用者（相容 user 物件或是 username）
function resolveUser(userParam) {
  let currentUser = userParam;
  let isRegistered = true;
  let accounts = [];
  let idx = -1;

  if (typeof userParam === 'string') {
    accounts = getAccounts();
    idx = accounts.findIndex(a => a.username.toLowerCase() === userParam.toLowerCase());
    if (idx === -1) throw new Error('找不到該帳號！');
    currentUser = accounts[idx];
  } else {
    if (currentUser.isGuest) {
      isRegistered = false;
    } else {
      accounts = getAccounts();
      idx = accounts.findIndex(a => a.username.toLowerCase() === currentUser.username.toLowerCase());
      if (idx === -1) throw new Error('找不到該帳號！');
      currentUser = accounts[idx];
    }
  }
  
  initializeGridStash(currentUser);
  
  return { currentUser, isRegistered, accounts, idx };
}

// 儲存修改後的使用者資料
function finalizeUserSave(userData) {
  const { currentUser, isRegistered, accounts } = userData;
  if (isRegistered) {
    saveAccounts(accounts);
    
    // 背景同步至雲端
    saveCloudAccount(currentUser).catch(err => {
      console.error('修改使用者資料時背景同步失敗:', err);
    });
  }
  return { ...currentUser };
}

// 拖曳整理倉庫物品位置
export function moveGridItem(userParam, itemUid, r, c) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
  const item = user.gridStashItems.find(i => i.uid === itemUid);
  if (!item) throw new Error('找不到該物品！');
  
  const [w, h] = getItemSize(item.type);
  
  // 檢查越界
  if (c < 0 || c + w > 10 || r < 0) {
    throw new Error('物品位置超出邊界！');
  }
  
  // 檢查是否與其他物品重疊（排除自己）
  for (const other of user.gridStashItems) {
    if (other.uid === itemUid) continue;
    const [ow, oh] = getItemSize(other.type);
    const xOverlap = !(c + w <= other.c || other.c + ow <= c);
    const yOverlap = !(r + h <= other.r || other.r + oh <= r);
    if (xOverlap && yOverlap) {
      throw new Error('位置已被佔用，無法放置！');
    }
  }
  
  item.r = r;
  item.c = c;
  
  return finalizeUserSave(data);
}

// 配裝穿戴 (將特定 Grid Stash 中的物品移至 Loadout 槽位)
export function equipItem(userParam, slot, itemUid) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
  if (slot === 'primaryWeapon' || slot === 'secondaryWeapon') {
    const itemIdx = user.gridStashItems.findIndex(i => i.uid === itemUid);
    if (itemIdx === -1) throw new Error('倉庫中無此武器！');
    const item = user.gridStashItems[itemIdx];
    
    // 卸下原武器
    if (user.equipped[slot]) {
      const prevWeaponType = user.equipped[slot];
      const space = findEmptySpace(user.gridStashItems, ...getItemSize(prevWeaponType));
      if (!space) throw new Error('倉庫已滿，無法卸下原裝備！');
      
      const attsKey = slot === 'primaryWeapon' ? 'primaryAttachments' : 'secondaryAttachments';
      user.gridStashItems.push({
        uid: generateUid(),
        type: prevWeaponType,
        r: space.r,
        c: space.c,
        attachments: { ...user.equipped[attsKey] }
      });
    }
    
    // 裝備新武器與其配件
    user.equipped[slot] = item.type;
    const attsKey = slot === 'primaryWeapon' ? 'primaryAttachments' : 'secondaryAttachments';
    user.equipped[attsKey] = item.attachments ? { ...item.attachments } : { sight: null, muzzle: null, grip: null, magazine: null };
    
    // 從倉庫網格中移除
    user.gridStashItems.splice(itemIdx, 1);
  } 
  else if (slot === 'bodyArmor' || slot === 'opsHelmet' || slot === 'laserSight' || slot === 'suppressor') {
    const itemIdx = user.gridStashItems.findIndex(i => i.type === slot);
    if (itemIdx === -1) throw new Error('倉庫中無此裝備或配件！');
    
    // 卸下原防具/配件
    if (user.equipped[slot]) {
      const [w, h] = getItemSize(slot);
      const space = findEmptySpace(user.gridStashItems, w, h);
      if (!space) throw new Error('倉庫已滿，無法卸下原裝備！');
      user.gridStashItems.push({
        uid: generateUid(),
        type: slot,
        r: space.r,
        c: space.c
      });
    }
    
    user.equipped[slot] = true;
    user.gridStashItems.splice(itemIdx, 1);
  } 
  else if (slot === 'grenades' || slot === 'medkits') {
    const itemType = slot === 'grenades' ? 'grenade' : 'medkit';
    const itemIdx = user.gridStashItems.findIndex(i => i.type === itemType);
    if (itemIdx === -1) throw new Error('倉庫中無此消耗品！');
    
    user.equipped[slot] += 1;
    user.gridStashItems.splice(itemIdx, 1);
  }

  // 重新計算 stash 數量對照表以維持相容性
  syncStashQuantities(user);
  
  return finalizeUserSave(data);
}

// 配裝卸下 (將 Loadout 中的裝備放回 Grid Stash 中)
export function unequipItem(userParam, slot) {
  const data = resolveUser(userParam);
  const user = data.currentUser;

  if (slot === 'primaryWeapon' || slot === 'secondaryWeapon') {
    if (user.equipped[slot]) {
      const prevWeaponType = user.equipped[slot];
      const space = findEmptySpace(user.gridStashItems, ...getItemSize(prevWeaponType));
      if (!space) throw new Error('倉庫已滿，請先整理出空間！');
      
      const attsKey = slot === 'primaryWeapon' ? 'primaryAttachments' : 'secondaryAttachments';
      user.gridStashItems.push({
        uid: generateUid(),
        type: prevWeaponType,
        r: space.r,
        c: space.c,
        attachments: { ...user.equipped[attsKey] }
      });
      
      user.equipped[slot] = null;
      user.equipped[attsKey] = { sight: null, muzzle: null, grip: null, magazine: null };
    }
  } 
  else if (slot === 'bodyArmor' || slot === 'opsHelmet' || slot === 'laserSight' || slot === 'suppressor') {
    if (user.equipped[slot]) {
      const [w, h] = getItemSize(slot);
      const space = findEmptySpace(user.gridStashItems, w, h);
      if (!space) throw new Error('倉庫已滿，請先整理出空間！');
      user.gridStashItems.push({
        uid: generateUid(),
        type: slot,
        r: space.r,
        c: space.c
      });
      user.equipped[slot] = false;
    }
  } 
  else if (slot === 'grenades' || slot === 'medkits') {
    if (user.equipped[slot] > 0) {
      const itemType = slot === 'grenades' ? 'grenade' : 'medkit';
      const space = findEmptySpace(user.gridStashItems, 1, 1);
      if (!space) throw new Error('倉庫已滿，請先整理出空間！');
      
      user.gridStashItems.push({
        uid: generateUid(),
        type: itemType,
        r: space.r,
        c: space.c
      });
      user.equipped[slot] -= 1;
    }
  }

  syncStashQuantities(user);
  
  return finalizeUserSave(data);
}

// 黑市購入物資 (新增到網格中)
export function buyMarketItem(userParam, itemId, cost) {
  const data = resolveUser(userParam);
  const user = data.currentUser;

  if (user.coins < cost) throw new Error('Delta 幣不足！');
  
  const [w, h] = getItemSize(itemId);
  const space = findEmptySpace(user.gridStashItems, w, h);
  if (!space) throw new Error('倉庫已滿，請先整理出空間再行購買！');

  user.coins -= cost;
  
  const itemObj = {
    uid: generateUid(),
    type: itemId,
    r: space.r,
    c: space.c
  };
  if (itemId === 'm4a1' || itemId === 'ak47' || itemId === 'awp' || itemId === 'mp5' || itemId === 'm870' || itemId === 'm9' || itemId === 'deagle') {
    itemObj.attachments = { sight: null, muzzle: null, grip: null, magazine: null };
  }
  
  user.gridStashItems.push(itemObj);
  syncStashQuantities(user);
  
  return finalizeUserSave(data);
}

// 黑市售出網格倉庫中指定 UID 物品
export function sellMarketItemByUid(userParam, itemUid, value) {
  const data = resolveUser(userParam);
  const user = data.currentUser;

  const itemIdx = user.gridStashItems.findIndex(i => i.uid === itemUid);
  if (itemIdx === -1) throw new Error('找不到該物品！');

  user.gridStashItems.splice(itemIdx, 1);
  user.coins += value;
  
  syncStashQuantities(user);
  
  return finalizeUserSave(data);
}

// 黑市售出物品 (相容原舊寫法，ItemId 過濾首個該類物品)
export function sellMarketItem(userParam, itemId, value) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
  const itemIdx = user.gridStashItems.findIndex(i => i.type === itemId);
  if (itemIdx === -1) throw new Error('倉庫中無此物資可販售！');
  
  user.gridStashItems.splice(itemIdx, 1);
  user.coins += value;
  
  syncStashQuantities(user);
  
  return finalizeUserSave(data);
}

// 安裝配件到倉庫中的武器
export function equipAttachmentToWeapon(userParam, weaponUid, attachmentUid) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
  const weapon = user.gridStashItems.find(i => i.uid === weaponUid);
  if (!weapon) throw new Error('找不到該武器！');
  
  const attIdx = user.gridStashItems.findIndex(i => i.uid === attachmentUid);
  if (attIdx === -1) throw new Error('找不到該配件！');
  const attachment = user.gridStashItems[attIdx];
  
  const attConfig = ATTACHMENTS[attachment.type];
  if (!attConfig) throw new Error('無效的配件配置！');
  
  // 檢查插槽
  const slotType = attConfig.type;
  if (weapon.attachments[slotType] !== undefined) {
    // 卸下原配件
    if (weapon.attachments[slotType]) {
      const prevAtt = weapon.attachments[slotType];
      const space = findEmptySpace(user.gridStashItems, 1, 1);
      if (!space) throw new Error('倉庫已滿，無法拆除原配件！');
      user.gridStashItems.push({
        uid: generateUid(),
        type: prevAtt,
        r: space.r,
        c: space.c
      });
    }
    
    // 安裝
    weapon.attachments[slotType] = attachment.type;
    user.gridStashItems.splice(attIdx, 1);
  } else {
    throw new Error('此武器不支援該改裝插槽！');
  }
  
  syncStashQuantities(user);
  return finalizeUserSave(data);
}

// 拆卸倉庫武器中的配件
export function unequipAttachmentFromWeapon(userParam, weaponUid, slotType) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
  const weapon = user.gridStashItems.find(i => i.uid === weaponUid);
  if (!weapon) throw new Error('找不到該武器！');
  
  if (weapon.attachments && weapon.attachments[slotType]) {
    const space = findEmptySpace(user.gridStashItems, 1, 1);
    if (!space) throw new Error('倉庫已滿，請先整理出空間！');
    
    const attType = weapon.attachments[slotType];
    user.gridStashItems.push({
      uid: generateUid(),
      type: attType,
      r: space.r,
      c: space.c
    });
    
    weapon.attachments[slotType] = null;
  }
  
  syncStashQuantities(user);
  return finalizeUserSave(data);
}

// 安裝配件到已配備裝備的武器
export function equipAttachmentToEquippedWeapon(userParam, weaponSlot, attachmentUid) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
  const weaponType = user.equipped[weaponSlot];
  if (!weaponType) throw new Error('該裝備槽目前沒有配備武器！');
  
  const attIdx = user.gridStashItems.findIndex(i => i.uid === attachmentUid);
  if (attIdx === -1) throw new Error('找不到該配件！');
  const attachment = user.gridStashItems[attIdx];
  
  const attConfig = ATTACHMENTS[attachment.type];
  if (!attConfig) throw new Error('無效的配件配置！');
  
  const slotType = attConfig.type;
  const attsKey = weaponSlot === 'primaryWeapon' ? 'primaryAttachments' : 'secondaryAttachments';
  
  if (user.equipped[attsKey][slotType] !== undefined) {
    if (user.equipped[attsKey][slotType]) {
      const prevAtt = user.equipped[attsKey][slotType];
      const space = findEmptySpace(user.gridStashItems, 1, 1);
      if (!space) throw new Error('倉庫已滿，無法拆除原配件！');
      user.gridStashItems.push({
        uid: generateUid(),
        type: prevAtt,
        r: space.r,
        c: space.c
      });
    }
    
    user.equipped[attsKey][slotType] = attachment.type;
    user.gridStashItems.splice(attIdx, 1);
  } else {
    throw new Error('此配備武器不支援該改裝插槽！');
  }
  
  syncStashQuantities(user);
  return finalizeUserSave(data);
}

// 拆卸已配備武器的配件
export function unequipAttachmentFromEquippedWeapon(userParam, weaponSlot, slotType) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
  const attsKey = weaponSlot === 'primaryWeapon' ? 'primaryAttachments' : 'secondaryAttachments';
  
  if (user.equipped[attsKey] && user.equipped[attsKey][slotType]) {
    const space = findEmptySpace(user.gridStashItems, 1, 1);
    if (!space) throw new Error('倉庫已滿，請先整理出空間！');
    
    const attType = user.equipped[attsKey][slotType];
    user.gridStashItems.push({
      uid: generateUid(),
      type: attType,
      r: space.r,
      c: space.c
    });
    
    user.equipped[attsKey][slotType] = null;
  }
  
  syncStashQuantities(user);
  return finalizeUserSave(data);
}

// 同步 gridStashItems 清單到原 user.stash 以維持相容性
function syncStashQuantities(user) {
  // 重置數量
  Object.keys(user.stash).forEach(k => {
    user.stash[k] = 0;
  });
  
  // 加上網格倉庫中的物品
  user.gridStashItems.forEach(item => {
    if (user.stash[item.type] !== undefined) {
      user.stash[item.type] += 1;
    } else {
      user.stash[item.type] = 1;
    }
  });
}

// 戰術撤離結算：存檔、物資併入網格倉庫、死亡丢裝懲罰
export function saveMatchLoot(userParam, runStats, backpack, survived) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
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
      // backpack 可以是 `{ type: count }` 或是 `[{ type: itemId }]`
      if (Array.isArray(backpack)) {
        backpack.forEach(bpItem => {
          if (bpItem.type === 'coins') {
            user.coins += (bpItem.count || 0);
            return;
          }
          const [w, h] = getItemSize(bpItem.type);
          const space = findEmptySpace(user.gridStashItems, w, h);
          // 若倉庫滿了，動態在最下方加一行直到放得下為止
          let finalSpace = space;
          let fallbackRow = 20;
          while (!finalSpace) {
            finalSpace = findEmptySpace(user.gridStashItems, w, h);
            if (!finalSpace) {
              // 模擬倉庫動態延展：如果完全找不到空位，強制排在最底層空位上
              // 實際上，由於 findEmptySpace 中 GRID_ROWS = 40，只要行數夠多就不會為 null
              break;
            }
          }
          if (finalSpace) {
            const itemObj = {
              uid: generateUid(),
              type: bpItem.type,
              r: finalSpace.r,
              c: finalSpace.c
            };
            if (bpItem.type === 'm4a1' || bpItem.type === 'ak47' || bpItem.type === 'awp' || bpItem.type === 'mp5' || bpItem.type === 'm870' || bpItem.type === 'm9' || bpItem.type === 'deagle') {
              itemObj.attachments = bpItem.attachments ? { ...bpItem.attachments } : { sight: null, muzzle: null, grip: null, magazine: null };
            }
            user.gridStashItems.push(itemObj);
          }
        });
      } else {
        // 物資為簡單 mapping (如 { coins: 300, goldBar: 1, grenade: 1 })
        Object.keys(backpack).forEach(key => {
          if (key === 'coins') {
            user.coins += backpack[key];
          } else {
            const count = backpack[key] || 0;
            for (let i = 0; i < count; i++) {
              const [w, h] = getItemSize(key);
              const space = findEmptySpace(user.gridStashItems, w, h);
              if (space) {
                const itemObj = {
                  uid: generateUid(),
                  type: key,
                  r: space.r,
                  c: space.c
                };
                if (key === 'm4a1' || key === 'ak47' || key === 'awp' || key === 'mp5' || key === 'm870' || key === 'm9' || key === 'deagle') {
                  itemObj.attachments = { sight: null, muzzle: null, grip: null, magazine: null };
                }
                user.gridStashItems.push(itemObj);
              }
            }
          }
        });
      }
    }
  } else {
    // 戰死懲罰：丟失所有已裝備欄位裝備
    user.equipped = {
      primaryWeapon: null,
      primaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
      secondaryWeapon: null,
      secondaryAttachments: { sight: null, muzzle: null, grip: null, magazine: null },
      bodyArmor: false,
      opsHelmet: false,
      grenades: 0,
      medkits: 0
    };
    
    const currentRunScore = runStats.kills * 100;
    user.stats.highScore = Math.max(user.stats.highScore, currentRunScore);
  }

  // 同步
  syncStashQuantities(user);
  
  // 成就更新
  if (user.stats.kills >= 1) user.achievements.firstBlood = true;
  if (user.stats.headshots >= 5) user.achievements.deadeye = true;
  if (user.stats.wins >= 1) user.achievements.survivor = true;
  if (user.stats.shotsFired >= 500) user.achievements.heavyGunner = true;

  return finalizeUserSave(data);
}

// 商店裝備清單
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
  
  // 背景同步至雲端
  saveCloudAccount(user).catch(err => {
    console.error('商店購買物品時雲端同步失敗:', err);
  });
  
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

// 根據武器配件修改基礎武器參數
export function getModifiedWeaponConfig(baseConfig, attachments) {
  if (!baseConfig) return null;
  const config = { ...baseConfig, spreadFactor: 1, reloadTimeFactor: 1, adsSpeedFactor: 1, silence: false };
  if (!attachments) return config;
  
  Object.keys(attachments).forEach(slot => {
    const attachmentId = attachments[slot];
    if (attachmentId) {
      const att = ATTACHMENTS[attachmentId];
      if (att && att.modifiers) {
        if (att.modifiers.recoil !== undefined) {
          config.recoil = Math.max(0.01, config.recoil * (1 + att.modifiers.recoil));
        }
        if (att.modifiers.extraCapacity !== undefined) {
          const amount = config.isPrimary ? 10 : 5;
          config.maxAmmo = config.maxAmmo + amount;
        }
        if (att.modifiers.spread !== undefined) {
          config.spreadFactor *= (1 + att.modifiers.spread);
        }
        if (att.modifiers.reloadTime !== undefined) {
          config.reloadTimeFactor *= (1 + att.modifiers.reloadTime);
        }
        if (att.modifiers.adsSpeed !== undefined) {
          config.adsSpeedFactor *= (1 + att.modifiers.adsSpeed);
        }
        if (att.modifiers.zoomFov !== undefined) {
          config.zoomFov = att.modifiers.zoomFov;
        }
        if (att.modifiers.silence !== undefined) {
          config.silence = att.modifiers.silence;
        }
      }
    }
  });
  return config;
}

// 領取任務合約獎勵
export function claimContractReward(userParam, contractId, reward) {
  const data = resolveUser(userParam);
  const user = data.currentUser;
  
  user.coins = (user.coins || 0) + reward;
  
  if (user.contracts) {
    user.contracts = user.contracts.map(c => {
      if (c.id === contractId) return { ...c, claimed: true };
      return c;
    });
  }
  
  return finalizeUserSave(data);
}

