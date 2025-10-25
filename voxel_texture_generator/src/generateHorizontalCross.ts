#!/usr/bin/env node

/**
 * 横十字贴图生成工具
 * 支持从6张图片生成横十字布局，或生成骰子贴图
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import fs from 'fs-extra';
import { DiceFaceGenerator } from './generators/diceFaceGenerator';
import { HorizontalCrossGenerator, CubeFaceTextures } from './generators/horizontalCrossGenerator';

interface Arguments {
  mode?: string;
  size?: number;
  output?: string;
  input?: string;
  dots?: boolean;
  gutter?: boolean;
  gutterSize?: number;
}

async function generateDice(args: Arguments) {
  const generator = new DiceFaceGenerator();
  const size = args.size || 128;
  const outputDir = args.output || './generated_dice';
  const useDots = args.dots !== false;  // 默认使用点

  console.log('🎲 生成骰子贴图');
  console.log('================\n');

  // 生成6个骰子面
  const facePaths = useDots
    ? await generator.generateAllFaces({ size, outputDir })
    : await generator.generateAllNumberFaces({ size, outputDir });

  // 生成横十字布局
  const crossGenerator = new HorizontalCrossGenerator();
  const atlasPath = path.join(outputDir, 'dice_horizontal_cross.png');

  await crossGenerator.generateDiceAtlas(facePaths, {
    cellSize: size,
    outputPath: atlasPath,
    addGutter: args.gutter || false,
    gutterSize: args.gutterSize || 2
  });

  console.log('\n✨ 骰子贴图生成完成！');
  console.log(`📂 输出目录: ${outputDir}`);
  console.log(`🎯 横十字贴图: ${atlasPath}`);
  console.log(`📐 总尺寸: ${size * 4}x${size * 3}`);

  // 验证生成的贴图
  await crossGenerator.validateAtlas(atlasPath);
}

async function generateFromFiles(args: Arguments) {
  const inputDir = args.input || './cube_faces';
  const outputPath = args.output || './horizontal_cross_atlas.png';
  const size = args.size || 256;

  console.log('📦 从文件生成横十字贴图');
  console.log('========================\n');

  // 查找输入文件
  const requiredFiles = [
    'positive_x.png', 'negative_x.png',
    'positive_y.png', 'negative_y.png',
    'positive_z.png', 'negative_z.png'
  ];

  const textures: CubeFaceTextures = {
    positiveX: '',
    negativeX: '',
    positiveY: '',
    negativeY: '',
    positiveZ: '',
    negativeZ: ''
  };

  // 检查文件是否存在
  console.log('📋 检查输入文件...');
  let allFilesExist = true;

  for (const file of requiredFiles) {
    const filePath = path.join(inputDir, file);
    if (await fs.pathExists(filePath)) {
      console.log(`  ✅ ${file}`);
      const key = file.replace('.png', '').replace('_', '') as keyof CubeFaceTextures;
      textures[key] = filePath;
    } else {
      console.log(`  ❌ ${file} - 文件不存在`);
      allFilesExist = false;
    }
  }

  if (!allFilesExist) {
    // 尝试查找编号文件 (1-6)
    console.log('\n📋 尝试查找编号文件 (1.png - 6.png)...');
    const numberedFiles: string[] = [];

    for (let i = 1; i <= 6; i++) {
      const filePath = path.join(inputDir, `${i}.png`);
      if (await fs.pathExists(filePath)) {
        console.log(`  ✅ ${i}.png`);
        numberedFiles.push(filePath);
      } else {
        console.log(`  ❌ ${i}.png - 文件不存在`);
      }
    }

    if (numberedFiles.length === 6) {
      // 使用编号文件（假设为骰子）
      const crossGenerator = new HorizontalCrossGenerator();
      await crossGenerator.generateDiceAtlas(numberedFiles, {
        cellSize: size,
        outputPath: outputPath,
        addGutter: args.gutter || false,
        gutterSize: args.gutterSize || 2
      });
    } else {
      console.error('\n❌ 缺少必要的输入文件');
      console.log('需要以下文件之一：');
      console.log('  1. positive_x.png, negative_x.png, positive_y.png, negative_y.png, positive_z.png, negative_z.png');
      console.log('  2. 1.png, 2.png, 3.png, 4.png, 5.png, 6.png');
      process.exit(1);
    }
  } else {
    // 使用命名文件
    const crossGenerator = new HorizontalCrossGenerator();
    await crossGenerator.generateFromTextures(textures, {
      cellSize: size,
      outputPath: outputPath,
      addGutter: args.gutter || false,
      gutterSize: args.gutterSize || 2
    });
  }

  console.log('\n✨ 横十字贴图生成完成！');
  console.log(`🎯 输出文件: ${outputPath}`);
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .command('dice', '生成骰子横十字贴图', {
      size: {
        alias: 's',
        type: 'number',
        description: '单个面的尺寸',
        default: 128
      },
      output: {
        alias: 'o',
        type: 'string',
        description: '输出目录',
        default: './generated_dice'
      },
      dots: {
        alias: 'd',
        type: 'boolean',
        description: '使用点（true）或数字（false）',
        default: true
      },
      gutter: {
        alias: 'g',
        type: 'boolean',
        description: '添加安全边距',
        default: false
      },
      gutterSize: {
        type: 'number',
        description: '安全边距大小（像素）',
        default: 2
      }
    })
    .command('from-files', '从6张图片生成横十字贴图', {
      input: {
        alias: 'i',
        type: 'string',
        description: '输入目录',
        default: './cube_faces'
      },
      output: {
        alias: 'o',
        type: 'string',
        description: '输出文件路径',
        default: './horizontal_cross_atlas.png'
      },
      size: {
        alias: 's',
        type: 'number',
        description: '单格尺寸',
        default: 256
      },
      gutter: {
        alias: 'g',
        type: 'boolean',
        description: '添加安全边距',
        default: false
      },
      gutterSize: {
        type: 'number',
        description: '安全边距大小（像素）',
        default: 2
      }
    })
    .demandCommand(1, '请指定命令: dice 或 from-files')
    .help()
    .parseSync() as Arguments & { _: string[] };

  try {
    const command = argv._[0];

    switch (command) {
      case 'dice':
        await generateDice(argv);
        break;
      case 'from-files':
        await generateFromFiles(argv);
        break;
      default:
        console.error(`未知命令: ${command}`);
        process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
}

// 运行主程序
main().catch(error => {
  console.error('❌ 未预期的错误:', error);
  process.exit(1);
});