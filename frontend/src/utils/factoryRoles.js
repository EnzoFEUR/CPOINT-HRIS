// Shoe production roles and line assignments

export const FACTORY_SHOE_ROLES = [
  {
    id: 'Cutter',
    label: 'Cutter',
    filipino: 'Pamumutol',
    stage: 'Stage 1: Material Cutting',
    description: 'Cutting leather, synthetic fabrics, and pattern lining.',
    icon: 'ti-scissors',
    color: 'emerald'
  },
  {
    id: 'Marking',
    label: 'Marking',
    filipino: 'Pagmamarka',
    stage: 'Stage 2: Pattern Marking',
    description: 'Tracing alignment marks, stitch guides, and skiving lines.',
    icon: 'ti-pencil',
    color: 'blue'
  },
  {
    id: 'Areglo',
    label: 'Areglo',
    filipino: 'Pang-aareglo',
    stage: 'Stage 3: Upper Assembly & Closing',
    description: 'Upper assembly, edge folding, and piece stitching.',
    icon: 'ti-layers-intersect',
    color: 'cyan'
  },
  {
    id: 'Sapatero (Lapat/Swelas)',
    label: 'Sapatero (Lapat/Swelas)',
    filipino: 'Pagsasapatos at Paglalapat ng Swelas',
    stage: 'Stage 4: Lasting & Soling (Lapat / Swelas)',
    description: 'Lasting uppers onto shoe molds and attaching outsoles.',
    icon: 'ti-shoe',
    color: 'amber'
  },
  {
    id: 'Alamoda',
    label: 'Alamoda',
    filipino: 'Pagtatahi ng Moda',
    stage: 'Stage 5: Edge & Collar Finishing',
    description: 'Edge and collar stitching and upper embellishments.',
    icon: 'ti-needle',
    color: 'indigo'
  },
  {
    id: 'Finishing',
    label: 'Finishing',
    filipino: 'Pang-finishing',
    stage: 'Stage 6: Final Cleanup & Boxing',
    description: 'Cleaning, polishing, quality inspection, and boxing.',
    icon: 'ti-sparkles',
    color: 'rose'
  }
];

export const DEFAULT_PRODUCTION_LINES = [
  'Line A',
  'Line B',
  'Line C',
  'Line D',
  'Line E',
  'Line F'
];

export const PRODUCTION_GROUPS = DEFAULT_PRODUCTION_LINES.map(id => ({ id, name: id }));

// Match job title to factory shoe craft
export function getShoeRoleDetails(jobTitle = '') {
  const normalized = (jobTitle || '').toLowerCase();
  
  if (normalized.includes('cutter') || normalized.includes('cutting')) {
    return FACTORY_SHOE_ROLES.find(r => r.id === 'Cutter');
  }
  if (normalized.includes('marking') || normalized.includes('marka')) {
    return FACTORY_SHOE_ROLES.find(r => r.id === 'Marking');
  }
  if (normalized.includes('areglo')) {
    return FACTORY_SHOE_ROLES.find(r => r.id === 'Areglo');
  }
  if (normalized.includes('sapatero') || normalized.includes('swela') || normalized.includes('lapat') || normalized.includes('shoe maker') || normalized.includes('shoemaker')) {
    return FACTORY_SHOE_ROLES.find(r => r.id === 'Sapatero (Lapat/Swelas)');
  }
  if (normalized.includes('alamoda') || normalized.includes('tahi') || normalized.includes('stitching')) {
    return FACTORY_SHOE_ROLES.find(r => r.id === 'Alamoda');
  }
  if (normalized.includes('finish') || normalized.includes('qa') || normalized.includes('packing')) {
    return FACTORY_SHOE_ROLES.find(r => r.id === 'Finishing');
  }
  
  return null;
}

// Extract production group or custom line from shift string
export function parseProductionGroup(shiftStr = '') {
  if (!shiftStr) return 'Line A';
  let line = shiftStr;
  if (line.includes('·')) {
    line = line.split('·')[0];
  }
  line = line.trim();
  if (!line || /^\d{1,2}:\d{2}/.test(line) || line.toLowerCase() === 'factory' || line.toLowerCase() === 'unassigned') {
    return 'Line A';
  }
  return line;
}

// Extract unique production lines from workforce data
export function extractProductionLines(employees = []) {
  const lineSet = new Set(DEFAULT_PRODUCTION_LINES);
  if (Array.isArray(employees)) {
    employees.forEach(emp => {
      const dept = (emp.department || '').toLowerCase();
      const shift = (emp.shift || '').toLowerCase();
      if (dept.includes('factory') || shift.includes('factory')) {
        const parsed = parseProductionGroup(emp.shift);
        if (parsed && parsed !== 'Unassigned Line') {
          lineSet.add(parsed);
        }
      }
    });
  }
  return Array.from(lineSet);
}

// Calculate labor costing breakdown for a production batch
export function calculateBatchLaborCost({ stockType = 'Formal', quantityPairs = 0, stageRates = {} }) {
  const qty = Math.max(0, parseInt(quantityPairs, 10) || 0);
  
  const stages = FACTORY_SHOE_ROLES.map(role => {
    const rawRate = stageRates[role.id] ?? stageRates[role.label] ?? 0;
    const ratePerPair = Math.max(0, parseFloat(rawRate) || 0);
    const subtotal = Math.round(qty * ratePerPair * 100) / 100;
    return {
      roleId: role.id,
      roleLabel: role.label,
      stage: role.stage,
      filipino: role.filipino,
      icon: role.icon,
      color: role.color,
      ratePerPair,
      subtotal
    };
  });

  const totalDirectLabor = Math.round(stages.reduce((acc, s) => acc + s.subtotal, 0) * 100) / 100;
  const laborCostPerPair = qty > 0 
    ? Math.round((totalDirectLabor / qty) * 100) / 100 
    : Math.round(stages.reduce((acc, s) => acc + s.ratePerPair, 0) * 100) / 100;

  return {
    stockType,
    quantityPairs: qty,
    stages,
    laborCostPerPair,
    totalDirectLabor
  };
}
