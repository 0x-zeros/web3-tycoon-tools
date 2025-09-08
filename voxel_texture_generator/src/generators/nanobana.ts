const { GoogleGenAI } = require('@google/genai');
import { NanoBananaResponse } from '../types';
import fs from 'fs-extra';

export class NanoBananaGenerator {
  private gemini?: any;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️ Google Gemini API key not found. Only prompt generation will work.');
      console.warn('💡 Set GEMINI_API_KEY environment variable or provide it directly.');
    } else {
      this.gemini = new GoogleGenAI(this.apiKey);
    }
  }

  /**
   * 生成单个纹理图片
   */
  async generateTexture(prompt: string, size: number = 64): Promise<NanoBananaResponse> {
    try {
      console.log(`🎨 Generating texture with Nano Banana: "${prompt}"`);
      console.log(`📐 Size: ${size}x${size}`);

      if (!this.gemini) {
        console.error('❌ No Gemini client available for actual generation');
        return {
          success: false,
          error: 'Gemini API key required for texture generation'
        };
      }

      // 增强prompt以确保像素艺术风格
      const enhancedPrompt = `Create a ${size}x${size} pixel art texture: ${prompt}. Style: 8-bit game texture, pixel perfect edges, bright vibrant colors, tile-able pattern, square format, no text or watermarks, clean geometric shapes, minecraft-inspired voxel aesthetic.`;

      // 使用asset-generator的实现方式
      const response = await this.gemini.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: enhancedPrompt
      });

      console.log('🔍 Gemini response received');

      if (response && response.candidates && response.candidates[0] && response.candidates[0].content) {
        const parts = response.candidates[0].content.parts;
        
        for (const part of parts) {
          if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('image/')) {
            console.log(`✅ Nano Banana generation successful`);
            
            // 将base64数据转换为data URL
            const imageDataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            
            return {
              success: true,
              imageUrl: imageDataUrl,
              base64Data: part.inlineData.data
            };
          }
        }
        
        console.error(`❌ Generation failed: No image data in Gemini response`);
        return {
          success: false,
          error: 'No image data returned from Nano Banana'
        };
      } else {
        console.error(`❌ Generation failed: Invalid response format from Gemini`);
        return {
          success: false,
          error: 'Invalid response format from Nano Banana'
        };
      }
    } catch (error: any) {
      console.error(`❌ Nano Banana request failed:`, error.message);
      
      // 提供更具体的错误信息
      if (error.message.includes('API_KEY') || error.message.includes('authentication')) {
        console.error('💡 Hint: Make sure your Gemini API key is valid');
        console.error('💡 Get your API key from: https://aistudio.google.com/app/apikey');
      }
      
      return {
        success: false,
        error: error.message || 'Nano Banana API error'
      };
    }
  }

  /**
   * 批量生成纹理
   */
  async generateBatchTextures(
    prompts: Array<{blockName: string, prompt: string, size: number}>,
    delayMs: number = 3000
  ): Promise<Array<{blockName: string, result: NanoBananaResponse}>> {
    const results: Array<{blockName: string, result: NanoBananaResponse}> = [];
    
    console.log(`🚀 Starting batch generation of ${prompts.length} textures with Nano Banana...`);
    
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
      console.log('🔍 Testing Google AI (Nano Banana) connection...');
      
      if (!this.gemini) {
        console.error('❌ No Gemini client available');
        console.error('💡 Solution: Set GEMINI_API_KEY environment variable');
        console.error('💡 Get your API key from: https://aistudio.google.com/app/apikey');
        return false;
      }

      // 简单的测试生成
      const testPrompt = 'Test connection: Simple 32x32 blue square pixel art texture';
      const testResult = await this.gemini.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: testPrompt
      });
      
      if (testResult && testResult.candidates && testResult.candidates[0]) {
        console.log('✅ Google AI (Nano Banana) connection successful!');
        console.log('🎨 Nano Banana is ready to generate textures');
        return true;
      } else {
        console.error('❌ Google AI connection failed: No response');
        return false;
      }
    } catch (error: any) {
      console.error('❌ Google AI connection test failed:', error.message);
      
      // 提供更具体的错误信息和解决方案
      if (error.message.includes('API_KEY') || error.message.includes('authentication')) {
        console.error('💡 Solution: Make sure to set GEMINI_API_KEY environment variable');
        console.error('💡 Get your API key from: https://aistudio.google.com/app/apikey');
        console.error('💡 Example: export GEMINI_API_KEY="your_api_key_here"');
      } else if (error.message.includes('model')) {
        console.error('💡 Note: Make sure gemini-2.5-flash-image-preview model is available in your region');
      } else if (error.message.includes('quota') || error.message.includes('limit')) {
        console.error('💡 Note: You may have reached API quota limits');
      }
      
      return false;
    }
  }

  /**
   * 将base64图片写入本地文件
   */
  async writeBase64Image(base64Data: string, filepath: string): Promise<void> {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(filepath, buffer);
      console.log(`💾 Image saved to: ${filepath}`);
    } catch (error: any) {
      throw new Error(`Failed to save image: ${error.message}`);
    }
  }
}
