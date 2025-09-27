# Actor纹理生成器使用指南

本生成器用于生成Web3大富翁游戏中ActorConfig.ts定义的所有Actor纹理，包括NPC、建筑和物体。

## 纹理类别

### 1. NPC角色 (5个)
- **土地神** (land_god) - 中国传统神话角色，包含idle和walk动画帧
- **财神** (wealth_god) - 财富之神，包含idle动画帧
- **福神** (fortune_god) - 幸运之神，包含idle动画帧
- **狗狗** (dog) - 可爱的小狗，包含idle和walk动画帧
- **穷神** (poverty_god) - 贫穷之神，包含idle动画帧

### 2. 物体 (2个)
- **路障** (roadblock) - 阻挡道路的障碍物
- **炸弹** (bomb) - 可爆炸的道具

### 3. 建筑 (31个)
- **空地** (lv0) - 所有建筑的0级状态
- **小型地产** - 5个等级 (property_small_lv1-5)
- **土地庙** - 5个等级 (temple_lv1-5)
- **研究所** - 5个等级 (research_lv1-5)
- **石油公司** - 5个等级 (oil_company_lv1-5)
- **商业中心** - 5个等级 (commercial_lv1-5)
- **大饭店** - 5个等级 (hotel_lv1-5)

## 快速开始

### 1. 设置API密钥
```bash
# 在.env文件中添加你的Gemini API密钥
GEMINI_API_KEY=your_api_key_here
```

### 2. 安装依赖
```bash
npm install
```

## 使用命令

### 列出所有可用的Actor
```bash
npm run list-actors
```

### 生成所有纹理
```bash
# 生成所有类别的纹理（NPC、建筑、物体）
npm run generate-actors-all

# 或者简单使用
npm run generate-actors
```

### 按类别生成

#### 生成NPC纹理
```bash
# 仅生成NPC主纹理
npm run generate-npcs

# 生成NPC纹理包含动画帧
npm run generate-npcs-with-animations
```

#### 生成建筑纹理
```bash
npm run generate-buildings
```

#### 生成物体纹理
```bash
npm run generate-objects
```

### 生成特定的Actor
```bash
# 生成特定的Actor
npm run generate-actors-specific -- --actors=land_god,wealth_god

# 生成特定Actor并包含动画
npm run generate-actors-specific -- --actors=land_god --animations
```

### 测试命令
```bash
# 测试NPC生成（土地神包含动画）
npm run test-actor-npc

# 测试建筑生成（小型地产和土地庙的1级）
npm run test-actor-building

# 测试物体生成（路障和炸弹）
npm run test-actor-object
```

## 高级选项

### 自定义输出大小
```bash
# 生成128x128的纹理
npm run generate-actors -- --size=128

# 生成512x512的高清纹理
npm run generate-actors -- --size=512
```

### 自定义输出目录
```bash
npm run generate-actors -- --output=./my_textures
```

### 组合使用
```bash
# 生成所有NPC的512x512纹理，包含动画帧
npm run generate-actors -- --category=npc --size=512 --animations

# 生成特定建筑的256x256纹理
npm run generate-actors -- --actors=temple_lv1,temple_lv2,temple_lv3 --size=256
```

## 输出结构

生成的纹理将按以下结构组织：
```
generated_actor_textures/
├── npc/                    # NPC纹理
│   ├── land_god.png
│   ├── land_god_idle_1.png
│   ├── land_god_idle_2.png
│   ├── land_god_walk_1.png
│   ├── land_god_walk_2.png
│   ├── wealth_god.png
│   └── ...
├── building/               # 建筑纹理
│   ├── lv0.png
│   ├── property_small_lv1.png
│   ├── property_small_lv2.png
│   ├── temple_lv1.png
│   └── ...
├── object/                 # 物体纹理
│   ├── roadblock.png
│   └── bomb.png
└── actor_generation_report.json  # 生成报告
```

## 纹理规格

- **默认尺寸**: 256x256像素
- **格式**: PNG
- **风格**: Minecraft风格的像素艺术，等距视角
- **背景**: 透明或纯色背景

## 注意事项

1. **API限制**: Gemini API有调用频率限制，大量生成时会自动控制速率
2. **生成时间**: 完整生成所有纹理可能需要10-20分钟
3. **动画帧**: NPC的动画帧是基于主纹理的变体，会略有不同
4. **建筑等级**: 建筑纹理从lv1到lv5逐级变得更加豪华和复杂

## 故障排除

### API连接失败
- 检查.env文件中的GEMINI_API_KEY是否正确
- 确认网络连接正常

### 生成失败
- 查看actor_generation_report.json中的错误信息
- 可以使用--actors参数重新生成失败的纹理

### 图片质量问题
- 尝试调整--size参数
- 修改src/config/actors.ts中的prompt提示词

## 纹理整合到游戏

生成的纹理可以直接复制到游戏资源目录：
```bash
# 假设游戏资源目录在../game/assets/textures/
cp -r generated_actor_textures/* ../game/assets/textures/actors/
```

确保在ActorConfig.ts中的纹理路径与实际文件位置匹配。