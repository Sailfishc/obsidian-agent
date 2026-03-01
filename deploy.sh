#!/bin/bash
set -e

PLUGIN_ID="obsidian-agent"
VAULT_PATH="/Users/zhangcheng/ObsidianVaults/sailfish-notes"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"

echo "Building..."
pnpm run build

mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json styles.css "$PLUGIN_DIR/"

echo "Deployed to $PLUGIN_DIR"
echo "Reload Obsidian (Cmd+R) to apply changes."
