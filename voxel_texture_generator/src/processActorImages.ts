#!/usr/bin/env node

/**
 * Actor图片处理脚本
 * 将所有actor图片处理为256x256尺寸，保持长宽比
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs-extra';

interface Arguments {
  input?: string;
  output?: string;
  backup?: boolean;
  size?: number;
  overwrite?: boolean;
}

async function processImage(
  inputPath: string,
  outputPath: string,
  size: number = 256
): Promise<boolean> {
  try {
    const fileName = path.basename(inputPath);
    console.log(`📸 处理图片: ${fileName}`);

    // 读取原始图片元数据
    const metadata = await sharp(inputPath).metadata();
    console.log(`  原始尺寸: ${metadata.width}x${metadata.height}`);

    // 处理图片：先trim删除透明边缘，再resize到指定尺寸
    await sharp(inputPath)
      .trim({
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        threshold: 0
      })
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        position: 'center'
      })
      .toFile(outputPath);

    // 检查输出图片
    const outputMetadata = await sharp(outputPath).metadata();
    console.log(`  ✅ 新尺寸: ${outputMetadata.width}x${outputMetadata.height}`);

    return true;
  } catch (error: any) {
    console.error(`  ❌ 处理失败: ${error.message}`);
    return false;
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('input', {
      alias: 'i',
      type: 'string',
      description: 'Input directory path',
      default: './input_data/actors'
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output directory path',
      default: './input_data/actors_processed'
    })
    .option('backup', {
      alias: 'b',
      type: 'boolean',
      description: 'Backup original images before processing',
      default: true
    })
    .option('size', {
      alias: 's',
      type: 'number',
      description: 'Target size for square images',
      default: 256
    })
    .option('overwrite', {
      alias: 'w',
      type: 'boolean',
      description: 'Overwrite original images (requires backup)',
      default: false
    })
    .help()
    .parseSync() as Arguments;

  console.log('🎨 Actor图片处理器');
  console.log('==================\n');

  const inputDir = path.resolve(argv.input!);
  const outputDir = argv.overwrite ? inputDir : path.resolve(argv.output!);
  const backupDir = path.join(path.dirname(inputDir), 'actors_backup');
  const targetSize = argv.size!;

  console.log(`📁 输入目录: ${inputDir}`);
  console.log(`📁 输出目录: ${outputDir}`);
  console.log(`📐 目标尺寸: ${targetSize}x${targetSize}`);
  console.log(`💾 备份: ${argv.backup ? '是' : '否'}`);
  console.log(`🔄 覆盖原图: ${argv.overwrite ? '是' : '否'}\n`);

  // 检查输入目录
  if (!await fs.pathExists(inputDir)) {
    console.error(`❌ 输入目录不存在: ${inputDir}`);
    process.exit(1);
  }

  // 读取所有PNG文件
  const files = (await fs.readdir(inputDir))
    .filter(f => f.toLowerCase().endsWith('.png'));

  if (files.length === 0) {
    console.error('❌ 未找到PNG文件');
    process.exit(1);
  }

  console.log(`📋 找到 ${files.length} 个PNG文件\n`);

  // 备份原始文件
  if (argv.backup) {
    console.log('💾 备份原始图片...');
    await fs.ensureDir(backupDir);

    for (const file of files) {
      const srcPath = path.join(inputDir, file);
      const destPath = path.join(backupDir, file);
      await fs.copy(srcPath, destPath, { overwrite: true });
    }

    console.log(`✅ 已备份到: ${backupDir}\n`);
  } else if (argv.overwrite) {
    console.error('❌ 覆盖原图必须启用备份功能');
    process.exit(1);
  }

  // 确保输出目录存在
  if (!argv.overwrite) {
    await fs.ensureDir(outputDir);
  }

  // 处理所有图片
  console.log('🔄 开始处理图片...\n');

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, file);

    const success = await processImage(inputPath, outputPath, targetSize);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  // 生成处理报告
  const reportPath = path.join(outputDir, 'process_report.json');
  const report = {
    timestamp: new Date().toISOString(),
    settings: {
      targetSize: targetSize,
      inputDir: inputDir,
      outputDir: outputDir,
      backupDir: argv.backup ? backupDir : null,
      overwrite: argv.overwrite
    },
    summary: {
      total: files.length,
      success: successCount,
      failed: failCount
    },
    files: files.map(f => ({
      name: f,
      path: path.join(outputDir, f)
    }))
  };

  await fs.writeJSON(reportPath, report, { spaces: 2 });

  console.log('\n✨ 处理完成！');
  console.log(`✅ 成功: ${successCount}`);
  console.log(`❌ 失败: ${failCount}`);
  console.log(`📊 报告: ${reportPath}`);

  if (argv.backup) {
    console.log(`💾 备份位置: ${backupDir}`);
  }
}

// 运行主程序
main().catch(error => {
  console.error('❌ 未预期的错误:', error);
  process.exit(1);
});