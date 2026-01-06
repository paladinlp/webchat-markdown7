#!/bin/bash
# md-cli 启动脚本
# 自动加载 .env.local 环境变量

cd "$(dirname "$0")"

# 加载 .env.local 文件
if [ -f .env.local ]; then
  echo "Loading .env.local..."
  set -a
  source .env.local
  set +a
fi

# 检查关键配置
if [ -z "$GEMINI_API_KEY" ]; then
  echo ""
  echo "警告: GEMINI_API_KEY 未设置"
  echo "请编辑 .env.local 文件，填入你的 Gemini API Key"
  echo ""
fi

# 启动服务
echo "启动 md-cli 服务..."
node index.js
