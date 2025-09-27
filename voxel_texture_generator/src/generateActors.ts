#!/usr/bin/env node

/**
 * Actor纹理生成主程序
 * 用于生成Web3大富翁游戏中定义的所有Actor纹理
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { config } from 'dotenv';
import { ActorTextureGenerator } from './generators/actorTextureGenerator';

config();

interface Arguments {
  category?: string;
  actors?: string;
  size?: number;
  output?: string;
  animations?: boolean;
  list?: boolean;
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
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output directory',
      default: './generated_actor_textures'
    })
    .option('animations', {
      type: 'boolean',
      description: 'Include animation frames for NPCs',
      default: false
    })
    .option('list', {
      alias: 'l',
      type: 'boolean',
      description: 'List all available actors',
      default: false
    })
    .help()
    .parseSync() as Arguments;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !argv.list) {
    console.error('❌ Error: GEMINI_API_KEY environment variable not set');
    console.error('Please add your API key to .env file:');
    console.error('GEMINI_API_KEY=your_api_key_here');
    process.exit(1);
  }

  const generator = new ActorTextureGenerator(apiKey, argv.output);

  // 列出所有可用的Actor
  if (argv.list) {
    generator.listAvailableActors();
    return;
  }

  console.log('🎮 Web3 Tycoon Actor Texture Generator');
  console.log('======================================\n');

  try {
    let results;

    // 生成特定的Actor
    if (argv.actors) {
      const actorNames = argv.actors.split(',').map(a => a.trim());
      results = await generator.generateSpecific(actorNames, {
        outputSize: argv.size,
        includeAnimations: argv.animations
      });
    }
    // 按类别生成
    else {
      const category = argv.category || 'all';
      switch (category.toLowerCase()) {
        case 'npc':
          results = await generator.generateNPCs(argv.animations);
          break;

        case 'building':
          results = await generator.generateBuildings();
          break;

        case 'object':
          results = await generator.generateObjects();
          break;

        case 'all':
        default:
          results = await generator.generateAll({
            outputSize: argv.size,
            includeAnimations: argv.animations,
            categories: ['npc', 'building', 'object']
          });
          break;
      }
    }

    // 显示结果摘要
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('\n🎉 Generation Complete!');
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed textures:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }

  } catch (error: any) {
    console.error('❌ Generation failed:', error.message);
    process.exit(1);
  }
}

// 运行主程序
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});