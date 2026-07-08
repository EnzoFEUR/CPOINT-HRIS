const fs = require('fs');

const filesToUpdate = [
    'C:\\Users\\Enzo\\hris-v2\\frontend\\src\\pages\\admin\\attendance\\Index.jsx',
    'C:\\Users\\Enzo\\hris-v2\\frontend\\src\\pages\\admin\\audit-logs\\Index.jsx',
    'C:\\Users\\Enzo\\hris-v2\\frontend\\src\\pages\\admin\\disciplinary\\Index.jsx',
    'C:\\Users\\Enzo\\hris-v2\\frontend\\src\\pages\\admin\\employees\\Index.jsx',
    'C:\\Users\\Enzo\\hris-v2\\frontend\\src\\pages\\admin\\leaves\\Index.jsx',
    'C:\\Users\\Enzo\\hris-v2\\frontend\\src\\pages\\admin\\payroll\\Index.jsx',
    'C:\\Users\\Enzo\\hris-v2\\frontend\\src\\pages\\admin\\shifts\\Index.jsx'
];

for (const filePath of filesToUpdate) {
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // 1. Fix rounding in PREMIUM HEADER
        // Container
        content = content.replace(/rounded-\[2\.5rem\]/g, 'rounded-xl');
        // CTA Button
        content = content.replace(/rounded-\[2rem\]/g, 'rounded-lg');
        // Icon Box
        content = content.replace(/rounded-2xl/g, 'rounded-lg');
        // Tag
        content = content.replace(/rounded-xl/g, 'rounded-md');

        // 2. Fix payroll color (Force to emerald)
        if (filePath.includes('payroll')) {
            content = content.replace(/bg-amber-600/g, 'bg-emerald-600');
            content = content.replace(/text-amber-400/g, 'text-emerald-400');
            content = content.replace(/bg-amber-500\/20/g, 'bg-emerald-500/20');
            content = content.replace(/text-amber-300/g, 'text-emerald-300');
            content = content.replace(/border-amber-500\/30/g, 'border-emerald-500/30');
            content = content.replace(/text-amber-100\/70/g, 'text-emerald-100/70');
            
            // Just in case it got stuck as blue or indigo
            content = content.replace(/bg-blue-600/g, 'bg-emerald-600');
            content = content.replace(/bg-indigo-600/g, 'bg-emerald-600');
        }

        // 3. Fix disciplinary red color to be slightly lighter (rose)
        if (filePath.includes('disciplinary')) {
            content = content.replace(/bg-red-600/g, 'bg-rose-500');
            content = content.replace(/text-red-400/g, 'text-rose-400');
            content = content.replace(/bg-red-500\/20/g, 'bg-rose-500/20');
            content = content.replace(/text-red-300/g, 'text-rose-300');
            content = content.replace(/border-red-500\/30/g, 'border-rose-500/30');
            content = content.replace(/text-red-100\/70/g, 'text-rose-100/70');
        }

        fs.writeFileSync(filePath, content, 'utf8');
        console.log('Processed:', filePath);
    }
}
console.log('Finished updating minor UI tweaks!');
