/**
 * 本地文字纹理生成器
 * 生成透明背景的文字图片，用于Actor纹理
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';
import { ActorTextureConfig } from '../config/actors';

export interface LocalTextGeneratorOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  fontFamily?: string;
}

export class LocalTextGenerator {
  private levelColors: { [key: string]: string } = {
    '0': '#808080',  // 灰色 - 空地/0级
    '1': '#4CAF50',  // 绿色 - 1级
    '2': '#2196F3',  // 蓝色 - 2级
    '3': '#9C27B0',  // 紫色 - 3级
    '4': '#FF9800',  // 橙色 - 4级
    '5': '#FFD700',  // 金色 - 5级
    'npc': '#FF6B6B',     // 红色 - NPC
    'object': '#00BCD4',  // 青色 - 物体
    'default': '#333333'  // 默认深灰色
  };

  /**
   * 生成单个Actor的文字纹理
   */
  async generateTextTexture(
    config: ActorTextureConfig,
    outputPath: string,
    options: LocalTextGeneratorOptions = {}
  ): Promise<boolean> {
    const {
      width = 256,
      height = 256,
      fontSize = 32,
      fontFamily = 'Arial, "Microsoft YaHei", "黑体", sans-serif'
    } = options;

    try {
      // 提取显示文字
      const displayText = this.extractDisplayText(config);

      // 获取颜色
      const color = this.getColorForActor(config);

      console.log(`🎨 生成文字纹理: ${config.name} → "${displayText}" (${color})`);

      // 创建SVG
      const svg = this.createTextSVG(displayText, width, height, color, fontSize, fontFamily);

      // 确保输出目录存在
      await fs.ensureDir(path.dirname(outputPath));

      // 使用sharp转换为PNG
      await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);

      console.log(`✅ 文字纹理已保存: ${outputPath}`);
      return true;
    } catch (error: any) {
      console.error(`❌ 生成文字纹理失败 (${config.name}):`, error.message);
      return false;
    }
  }

  /**
   * 批量生成文字纹理
   */
  async generateBatch(
    configs: ActorTextureConfig[],
    outputDir: string,
    options: LocalTextGeneratorOptions = {}
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    console.log(`📦 批量生成 ${configs.length} 个文字纹理...`);

    for (const config of configs) {
      const categoryDir = path.join(outputDir, config.category);
      const outputPath = path.join(categoryDir, `${config.name}.png`);

      const result = await this.generateTextTexture(config, outputPath, options);
      if (result) {
        success++;
      } else {
        failed++;
      }
    }

    console.log(`\n✅ 成功: ${success}, ❌ 失败: ${failed}`);
    return { success, failed };
  }

  /**
   * 从配置中提取显示文字
   */
  private extractDisplayText(config: ActorTextureConfig): string {
    // 从description中提取主要文字
    const description = config.description;

    // 处理不同类型的文字提取
    if (config.category === 'npc') {
      // NPC: 直接使用描述的第一部分
      const match = description.match(/^([^-]+)/);
      return match ? match[1].trim() : config.name;
    } else if (config.category === 'building') {
      // 建筑: 提取名称和等级
      const match = description.match(/^([^-]+)/);
      if (match) {
        const text = match[1].trim();
        // 如果是"空地"，直接返回
        if (text === '空地') {
          return '空地';
        }
        return text;
      }
      return config.name;
    } else if (config.category === 'object') {
      // 物体: 使用描述的第一部分
      const match = description.match(/^([^-]+)/);
      return match ? match[1].trim() : config.name;
    }

    // 默认返回名称
    return config.name;
  }

  /**
   * 获取Actor对应的颜色
   */
  private getColorForActor(config: ActorTextureConfig): string {
    // 从名称中提取等级
    const levelMatch = config.name.match(/lv(\d+)/);
    if (levelMatch) {
      const level = levelMatch[1];
      return this.levelColors[level] || this.levelColors['default'];
    }

    // 特殊处理lv0（空地）
    if (config.name === 'lv0') {
      return this.levelColors['0'];
    }

    // 根据类别返回颜色
    if (config.category === 'npc') {
      return this.levelColors['npc'];
    } else if (config.category === 'object') {
      return this.levelColors['object'];
    }

    return this.levelColors['default'];
  }

  /**
   * 创建文字SVG
   */
  private createTextSVG(
    text: string,
    width: number,
    height: number,
    color: string,
    fontSize: number,
    fontFamily: string
  ): string {
    // 计算文字位置（居中）
    const centerX = width / 2;
    const centerY = height / 2;

    // 添加描边效果让文字更清晰
    const strokeWidth = 2;
    const strokeColor = 'rgba(255, 255, 255, 0.8)';

    // 如果文字太长，自动调整字号
    const maxChars = 8;
    const adjustedFontSize = text.length > maxChars
      ? fontSize * (maxChars / text.length)
      : fontSize;

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow">
      <feDropShadow dx="2" dy="2" stdDeviation="2" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="transparent"/>
  <rect x="${width * 0.1}" y="${height * 0.35}" width="${width * 0.8}" height="${height * 0.3}" fill="rgba(0, 0, 0, 0.2)" rx="10" ry="10"/>
  <text x="${centerX}" y="${centerY}" font-family="sans-serif" font-size="${adjustedFontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" filter="url(#shadow)">${text}</text>
  <text x="${centerX}" y="${centerY}" font-family="sans-serif" font-size="${adjustedFontSize}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="${color}">${text}</text>
  <rect x="5" y="5" width="${width - 10}" height="${height - 10}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="5,5" opacity="0.3" rx="5" ry="5"/>
</svg>`;

    return svg;
  }

  /**
   * 创建简单文字SVG（无装饰）
   */
  private createSimpleTextSVG(
    text: string,
    width: number,
    height: number,
    color: string,
    fontSize: number,
    fontFamily: string
  ): string {
    const centerX = width / 2;
    const centerY = height / 2;

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="transparent"/>
  <text x="${centerX}" y="${centerY}"
        font-family="${fontFamily}"
        font-size="${fontSize}px"
        font-weight="bold"
        fill="${color}"
        text-anchor="middle"
        dominant-baseline="middle">${text}</text>
</svg>`;
  }
}