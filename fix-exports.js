const fs = require('fs');
const path = require('path');

function processPackage(pkgName) {
  const baseDir = path.join(__dirname, 'packages', pkgName, 'src');

  // Process root index.ts
  const rootIndex = path.join(baseDir, 'index.ts');
  if (fs.existsSync(rootIndex)) {
    let rootContent = fs.readFileSync(rootIndex, 'utf8');
    rootContent = rootContent.replace(/from '\.\/([^']+)'/g, (match, p1) => {
      if (p1.endsWith('.js') || p1.endsWith('.json')) return match;
      // If it's a directory in the root of types or shared, append /index.js, else .js
      // Let's check if the path is a directory
      const targetPath = path.join(baseDir, p1);
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        return `from './${p1}/index.js'`;
      } else {
        return `from './${p1}.js'`;
      }
    });
    fs.writeFileSync(rootIndex, rootContent);
  }

  // Process subdirectories
  if (!fs.existsSync(baseDir)) return;
  const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const dir of dirs) {
    const file = path.join(baseDir, dir, 'index.ts');
    if (fs.existsSync(file)) {
      let content = fs.readFileSync(file, 'utf8');
      content = content.replace(/from '\.\/([^']+)'/g, (match, p1) => {
        if (p1.endsWith('.js') || p1.endsWith('.json')) return match;
        return `from './${p1}.js'`;
      });
      fs.writeFileSync(file, content);
    }
  }
}

processPackage('types');
processPackage('shared');
