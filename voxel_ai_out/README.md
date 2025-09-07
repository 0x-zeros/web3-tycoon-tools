# Web3 Tycoon Game Resource Pack

## 概述
这是为Web3大富翁体素游戏创建的资源包，使用`web3`命名空间。基于Minecraft 1.21.7 Vanilla资源包结构设计。

## 游戏地块 (Game Tiles)

### 基础地块
- `empty_tile` - 空地（草地纹理）
- `property_1x1` - 1x1地产（橡木板纹理）
- `property_2x2` - 2x2地产（深色橡木板纹理）
- `hospital` - 医院（白色混凝土纹理）
- `chance` - 机会地块（黄色混凝土纹理）
- `bonus` - 奖励地块（金块纹理）
- `fee` - 费用地块（红石块纹理）
- `card_tile` - 卡片地块（蓝色混凝土纹理）
- `news` - 新闻地块（紫色混凝土纹理）

### 建筑等级
- `small_house` - 小屋（鹅卵石纹理）
- `villa` - 洋房（砖块纹理）
- `building` - 大楼（石砖纹理）
- `landmark` - 地标（钻石块纹理）

## NPC 和路面物体

### 增益型NPC
- `land_god` - 土地神（绿宝石块纹理）
- `wealth_god` - 财神（青金石块纹理）
- `fortune_god` - 福神（信标纹理）

### 干扰型NPC
- `dog` - 狗狗（棕色羊毛纹理）
- `poor_god` - 穷神（灰色混凝土纹理）

### 路面物体
- `roadblock` - 路障（铁块纹理）
- `bomb` - 炸弹（TNT顶部纹理）

## Web3特色装饰块
- `crypto_wallet` - 加密钱包（海晶石纹理）
- `blockchain` - 区块链（链条纹理）
- `nft_gallery` - NFT画廊（雕刻书架纹理）
- `defi_bank` - DeFi银行（海晶石砖纹理）
- `metaverse_portal` - 元宇宙传送门（末地传送门框架纹理）

## 文件结构
```
voxel_ai_out/
├── pack.mcmeta
├── README.md
└── assets/
    └── web3/
        ├── atlases/
        │   └── blocks.json
        ├── blockstates/
        │   └── [26个地块的blockstate文件]
        ├── models/
        │   ├── block/
        │   │   ├── [26个地块的block model文件]
        │   │   ├── block.json (基础block模型)
        │   │   ├── cube.json (立方体模型)
        │   │   └── cube_all.json (全面纹理立方体模型)
        │   └── item/
        │       ├── [26个对应的item model文件]
        │       └── generated.json (基础item模型)
        └── textures/
            ├── block/
            │   └── [26个地块的纹理文件]
            ├── item/
            └── entity/
```

## 使用说明
1. 将此资源包集成到你的Cocos Creator体素游戏项目中
2. 使用`web3:block/[block_name]`格式引用各种游戏地块
3. 使用`web3:item/[item_name]`格式引用对应的物品
4. 根据游戏逻辑需要，可以对纹理进行进一步定制
5. 所有纹理文件都可以根据你的具体需求进行替换
6. **命名空间一致性**: 所有引用都已修正为web3命名空间，无minecraft依赖

## 技术规格
- Pack Format: 64 (Minecraft 1.21.7兼容)
- 命名空间: `web3`
- 基于Minecraft资源包结构设计
- 兼容Cocos Creator体素渲染系统

## 后续开发
可以根据游戏需求继续添加：
- 更多NPC类型
- 季节性装饰块
- 动画纹理
- 自定义模型（非cube_all）
