const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'frontend', 'src');

function searchDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            searchDir(fullPath);
        } else if (fullPath.endsWith('.jsx') || fullPath.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('PREMIUM HEADER')) {
                console.log('Found in:', fullPath);
            }
        }
    }
}

searchDir(targetDir);
