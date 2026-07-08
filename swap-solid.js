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
        let originalContent = content;
        
        // Swap grey button to solid indigo
        content = content.replace(/bg-zinc-800 border border-zinc-700/g, 'bg-indigo-600');
        
        // Swap grey decorative flair to solid indigo tinted flair
        content = content.replace(/bg-zinc-800\/10/g, 'bg-indigo-600/10');

        if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Swapped to solid indigo in:', filePath);
        }
    }
}
console.log('Finished updating buttons to solid colors!');
