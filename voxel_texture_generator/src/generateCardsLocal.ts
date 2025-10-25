#!/usr/bin/env node

/**
 * 本地卡牌纹理生成脚本
 * 生成透明背景的中文卡牌纹理
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import fs from 'fs-extra';
import { LocalTextGenerator } from './generators/localTextGenerator';
import {
  CARD_CONFIGS,
  CardTextureConfig,
  findCardConfig,
  getCardsByRarity,
  getCardDisplayText,
  getCardFileName,
  RARITY_NAMES
} from './config/cards';

interface Arguments {
  cards?: string;
  rarity?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  output?: string;
  list?: boolean;
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('cards', {
      alias: 'c',
      type: 'string',
      description: 'Specific cards to generate (comma-separated kind numbers)',
    })
    .option('rarity', {
      alias: 'r',
      type: 'number',
      description: 'Generate cards of specific rarity (0=普通, 1=稀有, 2=史诗)',
    })
    .option('width', {
      alias: 'w',
      type: 'number',
      description: 'Output texture width',
      default: 192
    })
    .option('height', {
      alias: 'h',
      type: 'number',
      description: 'Output texture height',
      default: 256
    })
    .option('fontSize', {
      alias: 'f',
      type: 'number',
      description: 'Font size for text',
      default: 36
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output directory',
      default: './generated_local_textures/cards'
    })
    .option('list', {
      alias: 'l',
      type: 'boolean',
      description: 'List all available cards',
      default: false
    })
    .help()
    .parseSync() as Arguments;

  const generator = new LocalTextGenerator();

  // 列出所有卡牌
  if (argv.list) {
    listCards();
    return;
  }

  console.log('🎴 本地卡牌纹理生成器');
  console.log('=====================\n');

  const outputDir = path.resolve(argv.output!);
  console.log(`📁 输出目录: ${outputDir}`);
  console.log(`📐 纹理尺寸: ${argv.width}x${argv.height}`);
  console.log(`🔤 字体大小: ${argv.fontSize}px\n`);

  // 确保输出目录存在
  await fs.ensureDir(outputDir);

  try {
    let configs: CardTextureConfig[] = [];

    // 获取要生成的配置
    if (argv.cards) {
      // 生成特定的卡牌
      const cardKinds = argv.cards.split(',').map(k => parseInt(k.trim()));
      configs = cardKinds
        .map(kind => findCardConfig(kind))
        .filter(c => c !== undefined) as CardTextureConfig[];

      if (configs.length === 0) {
        console.error(`❌ 未找到指定的卡牌: ${cardKinds.join(', ')}`);
        console.log(`💡 使用 --list 查看所有可用的卡牌`);
        process.exit(1);
      }
    } else if (argv.rarity !== undefined) {
      // 按稀有度生成
      configs = getCardsByRarity(argv.rarity);
      if (configs.length === 0) {
        console.error(`❌ 未找到稀有度为 ${argv.rarity} 的卡牌`);
        process.exit(1);
      }
    } else {
      // 生成所有卡牌
      configs = CARD_CONFIGS;
    }

    console.log(`🎯 准备生成 ${configs.length} 个卡牌纹理...\n`);

    // 批量生成
    const result = await generator.generateCardBatch(configs, outputDir, {
      width: argv.width,
      height: argv.height,
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
 * 列出所有卡牌
 */
function listCards() {
  console.log('🎴 所有可用卡牌\n');

  // 按稀有度分组
  for (let rarity = 0; rarity <= 2; rarity++) {
    const cards = getCardsByRarity(rarity);
    if (cards.length === 0) continue;

    console.log(`\n${getRarityEmoji(rarity)} ${RARITY_NAMES[rarity]}卡牌:`);
    cards.forEach(card => {
      const displayText = getCardDisplayText(card);
      const fileName = getCardFileName(card);
      console.log(`  [${card.kind}] ${card.name} - "${displayText}"`);
      console.log(`      文件名: ${fileName}.png`);
      console.log(`      描述: ${card.description}`);
    });
  }

  console.log('\n\n使用示例:');
  console.log('  生成所有卡牌: npm run generate-cards-local');
  console.log('  生成特定卡牌: npm run generate-cards-local -- --cards=0,1,2');
  console.log('  生成稀有卡牌: npm run generate-cards-local -- --rarity=1');
}

/**
 * 获取稀有度对应的emoji
 */
function getRarityEmoji(rarity: number): string {
  switch (rarity) {
    case 0: return '🟢'; // 普通
    case 1: return '🔵'; // 稀有
    case 2: return '🟣'; // 史诗
    default: return '⚪';
  }
}

/**
 * 生成报告
 */
async function generateReport(
  configs: CardTextureConfig[],
  outputDir: string,
  result: { success: number; failed: number }
): Promise<void> {
  const reportPath = path.join(outputDir, 'card_generation_report.json');

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: configs.length,
      successful: result.success,
      failed: result.failed
    },
    cards: configs.map(config => ({
      kind: config.kind,
      name: config.name,
      description: config.description,
      rarity: config.rarity,
      rarityName: RARITY_NAMES[config.rarity],
      displayText: getCardDisplayText(config),
      fileName: `${getCardFileName(config)}.png`,
      targetType: config.targetType,
      value: config.value
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
