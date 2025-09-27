/**
 * Actor纹理配置 - 基于ActorConfig.ts的纹理生成配置
 * 用于生成Web3大富翁游戏中的所有Actor纹理
 */

export interface ActorTextureConfig {
  name: string;           // 文件名（不含扩展名）
  description: string;    // 描述
  category: 'npc' | 'building' | 'object';  // 类别
  size: number;          // 纹理尺寸（默认256）
  prompt: string;        // 生成提示词
  keyword?: string;      // 关键词（用于搜索）
  variants?: string[];   // 变体（如动画帧）
}

/**
 * NPC角色纹理配置
 */
export const NPC_TEXTURES: ActorTextureConfig[] = [
  // 土地神
  {
    name: 'land_god',
    description: '土地神 - 中国传统神话角色',
    category: 'npc',
    size: 256,
    prompt: 'Chinese earth god (Tu Di Gong), pixel art style, friendly old man with white beard, traditional Chinese robe in earthy brown and gold colors, holding a wooden staff, warm smile, isometric view, clean background, Minecraft-style voxel character, 256x256 pixels',
    keyword: 'land_god',
    variants: ['land_god_idle_1', 'land_god_idle_2', 'land_god_walk_1', 'land_god_walk_2']
  },

  // 财神
  {
    name: 'wealth_god',
    description: '财神 - 财富之神',
    category: 'npc',
    size: 256,
    prompt: 'Chinese god of wealth (Cai Shen), pixel art style, prosperous man with black beard, red and gold traditional Chinese robe, holding gold ingots, cheerful expression, isometric view, clean background, Minecraft-style voxel character, 256x256 pixels',
    keyword: 'wealth_god',
    variants: ['wealth_god_idle_1', 'wealth_god_idle_2']
  },

  // 福神
  {
    name: 'fortune_god',
    description: '福神 - 幸运之神',
    category: 'npc',
    size: 256,
    prompt: 'Chinese god of fortune (Fu Shen), pixel art style, kind elderly man with white beard, blue and white traditional robe, holding a scroll with "福" character, peaceful smile, isometric view, clean background, Minecraft-style voxel character, 256x256 pixels',
    keyword: 'fortune_god',
    variants: ['fortune_god_idle_1', 'fortune_god_idle_2']
  },

  // 狗狗
  {
    name: 'dog',
    description: '可爱的小狗',
    category: 'npc',
    size: 256,
    prompt: 'Cute cartoon dog, pixel art style, golden retriever or shiba inu, friendly expression, wagging tail, sitting position, isometric view, clean background, Minecraft-style voxel pet, 256x256 pixels',
    keyword: 'dog',
    variants: ['dog_idle_1', 'dog_idle_2', 'dog_walk_1', 'dog_walk_2', 'dog_walk_3', 'dog_walk_4']
  },

  // 穷神
  {
    name: 'poverty_god',
    description: '穷神 - 贫穷之神',
    category: 'npc',
    size: 256,
    prompt: 'Chinese god of poverty (Qiong Shen), pixel art style, thin man with sad expression, tattered gray and brown robes, carrying an empty bag, melancholic look, isometric view, clean background, Minecraft-style voxel character, 256x256 pixels',
    keyword: 'poverty_god',
    variants: ['poverty_god_idle_1', 'poverty_god_idle_2']
  }
];

/**
 * 物体纹理配置
 */
export const OBJECT_TEXTURES: ActorTextureConfig[] = [
  // 路障
  {
    name: 'roadblock',
    description: '路障 - 阻挡道路的障碍物',
    category: 'object',
    size: 256,
    prompt: 'Construction roadblock barrier, pixel art style, orange and white striped barrier, warning signs, concrete base, isometric view, clean background, Minecraft-style voxel object, 256x256 pixels',
    keyword: 'roadblock'
  },

  // 炸弹
  {
    name: 'bomb',
    description: '炸弹 - 可爆炸的道具',
    category: 'object',
    size: 256,
    prompt: 'Cartoon bomb, pixel art style, black spherical bomb with lit fuse, sparks, classic round bomb design, isometric view, clean background, Minecraft-style voxel object, 256x256 pixels',
    keyword: 'bomb'
  }
];

/**
 * 建筑纹理配置
 */
export const BUILDING_TEXTURES: ActorTextureConfig[] = [
  // 空地
  {
    name: 'lv0',
    description: '空地 - 未开发的土地',
    category: 'building',
    size: 256,
    prompt: 'Empty grass plot, pixel art style, green grass texture with subtle dirt patches, flat terrain, isometric view, seamless tile texture, Minecraft-style ground block, 256x256 pixels',
    keyword: 'empty_land'
  },

  // 小型地产 - 各个等级
  {
    name: 'property_small_lv1',
    description: '小型地产 1级 - 简陋小屋',
    category: 'building',
    size: 256,
    prompt: 'Small wooden hut, pixel art style, simple one-story house, wood and thatch roof, small window, basic door, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'property_small'
  },
  {
    name: 'property_small_lv2',
    description: '小型地产 2级 - 普通房屋',
    category: 'building',
    size: 256,
    prompt: 'Cozy house, pixel art style, two-story building, brick walls, tiled roof, multiple windows, nice door, small garden, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'property_small'
  },
  {
    name: 'property_small_lv3',
    description: '小型地产 3级 - 商铺',
    category: 'building',
    size: 256,
    prompt: 'Small shop building, pixel art style, commercial storefront, glass windows, shop sign, awning, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'property_small'
  },
  {
    name: 'property_small_lv4',
    description: '小型地产 4级 - 小型大楼',
    category: 'building',
    size: 256,
    prompt: 'Small apartment building, pixel art style, 4-story modern building, concrete and glass, balconies, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'property_small'
  },
  {
    name: 'property_small_lv5',
    description: '小型地产 5级 - 豪华大楼',
    category: 'building',
    size: 256,
    prompt: 'Luxury apartment tower, pixel art style, 6-story premium building, modern architecture, glass facade, rooftop garden, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'property_small'
  },

  // 土地庙 - 各个等级
  {
    name: 'temple_lv1',
    description: '土地庙 1级 - 小祠堂',
    category: 'building',
    size: 256,
    prompt: 'Small Chinese shrine, pixel art style, simple wooden structure, red pillars, small altar, incense burner, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'temple'
  },
  {
    name: 'temple_lv2',
    description: '土地庙 2级 - 小庙',
    category: 'building',
    size: 256,
    prompt: 'Chinese temple, pixel art style, traditional architecture, curved roof tiles, red and gold colors, lanterns, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'temple'
  },
  {
    name: 'temple_lv3',
    description: '土地庙 3级 - 中型庙宇',
    category: 'building',
    size: 256,
    prompt: 'Medium Chinese temple, pixel art style, ornate traditional building, multiple roofs, dragon decorations, stone lions, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'temple'
  },
  {
    name: 'temple_lv4',
    description: '土地庙 4级 - 大型庙宇',
    category: 'building',
    size: 256,
    prompt: 'Large Chinese temple complex, pixel art style, multi-building temple, pagoda tower, courtyard, elaborate decorations, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'temple'
  },
  {
    name: 'temple_lv5',
    description: '土地庙 5级 - 宏伟寺院',
    category: 'building',
    size: 256,
    prompt: 'Grand Chinese monastery, pixel art style, majestic temple complex, golden roofs, tall pagoda, gardens, stone pathways, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'temple'
  },

  // 研究所 - 各个等级
  {
    name: 'research_lv1',
    description: '研究所 1级 - 小型实验室',
    category: 'building',
    size: 256,
    prompt: 'Small laboratory, pixel art style, simple modern building, white walls, few windows, basic equipment visible, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'research'
  },
  {
    name: 'research_lv2',
    description: '研究所 2级 - 科研中心',
    category: 'building',
    size: 256,
    prompt: 'Research center, pixel art style, modern scientific building, glass and steel, solar panels, satellite dish, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'research'
  },
  {
    name: 'research_lv3',
    description: '研究所 3级 - 高科技实验室',
    category: 'building',
    size: 256,
    prompt: 'High-tech laboratory, pixel art style, futuristic building, curved glass walls, LED lights, clean design, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'research'
  },
  {
    name: 'research_lv4',
    description: '研究所 4级 - 科技园区',
    category: 'building',
    size: 256,
    prompt: 'Technology campus, pixel art style, multiple connected buildings, modern architecture, green spaces, parking, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'research'
  },
  {
    name: 'research_lv5',
    description: '研究所 5级 - 未来科技城',
    category: 'building',
    size: 256,
    prompt: 'Futuristic tech city, pixel art style, ultra-modern complex, floating elements, holographic displays, energy shields, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'research'
  },

  // 石油公司 - 各个等级
  {
    name: 'oil_company_lv1',
    description: '石油公司 1级 - 小型加油站',
    category: 'building',
    size: 256,
    prompt: 'Small gas station, pixel art style, fuel pumps, canopy, small shop, oil company colors, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'oil_company'
  },
  {
    name: 'oil_company_lv2',
    description: '石油公司 2级 - 炼油设施',
    category: 'building',
    size: 256,
    prompt: 'Oil refinery facility, pixel art style, industrial building, storage tanks, pipes, smokestacks, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'oil_company'
  },
  {
    name: 'oil_company_lv3',
    description: '石油公司 3级 - 石油工厂',
    category: 'building',
    size: 256,
    prompt: 'Oil processing plant, pixel art style, large industrial complex, multiple tanks, pipeline network, control tower, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'oil_company'
  },
  {
    name: 'oil_company_lv4',
    description: '石油公司 4级 - 能源中心',
    category: 'building',
    size: 256,
    prompt: 'Energy center complex, pixel art style, modern industrial facility, large storage silos, office building, trucks, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'oil_company'
  },
  {
    name: 'oil_company_lv5',
    description: '石油公司 5级 - 能源帝国',
    category: 'building',
    size: 256,
    prompt: 'Oil empire headquarters, pixel art style, massive industrial complex, skyscraper office, refineries, offshore platform model, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'oil_company'
  },

  // 商业中心 - 各个等级
  {
    name: 'commercial_lv1',
    description: '商业中心 1级 - 小商店',
    category: 'building',
    size: 256,
    prompt: 'Small retail store, pixel art style, single shop building, display windows, entrance, simple design, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'commercial'
  },
  {
    name: 'commercial_lv2',
    description: '商业中心 2级 - 购物广场',
    category: 'building',
    size: 256,
    prompt: 'Shopping plaza, pixel art style, L-shaped mall, multiple stores, parking area, outdoor seating, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'commercial'
  },
  {
    name: 'commercial_lv3',
    description: '商业中心 3级 - 百货商场',
    category: 'building',
    size: 256,
    prompt: 'Department store, pixel art style, multi-floor shopping center, glass facade, escalators visible, branded signage, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'commercial'
  },
  {
    name: 'commercial_lv4',
    description: '商业中心 4级 - 大型购物中心',
    category: 'building',
    size: 256,
    prompt: 'Large shopping mall, pixel art style, massive retail complex, multiple levels, food court, entertainment area, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'commercial'
  },
  {
    name: 'commercial_lv5',
    description: '商业中心 5级 - 商业帝国',
    category: 'building',
    size: 256,
    prompt: 'Commercial empire megamall, pixel art style, futuristic shopping complex, towers, sky bridges, LED displays, luxury brands, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'commercial'
  },

  // 大饭店 - 各个等级
  {
    name: 'hotel_lv1',
    description: '大饭店 1级 - 小旅馆',
    category: 'building',
    size: 256,
    prompt: 'Small inn, pixel art style, cozy 2-story building, wooden sign, warm windows, simple entrance, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'hotel'
  },
  {
    name: 'hotel_lv2',
    description: '大饭店 2级 - 商务酒店',
    category: 'building',
    size: 256,
    prompt: 'Business hotel, pixel art style, modern 4-story building, reception area visible, parking, clean design, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'hotel'
  },
  {
    name: 'hotel_lv3',
    description: '大饭店 3级 - 精品酒店',
    category: 'building',
    size: 256,
    prompt: 'Boutique hotel, pixel art style, stylish building, unique architecture, rooftop terrace, artistic facade, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'hotel'
  },
  {
    name: 'hotel_lv4',
    description: '大饭店 4级 - 豪华酒店',
    category: 'building',
    size: 256,
    prompt: 'Luxury hotel, pixel art style, grand building, fountain entrance, valet parking, gold accents, multiple wings, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'hotel'
  },
  {
    name: 'hotel_lv5',
    description: '大饭店 5级 - 五星级度假村',
    category: 'building',
    size: 256,
    prompt: 'Five-star resort hotel, pixel art style, magnificent palace-like structure, pools, gardens, helipad, multiple towers, isometric view, Minecraft-style voxel building, 256x256 pixels',
    keyword: 'hotel'
  }
];

/**
 * 获取所有Actor纹理配置
 */
export const ALL_ACTOR_TEXTURES: ActorTextureConfig[] = [
  ...NPC_TEXTURES,
  ...OBJECT_TEXTURES,
  ...BUILDING_TEXTURES
];

/**
 * 生成动画帧配置
 */
export function generateAnimationFrames(baseConfig: ActorTextureConfig): ActorTextureConfig[] {
  if (!baseConfig.variants || baseConfig.variants.length === 0) {
    return [baseConfig];
  }

  return baseConfig.variants.map(variant => ({
    ...baseConfig,
    name: variant,
    description: `${baseConfig.description} - ${variant}`,
    prompt: baseConfig.prompt.replace('isometric view', `isometric view, animation frame: ${variant}`)
  }));
}

/**
 * 根据名称查找纹理配置
 */
export function findTextureConfig(name: string): ActorTextureConfig | undefined {
  return ALL_ACTOR_TEXTURES.find(texture =>
    texture.name === name || texture.variants?.includes(name)
  );
}

/**
 * 获取指定类别的纹理配置
 */
export function getTexturesByCategory(category: 'npc' | 'building' | 'object'): ActorTextureConfig[] {
  return ALL_ACTOR_TEXTURES.filter(texture => texture.category === category);
}