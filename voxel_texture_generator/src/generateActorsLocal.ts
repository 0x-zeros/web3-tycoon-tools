#!/usr/bin/env node

/**
 * 本地文字纹理生成脚本
 * 生成透明背景的中文文字纹理
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import fs from 'fs-extra';
import { LocalTextGenerator } from './generators/localTextGenerator';
import {
  ALL_ACTOR_TEXTURES,
  NPC_TEXTURES,
  BUILDING_TEXTURES,
  OBJECT_TEXTURES,
  getTexturesByCategory,
  ActorTextureConfig
} from './config/actors';

interface Arguments {
  category?: string;
  actors?: string;
  size?: number;
  fontSize?: number;
  output?: string;
  list?: boolean;
  simple?: boolean;
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('category', {
      alias: 'c',
      type: 'string',
      description: 'Category to generate: all, npc, building, object',
      default: 'all'
    })
    .option('actors', {
      alias: 'a',
      type: 'string',
      description: 'Specific actors to generate (comma-separated)',
    })
    .option('size', {
      alias: 's',
      type: 'number',
      description: 'Output texture size',
      default: 256
    })
    .option('fontSize', {
      alias: 'f',
      type: 'number',
      description: 'Font size for text',
      default: 32
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output directory',
      default: './generated_local_textures'
    })
    .option('list', {
      alias: 'l',
      type: 'boolean',
      description: 'List all available actors with their display text',
      default: false
    })
    .option('simple', {
      type: 'boolean',
      description: 'Use simple style without decorations',
      default: false
    })
    .help()
    .parseSync() as Arguments;

  const generator = new LocalTextGenerator();

  // 列出所有Actor及其显示文字
  if (argv.list) {
    listActorsWithText();
    return;
  }

  console.log('📝 本地文字纹理生成器');
  console.log('=====================\n');

  const outputDir = path.resolve(argv.output!);
  console.log(`📁 输出目录: ${outputDir}`);
  console.log(`📐 纹理尺寸: ${argv.size}x${argv.size}`);
  console.log(`🔤 字体大小: ${argv.fontSize}px`);
  console.log(`🎨 样式: ${argv.simple ? '简单' : '装饰'}\n`);

  // 确保输出目录存在
  await fs.ensureDir(outputDir);

  try {
    let configs: ActorTextureConfig[] = [];

    // 获取要生成的配置
    if (argv.actors) {
      // 生成特定的Actor
      const actorNames = argv.actors.split(',').map(a => a.trim());
      configs = ALL_ACTOR_TEXTURES.filter(c => actorNames.includes(c.name));

      if (configs.length === 0) {
        console.error(`❌ 未找到指定的Actor: ${actorNames.join(', ')}`);
        console.log(`💡 使用 --list 查看所有可用的Actor`);
        process.exit(1);
      }
    } else {
      // 按类别生成
      const category = argv.category?.toLowerCase() || 'all';

      switch (category) {
        case 'npc':
          configs = NPC_TEXTURES;
          break;
        case 'building':
          configs = BUILDING_TEXTURES;
          break;
        case 'object':
          configs = OBJECT_TEXTURES;
          break;
        case 'all':
        default:
          configs = ALL_ACTOR_TEXTURES;
          break;
      }
    }

    console.log(`🎯 准备生成 ${configs.length} 个文字纹理...\n`);

    // 创建分类目录
    const categories = Array.from(new Set(configs.map(c => c.category)));
    for (const category of categories) {
      await fs.ensureDir(path.join(outputDir, category));
    }

    // 批量生成
    const result = await generator.generateBatch(configs, outputDir, {
      width: argv.size,
      height: argv.size,
      fontSize: argv.fontSize
    });

    // 生成报告
    await generateReport(configs, outputDir, result);

    console.log('\n✨ 生成完成！');
    console.log(`📂 查看输出: ${outputDir}`);

  } catch (error: any) {
    console.error('❌ 生成失败:', error.message);
    process.exit(1);
  }
}

/**
 * 列出所有Actor及其显示文字
 */
function listActorsWithText() {
  console.log('📋 所有Actor及其显示文字\n');

  const generator = new LocalTextGenerator();

  console.log('🤖 NPC角色:');
  NPC_TEXTURES.forEach(npc => {
    const displayText = extractDisplayTextForListing(npc);
    const color = getColorForListing(npc);
    console.log(`  ${npc.name}: "${displayText}" (${color})`);
  });

  console.log('\n🏢 建筑:');
  BUILDING_TEXTURES.forEach(building => {
    const displayText = extractDisplayTextForListing(building);
    const color = getColorForListing(building);
    console.log(`  ${building.name}: "${displayText}" (${color})`);
  });

  console.log('\n📦 物体:');
  OBJECT_TEXTURES.forEach(obj => {
    const displayText = extractDisplayTextForListing(obj);
    const color = getColorForListing(obj);
    console.log(`  ${obj.name}: "${displayText}" (${color})`);
  });

  console.log('\n🎨 颜色说明:');
  console.log('  灰色 - 0级/空地');
  console.log('  绿色 - 1级');
  console.log('  蓝色 - 2级');
  console.log('  紫色 - 3级');
  console.log('  橙色 - 4级');
  console.log('  金色 - 5级');
  console.log('  红色 - NPC');
  console.log('  青色 - 物体');
}

/**
 * 提取显示文字（用于列表）
 */
function extractDisplayTextForListing(config: ActorTextureConfig): string {
  const description = config.description;

  if (config.category === 'npc') {
    const match = description.match(/^([^-]+)/);
    return match ? match[1].trim() : config.name;
  } else if (config.category === 'building') {
    const match = description.match(/^([^-]+)/);
    if (match) {
      const text = match[1].trim();
      if (text === '空地') {
        return '空地';
      }
      return text;
    }
    return config.name;
  } else if (config.category === 'object') {
    const match = description.match(/^([^-]+)/);
    return match ? match[1].trim() : config.name;
  }

  return config.name;
}

/**
 * 获取颜色说明（用于列表）
 */
function getColorForListing(config: ActorTextureConfig): string {
  const levelMatch = config.name.match(/lv(\d+)/);
  if (levelMatch) {
    const level = parseInt(levelMatch[1]);
    const colors = ['灰色', '绿色', '蓝色', '紫色', '橙色', '金色'];
    return colors[level] || '默认色';
  }

  if (config.name === 'lv0') {
    return '灰色';
  }

  if (config.category === 'npc') {
    return '红色';
  } else if (config.category === 'object') {
    return '青色';
  }

  return '默认色';
}

/**
 * 生成报告
 */
async function generateReport(
  configs: ActorTextureConfig[],
  outputDir: string,
  result: { success: number; failed: number }
): Promise<void> {
  const reportPath = path.join(outputDir, 'local_generation_report.json');

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: configs.length,
      successful: result.success,
      failed: result.failed
    },
    textures: configs.map(config => ({
      name: config.name,
      category: config.category,
      displayText: extractDisplayTextForListing(config),
      color: getColorForListing(config),
      path: `${config.category}/${config.name}.png`
    }))
  };

  await fs.writeJSON(reportPath, report, { spaces: 2 });
  console.log(`\n📊 生成报告已保存: ${reportPath}`);
}

// 运行主程序
main().catch(error => {
  console.error('❌ 未预期的错误:', error);
  process.exit(1);
});