/**
 * 横十字（Horizontal Cross）贴图合成器
 * 将6张贴图合成为标准的横十字布局
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';

export interface HorizontalCrossOptions {
  cellSize?: number;  // 单个格子的尺寸
  backgroundColor?: string;  // 背景颜色
  outputPath?: string;
  addGutter?: boolean;  // 是否添加安全边距
  gutterSize?: number;  // 安全边距大小（像素）
}

export interface CubeFaceTextures {
  positiveX: string;  // +X 右面
  negativeX: string;  // -X 左面
  positiveY: string;  // +Y 上面
  negativeY: string;  // -Y 下面
  positiveZ: string;  // +Z 前面
  negativeZ: string;  // -Z 后面
}

/**
 * 横十字布局定义
 * 4列 x 3行的网格，实际使用6格
 *
 *     [空]  [+Y]  [空]  [空]
 *     [-X]  [+Z]  [+X]  [-Z]
 *     [空]  [-Y]  [空]  [空]
 */
export class HorizontalCrossGenerator {
  // UV坐标映射（归一化坐标）
  private readonly faceUVMapping = {
    negativeX: { col: 0, row: 1, u0: 0/4, u1: 1/4, v0: 1/3, v1: 2/3 },
    positiveZ: { col: 1, row: 1, u0: 1/4, u1: 2/4, v0: 1/3, v1: 2/3 },
    positiveX: { col: 2, row: 1, u0: 2/4, u1: 3/4, v0: 1/3, v1: 2/3 },
    negativeZ: { col: 3, row: 1, u0: 3/4, u1: 4/4, v0: 1/3, v1: 2/3 },
    positiveY: { col: 1, row: 2, u0: 1/4, u1: 2/4, v0: 2/3, v1: 3/3 },
    negativeY: { col: 1, row: 0, u0: 1/4, u1: 2/4, v0: 0/3, v1: 1/3 },
  };

  /**
   * 从6张独立贴图生成横十字布局贴图
   */
  async generateFromTextures(
    textures: CubeFaceTextures,
    options: HorizontalCrossOptions = {}
  ): Promise<void> {
    const {
      cellSize = 128,
      backgroundColor = 'transparent',
      outputPath = './horizontal_cross_atlas.png',
      addGutter = false,
      gutterSize = 2
    } = options;

    console.log('🎯 生成横十字贴图...');
    console.log(`📐 单格尺寸: ${cellSize}x${cellSize}`);
    console.log(`📐 总尺寸: ${cellSize * 4}x${cellSize * 3}`);
    console.log(`📁 输出路径: ${outputPath}\n`);

    // 创建4x3的画布
    const canvasWidth = cellSize * 4;
    const canvasHeight = cellSize * 3;

    // 创建空白画布
    const canvas = sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: backgroundColor === 'transparent'
          ? { r: 0, g: 0, b: 0, alpha: 0 }
          : backgroundColor
      }
    });

    // 准备合成操作
    const compositeOperations: sharp.OverlayOptions[] = [];

    // 处理每个面
    const faces = [
      { texture: textures.negativeX, mapping: this.faceUVMapping.negativeX, name: '-X' },
      { texture: textures.positiveZ, mapping: this.faceUVMapping.positiveZ, name: '+Z' },
      { texture: textures.positiveX, mapping: this.faceUVMapping.positiveX, name: '+X' },
      { texture: textures.negativeZ, mapping: this.faceUVMapping.negativeZ, name: '-Z' },
      { texture: textures.positiveY, mapping: this.faceUVMapping.positiveY, name: '+Y' },
      { texture: textures.negativeY, mapping: this.faceUVMapping.negativeY, name: '-Y' },
    ];

    for (const face of faces) {
      console.log(`  处理面 ${face.name}: ${path.basename(face.texture)}`);

      // 读取并调整图片尺寸
      let faceImage = sharp(face.texture)
        .resize(cellSize, cellSize, {
          fit: 'fill',
          kernel: sharp.kernel.lanczos3
        });

      // 如果需要添加安全边距
      if (addGutter && gutterSize > 0) {
        const shrinkSize = cellSize - gutterSize * 2;
        faceImage = faceImage
          .resize(shrinkSize, shrinkSize)
          .extend({
            top: gutterSize,
            bottom: gutterSize,
            left: gutterSize,
            right: gutterSize,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          });
      }

      // 转换为buffer
      const buffer = await faceImage.toBuffer();

      // 添加到合成操作
      compositeOperations.push({
        input: buffer,
        left: face.mapping.col * cellSize,
        top: (2 - face.mapping.row) * cellSize  // 注意Y轴翻转（OpenGL坐标系）
      });
    }

    // 执行合成
    await canvas
      .composite(compositeOperations)
      .toFile(outputPath);

    console.log(`\n✅ 横十字贴图已生成: ${outputPath}`);

    // 生成UV映射报告
    await this.generateUVReport(outputPath, cellSize);
  }

  /**
   * 生成UV映射报告
   */
  private async generateUVReport(
    atlasPath: string,
    cellSize: number
  ): Promise<void> {
    const reportPath = atlasPath.replace('.png', '_uv_mapping.json');

    const report = {
      atlas: path.basename(atlasPath),
      gridSize: { cols: 4, rows: 3 },
      cellSize: { width: cellSize, height: cellSize },
      totalSize: { width: cellSize * 4, height: cellSize * 3 },
      faceMapping: Object.entries(this.faceUVMapping).map(([face, mapping]) => ({
        face,
        gridPosition: { col: mapping.col, row: mapping.row },
        uvRange: {
          u: [mapping.u0, mapping.u1],
          v: [mapping.v0, mapping.v1]
        },
        pixelRange: {
          x: [mapping.col * cellSize, (mapping.col + 1) * cellSize],
          y: [mapping.row * cellSize, (mapping.row + 1) * cellSize]
        }
      })),
      usage: {
        cocos: "Use this atlas with custom shader supporting horizontal cross UV mapping",
        unity: "Compatible with Unity's Cubemap texture import settings",
        threejs: "Use with THREE.CubeTextureLoader or custom geometry UV"
      }
    };

    await fs.writeJSON(reportPath, report, { spaces: 2 });
    console.log(`📊 UV映射报告: ${reportPath}`);
  }

  /**
   * 从骰子映射生成横十字贴图
   * 骰子面映射规则：对面之和为7
   */
  async generateDiceAtlas(
    diceFaces: string[],
    options: HorizontalCrossOptions = {}
  ): Promise<void> {
    if (diceFaces.length !== 6) {
      throw new Error('需要6个骰子面贴图');
    }

    // 标准骰子映射（对面之和为7）
    const diceMapping: CubeFaceTextures = {
      positiveX: diceFaces[0],  // 面1
      negativeX: diceFaces[5],  // 面6（1的对面）
      positiveY: diceFaces[1],  // 面2
      negativeY: diceFaces[4],  // 面5（2的对面）
      positiveZ: diceFaces[2],  // 面3
      negativeZ: diceFaces[3],  // 面4（3的对面）
    };

    console.log('🎲 生成骰子横十字贴图');
    console.log('映射规则：');
    console.log('  +X(右): 面1');
    console.log('  -X(左): 面6');
    console.log('  +Y(上): 面2');
    console.log('  -Y(下): 面5');
    console.log('  +Z(前): 面3');
    console.log('  -Z(后): 面4\n');

    await this.generateFromTextures(diceMapping, options);
  }

  /**
   * 验证横十字贴图的有效性
   */
  async validateAtlas(atlasPath: string): Promise<boolean> {
    try {
      const metadata = await sharp(atlasPath).metadata();

      if (!metadata.width || !metadata.height) {
        console.error('❌ 无法获取图片尺寸');
        return false;
      }

      // 检查宽高比是否为4:3
      const aspectRatio = metadata.width / metadata.height;
      const expectedRatio = 4 / 3;

      if (Math.abs(aspectRatio - expectedRatio) > 0.01) {
        console.error(`❌ 宽高比不正确: ${aspectRatio.toFixed(2)}，期望 ${expectedRatio.toFixed(2)}`);
        return false;
      }

      console.log(`✅ 贴图验证通过: ${metadata.width}x${metadata.height}`);
      return true;
    } catch (error: any) {
      console.error(`❌ 验证失败: ${error.message}`);
      return false;
    }
  }
}