const fs = require('fs');
const path = require('path');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  const regex = /(from|import)\s+['"](\.\.?\/[^'"]+)['"]/g;
  content = content.replace(regex, (match, p1, p2) => {
    if (p2.endsWith('.js') || p2.endsWith('.json') || p2.endsWith('.css') || p2.endsWith('.svg')) {
      return match;
    }
    changed = true;
    
    // Check if the path is a directory (assuming it's relative to filePath)
    const dirPath = path.dirname(filePath);
    const targetPath = path.resolve(dirPath, p2);
    let isDir = false;
    try {
      isDir = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    } catch (e) {}

    if (isDir) {
      return `${p1} '${p2}/index.js'`;
    } else {
      return `${p1} '${p2}.js'`;
    }
  });

  if (changed) {
    fs.writeFileSync(filePath, content);
  }
}

function processDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx'))) {
      processFile(fullPath);
    }
  }
}

// Process packages and apps and connectors
['packages', 'apps', 'connectors'].forEach(p => {
  processDirectory(path.join(__dirname, p));
});
