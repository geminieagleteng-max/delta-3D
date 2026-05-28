// Black Market Trade Prices Configuration
export const MARKET_PRICES = {
  // Purchasing prices from black market
  buy: {
    m4a1: 800,
    m9: 300,
    bodyArmor: 500,
    opsHelmet: 400,
    grenade: 100,
    medkit: 100
  },
  // Recycle prices sold back to market
  sell: {
    m4a1: 400,
    m9: 150,
    bodyArmor: 250,
    opsHelmet: 200,
    grenade: 50,
    medkit: 50,
    goldBar: 1200,
    hardDrive: 600,
    dogTag: 250
  }
};

// Item names mapping for UI display
export const ITEM_NAMES = {
  m4a1: 'M4A1 突擊步槍',
  m9: 'M9 戰術手槍',
  bodyArmor: '重型防彈衣',
  opsHelmet: '特種作戰頭盔',
  grenade: '戰術手榴彈',
  medkit: '戰地醫療包',
  goldBar: '純金金條',
  hardDrive: '機密加密硬碟',
  dogTag: '敵軍軍籍牌'
};
