#!/usr/bin/env node

/**
 * 测试Nano Banana (Gemini 2.5 Flash Image Preview) API
 */

import { config } from 'dotenv';
import { GoogleGenAI } from '@google/genai';

config();

async function testNanoBanana() {
  console.log('🎨 Testing Nano Banana Image Generation\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in environment');
    process.exit(1);
  }

  console.log('🔑 API Key loaded:', apiKey.substring(0, 10) + '...');

  try {
    // 初始化客户端
    const ai = new GoogleGenAI({});
    console.log('✅ GoogleGenAI client initialized');

    // 测试简单的图像生成
    const prompt = 'Create a 256x256 pixel art texture: A cute cartoon bomb, pixel art style, black spherical bomb with lit fuse, sparks, classic round bomb design, isometric view, clean background, Minecraft-style voxel object.';

    console.log('\n📝 Test Prompt:', prompt.substring(0, 100) + '...');
    console.log('\n🚀 Calling Nano Banana API...');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image-preview',
      contents: prompt
    });

    console.log('📦 Response received');

    // 检查响应结构
    if (response && response.candidates && response.candidates[0]) {
      console.log('✅ Response has candidates');

      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        console.log(`📄 Found ${candidate.content.parts.length} parts in response`);

        for (let i = 0; i < candidate.content.parts.length; i++) {
          const part = candidate.content.parts[i];

          if (part.text) {
            console.log(`  Part ${i + 1}: Text content`);
            console.log(`    Content: ${part.text.substring(0, 100)}...`);
          }

          if (part.inlineData) {
            console.log(`  Part ${i + 1}: Image data`);
            console.log(`    MIME Type: ${part.inlineData.mimeType}`);
            console.log(`    Data length: ${part.inlineData.data?.length || 0} bytes`);

            // 保存图像
            if (part.inlineData.mimeType && part.inlineData.mimeType.startsWith('image/') && part.inlineData.data) {
              const fs = require('fs-extra');
              const path = require('path');

              const outputPath = path.join(__dirname, '..', 'test_nano_banana.png');
              const buffer = Buffer.from(part.inlineData.data, 'base64');

              await fs.writeFile(outputPath, buffer);
              console.log(`\n✅ Image saved to: ${outputPath}`);
            }
          }
        }
      } else {
        console.log('❌ No content parts in candidate');
      }
    } else {
      console.log('❌ Invalid response structure');
      console.log('Response:', JSON.stringify(response, null, 2).substring(0, 500));
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);

    if (error.message.includes('429') || error.message.includes('quota')) {
      console.log('\n💡 This is a quota error. Solutions:');
      console.log('  1. Wait for quota reset');
      console.log('  2. Use a different API key');
      console.log('  3. Upgrade to paid tier');
    } else if (error.message.includes('404')) {
      console.log('\n💡 Model not found. Check if gemini-2.5-flash-image-preview is available');
    } else if (error.message.includes('location')) {
      console.log('\n💡 Location not supported. You may need to use a VPN or different region');
    }

    // 打印完整错误以便调试
    console.log('\nFull error:', error);
  }
}

testNanoBanana().catch(console.error);