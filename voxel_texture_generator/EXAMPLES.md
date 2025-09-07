# 使用示例

## 🚀 快速开始

### 1. 查看关键方块的Prompts（推荐）
```bash
cd voxel_texture_generator
npm run prompt-key-blocks
```

**输出示例：**
```
🎨 Web3 Tycoon Texture Generator
================================

📝 Prompt Generator Mode
Style: basic
Size: 64x64

📋 Generated Prompts (basic style, 5 blocks):
================================================================================

1. 🎯 EMPTY_TILE [BASIC]
   📝 Description: 空地草坪
   🎨 Colors: #4CAF50, #388E3C, #2E7D32
   📐 Recommended Size: 64x64
   🚀 Prompt:
   "Pixelated voxel grass texture, top-down view, 8-bit style, bright green grass with small darker patches, simple geometric patterns, clean minecraft-like aesthetic, flat lighting, game-ready texture"
--------------------------------------------------------------------------------

2. 🎯 CHANCE [SPECIAL]
   📝 Description: 机会地块
   🎨 Colors: #FFD700, #FFA500, #FF8C00
   📐 Recommended Size: 64x64
   🚀 Prompt:
   "Pixelated bright yellow texture, question mark pattern, voxel style, vibrant golden yellow, mystery and excitement theme, minecraft-inspired, geometric patterns, game board aesthetic"
--------------------------------------------------------------------------------

...
```

### 2. 生成文字嵌入版本的Prompts
```bash
npm run dev -- --prompt-only --blocks=crypto_wallet,defi_bank --style=text
```

**输出示例：**
```
1. 🎯 CRYPTO_WALLET [WEB3]
   📝 Description: 加密钱包
   🔤 Keyword: "WALLET"
   🎨 Colors: #20B2AA, #008B8B, #00CED1
   📐 Recommended Size: 64x64
   🚀 Prompt:
   "Pixelated prismarine texture with "WALLET" text clearly visible, cyan-teal crystalline background, white bold text "WALLET" in center, readable typography, crypto symbols, digital wallet theme, futuristic tech, voxel style"
```

### 3. 测试关键方块生成
```bash
# 无需API密钥，先查看效果
npm run prompt-key-blocks

# 有API密钥后，实际生成
export NANOBANA_API_KEY="your_key_here"
npm run test-key-blocks
```

### 4. 逐步测试流程
```bash
# 步骤1：查看单个方块的prompt
npm run dev -- --prompt-only --blocks=empty_tile --style=basic

# 步骤2：复制prompt到网页AI工具测试

# 步骤3：满意后生成实际纹理
npm run dev -- --test=empty_tile

# 步骤4：批量生成关键方块
npm run test-key-blocks
```

## 📝 Prompt复制指南

### 复制到Midjourney
```
/imagine Pixelated voxel grass texture, top-down view, 8-bit style, bright green grass with small darker patches, simple geometric patterns, clean minecraft-like aesthetic, flat lighting, game-ready texture --aspect 1:1 --style pixel-art
```

### 复制到DALL-E 3
```
Create a pixelated voxel grass texture, top-down view, 8-bit style, bright green grass with small darker patches, simple geometric patterns, clean minecraft-like aesthetic, flat lighting, game-ready texture. Output should be 64x64 pixels, square format.
```

### 复制到Stable Diffusion
```
pixelated voxel grass texture, top-down view, 8-bit style, bright green grass, small darker patches, geometric patterns, minecraft aesthetic, flat lighting, game texture, pixel art, square format, 64x64
Negative prompt: blurry, 3d, realistic, gradient, soft edges
```

## 🎯 关键方块选择说明

我们选择了这5个方块作为关键测试对象：

1. **empty_tile (空地)** - 最基础的地块，测试草地纹理效果
2. **chance (机会)** - 明亮的黄色，测试鲜艳颜色的表现
3. **bonus (奖励)** - 金色金属质感，测试光泽效果
4. **crypto_wallet (加密钱包)** - Web3元素，测试科技感纹理
5. **defi_bank (DeFi银行)** - 复杂的科技纹理，测试细节表现

这5个方块涵盖了：
- ✅ 基础地形纹理
- ✅ 鲜艳颜色表现
- ✅ 金属质感效果
- ✅ 科技感纹理
- ✅ Web3主题元素

## 🛠️ 故障排除

### Prompt太长？
某些AI工具有字符限制，可以简化prompt：
```bash
# 原始prompt
"Pixelated voxel grass texture, top-down view, 8-bit style, bright green grass with small darker patches, simple geometric patterns, clean minecraft-like aesthetic, flat lighting, game-ready texture"

# 简化版本
"Pixelated grass texture, 8-bit style, bright green, minecraft aesthetic, 64x64"
```

### 想要更多方块？
```bash
# 查看所有可用方块
npm run dev -- --list

# 生成特定组合
npm run dev -- --prompt-only --blocks=small_house,villa,building,landmark --style=text
```

### 想要不同尺寸？
```bash
# 128x128高清版本
npm run dev -- --prompt-only --size=128 --style=text --blocks=crypto_wallet

# 32x32轻量版本  
npm run dev -- --prompt-only --size=32 --style=basic --blocks=empty_tile
```

## 💡 最佳实践

1. **先用prompt-only测试** - 不消耗API调用，快速预览效果
2. **从关键方块开始** - 5个代表性方块覆盖主要场景
3. **分风格测试** - 基础风格和文字嵌入分别测试
4. **注意尺寸选择** - 文字嵌入建议64x64以上确保清晰度
5. **备份重要纹理** - 生成满意的纹理及时保存
