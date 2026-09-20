#!/bin/bash
set -e

echo " Installing npm dependencies..."
npm install

echo "🏗️  Building task app with pre-rendering..."
npm run build:task

echo "📋 Copying SEO files (robots.txt, sitemap.xml)..."
cp apps/task/public/robots.txt dist/apps/task/robots.txt
cp apps/task/public/sitemap.xml dist/apps/task/sitemap.xml

echo "✅ Build complete!"
echo "📁 Dist folder contents:"
ls -la dist/apps/task/ | head -15