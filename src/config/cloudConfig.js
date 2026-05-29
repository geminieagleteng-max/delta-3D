// Cloud Leaderboard Configuration
export const cloudConfig = {
  // Provider options: 'kvdb' (default), 'firebase', 'supabase', or 'local' (disabled)
  provider: import.meta.env.VITE_CLOUD_PROVIDER || 'kvdb',

  // 1. KVdb.io Configuration (Zero-config, ready to test)
  kvdb: {
    bucketId: import.meta.env.VITE_KVDB_BUCKET_ID || 'SvRpRiRe4ribTx6mcNDyBx',
    key: 'global_leaderboard'
  },

  // 2. Firebase Realtime Database Configuration (REST API)
  firebase: {
    // e.g., 'https://your-project-id-default-rtdb.firebaseio.com'
    databaseURL: import.meta.env.VITE_FIREBASE_DB_URL || ''
  },

  // 3. Supabase Configuration (REST API)
  supabase: {
    // e.g., 'https://your-project-id.supabase.co'
    url: import.meta.env.VITE_SUPABASE_URL || '',
    // e.g., your public anon key
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    tableName: 'leaderboard'
  }
};
