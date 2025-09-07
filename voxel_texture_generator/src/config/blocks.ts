import { BlockConfig } from '../types';

export const BLOCKS: BlockConfig[] = [
  // === 基础地块 ===
  {
    name: 'empty_tile',
    category: 'basic',
    description: '空地草坪',
    keyword: 'LAND',
    basePrompt: 'Pixelated voxel grass texture, top-down view, 8-bit style, bright green grass with small darker patches, simple geometric patterns, clean minecraft-like aesthetic, flat lighting, game-ready texture',
    textPrompt: 'Pixelated voxel grass texture with "LAND" text clearly visible in center, top-down view, 8-bit style, bright green grass background, white bold text "LAND", readable typography, clean minecraft-like aesthetic',
    colors: ['#4CAF50', '#388E3C', '#2E7D32'],
    size: 64
  },
  {
    name: 'property_1x1',
    category: 'basic', 
    description: '1x1地产',
    keyword: 'BUY',
    basePrompt: 'Pixelated wooden planks texture, light oak color, voxel style, clear wood grain patterns, warm brown tones, minecraft-inspired, top-down view, game texture, clean geometric lines',
    textPrompt: 'Pixelated wooden planks texture with "BUY" text clearly visible, light oak background, white bold text "BUY" in center, readable typography, warm brown wood grain, voxel style',
    colors: ['#DEB887', '#CD853F', '#A0522D'],
    size: 64
  },
  {
    name: 'property_2x2',
    category: 'basic',
    description: '2x2地产',
    keyword: 'ESTATE',
    basePrompt: 'Pixelated dark oak planks texture, rich dark brown color, voxel style, detailed wood grain, luxury appearance, minecraft-inspired, top-down view, premium wooden texture',
    textPrompt: 'Pixelated dark oak planks texture with "ESTATE" text, dark brown background, bright yellow bold text "ESTATE" clearly visible, luxury wooden appearance, voxel style',
    colors: ['#8B4513', '#654321', '#3E2723'],
    size: 64
  },

  // === 特殊地块 ===
  {
    name: 'hospital',
    category: 'special',
    description: '医院',
    keyword: 'HEAL',
    basePrompt: 'Pixelated white medical texture, clean hospital tile appearance, voxel style, bright white with subtle grid lines, sterile and clean, red cross symbol optional, minecraft-like medical building texture',
    textPrompt: 'Pixelated white medical texture with "HEAL" text, bright white background, red bold text "HEAL" clearly visible, medical cross symbol, sterile clean appearance, voxel style',
    colors: ['#FFFFFF', '#F5F5F5', '#FF0000'],
    size: 64
  },
  {
    name: 'chance',
    category: 'special',
    description: '机会地块',
    keyword: 'LUCK',
    basePrompt: 'Pixelated bright yellow texture, question mark pattern, voxel style, vibrant golden yellow, mystery and excitement theme, minecraft-inspired, geometric patterns, game board aesthetic',
    textPrompt: 'Pixelated bright yellow texture with "LUCK" text, golden yellow background, black bold text "LUCK" clearly visible, question mark symbols around text, exciting mystery theme, voxel style',
    colors: ['#FFD700', '#FFA500', '#FF8C00'],
    size: 64
  },
  {
    name: 'bonus',
    category: 'special',
    description: '奖励地块',
    keyword: 'GOLD',
    basePrompt: 'Pixelated golden metallic texture, shiny gold appearance, voxel style, rich golden color with highlights, treasure and wealth theme, minecraft gold block inspired, luxurious shine effect',
    textPrompt: 'Pixelated golden texture with "GOLD" text, shiny gold background, black bold text "GOLD" clearly visible, treasure symbols, wealth and prosperity theme, metallic shine, voxel style',
    colors: ['#FFD700', '#DAA520', '#B8860B'],
    size: 64
  },
  {
    name: 'fee',
    category: 'special',
    description: '费用地块',
    keyword: 'PAY',
    basePrompt: 'Pixelated red texture, warning and cost theme, voxel style, deep red color, danger and expense feeling, minecraft redstone block inspired, alert appearance',
    textPrompt: 'Pixelated red texture with "PAY" text, deep red background, white bold text "PAY" clearly visible, warning symbols, expense and cost theme, alert appearance, voxel style',
    colors: ['#FF0000', '#DC143C', '#B22222'],
    size: 64
  },
  {
    name: 'card_tile',
    category: 'special',
    description: '卡片地块',
    keyword: 'CARD',
    basePrompt: 'Pixelated blue card texture, voxel style, bright blue color, playing card theme, minecraft-inspired, clean geometric design, game card aesthetic',
    textPrompt: 'Pixelated blue texture with "CARD" text, bright blue background, white bold text "CARD" clearly visible, card symbols around text, gaming theme, voxel style',
    colors: ['#1E88E5', '#1976D2', '#0D47A1'],
    size: 64
  },
  {
    name: 'news',
    category: 'special',
    description: '新闻地块',
    keyword: 'NEWS',
    basePrompt: 'Pixelated purple texture, voxel style, royal purple color, information and broadcast theme, minecraft-inspired, clean design with subtle patterns',
    textPrompt: 'Pixelated purple texture with "NEWS" text, royal purple background, white bold text "NEWS" clearly visible, information symbols, broadcast theme, voxel style',
    colors: ['#9C27B0', '#7B1FA2', '#4A148C'],
    size: 64
  },

  // === 建筑等级 ===
  {
    name: 'small_house',
    category: 'building',
    description: '小屋',
    keyword: 'HOME',
    basePrompt: 'Pixelated cobblestone texture, voxel style, gray stone blocks, rustic small house material, minecraft cobblestone inspired, rough stone texture, humble building material',
    textPrompt: 'Pixelated cobblestone texture with "HOME" text, gray stone background, white bold text "HOME" clearly visible, house symbols, humble home theme, voxel style',
    colors: ['#808080', '#696969', '#555555'],
    size: 64
  },
  {
    name: 'villa',
    category: 'building',
    description: '洋房',
    keyword: 'VILLA',
    basePrompt: 'Pixelated brick texture, voxel style, red-brown brick pattern, luxury housing material, minecraft brick inspired, elegant building appearance, refined texture',
    textPrompt: 'Pixelated brick texture with "VILLA" text, red-brown brick background, white bold text "VILLA" clearly visible, luxury symbols, elegant housing theme, voxel style',
    colors: ['#B87333', '#A0522D', '#8B4513'],
    size: 64
  },
  {
    name: 'building',
    category: 'building',
    description: '大楼',
    keyword: 'TOWER',
    basePrompt: 'Pixelated stone brick texture, voxel style, refined gray stone blocks, commercial building material, minecraft stone brick inspired, urban architecture texture',
    textPrompt: 'Pixelated stone brick texture with "TOWER" text, gray stone brick background, white bold text "TOWER" clearly visible, skyscraper symbols, urban architecture theme, voxel style',
    colors: ['#A0A0A0', '#898989', '#696969'],
    size: 64
  },
  {
    name: 'landmark',
    category: 'building',
    description: '地标',
    keyword: 'ICON',
    basePrompt: 'Pixelated diamond texture, voxel style, brilliant cyan-blue diamond appearance, prestigious landmark material, minecraft diamond block inspired, ultimate luxury texture',
    textPrompt: 'Pixelated diamond texture with "ICON" text, brilliant cyan-blue diamond background, white bold text "ICON" clearly visible, diamond symbols, prestige and luxury theme, voxel style',
    colors: ['#00FFFF', '#00CED1', '#4682B4'],
    size: 64
  },

  // === NPC ===
  {
    name: 'land_god',
    category: 'npc',
    description: '土地神',
    keyword: 'EARTH',
    basePrompt: 'Pixelated emerald texture, voxel style, bright green emerald appearance, nature and earth deity theme, minecraft emerald block inspired, mystical green energy',
    textPrompt: 'Pixelated emerald texture with "EARTH" text, bright green emerald background, white bold text "EARTH" clearly visible, nature symbols, earth deity theme, mystical energy, voxel style',
    colors: ['#50C878', '#228B22', '#006400'],
    size: 64
  },
  {
    name: 'wealth_god',
    category: 'npc',
    description: '财神',
    keyword: 'RICH',
    basePrompt: 'Pixelated lapis lazuli texture, voxel style, deep blue with gold flecks, wealth and prosperity deity theme, minecraft lapis block inspired, royal blue luxury',
    textPrompt: 'Pixelated lapis lazuli texture with "RICH" text, deep blue background with gold accents, yellow bold text "RICH" clearly visible, money symbols, wealth deity theme, voxel style',
    colors: ['#1E90FF', '#4169E1', '#FFD700'],
    size: 64
  },
  {
    name: 'fortune_god',
    category: 'npc',
    description: '福神',
    keyword: 'BLESS',
    basePrompt: 'Pixelated beacon texture, voxel style, glowing white-blue energy, fortune and blessing theme, minecraft beacon inspired, divine light emission',
    textPrompt: 'Pixelated beacon texture with "BLESS" text, glowing white-blue background, golden bold text "BLESS" clearly visible, blessing symbols, divine fortune theme, light energy, voxel style',
    colors: ['#F0F8FF', '#87CEEB', '#FFD700'],
    size: 64
  },
  {
    name: 'dog',
    category: 'npc',
    description: '狗狗',
    keyword: 'WOOF',
    basePrompt: 'Pixelated brown wool texture, voxel style, warm brown fur appearance, friendly dog theme, minecraft brown wool inspired, soft and fluffy texture',
    textPrompt: 'Pixelated brown wool texture with "WOOF" text, warm brown fur background, white bold text "WOOF" clearly visible, paw symbols, friendly dog theme, soft texture, voxel style',
    colors: ['#8B4513', '#A0522D', '#D2B48C'],
    size: 64
  },
  {
    name: 'poor_god',
    category: 'npc',
    description: '穷神',
    keyword: 'BROKE',
    basePrompt: 'Pixelated gray concrete texture, voxel style, dull gray appearance, poverty and misfortune theme, minecraft gray concrete inspired, somber and plain',
    textPrompt: 'Pixelated gray concrete texture with "BROKE" text, dull gray background, black bold text "BROKE" clearly visible, empty wallet symbols, poverty theme, plain appearance, voxel style',
    colors: ['#808080', '#696969', '#2F4F4F'],
    size: 64
  },

  // === 路面物体 ===
  {
    name: 'roadblock',
    category: 'obstacle',
    description: '路障',
    keyword: 'STOP',
    basePrompt: 'Pixelated iron block texture, voxel style, metallic gray-silver appearance, industrial barrier theme, minecraft iron block inspired, solid and impenetrable',
    textPrompt: 'Pixelated iron block texture with "STOP" text, metallic gray background, red bold text "STOP" clearly visible, barrier symbols, industrial obstacle theme, solid metal, voxel style',
    colors: ['#C0C0C0', '#A9A9A9', '#808080'],
    size: 64
  },
  {
    name: 'bomb',
    category: 'obstacle',
    description: '炸弹',
    keyword: 'BOOM',
    basePrompt: 'Pixelated TNT texture, voxel style, red explosive appearance with warning labels, dangerous and explosive theme, minecraft TNT inspired, hazardous material',
    textPrompt: 'Pixelated TNT texture with "BOOM" text, red explosive background, white bold text "BOOM" clearly visible, explosion symbols, dangerous explosive theme, warning appearance, voxel style',
    colors: ['#FF0000', '#FF6600', '#FFFF00'],
    size: 64
  },

  // === Web3装饰 ===
  {
    name: 'crypto_wallet',
    category: 'web3',
    description: '加密钱包',
    keyword: 'WALLET',
    basePrompt: 'Pixelated prismarine texture, voxel style, cyan-teal crystalline appearance, high-tech crypto theme, minecraft prismarine inspired, digital and futuristic',
    textPrompt: 'Pixelated prismarine texture with "WALLET" text, cyan-teal crystalline background, white bold text "WALLET" clearly visible, crypto symbols, digital wallet theme, futuristic tech, voxel style',
    colors: ['#20B2AA', '#008B8B', '#00CED1'],
    size: 64
  },
  {
    name: 'blockchain',
    category: 'web3', 
    description: '区块链',
    keyword: 'CHAIN',
    basePrompt: 'Pixelated chain texture, voxel style, metallic linked chain appearance, blockchain technology theme, minecraft chain inspired, interconnected links',
    textPrompt: 'Pixelated chain texture with "CHAIN" text, metallic linked chain background, white bold text "CHAIN" clearly visible, blockchain symbols, technology theme, connected links, voxel style',
    colors: ['#778899', '#708090', '#2F4F4F'],
    size: 64
  },
  {
    name: 'nft_gallery',
    category: 'web3',
    description: 'NFT画廊',
    keyword: 'ART',
    basePrompt: 'Pixelated chiseled bookshelf texture, voxel style, wooden gallery frame appearance, art exhibition theme, minecraft bookshelf inspired, cultural and artistic',
    textPrompt: 'Pixelated bookshelf texture with "ART" text, wooden gallery frame background, colorful bold text "ART" clearly visible, art symbols, NFT gallery theme, creative display, voxel style',
    colors: ['#DEB887', '#D2691E', '#8B4513'],
    size: 64
  },
  {
    name: 'defi_bank',
    category: 'web3',
    description: 'DeFi银行',
    keyword: 'DEFI',
    basePrompt: 'Pixelated prismarine brick texture, voxel style, structured cyan-blue crystalline blocks, decentralized finance theme, minecraft prismarine brick inspired, financial technology',
    textPrompt: 'Pixelated prismarine brick texture with "DEFI" text, structured cyan-blue background, white bold text "DEFI" clearly visible, finance symbols, DeFi banking theme, digital finance, voxel style',
    colors: ['#4682B4', '#5F9EA0', '#008B8B'],
    size: 64
  },
  {
    name: 'metaverse_portal',
    category: 'web3',
    description: '元宇宙传送门',
    keyword: 'META',
    basePrompt: 'Pixelated end portal frame texture, voxel style, mystical purple-green portal appearance, metaverse gateway theme, minecraft end portal inspired, dimensional travel',
    textPrompt: 'Pixelated portal frame texture with "META" text, mystical purple-green background, glowing white text "META" clearly visible, portal symbols, metaverse gateway theme, dimensional energy, voxel style',
    colors: ['#8A2BE2', '#9400D3', '#00FF7F'],
    size: 64
  }
];
