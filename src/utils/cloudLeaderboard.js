import { cloudConfig } from '../config/cloudConfig';

// Fetch the global leaderboard
export async function fetchCloudLeaderboard() {
  const { provider } = cloudConfig;
  
  if (provider === 'local') {
    return [];
  }

  try {
    if (provider === 'kvdb') {
      const url = `https://kvdb.io/${cloudConfig.kvdb.bucketId}/${cloudConfig.kvdb.key}`;
      const res = await fetch(url);
      if (res.status === 404) return []; // Bucket/Key doesn't exist yet
      if (!res.ok) throw new Error(`KVdb error: ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    }
    
    if (provider === 'firebase') {
      if (!cloudConfig.firebase.databaseURL) {
        throw new Error('Firebase Database URL not configured.');
      }
      // Strip trailing slash if present
      const dbUrl = cloudConfig.firebase.databaseURL.replace(/\/$/, '');
      const url = `${dbUrl}/leaderboard.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Firebase error: ${res.status}`);
      const data = await res.json();
      if (!data) return [];
      
      // Convert Firebase key-value object to sorted array
      const list = Object.keys(data).map(key => ({
        username: key,
        nickname: data[key].nickname,
        totalScore: data[key].totalScore || 0,
        highScore: data[key].highScore || 0,
        kills: data[key].kills || 0,
        wins: data[key].wins || 0,
        gamesPlayed: data[key].gamesPlayed || 0
      }));
      return sortLeaderboard(list);
    }
    
    if (provider === 'supabase') {
      if (!cloudConfig.supabase.url || !cloudConfig.supabase.anonKey) {
        throw new Error('Supabase Url/Key not configured.');
      }
      // Strip trailing slash if present
      const clientUrl = cloudConfig.supabase.url.replace(/\/$/, '');
      const url = `${clientUrl}/rest/v1/${cloudConfig.supabase.tableName}?select=*&order=totalScore.desc,kills.desc&limit=50`;
      const res = await fetch(url, {
        headers: {
          'apikey': cloudConfig.supabase.anonKey,
          'Authorization': `Bearer ${cloudConfig.supabase.anonKey}`
        }
      });
      if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
      return await res.json();
    }
  } catch (err) {
    console.error('Failed to fetch cloud leaderboard:', err);
    throw err;
  }
  return [];
}

// Sync player data to the cloud
export async function syncPlayerToCloud(username, nickname, stats) {
  const { provider } = cloudConfig;
  if (provider === 'local') return;

  const totalScore = (stats.kills * 100) + (stats.wins * 500);
  const payload = {
    nickname,
    totalScore,
    highScore: stats.highScore || 0,
    kills: stats.kills || 0,
    wins: stats.wins || 0,
    gamesPlayed: stats.gamesPlayed || 0
  };

  try {
    if (provider === 'kvdb') {
      // For KVdb, we must fetch-merge-write since it's a simple key-value store
      const url = `https://kvdb.io/${cloudConfig.kvdb.bucketId}/${cloudConfig.kvdb.key}`;
      let list = [];
      try {
        const res = await fetch(url);
        if (res.ok) {
          list = await res.json();
        }
      } catch {
        // Safe to ignore if bucket is empty/new
      }
      
      // Update or insert player record
      const index = list.findIndex(p => p.username === username);
      const playerRecord = { username, ...payload };
      if (index > -1) {
        list[index] = playerRecord;
      } else {
        list.push(playerRecord);
      }
      
      // Sort and trim to top 100 to save space
      list = sortLeaderboard(list).slice(0, 100);
      
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list)
      });
    }
    
    if (provider === 'firebase') {
      if (!cloudConfig.firebase.databaseURL) return;
      const dbUrl = cloudConfig.firebase.databaseURL.replace(/\/$/, '');
      const url = `${dbUrl}/leaderboard/${encodeURIComponent(username)}.json`;
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    
    if (provider === 'supabase') {
      if (!cloudConfig.supabase.url || !cloudConfig.supabase.anonKey) return;
      const clientUrl = cloudConfig.supabase.url.replace(/\/$/, '');
      const url = `${clientUrl}/rest/v1/${cloudConfig.supabase.tableName}`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': cloudConfig.supabase.anonKey,
          'Authorization': `Bearer ${cloudConfig.supabase.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          username,
          ...payload
        })
      });
    }
  } catch (err) {
    console.error('Failed to sync player stats to cloud:', err);
  }
}

function sortLeaderboard(list) {
  return list.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return b.wins - a.wins;
  });
}
