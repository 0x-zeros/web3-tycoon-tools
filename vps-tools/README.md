# vps-tools

个人 VPS 工具集合。每个工具自成一体（独立目录、独立依赖、独立 README），按需逐个加入。

## 当前可用工具

| 路径 | 用途 | 平台 |
| --- | --- | --- |
| [`snell-stls/`](./snell-stls/README.md) | Snell v5 + ShadowTLS v3 一键部署/卸载 | Ubuntu 24.04 VPS |
| [`anytls/`](./anytls/README.md) | AnyTLS（sing-box）一键部署/卸载 | Ubuntu 24.04 VPS |

## 目录组织

```
vps-tools/
├── README.md       ← 本文件，工具索引
├── CLAUDE.md       ← 项目级 AI 协作指导
└── <工具>/         ← 每个工具一个目录，自带 README
```

## 通用约定

- 文档、注释、commit 一律中文
- 部署/卸载类脚本必须有：root 守卫、平台守卫、参数注释、卸载脚本
- 部署脚本默认绝不在本地执行，只在目标环境验证
