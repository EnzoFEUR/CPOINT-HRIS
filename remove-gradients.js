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
        
        // Remove the background glow gradient in the PREMIUM HEADER
        content = content.replace(/bg-gradient-to-bl from-[a-z0-9-\/]+ to-[a-z0-9-\/]+/g, 'bg-zinc-800/10');
        
        // Replace the CTA button gradient with a solid color
        content = content.replace(/bg-gradient-to-r from-[a-z0-9-\/]+ to-[a-z0-9-\/]+/g, 'bg-zinc-800 border border-zinc-700');
        
        // Replace any other generic gradients if they exist
        content = content.replace(/bg-gradient-[a-z0-9-\/]+ from-[a-z0-9-\/]+ to-[a-z0-9-\/]+/g, 'bg-zinc-800');

        if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Removed gradients in:', filePath);
        } else {
            console.log('No gradients found to remove in:', filePath);
        }
    } else {
        console.log('File not found:', filePath);
    }
}
console.log('Finished removing gradients from PREMIUM HEADERS!');
