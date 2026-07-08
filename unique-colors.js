const fs = require('fs');

const pageConfig = {
    'employees': 'blue',
    'attendance': 'emerald',
    'payroll': 'amber',
    'leaves': 'teal',
    'shifts': 'cyan',
    'audit-logs': 'slate',
    'disciplinary': 'red'
};

const pagesDir = 'C:\\Users\\Enzo\\hris-v2\\frontend\\src\\pages\\admin';

for (const [folder, color] of Object.entries(pageConfig)) {
    const filePath = `${pagesDir}\\${folder}\\Index.jsx`;
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Remove fixed ambient glowing backgrounds (they look like <div className="fixed ... blur-[120px] ... />)
        content = content.replace(/<div className="fixed[^>]+blur-\[120px\][^>]+\/>/g, '');
        
        // Remove the top right flair inside the header (blur-3xl)
        content = content.replace(/<div className="absolute top-0 right-0 w-\[30rem\] h-\[30rem\][^>]+blur-3xl[^>]+\/>/g, '');
        
        // Remove button and header shadow glow
        content = content.replace(/shadow-xl shadow-[a-z0-9-\/]+/g, 'shadow-sm');
        content = content.replace(/shadow-2xl shadow-[a-z0-9-\/]+/g, 'shadow-sm');
        
        // Swap base colors (indigo -> unique color)
        content = content.replace(/bg-indigo-600/g, `bg-${color}-600`);
        content = content.replace(/text-indigo-400/g, `text-${color}-400`);
        content = content.replace(/bg-indigo-500\/20/g, `bg-${color}-500/20`);
        content = content.replace(/text-indigo-300/g, `text-${color}-300`);
        content = content.replace(/border-indigo-500\/30/g, `border-${color}-500/30`);
        content = content.replace(/text-indigo-100\/70/g, `text-${color}-100/70`);
        
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${folder} with ${color} and removed glows.`);
    }
}
