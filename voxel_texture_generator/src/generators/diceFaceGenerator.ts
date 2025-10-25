/**
 * 骰子面贴图生成器
 * 生成6个骰子面的贴图，每个面显示1-6的点数
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';

export interface DiceFaceOptions {
  size?: number;
  backgroundColor?: string;
  dotColor?: string;
  dotRadius?: number;
  outputDir?: string;
  specialFaceOneColor?: string;  // 面1的特殊颜色
}

export class DiceFaceGenerator {
  private defaultOptions: Required<DiceFaceOptions> = {
    size: 128,
    backgroundColor: '#FFFFFF',
    dotColor: '#000000',
    dotRadius: 10,
    outputDir: './generated_dice_faces',
    specialFaceOneColor: '#FF0000'  // 红色
  };

  /**
   * 生成所有6个骰子面
   */
  async generateAllFaces(options: DiceFaceOptions = {}): Promise<string[]> {
    const opts = { ...this.defaultOptions, ...options };
    const outputPaths: string[] = [];

    console.log('🎲 生成骰子面贴图...');
    console.log(`📐 尺寸: ${opts.size}x${opts.size}`);
    console.log(`📁 输出目录: ${opts.outputDir}\n`);

    // 确保输出目录存在
    await fs.ensureDir(opts.outputDir);

    // 生成6个面
    for (let face = 1; face <= 6; face++) {
      const outputPath = path.join(opts.outputDir, `dice_face_${face}.png`);
      await this.generateFace(face, outputPath, opts);
      outputPaths.push(outputPath);
      console.log(`✅ 面${face}已生成: ${outputPath}`);
    }

    return outputPaths;
  }

  /**
   * 生成单个骰子面
   */
  async generateFace(
    faceNumber: number,
    outputPath: string,
    options: DiceFaceOptions = {}
  ): Promise<void> {
    const opts = { ...this.defaultOptions, ...options };

    // 创建SVG
    const svg = this.createDiceFaceSVG(faceNumber, opts);

    // 确保输出目录存在
    await fs.ensureDir(path.dirname(outputPath));

    // 使用sharp转换为PNG
    await sharp(Buffer.from(svg))
      .png()
      .toFile(outputPath);
  }

  /**
   * 创建骰子面的SVG
   */
  private createDiceFaceSVG(
    faceNumber: number,
    opts: Required<DiceFaceOptions>
  ): string {
    const { size, backgroundColor, dotColor, dotRadius, specialFaceOneColor } = opts;
    const padding = size * 0.15;
    const center = size / 2;

    // 面1使用特殊颜色（红色）
    const currentDotColor = faceNumber === 1 ? specialFaceOneColor : dotColor;
    const currentBorderColor = faceNumber === 1 ? specialFaceOneColor : dotColor;

    // 点位布局（标准骰子布局）
    const dotPositions = this.getDotPositions(faceNumber, size, padding);

    // 创建点的SVG元素
    const dots = dotPositions.map(([x, y]) =>
      `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${currentDotColor}"/>`
    ).join('\n  ');

    return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- 背景 -->
  <rect width="${size}" height="${size}" fill="${backgroundColor}"/>

  <!-- 边框 -->
  <rect x="2" y="2" width="${size - 4}" height="${size - 4}"
        fill="none" stroke="${currentBorderColor}" stroke-width="2" rx="8" ry="8"/>

  <!-- 点数 -->
  ${dots}
</svg>`;
  }

  /**
   * 获取骰子点的位置
   */
  private getDotPositions(
    faceNumber: number,
    size: number,
    padding: number
  ): [number, number][] {
    const left = padding;
    const right = size - padding;
    const top = padding;
    const bottom = size - padding;
    const centerX = size / 2;
    const centerY = size / 2;

    // 标准骰子点位布局
    switch (faceNumber) {
      case 1:
        // 中心一个点
        return [[centerX, centerY]];

      case 2:
        // 对角线两个点
        return [
          [left, top],
          [right, bottom]
        ];

      case 3:
        // 对角线三个点
        return [
          [left, top],
          [centerX, centerY],
          [right, bottom]
        ];

      case 4:
        // 四个角
        return [
          [left, top],
          [right, top],
          [left, bottom],
          [right, bottom]
        ];

      case 5:
        // 四个角加中心
        return [
          [left, top],
          [right, top],
          [centerX, centerY],
          [left, bottom],
          [right, bottom]
        ];

      case 6:
        // 两列各三个
        return [
          [left, top],
          [left, centerY],
          [left, bottom],
          [right, top],
          [right, centerY],
          [right, bottom]
        ];

      default:
        return [];
    }
  }

  /**
   * 生成数字版骰子面（显示数字而不是点）
   */
  async generateNumberFace(
    faceNumber: number,
    outputPath: string,
    options: DiceFaceOptions = {}
  ): Promise<void> {
    const opts = { ...this.defaultOptions, ...options };
    const { size, backgroundColor, dotColor, specialFaceOneColor } = opts;

    // 面1使用特殊颜色（红色）
    const currentTextColor = faceNumber === 1 ? specialFaceOneColor : dotColor;
    const currentBorderColor = faceNumber === 1 ? specialFaceOneColor : dotColor;

    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- 背景 -->
  <rect width="${size}" height="${size}" fill="${backgroundColor}"/>

  <!-- 边框 -->
  <rect x="2" y="2" width="${size - 4}" height="${size - 4}"
        fill="none" stroke="${currentBorderColor}" stroke-width="2" rx="8" ry="8"/>

  <!-- 数字 -->
  <text x="${size / 2}" y="${size / 2}"
        font-family="Arial, sans-serif"
        font-size="${size * 0.5}"
        font-weight="bold"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="${currentTextColor}">${faceNumber}</text>
</svg>`;

    await fs.ensureDir(path.dirname(outputPath));
    await sharp(Buffer.from(svg))
      .png()
      .toFile(outputPath);
  }

  /**
   * 生成所有数字版骰子面
   */
  async generateAllNumberFaces(options: DiceFaceOptions = {}): Promise<string[]> {
    const opts = { ...this.defaultOptions, ...options };
    const outputPaths: string[] = [];

    console.log('🔢 生成数字版骰子面贴图...');
    console.log(`📐 尺寸: ${opts.size}x${opts.size}`);
    console.log(`📁 输出目录: ${opts.outputDir}\n`);

    await fs.ensureDir(opts.outputDir);

    for (let face = 1; face <= 6; face++) {
      const outputPath = path.join(opts.outputDir, `dice_number_${face}.png`);
      await this.generateNumberFace(face, outputPath, opts);
      outputPaths.push(outputPath);
      console.log(`✅ 数字${face}已生成: ${outputPath}`);
    }

    return outputPaths;
  }
}