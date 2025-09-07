# Web3 Tycoon Texture Generator

一个基于AI的体素纹理生成工具，专为Web3大富翁游戏设计。使用NanoBanana API生成高质量的像素艺术风格纹理。

## 功能特色

### 🎨 双重风格生成
- **基础风格**: 纯粹的大富翁11风格体素纹理
- **文字嵌入**: 每个方块都嵌入相关的英文关键词

### 🎯 智能分类系统
- **基础地块**: 空地、1x1地产、2x2地产
- **特殊地块**: 医院、机会、奖励、费用、卡片、新闻
- **建筑等级**: 小屋、洋房、大楼、地标
- **NPC角色**: 土地神、财神、福神、狗狗、穷神
- **路面物体**: 路障、炸弹
- **Web3装饰**: 区块链、加密钱包、NFT画廊、DeFi银行、元宇宙传送门

### 📐 多种尺寸支持
- 32x32: 轻量级，适合移动设备
- 64x64: 推荐尺寸，平衡质量与性能
- 128x128: 高清模式，适合桌面端

## 快速开始

### 1. 安装依赖
```bash
cd voxel_texture_generator
npm install
```

### 2. 设置API密钥
```bash
# 方法1: 环境变量
export NANOBANA_API_KEY="your_api_key_here"

# 方法2: 命令行参数
npm run dev -- --api-key="your_api_key_here"
```

### 3. 基础使用

#### 生成所有纹理（基础风格）
```bash
npm run generate-basic
```

#### 生成所有纹理（嵌入文字）
```bash
npm run generate-text
```

#### 分批测试关键方块
```bash
# 生成关键方块（基础风格）
npm run test-key-blocks

# 生成关键方块（文字嵌入）  
npm run test-text-blocks
```

#### 只生成Prompts（不调用API）
```bash
# 生成所有基础风格的prompts
npm run prompt-basic

# 生成所有文字风格的prompts
npm run prompt-text

# 生成关键方块的prompts
npm run prompt-key-blocks
```

#### 测试单个纹理
```bash
npm run dev -- --test=empty_tile
```

#### 查看可用方块
```bash
npm run dev -- --list
```

## 详细用法

### 命令行参数

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `--style, -s` | string | `basic` | 生成风格: `basic` 或 `text` |
| `--size` | number | `64` | 输出尺寸: `32`, `64`, 或 `128` |
| `--output, -o` | string | `./generated_textures` | 输出目录 |
| `--replace, -r` | boolean | `false` | 替换原始纹理文件 |
| `--blocks, -b` | string | - | 指定生成的方块（逗号分隔） |
| `--test, -t` | string | - | 测试生成指定方块 |
| `--list, -l` | boolean | `false` | 列出所有可用方块 |
| `--prompt-only, -p` | boolean | `false` | 只生成prompts，不调用API |
| `--api-key` | string | - | NanoBanana API密钥 |

### 使用示例

#### 生成特定方块
```bash
# 只生成空地和机会地块
npm run dev -- --blocks=empty_tile,chance --style=basic

# 生成建筑类型，128x128尺寸
npm run dev -- --blocks=small_house,villa,building,landmark --size=128 --style=text
```

#### 替换原始纹理
```bash
# 生成并自动替换web3_nanobanana_v1中的纹理
npm run dev -- --style=text --size=64 --replace
```

#### 批量测试
```bash
# 测试不同方块的生成效果
npm run dev -- --test=crypto_wallet
npm run dev -- --test=defi_bank  
npm run dev -- --test=metaverse_portal
```

#### 生成Prompt用于手动测试
```bash
# 生成特定方块的prompts，复制到网页AI工具测试
npm run dev -- --prompt-only --blocks=crypto_wallet,defi_bank --style=text

# 生成单个方块的prompt
npm run dev -- --prompt-only --blocks=empty_tile --style=basic
```

## 方块配置

每个方块都有详细的配置，包括：

- **名称和分类**: 组织和管理
- **描述和关键词**: 用于文字嵌入模式
- **双重Prompt**: 基础风格和文字嵌入的专用提示词
- **配色方案**: 确保视觉一致性
- **推荐尺寸**: 根据用途优化

### 示例配置
```typescript
{
  name: 'crypto_wallet',
  category: 'web3',
  description: '加密钱包',
  keyword: 'WALLET',
  basePrompt: 'Pixelated prismarine texture, voxel style, cyan-teal crystalline appearance...',
  textPrompt: 'Pixelated prismarine texture with "WALLET" text clearly visible...',
  colors: ['#20B2AA', '#008B8B', '#00CED1'],
  size: 64
}
```

## 设计理念

### 🎲 大富翁11风格
- 明亮鲜艳的色彩
- 清晰易识别的图标
- 卡通化的视觉风格
- 棋盘游戏的经典元素

### 🧊 体素优化
- 像素完美的边缘
- 保持块状几何形状
- 适合3D体素渲染
- Minecraft风格的美学

### 🌐 Web3主题
- 现代科技感
- 加密货币元素
- 区块链视觉语言
- 未来主义色彩

## 输出结构

```
generated_textures/
├── generation_report.json          # 生成报告
├── backup_original/                # 原始纹理备份（如果使用--replace）
├── empty_tile.png                  # 生成的纹理文件
├── property_1x1.png
├── chance.png
├── crypto_wallet.png
└── ...                            # 其他纹理
```

## 故障排除

### API连接问题
```bash
# 测试API连接
npm run dev -- --test=empty_tile

# 检查API密钥是否正确设置
echo $NANOBANA_API_KEY
```

### 纹理质量问题
- **模糊**: 尝试增加尺寸（64 -> 128）
- **文字不清晰**: 检查prompt是否包含"clearly visible"和"bold text"
- **风格不匹配**: 调整配色方案或prompt描述

### 性能优化
- 使用较小尺寸进行快速测试
- 批量生成时适当增加延迟
- 定期备份成功的纹理

## 扩展开发

### 添加新方块
1. 在`src/config/blocks.ts`中添加配置
2. 设计基础和文字两套prompt
3. 选择合适的颜色和尺寸
4. 测试生成效果

### 自定义风格
1. 修改prompt模板
2. 调整颜色方案
3. 优化尺寸设置
4. 批量测试效果

## 技术栈

- **TypeScript**: 类型安全的开发
- **Sharp**: 高性能图像处理
- **Axios**: HTTP客户端
- **Yargs**: 命令行接口
- **fs-extra**: 文件系统操作

## 许可证

MIT License - 详见LICENSE文件
