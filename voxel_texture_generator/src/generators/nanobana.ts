import axios from 'axios';
import { NanoBananaResponse } from '../types';

export class NanoBananaGenerator {
  private apiKey: string;
  private baseUrl: string = 'https://api.nanobana.ai/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.NANOBANA_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('NanoBanana API key is required. Set NANOBANA_API_KEY environment variable or provide it directly.');
    }
  }

  /**
   * 生成单个纹理图片
   */
  async generateTexture(prompt: string, size: number = 64): Promise<NanoBananaResponse> {
    try {
      console.log(`🎨 Generating texture with prompt: "${prompt}"`);
      console.log(`📐 Size: ${size}x${size}`);

      const response = await axios.post(
        `${this.baseUrl}/image/generate`,
        {
          prompt: prompt,
          width: size,
          height: size,
          style: 'pixel-art',
          quality: 'high',
          format: 'png',
          // 针对像素艺术的特殊参数
          pixel_perfect: true,
          retro_style: true,
          minecraft_inspired: true
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60秒超时
        }
      );

      if (response.data.success && response.data.image_url) {
        console.log(`✅ Texture generated successfully: ${response.data.image_url}`);
        return {
          success: true,
          imageUrl: response.data.image_url
        };
      } else {
        console.error(`❌ Generation failed:`, response.data);
        return {
          success: false,
          error: response.data.error || 'Unknown error from NanoBanana API'
        };
      }
    } catch (error: any) {
      console.error(`❌ API request failed:`, error.message);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * 批量生成纹理
   */
  async generateBatchTextures(
    prompts: Array<{blockName: string, prompt: string, size: number}>,
    delayMs: number = 2000
  ): Promise<Array<{blockName: string, result: NanoBananaResponse}>> {
    const results: Array<{blockName: string, result: NanoBananaResponse}> = [];
    
    console.log(`🚀 Starting batch generation of ${prompts.length} textures...`);
    
    for (let i = 0; i < prompts.length; i++) {
      const { blockName, prompt, size } = prompts[i];
      
      console.log(`\n📦 [${i + 1}/${prompts.length}] Processing: ${blockName}`);
      
      const result = await this.generateTexture(prompt, size);
      results.push({ blockName, result });
      
      // 添加延迟避免API限制
      if (i < prompts.length - 1) {
        console.log(`⏳ Waiting ${delayMs}ms before next request...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    console.log(`\n🎉 Batch generation completed!`);
    const successCount = results.filter(r => r.result.success).length;
    console.log(`✅ Success: ${successCount}/${prompts.length}`);
    console.log(`❌ Failed: ${prompts.length - successCount}/${prompts.length}`);
    
    return results;
  }

  /**
   * 测试API连接
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing NanoBanana API connection...');
      
      const response = await axios.get(`${this.baseUrl}/status`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        timeout: 10000
      });
      
      if (response.status === 200) {
        console.log('✅ API connection successful!');
        return true;
      } else {
        console.error('❌ API connection failed:', response.status);
        return false;
      }
    } catch (error: any) {
      console.error('❌ API connection test failed:', error.message);
      return false;
    }
  }
}
