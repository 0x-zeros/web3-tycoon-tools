#!/usr/bin/env node

/**
 * 列出所有可用的Gemini模型
 */

import { config } from 'dotenv';
import fetch from 'node-fetch';

config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ 错误: 未找到 GEMINI_API_KEY 环境变量');
  process.exit(1);
}

async function listModels() {
  console.log('📋 获取可用的Gemini模型列表...\n');

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json() as any;

    if (response.ok && data.models) {
      console.log('✅ 可用模型:\n');

      const textModels: any[] = [];
      const visionModels: any[] = [];
      const embedModels: any[] = [];

      data.models.forEach((model: any) => {
        const supportedMethods = model.supportedGenerationMethods || [];

        if (supportedMethods.includes('generateContent')) {
          if (model.name.includes('vision') || model.description?.includes('image')) {
            visionModels.push(model);
          } else {
            textModels.push(model);
          }
        }

        if (supportedMethods.includes('embedContent')) {
          embedModels.push(model);
        }
      });

      console.log('🔤 文本生成模型:');
      textModels.forEach(model => {
        console.log(`  - ${model.name.replace('models/', '')}`);
        console.log(`    版本: ${model.version || 'N/A'}`);
        console.log(`    描述: ${model.description || 'N/A'}`);
        console.log(`    支持的方法: ${(model.supportedGenerationMethods || []).join(', ')}`);
        console.log('');
      });

      console.log('🖼️ 视觉理解模型:');
      visionModels.forEach(model => {
        console.log(`  - ${model.name.replace('models/', '')}`);
        console.log(`    版本: ${model.version || 'N/A'}`);
        console.log(`    描述: ${model.description || 'N/A'}`);
        console.log(`    支持的方法: ${(model.supportedGenerationMethods || []).join(', ')}`);
        console.log('');
      });

      console.log('📊 嵌入模型:');
      embedModels.forEach(model => {
        console.log(`  - ${model.name.replace('models/', '')}`);
        console.log(`    版本: ${model.version || 'N/A'}`);
        console.log(`    描述: ${model.description || 'N/A'}`);
        console.log('');
      });

      // 寻找可以生成图像的模型
      console.log('🎨 图像生成能力检查:');
      const imageGenModels = data.models.filter((model: any) => {
        const name = model.name.toLowerCase();
        const desc = (model.description || '').toLowerCase();
        const methods = model.supportedGenerationMethods || [];

        return name.includes('image') ||
               name.includes('imagen') ||
               desc.includes('generate image') ||
               desc.includes('image generation') ||
               methods.includes('generateImage');
      });

      if (imageGenModels.length > 0) {
        console.log('✅ 找到支持图像生成的模型:');
        imageGenModels.forEach((model: any) => {
          console.log(`  - ${model.name.replace('models/', '')}`);
        });
      } else {
        console.log('❌ 未找到支持图像生成的Gemini模型');
        console.log('💡 Gemini API 主要用于文本生成和图像理解，不支持图像生成');
      }

    } else {
      console.error('❌ 获取模型列表失败:');
      console.error(JSON.stringify(data, null, 2));
    }

  } catch (error: any) {
    console.error('❌ 请求失败:', error.message);
  }
}

listModels().catch(console.error);