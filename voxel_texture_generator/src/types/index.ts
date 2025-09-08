export interface BlockConfig {
  name: string;
  category: 'basic' | 'special' | 'building' | 'npc' | 'obstacle' | 'web3' | 'background';
  description: string;
  keyword: string; // 嵌入文字的关键词
  basePrompt: string;
  textPrompt: string;
  colors: string[];
  size: number; // 生成尺寸 32/64/128
}

export interface GenerationOptions {
  style: 'basic' | 'text';
  outputSize: 32 | 64 | 128;
  outputPath: string;
  replaceOriginal: boolean;
}

export interface NanoBananaResponse {
  success: boolean;
  imageUrl?: string;
  base64Data?: string;
  error?: string;
}

export interface TextureGenerationResult {
  blockName: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}
