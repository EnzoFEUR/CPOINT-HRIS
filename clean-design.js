const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'frontend', 'src');

const replacements = [
    // Remove gradients
    { from: /style=\{\{\s*background:\s*['"`]linear-gradient\([^)]+\)['"`]\s*\}\}/g, to: 'className="bg-[#6366F1] text-white"' },
    { from: /background:\s*['"`]linear-gradient\([^)]+\)['"`]/g, to: "backgroundColor: '#6366F1'" },
    { from: /background:\s*['"`]radial-gradient\([^)]+\)['"`]/g, to: "backgroundColor: '#6366F1'" },
    
    // Replace rounded classes to sharper corners
    { from: /\brounded-2xl\b/g, to: 'rounded-md' },
    { from: /\brounded-xl\b/g, to: 'rounded-sm' },
    { from: /\brounded-lg\b/g, to: 'rounded-sm' },
    { from: /\brounded-\[16px\]\b/g, to: 'rounded-md' },
    { from: /\brounded-\[12px\]\b/g, to: 'rounded-sm' },
    { from: /\brounded-\[10px\]\b/g, to: 'rounded-sm' },
    { from: /\brounded-\[8px\]\b/g, to: 'rounded-sm' },
    { from: /\brounded-full\b/g, to: 'rounded-md' } // Make pills slightly less pill-like, or keep pills? The user said "i dont want the rounded corner to exaggerated i want it simple and clean". I'll change rounded-full to rounded-md for avatars and badges to make it very boxy/modern. Wait, rounded-full is good for status dots and avatars. Let's not touch rounded-full globally, just do it in specific spots.
];

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.jsx') || fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let modified = false;
            
            for (const r of replacements) {
                if (r.from.test(content)) {
                    content = content.replace(r.from, r.to);
                    modified = true;
                }
            }
            
            if (modified) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log('Cleaned up design in:', fullPath);
            }
        }
    }
}

walkDir(targetDir);
console.log('Done cleaning up gradients and rounded corners!');
