#!/usr/bin/env node

/**
 * Gemini API 连接测试脚本
 * 用于诊断API调用问题
 */

import { config } from 'dotenv';
import fetch from 'node-fetch';

config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ 错误: 未找到 GEMINI_API_KEY 环境变量');
  process.exit(1);
}

console.log('🔍 Gemini API 连接测试');
console.log('========================\n');

// 测试1: 使用原生fetch测试最小请求
async function testMinimalRequest() {
  console.log('📝 测试1: 最小请求测试 (gemini-1.5-flash)');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    console.log('🌐 URL:', url.replace(GEMINI_API_KEY!, 'YOUR_KEY'));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: 'hello'
          }]
        }]
      })
    });

    console.log('📊 状态码:', response.status);

    const data = await response.json() as any;

    if (response.ok) {
      console.log('✅ 成功！响应内容:');
      console.log(JSON.stringify(data, null, 2).substring(0, 500) + '...');
      return true;
    } else {
      console.error('❌ 失败！错误详情:');
      console.error(JSON.stringify(data, null, 2));

      // 分析错误类型
      if (data?.error?.status === 'RESOURCE_EXHAUSTED' || response.status === 429) {
        console.log('\n💡 诊断: 配额限制问题');
        console.log('   - 免费层配额可能已用尽');
        console.log('   - 建议: 等待配额重置或升级到付费层');

        const retryInfo = data.error?.details?.find((d: any) =>
          d['@type']?.includes('RetryInfo')
        );
        if (retryInfo?.retryDelay) {
          console.log(`   - API建议等待: ${retryInfo.retryDelay}`);
        }
      } else if (response.status === 401 || response.status === 403) {
        console.log('\n💡 诊断: 认证问题');
        console.log('   - API Key 可能无效或未激活');
        console.log('   - 请访问 https://aistudio.google.com/app/apikey 验证');
      } else if (response.status === 400) {
        console.log('\n💡 诊断: 请求格式问题');
        console.log('   - 请求体结构可能有误');
      }
      return false;
    }
  } catch (error: any) {
    console.error('❌ 网络错误:', error.message);
    return false;
  }
}

// 测试2: 使用Google SDK
async function testGoogleSDK() {
  console.log('\n📝 测试2: Google SDK测试');

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    console.log('📦 SDK版本: @google/generative-ai');

    // 正确的调用方式
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent('hello');
    const response = await result.response;
    const text = response.text();

    console.log('✅ SDK调用成功！');
    console.log('📄 响应文本:', text.substring(0, 100) + '...');
    return true;

  } catch (error: any) {
    console.error('❌ SDK调用失败:', error.message);

    if (error.message.includes('404')) {
      console.log('\n💡 诊断: 模型不存在');
      console.log('   - 确认模型名称是否正确');
      console.log('   - 可用模型: gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash-exp');
    }
    return false;
  }
}

// 测试3: 测试不同的模型
async function testDifferentModels() {
  console.log('\n📝 测试3: 测试不同模型');

  const models = [
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-2.0-flash-exp',
    'gemini-2.5-flash-preview-image' // 这个可能不存在
  ];

  for (const modelName of models) {
    console.log(`\n🔹 测试模型: ${modelName}`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: 'hello'
            }]
          }]
        })
      });

      if (response.ok) {
        console.log(`   ✅ ${modelName}: 可用`);
      } else {
        const data = await response.json() as any;
        if (response.status === 404) {
          console.log(`   ❌ ${modelName}: 模型不存在`);
        } else if (response.status === 429) {
          console.log(`   ⚠️ ${modelName}: 配额限制`);
        } else {
          console.log(`   ❌ ${modelName}: 错误 ${response.status}`);
        }
      }
    } catch (error: any) {
      console.log(`   ❌ ${modelName}: 网络错误`);
    }
  }
}

// 测试4: 带重试的请求
async function testWithRetry() {
  console.log('\n📝 测试4: 带重试机制的请求');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  let delayMs = 30000;

  for (let i = 0; i < 3; i++) {
    console.log(`\n🔄 尝试 ${i + 1}/3`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Test request ${i + 1}`
            }]
          }]
        })
      });

      if (response.ok) {
        console.log('✅ 请求成功！');
        return true;
      }

      const data = await response.json() as any;

      if (response.status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED') {
        const retryInfo = data.error?.details?.find((d: any) =>
          d['@type']?.includes('RetryInfo')
        );

        if (retryInfo?.retryDelay) {
          const seconds = parseInt(retryInfo.retryDelay.replace('s', ''));
          console.log(`⏳ API建议等待 ${seconds} 秒`);

          if (i < 2) {
            console.log(`⏳ 等待 ${seconds} 秒后重试...`);
            await new Promise(r => setTimeout(r, seconds * 1000));
            continue;
          }
        } else {
          if (i < 2) {
            const waitTime = delayMs / 1000;
            console.log(`⏳ 等待 ${waitTime} 秒后重试...`);
            await new Promise(r => setTimeout(r, delayMs));
            delayMs *= 2;
            continue;
          }
        }
      }

      console.error('❌ 请求失败:', data.error?.message || response.status);
      return false;

    } catch (error: any) {
      console.error('❌ 网络错误:', error.message);
      return false;
    }
  }

  console.log('❌ 所有重试都失败了');
  return false;
}

// 主函数
async function main() {
  console.log('🔑 API Key 前缀:', GEMINI_API_KEY!.substring(0, 10) + '...');
  console.log('📍 API 端点: https://generativelanguage.googleapis.com/v1beta');
  console.log('\n开始测试...\n');

  // 运行所有测试
  await testMinimalRequest();
  await testGoogleSDK();
  await testDifferentModels();
  await testWithRetry();

  console.log('\n✨ 测试完成！\n');

  console.log('📋 总结与建议:');
  console.log('================');
  console.log('1. 如果所有请求都返回429，说明是配额问题');
  console.log('2. 如果返回401/403，需要检查API Key');
  console.log('3. 如果返回404，说明模型名称错误');
  console.log('4. gemini-2.5-flash-preview-image 模型可能不存在');
  console.log('5. Gemini API 不支持直接生成图像，只能处理文本');
  console.log('\n💡 图像生成建议: 使用 Stability AI、DALL-E 或 Midjourney API');
}

main().catch(console.error);