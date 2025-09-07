#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import { TextureGenerator } from './generators/textureGenerator';
import { GenerationOptions } from './types';
import { BLOCKS } from './config/blocks';

// 配置命令行参数
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .option('style', {
    alias: 's',
    type: 'string',
    choices: ['basic', 'text'],
    default: 'basic',
    description: 'Generation style: basic (pure style) or text (with embedded keywords)'
  })
  .option('size', {
    type: 'number',
    choices: [32, 64, 128],
    default: 64,
    description: 'Output texture size in pixels'
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    default: './generated_textures',
    description: 'Output directory for generated textures'
  })
  .option('replace', {
    alias: 'r',
    type: 'boolean',
    default: false,
    description: 'Replace original textures in web3_nanobanana_v1 folder'
  })
  .option('blocks', {
    alias: 'b',
    type: 'string',
    description: 'Comma-separated list of specific blocks to generate (optional)'
  })
  .option('test', {
    alias: 't',
    type: 'string',
    description: 'Generate a test texture for the specified block'
  })
  .option('list', {
    alias: 'l',
    type: 'boolean',
    default: false,
    description: 'List all available blocks and exit'
  })
  .option('prompt-only', {
    alias: 'p',
    type: 'boolean',
    default: false,
    description: 'Only generate and display prompts without calling API'
  })
  .option('api-key', {
    type: 'string',
    description: 'NanoBanana API key (can also be set via NANOBANA_API_KEY env var)'
  })
  .help('h')
  .alias('h', 'help')
  .example('$0 --style=basic', 'Generate all textures in basic style')
  .example('$0 --style=text --size=128', 'Generate all textures with text in 128x128 size')
  .example('$0 --blocks=empty_tile,chance --replace', 'Generate specific blocks and replace originals')
  .example('$0 --test=empty_tile', 'Generate a test texture for empty_tile block')
  .example('$0 --prompt-only --style=text', 'Only show prompts for all blocks (no API call)')
  .example('$0 --list', 'List all available blocks')
  .parseSync();

async function main() {
  try {
    console.log('🎨 Web3 Tycoon Texture Generator');
    console.log('================================\n');

    // 检查环境变量或命令行API key
    const apiKey = argv['api-key'] || process.env.NANOBANA_API_KEY;
    if (!apiKey && !argv.list && !argv['prompt-only']) {
      console.error('❌ Error: NanoBanana API key is required!');
      console.error('Set NANOBANA_API_KEY environment variable or use --api-key option');
      process.exit(1);
    }

    // 创建生成器实例
    const generator = new TextureGenerator(
      apiKey,
      path.resolve(argv.output),
      path.resolve('../voxel_ai_out/assets/web3_nanobanana_v1/textures/block')
    );

    // 如果只是列出可用块
    if (argv.list) {
      generator.listAvailableBlocks();
      return;
    }

    // 如果只是生成prompts
    if (argv['prompt-only']) {
      console.log(`📝 Prompt Generator Mode`);
      console.log(`Style: ${argv.style}`);
      console.log(`Size: ${argv.size}x${argv.size}\n`);
      
      generatePrompts(argv);
      return;
    }

    // 如果是测试模式
    if (argv.test) {
      console.log(`🧪 Test mode: generating texture for ${argv.test}`);
      const result = await generator.generateTest(argv.test);
      
      if (result.success) {
        console.log(`✅ Test texture generated successfully: ${result.outputPath}`);
      } else {
        console.error(`❌ Test generation failed: ${result.error}`);
        process.exit(1);
      }
      return;
    }

    // 构建生成选项
    const options: GenerationOptions = {
      style: argv.style as 'basic' | 'text',
      outputSize: argv.size as 32 | 64 | 128,
      outputPath: path.resolve(argv.output),
      replaceOriginal: argv.replace
    };

    console.log('⚙️  Generation Options:');
    console.log(`   Style: ${options.style}`);
    console.log(`   Size: ${options.outputSize}x${options.outputSize}`);
    console.log(`   Output: ${options.outputPath}`);
    console.log(`   Replace Original: ${options.replaceOriginal}`);

    // 如果指定了特定块
    if (argv.blocks) {
      const blockNames = argv.blocks.split(',').map(name => name.trim());
      console.log(`   Specific Blocks: ${blockNames.join(', ')}`);
      
      const results = await generator.generateSpecific(blockNames, options);
      printResults(results);
    } else {
      // 生成所有纹理
      console.log(`   Mode: Generate All Blocks\n`);
      
      const results = await generator.generateAll(options);
      printResults(results);
    }

  } catch (error: any) {
    console.error(`\n❌ Fatal Error: ${error.message}`);
    process.exit(1);
  }
}

function printResults(results: Array<{blockName: string, success: boolean, outputPath?: string, error?: string}>) {
  console.log('\n📊 Generation Results:');
  console.log('=====================\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}/${results.length}`);
  if (successful.length > 0) {
    successful.forEach(r => {
      console.log(`   ✓ ${r.blockName}: ${path.basename(r.outputPath || '')}`);
    });
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}/${results.length}`);
    failed.forEach(r => {
      console.log(`   ✗ ${r.blockName}: ${r.error}`);
    });
  }

  console.log('\n🎉 Generation completed!');
  
  if (results.some(r => r.success)) {
    console.log('\n💡 Next steps:');
    console.log('   1. Review generated textures in the output directory');
    console.log('   2. Use --replace flag to update the web3_nanobanana_v1 textures');
    console.log('   3. Test the textures in your voxel game');
  }
}

function generatePrompts(argv: any) {
  const style = argv.style as 'basic' | 'text';
  let blocksToShow = BLOCKS;
  
  // 如果指定了特定blocks
  if (argv.blocks) {
    const blockNames = argv.blocks.split(',').map((name: string) => name.trim());
    blocksToShow = BLOCKS.filter(block => blockNames.includes(block.name));
    
    if (blocksToShow.length === 0) {
      console.error(`❌ No valid blocks found. Available blocks: ${BLOCKS.map(b => b.name).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`📋 Generated Prompts (${style} style, ${blocksToShow.length} blocks):`);
  console.log('='.repeat(80));

  blocksToShow.forEach((block, index) => {
    const prompt = style === 'basic' ? block.basePrompt : block.textPrompt;
    const category = block.category.toUpperCase();
    const keyword = style === 'text' ? block.keyword : 'N/A';
    
    console.log(`\n${index + 1}. 🎯 ${block.name.toUpperCase()} [${category}]`);
    console.log(`   📝 Description: ${block.description}`);
    if (style === 'text') {
      console.log(`   🔤 Keyword: "${keyword}"`);
    }
    console.log(`   🎨 Colors: ${block.colors.join(', ')}`);
    console.log(`   📐 Recommended Size: ${block.size}x${block.size}`);
    console.log(`   🚀 Prompt:`);
    console.log(`   "${prompt}"`);
    console.log('-'.repeat(80));
  });

  console.log(`\n✨ Total prompts generated: ${blocksToShow.length}`);
  console.log(`\n💡 Copy any prompt above and paste it into your preferred AI image generator!`);
  console.log(`🎯 Recommended settings: ${argv.size}x${argv.size}, pixel art style, high quality`);
  
  // 生成markdown格式的prompts（可选）
  if (blocksToShow.length <= 10) {
    console.log(`\n📄 Markdown format for easy copying:`);
    console.log('```markdown');
    blocksToShow.forEach((block, index) => {
      const prompt = style === 'basic' ? block.basePrompt : block.textPrompt;
      console.log(`## ${index + 1}. ${block.name} (${block.description})`);
      console.log(`**Keyword:** ${style === 'text' ? block.keyword : 'N/A'}`);
      console.log(`**Prompt:** ${prompt}`);
      console.log('');
    });
    console.log('```');
  }
}

// 运行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
