import { GoogleGenAI } from '@google/genai';
import { NanoBananaResponse } from '../types';
import fs from 'fs-extra';

export class NanoBananaGenerator {
  private ai?: any;

  constructor(apiKey?: string) {
    // 设置API key到环境变量（SDK会自动读取）
    if (apiKey) {
      process.env.GEMINI_API_KEY = apiKey;
    }

    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️ Google Gemini API key not found.');
      console.warn('💡 Set GEMINI_API_KEY environment variable or provide it directly.');
    } else {
      // 初始化 GoogleGenAI 客户端
      this.ai = new GoogleGenAI({});
    }
  }

  /**
   * 生成单个纹理图片（带重试机制）
   */
  async generateTexture(prompt: string, size: number = 64, maxRetries: number = 5): Promise<NanoBananaResponse> {
    const baseDelays = [30, 60, 120, 240, 480]; // 秒，指数退避
    let lastError: any;
    let attemptCount = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attemptCount++;

      try {
        // 如果不是第一次尝试，则等待
        if (attempt > 0) {
          const delay = baseDelays[Math.min(attempt - 1, baseDelays.length - 1)];
          console.log(`⏳ Retry attempt ${attempt}/${maxRetries}, waiting ${delay} seconds...`);
          await this.sleep(delay * 1000);
        }

        console.log(`🎨 Generating texture with Nano Banana: "${prompt}"`);
        console.log(`📐 Size: ${size}x${size}`);
        if (attempt > 0) {
          console.log(`🔄 Attempt: ${attemptCount}/${maxRetries + 1}`);
        }

        if (!this.ai) {
          console.error('❌ No Gemini client available for actual generation');
          return {
            success: false,
            error: 'Gemini API key required for texture generation'
          };
        }

        // 增强prompt以确保像素艺术风格
        const enhancedPrompt = `Create a ${size}x${size} pixel art texture: ${prompt}. Style: 8-bit game texture, pixel perfect edges, bright vibrant colors, tile-able pattern, square format, no text or watermarks, clean geometric shapes, minecraft-inspired voxel aesthetic.`;

        // 使用正确的API调用方式
        const response = await this.ai.models.generateContent({
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
        lastError = error;

        // 检查是否是配额错误（429错误码）
        const isQuotaError = error.message && (
          error.message.includes('429') ||
          error.message.includes('quota') ||
          error.message.includes('RESOURCE_EXHAUSTED') ||
          error.message.includes('exceeded')
        );

        if (isQuotaError) {
          console.warn(`⚠️ Quota exceeded (attempt ${attemptCount}/${maxRetries + 1})`);

          // 尝试从错误信息中提取建议的重试延迟
          const retryMatch = error.message.match(/retry in (\d+(?:\.\d+)?)/i);
          if (retryMatch && attempt === 0) {
            const suggestedDelay = Math.ceil(parseFloat(retryMatch[1]));
            console.log(`📊 API suggests retry in ${suggestedDelay} seconds`);
            await this.sleep(suggestedDelay * 1000);
            continue;
          }

          // 如果还有重试机会，继续
          if (attempt < maxRetries) {
            continue;
          }
        }

        // 对于非配额错误，可能不需要重试
        if (!isQuotaError) {
          console.error(`❌ Nano Banana request failed:`, error.message);

          // 提供更具体的错误信息
          if (error.message.includes('API_KEY') || error.message.includes('authentication')) {
            console.error('💡 Hint: Make sure your Gemini API key is valid');
            console.error('💡 Get your API key from: https://aistudio.google.com/app/apikey');
          }

          // 对于非配额错误，立即返回，不重试
          return {
            success: false,
            error: error.message || 'Nano Banana API error'
          };
        }
      }
    }

    // 所有重试都失败了
    console.error(`❌ All ${attemptCount} attempts failed for texture generation`);
    console.error(`Last error: ${lastError?.message || 'Unknown error'}`);

    return {
      success: false,
      error: `Failed after ${attemptCount} attempts: ${lastError?.message || 'Unknown error'}`
    };
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 批量生成纹理
   */
  async generateBatchTextures(
    prompts: Array<{blockName: string, prompt: string, size: number}>,
    delayMs: number = 3000,
    maxRetries: number = 5
  ): Promise<Array<{blockName: string, result: NanoBananaResponse}>> {
    const results: Array<{blockName: string, result: NanoBananaResponse}> = [];

    console.log(`🚀 Starting batch generation of ${prompts.length} textures with Nano Banana...`);
    console.log(`🔄 Max retries per texture: ${maxRetries}`);
    console.log(`⏱️ Delay between textures: ${delayMs}ms`);

    for (let i = 0; i < prompts.length; i++) {
      const { blockName, prompt, size } = prompts[i];

      console.log(`\n📦 [${i + 1}/${prompts.length}] Processing: ${blockName}`);

      // 使用带重试机制的生成方法
      const result = await this.generateTexture(prompt, size, maxRetries);
      results.push({ blockName, result });

      // 添加延迟避免API限制（仅在成功后或者最后一个失败后才延迟）
      if (i < prompts.length - 1 && !result.success) {
        // 如果失败了，可能已经等待过了，减少额外延迟
        const reducedDelay = Math.min(delayMs, 1000);
        console.log(`⏳ Waiting ${reducedDelay}ms before next texture...`);
        await new Promise(resolve => setTimeout(resolve, reducedDelay));
      } else if (i < prompts.length - 1) {
        console.log(`⏳ Waiting ${delayMs}ms before next texture...`);
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

      if (!this.ai) {
        console.error('❌ No Gemini client available');
        console.error('💡 Solution: Set GEMINI_API_KEY environment variable');
        console.error('💡 Get your API key from: https://aistudio.google.com/app/apikey');
        return false;
      }

      // 简单的测试生成
      const testPrompt = 'Test connection: Simple 32x32 blue square pixel art texture';
      const testResult = await this.ai.models.generateContent({
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
