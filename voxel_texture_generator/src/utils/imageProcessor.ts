import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';

export class ImageProcessor {
  /**
   * 从URL下载图片
   */
  async downloadImage(url: string, outputPath: string): Promise<boolean> {
    try {
      console.log(`⬇️  Downloading image from: ${url}`);
      
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, Buffer.from(response.data));
      
      console.log(`✅ Image downloaded to: ${outputPath}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to download image:`, error.message);
      return false;
    }
  }

  /**
   * 调整图片大小（如果需要的话）
   */
  async resizeImage(
    inputPath: string, 
    outputPath: string, 
    targetSize: number
  ): Promise<boolean> {
    try {
      console.log(`🔄 Resizing image: ${inputPath} -> ${outputPath} (${targetSize}x${targetSize})`);
      
      await sharp(inputPath)
        .resize(targetSize, targetSize, {
          kernel: sharp.kernel.nearest, // 保持像素风格
          fit: 'cover'
        })
        .png()
        .toFile(outputPath);
      
      console.log(`✅ Image resized successfully`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to resize image:`, error.message);
      return false;
    }
  }

  /**
   * 优化纹理图片（确保像素完美）
   */
  async optimizeTexture(
    inputPath: string,
    outputPath: string,
    targetSize: number = 32
  ): Promise<boolean> {
    try {
      console.log(`⚡ Optimizing texture: ${inputPath}`);
      
      await sharp(inputPath)
        .resize(targetSize, targetSize, {
          kernel: sharp.kernel.nearest, // 保持像素艺术风格
          fit: 'cover'
        })
        .png({
          compressionLevel: 0, // 无损压缩
          palette: true, // 使用调色板优化
          quality: 100
        })
        .toFile(outputPath);
      
      console.log(`✅ Texture optimized: ${outputPath}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to optimize texture:`, error.message);
      return false;
    }
  }

  /**
   * 创建纹理图集（可选功能）
   */
  async createAtlas(
    imagePaths: string[],
    outputPath: string,
    gridSize: number = 8
  ): Promise<boolean> {
    try {
      console.log(`📋 Creating texture atlas with ${imagePaths.length} textures`);
      
      const tileSize = 32; // 每个纹理的大小
      const atlasSize = gridSize * tileSize;
      
      // 创建空白canvas
      const canvas = sharp({
        create: {
          width: atlasSize,
          height: atlasSize,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      });

      const compositeImages = [];
      
      for (let i = 0; i < Math.min(imagePaths.length, gridSize * gridSize); i++) {
        const row = Math.floor(i / gridSize);
        const col = i % gridSize;
        const left = col * tileSize;
        const top = row * tileSize;
        
        compositeImages.push({
          input: imagePaths[i],
          left,
          top
        });
      }
      
      await canvas
        .composite(compositeImages)
        .png()
        .toFile(outputPath);
      
      console.log(`✅ Atlas created: ${outputPath}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to create atlas:`, error.message);
      return false;
    }
  }

  /**
   * 备份原始纹理
   */
  async backupTextures(sourcePath: string, backupPath: string): Promise<boolean> {
    try {
      console.log(`📦 Backing up textures: ${sourcePath} -> ${backupPath}`);
      
      await fs.ensureDir(backupPath);
      await fs.copy(sourcePath, backupPath, { overwrite: true });
      
      console.log(`✅ Textures backed up successfully`);
      return true;
    } catch (error: any) {
      console.error(`❌ Failed to backup textures:`, error.message);
      return false;
    }
  }

  /**
   * 验证图片文件
   */
  async validateImage(imagePath: string): Promise<boolean> {
    try {
      const metadata = await sharp(imagePath).metadata();
      
      // 检查是否为有效的图片
      if (!metadata.width || !metadata.height) {
        return false;
      }
      
      // 检查是否为正方形（纹理应该是正方形的）
      if (metadata.width !== metadata.height) {
        console.warn(`⚠️  Warning: ${imagePath} is not square (${metadata.width}x${metadata.height})`);
      }
      
      console.log(`✅ Image validated: ${imagePath} (${metadata.width}x${metadata.height})`);
      return true;
    } catch (error: any) {
      console.error(`❌ Image validation failed for ${imagePath}:`, error.message);
      return false;
    }
  }
}
