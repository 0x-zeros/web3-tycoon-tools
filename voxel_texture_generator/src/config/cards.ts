/**
 * 卡牌纹理配置
 * 用于生成Web3大富翁游戏中的所有卡牌纹理
 */

export interface CardTextureConfig {
  kind: number;          // 卡牌类型ID
  name: string;          // 卡牌中文名称
  description: string;   // 卡牌描述
  targetType: number;    // 目标类型 (0=自己, 1=玩家, 2=地块)
  value: number;         // 效果值
  rarity: number;        // 稀有度 (0=普通, 1=稀有, 2=史诗)
  iconPath: string;      // 图标路径（用于生成文件名）
  displayText?: string;  // 显示文字（如果不同于name）
}

/**
 * 所有卡牌配置
 */
export const CARD_CONFIGS: CardTextureConfig[] = [
  {
    kind: 0,
    name: '遥控骰子',
    description: '控制下一次移动到指定位置',
    targetType: 2,
    value: 3,
    rarity: 0,
    iconPath: 'web3/cards/move_ctrl'
  },
  {
    kind: 1,
    name: '路障卡',
    description: '在地块上放置路障',
    targetType: 2,
    value: 0,
    rarity: 0,
    iconPath: 'web3/cards/barrier'
  },
  {
    kind: 2,
    name: '炸弹卡',
    description: '在地块上放置炸弹',
    targetType: 2,
    value: 0,
    rarity: 1,
    iconPath: 'web3/cards/bomb'
  },
  {
    kind: 3,
    name: '免租卡',
    description: '本回合避免支付租金',
    targetType: 0,
    value: 1,
    rarity: 1,
    iconPath: 'web3/cards/rent_free'
  },
  {
    kind: 4,
    name: '冰冻卡',
    description: '冻结一个玩家一回合',
    targetType: 1,
    value: 1,
    rarity: 2,
    iconPath: 'web3/cards/freeze'
  },
  {
    kind: 5,
    name: '狗狗卡',
    description: '在地块上放置恶犬',
    targetType: 2,
    value: 0,
    rarity: 1,
    iconPath: 'web3/cards/dog'
  },
  {
    kind: 6,
    name: '机器娃娃',
    description: '清除一段路上的所有NPC',
    targetType: 2,
    value: 0,
    rarity: 0,
    iconPath: 'web3/cards/cleanse'
  },
  {
    kind: 7,
    name: '转向卡',
    description: '改变移动方向',
    targetType: 0,
    value: 0,
    rarity: 0,
    iconPath: 'web3/cards/turn'
  }
];

/**
 * 根据kind查找卡牌配置
 */
export function findCardConfig(kind: number): CardTextureConfig | undefined {
  return CARD_CONFIGS.find(card => card.kind === kind);
}

/**
 * 根据稀有度获取卡牌
 */
export function getCardsByRarity(rarity: number): CardTextureConfig[] {
  return CARD_CONFIGS.filter(card => card.rarity === rarity);
}

/**
 * 获取卡牌的显示文字
 */
export function getCardDisplayText(config: CardTextureConfig): string {
  return config.displayText || config.name;
}

/**
 * 从iconPath提取文件名
 */
export function getCardFileName(config: CardTextureConfig): string {
  const parts = config.iconPath.split('/');
  return parts[parts.length - 1];
}

/**
 * 稀有度名称映射
 */
export const RARITY_NAMES: { [key: number]: string } = {
  0: '普通',
  1: '稀有',
  2: '史诗'
};
