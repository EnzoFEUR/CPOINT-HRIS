const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, 'frontend', 'src', 'pages');

const replacements = [
    { from: /#F2F2F7/gi, to: '#F8F9FB' },
    { from: /#1C1C1E/gi, to: '#0F172A' },
    { from: /#8E8E93/gi, to: '#94A3B8' },
    { from: /#C7C7CC/gi, to: '#CBD5E1' },
    { from: /#D1D1D6/gi, to: '#CBD5E1' },
    { from: /#E5E5EA/gi, to: '#E2E8F0' },
    { from: /#007AFF/gi, to: '#6366F1' },
    { from: /#FF3B30/gi, to: '#EF4444' },
    { from: /#FF9500/gi, to: '#F59E0B' },
    { from: /#34C759/gi, to: '#22C55E' },
    { from: /#5856D6/gi, to: '#8B5CF6' },
    
    // rgba
    { from: /rgba\(0,\s*122,\s*255/g, to: 'rgba(99,102,241' },
    { from: /rgba\(255,\s*59,\s*48/g, to: 'rgba(239,68,68' },
    { from: /rgba\(255,\s*149,\s*0/g, to: 'rgba(245,158,11' },
    { from: /rgba\(52,\s*199,\s*89/g, to: 'rgba(34,197,94' },
    { from: /rgba\(0,\s*0,\s*0,\s*0\.04\)/g, to: 'rgba(15,23,42,0.04)' },
    { from: /rgba\(0,\s*0,\s*0,\s*0\.02\)/g, to: 'rgba(99,102,241,0.02)' },
    
    // Some classes
    { from: /rounded-\[10px\]/g, to: 'rounded-xl' },
    { from: /rounded-\[8px\]/g, to: 'rounded-lg' },
];

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.jsx')) {
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
                console.log('Updated:', fullPath);
            }
        }
    }
}

walkDir(targetDir);
console.log('Done overhauling tokens!');
