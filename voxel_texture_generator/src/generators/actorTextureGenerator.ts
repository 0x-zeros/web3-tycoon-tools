/**
 * Actor纹理生成器 - 用于生成ActorConfig.ts中定义的所有纹理
 */

import path from 'path';
import fs from 'fs-extra';
import { NanoBananaGenerator } from './nanobana';
import { ImageProcessor } from '../utils/imageProcessor';
import {
  ActorTextureConfig,
  ALL_ACTOR_TEXTURES,
  NPC_TEXTURES,
  BUILDING_TEXTURES,
  OBJECT_TEXTURES,
  generateAnimationFrames,
  getTexturesByCategory
} from '../config/actors';

export interface ActorGenerationOptions {
  outputSize?: number;              // 输出尺寸（默认256）
  outputDir?: string;               // 输出目录
  includeAnimations?: boolean;      // 是否生成动画帧
  categories?: ('npc' | 'building' | 'object')[];  // 要生成的类别
  specificActors?: string[];        // 特定的Actor名称
}

export interface ActorTextureResult {
  name: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  category: string;
}

export class ActorTextureGenerator {
  private nanobana: NanoBananaGenerator;
  private imageProcessor: ImageProcessor;
  private outputDir: string;

  constructor(apiKey?: string, outputDir: string = './generated_actor_textures') {
    this.nanobana = new NanoBananaGenerator(apiKey);
    this.imageProcessor = new ImageProcessor();
    this.outputDir = path.resolve(outputDir);
  }

  /**
   * 生成所有Actor纹理
   */
  async generateAll(options: ActorGenerationOptions = {}): Promise<ActorTextureResult[]> {
    const {
      outputSize = 256,
      includeAnimations = false,
      categories = ['npc', 'building', 'object']
    } = options;

    console.log(`🎮 Starting Actor texture generation...`);
    console.log(`📐 Output Size: ${outputSize}x${outputSize}`);
    console.log(`📁 Output Directory: ${this.outputDir}`);
    console.log(`📚 Categories: ${categories.join(', ')}`);
    console.log(`🎬 Include Animations: ${includeAnimations}`);

    // 测试API连接
    const isConnected = await this.nanobana.testConnection();
    if (!isConnected) {
      throw new Error('❌ Cannot connect to API. Please check your API key.');
    }

    // 创建输出目录结构
    await this.createOutputDirectories(categories);

    const results: ActorTextureResult[] = [];

    // 按类别生成纹理
    for (const category of categories) {
      console.log(`\n🏷️ Generating ${category.toUpperCase()} textures...`);
      const categoryTextures = getTexturesByCategory(category);

      for (const textureConfig of categoryTextures) {
        // 生成主纹理
        const mainResult = await this.generateSingleTexture(textureConfig, outputSize);
        results.push(mainResult);

        // 生成动画帧（如果需要）
        if (includeAnimations && textureConfig.variants) {
          const frameConfigs = generateAnimationFrames(textureConfig);
          for (const frameConfig of frameConfigs) {
            if (frameConfig.name !== textureConfig.name) {
              const frameResult = await this.generateSingleTexture(frameConfig, outputSize);
              results.push(frameResult);
            }
          }
        }
      }
    }

    // 生成报告
    await this.generateReport(results);

    return results;
  }

  /**
   * 生成特定的Actor纹理
   */
  async generateSpecific(
    actorNames: string[],
    options: ActorGenerationOptions = {}
  ): Promise<ActorTextureResult[]> {
    const { outputSize = 256, includeAnimations = false } = options;

    console.log(`🎯 Generating specific actors: ${actorNames.join(', ')}`);

    // 创建输出目录
    await this.createOutputDirectories(['npc', 'building', 'object']);

    const results: ActorTextureResult[] = [];

    for (const actorName of actorNames) {
      const config = ALL_ACTOR_TEXTURES.find(t => t.name === actorName);

      if (!config) {
        console.error(`❌ Actor '${actorName}' not found`);
        results.push({
          name: actorName,
          success: false,
          error: 'Actor not found',
          category: 'unknown'
        });
        continue;
      }

      // 生成主纹理
      const mainResult = await this.generateSingleTexture(config, outputSize);
      results.push(mainResult);

      // 生成动画帧
      if (includeAnimations && config.variants) {
        const frameConfigs = generateAnimationFrames(config);
        for (const frameConfig of frameConfigs) {
          if (frameConfig.name !== config.name) {
            const frameResult = await this.generateSingleTexture(frameConfig, outputSize);
            results.push(frameResult);
          }
        }
      }
    }

    return results;
  }

  /**
   * 生成NPC纹理
   */
  async generateNPCs(includeAnimations: boolean = false): Promise<ActorTextureResult[]> {
    return this.generateAll({
      categories: ['npc'],
      includeAnimations
    });
  }

  /**
   * 生成建筑纹理
   */
  async generateBuildings(): Promise<ActorTextureResult[]> {
    return this.generateAll({
      categories: ['building'],
      includeAnimations: false
    });
  }

  /**
   * 生成物体纹理
   */
  async generateObjects(): Promise<ActorTextureResult[]> {
    return this.generateAll({
      categories: ['object'],
      includeAnimations: false
    });
  }

  /**
   * 生成单个纹理
   */
  private async generateSingleTexture(
    config: ActorTextureConfig,
    outputSize: number
  ): Promise<ActorTextureResult> {
    const result: ActorTextureResult = {
      name: config.name,
      category: config.category,
      success: false
    };

    console.log(`\n🎨 Generating: ${config.name} - ${config.description}`);

    try {
      // 调用API生成图像
      const generationResult = await this.nanobana.generateTexture(
        config.prompt,
        config.size || outputSize
      );

      if (generationResult.success && generationResult.imageUrl) {
        // 下载图像
        const tempPath = path.join(this.outputDir, 'temp', `${config.name}_temp.png`);
        await fs.ensureDir(path.dirname(tempPath));

        const downloadSuccess = await this.imageProcessor.downloadImage(
          generationResult.imageUrl,
          tempPath
        );

        if (downloadSuccess) {
          // 优化和调整大小
          const categoryDir = path.join(this.outputDir, config.category);
          const finalPath = path.join(categoryDir, `${config.name}.png`);

          const optimizeSuccess = await this.imageProcessor.optimizeTexture(
            tempPath,
            finalPath,
            outputSize
          );

          if (optimizeSuccess) {
            // 验证图像
            const isValid = await this.imageProcessor.validateImage(finalPath);

            if (isValid) {
              result.success = true;
              result.outputPath = finalPath;
              console.log(`✅ Successfully generated: ${config.name}`);
            } else {
              result.error = 'Image validation failed';
              console.error(`❌ Validation failed for ${config.name}`);
            }
          } else {
            result.error = 'Image optimization failed';
            console.error(`❌ Optimization failed for ${config.name}`);
          }

          // 清理临时文件
          await fs.remove(tempPath);
        } else {
          result.error = 'Image download failed';
          console.error(`❌ Download failed for ${config.name}`);
        }
      } else {
        result.error = generationResult.error || 'Generation failed';
        console.error(`❌ Generation failed for ${config.name}: ${result.error}`);
      }
    } catch (error: any) {
      result.error = error.message;
      console.error(`❌ Error generating ${config.name}: ${error.message}`);
    }

    return result;
  }

  /**
   * 创建输出目录结构
   */
  private async createOutputDirectories(categories: string[]): Promise<void> {
    await fs.ensureDir(this.outputDir);
    await fs.ensureDir(path.join(this.outputDir, 'temp'));

    for (const category of categories) {
      await fs.ensureDir(path.join(this.outputDir, category));
    }
  }

  /**
   * 生成报告
   */
  private async generateReport(results: ActorTextureResult[]): Promise<void> {
    const reportPath = path.join(this.outputDir, 'actor_generation_report.json');

    const categorySummary: { [key: string]: { total: number; success: number; failed: number } } = {};

    // 统计各类别结果
    for (const result of results) {
      if (!categorySummary[result.category]) {
        categorySummary[result.category] = { total: 0, success: 0, failed: 0 };
      }

      categorySummary[result.category].total++;
      if (result.success) {
        categorySummary[result.category].success++;
      } else {
        categorySummary[result.category].failed++;
      }
    }

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        byCategory: categorySummary
      },
      results: results.map(r => ({
        name: r.name,
        category: r.category,
        success: r.success,
        outputPath: r.outputPath ? path.relative(this.outputDir, r.outputPath) : undefined,
        error: r.error
      }))
    };

    await fs.writeJSON(reportPath, report, { spaces: 2 });

    console.log('\n📊 Generation Report:');
    console.log(`Total: ${report.summary.total}`);
    console.log(`✅ Successful: ${report.summary.successful}`);
    console.log(`❌ Failed: ${report.summary.failed}`);

    for (const [category, stats] of Object.entries(categorySummary)) {
      console.log(`\n${category.toUpperCase()}: ${stats.success}/${stats.total} successful`);
    }

    console.log(`\n📄 Full report saved to: ${reportPath}`);
  }

  /**
   * 列出所有可用的Actor
   */
  listAvailableActors(): void {
    console.log('\n📋 Available Actor Textures:\n');

    console.log('🤖 NPCs:');
    NPC_TEXTURES.forEach(npc => {
      console.log(`  - ${npc.name}: ${npc.description}`);
      if (npc.variants) {
        console.log(`    Animations: ${npc.variants.join(', ')}`);
      }
    });

    console.log('\n🏢 Buildings:');
    BUILDING_TEXTURES.forEach(building => {
      console.log(`  - ${building.name}: ${building.description}`);
    });

    console.log('\n📦 Objects:');
    OBJECT_TEXTURES.forEach(obj => {
      console.log(`  - ${obj.name}: ${obj.description}`);
    });

    console.log('\n💡 Usage examples:');
    console.log('  npm run generate-actors          # Generate all actors');
    console.log('  npm run generate-npcs            # Generate only NPCs');
    console.log('  npm run generate-buildings       # Generate only buildings');
    console.log('  npm run generate-actors-specific -- --actors=land_god,wealth_god');
  }
}