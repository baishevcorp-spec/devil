const fs = require('fs');
const path = require('path');

// Путь к тестовой БД
const dbPath = path.join(process.cwd(), '.devil', 'memory.db');

if (!fs.existsSync(dbPath)) {
  console.log('❌ БД не найдена. Откройте проект в VS Code и выполните /memory show');
  process.exit(1);
}

// Читаем БД через sql.js
const initSqlJs = require('sql.js');
const fileBuffer = fs.readFileSync(dbPath);

initSqlJs().then(SQL => {
  const db = new SQL.Database(fileBuffer);

  // Проверяем существование таблицы node_embeddings
  const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='node_embeddings'");

  if (result.length > 0) {
    console.log('✅ Таблица node_embeddings создана');

    // Проверяем структуру
    const schema = db.exec("PRAGMA table_info(node_embeddings)");
    console.log('\nСтруктура таблицы:');
    schema[0].values.forEach(row => {
      console.log(`  - ${row[1]}: ${row[2]}`);
    });

    // Проверяем миграцию
    const migrations = db.exec("SELECT name FROM migrations WHERE name = '003_create_node_embeddings'");
    if (migrations.length > 0) {
      console.log('\n✅ Миграция 003 зарегистрирована');
    } else {
      console.log('\n❌ Миграция 003 не зарегистрирована');
    }
  } else {
    console.log('❌ Таблица node_embeddings не создана');
  }

  db.close();
});
