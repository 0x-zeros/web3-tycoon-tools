import path from 'path';
import fs from 'fs-extra';
import { BLOCKS } from '../config/blocks';
import { GenerationOptions, TextureGenerationResult, BlockConfig } from '../types';
import { NanoBananaGenerator } from './nanobana';
import { ImageProcessor } from '../utils/imageProcessor';

export class TextureGenerator {
  private nanobana: NanoBananaGenerator;
  private imageProcessor: ImageProcessor;
  private outputDir: string;
  private targetDir: string;

  constructor(
    apiKey?: string,
    outputDir: string = './generated_textures',
    targetDir: string = '../voxel_ai_out/assets/web3_nanobanana_v1/textures/block'
  ) {
    this.nanobana = new NanoBananaGenerator(apiKey);
    this.imageProcessor = new ImageProcessor();
    this.outputDir = path.resolve(outputDir);
    this.targetDir = path.resolve(targetDir);
  }

  /**
   * 生成所有纹理
   */
  async generateAll(options: GenerationOptions): Promise<TextureGenerationResult[]> {
    const results: TextureGenerationResult[] = [];
    
    console.log(`🚀 Starting texture generation...`);
    console.log(`📝 Style: ${options.style}`);
    console.log(`📐 Output Size: ${options.outputSize}x${options.outputSize}`);
    console.log(`📁 Output Path: ${this.outputDir}`);
    console.log(`🎯 Target Path: ${this.targetDir}`);
    
    // 测试API连接
    const isConnected = await this.nanobana.testConnection();
    if (!isConnected) {
      throw new Error('❌ Cannot connect to NanoBanana API. Please check your API key.');
    }

    // 确保输出目录存在
    await fs.ensureDir(this.outputDir);
    await fs.ensureDir(this.targetDir);

    // 备份原始纹理
    if (options.replaceOriginal) {
      const backupDir = path.join(this.outputDir, 'backup_original');
      await this.imageProcessor.backupTextures(this.targetDir, backupDir);
    }

    // 准备生成prompts
    const prompts = BLOCKS.map(block => ({
      blockName: block.name,
      prompt: options.style === 'basic' ? block.basePrompt : block.textPrompt,
      size: options.outputSize || block.size
    }));

    console.log(`\n📋 Generating prompts for ${prompts.length} blocks...`);
    prompts.forEach((p, i) => {
      console.log(`${i + 1}. ${p.blockName}: "${p.prompt.substring(0, 80)}..."`);
    });

    // 批量生成纹理
    const generationResults = await this.nanobana.generateBatchTextures(prompts, 3000);

    // 处理每个生成结果
    for (const { blockName, result } of generationResults) {
      const textureResult: TextureGenerationResult = {
        blockName,
        success: false
      };

      if (result.success && result.imageUrl) {
        try {
          // 下载生成的图片
          const tempPath = path.join(this.outputDir, `temp_${blockName}.png`);
          const downloadSuccess = await this.imageProcessor.downloadImage(result.imageUrl, tempPath);
          
          if (downloadSuccess) {
            // 优化纹理
            const finalPath = path.join(this.outputDir, `${blockName}.png`);
            const optimizeSuccess = await this.imageProcessor.optimizeTexture(
              tempPath, 
              finalPath, 
              options.outputSize
            );
            
            if (optimizeSuccess) {
              // 验证图片
              const isValid = await this.imageProcessor.validateImage(finalPath);
              
              if (isValid) {
                textureResult.success = true;
                textureResult.outputPath = finalPath;
                
                // 如果需要替换原始文件
                if (options.replaceOriginal) {
                  const targetPath = path.join(this.targetDir, `${blockName}.png`);
                  await fs.copy(finalPath, targetPath, { overwrite: true });
                  console.log(`🔄 Replaced original texture: ${targetPath}`);
                }
              }
            }
            
            // 清理临时文件
            await fs.remove(tempPath);
          }
        } catch (error: any) {
          console.error(`❌ Failed to process ${blockName}:`, error.message);
          textureResult.error = error.message;
        }
      } else {
        textureResult.error = result.error || 'Generation failed';
      }

      results.push(textureResult);
    }

    // 生成总结报告
    await this.generateReport(results, options);

    return results;
  }

  /**
   * 生成指定的纹理块
   */
  async generateSpecific(
    blockNames: string[], 
    options: GenerationOptions
  ): Promise<TextureGenerationResult[]> {
    const filteredBlocks = BLOCKS.filter(block => blockNames.includes(block.name));
    
    if (filteredBlocks.length === 0) {
      throw new Error(`❌ No valid blocks found. Available blocks: ${BLOCKS.map(b => b.name).join(', ')}`);
    }

    console.log(`🎯 Generating specific blocks: ${filteredBlocks.map(b => b.name).join(', ')}`);
    
    // 临时替换BLOCKS列表
    const originalBlocks = [...BLOCKS];
    (BLOCKS as any).length = 0;
    BLOCKS.push(...filteredBlocks);
    
    try {
      const results = await this.generateAll(options);
      return results;
    } finally {
      // 恢复原始BLOCKS列表
      (BLOCKS as any).length = 0;
      BLOCKS.push(...originalBlocks);
    }
  }

  /**
   * 生成测试纹理（单个块用于测试）
   */
  async generateTest(blockName: string = 'empty_tile'): Promise<TextureGenerationResult> {
    const block = BLOCKS.find(b => b.name === blockName);
    if (!block) {
      throw new Error(`❌ Block '${blockName}' not found`);
    }

    console.log(`🧪 Generating test texture for: ${blockName}`);
    
    const result = await this.nanobana.generateTexture(block.basePrompt, 64);
    
    if (result.success && result.imageUrl) {
      const outputPath = path.join(this.outputDir, `test_${blockName}.png`);
      const downloadSuccess = await this.imageProcessor.downloadImage(result.imageUrl, outputPath);
      
      return {
        blockName,
        success: downloadSuccess,
        outputPath: downloadSuccess ? outputPath : undefined,
        error: downloadSuccess ? undefined : 'Download failed'
      };
    }

    return {
      blockName,
      success: false,
      error: result.error || 'Generation failed'
    };
  }

  /**
   * 生成详细报告
   */
  private async generateReport(
    results: TextureGenerationResult[], 
    options: GenerationOptions
  ): Promise<void> {
    const reportPath = path.join(this.outputDir, 'generation_report.json');
    
    const report = {
      timestamp: new Date().toISOString(),
      options,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      },
      results: results.map(r => ({
        blockName: r.blockName,
        success: r.success,
        outputPath: r.outputPath ? path.relative(this.outputDir, r.outputPath) : undefined,
        error: r.error
      }))
    };

    await fs.writeJSON(reportPath, report, { spaces: 2 });
    console.log(`📊 Generation report saved: ${reportPath}`);
  }

  /**
   * 列出所有可用的块
   */
  listAvailableBlocks(): void {
    console.log(`\n📋 Available blocks (${BLOCKS.length} total):\n`);
    
    const categories = Array.from(new Set(BLOCKS.map(b => b.category)));
    
    categories.forEach(category => {
      console.log(`\n🏷️  ${category.toUpperCase()}:`);
      const categoryBlocks = BLOCKS.filter(b => b.category === category);
      categoryBlocks.forEach(block => {
        console.log(`  - ${block.name}: ${block.description} (keyword: "${block.keyword}")`);
      });
    });
    
    console.log(`\n💡 Usage examples:`);
    console.log(`  npm run generate-basic`);
    console.log(`  npm run generate-text`);
    console.log(`  npm run dev -- --style=basic --blocks=empty_tile,chance,bonus`);
    console.log(`  npm run dev -- --style=text --size=128 --replace`);
  }
}
