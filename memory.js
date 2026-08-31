// AURA local memory helper
const AURA_MEMORY_KEY='aura_memory_v1';
export function loadAuraMemory(){try{return JSON.parse(localStorage.getItem(AURA_MEMORY_KEY)||'[]')}catch{return[]}}
export function saveAuraMemory(items){localStorage.setItem(AURA_MEMORY_KEY,JSON.stringify(items.slice(-200)))}
