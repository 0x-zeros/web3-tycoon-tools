# 卡牌纹理生成器

本地生成Web3大富翁游戏的卡牌纹理，使用中文文字 + 装饰边框的样式。

## 功能特点

- ✅ 8种游戏卡牌纹理
- ✅ 3个稀有度等级（普通、稀有、史诗）
- ✅ 基于稀有度的颜色编码
- ✅ 透明背景，带装饰边框
- ✅ 自动字体大小调整
- ✅ 生成详细报告

## 卡牌列表

### 🟢 普通卡牌 (绿色 #4CAF50)
1. **遥控骰子** (`move_ctrl.png`) - 控制下一次移动到指定位置
2. **路障卡** (`barrier.png`) - 在地块上放置路障
3. **机器娃娃** (`cleanse.png`) - 清除一段路上的所有NPC
4. **转向卡** (`turn.png`) - 改变移动方向

### 🔵 稀有卡牌 (蓝色 #2196F3)
1. **炸弹卡** (`bomb.png`) - 在地块上放置炸弹
2. **免租卡** (`rent_free.png`) - 本回合避免支付租金
3. **狗狗卡** (`dog.png`) - 在地块上放置恶犬

### 🟣 史诗卡牌 (紫色 #9C27B0)
1. **冰冻卡** (`freeze.png`) - 冻结一个玩家一回合

## 使用方法

### 列出所有卡牌
```bash
npm run list-cards-local
```

### 生成所有卡牌
```bash
npm run generate-cards-local
```

### 生成特定卡牌（通过kind ID）
```bash
npm run generate-cards-local -- --cards=0,1,2
# 生成遥控骰子、路障卡、炸弹卡
```

### 按稀有度生成
```bash
npm run generate-cards-local -- --rarity=0  # 普通卡牌
npm run generate-cards-local -- --rarity=1  # 稀有卡牌
npm run generate-cards-local -- --rarity=2  # 史诗卡牌
```

### 自定义参数
```bash
npm run generate-cards-local -- --size=512 --fontSize=48 --output=./my_cards
```

## 输出结构

```
generated_local_textures/
└── cards/
    ├── move_ctrl.png          # 遥控骰子
    ├── barrier.png            # 路障卡
    ├── bomb.png               # 炸弹卡
    ├── rent_free.png          # 免租卡
    ├── freeze.png             # 冰冻卡
    ├── dog.png                # 狗狗卡
    ├── cleanse.png            # 机器娃娃
    ├── turn.png               # 转向卡
    └── card_generation_report.json
```

## 卡牌样式说明

### 视觉特征
- **透明背景**：便于叠加到游戏界面
- **圆角边框**：根据稀有度调整粗细
  - 普通：2px
  - 稀有：3px
  - 史诗：4px
- **发光效果**：边框带有发光滤镜，史诗卡牌最明显
- **文字背景条**：半透明黑色背景提高可读性
- **文字描边**：白色描边确保文字清晰
- **稀有度指示器**：顶部小圆点表示稀有度等级

### 颜色方案
- **普通卡**：绿色（#4CAF50）- 友好、常见
- **稀有卡**：蓝色（#2196F3）- 珍贵、强大
- **史诗卡**：紫色（#9C27B0）- 传奇、极致

## 技术实现

### 配置文件
- `src/config/cards.ts` - 卡牌配置定义

### 生成器
- `src/generators/localTextGenerator.ts` - 核心纹理生成器（扩展支持卡牌）
- `src/generateCardsLocal.ts` - 卡牌生成脚本

### 关键方法
- `generateCardTexture()` - 生成单张卡牌
- `generateCardBatch()` - 批量生成
- `createCardSVG()` - 创建卡牌样式的SVG

## 生成报告示例

生成完成后会创建 `card_generation_report.json`，包含：
- 生成时间戳
- 成功/失败统计
- 每张卡牌的详细信息（kind、名称、描述、稀有度、文件名等）

## 扩展新卡牌

在 `src/config/cards.ts` 中添加新卡牌：

```typescript
{
  kind: 8,
  name: '新卡牌名称',
  description: '卡牌效果描述',
  targetType: 0,  // 0=自己, 1=玩家, 2=地块
  value: 1,
  rarity: 1,      // 0=普通, 1=稀有, 2=史诗
  iconPath: 'web3/cards/new_card'
}
```

然后运行生成命令即可。

## 相关命令

- `npm run list-cards-local` - 列出所有卡牌
- `npm run generate-cards-local` - 生成所有卡牌
- `npm run generate-cards-local-test` - 测试生成（前3张）
- `npm run generate-cards-local-rarity` - 生成稀有卡牌

## 注意事项

1. 所有纹理默认256x256像素，可通过 `--size` 参数调整
2. 字体大小默认36px，可通过 `--fontSize` 参数调整
3. 输出为PNG格式，透明背景
4. 文字过长会自动缩小以适应卡牌
5. 生成报告包含完整的卡牌元数据，可用于游戏逻辑参考
