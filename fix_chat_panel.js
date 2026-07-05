const fs = require('fs');
const filePath = 'src/panels/ChatPanel.ts';
const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

console.log('=== Построчное обновление ChatPanel.ts ===\n');
console.log(`Всего строк: ${lines.length}`);

const result = [];
let changesCount = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const nextLine = lines[i + 1] || '';
  
  // 1. Сигнатура createOrShow: "    devPlanExecutor?: DevPlanExecutor" перед "  ): ChatPanel {"
  if (/^\s+devPlanExecutor\?: DevPlanExecutor\s*$/.test(line) && 
      /^\s+\): ChatPanel \{/.test(nextLine)) {
    result.push(line);
    result.push('    dreamManager?: DreamManager,');
    result.push('    dreamLockManager?: DreamLockManager');
    console.log(`✓ Строка ${i + 1}: Добавлены параметры в createOrShow()`);
    changesCount++;
    continue;
  }
  
  // 2. Приватный конструктор: "    devPlanExecutor?: DevPlanExecutor" перед "  ) {"
  if (/^\s+devPlanExecutor\?: DevPlanExecutor\s*$/.test(line) && 
      /^\s+\) \{/.test(nextLine)) {
    result.push(line);
    result.push('    dreamManager?: DreamManager,');
    result.push('    dreamLockManager?: DreamLockManager');
    console.log(`✓ Строка ${i + 1}: Добавлены параметры в private constructor`);
    changesCount++;
    continue;
  }
  
  // 3. Вызов new ChatPanel() или CommandHandler: "      devPlanExecutor" перед "    );"
  if (/^\s+devPlanExecutor\s*$/.test(line) && 
      /^\s+\);/.test(nextLine)) {
    result.push(line);
    result.push('      dreamManager,');
    result.push('      dreamLockManager');
    
    // Определяем контекст по предыдущим строкам
    const prevContext = result.slice(-15).join('\n');
    if (prevContext.includes('ChatPanel.currentPanel = new ChatPanel')) {
      console.log(`✓ Строка ${i + 1}: Добавлены параметры в new ChatPanel()`);
    } else if (prevContext.includes('this.commandHandler = new CommandHandler')) {
      console.log(`✓ Строка ${i + 1}: Добавлены параметры в new CommandHandler()`);
    }
    changesCount++;
    continue;
  }
  
  result.push(line);
}

fs.writeFileSync(filePath, result.join('\n'));
console.log(`\n✅ Сделано изменений: ${changesCount}`);

if (changesCount === 0) {
  console.log('\n⚠️ Изменений не сделано. Проверю содержимое файла...');
  // Ищем все строки с devPlanExecutor
  lines.forEach((line, idx) => {
    if (line.includes('devPlanExecutor')) {
      console.log(`  Строка ${idx + 1}: ${line}`);
    }
  });
}
